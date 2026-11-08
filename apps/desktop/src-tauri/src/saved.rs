//! Results that outlive the app: the latest full scan of each folder, and a small summary of every
//! scan for comparing over time. All of it stays in the app's data folder on this machine.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use jard_scan::{display_path, kind_totals, Kind, KindTotal, Query, Tree};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{dto, read, NodeDto, Scan, Scans};
use jard_clean::Store;

/// Summaries kept per scanned folder. Weekly scans would reach back over a year.
const KEEP_SUMMARIES: usize = 60;
/// A folder under this size isn't worth a line in a summary.
const SUMMARY_MIN: u64 = 10_000_000;
/// How deep summaries list folders: C:\Users\Me is level 2.
const SUMMARY_DEPTH: u32 = 3;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn base(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string()).map(|d| d.join("scans"))
}

/// A stable file name for a scanned folder.
fn key_of(root: &str) -> String {
    let lower = root.to_lowercase();
    blake3::hash(lower.as_bytes()).to_hex()[..16].to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedScan {
    key: String,
    root: String,
    saved_at: u64,
    on_disk: u64,
    apparent: u64,
    files: u64,
    dirs: u64,
    partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    at: u64,
    on_disk: u64,
    apparent: u64,
    files: u64,
    partial: bool,
    folders: Vec<SummaryFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SummaryFolder {
    path: String,
    depth: u32,
    on_disk: u64,
}

fn summarize(tree: &Tree, at: u64) -> Summary {
    let root = tree.root_node();
    let mut depth = vec![0u32; tree.nodes.len()];
    let mut paths: HashMap<u32, String> = HashMap::new();
    let mut folders = Vec::new();
    for n in &tree.nodes {
        let Some(parent) = n.parent else { continue };
        let d = depth[parent as usize] + 1;
        depth[n.id as usize] = d;
        if !n.is_dir || d > SUMMARY_DEPTH || !tree.is_attached(n) {
            continue;
        }
        let path = match paths.get(&parent) {
            Some(p) => format!("{p}\\{}", n.name),
            None => n.name.to_string(),
        };
        if n.on_disk >= SUMMARY_MIN {
            folders.push(SummaryFolder { path: path.clone(), depth: d, on_disk: n.on_disk });
        }
        paths.insert(n.id, path);
    }
    Summary { at, on_disk: root.on_disk, apparent: root.apparent, files: root.files, partial: tree.partial, folders }
}

/// Saves a finished scan. Runs off the main thread: a whole drive takes a moment.
pub(crate) fn save_scan(app: &AppHandle, tree: &Tree, write_summary: bool) -> Result<SavedScan, String> {
    save_scan_in(&base(app)?, tree, write_summary)
}

pub(crate) fn save_scan_in(dir: &Path, tree: &Tree, write_summary: bool) -> Result<SavedScan, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let shown = display_path(&tree.root);
    let key = key_of(&shown);
    let at = now();
    tree.save_to(&dir.join(format!("{key}.jardscan"))).map_err(|e| e.to_string())?;

    let r = tree.root_node();
    let meta = SavedScan {
        key: key.clone(),
        root: shown,
        saved_at: at,
        on_disk: r.on_disk,
        apparent: r.apparent,
        files: r.files,
        dirs: r.dirs,
        partial: tree.partial,
    };
    let json = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{key}.json")), json).map_err(|e| e.to_string())?;

    // A cancelled scan has low numbers that would look like space was freed: no summary for it.
    if write_summary && !tree.cancelled {
        let hist = dir.join(&key);
        fs::create_dir_all(&hist).map_err(|e| e.to_string())?;
        let json = serde_json::to_vec(&summarize(tree, at)).map_err(|e| e.to_string())?;
        fs::write(hist.join(format!("{at}.json")), json).map_err(|e| e.to_string())?;
        let mut old = summary_files(&hist);
        while old.len() > KEEP_SUMMARIES {
            let _ = fs::remove_file(old.remove(0));
        }
    }
    Ok(meta)
}

/// Oldest first; names are timestamps, so this order is time order once they're compared as numbers.
fn summary_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<(u64, PathBuf)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let at = e.path().file_stem()?.to_str()?.parse().ok()?;
            Some((at, e.path()))
        })
        .collect();
    files.sort_by_key(|f| f.0);
    files.into_iter().map(|f| f.1).collect()
}

fn read_summary(path: &Path) -> Option<Summary> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Newest first.
#[tauri::command]
pub(crate) fn saved_scans(app: AppHandle) -> Result<Vec<SavedScan>, String> {
    let dir = base(&app)?;
    let mut out: Vec<SavedScan> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice(&fs::read(e.path()).ok()?).ok())
        .collect();
    out.sort_by_key(|s: &SavedScan| std::cmp::Reverse(s.saved_at));
    Ok(out)
}

/// Loads a saved scan so it can be browsed. Returns its scan id.
#[tauri::command]
pub(crate) async fn open_saved(app: AppHandle, scans: State<'_, Scans>, key: String) -> Result<u32, String> {
    if !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad key".into());
    }
    let path = base(&app)?.join(format!("{key}.jardscan"));
    let tree = tauri::async_runtime::spawn_blocking(move || Tree::load_from(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let id = scans.new_id();
    scans.set(id, Scan::Done(Arc::new(RwLock::new(tree))));
    Ok(id)
}

/// Keeps the saved copy in step after files left or came back.
pub(crate) fn resave(app: &AppHandle, tree: Arc<RwLock<Tree>>) {
    let app = app.clone();
    let _ = std::thread::Builder::new().name("jard-resave".into()).spawn(move || {
        let tree = read(&tree);
        let _ = save_scan(&app, &tree, false);
    });
}

/// Removes every saved result and summary. The quarantine and the history log stay.
#[tauri::command]
pub(crate) fn forget_saved(app: AppHandle) -> Result<(), String> {
    let dir = base(&app)?;
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Point {
    at: u64,
    on_disk: u64,
    files: u64,
    partial: bool,
}

/// Summaries of one folder, oldest first: the growth chart.
#[tauri::command]
pub(crate) fn scan_points(app: AppHandle, key: String) -> Result<Vec<Point>, String> {
    if !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad key".into());
    }
    Ok(summary_files(&base(&app)?.join(&key))
        .iter()
        .filter_map(|p| read_summary(p))
        .map(|s| Point { at: s.at, on_disk: s.on_disk, files: s.files, partial: s.partial })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Change {
    path: String,
    delta: i64,
    /// `grew`, `shrank`, `new`, `gone`
    what: &'static str,
}

/// What changed between two scans of one folder, biggest change first.
#[tauri::command]
pub(crate) fn compare_scans(app: AppHandle, key: String, from: u64, to: u64) -> Result<Vec<Change>, String> {
    if !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad key".into());
    }
    let dir = base(&app)?.join(&key);
    let load = |at: u64| read_summary(&dir.join(format!("{at}.json"))).ok_or("no such scan".to_string());
    let (a, b) = (load(from)?, load(to)?);

    // Parent and child would both report the same growth: use the deepest level that has data.
    let rows = |s: &Summary| -> HashMap<String, (u32, u64)> {
        s.folders.iter().map(|f| (f.path.to_lowercase(), (f.depth, f.on_disk))).collect()
    };
    let (ra, rb) = (rows(&a), rows(&b));
    let shown: HashMap<String, String> =
        a.folders.iter().chain(&b.folders).map(|f| (f.path.to_lowercase(), f.path.clone())).collect();
    let has_child = |p: &str| {
        let prefix = format!("{p}\\");
        ra.keys().chain(rb.keys()).any(|k| k.starts_with(&prefix))
    };
    let mut out = Vec::new();
    for (lower, path) in &shown {
        if has_child(lower) {
            continue;
        }
        let before = ra.get(lower).map_or(0, |r| r.1) as i64;
        let after = rb.get(lower).map_or(0, |r| r.1) as i64;
        let delta = after - before;
        if delta.unsigned_abs() < SUMMARY_MIN {
            continue;
        }
        let what = match (ra.contains_key(lower), rb.contains_key(lower)) {
            (false, true) => "new",
            (true, false) => "gone",
            _ if delta > 0 => "grew",
            _ => "shrank",
        };
        out.push(Change { path: path.clone(), delta, what });
    }
    out.sort_by_key(|c| std::cmp::Reverse(c.delta.unsigned_abs()));
    out.truncate(30);
    Ok(out)
}

#[tauri::command]
pub(crate) fn kinds_of(scans: State<'_, Scans>, scan_id: u32) -> Result<Vec<KindTotal>, String> {
    Ok(kind_totals(&read(&scans.tree(scan_id)?)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchHit {
    node: NodeDto,
    path: String,
    kind: Kind,
}

#[tauri::command]
pub(crate) fn search_scan(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: u32,
    query: Query,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    Ok(tree
        .search(&query, limit.unwrap_or(300))
        .into_iter()
        .filter_map(|n| {
            Some(SearchHit { node: dto(&tree, &store, n), path: tree.display_path(n.id)?, kind: Kind::of(&n.name) })
        })
        .collect())
}

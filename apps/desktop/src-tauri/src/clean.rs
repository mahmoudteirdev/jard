//! Cleanup commands: what could go, moving it to quarantine, and bringing it back.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use jard_clean::{Failure, Item, LogEntry, OnConflict, Outcome, Preview, Request, Store};
use jard_scan::{flags, NodeId, Tree};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{dto, read, NodeDto, Scans, SharedTree};

/// Which scan node each quarantined item came from, so a restore updates the numbers on screen.
/// Lost when the app closes: older items restore fine, and the next scan counts them.
#[derive(Default)]
pub(crate) struct Moved(Mutex<HashMap<String, (SharedTree, NodeId)>>);

fn requests(tree: &Tree, ids: &[NodeId]) -> Vec<(NodeId, Request)> {
    ids.iter()
        .filter_map(|&id| {
            let n = tree.get(id)?;
            // A file under a folder also selected goes along with the folder.
            let under_selected = {
                let mut cur = n.parent;
                let mut found = false;
                while let Some(p) = cur {
                    if ids.contains(&p) {
                        found = true;
                        break;
                    }
                    cur = tree.get(p).and_then(|x| x.parent);
                }
                found
            };
            if under_selected || !tree.is_attached(n) {
                return None;
            }
            Some((
                id,
                Request {
                    path: tree.path(id)?,
                    is_dir: n.is_dir,
                    apparent: n.apparent,
                    on_disk: n.on_disk,
                    files: n.files,
                },
            ))
        })
        .collect()
}

/// What moving these nodes would do. Moves nothing.
#[tauri::command]
pub(crate) fn preview_clean(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: u32,
    node_ids: Vec<NodeId>,
) -> Result<Preview, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    let reqs: Vec<Request> = requests(&tree, &node_ids).into_iter().map(|(_, r)| r).collect();
    Ok(store.preview(&reqs))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeOutcome {
    node_id: NodeId,
    #[serde(flatten)]
    outcome: Outcome,
}

/// Moves nodes to quarantine. Protected paths are refused inside `Store`, whatever is asked here.
#[tauri::command]
pub(crate) async fn quarantine_nodes(
    app: AppHandle,
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    moved: State<'_, Moved>,
    scan_id: u32,
    node_ids: Vec<NodeId>,
) -> Result<Vec<NodeOutcome>, String> {
    let shared = scans.tree(scan_id)?;
    let reqs = requests(&read(&shared), &node_ids);
    let store = Arc::clone(&store);
    let results = tauri::async_runtime::spawn_blocking(move || {
        let (ids, reqs): (Vec<NodeId>, Vec<Request>) = reqs.into_iter().unzip();
        ids.into_iter().zip(store.quarantine(&reqs)).collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    let out = {
        let mut tree = shared.write().unwrap_or_else(|e| e.into_inner());
        let mut map = moved.0.lock().unwrap_or_else(|e| e.into_inner());
        results
            .into_iter()
            .map(|(node_id, outcome)| {
                if let Some(item) = &outcome.item {
                    tree.detach(node_id);
                    map.insert(item.id.clone(), (Arc::clone(&shared), node_id));
                }
                NodeOutcome { node_id, outcome }
            })
            .collect::<Vec<_>>()
    };
    crate::saved::resave(&app, shared);
    Ok(out)
}

#[tauri::command]
pub(crate) fn list_quarantine(store: State<'_, Arc<Store>>) -> Vec<Item> {
    store.list()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreDto {
    path: Option<String>,
    failure: Option<Failure>,
}

#[tauri::command]
pub(crate) async fn restore_item(
    app: AppHandle,
    store: State<'_, Arc<Store>>,
    moved: State<'_, Moved>,
    id: String,
    on_conflict: OnConflict,
) -> Result<RestoreDto, String> {
    let s = Arc::clone(&store);
    let item_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || s.restore(&item_id, on_conflict))
        .await
        .map_err(|e| e.to_string())?;
    Ok(match result {
        Ok(path) => {
            if let Some((tree, node)) = moved.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                tree.write().unwrap_or_else(|e| e.into_inner()).reattach(node);
                crate::saved::resave(&app, tree);
            }
            RestoreDto { path: Some(path), failure: None }
        }
        Err(f) => RestoreDto { path: None, failure: Some(f) },
    })
}

/// Deletes an item for good. The UI confirms first; this cannot be undone.
#[tauri::command]
pub(crate) async fn delete_item(
    store: State<'_, Arc<Store>>,
    moved: State<'_, Moved>,
    id: String,
) -> Result<Option<Failure>, String> {
    let s = Arc::clone(&store);
    let item_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || s.delete(&item_id)).await.map_err(|e| e.to_string())?;
    moved.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    Ok(result.err())
}

#[tauri::command]
pub(crate) fn read_log(store: State<'_, Arc<Store>>, limit: Option<usize>) -> Vec<LogEntry> {
    store.log(limit.unwrap_or(50))
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CandidateKind {
    Large,
    Temp,
    Old,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    node: NodeDto,
    path: String,
    /// Short code the UI turns into words: `safe`, `redownload`, `kind_*`.
    note: String,
}

const MB: u64 = 1_000_000;
const YEAR: u64 = 365 * 86_400;

struct CacheRule {
    tail: &'static [&'static str],
    note: &'static str,
    /// The folder must stay for programs to work, so offer what is inside it.
    contents_only: bool,
}

const CACHES: &[CacheRule] = &[
    CacheRule { tail: &["appdata", "local", "temp"], note: "safe", contents_only: true },
    CacheRule { tail: &["windows", "temp"], note: "safe", contents_only: true },
    CacheRule { tail: &["appdata", "local", "npm-cache"], note: "redownload", contents_only: false },
    CacheRule { tail: &["appdata", "local", "pnpm-cache"], note: "redownload", contents_only: false },
    CacheRule { tail: &["appdata", "local", "pip", "cache"], note: "redownload", contents_only: false },
    CacheRule { tail: &[".gradle", "caches"], note: "redownload", contents_only: false },
    CacheRule { tail: &["user data", "default", "cache"], note: "safe", contents_only: false },
    CacheRule { tail: &["user data", "default", "code cache"], note: "safe", contents_only: false },
    CacheRule { tail: &["appdata", "local", "microsoft", "windows", "inetcache"], note: "safe", contents_only: false },
    CacheRule { tail: &["appdata", "local", "crashdumps"], note: "safe", contents_only: false },
    CacheRule { tail: &["appdata", "local", "d3dscache"], note: "safe", contents_only: false },
    CacheRule { tail: &["appdata", "local", "nvidia", "dxcache"], note: "safe", contents_only: false },
];

fn extension_note(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "mp4" | "mkv" | "mov" | "avi" | "wmv" | "webm" | "m4v" | "ts" | "flv" => "kind_video",
        "iso" | "img" | "wim" | "esd" => "kind_disk_image",
        "vdi" | "vmdk" | "vhd" | "vhdx" | "qcow2" | "ova" => "kind_vm",
        "zip" | "rar" | "7z" | "tar" | "gz" | "xz" | "bz2" | "zst" | "tgz" => "kind_archive",
        "exe" | "msi" | "msix" | "apk" | "appx" | "dmg" | "deb" => "kind_installer",
        "jpg" | "jpeg" | "png" | "gif" | "heic" | "webp" | "raw" | "cr2" | "nef" | "psd" | "tif" | "tiff" => {
            "kind_image"
        }
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => "kind_audio",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" => "kind_document",
        _ => "kind_other",
    }
}

/// Things worth a look, already free of anything protected.
#[tauri::command]
pub(crate) fn cleanup_candidates(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: u32,
    kind: CandidateKind,
    limit: Option<usize>,
) -> Result<Vec<Candidate>, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    let limit = limit.unwrap_or(200);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());

    let mut found: Vec<(NodeId, String)> = Vec::new();
    match kind {
        CandidateKind::Large => {
            for n in tree.largest_files(100 * MB, limit * 2) {
                found.push((n.id, extension_note(&n.name).to_string()));
            }
        }
        CandidateKind::Old => {
            for n in tree.old_files(now.saturating_sub(YEAR), 10 * MB, limit * 2) {
                found.push((n.id, extension_note(&n.name).to_string()));
            }
        }
        CandidateKind::Temp => {
            let tails: Vec<&[&str]> = CACHES.iter().map(|c| c.tail).collect();
            for (n, rule) in tree.folders_ending_with(&tails) {
                let rule = &CACHES[rule];
                if rule.contents_only {
                    for c in tree.children(n.id, jard_scan::SortKey::OnDisk, 0, Some(100)) {
                        if c.on_disk >= MB {
                            found.push((c.id, rule.note.to_string()));
                        }
                    }
                } else {
                    found.push((n.id, rule.note.to_string()));
                }
            }
        }
    }

    Ok(found
        .into_iter()
        .filter_map(|(id, note)| {
            let n = tree.get(id)?;
            let d = dto(&tree, &store, n);
            // Protected paths are not offered at all. Links have nothing to free.
            if d.protected.is_some() || n.has(flags::REPARSE) {
                return None;
            }
            Some(Candidate { node: d, path: tree.display_path(id)?, note })
        })
        .take(limit)
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DuplicateDto {
    size: u64,
    reclaimable: u64,
    /// The copy to keep: the shortest path.
    keep: String,
    /// The other copies, which can be moved.
    copies: Vec<Candidate>,
}

/// Compares file contents, so it reads from disk and can take a while on a big drive.
#[tauri::command]
pub(crate) async fn find_duplicates(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: u32,
    limit: Option<usize>,
) -> Result<Vec<DuplicateDto>, String> {
    let shared = scans.tree(scan_id)?;
    let store = Arc::clone(&store);
    tauri::async_runtime::spawn_blocking(move || {
        let tree = read(&shared);
        let stop = AtomicBool::new(false);
        let groups = jard_scan::find_duplicates(&tree, MB, &stop);
        groups
            .iter()
            .take(limit.unwrap_or(200))
            .filter_map(|g| {
                let (&first, rest) = g.files.split_first()?;
                let keep = tree.display_path(first)?;
                let copies: Vec<Candidate> = rest
                    .iter()
                    .filter_map(|&id| {
                        let d = dto(&tree, &store, tree.get(id)?);
                        if d.protected.is_some() {
                            return None;
                        }
                        Some(Candidate { node: d, path: tree.display_path(id)?, note: "duplicate".into() })
                    })
                    .collect();
                (!copies.is_empty()).then(|| DuplicateDto {
                    size: g.size,
                    reclaimable: g.size * copies.len() as u64,
                    keep,
                    copies,
                })
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

pub(crate) fn temp_tails() -> &'static [&'static [&'static str]] {
    &[&["appdata", "local", "temp"]]
}

pub(crate) fn browser_cache_tails() -> &'static [&'static [&'static str]] {
    &[&["user data", "default", "cache"], &["user data", "default", "code cache"]]
}

/// Folders right inside ProgramData and AppData of 50 MB or more: where uninstalled programs leave things.
#[tauri::command]
pub(crate) fn data_folders(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: u32,
) -> Result<Vec<Candidate>, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    let tails: &[&[&str]] = &[&["programdata"], &["appdata", "local"], &["appdata", "roaming"]];
    let mut out = Vec::new();
    for (parent, _) in tree.folders_ending_with(tails) {
        for c in tree.children(parent.id, jard_scan::SortKey::OnDisk, 0, Some(200)) {
            if !c.is_dir || c.on_disk < 50 * MB || c.has(flags::REPARSE) {
                continue;
            }
            let d = dto(&tree, &store, c);
            if d.protected.is_none() {
                if let Some(path) = tree.display_path(c.id) {
                    out.push(Candidate { node: d, path, note: "leftover".into() });
                }
            }
        }
    }
    Ok(out)
}

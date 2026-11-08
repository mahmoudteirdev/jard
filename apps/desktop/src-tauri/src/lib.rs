//! Tauri commands that expose the engine to the UI (contract: design/HANDOFF.md §5).
//!
//! The tree never crosses to the UI whole: the UI asks for one folder's children at a time.
//! File operations take node ids, not paths, so the UI can only act on what a scan found.

mod about;
mod clean;
mod saved;
mod scheduled;
mod system;
mod tools;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use jard_clean::{LogKind, Reason, Store};
use jard_scan::{Node, NodeId, Options, Progress, Snapshot, SortKey, Tree};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// How often progress is pushed to the UI.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

type ScanId = u32;
pub(crate) type SharedTree = Arc<RwLock<Tree>>;

pub(crate) enum Scan {
    Running(Arc<Progress>),
    Done(SharedTree),
    Failed(String),
}

struct StartupFolder(Mutex<Option<String>>);

#[derive(Default)]
pub(crate) struct Scans {
    next: AtomicU32,
    map: Mutex<HashMap<ScanId, Scan>>,
}

impl Scans {
    pub(crate) fn new_id(&self) -> ScanId {
        self.next.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn set(&self, id: ScanId, scan: Scan) {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).insert(id, scan);
    }

    pub(crate) fn tree(&self, id: ScanId) -> Result<SharedTree, String> {
        match self.map.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
            Some(Scan::Done(t)) => Ok(Arc::clone(t)),
            Some(Scan::Running(_)) => Err("scan still running".into()),
            Some(Scan::Failed(e)) => Err(e.clone()),
            None => Err(format!("no scan {id}")),
        }
    }
}

pub(crate) fn read(tree: &SharedTree) -> std::sync::RwLockReadGuard<'_, Tree> {
    tree.read().unwrap_or_else(|e| e.into_inner())
}

/// `Node` as the UI sees it. `children` ids are replaced by `childCount`: the UI pages
/// through children with `get_children` instead of receiving every id.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeDto {
    id: NodeId,
    name: String,
    parent: Option<NodeId>,
    is_dir: bool,
    child_count: usize,
    own_apparent: u64,
    own_on_disk: u64,
    own_files: u64,
    apparent: u64,
    on_disk: u64,
    files: u64,
    dirs: u64,
    cloud_bytes: u64,
    dedup_bytes: u64,
    denied: u64,
    flags: u8,
    modified: u64,
    /// Why this may not be moved to quarantine, when so.
    protected: Option<Reason>,
}

pub(crate) fn dto(tree: &Tree, store: &Store, n: &Node) -> NodeDto {
    NodeDto {
        id: n.id,
        name: n.name.to_string(),
        parent: n.parent,
        is_dir: n.is_dir,
        child_count: n.children.len(),
        own_apparent: n.own_apparent,
        own_on_disk: n.own_on_disk,
        own_files: n.own_files,
        apparent: n.apparent,
        on_disk: n.on_disk,
        files: n.files,
        dirs: n.dirs,
        cloud_bytes: n.cloud_bytes,
        dedup_bytes: n.dedup_bytes,
        denied: n.denied,
        flags: n.flags,
        modified: n.modified,
        protected: tree.path(n.id).and_then(|p| store.check(&p)),
    }
}

/// Payload of `scan://done/{scanId}`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneDto {
    root_id: NodeId,
    elapsed_ms: u64,
    partial: bool,
    /// Set when the scan could not start (folder missing, not a folder).
    error: Option<String>,
}

/// What `scan_status` returns: lets the UI catch up on events it subscribed to late.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusDto {
    progress: Option<Snapshot>,
    done: Option<DoneDto>,
}

fn done_of(tree: &Tree) -> DoneDto {
    DoneDto { root_id: Tree::ROOT, elapsed_ms: tree.elapsed.as_millis() as u64, partial: tree.partial, error: None }
}

#[tauri::command]
fn start_scan(
    app: AppHandle,
    scans: State<'_, Scans>,
    root: String,
    opts: Option<Options>,
    keep: Option<bool>,
) -> ScanId {
    let id = scans.new_id();
    let keep = keep.unwrap_or(false);
    let handle = jard_scan::spawn(PathBuf::from(root), opts.unwrap_or_default());
    let progress = Arc::clone(handle.progress());
    scans.set(id, Scan::Running(Arc::clone(&progress)));

    std::thread::Builder::new()
        .name(format!("jard-scan-events-{id}"))
        .spawn(move || {
            let progress_event = format!("scan://progress/{id}");
            while !handle.is_finished() {
                let _ = app.emit(&progress_event, progress.snapshot());
                std::thread::sleep(PROGRESS_EVERY);
            }
            let result = handle.join();
            let _ = app.emit(&progress_event, progress.snapshot());
            let scans = app.state::<Scans>();
            let done = match result {
                Ok(tree) => {
                    let done = done_of(&tree);
                    let root = tree.root_node();
                    app.state::<Arc<Store>>().log_event(LogKind::Scanned, root.files, root.on_disk);
                    if keep {
                        let _ = saved::save_scan(&app, &tree, true);
                    }
                    scans.set(id, Scan::Done(Arc::new(RwLock::new(tree))));
                    done
                }
                Err(e) => {
                    let msg = e.to_string();
                    scans.set(id, Scan::Failed(msg.clone()));
                    DoneDto { root_id: Tree::ROOT, elapsed_ms: 0, partial: true, error: Some(msg) }
                }
            };
            let _ = app.emit(&format!("scan://done/{id}"), done);
        })
        .expect("failed to start scan event thread");
    id
}

#[tauri::command]
fn cancel_scan(scans: State<'_, Scans>, scan_id: ScanId) {
    if let Some(Scan::Running(p)) = scans.map.lock().unwrap_or_else(|e| e.into_inner()).get(&scan_id) {
        p.cancel();
    }
}

#[tauri::command]
fn scan_status(scans: State<'_, Scans>, scan_id: ScanId) -> Result<StatusDto, String> {
    match scans.map.lock().unwrap_or_else(|e| e.into_inner()).get(&scan_id) {
        Some(Scan::Running(p)) => Ok(StatusDto { progress: Some(p.snapshot()), done: None }),
        Some(Scan::Done(t)) => Ok(StatusDto { progress: None, done: Some(done_of(&read(t))) }),
        Some(Scan::Failed(e)) => Ok(StatusDto {
            progress: None,
            done: Some(DoneDto { root_id: Tree::ROOT, elapsed_ms: 0, partial: true, error: Some(e.clone()) }),
        }),
        None => Err(format!("no scan {scan_id}")),
    }
}

/// Frees a finished scan's tree.
#[tauri::command]
fn forget_scan(scans: State<'_, Scans>, scan_id: ScanId) {
    let mut map = scans.map.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(Scan::Running(p)) = map.get(&scan_id) {
        p.cancel();
    }
    map.remove(&scan_id);
}

#[tauri::command]
fn get_children(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: ScanId,
    node_id: NodeId,
    sort: Option<SortKey>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<NodeDto>, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    tree.get(node_id).ok_or("no such node")?;
    Ok(tree
        .children(node_id, sort.unwrap_or_default(), offset.unwrap_or(0), limit)
        .into_iter()
        .map(|n| dto(&tree, &store, n))
        .collect())
}

#[tauri::command]
fn get_node(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: ScanId,
    node_id: NodeId,
) -> Result<NodeDto, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    tree.get(node_id).map(|n| dto(&tree, &store, n)).ok_or_else(|| "no such node".into())
}

/// Display path (no `\\?\` prefix).
#[tauri::command]
fn get_path(scans: State<'_, Scans>, scan_id: ScanId, node_id: NodeId) -> Result<String, String> {
    read(&scans.tree(scan_id)?).display_path(node_id).ok_or_else(|| "no such node".into())
}

/// The node and its ancestors, root first: for the breadcrumb.
#[tauri::command]
fn get_ancestors(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: ScanId,
    node_id: NodeId,
) -> Result<Vec<NodeDto>, String> {
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);
    let mut chain = Vec::new();
    let mut cur = tree.get(node_id).ok_or("no such node")?;
    loop {
        chain.push(dto(&tree, &store, cur));
        match cur.parent.and_then(|p| tree.get(p)) {
            Some(p) => cur = p,
            None => break,
        }
    }
    chain.reverse();
    Ok(chain)
}

#[tauri::command]
async fn export_json(scans: State<'_, Scans>, scan_id: ScanId, path: String) -> Result<(), String> {
    let shared = scans.tree(scan_id)?;
    // Big trees take a while to write: keep it off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let tree = read(&shared);
        std::fs::File::create(&path).and_then(|f| tree.write_json(f)).map_err(|e| format!("{path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_drives() -> Vec<jard_scan::drives::Drive> {
    jard_scan::drives::list()
}

/// The folder given when the app was started, once: Explorer's "Scan with Jard" passes it this way.
#[tauri::command]
fn startup_folder(start: State<'_, StartupFolder>) -> Option<String> {
    start.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Opens Explorer with the item selected.
#[tauri::command]
fn reveal(scans: State<'_, Scans>, scan_id: ScanId, node_id: NodeId) -> Result<(), String> {
    let path = read(&scans.tree(scan_id)?).display_path(node_id).ok_or("no such node")?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

pub fn run_scheduled(folder: &str) -> i32 {
    scheduled::run(folder)
}

pub fn run() {
    tauri::Builder::default()
        // Must be first. "Scan with Jard" while the app is open: bring it forward and scan there.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(folder) = args.get(1) {
                let _ = app.emit("jard://open-folder", folder.clone());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Scans::default())
        .manage(StartupFolder(Mutex::new(std::env::args().nth(1))))
        .manage(clean::Moved::default())
        .manage(Arc::new(tools::Busy::default()))
        .setup(|app| {
            about::install_crash_log(app.handle());
            let dir = app.path().app_local_data_dir()?;
            let store = Arc::new(Store::open(dir)?);
            let purge = Arc::clone(&store);
            // Items past their 30 days go at startup, without holding up the window.
            std::thread::Builder::new().name("jard-purge".into()).spawn(move || {
                purge.purge_expired();
            })?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            scan_status,
            forget_scan,
            get_children,
            get_node,
            get_path,
            get_ancestors,
            export_json,
            list_drives,
            reveal,
            startup_folder,
            clean::preview_clean,
            clean::quarantine_nodes,
            clean::list_quarantine,
            clean::restore_item,
            clean::delete_item,
            clean::read_log,
            clean::cleanup_candidates,
            clean::find_duplicates,
            saved::saved_scans,
            saved::open_saved,
            saved::forget_saved,
            saved::scan_points,
            saved::compare_scans,
            saved::kinds_of,
            saved::search_scan,
            system::installed_programs,
            system::installed_drivers,
            system::disk_health,
            system::hardware_now,
            system::startup_programs,
            system::system_errors,
            system::open_ports,
            system::uninstall_program,
            system::disk_speed,
            system::export_csv,
            about::license_status,
            about::check_license_key,
            about::activate_file,
            about::deactivate,
            about::diagnostics_text,
            about::save_diagnostics,
            clean::data_folders,
            tools::set_startup,
            tools::secure_delete_file,
            tools::stress_cpu,
            tools::stress_stop,
            tools::open_memory_test,
            tools::flash_capacity,
            tools::flash_stop,
            tools::virustotal_check,
            tools::set_schedule,
            tools::get_schedule,
            tools::remove_schedule,
            tools::network_neighbors,
            tools::disk_partitions
        ])
        .run(tauri::generate_context!())
        .expect("error while running Jard");
}

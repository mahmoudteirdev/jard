import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type {
  Candidate, CleanPreview, Elevated, Integration, PlatformFacts, SimilarPhoto, TruthFacts, VolumeFacts, License, LicenseError, Done, Drive, DuplicateGroup, Engine, Failure, FolderChange, KindTotal, LogEntry, NodeDto,
  NodeOutcome, Progress, QuarantineItem, RestoreResult, SavedScan, ScanId, ScanPoint, SearchHit, Status,
} from "./types";

let pendingUpdate: Update | null = null;

export const tauriEngine: Engine = {
  demo: false,
  startScan: (root, opts, keep) => invoke("start_scan", { root, opts: opts ?? null, keep: keep ?? false }),
  cancelScan: (scanId) => invoke("cancel_scan", { scanId }),
  scanStatus: (scanId) => invoke<Status>("scan_status", { scanId }),
  forgetScan: (scanId) => invoke("forget_scan", { scanId }),
  getChildren: (scanId, nodeId, sort, limit, offset) =>
    invoke<NodeDto[]>("get_children", { scanId, nodeId, sort, limit: limit ?? null, offset: offset ?? null }),
  getNode: (scanId, nodeId) => invoke<NodeDto>("get_node", { scanId, nodeId }),
  getPath: (scanId, nodeId) => invoke<string>("get_path", { scanId, nodeId }),
  getAncestors: (scanId, nodeId) => invoke<NodeDto[]>("get_ancestors", { scanId, nodeId }),
  exportJson: (scanId, path) => invoke("export_json", { scanId, path }),
  listDrives: () => invoke<Drive[]>("list_drives"),
  reveal: (scanId, nodeId) => invoke("reveal", { scanId, nodeId }),
  previewClean: (scanId, nodeIds) => invoke<CleanPreview>("preview_clean", { scanId, nodeIds }),
  quarantineNodes: (scanId, nodeIds) => invoke<NodeOutcome[]>("quarantine_nodes", { scanId, nodeIds }),
  listQuarantine: () => invoke<QuarantineItem[]>("list_quarantine"),
  restoreItem: (id, onConflict) => invoke<RestoreResult>("restore_item", { id, onConflict }),
  deleteItem: (id) => invoke<Failure | null>("delete_item", { id }),
  readLog: (limit) => invoke<LogEntry[]>("read_log", { limit: limit ?? null }),
  cleanupCandidates: (scanId, kind, limit) => invoke<Candidate[]>("cleanup_candidates", { scanId, kind, limit: limit ?? null }),
  findDuplicates: (scanId, limit) => invoke<DuplicateGroup[]>("find_duplicates", { scanId, limit: limit ?? null }),
  findSimilarPhotos: (scanId) => invoke<SimilarPhoto[][]>("find_similar_photos", { scanId }),
  truthFacts: (scanId) => invoke<TruthFacts>("truth_facts", { scanId }),
  volumeFacts: () => invoke<VolumeFacts>("volume_facts"),
  elevatedQuarantine: (scanId, nodeIds) => invoke<Elevated<NodeOutcome[]>>("elevated_quarantine", { scanId, nodeIds }),
  elevatedRestore: (id, keepBoth) => invoke<Elevated<RestoreResult>>("elevated_restore", { id, keepBoth }),
  elevatedDelete: (id) => invoke<Elevated<Failure | null>>("elevated_delete", { id }),
  isAdmin: () => invoke<boolean>("is_admin"),
  relaunchAsAdmin: (folder) => invoke<boolean>("relaunch_as_admin", { folder: folder ?? null }),
  pauseScan: (scanId, paused) => invoke("pause_scan", { scanId, paused }),
  deniedFolders: (scanId, limit) => invoke<Candidate[]>("denied_folders", { scanId, limit: limit ?? null }),
  thirdPartyNotices: () => invoke<string>("third_party_notices"),
  openIssues: () => invoke("open_issues"),
  getIntegration: () => invoke<Integration>("get_integration"),
  setContextMenu: (enabled) => invoke("set_context_menu", { enabled }),
  setStartCheck: (enabled) => invoke("set_start_check", { enabled }),
  isPortable: () => invoke<boolean>("is_portable"),
  platformFacts: () => invoke<PlatformFacts>("platform_facts"),
  savedScans: () => invoke<SavedScan[]>("saved_scans"),
  openSaved: (key) => invoke<ScanId>("open_saved", { key }),
  forgetSaved: () => invoke("forget_saved"),
  scanPoints: (key) => invoke<ScanPoint[]>("scan_points", { key }),
  compareScans: (key, from, to) => invoke<FolderChange[]>("compare_scans", { key, from, to }),
  kindsOf: (scanId) => invoke<KindTotal[]>("kinds_of", { scanId }),
  searchScan: (scanId, query, limit) => invoke<SearchHit[]>("search_scan", { scanId, query, limit: limit ?? null }),
  installedPrograms: () => invoke("installed_programs"),
  installedDrivers: () => invoke("installed_drivers"),
  diskHealth: () => invoke("disk_health"),
  hardwareNow: () => invoke("hardware_now"),
  startupPrograms: () => invoke("startup_programs"),
  systemErrors: () => invoke("system_errors"),
  openPorts: () => invoke("open_ports"),
  uninstallProgram: (key) => invoke("uninstall_program", { key }),
  diskSpeed: () => invoke("disk_speed"),
  exportCsv: (scanId, path) => invoke("export_csv", { scanId, path }),
  appVersion: getVersion,
  checkUpdate: async () => {
    pendingUpdate = await check();
    return pendingUpdate ? { version: pendingUpdate.version, notes: pendingUpdate.body ?? null } : null;
  },
  installUpdate: async (onProgress) => {
    if (!pendingUpdate) throw new Error("no update");
    let total = 0;
    let got = 0;
    await pendingUpdate.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress" && total > 0) {
        got += e.data.chunkLength;
        onProgress(Math.min(100, Math.round((got / total) * 100)));
      }
    });
  },
  diagnosticsText: () => invoke("diagnostics_text"),
  saveDiagnostics: (path) => invoke("save_diagnostics", { path }),
  licenseStatus: () => invoke("license_status"),
  checkLicenseKey: (key) => invoke("check_license_key", { key }),
  pickLicenseFile: async () => {
    const picked = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }], title: "اختر ملف التفعيل" });
    return typeof picked === "string" ? picked : null;
  },
  activateFile: async (path) => {
    const r = await invoke<{ Ok: License } | { Err: LicenseError }>("activate_file", { path });
    return "Ok" in r ? { ok: true } : { ok: false, error: r.Err };
  },
  deactivate: () => invoke("deactivate"),
  onOpenFolder: (cb) => listen<string>("jard://open-folder", (e) => cb(e.payload)),
  dataFolders: (scanId) => invoke("data_folders", { scanId }),
  setStartup: (name, enabled) => invoke("set_startup", { name, enabled }),
  secureDeleteFile: (path) => invoke("secure_delete_file", { path }),
  stressCpu: (seconds) => invoke("stress_cpu", { seconds }),
  stressStop: () => invoke("stress_stop"),
  openMemoryTest: () => invoke("open_memory_test"),
  flashCapacity: (root) => invoke("flash_capacity", { root }),
  flashStop: () => invoke("flash_stop"),
  onFlashProgress: (cb) => listen<[string, number, number]>("flash://progress", (e) => cb(e.payload[0], e.payload[1], e.payload[2])),
  virustotalCheck: (path, apiKey) => invoke("virustotal_check", { path, apiKey }),
  setSchedule: (schedule) => invoke("set_schedule", { schedule }),
  getSchedule: () => invoke("get_schedule"),
  removeSchedule: () => invoke("remove_schedule"),
  networkNeighbors: () => invoke("network_neighbors"),
  diskPartitions: () => invoke("disk_partitions"),
  pickAnyFile: async () => {
    const picked = await open({ multiple: false, title: "اختر ملفاً" });
    return typeof picked === "string" ? picked : null;
  },
  scanDevBloat: (roots) => invoke("scan_dev_bloat", { roots }),
  scanGhostFiles: (roots, minDays, minSizeMb) => invoke("scan_ghost_files", { roots, minDays, minSizeMb }),
  quarantinePaths: (paths) => invoke("quarantine_paths", { paths }),
  parseNaturalQuery: (prompt) => invoke("parse_natural_query", { prompt }),
  searchNaturalQuery: (scanId, prompt) => invoke("search_natural_query", { scanId, prompt }),
  predictStorageDepletion: (driveRoot) => invoke("predict_storage_depletion", { driveRoot }),
  runAgentCommand: (command) => invoke("run_agent_command", { command }),
  writeAgentFile: (path, content) => invoke("write_agent_file", { path, content }),
  readAgentFile: (path) => invoke("read_agent_file", { path }),
  listAgentDir: (path) => invoke("list_agent_dir", { path }),
  moveAgentFile: (from, to) => invoke("move_agent_file", { from, to }),
  queryGeminiApi: (apiKey, payloadJson) => invoke("query_gemini_api", { apiKey, payloadJson }),
  startupFolder: () => invoke<string | null>("startup_folder"),
  pickFolder: async () => {
    const picked = await open({ directory: true, multiple: false, title: "اختر مجلداً لفحصه" });
    return typeof picked === "string" ? picked : null;
  },
  pickSavePath: async (defaultPath, extension = "json") =>
    (await save({ defaultPath, filters: [{ name: extension.toUpperCase(), extensions: [extension] }], title: "حفظ نتيجة الفحص" })) ?? null,
  onProgress: (scanId, cb) => listen<Progress>(`scan://progress/${scanId}`, (e) => cb(e.payload)),
  onDone: (scanId, cb) => listen<Done>(`scan://done/${scanId}`, (e) => cb(e.payload)),
};

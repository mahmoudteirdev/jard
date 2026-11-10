// Types for the Tauri contract in design/HANDOFF.md §5, as implemented in src-tauri/src/lib.rs.

export type ScanId = number;
export type NodeId = number;
export type SortKey = "on_disk" | "apparent" | "name";

export interface ScanOptions {
  excluded?: string[];
  threads?: number;
  maxDepth?: number;
  dedupHardlinks?: boolean;
  fastMft?: boolean;
}

export interface NodeDto {
  id: NodeId;
  name: string;
  parent: NodeId | null;
  isDir: boolean;
  childCount: number;
  ownApparent: number;
  ownOnDisk: number;
  ownFiles: number;
  apparent: number;
  onDisk: number;
  files: number;
  dirs: number;
  cloudBytes: number;
  dedupBytes: number;
  denied: number;
  flags: number;
  /** Last write time of a file, seconds since 1970. 0 for folders. */
  modified: number;
  /** Why this may not go to quarantine, when so. */
  protected: ProtectReason | null;
}

/** scan://progress/{scanId}. Approximate until done. */
export interface Progress {
  files: number;
  dirs: number;
  bytes: number;
  denied: number;
  current: string;
  done: boolean;
  cancelled: boolean;
  paused: boolean;
}

/** scan://done/{scanId} */
export interface Done {
  rootId: NodeId;
  elapsedMs: number;
  partial: boolean;
  error: string | null;
  /** The folder is gone: its drive was unplugged or it was moved during the scan. */
  rootGone?: boolean;
}

export interface Status {
  progress: Progress | null;
  done: Done | null;
}

export type DriveKind = "fixed" | "removable" | "network" | "optical" | "ram" | "unknown";

export interface Drive {
  root: string;
  label: string;
  fs: string;
  kind: DriveKind;
  total: number;
  free: number;
  ready: boolean;
}

export type ProtectReason =
  | "system" | "system_file" | "system_area" | "container" | "user_folder" | "contains_protected" | "jard";

export type Failure =
  | { kind: "protected"; reason: ProtectReason }
  | { kind: "in_use" | "denied" | "missing" | "conflict" | "no_quarantine" }
  | { kind: "other"; message: string };

export interface QuarantineItem {
  id: string;
  original: string;
  isDir: boolean;
  apparent: number;
  onDisk: number;
  files: number;
  movedAt: number;
  expiresAt: number;
}

export interface NodeOutcome {
  nodeId: NodeId;
  path: string;
  item: QuarantineItem | null;
  failure: Failure | null;
}

export type EffectKind = "synced" | "browser_cache" | "package_cache" | "installed_program";

export interface CleanPreview {
  movable: string[];
  refused: { path: string; reason: ProtectReason }[];
  apparent: number;
  onDisk: number;
  files: number;
  effects: { kind: EffectKind; paths: string[] }[];
}

export interface RestoreResult {
  path: string | null;
  failure: Failure | null;
}

export type LogKind = "quarantined" | "restored" | "deleted" | "expired" | "scanned" | "secure_deleted" | "rule_failed";

export interface LogEntry {
  at: number;
  kind: LogKind;
  count: number;
  bytes: number;
}

export type CandidateKind = "large" | "temp" | "old";

export interface Candidate {
  node: NodeDto;
  path: string;
  /** safe, redownload, duplicate, or kind_* */
  note: string;
}

export interface DuplicateGroup {
  size: number;
  reclaimable: number;
  keep: string;
  copies: Candidate[];
}

export interface SavedScan {
  key: string;
  root: string;
  savedAt: number;
  onDisk: number;
  apparent: number;
  files: number;
  dirs: number;
  partial: boolean;
}

export interface ScanPoint {
  at: number;
  onDisk: number;
  files: number;
  partial: boolean;
}

export interface FolderChange {
  path: string;
  delta: number;
  what: "grew" | "shrank" | "new" | "gone";
}

export type FileKind =
  | "video" | "image" | "audio" | "document" | "archive" | "disk_image" | "virtual_machine" | "installer" | "program" | "other";

export interface KindTotal {
  kind: FileKind;
  onDisk: number;
  files: number;
}

export interface TruthFacts {
  apparent: number;
  onDisk: number;
  cloudBytes: number;
  cloudFiles: number;
  hardlinkBytes: number;
  hardlinkFiles: number;
  compressedApparent: number;
  compressedOnDisk: number;
  compressedFiles: number;
  sparseApparent: number;
  sparseOnDisk: number;
  sparseFiles: number;
  slackBytes: number;
  slackFiles: number;
  encryptedFiles: number;
  links: number;
  denied: number;
  partial: boolean;
  example: number | null;
}

export interface VolumeFacts {
  /** False: reading restore points needs administrator rights. */
  known: boolean;
  shadow: { root: string | null; used: number }[];
  locked: string[];
}

export interface SimilarPhoto {
  node: NodeDto;
  path: string;
  width: number;
  height: number;
  distance: number;
  thumbnail: string;
}

/** The answer after asking Windows for administrator rights. */
export interface Elevated<T> {
  declined: boolean;
  result: T | null;
}

export interface PlatformFacts {
  os: "windows" | "macos" | "linux" | string;
  /** macOS: local Time Machine snapshots. Null: couldn't read them. */
  snapshots: number | null;
}

export interface Integration {
  contextMenu: boolean;
  startCheck: boolean;
}

export interface SearchQuery {
  text?: string;
  kind?: FileKind;
  minSize?: number;
  olderThan?: number;
  noExtension?: boolean;
  emptyFolders?: boolean;
}

export interface SearchHit {
  node: NodeDto;
  path: string;
  kind: FileKind;
}

export interface ParsedAiQuery {
  rawPrompt: string;
  recognizedIntent: string;
  query: SearchQuery;
  targetFolder: string | null;
  explanationAr: string;
  explanationEn: string;
  limit: number;
}

export interface AiSearchResponse {
  parsed: ParsedAiQuery;
  hits: SearchHit[];
  totalMatchedBytes: number;
}

export type DepletionStatus = "stable" | "gradual_burn" | "critical_burn" | "freeing_space" | "insufficient_data";

export interface DepletionForecast {
  currentFreeBytes: number;
  currentTotalBytes: number;
  dailyBurnBytes: number;
  estimatedDaysRemaining: number | null;
  exhaustionDateIso: string | null;
  status: DepletionStatus;
  recommendationAr: string;
  recommendationEn: string;
  confidenceScore: number;
  burnVelocityMbPerDay: number;
}

export interface Program {
  key: string;
  name: string;
  version: string | null;
  publisher: string | null;
  sizeKb: number | null;
  installDate: string | null;
}

export interface Driver {
  name: string;
  cls: string;
  version: string;
  date: string | null;
  maker: string | null;
}

export interface Disk {
  name: string;
  media: string;
  bus: string;
  health: string;
  size: number;
  temperature: number | null;
  hours: number | null;
  wear: number | null;
  readErrors: number | null;
  writeErrors: number | null;
}

export interface Hardware {
  cpuName: string;
  cpuLoad: number | null;
  memTotal: number;
  memFree: number;
  osName: string;
  bootedAt: string;
  batteryCharge: number | null;
  batteryFull: number | null;
  batteryDesign: number | null;
}

export interface StartupItem {
  name: string;
  where: string;
  user: string | null;
  canToggle: boolean;
  disabled: boolean;
}

export interface SystemError {
  provider: string;
  id: number;
  level: number;
  at: string;
  message: string | null;
}

export interface OpenPort {
  port: number;
  address: string;
  process: string | null;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export type LicenseError = "unreadable" | "bad_signature" | "other_device";

export interface License {
  device: string;
  key: string;
  name: string;
  issued: number;
}

export interface LicenseStatus {
  device: string;
  license: License | null;
  problem: LicenseError | null;
}

export type KeyCheck =
  | { kind: "ok"; key: string }
  | { kind: "short"; missing: number }
  | { kind: "long"; extra: number }
  | { kind: "bad_character" };

export interface CapacityResult {
  written: number;
  verified: number;
  ok: boolean;
  cancelled: boolean;
}

export interface VtResult {
  sha256: string;
  known: boolean;
  malicious: number;
  suspicious: number;
  harmless: number;
}

export interface NetworkDevice {
  ip: string;
  mac: string;
  state: string;
}

export interface Partition {
  disk: number;
  number: number;
  letter: string;
  size: number;
  kind: string;
  fs: string;
}

export interface Schedule {
  root: string;
  frequency: string;
  day: string;
  time: string;
  notifyFull: boolean;
  ruleTemp: boolean;
  ruleBrowserCache: boolean;
  ruleOldDownloads: boolean;
}

export interface DevArtifact {
  name: string;
  path: string;
  apparent: number;
  onDisk: number;
  files: number;
  cleanCmd: string;
  reinstallCmd: string;
}

export interface DevProject {
  path: string;
  name: string;
  kind: string;
  lastModified: number;
  daysInactive: number;
  status: "Active" | "Stale" | "Abandoned" | string;
  artifacts: DevArtifact[];
  totalApparent: number;
  totalOnDisk: number;
}

export interface GhostFile {
  path: string;
  name: string;
  size: number;
  created: number;
  lastAccessed: number;
  daysStale: number;
  category: "Installer" | "Archive" | "DiskImage" | "Document" | "Media" | "Other" | string;
  reason: string;
}

export interface BatchCleanResult {
  moved: string[];
  failed: [string, string][];
  bytesReclaimed: number;
}

export type Unlisten = () => void;

export interface Engine {
  /** True when running against fake data in a plain browser. */
  readonly demo: boolean;
  /** `keep` saves the result to disk for next time and for comparing. */
  startScan(root: string, opts?: ScanOptions, keep?: boolean): Promise<ScanId>;
  cancelScan(scanId: ScanId): Promise<void>;
  scanStatus(scanId: ScanId): Promise<Status>;
  forgetScan(scanId: ScanId): Promise<void>;
  getChildren(scanId: ScanId, nodeId: NodeId, sort: SortKey, limit?: number, offset?: number): Promise<NodeDto[]>;
  getNode(scanId: ScanId, nodeId: NodeId): Promise<NodeDto>;
  getPath(scanId: ScanId, nodeId: NodeId): Promise<string>;
  getAncestors(scanId: ScanId, nodeId: NodeId): Promise<NodeDto[]>;
  exportJson(scanId: ScanId, path: string): Promise<void>;
  listDrives(): Promise<Drive[]>;
  reveal(scanId: ScanId, nodeId: NodeId): Promise<void>;
  previewClean(scanId: ScanId, nodeIds: NodeId[]): Promise<CleanPreview>;
  quarantineNodes(scanId: ScanId, nodeIds: NodeId[]): Promise<NodeOutcome[]>;
  listQuarantine(): Promise<QuarantineItem[]>;
  restoreItem(id: string, onConflict: "fail" | "keep_both"): Promise<RestoreResult>;
  /** For good: cannot be undone. Resolves the failure, or null. */
  deleteItem(id: string): Promise<Failure | null>;
  readLog(limit?: number): Promise<LogEntry[]>;
  cleanupCandidates(scanId: ScanId, kind: CandidateKind, limit?: number): Promise<Candidate[]>;
  findDuplicates(scanId: ScanId, limit?: number): Promise<DuplicateGroup[]>;
  findSimilarPhotos(scanId: ScanId): Promise<SimilarPhoto[][]>;
  truthFacts(scanId: ScanId): Promise<TruthFacts>;
  volumeFacts(): Promise<VolumeFacts>;
  /** Asks Windows for rights for this one job. */
  elevatedQuarantine(scanId: ScanId, nodeIds: number[]): Promise<Elevated<NodeOutcome[]>>;
  elevatedRestore(id: string, keepBoth: boolean): Promise<Elevated<RestoreResult>>;
  elevatedDelete(id: string): Promise<Elevated<Failure | null>>;
  isAdmin(): Promise<boolean>;
  /** Restarts the whole app with rights, optionally scanning a folder. Resolves false if the person says no. */
  relaunchAsAdmin(folder?: string): Promise<boolean>;
  pauseScan(scanId: ScanId, paused: boolean): Promise<void>;
  deniedFolders(scanId: ScanId, limit?: number): Promise<Candidate[]>;
  thirdPartyNotices(): Promise<string>;
  /** Opens the issues page in the person's browser. */
  openIssues(): Promise<void>;
  getIntegration(): Promise<Integration>;
  setContextMenu(enabled: boolean): Promise<void>;
  setStartCheck(enabled: boolean): Promise<void>;
  isPortable(): Promise<boolean>;
  platformFacts(): Promise<PlatformFacts>;
  savedScans(): Promise<SavedScan[]>;
  openSaved(key: string): Promise<ScanId>;
  forgetSaved(): Promise<void>;
  scanPoints(key: string): Promise<ScanPoint[]>;
  compareScans(key: string, from: number, to: number): Promise<FolderChange[]>;
  kindsOf(scanId: ScanId): Promise<KindTotal[]>;
  searchScan(scanId: ScanId, query: SearchQuery, limit?: number): Promise<SearchHit[]>;
  installedPrograms(): Promise<Program[]>;
  installedDrivers(): Promise<Driver[]>;
  diskHealth(): Promise<Disk[]>;
  hardwareNow(): Promise<Hardware>;
  startupPrograms(): Promise<StartupItem[]>;
  systemErrors(): Promise<SystemError[]>;
  openPorts(): Promise<OpenPort[]>;
  /** Starts the program's own uninstaller. */
  uninstallProgram(key: string): Promise<void>;
  diskSpeed(): Promise<{ writeMbS: number; readMbS: number; sizeMb: number }>;
  exportCsv(scanId: ScanId, path: string): Promise<number>;
  appVersion(): Promise<string>;
  /** Reads the version file. Resolves null when this is the newest. */
  checkUpdate(): Promise<UpdateInfo | null>;
  /** Downloads, checks the signature, installs and restarts. Progress is 0 to 100. */
  installUpdate(onProgress: (percent: number) => void): Promise<void>;
  diagnosticsText(): Promise<string>;
  saveDiagnostics(path: string): Promise<void>;
  licenseStatus(): Promise<LicenseStatus>;
  checkLicenseKey(key: string): Promise<KeyCheck>;
  pickLicenseFile(): Promise<string | null>;
  activateFile(path: string): Promise<{ ok: true } | { ok: false; error: LicenseError }>;
  deactivate(): Promise<void>;
  /** Another copy was started with a folder ("Scan with Jard" while open). */
  onOpenFolder(cb: (folder: string) => void): Promise<Unlisten>;
  dataFolders(scanId: ScanId): Promise<Candidate[]>;
  setStartup(name: string, enabled: boolean): Promise<void>;
  secureDeleteFile(path: string): Promise<{ Ok: number; Err?: undefined } | { Ok?: undefined; Err: Failure }>;
  stressCpu(seconds: number): Promise<{ seconds: number; threads: number; score: number; stopped: boolean }>;
  stressStop(): Promise<void>;
  openMemoryTest(): Promise<void>;
  flashCapacity(root: string): Promise<CapacityResult>;
  flashStop(): Promise<void>;
  onFlashProgress(cb: (stage: string, done: number, total: number) => void): Promise<Unlisten>;
  virustotalCheck(path: string, apiKey: string): Promise<VtResult>;
  setSchedule(schedule: Schedule): Promise<void>;
  getSchedule(): Promise<Schedule | null>;
  removeSchedule(): Promise<void>;
  networkNeighbors(): Promise<NetworkDevice[]>;
  diskPartitions(): Promise<Partition[]>;
  pickAnyFile(): Promise<string | null>;
  scanDevBloat(roots?: string[]): Promise<DevProject[]>;
  scanGhostFiles(roots?: string[], minDays?: number, minSizeMb?: number): Promise<GhostFile[]>;
  quarantinePaths(paths: string[]): Promise<BatchCleanResult>;
  parseNaturalQuery(prompt: string): Promise<ParsedAiQuery>;
  searchNaturalQuery(scanId: ScanId, prompt: string): Promise<AiSearchResponse>;
  predictStorageDepletion(driveRoot?: string): Promise<DepletionForecast>;
  runAgentCommand(command: string): Promise<AgentCommandOutput>;
  writeAgentFile(path: string, content: string): Promise<void>;
  readAgentFile(path: string): Promise<string>;
  listAgentDir(path: string): Promise<AgentDirEntry[]>;
  moveAgentFile(from: string, to: string): Promise<void>;
  /** The folder the app was started with, once. */
  startupFolder(): Promise<string | null>;
  /** Folder picker. Resolves null if the person cancels. */
  pickFolder(): Promise<string | null>;
  /** Save dialog. Resolves null if the person cancels. */
  pickSavePath(defaultName: string, extension?: "json" | "csv" | "txt"): Promise<string | null>;
  onProgress(scanId: ScanId, cb: (p: Progress) => void): Promise<Unlisten>;
  onDone(scanId: ScanId, cb: (d: Done) => void): Promise<Unlisten>;
}

export interface AgentCommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentDirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

/** Node.flags bits. Same values as jard_scan::flags. */
export const Flag = {
  CLOUD: 1,
  COMPRESSED: 2,
  SPARSE: 4,
  REPARSE: 8,
  ENCRYPTED: 16,
  HARDLINK: 32,
  DENIED: 64,
  PARTIAL: 128,
} as const;

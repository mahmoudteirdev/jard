// Types for the Tauri contract in design/HANDOFF.md §5, as implemented in src-tauri/src/lib.rs.

export type ScanId = number;
export type NodeId = number;
export type SortKey = "on_disk" | "apparent" | "name";

export interface ScanOptions {
  threads?: number;
  maxDepth?: number;
  dedupHardlinks?: boolean;
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
}

/** scan://done/{scanId} */
export interface Done {
  rootId: NodeId;
  elapsedMs: number;
  partial: boolean;
  error: string | null;
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

export type Unlisten = () => void;

export interface Engine {
  /** True when running against fake data in a plain browser. */
  readonly demo: boolean;
  startScan(root: string, opts?: ScanOptions): Promise<ScanId>;
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
  /** Folder picker. Resolves null if the person cancels. */
  pickFolder(): Promise<string | null>;
  /** Save dialog. Resolves null if the person cancels. */
  pickSavePath(defaultName: string): Promise<string | null>;
  onProgress(scanId: ScanId, cb: (p: Progress) => void): Promise<Unlisten>;
  onDone(scanId: ScanId, cb: (d: Done) => void): Promise<Unlisten>;
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

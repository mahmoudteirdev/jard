// Fake engine for working on the UI in a plain browser (`pnpm dev`). Never used inside Tauri.
// Builds a made-up tree with the same shape and rules as jard-scan (child id > parent id,
// rolled-up totals, flags), and "scans" it over a few seconds.

import {
  Flag, type Done, type Drive, type Engine, type LogEntry, type NodeDto, type Progress,
  type QuarantineItem, type SortKey,
} from "./types";

interface FakeNode {
  id: number;
  name: string;
  parent: number | null;
  isDir: boolean;
  children: number[];
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

const GB = 1e9;

// Small deterministic PRNG so the demo looks the same on every reload.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

type Spec = [name: string, size: number, kids?: Spec[] | number, flags?: number];

const SPEC: Spec[] = [
  ["Users", 0, [["Me", 0, [
    ["Videos", 0, [["2024", 31 * GB, 40], ["2023", 22 * GB, 60], ["raw", 19 * GB, 25]]],
    ["Downloads", 0, [["iso", 18 * GB, 6], ["setups", 13 * GB, 140], ["misc", 10 * GB, 900]]],
    ["AppData", 38 * GB, 1200, Flag.COMPRESSED],
    ["OneDrive", 17 * GB, 300, Flag.CLOUD],
    ["Documents", 4 * GB, 260],
    ["Desktop", 2.5 * GB, 80],
  ]]]],
  ["Program Files", 0, [["Adobe", 22 * GB, 400], ["Android Studio", 15 * GB, 1200], ["Common Files", 6 * GB, 300], ["Microsoft Office", 4 * GB, 500]]],
  ["Games", 61 * GB, 220],
  ["Windows", 42 * GB, 1500, Flag.HARDLINK],
  ["ProgramData", 18 * GB, 700],
  ["System Volume Information", 0, 0, Flag.DENIED],
  ["$Recycle.Bin", 3 * GB, 30],
  ["pagefile.sys", 16 * GB],
  ["hiberfil.sys", 6.4 * GB],
];

const ROOT = "C:\\";

function buildTree(): FakeNode[] {
  const rand = rng(7);
  const nodes: FakeNode[] = [];
  const add = (name: string, parent: number | null, isDir: boolean, flags = 0): FakeNode => {
    const n: FakeNode = {
      id: nodes.length, name, parent, isDir, children: [], ownApparent: 0, ownOnDisk: 0, ownFiles: 0,
      apparent: 0, onDisk: 0, files: 0, dirs: 0, cloudBytes: 0, dedupBytes: 0, denied: 0, flags,
    };
    nodes.push(n);
    if (parent !== null) nodes[parent]!.children.push(n.id);
    return n;
  };
  const file = (parent: FakeNode, name: string, size: number, flags: number) => {
    const f = add(name, parent.id, false, flags);
    const cloud = flags & Flag.CLOUD && rand() < 0.7;
    const onDisk = cloud ? 0 : flags & Flag.COMPRESSED ? Math.round(size * 0.6) : Math.ceil(size / 4096) * 4096;
    f.ownApparent = f.apparent = size;
    f.ownOnDisk = f.onDisk = onDisk;
    f.ownFiles = f.files = 1;
    if (cloud) f.cloudBytes = size;
    if (flags & Flag.HARDLINK && rand() < 0.3) {
      f.dedupBytes = onDisk;
      f.onDisk = f.ownOnDisk = 0;
    }
    parent.ownApparent += f.apparent;
    parent.ownOnDisk += f.onDisk;
    parent.ownFiles += 1;
    parent.cloudBytes += f.cloudBytes;
    parent.dedupBytes += f.dedupBytes;
  };
  const exts = [".mp4", ".dll", ".pak", ".bin", ".log", ".jpg", ".zip", ".dat"];
  const fill = (dir: FakeNode, total: number, count: number, flags: number) => {
    // a few big files, many small ones
    let left = total;
    for (let i = 0; i < count && left > 0; i++) {
      const share = i === count - 1 ? left : Math.min(left, left * (i < 5 ? 0.25 + rand() * 0.2 : rand() * 0.02));
      const size = Math.max(1, Math.round(share));
      left -= size;
      file(dir, `file-${String(i + 1).padStart(4, "0")}${exts[i % exts.length]}`, size, flags & ~Flag.DENIED);
    }
  };
  const walk = (specs: Spec[], parent: FakeNode, inherited: number) => {
    for (const [name, size, kids, flags = 0] of specs) {
      const f = flags | (inherited & (Flag.CLOUD | Flag.COMPRESSED | Flag.HARDLINK));
      if (kids === undefined) {
        file(parent, name, size, f);
        continue;
      }
      const dir = add(name, parent.id, true, f & (Flag.CLOUD | Flag.COMPRESSED | Flag.DENIED));
      if (f & Flag.DENIED) dir.denied = 1;
      if (Array.isArray(kids)) walk(kids, dir, f);
      else if (kids > 0) {
        // split into a few subfolders, then files
        const subs = Math.min(4, Math.floor(kids / 50));
        for (let s = 0; s < subs; s++) {
          const sub = add(`part-${s + 1}`, dir.id, true, dir.flags);
          fill(sub, size * 0.15, Math.floor(kids / (subs + 2)), f);
        }
        fill(dir, size * (1 - 0.15 * subs), Math.max(1, kids - subs * Math.floor(kids / (subs + 2))), f);
      }
    }
  };
  const root = add(ROOT, null, true);
  walk(SPEC, root, 0);
  // roll up, last to first (child id > parent id)
  for (const n of nodes) {
    if (n.isDir) {
      n.apparent = n.ownApparent;
      n.onDisk = n.ownOnDisk;
      n.files = n.ownFiles;
    }
  }
  for (let i = nodes.length - 1; i > 0; i--) {
    const n = nodes[i]!;
    if (!n.isDir || n.parent === null) continue;
    const p = nodes[n.parent]!;
    p.apparent += n.apparent;
    p.onDisk += n.onDisk;
    p.files += n.files;
    p.dirs += 1 + n.dirs;
    p.cloudBytes += n.cloudBytes;
    p.dedupBytes += n.dedupBytes;
    p.denied += n.denied;
  }
  return nodes;
}

const PROTECTED = new Set(["Windows", "System Volume Information", "$Recycle.Bin", "pagefile.sys", "hiberfil.sys"]);

const dto = (n: FakeNode): NodeDto => {
  const { children, ...rest } = n;
  const reason = PROTECTED.has(n.name) ? "system" : n.parent === null ? "container" : null;
  return { ...rest, childCount: children.length, modified: 1_600_000_000, protected: reason };
};

/** Same arithmetic as Tree::detach and Tree::reattach. */
function shift(nodes: FakeNode[], n: FakeNode, attach: boolean) {
  const sign = attach ? 1 : -1;
  let p = n.parent === null ? undefined : nodes[n.parent];
  if (!p) return;
  if (attach) p.children.push(n.id);
  else p.children = p.children.filter((c) => c !== n.id);
  if (!n.isDir) {
    p.ownApparent += sign * n.apparent;
    p.ownOnDisk += sign * n.onDisk;
    p.ownFiles += sign;
  }
  while (p) {
    p.apparent += sign * n.apparent;
    p.onDisk += sign * n.onDisk;
    p.files += sign * n.files;
    p.dirs += sign * (n.dirs + (n.isDir ? 1 : 0));
    p.cloudBytes += sign * n.cloudBytes;
    p.dedupBytes += sign * n.dedupBytes;
    p = p.parent === null ? undefined : nodes[p.parent];
  }
}

const fakeQuarantine = new Map<string, { item: QuarantineItem; nodes: FakeNode[]; node: FakeNode }>();
const fakeLog: LogEntry[] = [];
let nextItem = 0;
const seconds = () => Math.floor(Date.now() / 1000);

const DRIVES: Drive[] = [
  { root: "C:\\", label: "النظام", fs: "NTFS", kind: "fixed", total: 476 * GB, free: 85 * GB, ready: true },
  { root: "D:\\", label: "البيانات", fs: "NTFS", kind: "fixed", total: 931 * GB, free: 291 * GB, ready: true },
  { root: "E:\\", label: "USB", fs: "exFAT", kind: "removable", total: 58 * GB, free: 46 * GB, ready: true },
];

interface FakeScan {
  root: string;
  nodes: FakeNode[];
  started: number;
  progress: Progress;
  done: Done | null;
  progressCbs: Set<(p: Progress) => void>;
  doneCbs: Set<(d: Done) => void>;
  timer: ReturnType<typeof setInterval>;
}

const DURATION_MS = 3500;
const scans = new Map<number, FakeScan>();
let nextId = 0;

function finish(s: FakeScan, cancelled: boolean) {
  clearInterval(s.timer);
  s.progress = { ...s.progress, done: true, cancelled };
  if (!cancelled) {
    const r = s.nodes[0]!;
    s.progress = { ...s.progress, files: r.files, dirs: r.dirs + 1, bytes: r.onDisk, denied: r.denied };
  }
  s.done = { rootId: 0, elapsedMs: Date.now() - s.started, partial: cancelled, error: null };
  if (cancelled) s.nodes[0]!.flags |= Flag.PARTIAL;
  s.progressCbs.forEach((cb) => cb(s.progress));
  s.doneCbs.forEach((cb) => cb(s.done!));
}

function get(scanId: number): FakeScan {
  const s = scans.get(scanId);
  if (!s) throw new Error(`no scan ${scanId}`);
  return s;
}

function done(scanId: number): FakeScan {
  const s = get(scanId);
  if (!s.done) throw new Error("scan still running");
  return s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockEngine: Engine = {
  demo: true,
  async startScan(root) {
    const id = ++nextId;
    const nodes = buildTree();
    nodes[0]!.name = root;
    const r = nodes[0]!;
    const s: FakeScan = {
      root, nodes, started: Date.now(),
      progress: { files: 0, dirs: 0, bytes: 0, denied: 0, current: root, done: false, cancelled: false },
      done: null, progressCbs: new Set(), doneCbs: new Set(),
      timer: setInterval(() => {
        const t = Math.min(1, (Date.now() - s.started) / DURATION_MS);
        const sample = nodes[Math.floor(t * (nodes.length - 1))]!;
        let p = sample;
        const parts: string[] = [];
        while (p.parent !== null) {
          if (p.isDir) parts.unshift(p.name);
          p = nodes[p.parent]!;
        }
        s.progress = {
          files: Math.round(r.files * t), dirs: Math.round(r.dirs * t), bytes: Math.round(r.onDisk * t * t),
          denied: t > 0.6 ? r.denied : 0, current: root + parts.join("\\"), done: false, cancelled: false,
        };
        s.progressCbs.forEach((cb) => cb(s.progress));
        if (t >= 1) finish(s, false);
      }, 100),
    };
    scans.set(id, s);
    return id;
  },
  async cancelScan(scanId) {
    const s = get(scanId);
    if (!s.done) finish(s, true);
  },
  async scanStatus(scanId) {
    const s = get(scanId);
    return s.done ? { progress: null, done: s.done } : { progress: s.progress, done: null };
  },
  async forgetScan(scanId) {
    const s = scans.get(scanId);
    if (s) clearInterval(s.timer);
    scans.delete(scanId);
  },
  async getChildren(scanId, nodeId, sort: SortKey, limit, offset = 0) {
    const { nodes } = done(scanId);
    const node = nodes[nodeId];
    if (!node) throw new Error("no such node");
    const kids = node.children.map((c) => nodes[c]!);
    const byName = (a: FakeNode, b: FakeNode) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    kids.sort(
      sort === "name" ? byName
      : sort === "apparent" ? (a, b) => b.apparent - a.apparent || byName(a, b)
      : (a, b) => b.onDisk - a.onDisk || byName(a, b),
    );
    await sleep(20);
    return kids.slice(offset, limit === undefined ? undefined : offset + limit).map(dto);
  },
  async getNode(scanId, nodeId) {
    const n = done(scanId).nodes[nodeId];
    if (!n) throw new Error("no such node");
    return dto(n);
  },
  async getPath(scanId, nodeId) {
    const { nodes, root } = done(scanId);
    const parts: string[] = [];
    let n = nodes[nodeId];
    while (n && n.parent !== null) {
      parts.unshift(n.name);
      n = nodes[n.parent];
    }
    return root + parts.join("\\");
  },
  async getAncestors(scanId, nodeId) {
    const { nodes } = done(scanId);
    const chain: NodeDto[] = [];
    let n = nodes[nodeId];
    while (n) {
      chain.unshift(dto(n));
      n = n.parent === null ? undefined : nodes[n.parent];
    }
    return chain;
  },
  async exportJson() {
    throw new Error("التصدير يعمل في التطبيق فقط، لا في وضع العرض");
  },
  async listDrives() {
    return DRIVES;
  },
  async reveal() {
    throw new Error("فتح المستكشف يعمل في التطبيق فقط، لا في وضع العرض");
  },
  async findSimilarPhotos() {
    return [];
  },
  async truthFacts() {
    const r = buildTree()[0]!;
    return {
      apparent: r.apparent, onDisk: r.onDisk, cloudBytes: r.cloudBytes, cloudFiles: 12, hardlinkBytes: r.dedupBytes, hardlinkFiles: 4,
      compressedApparent: 0, compressedOnDisk: 0, compressedFiles: 0, sparseApparent: 0, sparseOnDisk: 0, sparseFiles: 0,
      slackBytes: 0, slackFiles: 0, encryptedFiles: 0, links: 0, denied: 0, partial: false, example: null,
    };
  },
  async volumeFacts() {
    return { known: false, shadow: [], locked: [] };
  },
  async elevatedQuarantine() {
    return { declined: true, result: null };
  },
  async elevatedRestore() {
    return { declined: true, result: null };
  },
  async elevatedDelete() {
    return { declined: true, result: null };
  },
  async isAdmin() {
    return false;
  },
  async relaunchAsAdmin() {
    return false;
  },
  async getIntegration() {
    return { contextMenu: false, startCheck: false };
  },
  async setContextMenu() {},
  async setStartCheck() {},
  async isPortable() {
    return false;
  },
  async platformFacts() {
    return { os: "windows", snapshots: null };
  },
  async previewClean(scanId, nodeIds) {
    const { nodes } = done(scanId);
    const list = nodeIds.map((i) => nodes[i]!);
    const ok = list.filter((n) => !dto(n).protected);
    return {
      movable: ok.map((n) => n.name),
      refused: list.filter((n) => dto(n).protected).map((n) => ({ path: n.name, reason: dto(n).protected! })),
      apparent: ok.reduce((s, n) => s + n.apparent, 0),
      onDisk: ok.reduce((s, n) => s + n.onDisk, 0),
      files: ok.reduce((s, n) => s + n.files, 0),
      effects: ok.some((n) => n.flags & Flag.CLOUD) ? [{ kind: "synced", paths: ok.filter((n) => n.flags & Flag.CLOUD).map((n) => n.name) }] : [],
    };
  },
  async quarantineNodes(scanId, nodeIds) {
    const { nodes } = done(scanId);
    return nodeIds.map((nodeId) => {
      const n = nodes[nodeId]!;
      const reason = dto(n).protected;
      if (reason) return { nodeId, path: n.name, item: null, failure: { kind: "protected" as const, reason } };
      if (n.name === "Desktop") return { nodeId, path: n.name, item: null, failure: { kind: "in_use" as const } };
      const at = seconds();
      const item: QuarantineItem = {
        id: String(++nextItem), original: n.name, isDir: n.isDir, apparent: n.apparent, onDisk: n.onDisk,
        files: n.files, movedAt: at, expiresAt: at + 30 * 86400,
      };
      shift(nodes, n, false);
      fakeQuarantine.set(item.id, { item, nodes, node: n });
      fakeLog.unshift({ at, kind: "quarantined", count: 1, bytes: n.onDisk });
      return { nodeId, path: n.name, item, failure: null };
    });
  },
  async listQuarantine() {
    return [...fakeQuarantine.values()].map((q) => q.item);
  },
  async restoreItem(id) {
    const q = fakeQuarantine.get(id);
    if (!q) return { path: null, failure: { kind: "missing" } };
    shift(q.nodes, q.node, true);
    fakeQuarantine.delete(id);
    fakeLog.unshift({ at: seconds(), kind: "restored", count: 1, bytes: q.item.onDisk });
    return { path: q.item.original, failure: null };
  },
  async deleteItem(id) {
    const q = fakeQuarantine.get(id);
    if (!q) return { kind: "missing" };
    fakeQuarantine.delete(id);
    fakeLog.unshift({ at: seconds(), kind: "deleted", count: 1, bytes: q.item.onDisk });
    return null;
  },
  async readLog(limit = 50) {
    return fakeLog.slice(0, limit);
  },
  async cleanupCandidates(scanId, kind) {
    const { nodes } = done(scanId);
    const list = kind === "temp"
      ? nodes.filter((n) => n.name === "AppData" || n.name === "part-1")
      : nodes.filter((n) => !n.isDir && n.onDisk > (kind === "large" ? 1e9 : 5e8) && !dto(n).protected);
    return list.slice(0, 40).map((n) => ({ node: dto(n), path: n.name, note: kind === "temp" ? "safe" : "kind_other" }));
  },
  async findDuplicates() {
    return [];
  },
  async savedScans() {
    return [];
  },
  async openSaved() {
    throw new Error("النتائج المحفوظة تعمل في التطبيق فقط");
  },
  async forgetSaved() {},
  async scanPoints() {
    return [];
  },
  async compareScans() {
    return [];
  },
  async kindsOf(scanId) {
    const r = done(scanId).nodes[0]!;
    return [{ kind: "video", onDisk: r.onDisk * 0.4, files: 100 }, { kind: "program", onDisk: r.onDisk * 0.35, files: 900 }, { kind: "other", onDisk: r.onDisk * 0.25, files: 500 }];
  },
  async searchScan(scanId, query) {
    const { nodes } = done(scanId);
    const t = (query.text ?? "").toLowerCase();
    return nodes.filter((n) => n.parent !== null && n.name.toLowerCase().includes(t)).slice(0, 50).map((n) => ({ node: dto(n), path: n.name, kind: "other" as const }));
  },
  async installedPrograms() {
    return [{ key: "demo", name: "برنامج تجريبي", version: "1.0", publisher: "Demo", sizeKb: 2_000_000, installDate: "20250101" }];
  },
  async installedDrivers() {
    return [];
  },
  async diskHealth() {
    return [{ name: "Demo SSD", media: "SSD", bus: "NVMe", health: "Healthy", size: 500e9, temperature: 41, hours: 6120, wear: 3, readErrors: 0, writeErrors: 0 }];
  },
  async hardwareNow() {
    return { cpuName: "Demo CPU", cpuLoad: 23, memTotal: 16e9, memFree: 5e9, osName: "Demo", bootedAt: new Date().toISOString(), batteryCharge: null, batteryFull: null, batteryDesign: null };
  },
  async startupPrograms() {
    return [];
  },
  async systemErrors() {
    return [];
  },
  async openPorts() {
    return [{ port: 3000, address: "127.0.0.1", process: "node" }];
  },
  async uninstallProgram() {
    throw new Error("الإزالة تعمل في التطبيق فقط");
  },
  async diskSpeed() {
    return { writeMbS: 500, readMbS: 500, sizeMb: 256 };
  },
  async exportCsv() {
    throw new Error("التصدير يعمل في التطبيق فقط");
  },
  async appVersion() {
    return "demo";
  },
  async checkUpdate() {
    return null;
  },
  async installUpdate() {},
  async diagnosticsText() {
    return "وضع العرض";
  },
  async saveDiagnostics() {},
  async licenseStatus() {
    return { device: "JARD-DEV-0000-0000-0000", license: null, problem: null };
  },
  async checkLicenseKey() {
    return { kind: "short" as const, missing: 4 };
  },
  async pickLicenseFile() {
    return null;
  },
  async activateFile() {
    return { ok: false as const, error: "unreadable" as const };
  },
  async deactivate() {},
  async onOpenFolder() {
    return () => {};
  },
  async dataFolders() {
    return [];
  },
  async setStartup() {},
  async secureDeleteFile() {
    return { Err: { kind: "other" as const, message: "يعمل في التطبيق فقط" } };
  },
  async stressCpu() {
    return { seconds: 1, threads: 4, score: 100, stopped: false };
  },
  async stressStop() {},
  async openMemoryTest() {},
  async flashCapacity() {
    return { written: 0, verified: 0, ok: true, cancelled: true };
  },
  async flashStop() {},
  async onFlashProgress() {
    return () => {};
  },
  async virustotalCheck() {
    throw new Error("يعمل في التطبيق فقط");
  },
  async setSchedule() {},
  async getSchedule() {
    return null;
  },
  async removeSchedule() {},
  async networkNeighbors() {
    return [];
  },
  async diskPartitions() {
    return [];
  },
  async pickAnyFile() {
    return null;
  },
  async startupFolder() {
    return null;
  },
  async pickFolder() {
    return "D:\\Projects";
  },
  async pickSavePath() {
    throw new Error("التصدير يعمل في التطبيق فقط، لا في وضع العرض");
  },
  async onProgress(scanId, cb) {
    const s = get(scanId);
    s.progressCbs.add(cb);
    return () => s.progressCbs.delete(cb);
  },
  async onDone(scanId, cb) {
    const s = get(scanId);
    s.doneCbs.add(cb);
    return () => s.doneCbs.delete(cb);
  },
};

// Fake engine for working on the UI in a plain browser (`pnpm dev`). Never used inside Tauri.
// Builds a made-up tree with the same shape and rules as jard-scan (child id > parent id,
// rolled-up totals, flags), and "scans" it over a few seconds.

import { Flag, type Done, type Drive, type Engine, type NodeDto, type Progress, type SortKey } from "./types";

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

const dto = (n: FakeNode): NodeDto => {
  const { children, ...rest } = n;
  return { ...rest, childCount: children.length };
};

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

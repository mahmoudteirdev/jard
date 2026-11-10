// The one scan the app shows at a time: its progress while running, its tree once done.

import { useSyncExternalStore } from "react";
import { currentSettings } from "./settings";
import { engine, type Done, type Drive, type Progress, type SavedScan, type ScanId, type Unlisten } from "./engine";

export interface Session {
  id: ScanId;
  root: string;
  /** Set when the whole drive is scanned: gives a known total for the progress bar. */
  drive: Drive | null;
  /** Hard links counted once in this scan. */
  dedup: boolean;
  phase: "running" | "done" | "failed";
  progress: Progress | null;
  done: Done | null;
  startedAt: number;
  finishedAt: number | null;
  /** When the current pause began, and how long earlier pauses took: elapsed time doesn't count them. */
  pausedAt: number | null;
  pausedMs: number;
}

let session: Session | null = null;
let unlisten: Unlisten[] = [];
const listeners = new Set<() => void>();

function set(next: Session | null) {
  session = next;
  listeners.forEach((l) => l());
}

function patch(id: ScanId, p: Partial<Session>) {
  if (session?.id === id) set({ ...session, ...p });
}

function finish(id: ScanId, d: Done) {
  if (session?.id !== id || session.phase !== "running") return;
  patch(id, { phase: d.error ? "failed" : "done", done: d, finishedAt: Date.now() });
  unlisten.forEach((u) => u());
  unlisten = [];
}

/** Shows a saved result without scanning again. `finishedAt` is when it was really scanned. */
export async function openSaved(saved: SavedScan, drive: Drive | null): Promise<void> {
  const id = await engine.openSaved(saved.key);
  const previous = session;
  set({
    id, root: saved.root, drive, dedup: false, phase: "done", progress: null,
    done: { rootId: 0, elapsedMs: 0, partial: saved.partial, error: null },
    startedAt: saved.savedAt * 1000, finishedAt: saved.savedAt * 1000, pausedAt: null, pausedMs: 0,
  });
  if (previous) void engine.forgetScan(previous.id).catch(() => {});
}

export async function startScan(root: string, drive: Drive | null, dedupHardlinks: boolean, keep = true): Promise<void> {
  const previous = session;
  unlisten.forEach((u) => u());
  unlisten = [];

  const id = await engine.startScan(root, { dedupHardlinks, fastMft: currentSettings().fastMft, excluded: currentSettings().excluded }, keep);
  set({ id, root, drive, dedup: dedupHardlinks, phase: "running", progress: null, done: null, startedAt: Date.now(), finishedAt: null, pausedAt: null, pausedMs: 0 });
  // Freed only now: the old results stay on screen, and readable, until the new session replaces them.
  if (previous) void engine.forgetScan(previous.id).catch(() => {});
  unlisten = await Promise.all([
    engine.onProgress(id, (p) => patch(id, { progress: p })),
    engine.onDone(id, (d) => finish(id, d)),
  ]);
  // Events sent before we subscribed are gone: ask once where the scan is.
  const status = await engine.scanStatus(id);
  if (status.done) finish(id, status.done);
  else if (status.progress) patch(id, { progress: status.progress });
}

export async function cancelScan(): Promise<void> {
  if (session?.phase === "running") await engine.cancelScan(session.id);
}

export async function setScanPaused(paused: boolean): Promise<void> {
  if (session?.phase !== "running") return;
  const s = session;
  await engine.pauseScan(s.id, paused);
  const now = Date.now();
  if (paused && s.pausedAt === null) patch(s.id, { pausedAt: now });
  else if (!paused && s.pausedAt !== null) patch(s.id, { pausedAt: null, pausedMs: s.pausedMs + now - s.pausedAt });
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => session,
  );
}

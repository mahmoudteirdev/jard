// What the person chose to clean, carried from Storage or Cleanup to the "before deleting" screen,
// and a counter that tells open screens the scan's numbers changed.

import { useSyncExternalStore } from "react";
import type { NodeDto, ScanId } from "./engine";
import { go, type RouteId } from "./routes";

export interface CleanRequest {
  scanId: ScanId;
  nodes: NodeDto[];
  /** Where "back" leads. */
  from: RouteId;
}

let pending: CleanRequest | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function askToClean(request: CleanRequest) {
  pending = request;
  notify();
  go("guard");
}

export function usePendingClean(): CleanRequest | null {
  return useSyncExternalStore(subscribe, () => pending);
}

export function clearPendingClean() {
  pending = null;
  notify();
}

/** Call after anything left or came back: sizes on screen must be fetched again. */
export function treeChanged() {
  version++;
  notify();
}

export function useTreeVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

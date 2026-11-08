// Per-machine preferences. Storage can be missing or blocked, so every access is guarded.

import { useSyncExternalStore } from "react";
import type { Unit } from "./format";

export type Theme = "dark" | "light" | "system";

export interface Settings {
  theme: Theme;
  unit: Unit;
  /** Count each hard-linked file once. About twice as slow on Windows. */
  dedupHardlinks: boolean;
}

const KEY = "jard.settings";
const DEFAULTS: Settings = { theme: "dark", unit: "GB", dedupHardlinks: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

/** `data-theme` on <html>; none means "follow the system" (tokens.css). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

applyTheme(current.theme);

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // not saved; still applies for this session
  }
  applyTheme(current.theme);
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

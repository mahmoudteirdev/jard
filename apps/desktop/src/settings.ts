// Per-machine preferences. Storage can be missing or blocked, so every access is guarded.

import { useSyncExternalStore } from "react";
import type { Unit } from "./format";
import type { Language } from "./i18n";

export type Theme = "dark" | "light" | "system";

export interface Settings {
  theme: Theme;
  unit: Unit;
  /** Count each hard-linked file once. About twice as slow on Windows. */
  dedupHardlinks: boolean;
  /** Fast scan through the NTFS Master File Table when running as administrator. */
  fastMft: boolean;
  /** Save results on this machine for next time and for comparing. */
  keepResults: boolean;
  /** Look for a newer version at each start. Null: not asked yet. */
  checkUpdates: boolean | null;
  /** Fingerprint lookups on VirusTotal: off until turned on, and needs the person's own key. */
  virustotal: boolean;
  virustotalKey: string;
  language: Language;
  /** Simple hides the technical numbers and screens. Everything still works the same. */
  level: "simple" | "expert";
  /** Folders scans skip. They stay listed, with nothing read under them. */
  excluded: string[];
}

const KEY = "jard.settings";
const DEFAULTS: Settings = { theme: "dark", unit: "GB", dedupHardlinks: false, fastMft: true, keepResults: true, checkUpdates: null, virustotal: false, virustotalKey: "", language: "ar", level: "expert", excluded: [] };

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

export const currentSettings = (): Settings => current;

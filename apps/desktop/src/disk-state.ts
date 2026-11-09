import type { Disk } from "./engine";

/** Windows' own words for a disk. "Unknown" is not a warning: many USB drives just don't report. */
export const HEALTH: Record<string, { word: string; cls: string }> = {
  Healthy: { word: "سليم", cls: "safety-safe" },
  Warning: { word: "تحذير", cls: "safety-careful" },
  Unhealthy: { word: "متضرر", cls: "safety-keep" },
};

export const diskWarned = (d: Disk) => d.health === "Warning" || d.health === "Unhealthy";

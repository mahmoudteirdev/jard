import { mockEngine } from "./mock";
import { tauriEngine } from "./tauri";
import type { Engine } from "./types";

export * from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The real engine inside the app; fake data in a plain browser. */
export const engine: Engine = inTauri ? tauriEngine : mockEngine;

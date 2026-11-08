import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Port and settings follow Tauri's Vite guide: fixed port, no screen clearing, ignore src-tauri.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [repoRoot] }, // tokens.css lives in /design
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022", sourcemap: false },
});

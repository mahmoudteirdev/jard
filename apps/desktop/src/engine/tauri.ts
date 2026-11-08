import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Done, Drive, Engine, NodeDto, Progress, Status } from "./types";

export const tauriEngine: Engine = {
  demo: false,
  startScan: (root, opts) => invoke("start_scan", { root, opts: opts ?? null }),
  cancelScan: (scanId) => invoke("cancel_scan", { scanId }),
  scanStatus: (scanId) => invoke<Status>("scan_status", { scanId }),
  forgetScan: (scanId) => invoke("forget_scan", { scanId }),
  getChildren: (scanId, nodeId, sort, limit, offset) =>
    invoke<NodeDto[]>("get_children", { scanId, nodeId, sort, limit: limit ?? null, offset: offset ?? null }),
  getNode: (scanId, nodeId) => invoke<NodeDto>("get_node", { scanId, nodeId }),
  getPath: (scanId, nodeId) => invoke<string>("get_path", { scanId, nodeId }),
  getAncestors: (scanId, nodeId) => invoke<NodeDto[]>("get_ancestors", { scanId, nodeId }),
  exportJson: (scanId, path) => invoke("export_json", { scanId, path }),
  listDrives: () => invoke<Drive[]>("list_drives"),
  reveal: (scanId, nodeId) => invoke("reveal", { scanId, nodeId }),
  pickFolder: async () => {
    const picked = await open({ directory: true, multiple: false, title: "اختر مجلداً لفحصه" });
    return typeof picked === "string" ? picked : null;
  },
  pickSavePath: async (defaultPath) =>
    (await save({ defaultPath, filters: [{ name: "JSON", extensions: ["json"] }], title: "حفظ نتيجة الفحص" })) ?? null,
  onProgress: (scanId, cb) => listen<Progress>(`scan://progress/${scanId}`, (e) => cb(e.payload)),
  onDone: (scanId, cb) => listen<Done>(`scan://done/${scanId}`, (e) => cb(e.payload)),
};

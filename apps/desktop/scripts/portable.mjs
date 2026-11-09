// Packs the built program as a portable zip: the exe, the marker that makes it portable, a note.
//   pnpm build:portable

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(app, "src-tauri", "tauri.conf.json"), "utf8"));
const release = join(app, "..", "..", "target", "release");
const stage = join(release, "bundle", "portable", "Jard");
const zip = join(release, "bundle", "portable", `Jard_${conf.version}_x64_portable.zip`);

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(join(release, "jard-desktop.exe"), join(stage, "Jard.exe"));
writeFileSync(join(stage, "jard.portable"), "This file makes Jard keep all its data in the data folder next to it.\n");
writeFileSync(
  join(stage, "README.txt"),
  [
    "جَرد: نسخة محمولة",
    "",
    "شغّل Jard.exe. كل بياناتها في مجلد data بجانبها، ولا تضيف شيئاً إلى ويندوز.",
    "لا تحدّث نفسها: نزّل الإصدار الجديد واستبدل الملف، ومجلد data يبقى.",
    "تحتاج WebView2، وهو موجود في ويندوز 11 ومعظم أجهزة ويندوز 10.",
    "الحجر المؤقت للأقراص الأخرى يبقى على تلك الأقراص، في مجلد .jard-quarantine.",
    "",
    "Jard, portable copy",
    "",
    "Run Jard.exe. All its data stays in the data folder beside it, and it adds nothing to Windows.",
    "It doesn't update itself: download the new version and replace the file. The data folder stays.",
    "Needs WebView2, which Windows 11 and most Windows 10 machines have.",
    "Quarantine on other drives stays on those drives, in a .jard-quarantine folder.",
    "",
  ].join("\r\n"),
);
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}' -DestinationPath '${zip}'`], { stdio: "inherit" });
console.log(zip);

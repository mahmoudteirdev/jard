// Writes the file the updater reads, from the signed installer of this build.
//   target/release/bundle/latest.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(app, "src-tauri", "tauri.conf.json"), "utf8"));
const bundle = join(app, "..", "..", "target", "release", "bundle");
const name = `${conf.productName}_${conf.version}_x64-setup.exe`;
const signature = readFileSync(join(bundle, "nsis", `${name}.sig`), "utf8").trim();
const [endpoint] = conf.plugins.updater.endpoints;
const base = endpoint.replace(/\/releases\/latest\/download\/latest\.json$/, "");

writeFileSync(
  join(bundle, "latest.json"),
  JSON.stringify(
    {
      version: conf.version,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": { signature, url: `${base}/releases/download/v${conf.version}/${name}` },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(`latest.json for ${conf.version}`);

// Lists every Arabic string in the UI and which ones have no English yet.
//   node --experimental-strip-types scripts/i18n-extract.mjs            report
//   node --experimental-strip-types scripts/i18n-extract.mjs --list F   also write the missing ones to F

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transform } from "../i18n-plugin.ts";

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "i18n") walk(p, out);
    } else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const seen = new Set();
for (const f of walk("src")) transform(readFileSync(f, "utf8"), f, seen);
const en = JSON.parse(readFileSync("src/i18n/en.json", "utf8"));
const all = [...seen].filter(Boolean).sort();
const missing = all.filter((s) => !(s in en));
const unused = Object.keys(en).filter((k) => !seen.has(k));
console.log(`strings: ${all.length}, translated: ${all.length - missing.length}, missing: ${missing.length}, unused: ${unused.length}`);
const i = process.argv.indexOf("--list");
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(missing, null, 1));
if (missing.length && i < 0) process.exitCode = 1;

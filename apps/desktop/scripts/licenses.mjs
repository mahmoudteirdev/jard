// Writes what the app shows about the open-source code it ships, from what's really resolved:
//   src/third-party.json                     names, versions and licenses, for the About screen
//   src-tauri/THIRD_PARTY_NOTICES.txt        the license texts, built into the program
//   ../android/app/src/main/assets/licenses.txt   the same for Android
// Run after changing dependencies:  node scripts/licenses.mjs

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");

function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
}

// ---- Rust: what the program links, for Windows. Build tools and test code don't ship.
const meta = JSON.parse(
  execSync("cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc", { cwd: app, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString(),
);
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const start = meta.packages.find((p) => p.name === "jard-desktop").id;
const seen = new Set();
const stack = [start];
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const d of nodes.get(id)?.deps ?? []) {
    if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
  }
}
const entries = [];
for (const id of seen) {
  const p = byId.get(id);
  if (!p.source) continue; // our own crates
  entries.push({ name: p.name, version: p.version, license: p.license ?? "see the package", texts: licenseTexts(dirname(p.manifest_path)) });
}

// ---- JavaScript: what the window loads.
const js = JSON.parse(execSync("pnpm -s licenses list --prod --json", { cwd: app, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }).toString());
for (const [license, list] of Object.entries(js)) {
  for (const p of list) entries.push({ name: p.name, version: p.versions[0], license, texts: licenseTexts(p.paths[0]) });
}
entries.sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(
  join(app, "src", "third-party.json"),
  JSON.stringify(entries.map(({ name, version, license }) => ({ name, version, license })), null, 0) + "\n",
);

// The same text often repeats: each one once, with who it covers.
function notices(list, title) {
  const groups = new Map();
  const bare = [];
  for (const e of list) {
    if (!e.texts.length) bare.push(e);
    for (const t of e.texts) {
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(`${e.name} ${e.version}`);
    }
  }
  let out = `${title}\n\n`;
  if (bare.length) out += `Under the license named, with no separate text in the package:\n${bare.map((e) => `  ${e.name} ${e.version}: ${e.license}`).join("\n")}\n\n`;
  for (const [text, who] of groups) out += `${"=".repeat(72)}\n${[...new Set(who)].join(", ")}\n\n${text}\n\n`;
  return out;
}
writeFileSync(join(app, "src-tauri", "THIRD_PARTY_NOTICES.txt"), notices(entries, "Open-source code in Jard for Windows"));

// ---- Android: resolved by Gradle, so listed here by hand. Check it when build.gradle.kts changes.
const find = (name) => entries.find((e) => e.name === name);
const apache = entries.flatMap((e) => e.texts).find((t) => /Apache License\s+Version 2\.0/.test(t));
const ofl = find("@fontsource/ibm-plex-sans-arabic").texts[0];
const android = `Open-source code in Jard for Android

${"=".repeat(72)}
AndroidX (Activity, Compose, Core) and the Kotlin standard library: Apache License 2.0

${apache}

${"=".repeat(72)}
Shizuku API (dev.rikka.shizuku): MIT License
https://github.com/RikkaApps/Shizuku-API/blob/master/LICENSE

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions: the above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

${"=".repeat(72)}
IBM Plex Sans Arabic and IBM Plex Mono: SIL Open Font License 1.1

${ofl}
`;
writeFileSync(join(app, "..", "android", "app", "src", "main", "assets", "licenses.txt"), android);
console.log(`${entries.length} packages listed`);

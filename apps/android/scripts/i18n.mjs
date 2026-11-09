// Lists every Arabic string in the Kotlin code and which have no English yet.
//   node scripts/i18n.mjs            report
//   node scripts/i18n.mjs --list F   also write the missing ones to F

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "src", "main");

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith(".kt")) out.push(p);
  }
  return out;
}

const arabic = /[؀-ۿ]/;

/** Reads one Kotlin string starting after its opening quote. Returns the text with `{}` for templates. */
function readString(src, start, found) {
  let i = start;
  let text = "";
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      text += src[i + 1] === "n" ? "\n" : src[i + 1];
      i += 2;
    } else if (c === '"') {
      if (arabic.test(text)) found.add(text);
      return i + 1;
    } else if (c === "$" && src[i + 1] === "{") {
      // An expression may hold strings of its own, and those are collected too.
      i = readExpr(src, i + 2, found);
      text += "{}";
    } else if (c === "$" && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
      i++;
      while (/[A-Za-z0-9_]/.test(src[i] ?? "")) i++;
      text += "{}";
    } else {
      text += c;
      i++;
    }
  }
  return i;
}

function readExpr(src, start, found) {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '"') i = readString(src, i + 1, found);
    else {
      if (c === "{") depth++;
      if (c === "}") depth--;
      i++;
    }
  }
  return i;
}

function strings(src, found) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 2;
      if (i < 2) return;
    } else if (c === "'" && src[i + 2] === "'") {
      i += 3;
    } else if (c === "'" && src[i + 1] === "\\") {
      i = src.indexOf("'", i + 2) + 1;
    } else if (c === '"') {
      i = readString(src, i + 1, found);
    } else {
      i++;
    }
  }
}

const found = new Set();
for (const f of walk(join(root, "java"))) strings(readFileSync(f, "utf8"), found);
const en = JSON.parse(readFileSync(join(root, "assets", "en.json"), "utf8"));
const all = [...found].sort();
const missing = all.filter((s) => !(s in en));
const unused = Object.keys(en).filter((k) => !found.has(k));
console.log(`strings: ${all.length}, translated: ${all.length - missing.length}, missing: ${missing.length}, unused: ${unused.length}`);
if (process.argv[2] === "--list") writeFileSync(process.argv[3], JSON.stringify(missing, null, 1));
else for (const m of missing.slice(0, 40)) console.log("  " + m);

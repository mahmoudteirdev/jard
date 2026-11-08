// Numbers are always Western digits (0-9), shown LTR in a mono face (.num in tokens.css).

export type Unit = "GB" | "GiB";

const intl = new Intl.NumberFormat("en-US");
const fixed = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const f0 = fixed(0);
const f1 = fixed(1);
const f2 = fixed(2);

export const num = (n: number) => intl.format(n);

const SI = ["B", "KB", "MB", "GB", "TB", "PB"];
const IEC = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

/** 1234567 -> "1.23 MB" (or "1.18 MiB"). Three significant digits, unit always attached. */
export function size(bytes: number, unit: Unit): string {
  const base = unit === "GB" ? 1000 : 1024;
  const names = unit === "GB" ? SI : IEC;
  let v = bytes;
  let i = 0;
  while (v >= base && i < names.length - 1) {
    v /= base;
    i++;
  }
  if (i === 0) return `${intl.format(bytes)} B`;
  const fmt = v >= 100 ? f0 : v >= 10 ? f1 : f2;
  return `${fmt.format(v)} ${names[i]}`;
}

/** 83_000 -> "01:23" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const rel = new Intl.RelativeTimeFormat("ar-u-nu-latn", { numeric: "auto" });

/** "قبل 3 دقائق", Western digits. */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  if (Math.abs(s) < 45) return rel.format(0, "second");
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rel.format(m, "minute");
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rel.format(h, "hour");
  return rel.format(Math.round(h / 24), "day");
}

/** Cuts the middle of a long path so both the drive and the file name stay visible. */
export function middle(text: string, max = 80): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0);

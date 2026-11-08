import type { FileKind, KindTotal } from "./engine";

export const KIND_NAMES: Record<FileKind, string> = {
  video: "فيديو",
  image: "صور",
  audio: "صوت",
  document: "مستندات",
  archive: "أرشيف",
  disk_image: "صور أقراص",
  virtual_machine: "أجهزة افتراضية",
  installer: "ملفات تثبيت",
  program: "برامج",
  other: "أخرى",
};

/** Colour belongs to the group, never to its rank: "فيديو" stays blue whatever else is on the bar. */
export const GROUPS = [
  { id: "programs", name: "برامج", color: "var(--data-1)", kinds: ["program", "installer"] },
  { id: "video", name: "فيديو", color: "var(--data-2)", kinds: ["video"] },
  { id: "archives", name: "أرشيف وأقراص", color: "var(--data-3)", kinds: ["archive", "disk_image", "virtual_machine"] },
  { id: "files", name: "صور وملفات", color: "var(--data-4)", kinds: ["image", "document", "audio"] },
  { id: "other", name: "أخرى", color: "var(--data-grey)", kinds: ["other"] },
] as const;

export function groupTotals(totals: KindTotal[]) {
  return GROUPS.map((g) => ({
    ...g,
    onDisk: totals.filter((t) => (g.kinds as readonly string[]).includes(t.kind)).reduce((s, t) => s + t.onDisk, 0),
    files: totals.filter((t) => (g.kinds as readonly string[]).includes(t.kind)).reduce((s, t) => s + t.files, 0),
  })).filter((g) => g.files > 0);
}

export interface Explanation {
  /** The word next to the colour: never colour alone. */
  safety: "safe" | "careful" | "keep" | "unknown";
  label: string;
  what: string;
  action: string;
}

const TEXT = {
  safe: "آمن غالباً",
  careful: "بحذر",
  keep: "لا تحذفه",
  unknown: "راجعه بنفسك",
} as const;

const known = (safety: Explanation["safety"], what: string, action: string): Explanation => ({
  safety, label: TEXT[safety], what, action,
});

/** "What is this file?" A small table of things people really ask about, and plain honesty otherwise. */
export function explain(name: string, kind: FileKind, isDir: boolean): Explanation {
  const n = name.toLowerCase();
  if (n === "pagefile.sys") return known("keep", "ذاكرة احتياطية يستخدمها ويندوز لما تمتلئ الذاكرة العشوائية.", "تغيير حجمه يتم من إعدادات النظام، مش بالحذف.");
  if (n === "hiberfil.sys") return known("careful", "يحفظ حالة الجهاز لوضع السبات. يختفي إذا عطلت السبات من الإعدادات.", "لا تحذفه يدوياً؛ عطّل السبات بدل ذلك.");
  if (n === "swapfile.sys") return known("keep", "ملف يستخدمه ويندوز لتطبيقات المتجر.", "يديره النظام بنفسه.");
  if (n === "thumbs.db") return known("safe", "صور مصغرة يخزنها ويندوز لعرض المجلد أسرع.", "يُعاد إنشاؤه تلقائياً.");
  if (n === "desktop.ini") return known("careful", "إعدادات شكل المجلد في المستكشف، وصغير جداً.", "ما في فايدة من حذفه.");
  if (n === "node_modules") return known("safe", "مكتبات مشروع برمجي، تُنزَّل بأمر واحد.", "احذفه من المشاريع القديمة، وأعد تنزيله عند الحاجة.");
  if (n === ".git") return known("careful", "تاريخ مشروع برمجي كامل. إذا ما له نسخة على خادم، ضياعه نهائي.", "لا تنقله إلا إذا عندك نسخة منه.");
  if (n === "$recycle.bin") return known("keep", "سلة المحذوفات.", "تفريغها يتم من السلة نفسها.");
  if (n === "windows.old") return known("careful", "نسخة ويندوز السابقة بعد التحديث، وتلزم للرجوع إليها.", "استخدم إعدادات تنظيف القرص في ويندوز.");
  if (n.endsWith(".tmp") || n === "temp" || n === "tmp") return known("safe", "ملفات مؤقتة تتركها البرامج.", "آمن عادةً، إلا إذا كان برنامج مفتوح يستخدمها.");
  if (n.endsWith(".dmp")) return known("safe", "تقرير انهيار برنامج أو النظام.", "لا يلزم إلا لتشخيص المشكلة.");
  if (n.endsWith(".log")) return known("safe", "سجل نصي يكتبه برنامج.", "آمن عادةً، إلا إذا تحتاجه لتشخيص مشكلة.");
  if (n === "cache" || n.includes("cache")) return known("safe", "كاش: نسخ مؤقتة لتسريع برنامج، ويُعاد إنشاؤها.", "الأفضل مسحه من داخل البرنامج إن أمكن.");
  if (kind === "installer") return known("safe", "ملف تثبيت. البرنامج نفسه مثبّت في مكان آخر.", "احذفه إذا ما بتحتاج تثبيته مرة ثانية.");
  if (kind === "disk_image" || kind === "virtual_machine") return known("careful", "صورة قرص أو جهاز افتراضي، وعادةً كبيرة.", "تأكد إنك ما بتستخدمه أو عندك نسخة منه.");
  if (kind === "program") return known("careful", "جزء من برنامج مثبّت على الأغلب.", "لإزالة برنامج، استخدم شاشة البرامج لا الحذف.");
  return known(
    "unknown",
    isDir ? "مجلد ما عندنا معلومة خاصة عنه." : `ملف ${KIND_NAMES[kind]}. ما عندنا معلومة خاصة عن هذا الاسم.`,
    "افتحه في المستكشف وقرر بنفسك. أي نقل يبقى قابلاً للاسترجاع 30 يوماً.",
  );
}

/** Days until the drive is full at the growth seen across saved scans; null when it can't be told. */
export function daysUntilFull(points: { at: number; onDisk: number; partial: boolean }[], free: number): number | null {
  const whole = points.filter((p) => !p.partial);
  const first = whole[0];
  const last = whole[whole.length - 1];
  if (!first || !last || last.at - first.at < 7 * 86_400) return null; // under a week is noise
  const perDay = (last.onDisk - first.onDisk) / ((last.at - first.at) / 86_400);
  return perDay > 0 ? free / perDay : null;
}

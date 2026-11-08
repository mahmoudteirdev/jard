// Words for everything the cleanup engine reports. Every state has a sentence, never colour alone.

import type { EffectKind, Failure, LogKind, ProtectReason } from "./engine";

export function reasonText(r: ProtectReason): string {
  switch (r) {
    case "system":
      return "ملفات نظام أساسية. حذفها ممكن يمنع ويندوز من الإقلاع.";
    case "system_file":
      return "ملف يديره النظام، ويتغيّر من إعدادات ويندوز.";
    case "system_area":
      return "منطقة خاصة بالنظام أو بسلة المحذوفات.";
    case "container":
      return "يحتوي برامج أو بيانات كثيرة. اختر العناصر اللي بداخله.";
    case "user_folder":
      return "مجلد أساسي في حسابك، والبرامج تتوقع وجوده. اختر العناصر اللي بداخله.";
    case "contains_protected":
      return "بداخله مسارات محمية، ونقله ينقلها معه.";
    case "jard":
      return "ملفات جَرد نفسه أو الحجر المؤقت.";
  }
}

export function failureText(f: Failure): string {
  switch (f.kind) {
    case "protected":
      return reasonText(f.reason);
    case "in_use":
      return "الملف مستخدم حالياً. أغلق البرنامج اللي فاتحه ثم أعد المحاولة.";
    case "denied":
      return "رفض ويندوز الوصول. ممكن يكون بداخله ملف مفتوح، أو يحتاج صلاحية مسؤول.";
    case "missing":
      return "لم يعد موجوداً في مكانه.";
    case "conflict":
      return "يوجد الآن ملف بنفس الاسم في المكان الأصلي.";
    case "no_quarantine":
      return "تعذّر إنشاء الحجر على هذا القرص، ولم يُنقل شيء.";
    case "other":
      return f.message;
  }
}

/** Trying again can work: the file may be closed by then. The others won't change on their own. */
export const canRetry = (f: Failure) => f.kind === "in_use" || f.kind === "denied" || f.kind === "other";

export function effectText(k: EffectKind): { what: string; detail: string; serious: boolean } {
  switch (k) {
    case "synced":
      return { what: "ملفات داخل مجلد مزامنة", detail: "الحذف ممكن ينتقل إلى السحابة وبقية أجهزتك.", serious: true };
    case "browser_cache":
      return { what: "المتصفح رح يفقد الكاش", detail: "أول فتح بعد الحذف أبطأ، والصفحات تُنزّل من جديد.", serious: false };
    case "package_cache":
      return { what: "حزم تُعاد تنزيلها", detail: "تُنزّل مرة ثانية عند أول استخدام. يحتاج إنترنت.", serious: false };
    case "installed_program":
      return { what: "ملفات من برنامج مثبّت", detail: "البرنامج ممكن يتوقف عن العمل. الأفضل إزالته من شاشة البرامج.", serious: true };
  }
}

export function logText(k: LogKind): string {
  switch (k) {
    case "quarantined":
      return "نقل إلى الحجر";
    case "restored":
      return "استرجاع من الحجر";
    case "deleted":
      return "حذف نهائي من الحجر";
    case "expired":
      return "حذف تلقائي بعد انتهاء 30 يوماً";
    case "scanned":
      return "فحص";
    case "secure_deleted":
      return "حذف آمن";
    case "rule_failed":
      return "قاعدة تلقائية لم تستطع نقل عناصر";
  }
}

export function noteText(note: string): string {
  const map: Record<string, string> = {
    safe: "آمن للحذف",
    redownload: "يُعاد تنزيله",
    duplicate: "نسخة مكررة",
    leftover: "ممكن بقايا",
    kind_video: "فيديو",
    kind_disk_image: "صورة قرص",
    kind_vm: "جهاز افتراضي",
    kind_archive: "أرشيف",
    kind_installer: "ملف تثبيت",
    kind_image: "صورة",
    kind_audio: "صوت",
    kind_document: "مستند",
    kind_other: "ملف",
  };
  return map[note] ?? note;
}

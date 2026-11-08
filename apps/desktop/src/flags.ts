import { Flag } from "./engine";

export interface Badge {
  flag: number;
  label: string;
  /** Longer explanation for the tooltip and screen readers. */
  hint: string;
}

// Badge words for every engine flag. Cloud and compressed are drawn in Main/Truth;
// the others follow the same shape (HANDOFF §5).
export const BADGES: Badge[] = [
  { flag: Flag.DENIED, label: "تعذّرت القراءة", hint: "لم يسمح ويندوز بقراءة هذا المجلد. الفحص أكمل الباقي." },
  { flag: Flag.PARTIAL, label: "جزئي", hint: "لم يُقرأ كل ما بداخله، فالأرقام أقل من الحقيقة." },
  { flag: Flag.CLOUD, label: "سحابي", hint: "جزء منه في السحابة وليس على هذا القرص. حذفه لا يحرر مساحة." },
  { flag: Flag.COMPRESSED, label: "مضغوط", hint: "مضغوط على القرص: يأخذ مساحة أقل من حجمه." },
  { flag: Flag.SPARSE, label: "مبعثر", hint: "ملف مبعثر: يأخذ على القرص أقل من حجمه الظاهري." },
  { flag: Flag.HARDLINK, label: "رابط صلب", hint: "للملف أكثر من اسم. يُحسب مرة واحدة فقط." },
  { flag: Flag.REPARSE, label: "اختصار", hint: "رابط أو نقطة ربط تشير لمكان آخر. لم يُتبع حتى لا يُحسب مرتين." },
  { flag: Flag.ENCRYPTED, label: "مشفّر", hint: "مشفّر بنظام ملفات ويندوز." },
];

export const badgesOf = (flags: number) => BADGES.filter((b) => flags & b.flag);

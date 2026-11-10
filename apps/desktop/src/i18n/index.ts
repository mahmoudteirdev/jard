// The app is written in Arabic. In English, each piece of text is looked up here; anything missing
// shows in Arabic rather than blank. Changing language reloads the window, so text computed once at
// startup (tab names and so on) is right too.

import en from "./en.json";

export type Language = "ar" | "en";

function readLanguage(): Language {
  try {
    const raw = localStorage.getItem("jard.settings");
    if (raw) {
      const saved = (JSON.parse(raw) as { language?: string }).language;
      if (saved === "en") return "en";
      if (saved === "ar") return "ar";
    }
    if (typeof navigator !== "undefined" && navigator.language) {
      return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
    }
    return "ar";
  } catch {
    return "ar";
  }
}

export const language: Language = readLanguage();

const dictionary = en as Record<string, string>;

export function t(text: string): string {
  if (language === "ar") return text;
  const key = text.trim();
  const found = dictionary[key];
  if (found === undefined) return text;
  // Spaces at the ends join a piece to the numbers and names around it.
  const start = text.slice(0, text.length - text.trimStart().length);
  const end = text.slice(text.trimEnd().length);
  return `${start}${found}${end}`;
}

/** Locale for numbers and dates: Western digits in both languages. */
export const locale = language === "en" ? "en" : "ar-u-nu-latn";

if (typeof document !== "undefined") {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "en" ? "ltr" : "rtl";
}

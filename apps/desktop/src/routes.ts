import { useEffect, useState } from "react";

export type RouteId =
  | "overview" | "storage" | "finder" | "compare" | "drives"
  | "cleanup" | "programs" | "history"
  | "health" | "tests" | "reports"
  | "security" | "settings"
  | "scan" | "guard" | "about" | "license" | "whyslow" | "truth";

export interface RailItem {
  id: RouteId;
  name: string;
  /** Stroke icon path (24x24), from the Rail board. */
  d: string;
}

const I = {
  overview: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  storage: "M3 3h11v18H3zM14 3h7v8h-7zM14 11h7v10h-7z",
  cleanup: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
  finder: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  compare: "M5 21V10M12 21V3M19 21v-7",
  drives: "M3 5h18v6H3zM3 13h18v6H3zM7 8h.01M7 16h.01",
  programs: "M3 4h18v16H3zM3 9h18M7 6.5h.01",
  health: "M3 12h4l3-7 4 14 3-7h4",
  tests: "M9 3h6M10 3v6l-5 10a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3",
  security: "M12 3l8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6z",
  reports: "M6 3h9l4 4v14H6zM9 12h6M9 16h6",
  history: "M12 3a9 9 0 1 0 9 9M12 7v5l3 2M21 3v5h-5",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4",
};

const item = (id: keyof typeof I, name: string): RailItem => ({ id, name, d: I[id] });

/** Overview is the one starting point (step-3 review). Settings sits apart at the end. */
export const RAIL_START = item("overview", "نظرة عامة");
export const RAIL_END = item("settings", "الإعدادات");

/** The 4 groups named in the step-3 review. Which item goes where is our call: the review names only the groups. */
export const RAIL_GROUPS: { name: string; items: RailItem[] }[] = [
  { name: "المساحة", items: [item("storage", "التخزين"), item("finder", "البحث"), item("compare", "المقارنة"), item("drives", "الأقراص")] },
  { name: "التنظيف", items: [item("cleanup", "التنظيف"), item("programs", "البرامج"), item("history", "السجل")] },
  { name: "الجهاز", items: [item("health", "صحة الجهاز"), item("tests", "الاختبارات"), item("reports", "التقارير")] },
  { name: "الأمان", items: [item("security", "الأمان")] },
];

export const RAIL_ITEMS: RailItem[] = [RAIL_START, ...RAIL_GROUPS.flatMap((g) => g.items), RAIL_END];

const ALL = new Set<string>([...RAIL_ITEMS.map((i) => i.id), "scan", "guard", "about", "license", "whyslow", "truth"]);
const DEFAULT: RouteId = "overview";

function parse(): RouteId {
  const id = location.hash.replace(/^#\/?/, "");
  return ALL.has(id) ? (id as RouteId) : DEFAULT;
}

export const href = (id: RouteId) => `#/${id}`;

export function go(id: RouteId) {
  location.hash = href(id);
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

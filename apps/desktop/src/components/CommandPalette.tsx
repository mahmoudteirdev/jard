import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../engine";
import { middle } from "../format";
import { go, RAIL_ITEMS, type RouteId } from "../routes";
import type { Session } from "../scan-session";
import { updateSettings, useSettings, type Settings } from "../settings";

interface Command {
  group: string;
  name: string;
  keys?: string;
  run: () => void;
}

const dirIsRtl = () => document.documentElement.dir === "rtl";

/** Words for the arrows, which swap with the reading direction. */
export const enterKey = () => (dirIsRtl() ? "←" : "→");
export const upKey = () => (dirIsRtl() ? "→" : "←");

export function showFolder(id: number) {
  go("storage");
  window.dispatchEvent(new CustomEvent("jard:show-node", { detail: id }));
}

function staticCommands(rescan: () => void, set: (p: Partial<Settings>) => void, openHelp: () => void): Command[] {
  const open = (id: RouteId, name: string, keys?: string): Command => ({ group: "أمر", name, keys, run: () => go(id) });
  return [
    { group: "أمر", name: "فحص جديد", keys: "F5", run: rescan },
    open("cleanup", "فتح التنظيف", "Ctrl+L"),
    open("finder", "بحث في الملفات", "Ctrl+F"),
    { group: "أمر", name: "الاختصارات", keys: "Ctrl+/", run: openHelp },
    ...RAIL_ITEMS.filter((i) => i.id !== "cleanup" && i.id !== "finder").map((i) => open(i.id, i.name)),
    open("truth", "ليش الأرقام تختلف عن ويندوز؟"),
    open("whyslow", "ليش جهازي بطيء؟"),
    open("reports", "قواعد التنظيف التلقائي"),
    open("about", "حول جَرد"),
    open("license", "النسخة والتفعيل"),
    { group: "إعداد", name: "المظهر: داكن", run: () => set({ theme: "dark" }) },
    { group: "إعداد", name: "المظهر: فاتح", run: () => set({ theme: "light" }) },
    { group: "إعداد", name: "المظهر: حسب النظام", run: () => set({ theme: "system" }) },
    { group: "إعداد", name: "الوحدة: GB", run: () => set({ unit: "GB" }) },
    { group: "إعداد", name: "الوحدة: GiB", run: () => set({ unit: "GiB" }) },
    { group: "إعداد", name: "مستوى التفاصيل: مبتدئ", run: () => set({ level: "simple" }) },
    { group: "إعداد", name: "مستوى التفاصيل: خبير", run: () => set({ level: "expert" }) },
    open("settings", "المجلدات المستثناة من الفحص"),
  ];
}

/** Ctrl+K: searches commands and the last scan's folders together (Shortcuts board). */
export function CommandPalette({ session, rescan, onClose, openHelp }: {
  session: Session | null;
  rescan: () => void;
  onClose: () => void;
  openHelp: () => void;
}) {
  useSettings();
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [found, setFound] = useState<Command[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const scanId = session?.phase === "done" ? session.id : null;

  const commands = useMemo(() => staticCommands(rescan, updateSettings, openHelp), [rescan, openHelp]);

  // Folder names come from the engine: millions of them, so only once typing pauses.
  useEffect(() => {
    if (scanId === null || text.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      engine.searchScan(scanId, { text: text.trim() }, 8).then(
        (hits) => {
          if (!live) return;
          setFound(
            hits.map((h) => ({
              group: h.node.isDir ? "مجلد" : "ملف",
              name: middle(h.path, 70),
              run: () => showFolder(h.node.isDir ? h.node.id : (h.node.parent ?? 0)),
            })),
          );
        },
        () => live && setFound([]),
      );
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [scanId, text]);

  const q = text.trim().toLowerCase();
  const shown = [...commands.filter((c) => !q || c.name.toLowerCase().includes(q)), ...found];
  const at = Math.min(cursor, Math.max(0, shown.length - 1));

  useEffect(() => setCursor(0), [text]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="لوحة الأوامر" className="card palette">
        <label className="palette-input">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <span className="sr-only">ابحث عن أمر أو مجلد</span>
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown.length ? `palette-${at}` : undefined}
            value={text}
            placeholder="ابحث عن أمر أو مجلد…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(Math.min(at + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(Math.max(at - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(shown[at]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
        </label>
        <div id="palette-list" ref={list} role="listbox" aria-label="نتائج" className="palette-list">
          {shown.map((c, i) => (
            <div
              key={`${c.group}-${c.name}-${i}`}
              id={`palette-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === at}
              className="palette-row"
              onMouseMove={() => setCursor(i)}
              onClick={() => pick(c)}
            >
              <span className="muted label palette-group">{c.group}</span>
              <span className={c.group === "مجلد" || c.group === "ملف" ? "grow path small" : "grow"}>{c.name}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </div>
          ))}
          {shown.length === 0 && (
            <p className="muted" style={{ padding: "10px" }}>
              {scanId === null ? "ما لقينا أمراً بهذا الاسم. للبحث في المجلدات، افحص قرصاً أولاً." : "ما لقينا أمراً أو مجلداً بهذا الاسم."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ctrl+/: every shortcut that does something in this build. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const groups: { name: string; items: [string, string][] }[] = [
    { name: "عام", items: [["لوحة الأوامر", "Ctrl+K"], ["فحص جديد", "F5"], ["بحث", "Ctrl+F"], ["فتح التنظيف", "Ctrl+L"], ["الاختصارات", "Ctrl+/"]] },
    { name: "التنقل في قائمة المجلدات", items: [["دخول المجلد", enterKey()], ["مستوى أعلى", upKey()], ["أعلى وأسفل", "↑ ↓"]] },
    { name: "التحديد", items: [["تحديد الصف", "Space"], ["تحديد نطاق", "Shift+↑ ↓"], ["تحديد الكل", "Ctrl+A"], ["إلغاء التحديد", "Esc"]] },
    { name: "الإجراءات", items: [["نقل إلى الحجر", "Delete"], ["تراجع", "Ctrl+Z"], ["نسخ المسار", "Ctrl+Shift+C"], ["فتح في المستكشف", "Ctrl+Enter"]] },
  ];
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="ks" className="card dialog" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2 id="ks" className="card-title">الاختصارات</h2>
        <div className="shortcut-groups">
          {groups.map((g) => (
            <div key={g.name} className="line-item">
              <h3 className="label muted">{g.name}</h3>
              {g.items.map(([what, keys]) => (
                <div key={what} className="shortcut-row"><span>{what}</span><kbd>{keys}</kbd></div>
              ))}
            </div>
          ))}
        </div>
        <p className="muted line-item">الأسهم تتبع اتجاه القراءة: في الواجهة العربية السهم الأيسر يدخل للمجلد والأيمن يرجع، والعكس في الإنجليزية.</p>
        <div className="actions-row line-item"><button type="button" className="btn" autoFocus onClick={onClose}>إغلاق</button></div>
      </div>
    </div>
  );
}

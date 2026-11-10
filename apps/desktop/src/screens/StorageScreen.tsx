import { useEffect, useMemo, useRef, useState } from "react";
import { askToClean, useTreeVersion } from "../clean-session";
import { reasonText } from "../clean-text";
import { FolderList, KIND_COLOR } from "../components/FolderList";
import { Badges } from "../components/Badges";
import { Treemap, type MapItem } from "../components/Treemap";
import { engine, Flag, type Candidate, type Drive, type NodeDto, type SortKey } from "../engine";
import { ago, middle, num, size, type Unit } from "../format";
import { groupTotals } from "../file-kinds";
import { go, href } from "../routes";
import { startScan, type Session } from "../scan-session";
import { updateSettings, useSettings } from "../settings";

/** The folder open in each scan, so visiting another screen doesn't lose your place. */
const lastFolder = new Map<number, number>();

const MAP_ITEMS = 40; // largest children drawn on the map; the rest become one "others" cell

const SORTS: { key: SortKey; name: string }[] = [
  { key: "on_disk", name: "على القرص" },
  { key: "apparent", name: "الظاهري" },
  { key: "name", name: "الاسم" },
];

export async function scanAndShow(root: string, drive: Drive | null, dedup: boolean, keep = true) {
  // Scan screen only after the session exists: it leaves at once when there is no running scan.
  await startScan(root, drive, dedup, keep);
  go("scan");
}

/** First run: no scan yet. One amber action: scan the system drive. */
function FirstRun({ drives, failed }: { drives: Drive[]; failed?: Session }) {
  const { dedupHardlinks, keepResults } = useSettings();
  const ready = drives.filter((d) => d.ready);
  const main = ready.find((d) => d.kind === "fixed") ?? ready[0];
  const rest = ready.filter((d) => d !== main);
  const [error, setError] = useState<string | null>(null);
  const run = (root: string, d: Drive | null) => scanAndShow(root, d, dedupHardlinks, keepResults).catch((e) => setError(String(e)));
  const pick = async () => {
    const folder = await engine.pickFolder().catch((e) => (setError(String(e)), null));
    if (folder) await run(folder, null);
  };
  return (
    <div className="empty">
      <h1 style={{ fontSize: 26 }}>التخزين</h1>
      {failed ? (
        <p className="note error" role="alert">
          <span>تعذّر فحص <span className="num">{failed.root}</span>: {failed.done?.error}. اختر قرصاً أو مجلداً آخر.</span>
        </p>
      ) : (
        <p className="quiet">لم تفحص أي قرص بعد. افحص قرصاً لتعرف أين ذهبت المساحة: كل مجلد بحجمه الظاهري وحجمه على القرص.</p>
      )}
      <div className="actions">
        {main && (
          <button type="button" className="btn btn-primary" onClick={() => run(main.root, main)}>
            افحص القرص <span className="num">{main.root.replace(/\\$/, "")}</span>
          </button>
        )}
        <button type="button" className="btn" onClick={pick}>اختر مجلداً…</button>
      </div>
      {error && <p role="alert" className="note error"><span>{error}</span></p>}
      {!failed && <BeforeFirstScan />}
      {rest.length > 0 && (
        <section aria-labelledby="other-drives" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="other-drives" className="label muted">أقراص أخرى</h2>
          <div className="drive-cards">
            {rest.map((d) => (
              <DriveCard key={d.root} d={d} onScan={() => run(d.root, d)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** What the first scan needs, and doesn't (Installer board). */
function BeforeFirstScan() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    engine.isAdmin().then(setAdmin, () => setAdmin(false));
  }, []);
  return (
    <section aria-labelledby="before" className="before-first">
      <h2 id="before" className="label muted">قبل أول فحص</h2>
      <div className="line-box"><strong>الفحص العادي يكفي للبداية</strong><p className="muted">ملفاتك ومجلداتك تُقرأ بلا صلاحيات خاصة.</p></div>
      <div className="line-box"><strong>صلاحية المسؤول لقراءة صحة الأقراص</strong><p className="muted">بيانات S.M.A.R.T وسجل الأخطاء ومجلدات النظام فقط. تُطلب عند الحاجة لا من الآن.</p></div>
      <div className="line-box"><strong>بدون إنترنت افتراضياً</strong><p className="muted">لا تحديثات تلقائية ولا إرسال بيانات، إلا إذا فعّلتها.</p></div>
      {admin === false && (
        <div className="actions-row">
          <button
            type="button"
            className="btn"
            onClick={() => void engine.relaunchAsAdmin().then((yes) => !yes && setSaid("ما وافق ويندوز على الصلاحية، فالبرنامج مستمر كما هو."), (e) => setSaid(String(e)))}
          >
            تشغيل كمسؤول
          </button>
          {said && <span role="status" className="small">{said}</span>}
        </div>
      )}
    </section>
  );
}

const letter = (d: Drive) => d.root.replace(/\\$/, "");
const kindName = (d: Drive) => d.label || (d.kind === "removable" ? "قرص منفصل" : d.kind === "network" ? "قرص شبكة" : "");

/** Plain text, for aria-labels. */
function driveName(d: Drive) {
  return `${letter(d)} ${kindName(d)}`.trim();
}

/** Visible name: the letter is an isolated LTR run so "C:" never flips to ":C" inside Arabic. */
function DriveName({ d }: { d: Drive }) {
  return (
    <strong style={{ whiteSpace: "nowrap" }}>
      <span className="num">{letter(d)}</span> <bdi>{kindName(d)}</bdi>
    </strong>
  );
}

function DriveCard({ d, onScan }: { d: Drive; onScan: () => void }) {
  const { unit } = useSettings();
  const used = d.total - d.free;
  return (
    <div className="card drive-card">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <DriveName d={d} />
        <span className="num small muted">{size(used, unit)} / {size(d.total, unit)}</span>
      </div>
      <div className="track"><div className="fill" style={{ width: `${(used / d.total) * 100}%` }} /></div>
      <button type="button" className="btn" onClick={onScan}>افحص</button>
    </div>
  );
}

/** Drive list under the Rail on the Storage screen. */
export function DriveList({ drives, session }: { drives: Drive[]; session: Session | null }) {
  const { unit, dedupHardlinks, keepResults } = useSettings();
  const ready = drives.filter((d) => d.ready);
  if (!ready.length) return null;
  return (
    <div className="drives">
      <h2>الأقراص</h2>
      {ready.map((d) => {
        const current = session?.drive?.root === d.root;
        const used = d.total - d.free;
        return (
          <button
            key={d.root}
            type="button"
            className="drive"
            aria-current={current ? "true" : undefined}
            aria-label={`${current ? "" : "افحص "}${driveName(d)}، مستخدم ${size(used, unit)} من ${size(d.total, unit)}`}
            onClick={() => (current ? go("storage") : void scanAndShow(d.root, d, dedupHardlinks, keepResults))}
          >
            <span className="top">
              <DriveName d={d} />
              <span className="num small muted">{size(used, unit)} / {size(d.total, unit)}</span>
            </span>
            <span className="track" style={{ display: "block", width: "100%", height: 5, background: "var(--line)" }}>
              <span style={{ display: "block", height: 5, width: `${(used / d.total) * 100}%`, background: "var(--data-2)" }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** How the scan splits by kind of file. Every colour has its name and size beside it. */
function KindBar({ scanId, version, unit }: { scanId: number; version: number; unit: Unit }) {
  const [groups, setGroups] = useState<ReturnType<typeof groupTotals>>([]);
  useEffect(() => {
    let live = true;
    engine.kindsOf(scanId).then((k) => live && setGroups(groupTotals(k)), () => {});
    return () => {
      live = false;
    };
  }, [scanId, version]);
  const total = groups.reduce((s, g) => s + g.onDisk, 0);
  if (total === 0) return null;
  return (
    <section className="usage" aria-label="توزيع المساحة حسب النوع">
      <div className="bar" role="img" aria-label={groups.map((g) => `${g.name} ${size(g.onDisk, unit)}`).join("، ")}>
        {groups.map((g) => <div key={g.id} title={`${g.name}: ${size(g.onDisk, unit)}`} style={{ flex: `${g.onDisk} 1 0px`, background: g.color }} />)}
      </div>
      <div className="legend">
        {groups.map((g) => (
          <span key={g.id}><span className="swatch" style={{ background: g.color }} />{g.name} <span className="num muted">{size(g.onDisk, unit)}</span></span>
        ))}
      </div>
    </section>
  );
}

/** Whole-drive scans: what the scan found against what Windows says is used. */
function DriveUsage({ root, drive, unit, dedup }: { root: NodeDto; drive: Drive; unit: Unit; dedup: boolean }) {
  const used = drive.total - drive.free;
  const found = root.onDisk;
  const other = Math.max(0, used - found);
  const over = Math.max(0, found - used);
  const label =
    over > 0
      ? `${size(used, unit)} مستخدمة من ${size(drive.total, unit)} حسب ويندوز. الفحص وجد ${size(found, unit)}، أي أكثر بمقدار ${size(over, unit)}. المتاح ${size(drive.free, unit)}.`
      : `${size(used, unit)} مستخدمة من ${size(drive.total, unit)}: الفحص وجد ${size(found, unit)}، والباقي ${size(other, unit)} للنظام أو تعذّرت قراءته. المتاح ${size(drive.free, unit)}.`;
  return (
    <section className="usage" aria-label="مساحة القرص">
      <div className="bar" role="img" aria-label={label}>
        {/* The bar is the drive: the found part can't be drawn wider than what is used. */}
        <div style={{ flex: `${Math.min(found, used)} 1 0px`, background: "var(--data-2)" }} />
        {other > 0 && <div style={{ flex: `${other} 1 0px`, background: "var(--data-grey)" }} />}
        {drive.free > 0 && <div className="free" style={{ flex: `${drive.free} 1 0px` }} />}
      </div>
      <div className="legend">
        <span>
          <span className="swatch" style={{ background: "var(--data-2)" }} />
          ما وجده الفحص <span className="num muted">{size(found, unit)}</span>
        </span>
        {other > 0 && (
          <span>
            <span className="swatch" style={{ background: "var(--data-grey)" }} />
            النظام وما تعذّرت قراءته <span className="num muted">{size(other, unit)}</span>
          </span>
        )}
        <span>
          <span className="swatch" style={{ border: "1px dashed var(--line-strong)" }} />
          متاح <span className="num muted">{size(drive.free, unit)}</span>
        </span>
      </div>
      {over > 0 && (
        <p className="muted small">
          وجد الفحص <span className="num">{size(over, unit)}</span> أكثر مما يذكره ويندوز (
          <span className="num">{size(used, unit)}</span> مستخدمة).{" "}
          {dedup ? (
            "السبب أن الحجم على القرص هنا تقديري: الملفات الصغيرة جداً تُحسب بكتلة كاملة."
          ) : (
            <>
              السبب غالباً الروابط الصلبة: الملف الواحد يُحسب هنا مرة لكل مسار، والملفات الصغيرة جداً تُحسب بكتلة كاملة.{" "}
              <a href={href("settings")} className="accent-text">احسب الروابط الصلبة مرة واحدة من الإعدادات</a>
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** Folders Windows wouldn't list: shown rather than quietly missing from the totals (States board). */
function DeniedFolders({ scanId, count, sessionRoot, version, onOpen }: {
  scanId: number;
  count: number;
  sessionRoot: string;
  version: number;
  onOpen: (id: number) => void;
}) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [admin, setAdmin] = useState(true);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    engine.isAdmin().then(setAdmin, () => setAdmin(true));
    setList(null);
  }, [scanId, version]);
  const show = () => void engine.deniedFolders(scanId).then(setList, (e) => setSaid(String(e)));
  return (
    <section className="note warn denied" aria-label="مجلدات تعذرت قراءتها" style={{ display: "block" }}>
      <p style={{ margin: 0 }}>
        تعذرت قراءة <span className="num">{num(count)}</span> مجلد، فالأحجام المعروضة ممكن تكون أقل من الحقيقة.
        {admin ? " حتى كمسؤول، النظام بيمنع بعضها." : " السبب غالباً نقص الصلاحيات."}
      </p>
      <div className="actions-row" style={{ marginTop: 8 }}>
        {!admin && (
          <button
            type="button"
            className="btn"
            onClick={() => void engine.relaunchAsAdmin(sessionRoot).then((yes) => !yes && setSaid("ما وافق ويندوز على الصلاحية، فالبرنامج مستمر كما هو."), (e) => setSaid(String(e)))}
          >
            إعادة الفحص كمسؤول
          </button>
        )}
        <button type="button" className="btn" onClick={() => (list ? setList(null) : show())}>{list ? "إخفاء المجلدات" : "عرض المجلدات"}</button>
        {said && <span role="status" className="small">{said}</span>}
      </div>
      {list && (
        <div className="denied-list" style={{ marginTop: 8 }}>
          {list.map((c) => (
            <div key={c.node.id} className="line-item quarantine-row">
              <span className="path small grow" title={c.path}>{middle(c.path, 80)}</span>
              {c.node.parent !== null && <button type="button" className="btn" onClick={() => onOpen(c.node.parent as number)}>اعرضه</button>}
            </div>
          ))}
          {count > list.length && <p className="muted small">أول <span className="num">{num(list.length)}</span> مجلد.</p>}
        </div>
      )}
    </section>
  );
}

function Results({ session }: { session: Session }) {
  const { unit, dedupHardlinks, keepResults, level } = useSettings();
  const simple = level === "simple";
  const scanId = session.id;
  const [folderId, setFolderId] = useState(lastFolder.get(session.id) ?? session.done?.rootId ?? 0);
  const version = useTreeVersion();
  const [chain, setChain] = useState<NodeDto[]>([]);
  const [mapKids, setMapKids] = useState<NodeDto[]>([]);
  const [sort, setSort] = useState<SortKey>("on_disk");
  const [selected, setSelected] = useState<NodeDto | null>(null);
  const [checked, setChecked] = useState<Map<number, NodeDto>>(new Map());
  const [detailPath, setDetailPath] = useState("");
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  // Splitter & Layout state
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const v = localStorage.getItem("jard.storage.splitRatio");
      return v ? Math.max(20, Math.min(80, Number(v))) : 48;
    } catch {
      return 48;
    }
  });
  const [splitMode, setSplitMode] = useState<"split" | "tree-only" | "map-only">("split");
  const [isDragging, setIsDragging] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);

  // Map depth & nested items
  const [mapDepth, setMapDepth] = useState<number>(2);
  const [nestedKids, setNestedKids] = useState<Map<number, NodeDto[]>>(new Map());

  // Split drag handler
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const onMove = (ev: MouseEvent) => {
      if (!panesRef.current) return;
      const rect = panesRef.current.getBoundingClientRect();
      const rtl = document.documentElement.dir === "rtl";
      const fraction = rtl
        ? (rect.right - ev.clientX) / rect.width
        : (ev.clientX - rect.left) / rect.width;
      const p = Math.max(20, Math.min(80, Math.round(fraction * 100)));
      setSplitRatio(p);
      try {
        localStorage.setItem("jard.storage.splitRatio", String(p));
      } catch {}
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Fetch nested children for treemap when mapDepth >= 2
  useEffect(() => {
    if (mapDepth <= 1 || !mapKids.length) {
      setNestedKids(new Map());
      return;
    }
    let live = true;
    const dirs = mapKids.filter((n) => n.isDir && n.childCount > 0).slice(0, 10);
    const mapSort: SortKey = sort === "apparent" ? "apparent" : "on_disk";
    Promise.all(
      dirs.map(async (d) => {
        const kids = await engine.getChildren(scanId, d.id, mapSort, 12).catch(() => []);
        return [d.id, kids] as const;
      }),
    ).then((entries) => {
      if (live) setNestedKids(new Map(entries));
    });
    return () => {
      live = false;
    };
  }, [scanId, mapKids, mapDepth, sort, version]);

  const folder = chain[chain.length - 1];
  const root = chain[0];
  // For the window-wide key handler, which is only set up once.
  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const folderRef = useRef(folder);
  folderRef.current = folder;

  useEffect(() => {
    let live = true;
    engine.getAncestors(scanId, folderId).then((c) => live && setChain(c));
    const mapSort: SortKey = sort === "apparent" ? "apparent" : "on_disk";
    engine.getChildren(scanId, folderId, mapSort, MAP_ITEMS + 1).then((k) => live && setMapKids(k));
    return () => {
      live = false;
    };
  }, [scanId, folderId, sort, version]);

  // Sizes changed, or the selected things are gone: selections would point at nothing.
  useEffect(() => {
    setSelected(null);
    setChecked(new Map());
  }, [version]);

  const shown = selected ?? folder ?? null;
  useEffect(() => {
    if (!shown) return;
    let live = true;
    engine.getPath(scanId, shown.id).then((p) => live && setDetailPath(p));
    return () => {
      live = false;
    };
  }, [scanId, shown]);

  const open = (n: NodeDto) => {
    lastFolder.set(scanId, n.id);
    setFolderId(n.id);
    setSelected(null);
    setChecked(new Map());
  };
  const toggle = (n: NodeDto) => {
    setSelected(n);
    setChecked((m) => {
      const next = new Map(m);
      if (next.has(n.id)) next.delete(n.id);
      else next.set(n.id, n);
      return next;
    });
  };

  // A folder picked from the command palette.
  useEffect(() => {
    const on = (e: Event) => open({ id: (e as CustomEvent<number>).detail } as NodeDto);
    window.addEventListener("jard:show-node", on);
    return () => window.removeEventListener("jard:show-node", on);
  }, []);

  // The shortcuts that act on what's selected (Shortcuts board). Typing in a field is left alone.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input:not([type=checkbox]), textarea, [role=dialog]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const current = [...checkedRef.current.values()];
      if (e.key === "Escape" && current.length) {
        setChecked(new Map());
      } else if (ctrl && e.key.toLowerCase() === "a" && folderRef.current) {
        e.preventDefault();
        void engine.getChildren(scanId, folderRef.current.id, "on_disk", 20_000).then((kids) => {
          setChecked(new Map(kids.filter((n) => !n.protected).map((n) => [n.id, n])));
        });
      } else if (e.key === "Delete") {
        const picks = current.length ? current : selectedRef.current && !selectedRef.current.protected ? [selectedRef.current] : [];
        if (picks.length) {
          e.preventDefault();
          askToClean({ scanId, nodes: picks, from: "storage" });
        }
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "c" && selectedRef.current) {
        e.preventDefault();
        void engine.getPath(scanId, selectedRef.current.id).then((p) => navigator.clipboard.writeText(p)).then(
          () => setNotice({ kind: "info", text: "نُسخ المسار." }),
          (err) => setNotice({ kind: "error", text: String(err) }),
        );
      } else if (ctrl && e.key === "Enter" && selectedRef.current) {
        e.preventDefault();
        void engine.reveal(scanId, selectedRef.current.id).catch((err) => setNotice({ kind: "error", text: String(err) }));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [scanId]);

  const metric = (n: NodeDto) => (sort === "apparent" ? n.apparent : n.onDisk);
  const mapItems: MapItem[] = useMemo(() => {
    if (!folder) return [];
    const top = mapKids.slice(0, MAP_ITEMS);
    const items: MapItem[] = top.map((n) => {
      const sub = nestedKids.get(n.id);
      const children: MapItem[] | undefined =
        sub && sub.length > 0
          ? sub.map((c) => ({
              node: c,
              name: c.name,
              value: metric(c),
              color: c.isDir ? KIND_COLOR.dir : KIND_COLOR.file,
            }))
          : undefined;
      return {
        node: n,
        name: n.name,
        value: metric(n),
        color: n.isDir ? KIND_COLOR.dir : KIND_COLOR.file,
        children,
      };
    });
    const rest = metric(folder) - top.reduce((s, n) => s + metric(n), 0);
    const hidden = folder.childCount - top.length;
    if (hidden > 0 && rest > 0) items.push({ node: null, name: `${num(hidden)} عنصراً أصغر`, value: rest, color: KIND_COLOR.others });
    return items;
  }, [mapKids, folder, sort, nestedKids]);

  if (!folder || !root) return <p className="muted" role="status">يحمّل…</p>;

  const picked = [...checked.values()];
  const pickedSize = picked.reduce((s, n) => s + n.onDisk, 0);
  const finished = session.finishedAt ?? Date.now();
  const exportJson = async () => {
    try {
      const path = await engine.pickSavePath("jard-scan.json");
      if (!path) return;
      await engine.exportJson(scanId, path);
      setNotice({ kind: "info", text: `حُفظت نتيجة الفحص في ${path}` });
    } catch (e) {
      setNotice({ kind: "error", text: String(e) });
    }
  };
  const reveal = (n: NodeDto) => engine.reveal(scanId, n.id).catch((e) => setNotice({ kind: "error", text: String(e) }));
  const rescan = () => void scanAndShow(session.root, session.drive, dedupHardlinks, keepResults);

  return (
    <>
      <header className="page-head">
        <div className="title">
          <nav aria-label="المسار" className="crumbs">
            {chain.slice(0, -1).map((c) => (
              <span key={c.id} style={{ display: "contents" }}>
                <button type="button" onClick={() => open(c)} dir="auto">{c.name.replace(/\\$/, "")}</button>
                <span className="muted" aria-hidden="true">/</span>
              </span>
            ))}
            <h1 className="name">{folder.name.replace(/\\$/, "") || folder.name}</h1>
          </nav>
          <p className="muted small">
            آخر فحص {ago(finished)} · <span className="num">{num(root.files)}</span> ملف ·{" "}
            <span className="num">{num(root.dirs)}</span> مجلد
          </p>
        </div>
        {chain.length > 1 && (
          <button type="button" className="btn" onClick={() => open(chain[chain.length - 2]!)}>مستوى أعلى</button>
        )}
        {!simple && (
          <div className="seg" role="group" aria-label="الوحدة">
            {(["GB", "GiB"] as Unit[]).map((u) => (
              <button key={u} type="button" className="num" aria-pressed={u === unit} onClick={() => updateSettings({ unit: u })}>{u}</button>
            ))}
          </div>
        )}
        {!simple && <button type="button" className="btn" onClick={exportJson}>تصدير</button>}
        <button type="button" className="btn btn-primary" onClick={rescan}>فحص جديد</button>
      </header>

      {session.done?.rootGone ? (
        <p className="note warn" role="status">
          <span>انفصل <span className="num">{session.root}</span> أثناء الفحص، أو انتقل من مكانه. ما انقرأ قبلها ظاهر هنا، وأرقامه أقل من الحقيقة. أعد توصيله وأعد الفحص.</span>
          <button type="button" className="btn" onClick={rescan}>أعد الفحص</button>
          <a className="btn" href={href("drives")}>عرض الأقراص</a>
        </p>
      ) : session.done?.partial && (
        <p className="note warn" role="status">
          <span>
            {session.progress?.cancelled
              ? "أوقفت الفحص قبل أن يكتمل. ما قُرئ يظهر هنا، والمجلدات غير المكتملة عليها شارة «جزئي»."
              : "لم يكتمل قراءة بعض المجلدات، فأرقامها أقل من الحقيقة. عليها شارة «جزئي»."}
          </span>
          <button type="button" className="btn" onClick={rescan}>أعد الفحص</button>
        </p>
      )}
      {root.denied > 0 && <DeniedFolders scanId={scanId} count={root.denied} sessionRoot={session.root} version={version} onOpen={(id) => open({ id } as NodeDto)} />}
      {notice && (
        <p className={`note ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="btn" onClick={() => setNotice(null)}>حسناً</button>
        </p>
      )}

      <p className="muted small">
        الأرقام مختلفة عن مستكشف ويندوز؟ <a className="accent-text" href={href("truth")}>ليش الأرقام تختلف</a>
      </p>
      {session.drive && folder.id === root.id && <DriveUsage root={root} drive={session.drive} unit={unit} dedup={session.dedup} />}
      {folder.id === root.id && <KindBar scanId={scanId} version={version} unit={unit} />}

      {/* Layout Presets Toolbar */}
      <div className="layout-bar">
        <div className="layout-presets" role="group" aria-label="توزيع اللوحات">
          <span className="small muted">عرض اللوحات:</span>
          <button
            type="button"
            className={`preset-btn ${splitMode === "split" && splitRatio === 50 ? "active" : ""}`}
            onClick={() => {
              setSplitMode("split");
              setSplitRatio(50);
            }}
            title="تقسيم متساوي (50% / 50%)"
          >
            50/50
          </button>
          <button
            type="button"
            className={`preset-btn ${splitMode === "split" && splitRatio === 65 ? "active" : ""}`}
            onClick={() => {
              setSplitMode("split");
              setSplitRatio(65);
            }}
            title="شجرة أوسع (65% شجرة / 35% خريطة)"
          >
            شجرة أوسع
          </button>
          <button
            type="button"
            className={`preset-btn ${splitMode === "split" && splitRatio === 35 ? "active" : ""}`}
            onClick={() => {
              setSplitMode("split");
              setSplitRatio(35);
            }}
            title="خريطة أوسع (35% شجرة / 65% خريطة)"
          >
            خريطة أوسع
          </button>
          <button
            type="button"
            className={`preset-btn ${splitMode === "tree-only" ? "active" : ""}`}
            onClick={() => setSplitMode(splitMode === "tree-only" ? "split" : "tree-only")}
            title="عرض الشجرة فقط"
          >
            شجرة فقط
          </button>
          <button
            type="button"
            className={`preset-btn ${splitMode === "map-only" ? "active" : ""}`}
            onClick={() => setSplitMode(splitMode === "map-only" ? "split" : "map-only")}
            title="عرض الخريطة فقط"
          >
            خريطة فقط
          </button>
        </div>
      </div>

      <div className="panes" ref={panesRef} data-dragging={isDragging}>
        {splitMode !== "map-only" && (
          <section
            className="list card"
            aria-labelledby="list-title"
            style={{
              flex: splitMode === "tree-only" ? "1 1 100%" : `0 0 calc(${splitRatio}% - 5px)`,
              maxWidth: splitMode === "tree-only" ? "100%" : `calc(${splitRatio}% - 5px)`,
            }}
          >
            <div className="list-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 id="list-title" className="label muted">المحتويات · <span className="num">{num(folder.childCount)}</span></h2>
                {splitMode === "tree-only" && (
                  <button
                    type="button"
                    className="preset-btn"
                    onClick={() => {
                      setSplitMode("split");
                      setSplitRatio(50);
                    }}
                    title="الرجوع إلى عرض الشجرة بجانب الخريطة"
                  >
                    إظهار الخريطة (50/50)
                  </button>
                )}
              </div>
              <div className="seg" role="group" aria-label="الترتيب">
                {SORTS.filter((s) => !simple || s.key !== "apparent").map((s) => (
                  <button key={s.key} type="button" aria-pressed={s.key === sort} onClick={() => setSort(s.key)}>{s.name}</button>
                ))}
              </div>
            </div>
            <FolderList
              scanId={scanId}
              parent={folder}
              sort={sort}
              unit={unit}
              selectedId={selected?.id ?? null}
              checked={checked}
              version={version}
              onOpen={open}
              onUp={() => chain.length > 1 && open(chain[chain.length - 2]!)}
              onSelect={setSelected}
              onToggle={toggle}
              onCheck={(n) => setChecked((m) => (m.has(n.id) || n.protected ? m : new Map(m).set(n.id, n)))}
            />
          </section>
        )}

        {splitMode === "split" && (
          <div
            className="splitter-bar"
            data-dragging={isDragging}
            onMouseDown={startDrag}
            title="اسحب لتعديل العرض بين الشجرة والخريطة"
            role="separator"
            aria-orientation="vertical"
            aria-label="تعديل العرض بين الشجرة والخريطة"
          >
            <div className="splitter-handle" />
          </div>
        )}

        {splitMode !== "tree-only" && (
          <section
            className="map"
            aria-labelledby="map-title"
            style={{
              flex: splitMode === "map-only" ? "1 1 100%" : `1 1 calc(${100 - splitRatio}% - 5px)`,
              maxWidth: splitMode === "map-only" ? "100%" : `calc(${100 - splitRatio}% - 5px)`,
              minWidth: 0,
            }}
          >
            <div className="map-toolbar">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 id="map-title" className="label muted">خريطة المساحة</h2>
                {splitMode === "map-only" && (
                  <button
                    type="button"
                    className="preset-btn"
                    onClick={() => {
                      setSplitMode("split");
                      setSplitRatio(50);
                    }}
                    title="الرجوع إلى عرض الشجرة بجانب الخريطة"
                  >
                    إظهار الشجرة (50/50)
                  </button>
                )}
                {chain.length > 1 && (
                  <button
                    type="button"
                    className="drill-btn"
                    onClick={() => open(chain[chain.length - 2]!)}
                    title="الرجوع للمجلد الأب"
                  >
                    مستوى أعلى ↵
                  </button>
                )}
              </div>
              <div className="seg" role="group" aria-label="عمق تفريغ الخريطة">
                <span className="small muted">تفرّع الكتل:</span>
                <button type="button" aria-pressed={mapDepth === 1} onClick={() => setMapDepth(1)} title="مستوى واحد">مستوى 1</button>
                <button type="button" aria-pressed={mapDepth === 2} onClick={() => setMapDepth(2)} title="مستويان (كتل متداخلة)">مستوى 2</button>
              </div>
            </div>
            <Treemap
              items={mapItems}
              unit={unit}
              selectedId={selected?.id ?? null}
              onActivate={(item) => {
                if (!item.node) return;
                if (item.node.isDir && item.node.childCount > 0) open(item.node);
                else setSelected(item.node);
              }}
            />
            <div className="legend">
              <span><span className="swatch" style={{ background: KIND_COLOR.dir }} />مجلد</span>
              <span><span className="swatch" style={{ background: KIND_COLOR.file }} />ملف</span>
              <span><span className="swatch" style={{ background: KIND_COLOR.others }} />عناصر أصغر مجمّعة</span>
              <span className="muted">المساحة حسب {sort === "apparent" ? "الحجم الظاهري" : "الحجم على القرص"}</span>
            </div>
          </section>
        )}
      </div>

      {picked.length > 0 && (
        <section className="pickbar" aria-label="المحدد">
          <strong role="status">
            تم تحديد <span className="num">{num(picked.length)}</span> · <span className="num">{size(pickedSize, unit)}</span> على القرص
          </strong>
          <button type="button" className="btn" onClick={() => setChecked(new Map())}>إلغاء التحديد</button>
          <button type="button" className="btn" onClick={() => askToClean({ scanId, nodes: picked, from: "storage" })}>نقل إلى الحجر</button>
        </section>
      )}

      {shown && (
        <section className="detail" aria-label="تفاصيل المحدد">
          <span className="path" title={detailPath} aria-label={detailPath}>{middle(detailPath, 90)}</span>
          <span className="facts" hidden={simple}>
            <span>ظاهري <span className="num">{size(shown.apparent, unit)}</span></span>
            <span>على القرص <span className="num">{size(shown.onDisk, unit)}</span></span>
            <span title="سحابي غير منزّل + نسخ إضافية من روابط صلبة">
              لا يُحسب <span className="num">{size(shown.cloudBytes + shown.dedupBytes, unit)}</span>
            </span>
            {shown.isDir && <span><span className="num">{num(shown.files)}</span> ملف</span>}
            {shown.denied > 0 && <span>تعذّرت قراءة <span className="num">{num(shown.denied)}</span></span>}
          </span>
          <Badges flags={shown.flags} skip={shown.isDir ? 0 : Flag.PARTIAL} />
          {shown.protected && <span className="badge" title={reasonText(shown.protected)}>مسار محمي<span className="sr-only">: {reasonText(shown.protected)}</span></span>}
          <button type="button" className="btn" onClick={() => reveal(shown)}>إظهار في المستكشف</button>
        </section>
      )}
    </>
  );
}

export function StorageScreen({ session, drives }: { session: Session | null; drives: Drive[] }) {
  if (!session) return <FirstRun drives={drives} />;
  if (session.phase === "running") {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 26 }}>التخزين</h1>
        <p className="quiet">الفحص جارٍ. النتائج تظهر هنا حين ينتهي.</p>
        <div className="actions"><button type="button" className="btn btn-primary" onClick={() => go("scan")}>اعرض التقدم</button></div>
      </div>
    );
  }
  if (session.phase === "failed") return <FirstRun drives={drives} failed={session} />;
  // key: a new scan starts at its root with fresh selection
  return <Results key={session.id} session={session} />;
}

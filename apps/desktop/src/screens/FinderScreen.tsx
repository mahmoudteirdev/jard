import { useEffect, useState } from "react";
import { askToClean, useTreeVersion } from "../clean-session";
import { reasonText } from "../clean-text";
import { engine, type FileKind, type NodeDto, type Program, type SearchHit, type SearchQuery, type SimilarPhoto } from "../engine";
import { Leftovers } from "./MoreScreens";
import { explain, KIND_NAMES } from "../file-kinds";
import { middle, num, size } from "../format";
import { go, href } from "../routes";
import type { Session } from "../scan-session";
import { useSettings } from "../settings";

type Tab = "ai" | "all" | "noext" | "empty" | "similar" | "left";

let requestedTab: Tab | null = null;

/** Opens the search screen on one tab, from another screen. */
export function openFinderOn(tab: Tab) {
  requestedTab = tab;
  go("finder");
}

const TABS: { id: Tab; name: string }[] = [
  { id: "ai", name: "استعلام ذكي ⚡" },
  { id: "all", name: "الأكبر" },
  { id: "noext", name: "بلا امتداد" },
  { id: "empty", name: "مجلدات فارغة" },
  { id: "similar", name: "صور متشابهة" },
  { id: "left", name: "بقايا برامج" },
];
const YEAR = 365 * 86_400;

function LeftoversTab({ session }: { session: Session | null }) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  useEffect(() => {
    engine.installedPrograms().then(setPrograms, () => setPrograms([]));
  }, []);
  if (!programs) return <p className="muted" role="status">يقرأ البرامج المثبتة…</p>;
  return <Leftovers session={session} programs={programs} />;
}

/** Photos of the same shot: the person looks and chooses. Nothing is picked for them. */
function SimilarPhotos({ scanId, version }: { scanId: number; version: number }) {
  const { unit } = useSettings();
  const [groups, setGroups] = useState<SimilarPhoto[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Map<number, NodeDto>>(new Map());

  useEffect(() => {
    setGroups(null);
    setChecked(new Map());
  }, [scanId, version]);

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      setGroups(await engine.findSimilarPhotos(scanId));
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  if (!groups) {
    return (
      <div className="empty" style={{ paddingTop: 8 }}>
        <p className="quiet">يفتح صورك ليقارن شكلها، على هذا الجهاز فقط، فممكن ياخد وقت. الصور السحابية لا تُقرأ حتى لا تُنزَّل.</p>
        {error && <p className="note error" role="alert"><span>{error}</span></p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void find()}>{busy ? "يقارن الصور…" : "ابحث عن صور متشابهة"}</button>
        </div>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="empty" style={{ paddingTop: 8 }}>
        <p className="quiet">ما لقينا صوراً متشابهة في هذا الفحص.</p>
        <div className="actions"><a className="btn" href={href("cleanup")}>افتح التنظيف</a></div>
      </div>
    );
  }
  const picked = [...checked.values()];
  const toggle = (n: NodeDto) =>
    setChecked((m) => {
      const next = new Map(m);
      if (next.has(n.id)) next.delete(n.id);
      else next.set(n.id, n);
      return next;
    });
  return (
    <>
      <section className="card" aria-label="مجموعات الصور">
        <p className="muted line-item" role="status">
          <span className="num">{num(groups.length)}</span> مجموعة. متشابهة جداً، وليست نسخاً مطابقة: اختر الأوضح واحذف الباقي بنفسك.
        </p>
        {groups.map((g) => (
          <div key={g[0]!.node.id} className="similar-group">
            <div className="similar-row">
              {g.map((p, i) => (
                <label key={p.node.id} className="similar-photo" data-checked={checked.has(p.node.id)} title={p.path}>
                  {p.thumbnail ? <img src={p.thumbnail} alt={p.node.name} /> : <span className="muted small">ما قدرنا نعرض الصورة</span>}
                  <span className="name">{p.node.name}</span>
                  <span className="muted label"><span className="num">{p.width}×{p.height}</span> · <span className="num">{size(p.node.onDisk, unit)}</span></span>
                  <span className="pick-line">
                    <input type="checkbox" disabled={!!p.node.protected} checked={checked.has(p.node.id)} onChange={() => toggle(p.node)} />
                    <span className="small">{i === 0 ? "الأعلى دقة" : "تحديد"}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>
      {picked.length > 0 && (
        <section className="pickbar" aria-label="المحدد">
          <strong role="status">تم تحديد <span className="num">{num(picked.length)}</span> · <span className="num">{size(picked.reduce((s, n) => s + n.onDisk, 0), unit)}</span></strong>
          <button type="button" className="btn" onClick={() => setChecked(new Map())}>إلغاء التحديد</button>
          <button type="button" className="btn" onClick={() => askToClean({ scanId, nodes: picked, from: "finder" })}>نقل إلى الحجر</button>
        </section>
      )}
    </>
  );
}

/** Find by name and filters across the last scan, with a plain answer to "what is this?". */
export function FinderScreen({ session }: { session: Session | null }) {
  const { unit } = useSettings();
  const version = useTreeVersion();
  const scanId = session?.phase === "done" ? session.id : null;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FileKind | "">("");
  const [minMb, setMinMb] = useState(0);
  const [oldOnly, setOldOnly] = useState(false);
  const [tab, setTab] = useState<Tab>(() => {
    const t = requestedTab ?? "all";
    requestedTab = null;
    return t;
  });
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [cur, setCur] = useState<SearchHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiTotalBytes, setAiTotalBytes] = useState<number>(0);
  const [aiBusy, setAiBusy] = useState(false);

  const runAiSearch = async (promptToRun: string) => {
    if (!promptToRun.trim() || scanId === null) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await engine.searchNaturalQuery(scanId, promptToRun);
      setHits(res.hits);
      setCur(res.hits[0] ?? null);
      setAiExplanation(res.parsed.explanationAr || res.parsed.explanationEn);
      setAiTotalBytes(res.totalMatchedBytes);
    } catch (e) {
      setError(String(e));
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    if (scanId === null) return;
    if (tab === "ai") return;
    let live = true;
    const q: SearchQuery = {
      text,
      minSize: minMb * 1_000_000,
      noExtension: tab === "noext",
      emptyFolders: tab === "empty",
    };
    if (kind) q.kind = kind;
    if (oldOnly) q.olderThan = Math.floor(Date.now() / 1000) - YEAR;
    // Small wait while typing: a big drive has millions of names to check.
    const t = setTimeout(() => {
      engine.searchScan(scanId, q).then(
        (h) => {
          if (!live) return;
          setHits(h);
          setCur(h[0] ?? null);
        },
        (e) => live && setError(String(e)),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [scanId, text, kind, minMb, oldOnly, tab, version]);

  if (scanId === null) {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 26 }}>البحث</h1>
        <p className="quiet">البحث يتم داخل نتيجة الفحص، بدون قراءة القرص من جديد. افحص قرصاً أولاً.</p>
        <div className="actions"><a className="btn btn-primary" href={href("storage")}>افتح التخزين</a></div>
      </div>
    );
  }

  const ex = cur ? explain(cur.node.name, cur.kind, cur.node.isDir) : null;
  const clearFilters = () => {
    setText("");
    setKind("");
    setMinMb(0);
    setOldOnly(false);
    setTab("all");
  };

  return (
    <>
      <header className="page-head"><div className="title"><h1>البحث</h1></div></header>
      <div role="tablist" aria-label="تصنيفات" className="tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>{t.name}</button>
        ))}
      </div>

      {tab === "ai" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAiSearch(aiPrompt);
            }}
            style={{ display: "flex", gap: 8, alignItems: "stretch" }}
          >
            <input
              type="search"
              className="input"
              style={{ flex: 1, fontSize: 14 }}
              value={aiPrompt}
              placeholder="اكتب استعلامك باللغة الطبيعية... مثال: الفيديوهات الأكبر من 500 ميغا في التنزيلات"
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={aiBusy || !aiPrompt.trim()}>
              {aiBusy ? "يحلل…" : "استعلم بالذكاء الاصطناعي ⚡"}
            </button>
          </form>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <span className="muted small" style={{ alignSelf: "center" }}>أمثلة جاهزة:</span>
            {[
              "الفيديوهات الأكبر من 500 ميغا",
              "المستندات القديمة المهجورة من 6 شهور",
              "المجلدات الفارغة",
              "المثبتات الكبيرة والملفات المضغوطة",
              "videos larger than 1gb",
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                className="btn btn-sm"
                style={{ fontSize: 12, padding: "4px 8px" }}
                onClick={() => {
                  setAiPrompt(chip);
                  void runAiSearch(chip);
                }}
              >
                {chip}
              </button>
            ))}
          </div>
          {aiExplanation && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--bg-layer-2, #f5f5f5)", borderInlineStart: "3px solid var(--accent, #000)" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>⚡ تفسير محرك الذكاء الاصطناعي المحلي:</div>
              <div className="muted small">
                المعايير المطبقة: <strong>{aiExplanation}</strong> · المساحة الإجمالية للمطابقات: <strong>{size(aiTotalBytes, unit)}</strong>
              </div>
            </div>
          )}
        </section>
      )}

      {tab !== "ai" && tab !== "similar" && tab !== "left" && (
        <form className="filters" aria-label="فلاتر" onSubmit={(e) => e.preventDefault()}>
          <label className="field grow-2">
            <span className="muted small">الاسم</span>
            <input type="search" className="input" value={text} placeholder="جزء من اسم الملف" onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="field">
            <span className="muted small">النوع</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as FileKind | "")}>
              <option value="">الكل</option>
              {Object.entries(KIND_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="muted small">الحجم</span>
            <select className="input" value={minMb} onChange={(e) => setMinMb(Number(e.target.value))}>
              <option value={0}>أي حجم</option>
              <option value={100}>أكبر من 100 MB</option>
              <option value={1000}>أكبر من 1 GB</option>
            </select>
          </label>
          <label className="choice" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={oldOnly} onChange={(e) => setOldOnly(e.target.checked)} />
            أقدم من سنة
          </label>
        </form>
      )}
      {error && <p className="note error" role="alert"><span>{error}</span></p>}

      {tab === "similar" ? (
        <SimilarPhotos scanId={scanId} version={version} />
      ) : tab === "left" ? (
        <LeftoversTab session={session} />
      ) : hits === null ? (
        <p className="muted" role="status">يبحث…</p>
      ) : hits.length === 0 ? (
        <div className="empty" style={{ paddingTop: 8 }}>
          <p className="quiet">ما في نتائج بهذه الفلاتر.</p>
          <div className="actions"><button type="button" className="btn" onClick={clearFilters}>مسح الفلاتر</button></div>
        </div>
      ) : (
        <div className="history">
          <section className="card" aria-label="النتائج" style={{ flex: "2 1 460px", minWidth: 0 }}>
            <div className="muted label line-item" role="status">{hits.length >= 300 ? "أكبر 300 نتيجة" : `${hits.length} نتيجة`}</div>
            {hits.map((h) => (
              <button
                key={h.node.id}
                type="button"
                className="hit"
                aria-pressed={h.node.id === cur?.node.id}
                onClick={() => setCur(h)}
              >
                <span className="grow">
                  <span className="name" style={{ display: "block", fontWeight: 600 }}>{h.node.name}</span>
                  <span className="path label muted" style={{ display: "block" }} title={h.path}>{middle(h.path, 70)}</span>
                </span>
                <span className="num">{size(h.node.onDisk, unit)}</span>
              </button>
            ))}
          </section>
          {cur && ex && (
            <aside className="card" aria-labelledby="ex" style={{ flex: "1 1 320px", minWidth: 0, position: "sticky", top: 0 }}>
              <h2 id="ex" className="card-title">شو هذا {cur.node.isDir ? "المجلد" : "الملف"}؟</h2>
              <div className="card-body">
                <strong className="name" style={{ fontSize: 18 }}>{cur.node.name}</strong>
                <span className={`badge safety-${ex.safety}`} style={{ alignSelf: "flex-start" }}>{ex.label}</span>
                <p className="quiet">{ex.what}</p>
                <p className="muted small">{ex.action}</p>
                {cur.node.protected && <p className="muted small">مسار محمي: {reasonText(cur.node.protected)}</p>}
                <div className="actions-row">
                  <button type="button" className="btn" onClick={() => void engine.reveal(scanId, cur.node.id).catch((e) => setError(String(e)))}>إظهار في المستكشف</button>
                  {!cur.node.protected && (
                    <button type="button" className="btn" onClick={() => askToClean({ scanId, nodes: [cur.node], from: "finder" })}>نقل إلى الحجر</button>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </>
  );
}

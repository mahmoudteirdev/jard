import { useEffect, useMemo, useState } from "react";
import { askToClean, useTreeVersion } from "../clean-session";
import { noteText } from "../clean-text";
import { engine, type Candidate, type CandidateKind, type DuplicateGroup, type NodeDto } from "../engine";
import { ago, middle, num, size } from "../format";
import { href } from "../routes";
import type { Session } from "../scan-session";
import { useSettings } from "../settings";

type Tab = CandidateKind | "dupes";

const TABS: { id: Tab; name: string; head: string; empty: string }[] = [
  { id: "large", name: "ملفات كبيرة", head: "النوع", empty: "ما في ملفات أكبر من 100 MB." },
  { id: "dupes", name: "مكررات", head: "النسخة الأصلية", empty: "ما في ملفات مكررة أكبر من 1 MB." },
  { id: "temp", name: "مؤقتة", head: "الحالة", empty: "ما لقينا ملفات مؤقتة تستاهل الحذف." },
  { id: "old", name: "قديمة", head: "النوع", empty: "ما في ملفات كبيرة لم تتغير منذ أكثر من سنة." },
];

function Rows(props: {
  list: Candidate[];
  head: string;
  keepOf?: Map<number, string>;
  checked: Map<number, NodeDto>;
  toggle: (n: NodeDto) => void;
}) {
  const { unit } = useSettings();
  return (
    <div className="table-wrap card">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" style={{ width: 48 }}><span className="sr-only">تحديد</span></th>
            <th scope="col">الملف</th>
            <th scope="col">{props.head}</th>
            <th scope="col">آخر تعديل</th>
            <th scope="col" className="end">الحجم على القرص</th>
          </tr>
        </thead>
        <tbody>
          {props.list.map((c) => {
            const keep = props.keepOf?.get(c.node.id);
            return (
              <tr key={c.node.id}>
                <td>
                  <label className="pick">
                    <span className="sr-only">تحديد {c.node.name}</span>
                    <input type="checkbox" checked={props.checked.has(c.node.id)} onChange={() => props.toggle(c.node)} />
                  </label>
                </td>
                <td>
                  <div className="name" style={{ fontWeight: 500 }}>{c.node.name}</div>
                  <div className="path label muted" title={c.path}>{middle(c.path, 80)}</div>
                </td>
                <td className="quiet">
                  {keep ? <span className="path small" title={keep}>{middle(keep, 44)}</span> : noteText(c.note)}
                </td>
                <td className="quiet">{c.node.modified ? ago(c.node.modified * 1000) : "—"}</td>
                <td className="end"><span className="num">{size(c.node.onDisk, unit)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Things worth a look, sorted by kind (Cleanup board). Nothing moves from here without the preview. */
export function CleanupScreen({ session }: { session: Session | null }) {
  const { unit } = useSettings();
  const version = useTreeVersion();
  const [tab, setTab] = useState<Tab>("large");
  const [lists, setLists] = useState<Partial<Record<CandidateKind, Candidate[]>>>({});
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null);
  const [dupesBusy, setDupesBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Map<number, NodeDto>>(new Map());
  const scanId = session?.phase === "done" ? session.id : null;

  // Moved files must drop out of the lists; checks would point at nothing.
  useEffect(() => {
    setLists({});
    setDupes(null);
    setChecked(new Map());
  }, [scanId, version]);

  useEffect(() => {
    if (scanId === null || tab === "dupes" || lists[tab]) return;
    let live = true;
    engine.cleanupCandidates(scanId, tab).then(
      (l) => live && setLists((m) => ({ ...m, [tab]: l })),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [scanId, tab, lists]);

  const findDupes = async () => {
    if (scanId === null) return;
    setDupesBusy(true);
    setError(null);
    try {
      setDupes(await engine.findDuplicates(scanId));
    } catch (e) {
      setError(String(e));
    }
    setDupesBusy(false);
  };

  const dupeList = useMemo(() => (dupes ?? []).flatMap((g) => g.copies), [dupes]);
  const keepOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const g of dupes ?? []) for (const c of g.copies) m.set(c.node.id, g.keep);
    return m;
  }, [dupes]);

  if (scanId === null || !session) {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 24 }}>التنظيف</h1>
        <p className="quiet">
          {session?.phase === "running" ? "الفحص جارٍ. الاقتراحات تظهر هنا حين ينتهي." : "الاقتراحات تُبنى من نتيجة الفحص. افحص قرصاً أولاً."}
        </p>
        <div className="actions"><a className="btn btn-primary" href={href("storage")}>افتح التخزين</a></div>
      </div>
    );
  }

  const toggle = (n: NodeDto) =>
    setChecked((m) => {
      const next = new Map(m);
      if (next.has(n.id)) next.delete(n.id);
      else next.set(n.id, n);
      return next;
    });
  const picked = [...checked.values()];
  const total = picked.reduce((s, n) => s + n.onDisk, 0);
  const current = TABS.find((t) => t.id === tab)!;
  const list = tab === "dupes" ? dupeList : lists[tab];
  const tabSize = (t: Tab) => {
    const l = t === "dupes" ? (dupes ? dupeList : null) : lists[t];
    return l ? size(l.reduce((s, c) => s + c.node.onDisk, 0), unit) : "";
  };

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1>التنظيف</h1>
          <p className="muted small">ما تختاره ينتقل إلى الحجر المؤقت 30 يوماً، وتقدر تسترجعه.</p>
        </div>
        <div style={{ textAlign: "end" }}>
          <div className="label muted">المساحة المحددة</div>
          <div className="num figure accent-text">{size(total, unit)}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={picked.length === 0}
          aria-describedby={picked.length === 0 ? "why-nothing" : undefined}
          onClick={() => askToClean({ scanId, nodes: picked, from: "cleanup" })}
        >
          نقل <span className="num">{num(picked.length)}</span> إلى الحجر
        </button>
      </header>
      {picked.length === 0 && <p id="why-nothing" className="muted small">حدد ملفاً واحداً على الأقل لتتابع.</p>}
      {error && <p className="note error" role="alert"><span>{error}</span></p>}

      <div role="tablist" aria-label="نوع الملفات" className="tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
            {t.name} <span className="num label muted">{tabSize(t.id)}</span>
          </button>
        ))}
      </div>

      {tab === "dupes" && dupes === null ? (
        <div className="empty" style={{ paddingTop: 8 }}>
          <p className="quiet">كشف المكررات يقرأ محتوى الملفات المتشابهة في الحجم، فممكن ياخد وقت على قرص كبير. الملفات السحابية لا تُقرأ حتى لا تُنزَّل.</p>
          <div className="actions">
            <button type="button" className="btn" disabled={dupesBusy} onClick={() => void findDupes()}>
              {dupesBusy ? "يقارن الملفات…" : "ابحث عن المكررات"}
            </button>
          </div>
        </div>
      ) : !list ? (
        <p className="muted" role="status">يحمّل…</p>
      ) : list.length === 0 ? (
        <div className="empty" style={{ paddingTop: 8 }}>
          <p className="quiet">{current.empty}</p>
          <div className="actions"><a className="btn" href={href("storage")}>تصفح التخزين</a></div>
        </div>
      ) : (
        <Rows list={list} head={current.head} keepOf={tab === "dupes" ? keepOf : undefined} checked={checked} toggle={toggle} />
      )}
    </>
  );
}

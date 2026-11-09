import { useCallback, useEffect, useState } from "react";
import { treeChanged } from "../clean-session";
import { failureText, logText } from "../clean-text";
import { engine, type LogEntry, type QuarantineItem } from "../engine";
import { ago, middle, num, size } from "../format";
import { href } from "../routes";
import { useSettings } from "../settings";

const DAY = 86_400;

function ItemRow({ item, onChange, setNotice }: {
  item: QuarantineItem;
  onChange: () => void;
  setNotice: (n: { kind: "info" | "error"; text: string }) => void;
}) {
  const { unit } = useSettings();
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);
  const days = Math.max(0, Math.ceil((item.expiresAt - Date.now() / 1000) / DAY));
  const name = item.original.split(/[\\/]/).pop() || item.original;

  const restore = async (onConflict: "fail" | "keep_both") => {
    const r = await engine.restoreItem(item.id, onConflict);
    if (r.failure?.kind === "conflict") {
      setConflict(true);
      return;
    }
    if (r.failure?.kind === "denied") {
      // Moved with administrator rights, or the folder needs them: ask, for this one item.
      const answer = await engine.elevatedRestore(item.id, onConflict === "keep_both");
      const done = answer.result;
      if (answer.declined || !done) setNotice({ kind: "error", text: `${name}: ما وافق ويندوز على الصلاحية، فبقي في الحجر.` });
      else if (done.failure?.kind === "conflict") {
        setConflict(true);
        return;
      } else if (done.failure) setNotice({ kind: "error", text: `${name}: ${failureText(done.failure)}` });
      else setNotice({ kind: "info", text: `رجع إلى ${done.path}` });
    } else if (r.failure) setNotice({ kind: "error", text: `${name}: ${failureText(r.failure)}` });
    else setNotice({ kind: "info", text: `رجع إلى ${r.path}` });
    treeChanged();
    onChange();
  };
  const remove = async () => {
    let f = await engine.deleteItem(item.id);
    if (f?.kind === "denied") {
      const answer = await engine.elevatedDelete(item.id);
      if (answer.declined) {
        setNotice({ kind: "error", text: `${name}: ما وافق ويندوز على الصلاحية، فبقي في الحجر.` });
        return;
      }
      f = answer.result;
    }
    if (f) setNotice({ kind: "error", text: `${name}: ${failureText(f)}` });
    else setNotice({ kind: "info", text: `حُذف ${name} نهائياً، وتحررت ${size(item.onDisk, unit)}.` });
    onChange();
  };

  return (
    <div className="line-item quarantine-row">
      <span className="grow">
        <span className="name" style={{ display: "block", fontWeight: 500 }}>{name}</span>
        <span className="path label muted" title={item.original} style={{ display: "block" }}>{middle(item.original, 70)}</span>
      </span>
      <span className="num">{size(item.onDisk, unit)}</span>
      <span className="muted small">يُحذف بعد <span className="num">{days}</span> يوماً</span>
      {conflict ? (
        <span className="confirm" role="group" aria-label={`يوجد ملف بنفس الاسم مكان ${name}`}>
          <span className="small">يوجد ملف بنفس الاسم.</span>
          <button type="button" className="btn" onClick={() => void restore("keep_both")}>استرجاع باسم جديد</button>
          <button type="button" className="btn" onClick={() => setConflict(false)}>إلغاء</button>
        </span>
      ) : confirming ? (
        <span className="confirm" role="group" aria-label={`تأكيد حذف ${name}`}>
          <span className="small">ما بنقدر نسترجعه بعدها.</span>
          <button type="button" className="btn btn-danger" onClick={() => void remove()}>حذف نهائي</button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>إلغاء</button>
        </span>
      ) : (
        <span className="actions-row">
          <button type="button" className="btn" aria-label={`استرجاع ${name}`} onClick={() => void restore("fail")}>استرجاع</button>
          <button type="button" className="btn" aria-label={`حذف ${name} نهائياً`} onClick={() => setConfirming(true)}>حذف نهائي</button>
        </span>
      )}
    </div>
  );
}

/** Quarantine and recent operations (History board). */
export function HistoryScreen() {
  const { unit } = useSettings();
  const [items, setItems] = useState<QuarantineItem[] | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    engine.listQuarantine().then(setItems, (e) => setNotice({ kind: "error", text: String(e) }));
    engine.readLog(30).then(setLog, () => setLog([]));
  }, []);
  useEffect(load, [load]);

  const total = (items ?? []).reduce((s, i) => s + i.onDisk, 0);

  return (
    <>
      <header className="page-head"><div className="title"><h1>السجل</h1></div></header>
      {notice && (
        <p className={`note ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="btn" onClick={() => setNotice(null)}>حسناً</button>
        </p>
      )}
      <div className="history">
        <section className="card" aria-labelledby="q" style={{ flex: "3 1 480px" }}>
          <h2 id="q" className="card-title">الحجر المؤقت · <span className="num">{size(total, unit)}</span></h2>
          {items === null ? (
            <p className="muted card-body" role="status">يحمّل…</p>
          ) : items.length === 0 ? (
            <div className="card-body">
              <p className="muted">الحجر فارغ. اللي تنقله من التنظيف بيضل هون 30 يوماً وتقدر تسترجعه.</p>
              <div className="actions-row"><a className="btn" href={href("cleanup")}>افتح التنظيف</a></div>
            </div>
          ) : (
            items.map((i) => <ItemRow key={i.id} item={i} onChange={load} setNotice={setNotice} />)
          )}
        </section>
        <section className="card" aria-labelledby="l" style={{ flex: "2 1 340px" }}>
          <h2 id="l" className="card-title">آخر العمليات</h2>
          {log.length === 0 && <p className="muted card-body">ما في عمليات بعد.</p>}
          {log.map((e, k) => (
            <div key={k} className="line-item">
              <div>
                {logText(e.kind)}: <span className="num">{num(e.count)}</span> {e.kind === "scanned" ? "ملف" : "عنصر"} ·{" "}
                <span className="num">{size(e.bytes, unit)}</span>
              </div>
              <div className="muted small">{ago(e.at * 1000)}</div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { locale } from "../i18n";
import { engine, type FolderChange, type SavedScan, type ScanPoint } from "../engine";
import { daysUntilFull } from "../file-kinds";
import { size, type Unit } from "../format";
import { href } from "../routes";
import type { Session } from "../scan-session";
import { useSettings } from "../settings";

const signed = (bytes: number, unit: Unit) => `${bytes > 0 ? "+" : bytes < 0 ? "−" : ""}${size(Math.abs(bytes), unit)}`;
const day = (at: number) =>
  new Date(at * 1000).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
/** Two scans can share a date, so the lists also show the time. */
const moment = (at: number) =>
  new Date(at * 1000).toLocaleString(locale, { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

const WHAT: Record<FolderChange["what"], string> = { grew: "نما", shrank: "نقص", new: "جديد", gone: "اختفى" };

/** Size on disk at each saved scan. One series, so the title names it and there is no legend. */
function GrowthChart({ points, unit }: { points: ScanPoint[]; unit: Unit }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.onDisk), 1);
  const shown = hover === null ? null : points[hover];
  return (
    <div className="chart-wrap">
      <div className="chart-tip muted small" aria-live="polite">
        {shown ? <>{moment(shown.at)} · <span className="num">{size(shown.onDisk, unit)}</span>{shown.partial ? " · فحص ناقص" : ""}</> : "مرّر على عمود لتعرف قيمته"}
      </div>
      <div className="chart" role="img" aria-label={`الحجم على القرص عبر ${points.length} فحوص، من ${size(points[0]!.onDisk, unit)} إلى ${size(points[points.length - 1]!.onDisk, unit)}`}>
        {points.map((p, i) => (
          <div
            key={p.at}
            className="chart-hit"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="chart-bar" data-active={hover === i} data-partial={p.partial} style={{ height: `${Math.max(1, (p.onDisk / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <details className="small">
        <summary>عرض كجدول</summary>
        <table className="table" style={{ minWidth: 0 }}>
          <thead><tr><th scope="col">التاريخ</th><th scope="col" className="end">على القرص</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.at}><td>{day(p.at)}{p.partial ? " (ناقص)" : ""}</td><td className="end"><span className="num">{size(p.onDisk, unit)}</span></td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function CompareScreen({ session }: { session: Session | null }) {
  const { unit } = useSettings();
  const [saved, setSaved] = useState<SavedScan[] | null>(null);
  const [key, setKey] = useState("");
  const [points, setPoints] = useState<ScanPoint[]>([]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [changes, setChanges] = useState<FolderChange[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engine.savedScans().then((s) => {
      setSaved(s);
      const mine = session && s.find((x) => x.root.toLowerCase() === session.root.toLowerCase());
      setKey((mine ?? s[0])?.key ?? "");
    }, (e) => setError(String(e)));
  }, [session]);

  useEffect(() => {
    if (!key) return;
    engine.scanPoints(key).then((p) => {
      setPoints(p);
      setFrom(p[0]?.at ?? 0);
      setTo(p[p.length - 1]?.at ?? 0);
    }, (e) => setError(String(e)));
  }, [key]);

  useEffect(() => {
    if (!key || !from || !to || from === to) {
      setChanges([]);
      return;
    }
    engine.compareScans(key, from, to).then(setChanges, (e) => setError(String(e)));
  }, [key, from, to]);

  const a = points.find((p) => p.at === from);
  const b = points.find((p) => p.at === to);
  const delta = a && b ? b.onDisk - a.onDisk : 0;
  const largest = useMemo(() => Math.max(...changes.map((c) => Math.abs(c.delta)), 1), [changes]);
  const current = saved?.find((s) => s.key === key);
  // Only a whole drive has a free-space figure to count down from.
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => {
    if (!current) return;
    engine.listDrives().then((d) => setFree(d.find((x) => x.root.toLowerCase() === current.root.toLowerCase())?.free ?? null), () => setFree(null));
  }, [current]);
  const days = free === null ? null : daysUntilFull(points, free);

  if (saved && saved.length === 0) {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 24 }}>المقارنة</h1>
        <p className="quiet">ما في فحوص محفوظة بعد. كل فحص يُحفظ ملخصه على جهازك، ومن فحصين تعرف شو تغيّر.</p>
        <div className="actions"><a className="btn btn-primary" href={href("storage")}>افتح التخزين</a></div>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1>المقارنة</h1>
          {points.length >= 2 && a && b && (
            <p style={{ fontSize: 17 }}>
              {delta >= 0 ? "زاد" : "نقص"} المستخدم <span className="num accent-text">{signed(delta, unit)}</span> بين {moment(a.at)} و{moment(b.at)}
            </p>
          )}
        </div>
        {saved && saved.length > 1 && (
          <label className="field"><span className="muted small">المكان</span>
            <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
              {saved.map((s) => <option key={s.key} value={s.key}>{s.root}</option>)}
            </select>
          </label>
        )}
        {points.length >= 2 && (
          <>
            <label className="field"><span className="muted small">من</span>
              <select className="input" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                {points.map((p) => <option key={p.at} value={p.at}>{moment(p.at)}</option>)}
              </select>
            </label>
            <label className="field"><span className="muted small">إلى</span>
              <select className="input" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {points.map((p) => <option key={p.at} value={p.at}>{moment(p.at)}</option>)}
              </select>
            </label>
          </>
        )}
      </header>
      {error && <p className="note error" role="alert"><span>{error}</span></p>}

      {points.length < 2 ? (
        <div className="empty" style={{ paddingTop: 0 }}>
          <p className="quiet">{current ? <>فحص واحد محفوظ لـ <span className="path">{current.root}</span>. افحص مرة ثانية لاحقاً لتشوف شو تغيّر.</> : "يحمّل…"}</p>
          <div className="actions"><a className="btn" href={href("storage")}>افتح التخزين</a></div>
        </div>
      ) : (
        <div className="history">
          <section className="card" aria-labelledby="ch" style={{ flex: "1 1 440px", minWidth: 0 }}>
            <h2 id="ch" className="card-title">الحجم على القرص في كل فحص</h2>
            <div className="card-body">
              <GrowthChart points={points} unit={unit} />
              <p>
                <strong style={{ fontWeight: 600 }}>التوقع: </strong>
                {days === null
                  ? "يلزم نمو واضح عبر أسبوع على الأقل، على قرص كامل، ليصير التوقع معقولاً."
                  : <>يمتلئ القرص خلال <span className="num">{Math.max(1, Math.round(days / 30))}</span> شهر تقريباً إذا استمر نفس المعدل.</>}
              </p>
            </div>
          </section>
          <section className="card" aria-labelledby="ch2" style={{ flex: "1 1 440px", minWidth: 0 }}>
            <h2 id="ch2" className="card-title">شو تغيّر؟</h2>
            {changes.length === 0 ? (
              <p className="muted card-body">ما في مجلد تغيّر أكثر من 10 MB بين هذين الفحصين.</p>
            ) : changes.map((c) => (
              <div key={c.path} className="line-item">
                <div className="change-top"><span className="name">{c.path}</span><span className="num">{signed(c.delta, unit)}</span></div>
                <div className="change-bar">
                  <div className="track"><div style={{ height: 4, width: `${(Math.abs(c.delta) / largest) * 100}%`, background: c.delta > 0 ? "var(--data-3)" : "var(--data-2)" }} /></div>
                  <span className="muted label">{WHAT[c.what]}</span>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </>
  );
}

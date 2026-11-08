import { useEffect, useState } from "react";
import { clock, num, size } from "../format";
import { go } from "../routes";
import { cancelScan, type Session } from "../scan-session";
import { useSettings } from "../settings";

/** Live scan progress (Scan board). Goes to Storage by itself when the scan ends. */
export function ScanScreen({ session }: { session: Session | null }) {
  const { unit } = useSettings();
  const [now, setNow] = useState(Date.now());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!session || session.phase !== "running") go("storage");
  }, [session]);

  if (!session) return null;
  const p = session.progress;
  const drive = session.drive;
  // Known total only for a whole drive: what Windows reports as used. Never claim 100% before done.
  const used = drive ? drive.total - drive.free : 0;
  const pct = drive && used > 0 && p ? Math.min(99, Math.floor((p.bytes / used) * 100)) : null;
  const where = drive ? `القرص ${drive.root.replace(/\\$/, "")}` : session.root;

  const stats = [
    { label: "ملفات فُحصت", value: num(p?.files ?? 0) },
    { label: "مجلدات", value: num(p?.dirs ?? 0) },
    { label: "حجم فُحص (على القرص)", value: size(p?.bytes ?? 0, unit) },
    { label: "الوقت المنقضي", value: clock(now - session.startedAt) },
    { label: "تعذّرت قراءته", value: num(p?.denied ?? 0) },
  ];

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1>{stopping ? "يتوقف الفحص…" : "جارٍ الفحص"}</h1>
          <p className="muted">
            <span className={drive ? "" : "num"}>{where}</span> · يمكنك متابعة عملك أثناء الفحص
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void cancelScan();
          }}
        >
          إيقاف وعرض النتائج
        </button>
      </header>

      <section aria-label="تقدم الفحص" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="big num" aria-hidden="true">
          {pct !== null ? (
            <>{pct}<small>%</small></>
          ) : (
            size(p?.bytes ?? 0, unit)
          )}
        </div>
        {pct !== null ? (
          <div className="progress" role="progressbar" aria-label="نسبة الفحص" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}%`}>
            <div className="done" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <div className="progress unknown" role="progressbar" aria-label="الفحص جارٍ، الحجم الكلي غير معروف" aria-valuetext={`فُحص ${size(p?.bytes ?? 0, unit)}`}>
            <div className="done" />
          </div>
        )}
        <p className="path small" style={{ textAlign: "right", overflowWrap: "anywhere", minHeight: "1.5em" }}>{p?.current ?? ""}</p>
      </section>

      <section aria-label="أرقام الفحص" className="stats">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="muted small">{s.label}</div>
            <span className="num">{s.value}</span>
          </div>
        ))}
      </section>
      <p className="muted small">الأرقام أثناء الفحص تقريبية. الأرقام النهائية تظهر في التخزين حين ينتهي.</p>
    </>
  );
}

import { useEffect, useState } from "react";
import { engine, type Drive, type DriveKind, type SavedScan } from "../engine";
import { ago, percent, size } from "../format";
import { go, href } from "../routes";
import { openSaved, type Session } from "../scan-session";
import { useSettings } from "../settings";
import { PartitionsCard } from "./MoreScreens";
import { scanAndShow } from "./StorageScreen";

const KIND: Record<DriveKind, string> = {
  fixed: "قرص ثابت",
  removable: "قرص منفصل",
  network: "شبكة",
  optical: "قرص بصري",
  ram: "قرص ذاكرة",
  unknown: "غير معروف",
};

/** Every drive, its last saved result, and scanning any folder or network path. */
export function DrivesScreen({ drives, session }: { drives: Drive[]; session: Session | null }) {
  const { unit, dedupHardlinks, keepResults } = useSettings();
  const [saved, setSaved] = useState<SavedScan[]>([]);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engine.savedScans().then(setSaved, () => setSaved([]));
  }, [session]);

  const scan = (root: string, d: Drive | null) => void scanAndShow(root, d, dedupHardlinks, keepResults).catch((e) => setError(String(e)));
  const open = (s: SavedScan, d: Drive | null) =>
    void openSaved(s, d).then(() => go("storage"), (e) => setError(`تعذّر فتح النتيجة المحفوظة: ${e}`));
  const notDrives = saved.filter((s) => !drives.some((d) => d.root.toLowerCase() === s.root.toLowerCase()));

  return (
    <>
      <header className="page-head"><div className="title"><h1>الأقراص</h1></div></header>
      {error && <p className="note error" role="alert"><span>{error}</span></p>}

      <section aria-label="الأقراص المتصلة" className="drive-cards">
        {drives.map((d) => {
          const used = d.total - d.free;
          const last = saved.find((s) => s.root.toLowerCase() === d.root.toLowerCase());
          return (
            <div key={d.root} className="card drive-card">
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                <strong><span className="num">{d.root.replace(/\\$/, "")}</span> <bdi>{d.label}</bdi></strong>
                <span className="muted label">{KIND[d.kind]}{d.fs ? ` · ${d.fs}` : ""}</span>
              </div>
              {d.ready ? (
                <>
                  <div className="track"><div className="fill" style={{ width: `${percent(used, d.total)}%` }} /></div>
                  <div className="num small" style={{ textAlign: "right" }}>{size(used, unit)} / {size(d.total, unit)}</div>
                  <div className="muted small">{last ? `آخر فحص ${ago(last.savedAt * 1000)}` : "لم يُفحص بعد"}</div>
                  <div className="actions-row">
                    <button type="button" className="btn" onClick={() => scan(d.root, d)} aria-label={`افحص ${d.root}`}>افحص</button>
                    {last && <button type="button" className="btn" onClick={() => open(last, d)} aria-label={`افتح آخر نتيجة لـ ${d.root}`}>آخر نتيجة</button>}
                  </div>
                </>
              ) : (
                <p className="muted small">ما في وسيط جاهز في هذا القرص.</p>
              )}
            </div>
          );
        })}
      </section>

      {notDrives.length > 0 && (
        <section className="card" aria-labelledby="folders">
          <h2 id="folders" className="card-title">مجلدات فحصتها</h2>
          {notDrives.map((s) => (
            <div key={s.key} className="line-item quarantine-row">
              <span className="path small grow">{s.root}</span>
              <span className="num">{size(s.onDisk, unit)}</span>
              <span className="muted small">{ago(s.savedAt * 1000)}</span>
              <button type="button" className="btn" onClick={() => open(s, null)}>آخر نتيجة</button>
            </div>
          ))}
        </section>
      )}

      <section className="card" aria-labelledby="net">
        <h2 id="net" className="card-title">فحص مسار أو قرص شبكي</h2>
        <form
          className="filters"
          style={{ padding: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) scan(path.trim(), null);
          }}
        >
          <label className="field grow-2">
            <span className="muted small">المسار</span>
            <input dir="ltr" type="text" className="input path" value={path} placeholder="\\nas\media" onChange={(e) => setPath(e.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={!path.trim()} style={{ alignSelf: "end" }}>فحص</button>
        </form>
      </section>
      <PartitionsCard />
      <p className="muted small">شكّاك في فلاشة جديدة؟ <a className="accent-text" href={href("tests")}>اختبر سعتها الحقيقية</a></p>
    </>
  );
}

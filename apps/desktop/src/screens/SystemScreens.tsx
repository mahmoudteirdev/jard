// Programs, Health, Tests, Security and Reports: what the machine says, plainly, with no invented scores.

import { useEffect, useState } from "react";
import { engine, type Disk, type Driver, type Hardware, type OpenPort, type Program, type SystemError } from "../engine";
import { ago, num, percent, size } from "../format";
import { RunAsAdmin } from "./PlatformPanels";
import { FlashCard, Leftovers, MemoryCard, NetworkCard, PrintableReport, ScheduleCard, SecureDeleteCard, StartupList, StressCard, VirusTotalCard } from "./MoreScreens";
import { href } from "../routes";
import type { Session } from "../scan-session";
import { useSettings } from "../settings";

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then((d) => live && setData(d), (e) => live && setError(String(e)));
    return () => {
      live = false;
    };
    // eslint-style exhaustive deps would re-run on every render: `load` is a fresh closure.
  }, deps);
  return { data, error, loading: data === null && error === null };
}

const Head = ({ title, note }: { title: string; note?: string }) => (
  <header className="page-head"><div className="title"><h1>{title}</h1>{note && <p className="muted small">{note}</p>}</div></header>
);
const Loading = () => <p className="muted" role="status">يقرأ من النظام…</p>;
const Failed = ({ text }: { text: string }) => <p className="note error" role="alert"><span>{text}</span></p>;

/* ---------- programs ---------- */

function dateOf(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(raw);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function ProgramsScreen({ session }: { session: Session | null }) {
  const { unit } = useSettings();
  const [tab, setTab] = useState<"apps" | "left" | "drivers">("apps");
  const programs = useLoad(() => engine.installedPrograms());
  const drivers = useLoad(() => (tab === "drivers" ? engine.installedDrivers() : Promise.resolve([] as Driver[])), [tab]);
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const list = [...(programs.data ?? [])].sort((a, b) => (b.sizeKb ?? 0) - (a.sizeKb ?? 0));
  const seen = new Set<string>();
  const driverList = (drivers.data ?? []).filter((d) => !seen.has(`${d.name}|${d.version}`) && seen.add(`${d.name}|${d.version}`));

  const uninstall = (p: Program) =>
    engine.uninstallProgram(p.key).then(
      () => setNotice({ kind: "info", text: `بدأ برنامج إزالة ${p.name}. أكمل من نافذته.` }),
      (e) => setNotice({ kind: "error", text: String(e) }),
    ).finally(() => setAsking(null));

  return (
    <>
      <Head title="البرامج" />
      <div role="tablist" aria-label="الأقسام" className="tabs">
        <button type="button" role="tab" aria-selected={tab === "apps"} onClick={() => setTab("apps")}>البرامج المثبتة</button>
        <button type="button" role="tab" aria-selected={tab === "left"} onClick={() => setTab("left")}>البقايا</button>
        <button type="button" role="tab" aria-selected={tab === "drivers"} onClick={() => setTab("drivers")}>التعريفات</button>
      </div>
      {notice && (
        <p className={`note ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span><button type="button" className="btn" onClick={() => setNotice(null)}>حسناً</button>
        </p>
      )}
      {tab === "left" ? (
        <Leftovers session={session} programs={programs.data ?? []} />
      ) : tab === "apps" ? (
        <>
          <p className="muted">مرتبة حسب الحجم الذي يذكره كل برنامج عن نفسه، وبعض البرامج لا تذكر حجمها. الإزالة تشغّل برنامج الإزالة الخاص به.</p>
          {programs.error && <Failed text={programs.error} />}
          {programs.loading && <Loading />}
          {list.length > 0 && (
            <div className="table-wrap card">
              <table className="table">
                <thead><tr><th scope="col">الاسم</th><th scope="col">الناشر</th><th scope="col">تاريخ التثبيت</th><th scope="col">الحجم</th><th scope="col" className="end">إجراء</th></tr></thead>
                <tbody>
                  {list.map((p) => {
                    const when = dateOf(p.installDate);
                    return (
                      <tr key={p.key}>
                        <td><div className="name" style={{ fontWeight: 500 }}>{p.name}</div>{p.version && <div className="num label muted">{p.version}</div>}</td>
                        <td className="quiet"><bdi>{p.publisher ?? "—"}</bdi></td>
                        <td className="quiet">{when ? ago(when.getTime()) : "—"}</td>
                        <td><span className="num">{p.sizeKb ? size(p.sizeKb * 1024, unit) : "—"}</span></td>
                        <td className="end">
                          {asking === p.key ? (
                            <span className="confirm" style={{ justifyContent: "flex-end" }}>
                              <button type="button" className="btn btn-danger" onClick={() => void uninstall(p)}>تأكيد الإزالة</button>
                              <button type="button" className="btn" onClick={() => setAsking(null)}>إلغاء</button>
                            </span>
                          ) : (
                            <button type="button" className="btn" aria-label={`إزالة ${p.name}`} onClick={() => setAsking(p.key)}>إزالة</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted">تحديث التعريف يتم من موقع الشركة المصنعة أو Windows Update، وليس من جرد. تاريخ قديم لا يعني بالضرورة مشكلة.</p>
          {drivers.error && <Failed text={drivers.error} />}
          {drivers.loading && <Loading />}
          {driverList.length > 0 && (
            <div className="table-wrap card">
              <table className="table">
                <thead><tr><th scope="col">الجهاز</th><th scope="col">الصانع</th><th scope="col">الإصدار</th><th scope="col">التاريخ</th></tr></thead>
                <tbody>
                  {driverList.map((d) => {
                    const when = dateOf(d.date);
                    return (
                      <tr key={`${d.name}|${d.version}`}>
                        <td className="name" style={{ fontWeight: 500 }}>{d.name}</td>
                        <td className="quiet"><bdi>{d.maker ?? "—"}</bdi></td>
                        <td><span className="num">{d.version}</span></td>
                        <td className="quiet">{when ? ago(when.getTime()) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ---------- health ---------- */

const HEALTH: Record<string, { word: string; cls: string }> = {
  Healthy: { word: "سليم", cls: "safety-safe" },
  Warning: { word: "تحذير", cls: "safety-careful" },
  Unhealthy: { word: "متضرر", cls: "safety-keep" },
};
const MEDIA: Record<string, string> = { SSD: "SSD", HDD: "قرص تقليدي", SCM: "SCM", Unspecified: "غير محدد" };

function Meter({ name, value, pct }: { name: string; value: string; pct: number | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div className="change-top"><span>{name}</span><span className="num">{value}</span></div>
      {pct !== null && (
        <div role="progressbar" aria-label={name} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} style={{ height: 5, background: "var(--line)" }}>
          <div style={{ height: 5, width: `${pct}%`, background: "var(--data-2)" }} />
        </div>
      )}
    </div>
  );
}

export function HealthScreen({ session, drives }: { session: Session | null; drives: { root: string; total: number; free: number; ready: boolean }[] }) {
  const { unit } = useSettings();
  const disks = useLoad(() => engine.diskHealth());
  const hw = useLoad<Hardware>(() => engine.hardwareNow());
  const low = drives.filter((d) => d.ready && d.total > 0 && d.free / d.total < 0.1);
  const sick = (disks.data ?? []).filter((d) => d.health !== "Healthy");
  const m = hw.data;
  const battery = m?.batteryFull && m.batteryDesign ? percent(m.batteryFull, m.batteryDesign) : null;

  return (
    <>
      <Head title="صحة الجهاز" note="هذي قراءات النظام كما هي، بدون درجة مخترعة. بعض بيانات الأقراص تحتاج تشغيل البرنامج كمسؤول." />
      <RunAsAdmin />
      <section className="card" aria-labelledby="findings">
        <h2 id="findings" className="card-title">يحتاج انتباهك</h2>
        {disks.loading ? <p className="muted card-body">يقرأ…</p> : sick.length + low.length === 0 ? (
          <p className="quiet card-body">ما في تحذيرات من القراءات الحالية. هذا لا يضمن إن الأقراص لن تتعطل، فخذ نسخاً احتياطية دائماً.</p>
        ) : (
          <>
            {sick.map((d) => (
              <div key={d.name} className="line-item action-row">
                <span className="badge safety-keep">تحذير</span>
                <span className="grow"><strong style={{ fontWeight: 600 }}><bdi>{d.name}</bdi> حالته {HEALTH[d.health]?.word ?? d.health}.</strong> <span className="muted">خذ نسخة احتياطية من بياناته قريباً.</span></span>
              </div>
            ))}
            {low.map((d) => (
              <div key={d.root} className="line-item action-row">
                <span className="badge safety-careful">تنبيه</span>
                <span className="grow"><strong style={{ fontWeight: 600 }}>قرص <span className="num">{d.root.replace(/\\$/, "")}</span> شبه ممتلئ.</strong> <span className="muted">المتاح {size(d.free, unit)} فقط.</span></span>
                <a className="btn" href={href("cleanup")}>فتح التنظيف</a>
              </div>
            ))}
          </>
        )}
      </section>

      <div className="guard-grid">
        <section className="card" aria-labelledby="disks">
          <h2 id="disks" className="card-title">الأقراص</h2>
          {disks.error && <div className="card-body"><Failed text={disks.error} /></div>}
          {disks.loading && <p className="muted card-body" role="status">يقرأ…</p>}
          {disks.data?.length === 0 && <p className="muted card-body">ما رجع النظام معلومات عن الأقراص.</p>}
          {(disks.data?.length ?? 0) > 0 && <div className="table-wrap">
            <table className="table" style={{ minWidth: 460 }}>
              <thead><tr><th scope="col">القرص</th><th scope="col">الحالة</th><th scope="col">الحرارة</th><th scope="col">ساعات التشغيل</th><th scope="col">التآكل</th></tr></thead>
              <tbody>
                {(disks.data ?? []).map((d: Disk) => (
                  <tr key={d.name}>
                    <td><div className="name" style={{ fontWeight: 500 }}>{d.name}</div><div className="label muted">{MEDIA[d.media] ?? d.media} · <span className="num">{size(d.size, unit)}</span></div></td>
                    <td><strong className={HEALTH[d.health]?.cls ?? "safety-unknown"}>{HEALTH[d.health]?.word ?? "غير معروف"}</strong></td>
                    <td><span className="num">{d.temperature ? `${d.temperature}°C` : "—"}</span></td>
                    <td><span className="num">{d.hours != null ? num(d.hours) : "—"}</span></td>
                    <td><span className="num">{d.wear != null ? `${d.wear}%` : "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </section>
        <section className="card" aria-labelledby="hardware">
          <h2 id="hardware" className="card-title">العتاد الآن</h2>
          <div className="card-body">
            {hw.error && <Failed text={hw.error} />}
            {hw.loading && <Loading />}
            {m && (
              <>
                <Meter name="المعالج" value={m.cpuLoad != null ? `${m.cpuLoad}%` : "—"} pct={m.cpuLoad ?? null} />
                <Meter name="الذاكرة" value={`${size(m.memTotal - m.memFree, unit)} / ${size(m.memTotal, unit)}`} pct={percent(m.memTotal - m.memFree, m.memTotal)} />
                {battery !== null && <Meter name="صحة البطارية" value={`${Math.round(battery)}%`} pct={battery} />}
                <p className="muted small"><bdi>{m.cpuName}</bdi> · <bdi>{m.osName}</bdi></p>
              </>
            )}
          </div>
        </section>
        <StartupList />
      </div>
      {session?.phase === "done" && <p className="muted small">مساحة القرص من آخر فحص موجودة في <a className="accent-text" href={href("overview")}>النظرة العامة</a>.</p>}
    </>
  );
}

/* ---------- tests ---------- */

export function TestsScreen({ drives }: { drives: import("../engine").Drive[] }) {
  const [speed, setSpeed] = useState<{ writeMbS: number; readMbS: number; sizeMb: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = useLoad<SystemError[]>(() => engine.systemErrors());
  const run = () => {
    setBusy(true);
    setError(null);
    engine.diskSpeed().then(setSpeed, (e) => setError(String(e))).finally(() => setBusy(false));
  };
  return (
    <>
      <Head title="الاختبارات" />
      <section className="stats" aria-label="اختبارات العتاد">
        <article className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>سرعة القرص</h2>
          <p className="muted">يكتب ويقرأ ملفاً مؤقتاً بحجم <span className="num">256 MB</span> على قرص النظام، ثم يحذفه. قراءة وكتابة متتابعة بدون ذاكرة التخزين المؤقت.</p>
          {speed ? (
            <span className="num" role="status">R {num(Math.round(speed.readMbS))} / W {num(Math.round(speed.writeMbS))} MB/s</span>
          ) : <span className="num muted">—</span>}
          {error && <Failed text={error} />}
          <button type="button" className="btn" disabled={busy} onClick={run}>{busy ? "يقيس…" : speed ? "إعادة الاختبار" : "بدء"}</button>
        </article>
        <MemoryCard />
        <StressCard />
        <FlashCard drives={drives} />
      </section>
      <section className="card" aria-labelledby="log">
        <h2 id="log" className="card-title">أخطاء النظام في آخر 30 يوماً <span className="muted small" style={{ fontWeight: 400 }}>(سجل ويندوز)</span></h2>
        {errors.loading && <p className="muted card-body">يقرأ…</p>}
        {errors.error && <div className="card-body"><Failed text={errors.error} /></div>}
        {errors.data?.length === 0 && <p className="quiet card-body">ما في أخطاء مسجلة في هذه الفترة.</p>}
        {(errors.data?.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {errors.data!.map((e, i) => (
                  <tr key={i}>
                    <td style={{ width: 70 }}><span className={`badge ${e.level === 1 ? "safety-keep" : "safety-careful"}`}>{e.level === 1 ? "حرج" : "خطأ"}</span></td>
                    <td>
                      <div className="name" style={{ fontWeight: 500 }}>{e.message ?? "بدون وصف"}</div>
                      <div className="path label muted">{e.provider} · Event {e.id}</div>
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{ago(new Date(e.at).getTime())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------- security ---------- */

const isLocal = (a: string) => a.startsWith("127.") || a === "::1";

export function SecurityScreen() {
  const ports = useLoad<OpenPort[]>(() => engine.openPorts());
  const list = ports.data ?? [];
  const exposed = list.filter((p) => !isLocal(p.address));
  return (
    <>
      <Head title="الأمان" note="نعرض ما نجده ونشرحه. لا يوجد فحص يضمن أن الجهاز آمن تماماً." />
      <div className="guard-grid">
        <VirusTotalCard />
        <SecureDeleteCard />
      </div>
      <div className="guard-grid">
      <section className="card" aria-labelledby="ports">
        <h2 id="ports" className="card-title">المنافذ المفتوحة · <span className="num">{num(list.length)}</span></h2>
        {ports.loading && <p className="muted card-body">يقرأ…</p>}
        {ports.error && <div className="card-body"><Failed text={ports.error} /></div>}
        {ports.data && (
          <p className="quiet line-item">
            <span className="num">{num(exposed.length)}</span> منفذ يقبل اتصالات من خارج هذا الجهاز. كثير منها طبيعي لخدمات ويندوز، فهذا للمراجعة لا للتحذير.
          </p>
        )}
        {list.map((p) => (
          <div key={`${p.address}:${p.port}`} className="line-item quarantine-row">
            <span className="num" style={{ width: 60, textAlign: "right" }}>{p.port}</span>
            <bdi className="grow">{p.process ?? "غير معروف"}</bdi>
            <span className="path label muted">{p.address}</span>
            <strong className={isLocal(p.address) ? "safety-safe small" : "safety-careful small"}>{isLocal(p.address) ? "محلي فقط" : "راجعه"}</strong>
          </div>
        ))}
      </section>
      <NetworkCard />
      </div>
    </>
  );
}

/* ---------- reports ---------- */

export function ReportsScreen({ session }: { session: Session | null }) {
  const [status, setStatus] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const scanId = session?.phase === "done" ? session.id : null;
  const exportCsv = async () => {
    if (scanId === null) return;
    try {
      const path = await engine.pickSavePath("jard-report.csv", "csv");
      if (!path) return;
      const rows = await engine.exportCsv(scanId, path);
      setStatus({ kind: "info", text: `حُفظ التقرير (${rows} صف) في ${path}` });
    } catch (e) {
      setStatus({ kind: "error", text: String(e) });
    }
  };
  return (
    <>
      <Head title="التقارير" />
      {status && <p className={`note ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}><span>{status.text}</span></p>}
      <section className="card" aria-labelledby="ex" style={{ maxWidth: 640 }}>
        <h2 id="ex" className="card-title">تصدير تقرير</h2>
        <div className="card-body">
          {scanId === null ? (
            <>
              <p className="quiet">التقرير يُبنى من نتيجة الفحص. افحص قرصاً أولاً.</p>
              <div className="actions-row"><a className="btn btn-primary" href={href("storage")}>افتح التخزين</a></div>
            </>
          ) : (
            <>
              <p className="quiet">ملف CSV يفتح في Excel، فيه المجلدات حتى 3 مستويات والملفات الأكبر من <span className="num">10 MB</span> من فحص <span className="path">{session?.root}</span>.</p>
              <div className="actions-row">
                <button type="button" className="btn btn-primary" onClick={() => void exportCsv()}>تصدير CSV</button>
                <button type="button" className="btn" onClick={() => window.print()}>طباعة أو حفظ PDF</button>
              </div>
              <p className="muted small">التقرير فيه أسماء ملفاتك، فشاركه بحذر.</p>
            </>
          )}
        </div>
      </section>
      <ScheduleCard session={session} />
      {session?.phase === "done" && <PrintableReport session={session} />}
    </>
  );
}

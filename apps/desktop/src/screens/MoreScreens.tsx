// "Why is my PC slow?", the tools that change things, network devices, partitions, schedule and print.

import { useEffect, useMemo, useState } from "react";
import { diskWarned, HEALTH } from "../disk-state";
import { askToClean } from "../clean-session";
import { failureText } from "../clean-text";
import { t } from "../i18n";
import {
  engine, type CapacityResult, type Candidate, type Disk, type Drive, type Hardware, type KindTotal, type NetworkDevice,
  type NodeDto, type Partition, type Program, type Schedule, type StartupItem, type VtResult,
} from "../engine";
import { groupTotals } from "../file-kinds";
import { ago, middle, num, percent, size } from "../format";
import { href, type RouteId } from "../routes";
import type { Session } from "../scan-session";
import { updateSettings, useSettings } from "../settings";

/* ---------- why slow ---------- */

interface Cause {
  title: string;
  plain: string;
  metric: string;
  cta: string;
  to: RouteId;
  weight: number;
}

export function WhySlowScreen({ drives }: { drives: Drive[] }) {
  const { unit } = useSettings();
  const [startup, setStartup] = useState<StartupItem[] | null>(null);
  const [hw, setHw] = useState<Hardware | null>(null);
  const [disks, setDisks] = useState<Disk[] | null>(null);
  useEffect(() => {
    engine.startupPrograms().then(setStartup, () => setStartup([]));
    engine.hardwareNow().then(setHw, () => {});
    engine.diskHealth().then(setDisks, () => setDisks([]));
  }, []);

  const causes: Cause[] = [];
  const active = (startup ?? []).filter((s) => !s.disabled);
  if (active.length >= 5) {
    causes.push({ title: `${active.length} برامج تشتغل مع بداية ويندوز`, plain: "كل واحد منها يأخر الإقلاع شوي، وممكن تفتحها بس لما تحتاجها.", metric: `${active.length} برامج`, cta: "مراجعة البرامج", to: "health", weight: active.length });
  }
  if (hw && hw.memTotal > 0) {
    const used = percent(hw.memTotal - hw.memFree, hw.memTotal);
    if (used >= 80) causes.push({ title: "الذاكرة شبه ممتلئة الآن", plain: "لما تمتلئ، يستخدم ويندوز القرص بدلها وهو أبطأ بكتير. أغلق البرامج اللي ما بتحتاجها.", metric: `${size(hw.memTotal - hw.memFree, unit)} / ${size(hw.memTotal, unit)}`, cta: "شوف العتاد", to: "health", weight: used });
    if (hw.memTotal < 8e9) causes.push({ title: "الذاكرة صغيرة لهذا الاستخدام", plain: "أقل من 8 GB تمتلئ بسرعة مع المتصفح وبرنامج أو اثنين.", metric: size(hw.memTotal, unit), cta: "شوف العتاد", to: "health", weight: 30 });
  }
  for (const d of drives.filter((x) => x.ready && x.total > 0 && x.free / x.total < 0.15)) {
    causes.push({ title: `قرص ${d.root.replace(/\\$/, "")} قرّب يمتلئ`, plain: "ويندوز يحتاج مساحة فاضية للتحديثات والملفات المؤقتة.", metric: `${Math.round(percent(d.total - d.free, d.total))}%`, cta: "فتح التنظيف", to: "cleanup", weight: 70 });
  }
  for (const d of (disks ?? []).filter((x) => x.media === "HDD")) {
    causes.push({ title: `${d.name} قرص تقليدي`, plain: "إذا كان ويندوز مثبتاً عليه، فهذا غالباً أكبر سبب للبطء، والانتقال إلى SSD يفرق كتير.", metric: "HDD", cta: "تفاصيل القرص", to: "health", weight: 60 });
  }
  for (const d of (disks ?? []).filter(diskWarned)) {
    causes.push({ title: `${d.name} عليه تحذير`, plain: "هذا تحذير على سلامة بياناتك أكثر من كونه مشكلة سرعة. خذ نسخة احتياطية.", metric: HEALTH[d.health]?.word ?? d.health, cta: "تفاصيل القرص", to: "health", weight: 90 });
  }
  causes.sort((a, b) => b.weight - a.weight);
  const loading = startup === null || hw === null || disks === null;

  return (
    <>
      <header style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 38, lineHeight: 1.2, fontWeight: 700 }}>ليش جهازك بطيء؟</h1>
        <p className="quiet" style={{ marginTop: 8, fontSize: 19 }}>رتبنا الأسباب اللي قدرنا نقيسها، من الأكثر تأثيراً غالباً، وأنت تقرر شو تغيّر.</p>
      </header>
      {loading && <p className="muted" role="status">يقيس…</p>}
      {!loading && causes.length === 0 && <p className="quiet">ما لقينا سبب واضح من القراءات الحالية. جرّب تفتح هذه الشاشة لما يكون الجهاز بطيئاً فعلاً.</p>}
      <section aria-label="الأسباب" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {causes.map((c) => (
          <article key={c.title} className="card action-row" style={{ padding: 16 }}>
            <div style={{ flex: "1 1 420px", minWidth: 0 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700 }}>{c.title}</h2>
              <p className="quiet">{c.plain}</p>
            </div>
            <div style={{ flex: "0 0 150px" }}><div className="label muted">القياس</div><div className="num">{c.metric}</div></div>
            <a className="btn" href={href(c.to)}>{c.cta}</a>
          </article>
        ))}
      </section>
      <p className="muted">ما بنعرض "تسريع بكبسة زر". نفحص، نشرح السبب، وأي تغيير يبقى قرارك ويمكن الرجوع عنه.</p>
    </>
  );
}

/* ---------- leftovers (a tab in Programs) ---------- */

const NEVER_LEFTOVER = ["microsoft", "packages", "temp", "programs", "windows", "nvidia", "intel", "amd", "package cache", "regid", "ssh", "system", "crashdumps", "connecteddevicesplatform", "comms", "d3dscache", "virtualstore", "usoshared", "usoprivate", "softwaredistribution"];

export function Leftovers({ session, programs }: { session: Session | null; programs: Program[] }) {
  const { unit } = useSettings();
  const [folders, setFolders] = useState<Candidate[] | null>(null);
  const [checked, setChecked] = useState<Map<number, NodeDto>>(new Map());
  const scanId = session?.phase === "done" ? session.id : null;
  useEffect(() => {
    if (scanId !== null) engine.dataFolders(scanId).then(setFolders, () => setFolders([]));
  }, [scanId]);
  const known = useMemo(() => programs.map((p) => `${p.name} ${p.publisher ?? ""}`.toLowerCase()), [programs]);
  const list = (folders ?? []).filter((c) => {
    const n = c.node.name.toLowerCase();
    if (n.length < 3 || NEVER_LEFTOVER.some((w) => n.includes(w))) return false;
    return !known.some((k) => k.includes(n) || n.split(/[\s._-]+/).some((w) => w.length >= 4 && k.includes(w)));
  });
  if (scanId === null) return <p className="quiet">البقايا تُستخرج من نتيجة فحص القرص. <a className="accent-text" href={href("storage")}>افتح التخزين</a></p>;
  return (
    <>
      <p className="muted">مجلدات بيانات أكبر من <span className="num">50 MB</span> ما لقينا برنامجاً مثبتاً بنفس اسمها. هذا تخمين من الأسماء وليس تأكيداً، فراجع كل واحد: كثير منها يخص برامج محمولة أو ألعاباً.</p>
      {folders === null ? <p className="muted" role="status">يقارن…</p> : list.length === 0 ? <p className="quiet">ما لقينا مجلدات مشكوك فيها في هذا الفحص.</p> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col" style={{ width: 48 }}><span className="sr-only">تحديد</span></th><th scope="col">المجلد</th><th scope="col" className="end">على القرص</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.node.id}>
                  <td><label className="pick"><span className="sr-only">تحديد {c.node.name}</span>
                    <input type="checkbox" checked={checked.has(c.node.id)} onChange={() => setChecked((m) => { const x = new Map(m); if (x.has(c.node.id)) x.delete(c.node.id); else x.set(c.node.id, c.node); return x; })} /></label></td>
                  <td><div className="name" style={{ fontWeight: 600 }}>{c.node.name}</div><div className="path label muted" title={c.path}>{middle(c.path, 80)}</div></td>
                  <td className="end"><span className="num">{size(c.node.onDisk, unit)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {checked.size > 0 && <div className="actions-row"><button type="button" className="btn" onClick={() => askToClean({ scanId, nodes: [...checked.values()], from: "programs" })}>نقل <span className="num">{checked.size}</span> إلى الحجر</button></div>}
    </>
  );
}

/* ---------- startup toggles (used by Health) ---------- */

export function StartupList({ round = 0 }: { round?: number }) {
  const [items, setItems] = useState<StartupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => engine.startupPrograms().then(setItems, (e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, [round]);
  const toggle = (s: StartupItem) => {
    setError(null);
    engine.setStartup(s.name, !!s.disabled).then(load, (e) => setError(String(e)));
  };
  return (
    <section className="card" aria-labelledby="startup" style={{ gridColumn: "1 / -1" }}>
      <h2 id="startup" className="card-title">برامج بدء التشغيل</h2>
      {items === null && <p className="muted card-body">يقرأ…</p>}
      {error && <p className="note error" role="alert"><span>{error}</span></p>}
      {items?.length === 0 && <p className="muted card-body">ما لقينا برامج بدء تشغيل.</p>}
      {(items ?? []).map((s, i) => (
        <label key={`${s.name}-${i}`} className="choice line-item" style={{ cursor: s.canToggle ? "pointer" : "default" }}>
          <input type="checkbox" checked={!s.disabled} disabled={!s.canToggle} onChange={() => toggle(s)} />
          <span className="grow">
            <span className="name" style={{ display: "block", fontWeight: 600 }}>{s.name}</span>
            <span className="muted small">{s.canToggle ? (s.disabled ? "متوقف عند الإقلاع" : "يعمل عند الإقلاع") : s.where === "folder" ? "من مجلد بدء التشغيل: غيّره من مدير المهام" : "لكل المستخدمين: غيّره من مدير المهام"}</span>
          </span>
        </label>
      ))}
    </section>
  );
}

/* ---------- partitions (used by Drives) ---------- */

export function PartitionsCard() {
  const { unit } = useSettings();
  const [parts, setParts] = useState<Partition[] | null>(null);
  useEffect(() => {
    engine.diskPartitions().then(setParts, () => setParts([]));
  }, []);
  const disks = [...new Set((parts ?? []).map((p) => p.disk))];
  const NAMES = ["var(--data-grey)", "var(--data-2)", "var(--data-4)", "var(--data-1)", "var(--data-3)"];
  return (
    <section className="card" aria-labelledby="pt">
      <h2 id="pt" className="card-title">خريطة الأقسام</h2>
      <div className="card-body">
        {parts === null && <p className="muted" role="status">يقرأ…</p>}
        {parts?.length === 0 && <p className="muted">ما رجع النظام معلومات عن الأقسام.</p>}
        {disks.map((disk) => {
          const list = parts!.filter((p) => p.disk === disk);
          return (
            <div key={disk} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <strong style={{ fontWeight: 700 }}>القرص <span className="num">{disk}</span></strong>
              <div className="usage"><div className="bar" role="img" aria-label={list.map((p) => `${p.letter || p.kind} ${size(p.size, unit)}`).join("، ")}>
                {list.map((p, i) => <div key={p.number} style={{ flex: `${Math.max(p.size, 1e9)} 1 0px`, background: NAMES[i % NAMES.length] }} />)}
              </div></div>
              <div className="legend">
                {list.map((p, i) => (
                  <span key={p.number}><span className="swatch" style={{ background: NAMES[i % NAMES.length] }} /><span className="num">{p.letter ? `${p.letter}:` : p.kind}</span> <span className="num muted">{size(p.size, unit)}{p.fs ? ` · ${p.fs}` : ""}</span></span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- more tests ---------- */

export function StressCard() {
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    setResult(null);
    engine.stressCpu(seconds).then(
      (r) => setResult(`${r.stopped ? "أوقفته بعد" : "انتهى بعد"} ${Math.round(r.seconds)} ث · ${r.threads} خيط · النتيجة ${num(r.score)}`),
      (e) => setError(String(e)),
    ).finally(() => setBusy(false));
  };
  return (
    <article className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>اختبار ضغط المعالج</h2>
      <p className="muted">يشغّل كل الأنوية بأقصى طاقة. ما بنقدر نقرأ حرارة كل المعالجات، فراقب الجهاز بنفسك وأوقفه إذا سخن كتير.</p>
      <label className="field"><span className="muted small">المدة</span>
        <select className="input" value={seconds} disabled={busy} onChange={(e) => setSeconds(Number(e.target.value))}>
          <option value={30}>30 ثانية</option><option value={60}>دقيقة</option><option value={300}>5 دقائق</option>
        </select>
      </label>
      {result && <span className="num small" role="status">{result}</span>}
      {error && <p className="note error" role="alert"><span>{error}</span></p>}
      {busy ? <button type="button" className="btn" onClick={() => void engine.stressStop()}>إيقاف الآن</button> : <button type="button" className="btn" onClick={run}>بدء</button>}
    </article>
  );
}

export function MemoryCard() {
  const [error, setError] = useState<string | null>(null);
  return (
    <article className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>فحص الذاكرة</h2>
      <p className="muted">يفتح أداة ويندوز، وهي تسألك إذا بدك تعيد التشغيل الآن أو لاحقاً. احفظ شغلك أولاً.</p>
      {error && <p className="note error" role="alert"><span>{error}</span></p>}
      <button type="button" className="btn" onClick={() => void engine.openMemoryTest().catch((e) => setError(String(e)))}>فتح أداة ويندوز</button>
    </article>
  );
}

export function FlashCard({ drives }: { drives: Drive[] }) {
  const { unit } = useSettings();
  const usb = drives.filter((d) => d.ready && d.kind === "removable");
  const [root, setRoot] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [result, setResult] = useState<CapacityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = root || usb[0]?.root || "";
  const run = () => {
    setBusy(true);
    setResult(null);
    setError(null);
    const off = engine.onFlashProgress((stage, done, total) => setProgress({ stage, done, total }));
    engine.flashCapacity(chosen).then(setResult, (e) => setError(String(e))).finally(() => {
      setBusy(false);
      setProgress(null);
      void off.then((u) => u());
    });
  };
  return (
    <article className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>السعة الحقيقية للفلاشة</h2>
      <p className="muted">يملأ المساحة الفارغة ببيانات اختبار، يتحقق منها، ثم يحذفها. الفلاشة المغشوشة ممكن تخرب ملفاتها أثناء الاختبار، فخذ نسخة منها أولاً. قد يأخذ ساعات.</p>
      {usb.length === 0 ? <p className="quiet small">ما في فلاشة موصولة الآن.</p> : (
        <>
          <label className="field"><span className="muted small">الفلاشة</span>
            <select className="input" value={chosen} disabled={busy} onChange={(e) => setRoot(e.target.value)}>
              {usb.map((d) => <option key={d.root} value={d.root}>{d.root} {d.label} · {size(d.free, unit)} فارغة</option>)}
            </select>
          </label>
          <label className="choice"><input type="checkbox" checked={accepted} disabled={busy} onChange={(e) => setAccepted(e.target.checked)} />أخذت نسخة، وفاهم إن الملفات ممكن تتضرر</label>
        </>
      )}
      {progress && <span className="num small" role="status">{progress.stage === "write" ? "يكتب" : "يتحقق"} {size(progress.done, unit)} / {size(progress.total, unit)}</span>}
      {result && (
        <p role="status" className={result.ok ? "safety-safe" : "safety-keep"}>
          {result.cancelled ? "أوقفت الاختبار، وحُذفت ملفاته." : result.ok ? <>سليمة: تحققنا من <span className="num">{size(result.verified, unit)}</span>.</> : <>فشل التحقق بعد <span className="num">{size(result.verified, unit)}</span>: السعة الحقيقية أقل من المعلنة، أو الفلاشة متضررة.</>}
        </p>
      )}
      {error && <p className="note error" role="alert"><span>{error}</span></p>}
      {busy ? <button type="button" className="btn" onClick={() => void engine.flashStop()}>إيقاف</button> : <button type="button" className="btn" disabled={usb.length === 0 || !accepted} onClick={run}>بدء</button>}
    </article>
  );
}

/* ---------- security tools ---------- */

const KNOWN_DEVICES = "jard.knownDevices";

export function NetworkCard() {
  const [devices, setDevices] = useState<NetworkDevice[] | null>(null);
  const [known, setKnown] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KNOWN_DEVICES) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    engine.networkNeighbors().then(setDevices, () => setDevices([]));
  }, []);
  const remember = () => {
    const all = (devices ?? []).map((d) => d.mac);
    setKnown(all);
    try {
      localStorage.setItem(KNOWN_DEVICES, JSON.stringify(all));
    } catch {
      // not saved; still shown for now
    }
  };
  const fresh = (devices ?? []).filter((d) => !known.includes(d.mac));
  return (
    <section className="card" aria-labelledby="wf">
      <h2 id="wf" className="card-title">الأجهزة على شبكتك</h2>
      <p className="muted small line-item">من جدول الشبكة في جهازك. ما بنرسل شي لأي جهاز، فممكن أجهزة نايمة ما تظهر. "جديد" يعني ما علّمته كمعروف، وليس إنه خطر.</p>
      {devices === null && <p className="muted card-body">يقرأ…</p>}
      {devices?.length === 0 && <p className="muted card-body">ما في أجهزة في الجدول الآن.</p>}
      {(devices ?? []).map((d) => (
        <div key={d.mac} className="line-item quarantine-row">
          <span className="num grow">{d.ip}</span>
          <span className="path label muted">{d.mac}</span>
          <strong className={known.includes(d.mac) ? "safety-safe small" : "safety-careful small"}>{known.includes(d.mac) ? "معروف" : "جديد"}</strong>
        </div>
      ))}
      {fresh.length > 0 && <div className="line-item"><button type="button" className="btn" onClick={remember}>علّم الكل كمعروف</button></div>}
    </section>
  );
}

/** What the person must type. Translated like any other text, so it is never a word they can't type. */
const CONFIRM_WORD: string = t("حذف");

export function SecureDeleteCard() {
  const { unit } = useSettings();
  const [path, setPath] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [status, setStatus] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const run = async () => {
    if (!path) return;
    const r = await engine.secureDeleteFile(path);
    if (r.Ok !== undefined) setStatus({ kind: "info", text: `كُتب فوق الملف وحُذف (${size(r.Ok, unit)}).` });
    else setStatus({ kind: "error", text: failureText(r.Err) });
    setPath(null);
    setWord("");
  };
  return (
    <section className="card" aria-labelledby="sd">
      <h2 id="sd" className="card-title">حذف آمن</h2>
      <div className="card-body">
        <p className="quiet">يكتب فوق الملف قبل حذفه، ولا يمر بالحجر فما في تراجع. مفيد على الأقراص التقليدية، لكنه غير مضمون على SSD والفلاشات. التشفير الكامل للقرص خيار أقوى.</p>
        {status && <p className={`note ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}><span>{status.text}</span></p>}
        {path ? (
          <>
            <p className="path small">{path}</p>
            <label className="field"><span className="muted small">اكتب "حذف" للتأكيد</span><input type="text" className="input" value={word} onChange={(e) => setWord(e.target.value)} /></label>
            <div className="actions-row">
              <button type="button" className="btn btn-danger" disabled={word.trim().toLowerCase() !== CONFIRM_WORD} onClick={() => void run()}>حذف نهائي</button>
              <button type="button" className="btn" onClick={() => setPath(null)}>إلغاء</button>
            </div>
          </>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => void engine.pickAnyFile().then(setPath, (e) => setStatus({ kind: "error", text: String(e) }))}>اختيار ملف للحذف الآمن</button>
        )}
      </div>
    </section>
  );
}

const VT_ERRORS: Record<string, string> = {
  bad_key: "مفتاح API غير صحيح.",
  rate_limited: "تجاوزت حد الطلبات في VirusTotal. جرّب بعد دقيقة.",
  "no API key": "أدخل مفتاح API أولاً.",
};

export function VirusTotalCard() {
  const s = useSettings();
  const [result, setResult] = useState<{ path: string; r: VtResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    const path = await engine.pickAnyFile();
    if (!path) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult({ path, r: await engine.virustotalCheck(path, s.virustotalKey) });
    } catch (e) {
      setError(VT_ERRORS[String(e)] ?? String(e));
    }
    setBusy(false);
  };
  return (
    <section className="card" aria-labelledby="vt">
      <h2 id="vt" className="card-title">فحص الملفات عبر VirusTotal</h2>
      <div className="card-body">
        <label className="choice"><input type="checkbox" checked={s.virustotal} onChange={(e) => updateSettings({ virustotal: e.target.checked })} />تفعيل الفحص عبر الإنترنت</label>
        <p className="muted small">نرسل بصمة الملف (SHA-256) ومفتاحك فقط، ولا يخرج أي ملف من جهازك. المفتاح يبقى على هذا الجهاز، وتحصل عليه مجاناً من حسابك في VirusTotal.</p>
        {s.virustotal && (
          <>
            <label className="field"><span className="muted small">مفتاح API</span><input type="password" dir="ltr" className="input path" autoComplete="off" value={s.virustotalKey} onChange={(e) => updateSettings({ virustotalKey: e.target.value })} /></label>
            <div className="actions-row"><button type="button" className="btn" disabled={busy || !s.virustotalKey.trim()} onClick={() => void check()}>{busy ? "يفحص…" : "اختيار ملف"}</button></div>
          </>
        )}
        {error && <p className="note error" role="alert"><span>{error}</span></p>}
        {result && (
          <div role="status">
            <div className="path small">{middle(result.path, 60)}</div>
            {!result.r.known ? <strong className="safety-unknown">VirusTotal ما شاف هذا الملف من قبل. هذا لا يعني إنه آمن.</strong>
              : result.r.malicious + result.r.suspicious > 0 ? <strong className="safety-keep"><span className="num">{result.r.malicious + result.r.suspicious}</span> محرك اكتشفه</strong>
              : <strong className="safety-safe">لا توجد نتائج سلبية من <span className="num">{result.r.harmless}</span> محرك</strong>}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- reports: print and schedule ---------- */

export function PrintableReport({ session }: { session: Session }) {
  const { unit } = useSettings();
  const [root, setRoot] = useState<NodeDto | null>(null);
  const [kids, setKids] = useState<NodeDto[]>([]);
  const [kinds, setKinds] = useState<KindTotal[]>([]);
  useEffect(() => {
    engine.getNode(session.id, 0).then(setRoot, () => {});
    engine.getChildren(session.id, 0, "on_disk", 20).then(setKids, () => {});
    engine.kindsOf(session.id).then(setKinds, () => {});
  }, [session.id]);
  if (!root) return null;
  return (
    <section className="card printable" aria-labelledby="rep">
      <h2 id="rep" className="card-title">تقرير جَرد</h2>
      <div className="card-body">
        <p className="path">{session.root}</p>
        <p className="muted small">آخر فحص {ago(session.finishedAt ?? Date.now())}</p>
        <div className="figures">
          <div><div className="label muted">على القرص</div><div className="num figure">{size(root.onDisk, unit)}</div></div>
          <div><div className="label muted">الحجم الظاهري</div><div className="num figure">{size(root.apparent, unit)}</div></div>
          <div><div className="label muted">ملفات</div><div className="num figure">{num(root.files)}</div></div>
        </div>
        <table className="table" style={{ minWidth: 0 }}>
          <thead><tr><th scope="col">النوع</th><th scope="col" className="end">على القرص</th><th scope="col" className="end">ملفات</th></tr></thead>
          <tbody>{groupTotals(kinds).map((g) => <tr key={g.id}><td>{g.name}</td><td className="end"><span className="num">{size(g.onDisk, unit)}</span></td><td className="end"><span className="num">{num(g.files)}</span></td></tr>)}</tbody>
        </table>
        <table className="table" style={{ minWidth: 0 }}>
          <thead><tr><th scope="col">أكبر العناصر</th><th scope="col" className="end">على القرص</th></tr></thead>
          <tbody>{kids.map((k) => <tr key={k.id}><td className="name">{k.name}</td><td className="end"><span className="num">{size(k.onDisk, unit)}</span></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

const DAYS: [string, string][] = [["SUN", "الأحد"], ["MON", "الإثنين"], ["TUE", "الثلاثاء"], ["WED", "الأربعاء"], ["THU", "الخميس"], ["FRI", "الجمعة"], ["SAT", "السبت"]];

export function ScheduleCard({ session }: { session: Session | null }) {
  const blank: Schedule = { root: session?.root ?? "", frequency: "weekly", day: "FRI", time: "20:00", notifyFull: true, ruleTemp: false, ruleBrowserCache: false, ruleOldDownloads: false };
  const [form, setForm] = useState<Schedule>(blank);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  useEffect(() => {
    engine.getSchedule().then((s) => {
      if (s) {
        setForm(s);
        setSaved(true);
      }
    }, () => {});
  }, []);
  const up = (p: Partial<Schedule>) => setForm((f) => ({ ...f, ...p }));
  const save = () => engine.setSchedule(form).then(() => {
    setSaved(true);
    setStatus({ kind: "info", text: "تم الحفظ في جدول مهام ويندوز." });
  }, (e) => setStatus({ kind: "error", text: String(e) }));
  const remove = () => engine.removeSchedule().then(() => {
    setSaved(false);
    setStatus({ kind: "info", text: "أُلغي الفحص المجدول." });
  }, (e) => setStatus({ kind: "error", text: String(e) }));
  const anyRule = form.ruleTemp || form.ruleBrowserCache || form.ruleOldDownloads;
  return (
    <section className="card" aria-labelledby="sc">
      <h2 id="sc" className="card-title">الفحص المجدول والقواعد التلقائية</h2>
      <div className="card-body">
        <label className="field"><span className="muted small">المكان</span><input dir="ltr" className="input path" value={form.root} onChange={(e) => up({ root: e.target.value })} /></label>
        <div className="filters">
          <label className="field"><span className="muted small">التكرار</span>
            <select className="input" value={form.frequency} onChange={(e) => up({ frequency: e.target.value })}>
              <option value="daily">يومياً</option><option value="weekly">أسبوعياً</option><option value="monthly">شهرياً</option>
            </select></label>
          {form.frequency === "weekly" && <label className="field"><span className="muted small">اليوم</span>
            <select className="input" value={form.day} onChange={(e) => up({ day: e.target.value })}>{DAYS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>}
          <label className="field"><span className="muted small">الوقت</span><input type="time" dir="ltr" className="input" value={form.time} onChange={(e) => up({ time: e.target.value })} /></label>
        </div>
        <label className="choice"><input type="checkbox" checked={form.notifyFull} onChange={(e) => up({ notifyFull: e.target.checked })} />نبهني عند امتلاء القرص 90%</label>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>عند كل فحص مجدول</h3>
        <label className="choice"><input type="checkbox" checked={form.ruleTemp} onChange={(e) => up({ ruleTemp: e.target.checked })} />انقل الملفات المؤقتة للحجر</label>
        <label className="choice"><input type="checkbox" checked={form.ruleBrowserCache} onChange={(e) => up({ ruleBrowserCache: e.target.checked })} />انقل كاش المتصفح للحجر</label>
        <label className="choice"><input type="checkbox" checked={form.ruleOldDownloads} onChange={(e) => up({ ruleOldDownloads: e.target.checked })} />انقل تنزيلات أقدم من 6 أشهر للحجر</label>
        <p className="muted small">{anyRule ? "هذا يحرك ملفاتك بدون سؤال وأنت مش موجود. تنتقل للحجر المؤقت 30 يوماً وتقدر تسترجعها من السجل، ثم تُحذف." : "القواعد كلها مغلقة: الفحص المجدول يقرأ فقط، وما يحرك شي."}</p>
        {status && <p className={`note ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}><span>{status.text}</span></p>}
        <div className="actions-row">
          <button type="button" className="btn" disabled={!form.root.trim()} onClick={() => void save()}>{saved ? "تحديث الجدول" : "حفظ الجدول"}</button>
          {saved && <button type="button" className="btn" onClick={() => void remove()}>إلغاء الفحص المجدول</button>}
        </div>
      </div>
    </section>
  );
}


// About, updates, the diagnostic file, and Pro activation.

import { useEffect, useState } from "react";
import { engine, type KeyCheck, type LicenseError, type LicenseStatus, type UpdateInfo } from "../engine";
import { href } from "../routes";
import { updateSettings, useSettings } from "../settings";

const LIBS: { name: string; lic: string; note: string }[] = [
  { name: "Tauri", lic: "MIT / Apache-2.0", note: "نافذة البرنامج" },
  { name: "React", lic: "MIT", note: "الواجهة" },
  { name: "BLAKE3", lic: "CC0 / Apache-2.0", note: "كشف المكررات" },
  { name: "ed25519-dalek", lic: "BSD-3-Clause", note: "التحقق من ملف التفعيل" },
  { name: "IBM Plex", lic: "OFL-1.1", note: "الخطوط" },
];

/** "Is there a new version?" Asked once, on first run. No is the default, closing counts as no. */
export function UpdatesQuestion() {
  const { checkUpdates } = useSettings();
  const [portable, setPortable] = useState<boolean | null>(null);
  useEffect(() => {
    engine.isPortable().then(setPortable, () => setPortable(false));
  }, []);
  if (checkUpdates !== null || engine.demo || portable !== false) return null;
  const answer = (yes: boolean) => updateSettings({ checkUpdates: yes });
  return (
    <div className="backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-updates"
        className="card dialog"
        onKeyDown={(e) => e.key === "Escape" && answer(false)}
      >
        <h2 id="ask-updates" className="card-title">تريد إنو نبحث عن التحديثات؟</h2>
        <div className="card-body">
          <p>جَرد يعمل بدون إنترنت. إذا وافقت، نقرأ عند كل تشغيل ملفاً صغيراً فيه رقم آخر إصدار، ولا نحمّل شيئاً إلا إذا وافقت أنت.</p>
          <p className="muted small">لا نرسل أي بيانات عن جهازك أو ملفاتك. الخادم يرى عنوان IP كأي اتصال بالإنترنت. تقدر تغيّر رأيك من الإعدادات، وبدون التحديثات ما بتوصلك الإصلاحات الأمنية تلقائياً.</p>
          <div className="actions-row">
            <button type="button" className="btn" autoFocus onClick={() => answer(false)}>لا، شكراً</button>
            <button type="button" className="btn" onClick={() => answer(true)}>نعم، ابحث عن التحديثات</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdateCard() {
  const { checkUpdates } = useSettings();
  const [state, setState] = useState<"idle" | "checking" | "none" | "found" | "installing" | "error" | "install_failed">("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const check = () => {
    setState("checking");
    engine.checkUpdate().then(
      (u) => {
        setInfo(u);
        setState(u ? "found" : "none");
      },
      (e) => {
        setError(String(e));
        setState("error");
      },
    );
  };
  useEffect(() => {
    if (checkUpdates === true) check();
    // At opening only: toggling the setting isn't a request to go online right now.
  }, []);

  const install = () => {
    setState("installing");
    engine.installUpdate(setProgress).catch((e) => {
      setError(String(e));
      setState("install_failed");
    });
  };

  return (
    <section className="card" aria-labelledby="up" style={state === "found" ? { borderColor: "var(--data-2)" } : undefined}>
      <h2 id="up" className="card-title">
        {state === "found" && info ? <>يوجد إصدار جديد · <span className="num">{info.version}</span></> : "التحديثات"}
      </h2>
      <div className="card-body">
        {state === "found" && info?.notes && <p style={{ whiteSpace: "pre-wrap" }}>{info.notes}</p>}
        {state === "none" && <p role="status">عندك آخر إصدار.</p>}
        {state === "checking" && <p role="status" className="muted">يبحث…</p>}
        {state === "installing" && <p role="status">ينزّل ويثبّت{progress !== null ? <> · <span className="num">{progress}%</span></> : "…"} البرنامج رح يسكّر ليتثبّت التحديث. إذا ما فتح لحاله، افتحه من جديد.</p>}
        {state === "error" && <p className="note error" role="alert"><span>تعذّر البحث عن التحديثات. تقدر تنزّل آخر نسخة يدوياً. <span className="path small">{error}</span></span></p>}
        {state === "install_failed" && <p className="note error" role="alert"><span>ما تثبّت التحديث، وبرنامجك كما هو: إما تعذّر التنزيل أو ما طابق توقيعه فرفضناه. <span className="path small">{error}</span></span></p>}
        <div className="actions-row">
          {state === "found" ? (
            <>
              <button type="button" className="btn btn-primary" onClick={install}>تنزيل وتحديث</button>
              <button type="button" className="btn" onClick={() => setState("idle")}>لاحقاً</button>
            </>
          ) : (
            <button type="button" className="btn" disabled={state === "checking" || state === "installing"} onClick={check}>ابحث الآن</button>
          )}
        </div>
        <p className="muted small">
          {checkUpdates ? "البحث التلقائي مفعّل عند كل تشغيل." : "البحث التلقائي مغلق. زر «ابحث الآن» يتصل مرة واحدة فقط."}{" "}
          نقرأ رقم الإصدار فقط ولا نرسل بيانات عن جهازك؛ الخادم يرى عنوان IP كأي اتصال. كل تحديث موقّع، ويُرفض إذا لم يطابق التوقيع.
        </p>
      </div>
    </section>
  );
}

function Diagnostics() {
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="sup">
      <h2 id="sup" className="card-title">الدعم والمشاكل</h2>
      <div className="card-body">
        <p className="quiet">ما في تتبّع ولا إرسال تلقائي للأخطاء. إذا صارت مشكلة، نجمع لك ملف تشخيص وتشوفه قبل ما ترسله بنفسك.</p>
        <p className="muted small">لا يحتوي أسماء ملفاتك ولا محتواها ولا أسماء الأقراص ولا مفتاح التفعيل.</p>
        {text !== null && <pre className="path small diag" aria-label="محتوى ملف التشخيص">{text}</pre>}
        {status && <p role="status" className="small">{status}</p>}
        <div className="actions-row">
          <button type="button" className="btn" onClick={() => void engine.diagnosticsText().then(setText, (e) => setStatus(String(e)))}>إنشاء ملف تشخيص</button>
          {text !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => void engine.pickSavePath("jard-diagnostics.txt", "txt").then(async (p) => {
                if (!p) return;
                await engine.saveDiagnostics(p);
                setStatus(`حُفظ في ${p}`);
              }).catch((e) => setStatus(String(e)))}
            >
              حفظ الملف
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function AboutScreen() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    engine.appVersion().then(setVersion, () => {});
  }, []);
  return (
    <>
      <header className="page-head"><div className="title"><h1>حول جَرد</h1></div></header>
      <UpdateCard />
      <div className="guard-grid">
        <section className="card" aria-labelledby="ab">
          <h2 id="ab" className="card-title">جَرد</h2>
          <div className="card-body">
            <div className="change-top"><span className="muted">الإصدار</span><span className="num">{version}</span></div>
            <div className="change-top"><span className="muted">المطوّر</span><bdi>Mahmoud F.M. Abuteir</bdi></div>
            <div className="change-top"><span className="muted">التوقيع الرقمي</span><span>غير موقّع بعد</span></div>
            <div className="change-top"><span className="muted">المنصة</span><span className="num">Windows 10/11 · x64</span></div>
            <div className="actions-row"><a className="btn" href={href("license")}>النسخة والتفعيل</a></div>
          </div>
        </section>
        <section className="card" aria-labelledby="oss">
          <h2 id="oss" className="card-title">مكتبات مفتوحة أساسية وتراخيصها</h2>
          {LIBS.map((l) => (
            <div key={l.name} className="line-item quarantine-row">
              <span className="num grow" style={{ flex: "1 1 140px" }}>{l.name}</span>
              <span className="num label badge">{l.lic}</span>
              <span className="muted small">{l.note}</span>
            </div>
          ))}
        </section>
        <Diagnostics />
      </div>
    </>
  );
}

const LICENSE_ERROR: Record<LicenseError, string> = {
  unreadable: "هذا مش ملف تفعيل.",
  bad_signature: "الملف تغيّر بعد إصداره، أو ليس منا. ما انقبل.",
  other_device: "الملف سليم لكنه صادر لجهاز آخر. أرسل رمز هذا الجهاز لتحصل على ملف له.",
};

function keyMessage(c: KeyCheck | null): string | null {
  if (!c) return null;
  switch (c.kind) {
    case "ok":
      return null;
    case "short":
      return `ناقص ${c.missing} خانات. المفتاح 12 خانة بعد JARD.`;
    case "long":
      return `فيه ${c.extra} خانات زيادة. المفتاح 12 خانة بعد JARD.`;
    case "bad_character":
      return "المفتاح فيه حروف إنجليزية وأرقام فقط.";
  }
}

const FREE = ["فحص كامل للأقراص والخريطة", "التنظيف اليدوي والحجر المؤقت", "صحة الأقراص والعتاد", "شرح الملفات والبحث", "يعمل بدون إنترنت"];
const PRO = ["الفحص المجدول والتنبيهات", "مقارنة الفحوص وتوقع الامتلاء", "تصدير التقارير", "قواعد التنظيف التلقائي", "الأقراص الشبكية", "اختبارات العتاد المتقدمة"];

export function LicenseScreen() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () => engine.licenseStatus().then(setStatus, (e) => setNotice({ kind: "error", text: String(e) }));
  useEffect(() => {
    void load();
  }, []);

  const typed = (v: string) => {
    setKey(v);
    if (v.trim()) void engine.checkLicenseKey(v).then(setCheck);
    else setCheck(null);
  };
  const pickFile = async () => {
    const path = await engine.pickLicenseFile();
    if (!path) return;
    const r = await engine.activateFile(path);
    if (r.ok) setNotice({ kind: "info", text: "تم التفعيل على هذا الجهاز. المفتاح يسمح بثلاثة أجهزة." });
    else setNotice({ kind: "error", text: LICENSE_ERROR[r.error] });
    void load();
  };
  const message = keyMessage(check);

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1>النسخة والتفعيل</h1>
          <p className="muted small">النسخة المجانية كاملة للفحص والفهم. المدفوعة للأتمتة والتقارير والأدوات المتقدمة.</p>
        </div>
      </header>
      {notice && <p className={`note ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><span>{notice.text}</span></p>}
      {status?.problem && <p className="note warn" role="status"><span>ملف التفعيل المحفوظ لم يعد صالحاً: {LICENSE_ERROR[status.problem]}</span></p>}
      <p className="note info" role="note"><span>حتى الآن كل الميزات مفتوحة للجميع: السعر وحدود التجربة لم تُحدَّد بعد.</span></p>
      <div className="stats">
        <section className="card" aria-labelledby="free" style={{ padding: 0 }}>
          <h2 id="free" className="card-title">مجاني</h2>
          <div className="card-body">{FREE.map((f) => <div key={f}><span className="safety-safe">+</span> {f}</div>)}</div>
        </section>
        <section className="card" aria-labelledby="pro" style={{ padding: 0, borderColor: "var(--accent)" }}>
          <h2 id="pro" className="card-title">Pro · دفعة واحدة</h2>
          <div className="card-body">
            {PRO.map((f) => <div key={f}><span className="accent-text">+</span> {f}</div>)}
            <p className="muted small">بدون اشتراك. التحديثات مجانية سنة، والبرنامج يبقى يعمل بعدها.</p>
          </div>
        </section>
        <section className="card" aria-labelledby="act" style={{ padding: 0 }}>
          <h2 id="act" className="card-title">تفعيل بدون إنترنت</h2>
          <div className="card-body">
            {status?.license ? (
              <>
                <p role="status"><strong className="safety-safe">مفعّل على هذا الجهاز.</strong></p>
                <div className="change-top"><span className="muted">المفتاح</span><span className="num">{status.license.key}</span></div>
                <button type="button" className="btn" onClick={() => void engine.deactivate().then(load)}>إلغاء التفعيل على هذا الجهاز</button>
              </>
            ) : (
              <>
                <label className="field"><span className="muted small">المفتاح</span>
                  <input type="text" dir="ltr" className="input path" placeholder="JARD-XXXX-XXXX-XXXX" value={key} aria-describedby="key-msg" onChange={(e) => typed(e.target.value)} />
                </label>
                {message && <p id="key-msg" className="small safety-careful" role="status">{message}</p>}
                <ol className="muted" style={{ margin: 0, paddingInlineStart: 18 }}>
                  <li>انسخ رمز الجهاز وأرسله مع مفتاحك.</li>
                  <li>بنرجعلك ملف تفعيل لهذا الجهاز.</li>
                  <li>افتح الملف من هنا.</li>
                </ol>
                <div className="path small diag">{status?.device ?? "…"}</div>
                <div className="actions-row">
                  <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(status?.device ?? "").then(() => setCopied(true))}>{copied ? "نُسخ" : "نسخ الرمز"}</button>
                  <button type="button" className="btn" onClick={() => void pickFile()}>اختيار ملف التفعيل</button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

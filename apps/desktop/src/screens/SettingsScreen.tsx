import { useEffect, useState } from "react";
import { engine, type Integration } from "../engine";
import { middle } from "../format";
import { href } from "../routes";
import type { Unit } from "../format";
import { updateSettings, useSettings, type Theme } from "../settings";

const THEMES: { id: Theme; name: string }[] = [
  { id: "dark", name: "داكن" },
  { id: "light", name: "فاتح" },
  { id: "system", name: "حسب النظام" },
];

const UNITS: { id: Unit; name: string; hint: string }[] = [
  { id: "GB", name: "GB", hint: "1 GB = 1,000,000,000 بايت. كما تكتبه الشركات على الأقراص." },
  { id: "GiB", name: "GiB", hint: "1 GiB = 1,073,741,824 بايت. كما يحسبه ويندوز." },
];

export function SettingsScreen() {
  const s = useSettings();
  const [forgot, setForgot] = useState<string | null>(null);
  const [portable, setPortable] = useState(false);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    engine.isPortable().then(setPortable, () => {});
    engine.getIntegration().then(setIntegration, () => {});
  }, []);
  const change = (work: Promise<void>, next: Integration) => {
    setProblem(null);
    work.then(() => setIntegration(next), (e) => setProblem(String(e)));
  };
  const addExcluded = async () => {
    const folder = await engine.pickFolder().catch(() => null);
    if (folder && !s.excluded.includes(folder)) updateSettings({ excluded: [...s.excluded, folder] });
  };
  return (
    <>
      <header className="page-head">
        <div className="title"><h1>الإعدادات</h1></div>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <fieldset>
          <legend>اللغة</legend>
          {(["ar", "en"] as const).map((l) => (
            <label key={l} className="choice">
              <input
                type="radio"
                name="language"
                checked={s.language === l}
                onChange={() => {
                  updateSettings({ language: l });
                  location.reload();
                }}
              />
              {l === "ar" ? <span lang="ar">العربية</span> : <span lang="en">English</span>}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>مستوى التفاصيل</legend>
          <label className="choice">
            <input type="radio" name="level" checked={s.level === "simple"} onChange={() => updateSettings({ level: "simple" })} />
            <span>مبتدئ<span className="muted small" style={{ display: "block" }}>نخفي الأرقام التقنية ونعرض النتيجة والإجراء المقترح.</span></span>
          </label>
          <label className="choice">
            <input type="radio" name="level" checked={s.level === "expert"} onChange={() => updateSettings({ level: "expert" })} />
            <span>خبير<span className="muted small" style={{ display: "block" }}>كل القراءات والمسارات والأكواد ظاهرة.</span></span>
          </label>
        </fieldset>
        <fieldset>
          <legend>المظهر</legend>
          {THEMES.map((t) => (
            <label key={t.id} className="choice">
              <input type="radio" name="theme" checked={s.theme === t.id} onChange={() => updateSettings({ theme: t.id })} />
              {t.name}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>وحدة الحجم</legend>
          {UNITS.map((u) => (
            <label key={u.id} className="choice">
              <input type="radio" name="unit" checked={s.unit === u.id} onChange={() => updateSettings({ unit: u.id })} />
              <span className="num">{u.name}</span>
              <span className="muted small">{u.hint}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>الفحص</legend>
          <label className="choice">
            <input type="checkbox" checked={s.fastMft} onChange={(e) => updateSettings({ fastMft: e.target.checked })} />
            <span>
              الفحص السريع عبر جدول NTFS (MFT)
              <span className="muted small" style={{ display: "block" }}>
                يفحص القرص كاملاً في ثوانٍ معدودة عبر قراءة جدول الملفات مباشرة. يحتاج تشغيل البرنامج كمسؤول، ويتراجع للفحص العادي تلقائياً إذا تعذّر.
              </span>
            </span>
          </label>
          <label className="choice">
            <input type="checkbox" checked={s.dedupHardlinks} onChange={(e) => updateSettings({ dedupHardlinks: e.target.checked })} />
            <span>
              احسب الروابط الصلبة مرة واحدة
              <span className="muted small" style={{ display: "block" }}>
                أدق لمجلد Windows، لكن الفحص يصير أبطأ مرتين تقريباً. يسري على الفحص التالي.
              </span>
            </span>
          </label>
        </fieldset>
        <fieldset>
          <legend>مجلدات مستثناة من الفحص</legend>
          {s.excluded.length === 0 && <p className="muted" style={{ padding: "0 10px 6px" }}>ما في مجلدات مستثناة. يسري على الفحص التالي.</p>}
          {s.excluded.map((f) => (
            <div key={f} className="line-item quarantine-row">
              <span className="path small grow" title={f}>{middle(f, 60)}</span>
              <button type="button" className="btn" onClick={() => updateSettings({ excluded: s.excluded.filter((x) => x !== f) })}>إزالة</button>
            </div>
          ))}
          <div className="actions-row" style={{ padding: "6px 10px" }}>
            <button type="button" className="btn" onClick={() => void addExcluded()}>إضافة مجلد</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>التكامل مع ويندوز</legend>
          {portable ? (
            <p className="quiet" style={{ padding: "0 10px 6px" }}>هذه نسخة محمولة: كل بياناتها بجانب البرنامج، ولا تضيف شيئاً إلى ويندوز.</p>
          ) : integration === null ? (
            <p className="muted" style={{ padding: "0 10px 6px" }}>هذا الخيار لويندوز فقط.</p>
          ) : (
            <>
              <label className="choice">
                <input type="checkbox" checked={integration.contextMenu} onChange={(e) => change(engine.setContextMenu(e.target.checked), { ...integration, contextMenu: e.target.checked })} />
                "افحص بجرد" في قائمة الضغط يمين
              </label>
              <label className="choice">
                <input type="checkbox" checked={integration.startCheck} onChange={(e) => change(engine.setStartCheck(e.target.checked), { ...integration, startCheck: e.target.checked })} />
                <span>
                  التشغيل مع ويندوز للتنبيهات
                  <span className="muted small" style={{ display: "block" }}>عند الدخول نفحص المساحة المتاحة فقط، وننبهك إذا امتلأ قرص بأكثر من 90%. لا نافذة تبقى مفتوحة.</span>
                </span>
              </label>
              {problem && <p className="note error" role="alert"><span>{problem}</span></p>}
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>الخصوصية</legend>
          <p className="quiet" style={{ padding: "0 10px 6px" }}>يعمل بدون إنترنت، ولا ترسل نتائج الفحص إلى أي جهة.</p>
          <label className="choice">
            <input type="checkbox" checked={s.keepResults} onChange={(e) => updateSettings({ keepResults: e.target.checked })} />
            <span>
              احفظ نتائج الفحوص للمقارنة
              <span className="muted small" style={{ display: "block" }}>
                تُحفظ أسماء الملفات وأحجامها على هذا الجهاز فقط، لتفتح آخر نتيجة بدون فحص جديد.
              </span>
            </span>
          </label>
          <label className="choice">
            <input type="checkbox" disabled={portable} checked={!portable && s.checkUpdates === true} onChange={(e) => updateSettings({ checkUpdates: e.target.checked })} />
            <span>
              البحث عن تحديثات البرنامج
              <span className="muted small" style={{ display: "block" }}>{portable ? "النسخة المحمولة لا تحدّث نفسها: نزّل الإصدار الجديد واستبدلها." : "نقرأ رقم آخر إصدار عند كل تشغيل. لا نرسل بيانات عن جهازك؛ الخادم يرى عنوان IP كأي اتصال."}</span>
            </span>
          </label>
          <div className="actions-row" style={{ padding: "6px 10px" }}>
            <a className="btn" href={href("about")}>حول البرنامج والدعم</a>
            <a className="btn" href={href("license")}>النسخة والتفعيل</a>
            <button
              type="button"
              className="btn"
              onClick={() => void engine.forgetSaved().then(() => setForgot("مُسحت النتائج المحفوظة. الحجر المؤقت لم يتغير."), (e) => setForgot(String(e)))}
            >
              امسح النتائج المحفوظة
            </button>
            {forgot && <span role="status" className="small">{forgot}</span>}
          </div>
        </fieldset>
      </div>
    </>
  );
}

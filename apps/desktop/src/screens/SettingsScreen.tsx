import { useState } from "react";
import { engine } from "../engine";
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
            <input type="checkbox" checked={s.checkUpdates === true} onChange={(e) => updateSettings({ checkUpdates: e.target.checked })} />
            <span>
              البحث عن تحديثات البرنامج
              <span className="muted small" style={{ display: "block" }}>نقرأ رقم آخر إصدار عند كل تشغيل. لا نرسل بيانات عن جهازك؛ الخادم يرى عنوان IP كأي اتصال.</span>
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

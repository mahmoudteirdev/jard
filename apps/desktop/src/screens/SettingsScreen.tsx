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
  return (
    <>
      <header className="page-head">
        <div className="title"><h1>الإعدادات</h1></div>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
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
      </div>
    </>
  );
}

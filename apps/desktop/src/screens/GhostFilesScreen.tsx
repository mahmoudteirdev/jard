import { useEffect, useMemo, useState } from "react";
import { engine, type GhostFile } from "../engine";
import { ago, middle, size } from "../format";
import { useSettings } from "../settings";

export function GhostFilesScreen() {
  const { unit } = useSettings();
  const [loading, setLoading] = useState(true);
  const [ghosts, setGhosts] = useState<GhostFile[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [minDays, setMinDays] = useState<number>(30);
  const [selectedFiles, setSelectedFiles] = useState<Map<string, GhostFile>>(new Map());
  const [cleaning, setCleaning] = useState(false);
  const [cleanMessage, setCleanMessage] = useState<string | null>(null);

  const loadGhostFiles = () => {
    setLoading(true);
    setCleanMessage(null);
    engine
      .scanGhostFiles(undefined, minDays, 1)
      .then((res) => {
        setGhosts(res);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadGhostFiles();
  }, [minDays]);

  const filteredGhosts = useMemo(() => {
    return ghosts.filter((g) => {
      if (filterCategory === "all") return true;
      return g.category.toLowerCase() === filterCategory.toLowerCase();
    });
  }, [ghosts, filterCategory]);

  const totalReclaimable = useMemo(() => {
    let total = 0;
    for (const f of selectedFiles.values()) {
      total += f.size;
    }
    return total;
  }, [selectedFiles]);

  const toggleFile = (f: GhostFile) => {
    setSelectedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(f.path)) {
        next.delete(f.path);
      } else {
        next.set(f.path, f);
      }
      return next;
    });
  };

  const selectOlderThan60 = () => {
    const next = new Map<string, GhostFile>();
    for (const f of filteredGhosts) {
      if (f.daysStale >= 60) {
        next.set(f.path, f);
      }
    }
    setSelectedFiles(next);
  };

  const clearSelection = () => {
    setSelectedFiles(new Map());
  };

  const handleClean = async () => {
    if (selectedFiles.size === 0) return;
    setCleaning(true);
    const paths = Array.from(selectedFiles.keys());
    try {
      const result = await engine.quarantinePaths(paths);
      setCleanMessage(
        `تم نقل ${result.moved.length} ملف بنجاح إلى الحجر الصحي الآمن (30 يوماً). تم تحرير ${size(result.bytesReclaimed, unit)}.`
      );
      setSelectedFiles(new Map());
      loadGhostFiles();
    } catch (err) {
      setCleanMessage(`خطأ أثناء التنظيف: ${String(err)}`);
    } finally {
      setCleaning(false);
    }
  };

  const categoryName = (cat: string) => {
    switch (cat) {
      case "Installer":
        return "مثبت برامج";
      case "Archive":
        return "ملف مضغوط";
      case "DiskImage":
        return "صورة قرص (ISO)";
      case "Document":
        return "مستند";
      case "Media":
        return "وسائط";
      default:
        return "ملف منزّل";
    }
  };

  return (
    <div className="ghost-files-screen">
      <div className="head" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="title">صائد الملفات المهجورة (Ghost Files)</h1>
          <p className="note">
            يكتشف الملفات التي تم تنزيلها أو استخدامها لمرة واحدة فقط ولم تُفتح مجدداً منذ ذلك اليوم (مثل حزم التثبيت، الأرشيفات، وصور الـ ISO القديمة).
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={loadGhostFiles} disabled={loading || cleaning}>
            {loading ? "جارٍ الفحص…" : "إعادة الفحص"}
          </button>
        </div>
      </div>

      {cleanMessage && (
        <div className="card safety-clean" style={{ padding: "12px 16px", marginBottom: 16 }}>
          <strong>{cleanMessage}</strong>
        </div>
      )}

      {/* Filters and options */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="label muted">النوع:</span>
            <select
              className="select"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="all">كل الأنواع</option>
              <option value="Installer">مثبتات البرامج (EXE / MSI / APK)</option>
              <option value="Archive">الأرشيفات (ZIP / RAR / 7Z)</option>
              <option value="DiskImage">صور الأقراص (ISO / VHD)</option>
              <option value="Document">المستندات (PDF / Office)</option>
              <option value="Media">الوسائط (فيديو وصوت)</option>
            </select>

            <span className="label muted" style={{ marginInlineStart: 8 }}>مهجور منذ أكثر من:</span>
            <select
              className="select"
              value={minDays}
              onChange={(e) => setMinDays(Number(e.target.value))}
            >
              <option value={15}>15 يوماً</option>
              <option value={30}>30 يوماً (شهر)</option>
              <option value={60}>60 يوماً (شهران)</option>
              <option value={90}>90 يوماً (3 أشهر)</option>
              <option value={180}>180 يوماً (6 أشهر)</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn small" onClick={selectOlderThan60} disabled={loading}>
              تحديد الأقدم من 60 يوماً
            </button>
            {selectedFiles.size > 0 && (
              <button type="button" className="btn small" onClick={clearSelection}>
                إلغاء التحديد
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action banner when files selected */}
      {selectedFiles.size > 0 && (
        <div
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            background: "var(--jard-surface-raised)",
            border: "1px solid var(--jard-accent)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <strong>تم تحديد {selectedFiles.size} ملف مهجور.</strong>{" "}
            <span className="muted">المساحة التي ستُحرر:</span>{" "}
            <strong className="num safety-clean">{size(totalReclaimable, unit)}</strong>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleClean}
            disabled={cleaning}
          >
            {cleaning ? "جارٍ النقل للحجر…" : "نقل المحدد للحجر الصحي الآمن (30 يوماً)"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">جارٍ فحص التنزيلات والمجلدات الشخصية عن الملفات المهجورة…</p>
        </div>
      ) : filteredGhosts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">لا توجد ملفات مهجورة تطابق الفلاتر المحددة.</p>
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}><span className="sr-only">تحديد</span></th>
                <th>الملف</th>
                <th>النوع</th>
                <th>تاريخ التنزيل / الإنشاء</th>
                <th>سبب التصنيف</th>
                <th className="end">الحجم</th>
              </tr>
            </thead>
            <tbody>
              {filteredGhosts.map((f) => {
                const isChecked = selectedFiles.has(f.path);
                return (
                  <tr key={f.path}>
                    <td>
                      <label className="pick">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleFile(f)}
                        />
                      </label>
                    </td>
                    <td>
                      <div className="name" style={{ fontWeight: 600 }}>{f.name}</div>
                      <div className="path label muted" title={f.path}>{middle(f.path, 75)}</div>
                    </td>
                    <td>
                      <span className="badge">{categoryName(f.category)}</span>
                    </td>
                    <td className="quiet">
                      {f.created ? ago(f.created * 1000) : "—"}
                    </td>
                    <td className="quiet small">
                      {f.reason}
                    </td>
                    <td className="end">
                      <span className="num">{size(f.size, unit)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

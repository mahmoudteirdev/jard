import { useEffect, useMemo, useState } from "react";
import { engine, type DevArtifact, type DevProject } from "../engine";
import { ago, middle, size } from "../format";
import { useSettings } from "../settings";

export function DevCleanerScreen() {
  const { unit } = useSettings();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedArtifacts, setSelectedArtifacts] = useState<Map<string, DevArtifact>>(new Map());
  const [cleaning, setCleaning] = useState(false);
  const [cleanMessage, setCleanMessage] = useState<string | null>(null);

  const loadProjects = () => {
    setLoading(true);
    setCleanMessage(null);
    engine
      .scanDevBloat()
      .then((res) => {
        setProjects(res);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchKind = filterKind === "all" || p.kind.toLowerCase() === filterKind.toLowerCase();
      const matchStatus = filterStatus === "all" || p.status.toLowerCase() === filterStatus.toLowerCase();
      return matchKind && matchStatus;
    });
  }, [projects, filterKind, filterStatus]);

  const totalReclaimable = useMemo(() => {
    let total = 0;
    for (const art of selectedArtifacts.values()) {
      total += art.onDisk;
    }
    return total;
  }, [selectedArtifacts]);

  const toggleArtifact = (art: DevArtifact) => {
    setSelectedArtifacts((prev) => {
      const next = new Map(prev);
      if (next.has(art.path)) {
        next.delete(art.path);
      } else {
        next.set(art.path, art);
      }
      return next;
    });
  };

  const selectAbandoned = () => {
    const next = new Map<string, DevArtifact>();
    for (const p of projects) {
      if (p.status === "Abandoned" || p.daysInactive >= 90) {
        for (const art of p.artifacts) {
          next.set(art.path, art);
        }
      }
    }
    setSelectedArtifacts(next);
  };

  const clearSelection = () => {
    setSelectedArtifacts(new Map());
  };

  const handleClean = async () => {
    if (selectedArtifacts.size === 0) return;
    setCleaning(true);
    const paths = Array.from(selectedArtifacts.keys());
    try {
      const result = await engine.quarantinePaths(paths);
      setCleanMessage(
        `تم نقل ${result.moved.length} مجلد بنجاح إلى الحجر الصحي الآمن (30 يوماً). تم تحرير ${size(result.bytesReclaimed, unit)}.`
      );
      setSelectedArtifacts(new Map());
      loadProjects();
    } catch (err) {
      setCleanMessage(`خطأ أثناء التنظيف: ${String(err)}`);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="dev-cleaner-screen">
      <div className="head" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="title">صائد مجلدات المطورين (Dev Bloat)</h1>
          <p className="note">
            يكتشف مجلدات البناء والمكتبات المؤقتة (<bdi>node_modules</bdi>، <bdi>target</bdi>، <bdi>.venv</bdi>، <bdi>build</bdi>) للمشاريع غير النشطة، لنقلها بأمان إلى الحجر الصحي دون لمس الكود المصدري.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={loadProjects} disabled={loading || cleaning}>
            {loading ? "جارٍ الفحص…" : "إعادة الفحص"}
          </button>
        </div>
      </div>

      {cleanMessage && (
        <div className="card safety-clean" style={{ padding: "12px 16px", marginBottom: 16 }}>
          <strong>{cleanMessage}</strong>
        </div>
      )}

      {/* Controls and filters */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="label muted">البيئة:</span>
            <select
              className="select"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
            >
              <option value="all">كل البيئات</option>
              <option value="Node">Node.js / JS</option>
              <option value="Rust">Rust / Cargo</option>
              <option value="Python">Python</option>
              <option value="Gradle">Gradle / Android</option>
              <option value="Flutter">Flutter / Dart</option>
            </select>

            <span className="label muted" style={{ marginInlineStart: 8 }}>الحالة:</span>
            <select
              className="select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">كل المشاريع</option>
              <option value="Abandoned">مهجور (&gt; 90 يوماً)</option>
              <option value="Stale">خامل (30 - 90 يوماً)</option>
              <option value="Active">نشط حديثاً (&lt; 30 يوماً)</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn small" onClick={selectAbandoned} disabled={loading}>
              تحديد المشاريع المهجورة (&gt; 90 يوم)
            </button>
            {selectedArtifacts.size > 0 && (
              <button type="button" className="btn small" onClick={clearSelection}>
                إلغاء التحديد
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action banner when artifacts selected */}
      {selectedArtifacts.size > 0 && (
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
            <strong>تم تحديد {selectedArtifacts.size} مجلد مؤقت.</strong>{" "}
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
          <p className="muted">جارٍ فحص مسارات التطوير عن مجلدات المشاريع والمخلفات…</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">لم يتم العثور على أي مجلدات بناء أو مكتبات تطابق الفلتر الحالي.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredProjects.map((p) => {
            const statusClass =
              p.status === "Abandoned"
                ? "safety-keep"
                : p.status === "Stale"
                ? "safety-careful"
                : "safety-clean";
            const statusText =
              p.status === "Abandoned"
                ? "مهجور (>90 يوم)"
                : p.status === "Stale"
                ? "خامل (30-90 يوم)"
                : "نشط حديثاً";

            return (
              <div key={p.path} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 16 }}>{p.name}</strong>
                      <span className="badge">{p.kind}</span>
                      <span className={`badge ${statusClass}`}>{statusText}</span>
                    </div>
                    <div className="muted small" title={p.path} style={{ marginTop: 2 }}>
                      {middle(p.path, 90)} · آخر تعديل: {p.lastModified ? ago(p.lastModified * 1000) : "غير معروف"} ({p.daysInactive} يوماً)
                    </div>
                  </div>
                  <div className="end">
                    <span className="muted small">إجمالي المخلفات: </span>
                    <strong className="num">{size(p.totalOnDisk, unit)}</strong>
                  </div>
                </div>

                {/* Artifacts table */}
                <div className="table-wrap" style={{ borderTop: "1px solid var(--jard-line)", paddingTop: 8 }}>
                  <table className="table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}><span className="sr-only">تحديد</span></th>
                        <th>المجلد المؤقت</th>
                        <th>الملفات</th>
                        <th>أمر إعادة التثبيت لاحقاً</th>
                        <th className="end">الحجم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.artifacts.map((art) => {
                        const isChecked = selectedArtifacts.has(art.path);
                        return (
                          <tr key={art.path}>
                            <td>
                              <label className="pick">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleArtifact(art)}
                                />
                              </label>
                            </td>
                            <td>
                              <code>{art.name}</code>
                            </td>
                            <td className="quiet">{art.files} ملف</td>
                            <td className="quiet">
                              <code>{art.reinstallCmd}</code>
                            </td>
                            <td className="end">
                              <span className="num">{size(art.onDisk, unit)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

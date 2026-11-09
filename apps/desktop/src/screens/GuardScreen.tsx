import { useEffect, useRef, useState } from "react";
import { clearPendingClean, rememberMoved, treeChanged, usePendingClean } from "../clean-session";
import { canRetry, effectText, failureText, reasonText } from "../clean-text";
import { engine, type CleanPreview, type Failure, type NodeOutcome, type QuarantineItem } from "../engine";
import { middle, num, size } from "../format";
import { go, href } from "../routes";
import { useSettings } from "../settings";

type Stage = "preview" | "working" | "elevate" | "result";

/** The step before anything moves: a dry run, then what actually happened (Guard board). */
export function GuardScreen() {
  const pending = usePendingClean();
  const { unit } = useSettings();
  const [stage, setStage] = useState<Stage>("preview");
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [moved, setMoved] = useState<QuarantineItem[]>([]);
  const [failed, setFailed] = useState<NodeOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    setStage("preview");
    setMoved([]);
    setFailed([]);
    setUndone(null);
    setDeclined(false);
    engine.previewClean(pending.scanId, pending.nodes.map((n) => n.id)).then(
      (p) => live && setPreview(p),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [pending]);

  useEffect(() => {
    heading.current?.focus();
  }, [stage]);

  if (!pending) {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 26 }}>ما قبل الحذف</h1>
        <p className="quiet">ما في شي محدد. اختر ملفات من التنظيف أو التخزين أولاً.</p>
        <div className="actions"><a className="btn btn-primary" href={href("cleanup")}>افتح التنظيف</a></div>
      </div>
    );
  }

  const back = () => {
    const to = pending.from;
    clearPendingClean();
    go(to);
  };

  const run = async (ids: number[]) => {
    setStage("working");
    setError(null);
    try {
      const out = await engine.quarantineNodes(pending.scanId, ids);
      const items = [...moved, ...out.flatMap((o) => (o.item ? [o.item] : []))];
      setMoved(items);
      rememberMoved(items);
      const left = out.filter((o) => o.failure);
      setFailed(left);
      treeChanged();
      // Refused by Windows: worth asking for rights. The rest of the batch has already moved.
      if (left.some((o) => o.failure?.kind === "denied")) {
        setStage("elevate");
        return;
      }
    } catch (e) {
      setError(String(e));
    }
    setStage("result");
  };

  const elevate = async () => {
    const ids = failed.filter((f) => f.failure?.kind === "denied").map((f) => f.nodeId);
    setStage("working");
    setDeclined(false);
    try {
      const answer = await engine.elevatedQuarantine(pending.scanId, ids);
      if (answer.declined || !answer.result) {
        setDeclined(true);
      } else {
        const items = [...moved, ...answer.result.flatMap((o) => (o.item ? [o.item] : []))];
        setMoved(items);
        rememberMoved(items);
        // What was refused is now answered. What failed for other reasons stays on the list.
        setFailed([...failed.filter((f) => f.failure?.kind !== "denied"), ...answer.result.filter((o) => o.failure)]);
        treeChanged();
      }
    } catch (e) {
      setError(String(e));
    }
    setStage("result");
  };

  const undo = async () => {
    const left: QuarantineItem[] = [];
    const problems: string[] = [];
    for (const item of moved) {
      const r = await engine.restoreItem(item.id, "fail");
      if (r.failure) {
        left.push(item);
        problems.push(`${item.original}: ${failureText(r.failure)}`);
      }
    }
    setMoved(left);
    rememberMoved([]);
    treeChanged();
    setUndone(problems.length ? `تعذّر استرجاع ${problems.length}. ${problems[0]}` : "تم التراجع: رجعت الملفات إلى أماكنها.");
  };

  const movedDisk = moved.reduce((s, i) => s + i.onDisk, 0);
  const retryable = failed.filter((f) => f.failure && canRetry(f.failure));

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1 ref={heading} tabIndex={-1}>ما قبل الحذف</h1>
        </div>
        <ol aria-label="المرحلة" className="steps">
          <li aria-current={stage === "preview" ? "step" : undefined}>1 · معاينة</li>
          <li aria-current={stage === "elevate" ? "step" : undefined}>2 · الصلاحية</li>
          <li aria-current={stage === "working" || stage === "result" ? "step" : undefined}>3 · النتيجة</li>
        </ol>
      </header>

      {error && <p className="note error" role="alert"><span>{error}</span></p>}

      {stage === "preview" && !preview && !error && <p className="muted" role="status">يحمّل المعاينة…</p>}

      {stage === "preview" && preview && (
        <>
          <div className="guard-grid">
            <section className="card" aria-labelledby="dry">
              <h2 id="dry" className="card-title">معاينة تجريبية · لا شيء يُنقل الآن</h2>
              <div className="card-body">
                <div className="figures">
                  <div>
                    <div className="label muted">يخرج من مكانه</div>
                    <div className="num figure accent-text">{size(preview.onDisk, unit)}</div>
                  </div>
                  <div>
                    <div className="label muted">ملفات</div>
                    <div className="num figure">{num(preview.files)}</div>
                  </div>
                </div>
                <p className="quiet">
                  ينتقل إلى الحجر المؤقت وتقدر تسترجعه خلال <span className="num">30</span> يوماً.
                  المساحة ما بتتحرر قبل انتهاء المدة أو تفريغ الحجر.
                </p>
                {preview.effects.map((e) => {
                  const t = effectText(e.kind);
                  return (
                    <div key={e.kind} className={t.serious ? "effect serious" : "effect"}>
                      <strong>{t.what}</strong>
                      <p className="muted">{t.detail} <span className="num">{num(e.paths.length)}</span> عنصر.</p>
                    </div>
                  );
                })}
                {preview.movable.length === 0 && <p className="note warn"><span>كل ما حددته محمي، فما في شي ينتقل.</span></p>}
              </div>
            </section>

            {preview.refused.length > 0 && (
              <section className="card" aria-labelledby="refused">
                <h2 id="refused" className="card-title">مسارات محمية · لن تُنقل</h2>
                {preview.refused.map((r) => (
                  <div key={r.path} className="line-item">
                    <div className="path small" title={r.path}>{middle(r.path, 70)}</div>
                    <div className="muted small">{reasonText(r.reason)}</div>
                  </div>
                ))}
              </section>
            )}
          </div>
          <div className="actions-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={preview.movable.length === 0}
              onClick={() => void run(pending.nodes.map((n) => n.id))}
            >
              نقل إلى الحجر
            </button>
            <button type="button" className="btn" onClick={back}>رجوع</button>
          </div>
        </>
      )}

      {stage === "working" && <p role="status" className="quiet">ينقل…</p>}

      {stage === "elevate" && (
        <section className="card" aria-labelledby="uac" style={{ maxWidth: 720 }}>
          <h2 id="uac" className="card-title">يحتاج صلاحية مسؤول</h2>
          <div className="card-body">
            <p style={{ fontSize: 18 }}>
              <span className="num">{num(failed.filter((f) => f.failure?.kind === "denied").length)}</span> من المحدد رفض ويندوز نقله. باقي المحدد انتقل. ويندوز رح يسأل عن صلاحية مسؤول لمرة واحدة.
            </p>
            <ul className="muted truth-list">
              <li>نطلب الصلاحية لهذه العملية فقط، ولا نبقيها مفتوحة.</li>
              <li>المسارات المحمية تبقى ممنوعة حتى مع الصلاحية.</li>
              <li>إذا رفضت، نترك هذه الملفات مكانها ونخبرك بها.</li>
            </ul>
            <div className="actions-row">
              <button type="button" className="btn btn-primary" onClick={() => void elevate()}>طلب الصلاحية</button>
              <button type="button" className="btn" onClick={() => setStage("result")}>متابعة بدون صلاحية</button>
            </div>
          </div>
        </section>
      )}

      {stage === "result" && (
        <>
          {undone && <p className="note info" role="status"><span>{undone}</span></p>}
          {declined && <p className="note warn" role="status"><span>ما وافق ويندوز على الصلاحية، فالملفات اللي بتحتاجها بقيت مكانها.</span></p>}
          <div className="guard-grid">
            <section className="card" aria-labelledby="ok">
              <h2 id="ok" className="card-title">
                نجحت · <span className="num">{num(moved.length)}</span> عنصر · <span className="num">{size(movedDisk, unit)}</span>
              </h2>
              <div className="card-body">
                <p>{moved.length ? "انتقلت إلى الحجر المؤقت وتبقى 30 يوماً. تقدر تسترجعها من السجل." : "ما انتقل شي."}</p>
                <div className="actions-row">
                  {moved.length > 0 && <button type="button" className="btn" onClick={() => void undo()}>تراجع</button>}
                  <a className="btn" href={href("history")} onClick={clearPendingClean}>فتح الحجر</a>
                  <button type="button" className="btn" onClick={back}>تم</button>
                </div>
              </div>
            </section>
            {failed.length > 0 && (
              <section className="card serious" aria-labelledby="fail">
                <h2 id="fail" className="card-title">لم يُنقل · <span className="num">{num(failed.length)}</span> عنصر</h2>
                {failed.map((f) => (
                  <div key={f.nodeId} className="line-item">
                    <div className="path small" title={f.path}>{middle(f.path, 70)}</div>
                    <div className="muted small">{failureText(f.failure as Failure)}</div>
                  </div>
                ))}
                <div className="actions-row line-item">
                  {retryable.length > 0 && (
                    <button type="button" className="btn" onClick={() => void run(retryable.map((f) => f.nodeId))}>إعادة المحاولة</button>
                  )}
                  <button type="button" className="btn" onClick={() => setFailed([])}>تخطّي</button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}

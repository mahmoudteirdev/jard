import { useEffect, useState } from "react";
import { useTreeVersion } from "../clean-session";
import { engine, type Candidate, type Drive, type QuarantineItem, type ScanPoint } from "../engine";
import { daysUntilFull, groupTotals } from "../file-kinds";
import { ago, num, size, ltr } from "../format";
import { href, type RouteId } from "../routes";
import type { Session } from "../scan-session";
import { useSettings } from "../settings";

interface Action {
  title: string;
  why: string;
  cta: string;
  to: RouteId;
}

/** The one starting point. Everything on it comes from your real results: nothing is shown as a guess. */
export function OverviewScreen({ session, drives }: { session: Session | null; drives: Drive[] }) {
  const { unit } = useSettings();
  const version = useTreeVersion();
  const scanId = session?.phase === "done" ? session.id : null;
  const [temp, setTemp] = useState<Candidate[]>([]);
  const [old, setOld] = useState<Candidate[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [points, setPoints] = useState<ScanPoint[]>([]);
  const [topGroup, setTopGroup] = useState<{ name: string; onDisk: number } | null>(null);

  useEffect(() => {
    engine.listQuarantine().then(setQuarantine, () => setQuarantine([]));
    if (scanId === null || !session) return;
    let live = true;
    engine.cleanupCandidates(scanId, "temp").then((l) => live && setTemp(l), () => {});
    engine.cleanupCandidates(scanId, "old", 50).then((l) => live && setOld(l), () => {});
    engine.kindsOf(scanId).then((k) => {
      const top = groupTotals(k).filter((g) => g.id !== "other").sort((a, b) => b.onDisk - a.onDisk)[0];
      if (live) setTopGroup(top ? { name: top.name, onDisk: top.onDisk } : null);
    }, () => {});
    engine.savedScans().then(async (saved) => {
      const s = saved.find((x) => x.root.toLowerCase() === session.root.toLowerCase());
      const p = s ? await engine.scanPoints(s.key) : [];
      if (live) setPoints(p);
    }, () => {});
    return () => {
      live = false;
    };
  }, [scanId, version, session]);

  if (!session || session.phase !== "done") {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 24 }}>نظرة عامة</h1>
        <p className="quiet">
          {session?.phase === "running" ? "الفحص جارٍ. الملخص يظهر هنا حين ينتهي." : "أهلاً بك في جَرد. نفحص أقراصك ونشرح النتائج، وكل شي يبقى على جهازك والبرنامج يعمل بدون إنترنت."}
        </p>
        <div className="actions">
          <a className="btn btn-primary" href={href(session?.phase === "running" ? "scan" : "storage")}>
            {session?.phase === "running" ? "اعرض التقدم" : "ابدأ الفحص"}
          </a>
        </div>
      </div>
    );
  }

  const drive = session.drive;
  const fullness = drive && drive.total > 0 ? (drive.total - drive.free) / drive.total : null;
  const tempTotal = temp.reduce((s, c) => s + c.node.onDisk, 0);
  const oldTotal = old.reduce((s, c) => s + c.node.onDisk, 0);
  const days = drive ? daysUntilFull(points, drive.free) : null;
  const quarantineTotal = quarantine.reduce((s, i) => s + i.onDisk, 0);

  const actions: Action[] = [];
  if (fullness !== null && fullness >= 0.9 && drive) {
    actions.push({
      title: `قرص ${drive.root.replace(/\\$/, "")} شبه ممتلئ`,
      why: `المتاح ${size(drive.free, unit)} فقط من ${size(drive.total, unit)}. ويندوز يبطأ لما تقل المساحة.`,
      cta: "فتح التنظيف",
      to: "cleanup",
    });
  }
  if (tempTotal >= 100_000_000) {
    actions.push({ title: "ملفات مؤقتة وكاش", why: `تأخذ ${size(tempTotal, unit)} ويُعاد إنشاؤها عند الحاجة.`, cta: "مراجعة", to: "cleanup" });
  }
  if (oldTotal >= 100_000_000) {
    actions.push({ title: "ملفات كبيرة لم تتغير منذ سنة", why: `${num(old.length)} ملف بمجموع ${size(oldTotal, unit)}. راجعها قبل أي قرار.`, cta: "مراجعة", to: "cleanup" });
  }
  if (session.done?.partial) {
    actions.push({ title: "النتيجة الأخيرة ناقصة", why: "الفحص لم يكتمل، فالأرقام أقل من الحقيقة. أعد الفحص لتصير كاملة.", cta: "فتح التخزين", to: "storage" });
  }

  const cards: { label: string; value: string; note: string; to: RouteId }[] = [
    {
      label: "توقع المساحة",
      value: days === null ? "لا يكفي للتوقع بعد" : `يمتلئ خلال ${Math.max(1, Math.round(days / 30))} شهر تقريباً`,
      note: days === null ? "يلزم فحصان بينهما أسبوع على الأقل" : `حسب النمو بين ${num(points.length)} فحوص، إذا استمر نفس المعدل`,
      to: "compare",
    },
    { label: "الحجر المؤقت", value: quarantine.length ? size(quarantineTotal, unit) : "فارغ", note: quarantine.length ? `${num(quarantine.length)} عنصر قابل للاسترجاع` : "اللي تنقله يبقى 30 يوماً", to: "history" },
    { label: "أكبر نوع ملفات", value: topGroup ? `${topGroup.name}: ${size(topGroup.onDisk, unit)}` : "—", note: `من آخر فحص لـ ${ltr(session.root)}`, to: "storage" },
  ];

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1>نظرة عامة</h1>
          <p className="muted small">
            آخر فحص {ago(session.finishedAt ?? Date.now())} · <span className="path">{session.root}</span>. كل النتائج محفوظة على جهازك فقط.
          </p>
        </div>
        <a className="btn" href={href("whyslow")}>ليش جهازي بطيء؟</a>
        <a className="btn btn-primary" href={href("storage")}>افتح التخزين</a>
      </header>

      <section className="card" aria-labelledby="top">
        <h2 id="top" className="card-title">الإجراءات المقترحة</h2>
        {actions.length === 0 ? (
          <div className="card-body"><p className="quiet">ما في شي عاجل بنتيجة هذا الفحص.</p></div>
        ) : (
          actions.slice(0, 3).map((a, i) => (
            <div key={a.title} className="line-item action-row">
              <span className="num accent-text" style={{ fontSize: 20, width: 24 }}>{i + 1}</span>
              <span className="grow"><strong style={{ fontWeight: 600 }}>{a.title}</strong><br /><span className="muted">{a.why}</span></span>
              <a className="btn" href={href(a.to)}>{a.cta}</a>
            </div>
          ))
        )}
      </section>

      <div className="stats">
        {cards.map((c) => (
          <a key={c.label} className="card overview-card" href={href(c.to)}>
            <span className="muted">{c.label}</span>
            <strong style={{ fontSize: 18, fontWeight: 600 }}>{c.value}</strong>
            <span className="muted small">{c.note}</span>
          </a>
        ))}
      </div>
      {drives.length > 1 && <p className="muted small">يعرض هذا الملخص آخر مجلد أو قرص فحصته. غيّره من شاشة الأقراص.</p>}
    </>
  );
}

import { useEffect, useState } from "react";
import { engine, type PlatformFacts } from "../engine";
import { num } from "../format";

const LINUX_ACTIONS: { title: string; why: string; cmd: string }[] = [
  { title: "تقليم إصدارات snap القديمة", why: "يحتفظ snap بإصدارات سابقة من كل تطبيق.", cmd: "sudo snap set system refresh.retain=2" },
  { title: "حذف أوقات تشغيل flatpak غير المستخدمة", why: "أوقات تشغيل ما عاد يعتمد عليها أي تطبيق.", cmd: "flatpak uninstall --unused" },
  { title: "تنظيف docker", why: "صور وطبقات وحجوم بلا حاوية.", cmd: "docker system prune" },
  { title: "حدّ حجم السجلات", why: "بدون حد، يكبر journal باستمرار.", cmd: "sudo journalctl --vacuum-size=500M" },
  { title: "حزم /boot القديمة", why: "نوى قديمة تملأ القسم الصغير وتمنع التحديث.", cmd: "sudo apt autoremove --purge" },
];

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true))}
    >
      {done ? "نُسخ" : "نسخ الأمر"}
    </button>
  );
}

/** What differs on macOS and Linux (Mac and Linux boards). Nothing runs from here: commands are for copying. */
export function PlatformPanel() {
  const [facts, setFacts] = useState<PlatformFacts | null>(null);
  useEffect(() => {
    engine.platformFacts().then(setFacts, () => {});
  }, []);
  if (!facts) return null;
  if (facts.os === "macos") {
    return (
      <section className="card" aria-labelledby="snap" style={{ borderColor: "var(--accent)" }}>
        <h2 id="snap" className="card-title">أكبر سبب لاختفاء المساحة على ماك</h2>
        <div className="card-body">
          <div className="label muted">لقطات APFS المحلية</div>
          <div className="num figure accent-text">{facts.snapshots === null ? "غير معروف" : num(facts.snapshots)}</div>
          <p className="quiet">
            يحتفظ Time Machine بلقطات على نفس القرص. الفايندر يسميها "مساحة قابلة للتحرير" ويحذفها عند الحاجة، لكنها تظهر كقرص ممتلئ. حذفها يلغي قدرتك على الاستعادة.
          </p>
          <p className="muted small">
            الصلاحيات تُطلب عبر Full Disk Access في إعدادات الخصوصية، وملفات iCloud غير المنزّلة تُعرض بشارة سحابية.
          </p>
          <div className="actions-row"><code className="path small">tmutil listlocalsnapshots /</code><Copy text="tmutil listlocalsnapshots /" /></div>
        </div>
      </section>
    );
  }
  if (facts.os === "linux") {
    return (
      <section className="card" aria-labelledby="act">
        <h2 id="act" className="card-title">إجراءات خاصة بلينكس</h2>
        {LINUX_ACTIONS.map((a) => (
          <div key={a.cmd} className="line-item">
            <strong>{a.title}</strong>
            <div className="muted">{a.why}</div>
            <div className="actions-row"><code className="path small grow">{a.cmd}</code><Copy text={a.cmd} /></div>
          </div>
        ))}
        <p className="muted line-item">نعرض الأمر ولا ننفّذه نيابة عنك، ونفضّل أدوات التوزيعة على حذف الملفات يدوياً.</p>
      </section>
    );
  }
  return null;
}

/** A way to get the readings that need administrator rights. Windows asks first. */
export function RunAsAdmin() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    engine.platformFacts().then(
      (f) => (f.os === "windows" ? engine.isAdmin().then(setAdmin) : setAdmin(true)),
      () => setAdmin(true),
    );
  }, []);
  if (admin !== false) return null;
  return (
    <div className="actions-row">
      <button
        type="button"
        className="btn"
        onClick={() => void engine.relaunchAsAdmin().then((yes) => !yes && setSaid("ما وافق ويندوز على الصلاحية، فالبرنامج مستمر كما هو."), (e) => setSaid(String(e)))}
      >
        تشغيل كمسؤول
      </button>
      {said && <span role="status" className="small">{said}</span>}
    </div>
  );
}

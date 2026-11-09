import { useEffect, useState } from "react";
import { useTreeVersion } from "../clean-session";
import { engine, type NodeDto, type TruthFacts, type VolumeFacts } from "../engine";
import { num, percent, size, type Unit } from "../format";
import { href } from "../routes";
import type { Session } from "../scan-session";
import { useSettings } from "../settings";

type Mode = "disk" | "apparent";

const NOTES: Record<Mode, string> = {
  disk: "الحجم على القرص: المساحة المحتلة فعلاً. هذا الرقم هو اللي يطابق ما يعرضه ويندوز، وهو الافتراضي عندنا.",
  apparent: "الحجم الظاهري: مجموع أحجام الملفات كما كُتبت. أعلى من الواقع لأنه يحسب الملفات السحابية والمضغوطة بحجمها الكامل.",
};

interface Case {
  badge: string;
  title: string;
  size: string;
  why: string;
}

/** Only what is really on this drive. A cause we couldn't read says so instead of showing zero. */
function casesOf(t: TruthFacts, v: VolumeFacts | null, root: string, unit: Unit): Case[] {
  const out: Case[] = [];
  if (t.cloudFiles > 0) {
    out.push({
      badge: "سحابي",
      title: `${num(t.cloudFiles)} ملف سحابي غير منزّل`,
      size: size(t.cloudBytes, unit),
      why: "موجودة كعناوين فقط. تظهر بحجمها الكامل في مستكشف ويندوز، لكنها لا تشغل مساحة عندك.",
    });
  }
  out.push(
    t.hardlinkFiles > 0
      ? {
          badge: "روابط صلبة",
          title: `${num(t.hardlinkFiles)} ملف مشترك بين أكثر من مكان`,
          size: size(t.hardlinkBytes, unit),
          why: "نفس الملف يظهر في مكانين. نحسبه مرة واحدة، وإلا صار المجموع أكبر من حجم القرص.",
        }
      : {
          badge: "روابط صلبة",
          title: "الروابط الصلبة",
          size: "—",
          why: "نفس الملف ممكن يظهر في مكانين. هذا الفحص لم يبحث عنها، فكل مسار انحسب كملف مستقل. تقدر تفعّل حسابها من الإعدادات.",
        },
  );
  if (t.compressedFiles > 0) {
    out.push({
      badge: "مضغوط",
      title: `${num(t.compressedFiles)} ملف بضغط NTFS`,
      size: `${size(t.compressedApparent, unit)} → ${size(t.compressedOnDisk, unit)}`,
      why: "تشغل أقل من حجمها الظاهري. حذفها يحرر الرقم الأصغر.",
    });
  }
  if (t.sparseFiles > 0) {
    out.push({
      badge: "مبعثر",
      title: `${num(t.sparseFiles)} ملف مبعثر`,
      size: `${size(t.sparseApparent, unit)} → ${size(t.sparseOnDisk, unit)}`,
      why: "حجمها المعلن أكبر مما كُتب فيها فعلاً. الفرق ليس خطأ.",
    });
  }
  if (t.slackBytes > 0) {
    out.push({
      badge: "فُتات",
      title: `${num(t.slackFiles)} ملف أصغر من وحدة القرص أو لا يملؤها`,
      size: `+${size(t.slackBytes, unit)}`,
      why: "كل ملف يأخذ وحدات كاملة من القرص. الملفات الصغيرة الكثيرة تضيف فرقاً ملموساً.",
    });
  }
  const letter = root.slice(0, 2).toUpperCase();
  const shadow = v?.shadow.find((s) => s.root?.toUpperCase().startsWith(letter));
  out.push({
    badge: "نسخ ظل",
    title: "نقاط استعادة النظام",
    size: v === null ? "…" : !v.known ? "غير معروف" : size(shadow?.used ?? 0, unit),
    why:
      v !== null && !v.known
        ? "قراءتها تحتاج صلاحية مسؤول، فلا نعرف حجمها. نقول هذا بدل أن نعرض صفراً. تُدار من إعدادات الاستعادة لا بالحذف المباشر."
        : "نسخ قديمة من ملفاتك يحتفظ بها ويندوز خارج المجلدات، فلا يراها الفحص. تُدار من إعدادات الاستعادة لا بالحذف المباشر.",
  });
  if (v && v.locked.length > 0) {
    out.push({
      badge: "مشفّر",
      title: `أقراص BitLocker مقفولة: ${v.locked.join(" ")}`,
      size: "غير معروف",
      why: "لا نستطيع قراءتها وهي مقفولة. نوضح ذلك بدل أن نعرض صفراً.",
    });
  }
  if (t.encryptedFiles > 0) {
    out.push({
      badge: "مشفّر",
      title: `${num(t.encryptedFiles)} ملف بتشفير EFS`,
      size: "—",
      why: "أحجامها صحيحة، لكن محتواها لا يُقرأ إلا من حساب صاحبها، فلا تدخل في كشف المكررات.",
    });
  }
  if (t.denied > 0) {
    out.push({
      badge: "تعذّرت القراءة",
      title: `${num(t.denied)} مجلد رفض ويندوز قراءته`,
      size: "غير معروف",
      why: "حجم ما بداخلها غير محسوب، فمجموع الفحص أقل من الحقيقة. شغّل البرنامج كمسؤول لتقرأها.",
    });
  }
  if (t.links > 0) {
    out.push({
      badge: "اختصار",
      title: `${num(t.links)} رابط أو نقطة ضم`,
      size: "—",
      why: "نعرضها ولا ندخلها، حتى لا يُحسب نفس المجلد مرتين. المستكشف أحياناً يحسبها.",
    });
  }
  return out;
}

/** Why the numbers differ from Windows, from this scan rather than from a made-up example (Truth board). */
export function TruthScreen({ session }: { session: Session | null }) {
  const { unit } = useSettings();
  const version = useTreeVersion();
  const scanId = session?.phase === "done" ? session.id : null;
  const [mode, setMode] = useState<Mode>("disk");
  const [facts, setFacts] = useState<TruthFacts | null>(null);
  const [volumes, setVolumes] = useState<VolumeFacts | null>(null);
  const [example, setExample] = useState<NodeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scanId === null) return;
    let live = true;
    engine.truthFacts(scanId).then(
      (t) => {
        if (!live) return;
        setFacts(t);
        if (t.example !== null) engine.getNode(scanId, t.example).then((n) => live && setExample(n), () => {});
        else setExample(null);
      },
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [scanId, version]);

  useEffect(() => {
    engine.volumeFacts().then(setVolumes, () => setVolumes({ known: false, shadow: [], locked: [] }));
  }, []);

  if (scanId === null || !session) {
    return (
      <div className="empty">
        <h1 style={{ fontSize: 26 }}>ليش الأرقام تختلف عن ويندوز؟</h1>
        <p className="quiet">نشرح الفرق من نتيجة فحصك أنت، فلازم فحص أولاً.</p>
        <div className="actions"><a className="btn btn-primary" href={href("storage")}>افتح التخزين</a></div>
      </div>
    );
  }
  if (error) return <p className="note error" role="alert"><span>{error}</span></p>;
  if (!facts) return <p className="muted" role="status">يحمّل…</p>;

  const total = mode === "disk" ? facts.onDisk : facts.apparent;
  const cases = casesOf(facts, volumes, session.root, unit);
  const gap = Math.abs(facts.apparent - facts.onDisk);
  const bars = example && [
    { k: "الحجم الظاهري", v: example.apparent, color: "var(--data-pale, var(--data-2))" },
    { k: "على القرص", v: example.onDisk, color: "var(--accent)" },
    { k: "لا يُحسب", v: example.cloudBytes + example.dedupBytes, color: "var(--data-2)" },
  ];
  const whole = example ? Math.max(example.apparent, example.onDisk, 1) : 1;

  return (
    <>
      <header className="page-head">
        <div className="title">
          <h1>ليش الأرقام تختلف عن ويندوز؟</h1>
          <p className="quiet">معظم أدوات الفحص تعطي رقماً واحداً وتسكت. هنا نشرح الفرق، وأنت تختار طريقة الحساب.</p>
        </div>
      </header>

      <section aria-label="طريقة الحساب" className="truth-mode">
        <div className="seg" role="group" aria-label="طريقة الحساب">
          <button type="button" aria-pressed={mode === "disk"} onClick={() => setMode("disk")}>على القرص</button>
          <button type="button" aria-pressed={mode === "apparent"} onClick={() => setMode("apparent")}>الحجم الظاهري</button>
        </div>
        <div>
          <div className="label muted">المجموع بهذه الطريقة</div>
          <div className="num figure accent-text">{size(total, unit)}</div>
        </div>
        <p className="muted grow">{NOTES[mode]}</p>
      </section>

      {facts.partial && (
        <p className="note warn" role="status"><span>هذا الفحص ناقص، فالأرقام هنا أقل من الحقيقة.</span></p>
      )}

      <div className="guard-grid">
        <section className="card" aria-labelledby="cases">
          <h2 id="cases" className="card-title">الحالات الموجودة على جهازك</h2>
          {cases.map((c) => (
            <div key={c.title} className="line-item truth-case">
              <div className="truth-case-head">
                <span className="badge">{c.badge}</span>
                <strong className="grow">{c.title}</strong>
                <span className="num">{c.size}</span>
              </div>
              <p className="muted">{c.why}</p>
            </div>
          ))}
        </section>
        <section className="card" aria-labelledby="ex">
          <h2 id="ex" className="card-title">
            {example ? <>مثال من فحصك: <bdi className="path">{example.name}</bdi></> : "مثال من فحصك"}
          </h2>
          <div className="card-body">
            {bars ? (
              <>
                {bars.map((b) => (
                  <div key={b.k}>
                    <div className="truth-bar-head"><span>{b.k}</span><span className="num">{size(b.v, unit)}</span></div>
                    <div className="truth-bar"><div style={{ width: `${percent(b.v, whole)}%`, background: b.color }} /></div>
                  </div>
                ))}
                <p className="quiet">
                  هذا المجلد يحمل أكبر فرق بين الرقمين في فحصك. الفرق كله في الجهاز <span className="num">{size(gap, unit)}</span>.
                  {example.cloudBytes > 0 && " حذف ملف سحابي من هنا يحذفه من السحابة أيضاً، فنعرضه بشارة ولا ندخله في اقتراحات التنظيف."}
                </p>
              </>
            ) : (
              <p className="quiet">الرقمان قريبان في هذا الفحص، فما في مثال يستاهل العرض.</p>
            )}
            <a className="btn" href={href("storage")}>رجوع إلى التخزين</a>
          </div>
        </section>
      </div>
    </>
  );
}

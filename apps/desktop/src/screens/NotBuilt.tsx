import { go } from "../routes";

/** Screens drawn on the canvas but not built yet. Every empty state offers a next step. */
export function NotBuilt({ title }: { title: string }) {
  return (
    <div className="empty">
      <h1 style={{ fontSize: 24 }}>{title}</h1>
      <p className="quiet">هذه الشاشة مرسومة في التصميم ولم تُبنَ بعد. المتاح الآن: فحص قرص ومعرفة أين ذهبت المساحة.</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => go("storage")}>افتح التخزين</button>
      </div>
    </div>
  );
}

import { Flag } from "../engine";
import { badgesOf } from "../flags";

/** One word per flag, never colour alone. The hint goes to the tooltip and the screen reader. */
export function Badges({ flags, skip = 0 }: { flags: number; skip?: number }) {
  const list = badgesOf(flags & ~skip);
  if (!list.length) return null;
  return (
    <>
      {list.map((b) => (
        <span key={b.flag} className={b.flag === Flag.DENIED || b.flag === Flag.PARTIAL ? "badge warn" : "badge"} title={b.hint}>
          {b.label}
          <span className="sr-only">: {b.hint}</span>
        </span>
      ))}
    </>
  );
}

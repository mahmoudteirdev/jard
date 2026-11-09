import type { ReactNode } from "react";
import { href, RAIL_END, RAIL_GROUPS, RAIL_START, type RailItem, type RouteId } from "../routes";
import { useSettings } from "../settings";

/** The technical screens simple mode leaves out. They still open from the command palette. */
const EXPERT_ONLY = new Set<RouteId>(["compare", "drives", "tests", "reports"]);

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="3" y="3" width="20" height="5" fill="var(--data-1)" />
      <rect x="3" y="10" width="14" height="5" fill="var(--data-2)" />
      <rect x="3" y="17" width="8" height="5" fill="var(--data-3)" />
    </svg>
  );
}

function Link({ item, current }: { item: RailItem; current: RouteId }) {
  return (
    <a className="rail-link" href={href(item.id)} aria-current={item.id === current ? "page" : undefined}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d={item.d} />
      </svg>
      {item.name}
    </a>
  );
}

/** Side menu. `current` is the Rail item to mark; the Scan screen marks Storage. */
export function Rail({ current, children }: { current: RouteId; children?: ReactNode }) {
  const { level } = useSettings();
  return (
    <nav className="rail" aria-label="القائمة الرئيسية">
      <div className="brand">
        <Logo />
        <strong>جَرد</strong>
      </div>
      <div className="rail-groups">
        <div className="rail-group">
          <Link item={RAIL_START} current={current} />
        </div>
        {RAIL_GROUPS.map((g) => (
          <div className="rail-group" key={g.name} role="group" aria-labelledby={`rail-${g.name}`}>
            <h2 id={`rail-${g.name}`}>{g.name}</h2>
            {g.items.filter((i) => level !== "simple" || !EXPERT_ONLY.has(i.id)).map((i) => (
              <Link key={i.id} item={i} current={current} />
            ))}
          </div>
        ))}
        <div className="rail-group">
          <Link item={RAIL_END} current={current} />
        </div>
      </div>
      {children}
    </nav>
  );
}

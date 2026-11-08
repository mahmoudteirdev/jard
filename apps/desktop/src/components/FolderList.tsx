import { useCallback, useEffect, useRef, useState } from "react";
import { engine, type NodeDto, type ScanId, type SortKey } from "../engine";
import { percent, size, type Unit } from "../format";
import { Badges } from "./Badges";

const ROW_H = 56; // row with a share bar (tokens: row.withBar)
const PAGE = 200; // children fetched per request (HANDOFF §5: more than 200 rows -> paged)
const OVERSCAN = 8;

export const KIND_COLOR = { dir: "var(--data-2)", file: "var(--data-4)", others: "var(--data-grey)" };

/** Children of one folder, fetched a page at a time and only drawn when on screen. */
export function FolderList(props: {
  scanId: ScanId;
  parent: NodeDto;
  sort: SortKey;
  unit: Unit;
  selectedId: number | null;
  checked: Map<number, NodeDto>;
  onOpen: (n: NodeDto) => void;
  onSelect: (n: NodeDto) => void;
  onToggle: (n: NodeDto) => void;
}) {
  const { scanId, parent, sort } = props;
  const total = parent.childCount;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Map<number, NodeDto[]>>(new Map());
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const [view, setView] = useState({ top: 0, height: 600 });

  // New folder or sort: start over at the top, and drop answers still on their way.
  useEffect(() => {
    generation.current++;
    setPages(new Map());
    loading.current = new Set();
    bodyRef.current?.scrollTo({ top: 0 });
  }, [scanId, parent.id, sort]);

  const load = useCallback(
    (page: number) => {
      if (loading.current.has(page)) return;
      loading.current.add(page);
      const gen = generation.current;
      engine.getChildren(scanId, parent.id, sort, PAGE, page * PAGE).then(
        (rows) => {
          if (gen === generation.current) setPages((m) => new Map(m).set(page, rows));
        },
        () => loading.current.delete(page),
      );
    },
    [scanId, parent.id, sort],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(total - 1, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);

  useEffect(() => {
    if (total === 0) return;
    for (let p = Math.floor(first / PAGE); p <= Math.floor(last / PAGE); p++) if (!pages.has(p)) load(p);
  }, [first, last, total, pages, load]);

  const metric = (n: NodeDto) => (sort === "apparent" ? n.apparent : n.onDisk);
  const whole = metric(parent);

  const rows = [];
  for (let i = first; i <= last; i++) {
    const n = pages.get(Math.floor(i / PAGE))?.[i % PAGE];
    const style = { top: i * ROW_H };
    if (!n) {
      rows.push(
        <li key={`s${i}`} className="row skeleton" style={style} aria-hidden="true">
          <span className="pick" />
          <span className="open"><span className="track" /></span>
        </li>,
      );
      continue;
    }
    const canOpen = n.isDir && n.childCount > 0;
    const share = percent(metric(n), whole);
    rows.push(
      <li key={n.id} className="row" style={style} data-selected={n.id === props.selectedId} aria-setsize={total} aria-posinset={i + 1}>
        <label className="pick">
          <span className="sr-only">تحديد {n.name}</span>
          <input type="checkbox" checked={props.checked.has(n.id)} onChange={() => props.onToggle(n)} />
        </label>
        <button
          type="button"
          className="open"
          onClick={() => (canOpen ? props.onOpen(n) : props.onSelect(n))}
          onFocus={() => props.onSelect(n)}
          aria-label={`${n.name}، ${n.isDir ? "مجلد" : "ملف"}، ${size(metric(n), props.unit)}${canOpen ? "، افتح" : ""}`}
        >
          <span className="line1">
            <span className="name">{n.name}</span>
            <Badges flags={n.flags} />
            <span className="num small">{size(metric(n), props.unit)}</span>
          </span>
          <span className="track">
            <span className="fill" style={{ width: `${share}%`, background: n.isDir ? KIND_COLOR.dir : KIND_COLOR.file }} />
          </span>
        </button>
        {canOpen ? (
          <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15 4l-8 8 8 8 2-2-6-6 6-6z" />
          </svg>
        ) : (
          <span style={{ width: 14 }} />
        )}
      </li>,
    );
  }

  return (
    <div ref={bodyRef} className="list-body" tabIndex={-1}>
      {total === 0 ? (
        <p className="muted" style={{ padding: 16 }}>هذا المجلد فارغ.</p>
      ) : (
        <ul className="rows" style={{ height: total * ROW_H, ["--row-h" as string]: `${ROW_H}px` }} aria-label={`محتويات ${parent.name}`}>
          {rows}
        </ul>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reasonText } from "../clean-text";
import { engine, type NodeDto, type ScanId, type SortKey } from "../engine";
import { percent, size, type Unit } from "../format";
import { Badges } from "./Badges";

const ROW_H = 56;
const PAGE = 200;
const OVERSCAN = 10;

export const KIND_COLOR = { dir: "var(--data-2)", file: "var(--data-4)", others: "var(--data-grey)" };

export interface TreeRow {
  node: NodeDto;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  share: number;
}

/** Expandable hierarchical tree view of folders and files. */
export function FolderList(props: {
  scanId: ScanId;
  parent: NodeDto;
  sort: SortKey;
  unit: Unit;
  selectedId: number | null;
  checked: Map<number, NodeDto>;
  version: number;
  onOpen: (n: NodeDto) => void;
  onUp: () => void;
  onSelect: (n: NodeDto) => void;
  onToggle: (n: NodeDto) => void;
  onCheck: (n: NodeDto) => void;
}) {
  const { scanId, parent, sort } = props;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Root level children
  const [rootPages, setRootPages] = useState<Map<number, NodeDto[]>>(new Map());
  const rootLoading = useRef(new Set<number>());

  // Hierarchical expand states
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [childCache, setChildCache] = useState<Map<number, NodeDto[]>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [expandDepth, setExpandDepth] = useState<number>(0);

  const generation = useRef(0);
  const [view, setView] = useState({ top: 0, height: 600 });

  // Reset when folder, sort or tree version changes
  useEffect(() => {
    generation.current++;
    setRootPages(new Map());
    rootLoading.current = new Set();
    setExpandedIds(new Set());
    setChildCache(new Map());
    setLoadingIds(new Set());
    setExpandDepth(0);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [scanId, parent.id, sort, props.version]);

  const loadRootPage = useCallback(
    (page: number) => {
      if (rootLoading.current.has(page)) return;
      rootLoading.current.add(page);
      const gen = generation.current;
      engine.getChildren(scanId, parent.id, sort, PAGE, page * PAGE).then(
        (rows) => {
          if (gen === generation.current) setRootPages((m) => new Map(m).set(page, rows));
        },
        () => rootLoading.current.delete(page),
      );
    },
    [scanId, parent.id, sort],
  );

  // Load initial root page
  useEffect(() => {
    if (parent.childCount > 0 && !rootPages.has(0)) {
      loadRootPage(0);
    }
  }, [parent.id, parent.childCount, rootPages, loadRootPage]);

  // Load children for expanding a branch
  const loadChildren = useCallback(
    (node: NodeDto) => {
      if (childCache.has(node.id) || loadingIds.has(node.id)) return;
      setLoadingIds((s) => new Set(s).add(node.id));
      engine.getChildren(scanId, node.id, sort, 150, 0).then(
        (kids) => {
          setChildCache((m) => new Map(m).set(node.id, kids));
          setLoadingIds((s) => {
            const next = new Set(s);
            next.delete(node.id);
            return next;
          });
        },
        () => {
          setLoadingIds((s) => {
            const next = new Set(s);
            next.delete(node.id);
            return next;
          });
        },
      );
    },
    [scanId, sort, childCache, loadingIds],
  );

  // Toggle in-place expansion of a single folder
  const toggleExpand = useCallback(
    (node: NodeDto) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
          loadChildren(node);
        }
        return next;
      });
    },
    [loadChildren],
  );

  // Expand to specific depth level (0 = collapse all, 1 = level 1, 2 = level 2, etc.)
  const applyExpandDepth = useCallback(
    (targetDepth: number) => {
      setExpandDepth(targetDepth);
      if (targetDepth === 0) {
        setExpandedIds(new Set());
        return;
      }

      // Collect nodes at depth 0
      const nextExp = new Set<number>();
      const rootList = rootPages.get(0) ?? [];
      for (const n of rootList) {
        if (n.isDir && n.childCount > 0) {
          nextExp.add(n.id);
          loadChildren(n);
        }
      }

      if (targetDepth >= 2) {
        // Expand depth 1 nodes that are already cached
        for (const pid of nextExp) {
          const cached = childCache.get(pid) ?? [];
          for (const c of cached) {
            if (c.isDir && c.childCount > 0) {
              nextExp.add(c.id);
              loadChildren(c);
            }
          }
        }
      }

      if (targetDepth >= 3) {
        // Expand depth 2 nodes
        for (const [_, cached] of childCache.entries()) {
          for (const c of cached) {
            if (c.isDir && c.childCount > 0) {
              nextExp.add(c.id);
              loadChildren(c);
            }
          }
        }
      }

      setExpandedIds(nextExp);
    },
    [rootPages, childCache, loadChildren],
  );

  // Track scroll position
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

  const metric = useCallback((n: NodeDto) => (sort === "apparent" ? n.apparent : n.onDisk), [sort]);
  const whole = metric(parent);

  // Flatten visible tree rows
  const visibleRows: TreeRow[] = useMemo(() => {
    const rows: TreeRow[] = [];
    const rootList = rootPages.get(0) ?? [];

    function walk(list: NodeDto[], depth: number, parentSize: number) {
      for (const n of list) {
        const hasKids = n.isDir && n.childCount > 0;
        const isExp = expandedIds.has(n.id);
        const isLoading = loadingIds.has(n.id);
        const share = percent(metric(n), parentSize);

        rows.push({
          node: n,
          depth,
          hasChildren: hasKids,
          expanded: isExp,
          loading: isLoading,
          share,
        });

        if (hasKids && isExp) {
          const sub = childCache.get(n.id);
          if (sub && sub.length > 0) {
            walk(sub, depth + 1, metric(n));
          }
        }
      }
    }

    walk(rootList, 0, whole);
    return rows;
  }, [rootPages, expandedIds, loadingIds, childCache, whole, metric]);

  const totalVisible = visibleRows.length;
  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(totalVisible - 1, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!rowEl || e.ctrlKey || e.metaKey) return;
    const idx = Number(rowEl.dataset.idx);
    const item = visibleRows[idx];
    if (!item) return;
    const rtl = document.documentElement.dir === "rtl";

    if (e.key === "ArrowDown" && idx < totalVisible - 1) {
      e.preventDefault();
      const nextEl = bodyRef.current?.querySelector<HTMLElement>(`[data-idx="${idx + 1}"] .open-row-btn`);
      nextEl?.focus();
    } else if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      const prevEl = bodyRef.current?.querySelector<HTMLElement>(`[data-idx="${idx - 1}"] .open-row-btn`);
      prevEl?.focus();
    } else if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
      e.preventDefault();
      if (item.hasChildren && !item.expanded) {
        toggleExpand(item.node);
      }
    } else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
      e.preventDefault();
      if (item.hasChildren && item.expanded) {
        toggleExpand(item.node);
      } else {
        props.onUp();
      }
    } else if (e.key === " " && !item.node.protected) {
      e.preventDefault();
      props.onToggle(item.node);
    } else if (e.key === "Enter") {
      e.preventDefault();
      props.onSelect(item.node);
    }
  };

  const rows = [];
  for (let i = first; i <= last; i++) {
    const item = visibleRows[i];
    if (!item) continue;
    const { node: n, depth, hasChildren, expanded, loading: rowLoading, share } = item;
    const isSelected = n.id === props.selectedId;
    const style = {
      top: i * ROW_H,
      height: `${ROW_H}px`,
      paddingInlineStart: `${depth * 20 + 8}px`,
    };

    rows.push(
      <li
        key={`${n.id}-${depth}`}
        data-idx={i}
        className={`row tree-row ${isSelected ? "selected" : ""}`}
        style={style}
        data-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {/* Checkbox for cleanup selection */}
        <label className="pick" title={n.protected ? `مسار محمي: ${reasonText(n.protected)}` : undefined}>
          <span className="sr-only">{n.protected ? `${n.name} محمي: ${reasonText(n.protected)}` : `تحديد ${n.name}`}</span>
          <input
            type="checkbox"
            disabled={!!n.protected}
            checked={props.checked.has(n.id)}
            onChange={() => props.onToggle(n)}
          />
        </label>

        {/* Tree branch expand/collapse toggle */}
        {hasChildren ? (
          <button
            type="button"
            className="tree-chevron-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(n);
            }}
            title={expanded ? "طي التفرع" : "توسيع التفرع"}
            aria-label={expanded ? `طي ${n.name}` : `توسيع ${n.name}`}
          >
            {rowLoading ? (
              <span className="tree-spinner" />
            ) : (
              <svg
                className={`tree-chevron ${expanded ? "expanded" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
              </svg>
            )}
          </button>
        ) : (
          <span className="tree-chevron-spacer" />
        )}

        {/* Folder/File icon */}
        <span className="tree-icon" aria-hidden="true">
          {n.isDir ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill={KIND_COLOR.dir}>
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill={KIND_COLOR.file}>
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
          )}
        </span>

        {/* Row content button */}
        <button
          type="button"
          className="open open-row-btn"
          onClick={() => props.onSelect(n)}
          onDoubleClick={() => n.isDir && n.childCount > 0 && props.onOpen(n)}
          aria-label={`${n.name}، ${n.isDir ? "مجلد" : "ملف"}، ${size(metric(n), props.unit)}`}
        >
          <span className="line1">
            <span className={`name ${n.isDir ? "dir-name" : ""}`}>{n.name}</span>
            <Badges flags={n.flags} />
            <span className="num small">{size(metric(n), props.unit)}</span>
          </span>
          <span className="track">
            <span
              className="fill"
              style={{
                width: `${share}%`,
                background: n.isDir ? KIND_COLOR.dir : KIND_COLOR.file,
              }}
            />
          </span>
        </button>

        {/* Dedicated "Open / Drill-down" button for directories */}
        {n.isDir && n.childCount > 0 && (
          <button
            type="button"
            className="drill-btn"
            onClick={(e) => {
              e.stopPropagation();
              props.onOpen(n);
            }}
            title={`دخول مجلد ${n.name}`}
            aria-label={`دخول مجلد ${n.name}`}
          >
            دخول ↵
          </button>
        )}
      </li>,
    );
  }

  return (
    <div className="tree-container">
      {/* Tree Expand Depth Toolbar */}
      <div className="tree-toolbar">
        <span className="muted small">تفرّع الشجرة:</span>
        <div className="seg tree-depth-seg" role="group" aria-label="مستويات توسيع الشجرة">
          <button
            type="button"
            aria-pressed={expandDepth === 0}
            onClick={() => applyExpandDepth(0)}
            title="طي جميع التفرعات والرجوع للمستوى الحالي"
          >
            طي الكل
          </button>
          <button
            type="button"
            aria-pressed={expandDepth === 1}
            onClick={() => applyExpandDepth(1)}
            title="توسيع المستوى الأول"
          >
            مستوى 1
          </button>
          <button
            type="button"
            aria-pressed={expandDepth === 2}
            onClick={() => applyExpandDepth(2)}
            title="توسيع المستوى الثاني"
          >
            مستوى 2
          </button>
          <button
            type="button"
            aria-pressed={expandDepth === 3}
            onClick={() => applyExpandDepth(3)}
            title="توسيع المستوى الثالث"
          >
            مستوى 3
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="list-body" tabIndex={-1}>
        {parent.childCount === 0 ? (
          <p className="muted" style={{ padding: 16 }}>
            هذا المجلد فارغ.
          </p>
        ) : (
          <ul
            className="rows"
            style={{ height: totalVisible * ROW_H, ["--row-h" as string]: `${ROW_H}px` }}
            aria-label={`شجرة محتويات ${parent.name}`}
            onKeyDown={onKeyDown}
          >
            {rows}
          </ul>
        )}
      </div>
    </div>
  );
}

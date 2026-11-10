import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NodeDto } from "../engine";
import { size, type Unit } from "../format";

export interface MapItem {
  /** null for the "others" cell that groups the small items. */
  node: NodeDto | null;
  name: string;
  value: number;
  color: string;
  children?: MapItem[];
}

interface Rect { x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls, Huizing, van Wijk). Values must be sorted large to small. */
export function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const scale = (box.w * box.h) / total;
  const areas = values.map((v) => v * scale);
  const out: Rect[] = [];
  let { x, y, w, h } = box;
  let i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]!];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]!], side) <= worst(row, side)) row.push(areas[j++]!);
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      const stripW = sum / h;
      let cy = y;
      for (const a of row) {
        out.push({ x, y: cy, w: stripW, h: a / stripW });
        cy += a / stripW;
      }
      x += stripW;
      w -= stripW;
    } else {
      const stripH = sum / w;
      let cx = x;
      for (const a of row) {
        out.push({ x: cx, y, w: a / stripH, h: stripH });
        cx += a / stripH;
      }
      y += stripH;
      h -= stripH;
    }
    i = j;
  }
  return out;
}

const GAP = 3;

export function Treemap(props: {
  items: MapItem[];
  unit: Unit;
  selectedId: number | null;
  onActivate: (item: MapItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setBox({ w: el.clientWidth, h: el.clientHeight });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = props.items.filter((i) => i.value > 0);
  const rects = squarify(shown.map((i) => i.value), { x: 0, y: 0, w: box.w + GAP, h: box.h + GAP });

  return (
    <div ref={ref} className="map-area">
      {shown.map((item, k) => {
        const r = rects[k]!;
        const w = r.w - GAP;
        const h = r.h - GAP;
        if (w < 2 || h < 2) return null;
        const text = `${item.name}، ${size(item.value, props.unit)}`;
        const isSelected = item.node !== null && item.node.id === props.selectedId;

        // Render nested sub-blocks if available and rect is large enough
        const hasChildren = !!item.children && item.children.length > 0 && w >= 68 && h >= 56;
        if (hasChildren) {
          const subItems = item.children!.filter((c) => c.value > 0);
          const topBarH = 22;
          const subRects = squarify(subItems.map((c) => c.value), {
            x: 2,
            y: topBarH + 2,
            w: Math.max(1, w - 4),
            h: Math.max(1, h - topBarH - 4),
          });

          return (
            <div
              key={item.node?.id ?? `parent-${k}`}
              className="cell parent-cell"
              data-selected={isSelected}
              style={{
                insetInlineStart: r.x,
                top: r.y,
                width: w,
                height: h,
                background: item.color,
              }}
              title={text}
            >
              <button
                type="button"
                className="parent-title"
                onClick={() => props.onActivate(item)}
                title={text}
              >
                <strong className="name">{item.name}</strong>
                <span className="num">{size(item.value, props.unit)}</span>
              </button>
              <div className="sub-cells-container">
                {subItems.map((sub, sIdx) => {
                  const sr = subRects[sIdx]!;
                  const sw = Math.max(1, sr.w - 1);
                  const sh = Math.max(1, sr.h - 1);
                  if (sw < 2 || sh < 2) return null;
                  const subText = `${sub.name}، ${size(sub.value, props.unit)}`;
                  const showSubLabel = sw > 40 && sh > 24;
                  const isSubSelected = sub.node !== null && sub.node.id === props.selectedId;
                  return (
                    <button
                      key={sub.node?.id ?? `sub-${sIdx}`}
                      type="button"
                      className="sub-cell"
                      data-selected={isSubSelected}
                      style={{
                        insetInlineStart: sr.x,
                        top: sr.y,
                        width: sw,
                        height: sh,
                        background: sub.color,
                      }}
                      title={subText}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onActivate(sub);
                      }}
                    >
                      {showSubLabel && (
                        <>
                          <strong className="sub-name">{sub.name}</strong>
                          <span className="num tiny">{size(sub.value, props.unit)}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        const label = w > 72 && h > 64; // room for the name and size at their full size
        return (
          <button
            key={item.node?.id ?? "others"}
            type="button"
            className="cell"
            data-selected={isSelected}
            // The largest item starts at the reading edge: right in Arabic, left in English
            style={{ insetInlineStart: r.x, top: r.y, width: w, height: h, background: item.color }}
            title={text}
            aria-label={text}
            onClick={() => props.onActivate(item)}
          >
            {label && (
              <>
                <strong className="name">{item.name}</strong>
                <span className="num">{size(item.value, props.unit)}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

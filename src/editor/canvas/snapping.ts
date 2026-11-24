/**
 * Snapping of moving / resizing boxes to the page and to other elements.
 * Targets are computed once when a gesture starts; each pointer move then only
 * compares numbers.
 */
import { boxBounds } from "@/core/geometry";
import type { DesignElement, Page, Rect } from "@/core/types";
import type { SnapGuide } from "@/core/store";

interface Line {
  pos: number;
  /** extent along the other axis, for drawing the guide */
  from: number;
  to: number;
  kind: "edge" | "center" | "page" | "spacing";
}

export interface SnapTargets {
  xs: Line[];
  ys: Line[];
}

/**
 * Everything a box can snap to: the edges and the middle of the page, the edges and middles of the other elements, the guides
 * dragged out of the rulers and, when they are shown (`margin` above 0), the margins of the page.
 */
export function computeTargets(
  page: Page,
  designW: number,
  designH: number,
  exclude: ReadonlySet<string>,
  guides?: { vertical: number[]; horizontal: number[] },
  margin = 0,
  gridSize = 0,
): SnapTargets {
  const xs: Line[] = [
    { pos: 0, from: 0, to: designH, kind: "page" },
    { pos: designW / 2, from: 0, to: designH, kind: "page" },
    { pos: designW, from: 0, to: designH, kind: "page" },
  ];
  const ys: Line[] = [
    { pos: 0, from: 0, to: designW, kind: "page" },
    { pos: designH / 2, from: 0, to: designW, kind: "page" },
    { pos: designH, from: 0, to: designW, kind: "page" },
  ];
  const boxes: Rect[] = [];
  const add = (el: DesignElement) => {
    if (el.hidden || exclude.has(el.id)) return;
    const b = boxBounds(el);
    boxes.push(b);
    xs.push(
      { pos: b.x, from: b.y, to: b.y + b.h, kind: "edge" },
      { pos: b.x + b.w / 2, from: b.y, to: b.y + b.h, kind: "center" },
      { pos: b.x + b.w, from: b.y, to: b.y + b.h, kind: "edge" },
    );
    ys.push(
      { pos: b.y, from: b.x, to: b.x + b.w, kind: "edge" },
      { pos: b.y + b.h / 2, from: b.x, to: b.x + b.w, kind: "center" },
      { pos: b.y + b.h, from: b.x, to: b.x + b.w, kind: "edge" },
    );
  };
  page.elements.forEach(add);
  for (const x of guides?.vertical ?? []) xs.push({ pos: x, from: 0, to: designH, kind: "page" });
  for (const y of guides?.horizontal ?? []) ys.push({ pos: y, from: 0, to: designW, kind: "page" });
  // margins that would meet or cross in the middle are no margins
  if (margin > 0 && margin * 2 < Math.min(designW, designH)) {
    for (const x of [margin, designW - margin]) xs.push({ pos: x, from: 0, to: designH, kind: "page" });
    for (const y of [margin, designH - margin]) ys.push({ pos: y, from: 0, to: designW, kind: "page" });
  }
  if (gridSize > 0) {
    for (let x = gridSize; x < designW; x += gridSize) xs.push({ pos: x, from: 0, to: designH, kind: "page" });
    for (let y = gridSize; y < designH; y += gridSize) ys.push({ pos: y, from: 0, to: designW, kind: "page" });
  }
  const spacing = (horizontal: boolean): Line[] => {
    const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const gaps = new Map<number, Array<{ from: number; to: number; otherFrom: number; otherTo: number }>>();
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      const start = horizontal ? previous.x + previous.w : previous.y + previous.h;
      const gap = (horizontal ? current.x : current.y) - start;
      if (gap <= 0.5) continue;
      const key = Math.round(gap * 100) / 100;
      const otherFrom = horizontal ? Math.min(previous.y, current.y) : Math.min(previous.x, current.x);
      const otherTo = horizontal ? Math.max(previous.y + previous.h, current.y + current.h) : Math.max(previous.x + previous.w, current.x + current.w);
      gaps.set(key, [...(gaps.get(key) ?? []), { from: start + gap / 2, to: start + gap / 2, otherFrom, otherTo }]);
    }
    return [...gaps.values()]
      .filter((matches) => matches.length > 1)
      .flatMap((matches) => matches.map((match) => ({ pos: match.from, from: match.otherFrom, to: match.otherTo, kind: "spacing" as const })));
  };
  xs.push(...spacing(true));
  ys.push(...spacing(false));
  return { xs, ys };
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

function bestSnap(values: number[], lines: Line[], threshold: number): { delta: number; line: Line; value: number } | null {
  let best: { delta: number; line: Line; value: number } | null = null;
  for (const v of values) {
    for (const l of lines) {
      const d = l.pos - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta) - 1e-6)) best = { delta: d, line: l, value: v };
    }
  }
  return best;
}

function guidesFor(rect: Rect, xs: Line[], ys: Line[], xSnap: number | null, ySnap: number | null): SnapGuide[] {
  const out: SnapGuide[] = [];
  const eps = 0.51;
  if (xSnap !== null) {
    for (const l of xs) {
      if (Math.abs(l.pos - xSnap) < eps) out.push({ axis: "v", pos: l.pos, from: Math.min(l.from, rect.y), to: Math.max(l.to, rect.y + rect.h), kind: l.kind });
    }
  }
  if (ySnap !== null) {
    for (const l of ys) {
      if (Math.abs(l.pos - ySnap) < eps) out.push({ axis: "h", pos: l.pos, from: Math.min(l.from, rect.x), to: Math.max(l.to, rect.x + rect.w), kind: l.kind });
    }
  }
  return out;
}

/** Snap a whole rectangle being moved (left / centre / right and top / middle / bottom). */
export function snapMove(rect: Rect, t: SnapTargets, threshold: number): SnapResult {
  const bx = bestSnap([rect.x, rect.x + rect.w / 2, rect.x + rect.w], t.xs, threshold);
  const by = bestSnap([rect.y, rect.y + rect.h / 2, rect.y + rect.h], t.ys, threshold);
  const dx = bx?.delta ?? 0;
  const dy = by?.delta ?? 0;
  const moved = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
  return { dx, dy, guides: guidesFor(moved, t.xs, t.ys, bx ? bx.line.pos : null, by ? by.line.pos : null) };
}

/** Snap only the edges that a resize handle is dragging. */
export function snapEdges(rect: Rect, edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }, t: SnapTargets, threshold: number): SnapResult {
  const xv: number[] = [];
  if (edges.left) xv.push(rect.x);
  if (edges.right) xv.push(rect.x + rect.w);
  const yv: number[] = [];
  if (edges.top) yv.push(rect.y);
  if (edges.bottom) yv.push(rect.y + rect.h);
  const bx = xv.length ? bestSnap(xv, t.xs, threshold) : null;
  const by = yv.length ? bestSnap(yv, t.ys, threshold) : null;
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, guides: guidesFor(rect, t.xs, t.ys, bx ? bx.line.pos : null, by ? by.line.pos : null) };
}

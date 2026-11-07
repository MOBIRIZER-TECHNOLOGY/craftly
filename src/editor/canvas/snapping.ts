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
  kind: "edge" | "center" | "page";
}

export interface SnapTargets {
  xs: Line[];
  ys: Line[];
}

export function computeTargets(page: Page, designW: number, designH: number, exclude: ReadonlySet<string>, guides?: { vertical: number[]; horizontal: number[] }): SnapTargets {
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
  const add = (el: DesignElement) => {
    if (el.hidden || exclude.has(el.id)) return;
    const b = boxBounds(el);
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

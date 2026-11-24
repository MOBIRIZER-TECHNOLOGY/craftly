import { lineSegments } from "./lineRoute";
import type { DesignElement, Point, Rect } from "./types";

export const DEG = Math.PI / 180;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** wraps any angle into (-180, 180] */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** The chosen margin of a page, or a twentieth of its shorter side by default. What is inside it is safe from the edge. */
export const pageMargin = (width: number, height: number, margin?: number): number =>
  Math.max(0, Math.min(Math.min(width, height) / 2, Math.round(margin ?? Math.min(width, height) * 0.05)));

export function rotatePoint(p: Point, center: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const r = deg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

type Box = { x: number; y: number; width: number; height: number; rotation: number };

export function boxCenter(el: Pick<Box, "x" | "y" | "width" | "height">): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** Corners in order top-left, top-right, bottom-right, bottom-left after rotation. */
export function boxCorners(el: Box): [Point, Point, Point, Point] {
  const c = boxCenter(el);
  const hw = el.width / 2;
  const hh = el.height / 2;
  const raw: Point[] = [
    { x: c.x - hw, y: c.y - hh },
    { x: c.x + hw, y: c.y - hh },
    { x: c.x + hw, y: c.y + hh },
    { x: c.x - hw, y: c.y + hh },
  ];
  return raw.map((p) => rotatePoint(p, c, el.rotation)) as [Point, Point, Point, Point];
}

/** Axis-aligned bounds of a (possibly rotated) box. */
export function boxBounds(el: Box): Rect {
  if (!el.rotation) return { x: el.x, y: el.y, w: el.width, h: el.height };
  const cs = boxCorners(el);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export const elementBounds = (el: DesignElement): Rect => boxBounds(el);

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function boundsOfElements(els: DesignElement[]): Rect | null {
  return unionRects(els.map(elementBounds));
}

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Normalise a drag rectangle whose width/height may be negative. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Converts a point to the element's own unrotated frame, origin at the box's top-left. */
export function toLocalPoint(el: Box, p: Point): Point {
  const c = boxCenter(el);
  const q = rotatePoint(p, c, -el.rotation);
  return { x: q.x - el.x, y: q.y - el.y };
}

/** Converts an element-local point (origin at the box's top-left) to parent space. */
export function fromLocalPoint(el: Box, p: Point): Point {
  const c = boxCenter(el);
  return rotatePoint({ x: el.x + p.x, y: el.y + p.y }, c, el.rotation);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return distance(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Does the parent-space point `p` hit the element? `slop` widens the target (design px). */
export function hitTestElement(el: DesignElement, p: Point, slop = 0): boolean {
  const l = toLocalPoint(el, p);
  if (el.type === "line") {
    const w = el.stroke.width / 2 + slop + 3;
    const path = lineSegments(el);
    return path.slice(1).some((point, i) => distToSegment(l, path[i], point) <= w);
  }
  return l.x >= -slop && l.y >= -slop && l.x <= el.width + slop && l.y <= el.height + slop;
}

/** Snaps `deg` to the nearest multiple of `step` when within `threshold`. */
export function snapAngle(deg: number, step = 15, threshold = step): number {
  const snapped = Math.round(deg / step) * step;
  return Math.abs(snapped - deg) <= threshold ? snapped : deg;
}

/** Fit `w x h` inside `bw x bh` keeping aspect ratio. */
export function fitInside(w: number, h: number, bw: number, bh: number): { w: number; h: number } {
  const s = Math.min(bw / w, bh / h);
  return { w: w * s, h: h * s };
}

/** Cover `bw x bh` with `w x h` keeping aspect ratio. */
export function coverBox(w: number, h: number, bw: number, bh: number): { w: number; h: number } {
  const s = Math.max(bw / w, bh / h);
  return { w: w * s, h: h * s };
}

/**
 * Paths made of points and curves: what the Pen tool draws and the point editor changes. Pure maths, no store, no DOM.
 *
 * A path is a list of nodes. A node is an anchor with, optionally, two handles (stored as offsets from the anchor): the side
 * that arrives at the node leaves the previous node along its `handleOut` and comes in along `handleIn`, a cubic Bezier
 * curve. A side with no handle at either end is a straight line. The path of a shape element is stored as SVG path data in
 * a 0..100 box that is stretched to the element (see `ShapeElement.path`), so nothing new is stored: `parsePath` reads that
 * text into nodes, `pathToString` writes it back, and `normalizePath` fits nodes in pixels into that box.
 *
 * The text this file reads and writes is the same subset every time: absolute M, L, C and Z (it also reads H, V and Q, which
 * the freehand tool writes). Anything else (arcs, relative commands, a second subpath) is not read: such a path cannot be
 * edited point by point.
 */
import type { Point, Rect } from "./types";

export interface PenNode {
  x: number;
  y: number;
  /** the handle on the side that arrives at this node, as an offset from the anchor; null = none */
  handleIn: Point | null;
  /** the handle on the side that leaves this node, as an offset from the anchor; null = none */
  handleOut: Point | null;
}

export interface PenPath {
  nodes: PenNode[];
  /** the last node joins the first by one more side */
  closed: boolean;
}

/** The four control points of one side, as absolute positions: anchor, handle, handle, anchor. */
export type Bezier = readonly [Point, Point, Point, Point];

export type NodeKind = "corner" | "smooth";
export type HandleSide = "in" | "out";

/** A handle shorter than this (design px) is no handle: pulling one back onto its anchor takes it away. */
const MIN_HANDLE = 0.5;
/** Two handles within this angle of a straight line through the anchor make a smooth point. */
const SMOOTH_SIN = Math.sin((0.5 * Math.PI) / 180);
/** The smallest box a path gets, so that a flat path still has a width and height to scale by. */
const MIN_EXTENT = 1;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mid = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const isZero = (a: Point) => a.x === 0 && a.y === 0;
/** An offset, or null when there is none to speak of. */
const offsetOrNull = (a: Point): Point | null => (isZero(a) ? null : a);

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

/** At most three decimals, never an exponent, never a minus zero. */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? "0" : String(r);
}

/** The sides of the path as Beziers with absolute control points: one for each pair of nodes, the closing one included. */
export function segmentsOf(path: PenPath): Bezier[] {
  const { nodes, closed } = path;
  if (nodes.length < 2) return [];
  const count = closed ? nodes.length : nodes.length - 1;
  return Array.from({ length: count }, (_unused, i): Bezier => {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const start = { x: a.x, y: a.y };
    const end = { x: b.x, y: b.y };
    return [start, a.handleOut ? add(a, a.handleOut) : { ...start }, b.handleIn ? add(b, b.handleIn) : { ...end }, end];
  });
}

/** SVG path data for the path: M, then L or C for each side, then Z for a closed one. */
export function pathToString(path: PenPath): string {
  const { nodes, closed } = path;
  if (!nodes.length) return "";
  let d = `M${fmt(nodes[0].x)} ${fmt(nodes[0].y)}`;
  segmentsOf(path).forEach((side, i) => {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const [, c1, c2, end] = side;
    d += !a.handleOut && !b.handleIn ? ` L${fmt(end.x)} ${fmt(end.y)}` : ` C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(end.x)} ${fmt(end.y)}`;
  });
  return closed ? `${d} Z` : d;
}

const COMMAND = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * Reads SVG path data into nodes, or null when it is not a single subpath of absolute M, L, H, V, C, Q and Z with at least
 * two points. A quadratic curve becomes the cubic that draws the same line. A path that comes back to its first point before
 * Z gets that point once, with the handle the closing side arrives with.
 */
export function parsePath(d: string): PenPath | null {
  const nodes: PenNode[] = [];
  let closed = false;
  let started = false;
  let match: RegExpExecArray | null;
  COMMAND.lastIndex = 0;
  const last = () => nodes[nodes.length - 1];
  const lineTo = (x: number, y: number) => nodes.push({ x, y, handleIn: null, handleOut: null });
  while ((match = COMMAND.exec(d))) {
    const cmd = match[1];
    if (!"MLHVCQZ".includes(cmd) || closed) return null;
    const nums = (match[2].match(NUMBER) ?? []).map(parseFloat);
    if (cmd === "Z") {
      closed = true;
      continue;
    }
    if (!nums.length) return null;
    if (cmd === "M") {
      if (started || nums.length < 2) return null;
      started = true;
      lineTo(nums[0], nums[1]);
      for (let i = 2; i + 1 < nums.length; i += 2) lineTo(nums[i], nums[i + 1]);
      continue;
    }
    if (!started) return null;
    if (cmd === "L") for (let i = 0; i + 1 < nums.length; i += 2) lineTo(nums[i], nums[i + 1]);
    else if (cmd === "H") for (const x of nums) lineTo(x, last().y);
    else if (cmd === "V") for (const y of nums) lineTo(last().x, y);
    else if (cmd === "C") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const from = last();
        const c1 = { x: nums[i], y: nums[i + 1] };
        const c2 = { x: nums[i + 2], y: nums[i + 3] };
        const to = { x: nums[i + 4], y: nums[i + 5] };
        from.handleOut = offsetOrNull(sub(c1, from));
        nodes.push({ x: to.x, y: to.y, handleIn: offsetOrNull(sub(c2, to)), handleOut: null });
      }
    } else {
      // Q, the one command left after the check above
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const from = last();
        const control = { x: nums[i], y: nums[i + 1] };
        const to = { x: nums[i + 2], y: nums[i + 3] };
        from.handleOut = offsetOrNull({ x: ((control.x - from.x) * 2) / 3, y: ((control.y - from.y) * 2) / 3 });
        nodes.push({ x: to.x, y: to.y, handleIn: offsetOrNull({ x: ((control.x - to.x) * 2) / 3, y: ((control.y - to.y) * 2) / 3 }), handleOut: null });
      }
    }
  }
  if (nodes.length < 2) return null;
  if (closed && nodes.length > 2) {
    const first = nodes[0];
    const end = nodes[nodes.length - 1];
    if (Math.abs(first.x - end.x) < 1e-6 && Math.abs(first.y - end.y) < 1e-6) {
      first.handleIn = end.handleIn;
      nodes.pop();
    }
  }
  return { nodes, closed };
}

/* ------------------------------------------------------------------ */
/* Bezier curves                                                       */
/* ------------------------------------------------------------------ */

export function bezierPoint([p0, p1, p2, p3]: Bezier, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** De Casteljau: the two curves that together draw the same line, meeting at the point `t` of the first. */
export function splitBezier([p0, p1, p2, p3]: Bezier, t: number): [Bezier, Bezier] {
  const p01 = mid(p0, p1, t);
  const p12 = mid(p1, p2, t);
  const p23 = mid(p2, p3, t);
  const p012 = mid(p01, p12, t);
  const p123 = mid(p12, p23, t);
  const p0123 = mid(p012, p123, t);
  return [
    [p0, p01, p012, p0123],
    [p0123, p123, p23, p3],
  ];
}

/** The box that holds the curve itself (not its handles): the ends and the points where it turns. */
export function bezierBounds(curve: Bezier): Rect {
  const [p0, p1, p2, p3] = curve;
  const ts = [0, 1];
  for (const axis of ["x", "y"] as const) {
    const d0 = p1[axis] - p0[axis];
    const d1 = p2[axis] - p1[axis];
    const d2 = p3[axis] - p2[axis];
    // the derivative, a quadratic: a t^2 + b t + c
    const a = d0 - 2 * d1 + d2;
    const b = 2 * (d1 - d0);
    const c = d0;
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) ts.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        ts.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
  }
  const points = ts.filter((t) => t >= 0 && t <= 1).map((t) => bezierPoint(curve, t));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The box of the path: its curves, not their handles. A path of one node is that point. */
export function pathBounds(path: PenPath): Rect {
  const sides = segmentsOf(path);
  if (!sides.length) {
    const p = path.nodes[0] ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y, w: 0, h: 0 };
  }
  const boxes = sides.map(bezierBounds);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/* ------------------------------------------------------------------ */
/* finding things under the pointer                                    */
/* ------------------------------------------------------------------ */

export interface PathHit {
  /** the side: 0 runs from the first node to the second, the last one (of a closed path) from the last node to the first */
  segment: number;
  t: number;
  point: Point;
  distance: number;
}

/** The closest point of a side to `p`: exact for a straight side, sampled and then narrowed for a curve. */
function closestOnBezier(curve: Bezier, p: Point): { t: number; point: Point; distance: number } {
  const [p0, p1, p2, p3] = curve;
  const straight = p1.x === p0.x && p1.y === p0.y && p2.x === p3.x && p2.y === p3.y;
  if (straight) {
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / l2)) : 0;
    const point = mid(p0, p3, t);
    return { t, point, distance: dist(p, point) };
  }
  const STEPS = 32;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= STEPS; i++) {
    const d = dist(p, bezierPoint(curve, i / STEPS));
    if (d < bestDistance) {
      bestDistance = d;
      best = i / STEPS;
    }
  }
  let lo = Math.max(0, best - 1 / STEPS);
  let hi = Math.min(1, best + 1 / STEPS);
  for (let i = 0; i < 24; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (dist(p, bezierPoint(curve, a)) < dist(p, bezierPoint(curve, b))) hi = b;
    else lo = a;
  }
  const t = (lo + hi) / 2;
  const point = bezierPoint(curve, t);
  return { t, point, distance: dist(p, point) };
}

/** The point of the path closest to `p` within `maxDistance`, or null. */
export function nearestOnPath(path: PenPath, p: Point, maxDistance: number): PathHit | null {
  let best: PathHit | null = null;
  segmentsOf(path).forEach((curve, segment) => {
    const hit = closestOnBezier(curve, p);
    if (hit.distance <= maxDistance && (!best || hit.distance < best.distance)) best = { segment, ...hit };
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* editing (every function returns a new path)                         */
/* ------------------------------------------------------------------ */

const replaceNode = (path: PenPath, index: number, node: PenNode): PenPath => ({ ...path, nodes: path.nodes.map((n, i) => (i === index ? node : n)) });

/** A point is smooth when both handles are there and lie on one straight line through the anchor, pointing away from each other. */
export function nodeKindOf(path: PenPath, index: number): NodeKind {
  const node = path.nodes[index];
  if (!node?.handleIn || !node.handleOut) return "corner";
  const a = node.handleIn;
  const b = node.handleOut;
  const la = len(a);
  const lb = len(b);
  if (!la || !lb) return "corner";
  const cross = Math.abs(a.x * b.y - a.y * b.x) / (la * lb);
  return cross <= SMOOTH_SIN && a.x * b.x + a.y * b.y < 0 ? "smooth" : "corner";
}

export function moveNodes(path: PenPath, indices: readonly number[], dx: number, dy: number): PenPath {
  return { ...path, nodes: path.nodes.map((n, i) => (indices.includes(i) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
}

/**
 * Puts a handle where `to` (an absolute position) is. On a smooth point the other handle turns with it and keeps its own
 * length (`mirror`: takes the same length); `breakSymmetry` leaves the other handle where it is. A handle pulled back onto
 * its anchor is taken away.
 */
export function moveHandle(path: PenPath, index: number, which: HandleSide, to: Point, options: { mirror?: boolean; breakSymmetry?: boolean } = {}): PenPath {
  const node = path.nodes[index];
  if (!node) return path;
  const offset = sub(to, node);
  const length = len(offset);
  const smooth = nodeKindOf(path, index) === "smooth";
  const next: PenNode = { ...node };
  const [own, other] = which === "out" ? (["handleOut", "handleIn"] as const) : (["handleIn", "handleOut"] as const);
  next[own] = length < MIN_HANDLE ? null : offset;
  if (smooth && next[own] && !options.breakSymmetry) {
    const opposite = node[other] as Point;
    const size = options.mirror ? length : len(opposite);
    next[other] = { x: (-offset.x / length) * size, y: (-offset.y / length) * size };
  }
  return replaceNode(path, index, next);
}

/** Splits a side at `t` with a new smooth point, so that the path keeps exactly its shape. */
export function insertNode(path: PenPath, segment: number, t: number): PenPath {
  const curve = segmentsOf(path)[segment];
  if (!curve) return path;
  const { nodes } = path;
  const a = nodes[segment];
  const bIndex = (segment + 1) % nodes.length;
  const b = nodes[bIndex];
  let created: PenNode;
  let before = a;
  let after = b;
  if (!a.handleOut && !b.handleIn) {
    const p = mid(a, b, t);
    created = { x: p.x, y: p.y, handleIn: null, handleOut: null };
  } else {
    const [left, right] = splitBezier(curve, t);
    created = { x: left[3].x, y: left[3].y, handleIn: offsetOrNull(sub(left[2], left[3])), handleOut: offsetOrNull(sub(right[1], right[0])) };
    before = { ...a, handleOut: offsetOrNull(sub(left[1], left[0])) };
    after = { ...b, handleIn: offsetOrNull(sub(right[2], right[3])) };
  }
  const next = nodes.map((n, i) => (i === segment ? before : i === bIndex ? after : n));
  next.splice(segment + 1, 0, created);
  return { ...path, nodes: next };
}

/** Takes the nodes away and joins their neighbours; null when fewer than two nodes would be left. */
export function deleteNodes(path: PenPath, indices: readonly number[]): PenPath | null {
  const nodes = path.nodes.filter((_n, i) => !indices.includes(i));
  return nodes.length < 2 ? null : { ...path, nodes };
}

/**
 * Turns a point into a corner (no handles) or a smooth point (handles along the line between its neighbours, a third of the
 * way to each). An end point of an open path has only the one neighbour, so only the one handle.
 */
export function setNodeKind(path: PenPath, index: number, kind: NodeKind): PenPath {
  const node = path.nodes[index];
  if (!node) return path;
  if (kind === "corner") return replaceNode(path, index, { x: node.x, y: node.y, handleIn: null, handleOut: null });
  const count = path.nodes.length;
  const prev = index > 0 ? path.nodes[index - 1] : path.closed ? path.nodes[count - 1] : null;
  const next = index < count - 1 ? path.nodes[index + 1] : path.closed ? path.nodes[0] : null;
  if (!prev && !next) return path;
  const along = prev && next ? sub(next, prev) : next ? sub(next, node) : sub(node, prev as PenNode);
  const l = len(along);
  const unit = l > 1e-9 ? { x: along.x / l, y: along.y / l } : { x: 1, y: 0 };
  return replaceNode(path, index, {
    x: node.x,
    y: node.y,
    handleIn: prev ? { x: (-unit.x * dist(node, prev)) / 3, y: (-unit.y * dist(node, prev)) / 3 } : null,
    handleOut: next ? { x: (unit.x * dist(node, next)) / 3, y: (unit.y * dist(node, next)) / 3 } : null,
  });
}

/** Joins the last node to the first with one more side (a path of fewer than three nodes stays open). */
export function closePath(path: PenPath): PenPath {
  return path.nodes.length >= 3 ? { ...path, closed: true } : path;
}

/* ------------------------------------------------------------------ */
/* the box of the element                                              */
/* ------------------------------------------------------------------ */

const scaleNodes = (path: PenPath, sx: number, sy: number, ox: number, oy: number): PenPath => ({
  closed: path.closed,
  nodes: path.nodes.map((n) => ({
    x: (n.x - ox) * sx,
    y: (n.y - oy) * sy,
    handleIn: n.handleIn && { x: n.handleIn.x * sx, y: n.handleIn.y * sy },
    handleOut: n.handleOut && { x: n.handleOut.x * sx, y: n.handleOut.y * sy },
  })),
});

/**
 * The path as a shape stores it: its tight box (at least a pixel each way) and the path data in that box's 0..100 space.
 * The curves may reach outside 0..100 with their handles; only the curve itself decides the box.
 */
export function normalizePath(path: PenPath): { d: string; box: Rect } {
  const bounds = pathBounds(path);
  const box = { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, MIN_EXTENT), h: Math.max(bounds.h, MIN_EXTENT) };
  return { d: pathToString(scaleNodes(path, 100 / box.w, 100 / box.h, box.x, box.y)), box };
}

/** Every coordinate and handle multiplied by `factor` (the path as drawn at a zoom). */
export const scalePath = (path: PenPath, factor: number): PenPath => scaleNodes(path, factor, factor, 0, 0);

/** Nodes in 0..100 space back to pixels in a box of `width` x `height` (origin at the box's top-left). */
export function denormalizePath(path: PenPath, width: number, height: number): PenPath {
  return scaleNodes(path, width / 100, height / 100, 0, 0);
}

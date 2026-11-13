/**
 * The geometry of an SVG drawing as the editor's own paths (src/core/pen.ts): path data with every command, the basic shapes,
 * transforms, and the two things a path of several pieces needs before it can be a shape here. Pure maths, no DOM.
 *
 * A path of the editor is points with handles, so every curve becomes a cubic Bezier: a quadratic one exactly, an arc of an
 * ellipse in pieces of a quarter turn at most, which is off by less than three parts in ten thousand of the radius. A
 * transform moves the points and turns the handles, which is exact for a Bezier curve, so nothing has to stay a transform.
 */
import { pathBounds, segmentsOf, bezierPoint, type PenNode, type PenPath } from "./pen";
import type { Point, Rect } from "./types";

/* ------------------------------------------------------------------ */
/* transforms                                                          */
/* ------------------------------------------------------------------ */

/** [a, b, c, d, e, f] as SVG writes a matrix: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The transform that does `second` first and `first` after it. */
export function multiply(first: Matrix, second: Matrix): Matrix {
  const [a, b, c, d, e, f] = first;
  const [g, h, i, j, k, l] = second;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

export const applyTo = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** How much the transform enlarges a length, as the mean of all directions: the root of what it does to an area. */
export const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scaling = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];

const RAD = Math.PI / 180;
const FUNCTION = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)[\s,]*/y;

function rotation(degrees: number): Matrix {
  const cos = Math.cos(degrees * RAD);
  const sin = Math.sin(degrees * RAD);
  return [cos, sin, -sin, cos, 0, 0];
}

/** One function of a transform list with its numbers, or null when the count of numbers is not one it takes. */
function functionMatrix(name: string, n: number[]): Matrix | null {
  const count = n.length;
  if (name === "matrix") return count === 6 ? [n[0], n[1], n[2], n[3], n[4], n[5]] : null;
  if (name === "translate") return count === 1 || count === 2 ? translation(n[0], n[1] ?? 0) : null;
  if (name === "scale") return count === 1 || count === 2 ? scaling(n[0], n[1] ?? n[0]) : null;
  if (name === "rotate") {
    if (count === 1) return rotation(n[0]);
    return count === 3 ? multiply(multiply(translation(n[1], n[2]), rotation(n[0])), translation(-n[1], -n[2])) : null;
  }
  if (count !== 1) return null;
  return name === "skewX" ? [1, 0, Math.tan(n[0] * RAD), 1, 0, 0] : [1, Math.tan(n[0] * RAD), 0, 1, 0, 0];
}

/** The matrix of a `transform` attribute (the first function of the list is the outermost), or null when it cannot be read. */
export function parseTransform(list: string): Matrix | null {
  const text = list.trim();
  let matrix = IDENTITY;
  let at = 0;
  while (at < text.length) {
    FUNCTION.lastIndex = at;
    const found = FUNCTION.exec(text);
    if (!found) return null;
    const numbers = found[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const next = numbers.some(Number.isNaN) ? null : functionMatrix(found[1], numbers);
    if (!next) return null;
    matrix = multiply(matrix, next);
    at = FUNCTION.lastIndex;
  }
  return matrix;
}

/** The path with every point moved by the transform and every handle turned and stretched by it. */
export function transformPath(path: PenPath, m: Matrix): PenPath {
  const turned = (offset: Point | null): Point | null => offset && { x: m[0] * offset.x + m[2] * offset.y, y: m[1] * offset.x + m[3] * offset.y };
  return { closed: path.closed, nodes: path.nodes.map((n) => ({ ...applyTo(m, n), handleIn: turned(n.handleIn), handleOut: turned(n.handleOut) })) };
}

/* ------------------------------------------------------------------ */
/* the view box                                                        */
/* ------------------------------------------------------------------ */

/**
 * The transform that shows a view box in a viewport of `width` x `height` at the origin, the way `preserveAspectRatio` says:
 * stretched ("none"), or at one scale and as large as fits ("meet", the default) or as small as covers ("slice"), put at
 * the start, the middle (the default) or the end of each direction.
 */
export function fitViewBox(box: Rect, width: number, height: number, preserve: string): Matrix {
  const [align = "xMidYMid", mode = "meet"] = preserve.trim().split(/\s+/).filter(Boolean);
  let sx = width / box.w;
  let sy = height / box.h;
  const places = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(align);
  if (align !== "none") {
    sx = sy = mode === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
  }
  const share = { Min: 0, Mid: 0.5, Max: 1 } as const;
  const [ax, ay] = places ? [share[places[1] as keyof typeof share], share[places[2] as keyof typeof share]] : [0.5, 0.5];
  return [sx, 0, 0, sy, (width - box.w * sx) * ax - box.x * sx, (height - box.h * sy) * ay - box.y * sy];
}

/* ------------------------------------------------------------------ */
/* path data                                                           */
/* ------------------------------------------------------------------ */

/** How many points may still be read. Reading stops with `TooLarge` when there are none left. */
export interface Budget {
  points: number;
}

/** Thrown when a drawing has more in it than the editor takes: the caller refuses the whole drawing. */
export class TooLarge extends Error {}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const SEPARATOR = /[\s,]*/y;
const COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
const ARGUMENTS: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
/** Two points closer than this are one point. */
const SAME = 1e-9;

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME;
/** The handle that reaches from `anchor` to `to`, or none when it would have no length. */
const handle = (to: Point, anchor: Point): Point | null => (same(to, anchor) ? null : { x: to.x - anchor.x, y: to.y - anchor.y });
const node = (p: Point, handleIn: Point | null = null, handleOut: Point | null = null): PenNode => ({ x: p.x, y: p.y, handleIn, handleOut });

function take(budget: Budget, count: number): void {
  budget.points -= count;
  if (budget.points < 0) throw new TooLarge();
}

/**
 * An arc of an ellipse from `from` to `to` as cubic curves, each as [handle, handle, end]. The arithmetic is the one of the SVG
 * specification (implementation notes, "conversion from endpoint to center parameterization"), with radii that are too
 * small to reach made large enough. Null for an arc with a radius of zero, which SVG draws as a straight line.
 */
function arcCurves(from: Point, rx: number, ry: number, degrees: number, large: boolean, sweep: boolean, to: Point): Array<[Point, Point, Point]> | null {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return null;
  const cos = Math.cos(degrees * RAD);
  const sin = Math.sin(degrees * RAD);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const reach = Math.sqrt((x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry));
  if (reach > 1) {
    rx *= reach;
    ry *= reach;
  }
  const below = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - below) / below));
  const cxp = (factor * rx * y1) / ry;
  const cyp = (-factor * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2;
  const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2;
  const start = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
  let turn = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx) - start;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  else if (!sweep && turn > 0) turn -= 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 2) - 1e-9));
  const step = turn / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const pointAt = (t: number): Point => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const tangentAt = (t: number): Point => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  return Array.from({ length: count }, (_unused, i): [Point, Point, Point] => {
    const a = start + i * step;
    const b = a + step;
    const p0 = i === 0 ? from : pointAt(a);
    const p3 = i === count - 1 ? to : pointAt(b);
    const t0 = tangentAt(a);
    const t3 = tangentAt(b);
    return [{ x: p0.x + k * t0.x, y: p0.y + k * t0.y }, { x: p3.x - k * t3.x, y: p3.y - k * t3.y }, p3];
  });
}

/**
 * Reads SVG path data: every command, absolute and relative, numbers and arc flags written with or without anything between
 * them. Each piece (from an M, or from the point a Z went back to) is a path of its own; a piece of one point draws nothing
 * and is left out. `mistake` says that the data was wrong somewhere: what was read before that is kept, as SVG asks.
 */
export function parsePathData(d: string, budget: Budget): { pieces: PenPath[]; mistake: boolean } {
  const pieces: PenPath[] = [];
  let nodes: PenNode[] | null = null;
  let start: Point = { x: 0, y: 0 };
  let current: Point = { x: 0, y: 0 };
  /** the last control point when the command before was a curve of that kind: what S and T mirror */
  let before: { kind: "C" | "Q"; control: Point } | null = null;
  let at = 0;

  const skip = () => {
    SEPARATOR.lastIndex = at;
    SEPARATOR.exec(d);
    at = SEPARATOR.lastIndex;
  };
  const number = (): number | null => {
    skip();
    NUMBER.lastIndex = at;
    const found = NUMBER.exec(d);
    if (!found) return null;
    at = NUMBER.lastIndex;
    return parseFloat(found[0]);
  };
  const flag = (): number | null => {
    skip();
    const c = d[at];
    if (c !== "0" && c !== "1") return null;
    at++;
    return Number(c);
  };
  const finish = (closed: boolean) => {
    const list = nodes;
    nodes = null;
    if (!list) return;
    if (closed && list.length > 1 && same(list[0], list[list.length - 1])) list[0].handleIn = (list.pop() as PenNode).handleIn;
    if (list.length > 1) pieces.push({ nodes: list, closed });
  };
  /** The piece that is being drawn; after a Z the next command starts one at the point the Z went back to. */
  const open = (): PenNode[] => {
    if (!nodes) {
      take(budget, 1);
      nodes = [node(current)];
    }
    return nodes;
  };
  const lineTo = (to: Point) => {
    const list = open();
    take(budget, 1);
    list.push(node(to));
    current = to;
  };
  const curveTo = (c1: Point, c2: Point, to: Point) => {
    const list = open();
    take(budget, 1);
    const from = list[list.length - 1];
    from.handleOut = handle(c1, from);
    list.push(node(to, handle(c2, to)));
    current = to;
  };
  /** A quadratic curve as the cubic that draws the same line: its handles are two thirds of the way to the control point. */
  const quadTo = (control: Point, to: Point) => {
    const from = current;
    curveTo(
      { x: from.x + ((control.x - from.x) * 2) / 3, y: from.y + ((control.y - from.y) * 2) / 3 },
      { x: to.x + ((control.x - to.x) * 2) / 3, y: to.y + ((control.y - to.y) * 2) / 3 },
      to,
    );
  };
  const mirrored = (control: Point): Point => ({ x: 2 * current.x - control.x, y: 2 * current.y - control.y });

  let command = "";
  let begun = false;
  let mistake = false;
  for (;;) {
    skip();
    if (at >= d.length) break;
    if (COMMANDS.includes(d[at])) command = d[at++];
    // numbers with no letter before them repeat the command; after M they are lines, and after Z there is nothing to repeat
    else if (command === "M") command = "L";
    else if (command === "m") command = "l";
    else if (command === "Z" || command === "z") mistake = true;
    const kind = command.toUpperCase();
    // path data starts with an M: anything else first (no letter at all included) is a mistake
    if (!begun && kind !== "M") mistake = true;
    if (mistake) break;
    begun = true;
    if (kind === "Z") {
      finish(true);
      current = start;
      before = null;
      continue;
    }
    const n: number[] = [];
    for (let i = 0; i < ARGUMENTS[kind] && !mistake; i++) {
      const value = kind === "A" && (i === 3 || i === 4) ? flag() : number();
      if (value === null) mistake = true;
      else n.push(value);
    }
    if (mistake) break;
    const relative = command !== kind;
    const ox = relative ? current.x : 0;
    const oy = relative ? current.y : 0;
    const earlier = before;
    before = null;
    if (kind === "M") {
      finish(false);
      current = start = { x: ox + n[0], y: oy + n[1] };
      take(budget, 1);
      nodes = [node(current)];
    } else if (kind === "L") lineTo({ x: ox + n[0], y: oy + n[1] });
    else if (kind === "H") lineTo({ x: ox + n[0], y: current.y });
    else if (kind === "V") lineTo({ x: current.x, y: oy + n[0] });
    else if (kind === "C" || kind === "S") {
      const given = kind === "C" ? 2 : 0;
      const c1 = kind === "C" ? { x: ox + n[0], y: oy + n[1] } : earlier?.kind === "C" ? mirrored(earlier.control) : current;
      const c2 = { x: ox + n[given], y: oy + n[given + 1] };
      curveTo(c1, c2, { x: ox + n[given + 2], y: oy + n[given + 3] });
      before = { kind: "C", control: c2 };
    } else if (kind === "Q") {
      const control = { x: ox + n[0], y: oy + n[1] };
      quadTo(control, { x: ox + n[2], y: oy + n[3] });
      before = { kind: "Q", control };
    } else if (kind === "T") {
      const to = { x: ox + n[0], y: oy + n[1] };
      // with no curve before it the control point is the point itself, and the curve a straight line
      if (earlier?.kind !== "Q") lineTo(to);
      else {
        const control = mirrored(earlier.control);
        quadTo(control, to);
        before = { kind: "Q", control };
      }
    } else {
      const to = { x: ox + n[5], y: oy + n[6] };
      if (same(current, to)) continue;
      const curves = arcCurves(current, n[0], n[1], n[2], n[3] === 1, n[4] === 1, to);
      if (!curves) lineTo(to);
      else for (const [c1, c2, end] of curves) curveTo(c1, c2, end);
    }
  }
  finish(false);
  return { pieces, mistake };
}

/* ------------------------------------------------------------------ */
/* basic shapes                                                        */
/* ------------------------------------------------------------------ */

/** How far a handle reaches for a quarter of a circle of radius one. */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/** A rectangle with corners rounded by the radii (already not more than half a side); two points in one place are one. */
export function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): PenPath {
  if (rx <= 0 || ry <= 0) return { closed: true, nodes: [node({ x, y }), node({ x: x + w, y }), node({ x: x + w, y: y + h }), node({ x, y: y + h })] };
  const kx = { x: KAPPA * rx, y: 0 };
  const ky = { x: 0, y: KAPPA * ry };
  const back = (p: Point): Point => ({ x: -p.x, y: -p.y });
  const all = [
    node({ x: x + rx, y }, back(kx)),
    node({ x: x + w - rx, y }, null, kx),
    node({ x: x + w, y: y + ry }, back(ky)),
    node({ x: x + w, y: y + h - ry }, null, ky),
    node({ x: x + w - rx, y: y + h }, kx),
    node({ x: x + rx, y: y + h }, null, back(kx)),
    node({ x, y: y + h - ry }, ky),
    node({ x, y: y + ry }, null, back(ky)),
  ];
  // the two ends of a side that the corners used up are one point, which keeps the handle of each
  const nodes: PenNode[] = [];
  for (let i = 0; i < all.length; i += 2) {
    if (same(all[i], all[i + 1])) nodes.push({ ...all[i], handleOut: all[i + 1].handleOut });
    else nodes.push(all[i], all[i + 1]);
  }
  return { closed: true, nodes };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PenPath {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return {
    closed: true,
    nodes: [
      node({ x: cx + rx, y: cy }, { x: 0, y: -ky }, { x: 0, y: ky }),
      node({ x: cx, y: cy + ry }, { x: kx, y: 0 }, { x: -kx, y: 0 }),
      node({ x: cx - rx, y: cy }, { x: 0, y: ky }, { x: 0, y: -ky }),
      node({ x: cx, y: cy - ry }, { x: -kx, y: 0 }, { x: kx, y: 0 }),
    ],
  };
}

/** The points of a `points` attribute as one path of straight sides, or null when there are fewer than two. */
export function pointsPath(points: string, closed: boolean, budget: Budget): PenPath | null {
  const numbers = (points.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(parseFloat);
  const count = Math.floor(numbers.length / 2);
  take(budget, count);
  const nodes = Array.from({ length: count }, (_unused, i) => node({ x: numbers[2 * i], y: numbers[2 * i + 1] }));
  return nodes.length > 1 ? { nodes, closed } : null;
}

/* ------------------------------------------------------------------ */
/* paths of several pieces                                             */
/* ------------------------------------------------------------------ */

/** Each side of a piece is looked at in this many straight steps when the question is what lies inside what. */
const STEPS = 8;

function outline(path: PenPath): Point[] {
  return segmentsOf({ nodes: path.nodes, closed: true }).flatMap((side) => Array.from({ length: STEPS }, (_unused, i) => bezierPoint(side, i / STEPS)));
}

const area = (points: Point[]): number => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2;

function inside(p: Point, points: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const reversed = (path: PenPath): PenPath => ({
  closed: path.closed,
  nodes: [...path.nodes].reverse().map((n) => ({ x: n.x, y: n.y, handleIn: n.handleOut, handleOut: n.handleIn })),
});

/**
 * The pieces of a path that is filled by the even-odd rule, turned so that the non-zero rule, which is the one a path of the
 * editor is filled by, leaves the same holes: a piece inside an odd number of others runs the other way round than the
 * outermost ones. That is right for pieces that do not cross each other or themselves, which is what holes and islands are;
 * pieces that cross are filled where the even-odd rule would have left a gap.
 */
export function evenOddPieces(pieces: readonly PenPath[]): PenPath[] {
  const outlines = pieces.map(outline);
  const boxes = pieces.map(pathBounds);
  const areas = outlines.map(area);
  const depths = outlines.map(
    ([first], i) =>
      outlines.filter(
        (other, j) => j !== i && first.x >= boxes[j].x && first.x <= boxes[j].x + boxes[j].w && first.y >= boxes[j].y && first.y <= boxes[j].y + boxes[j].h && inside(first, other),
      ).length,
  );
  const outermost = depths.findIndex((depth, i) => depth === 0 && areas[i] !== 0);
  const way = Math.sign(areas[outermost] ?? 1);
  return pieces.map((piece, i) => (areas[i] !== 0 && Math.sign(areas[i]) !== (depths[i] % 2 ? -way : way) ? reversed(piece) : piece));
}

/**
 * The boxes in sets that lie apart: two boxes that touch or overlap are in one set, and so is everything that touches one of
 * them. Each set lists its boxes by their place in `boxes`, and the sets come in the order of their first box.
 */
export function apart(boxes: readonly Rect[]): number[][] {
  const set = boxes.map((_box, i) => i);
  const find = (i: number): number => (set[i] === i ? i : (set[i] = find(set[i])));
  boxes.forEach((a, i) => {
    for (let j = 0; j < i; j++) {
      const b = boxes[j];
      // the set with the earlier first box takes the other in, so that the order of the sets is the order of the drawing
      if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) set[Math.max(find(i), find(j))] = Math.min(find(i), find(j));
    }
  });
  const sets = new Map<number, number[]>();
  boxes.forEach((_box, i) => sets.set(find(i), [...(sets.get(find(i)) ?? []), i]));
  return [...sets.values()];
}

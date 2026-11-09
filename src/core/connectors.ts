/**
 * Lines that are attached to shapes (diagrams, flowcharts). An end of a line can be bound to an element of the page: it then sits
 * at the middle of one of that element's sides and follows it when it moves, changes size or turns. The geometry here is pure;
 * the store calls `reflowLines` after every change, so moving a shape and aiming its lines is one step of undo.
 *
 * A bound line is still an ordinary `LineElement` (a straight line with arrowheads): `x, y, width, rotation` are kept up to date, so
 * painting, export, the line toolbar and hit testing know nothing about attachments. The rules in `reflowLines`:
 * - a shape that moves, changes size or turns re-aims the lines attached to it;
 * - a shape that goes takes its lines with it (undo brings both back), unless the line was never attached to it here;
 * - a shape that is put in a group lets go of its lines, which stay where they are (nothing inside a group can be attached to);
 * - a line that is moved, turned or resized by hand is detached (it is where the person put it);
 * - a free end stays where it is.
 * Only elements of the page itself are attached to (not those inside a group), and never another line. Lines inside a group are
 * left alone: they move with the group, and are aimed again if they come out of it.
 */
import { boxCenter, DEG, rotatePoint, toLocalPoint } from "./geometry";
import type { Anchor, Design, DesignElement, LineBinding, LineElement, Page, Point } from "./types";

type Frame = { x: number; y: number; width: number; height: number; rotation: number };
export type Side = Exclude<Anchor, "auto">;

/** The middle of a side of a box, on the page, after the box is turned about its centre. */
export function anchorPoint(frame: Frame, side: Side): Point {
  const { width: w, height: h } = frame;
  const local = side === "top" ? { x: w / 2, y: 0 } : side === "right" ? { x: w, y: h / 2 } : side === "bottom" ? { x: w / 2, y: h } : { x: 0, y: h / 2 };
  return rotatePoint({ x: frame.x + local.x, y: frame.y + local.y }, boxCenter(frame), frame.rotation);
}

/** The side of a box that faces a point: the one that the point is furthest along, in proportion to the size of the box. */
export function bestSide(frame: Frame, toward: Point): Side {
  const local = toLocalPoint(frame, toward);
  const dx = local.x - frame.width / 2;
  const dy = local.y - frame.height / 2;
  if (Math.abs(dx) * frame.height > Math.abs(dy) * frame.width) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

/** The box, turn and length that describe a straight line from one point to another. */
export function lineFromPoints(start: Point, end: Point): Pick<LineElement, "x" | "y" | "width" | "height" | "rotation"> {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return { x: (start.x + end.x) / 2 - length / 2, y: (start.y + end.y) / 2, width: length, height: 0, rotation: length ? Math.atan2(dy, dx) / DEG : 0 };
}

/** The two ends of a line, on the page. */
export function lineEndpoints(line: Pick<LineElement, "x" | "y" | "width" | "height" | "rotation">): { start: Point; end: Point } {
  const centre = boxCenter(line);
  const y = line.y + line.height / 2;
  return { start: rotatePoint({ x: line.x, y }, centre, line.rotation), end: rotatePoint({ x: line.x + line.width, y }, centre, line.rotation) };
}

type End = { frame: Frame; anchor: Anchor } | { point: Point };

/** Where the two ends of a line are: an attached end at the side of its box (the side that faces the other end, for "auto"), a free end where it is. */
export function connectedEnds(ends: { start: End; end: End }): { start: Point; end: Point } {
  const centreOf = (e: End) => ("frame" in e ? boxCenter(e.frame) : e.point);
  const resolve = (e: End, other: End): Point => ("frame" in e ? anchorPoint(e.frame, e.anchor === "auto" ? bestSide(e.frame, centreOf(other)) : e.anchor) : e.point);
  return { start: resolve(ends.start, ends.end), end: resolve(ends.end, ends.start) };
}

/**
 * The two elements that "Connect" joins: exactly two different ones, both on the page itself (not inside a group) and neither a
 * line, in the order they are given (the arrow runs from the first to the second). Null when they cannot be joined.
 */
export function connectable(page: Page | null, ids: readonly string[]): [DesignElement, DesignElement] | null {
  if (!page || ids.length !== 2 || ids[0] === ids[1]) return null;
  const pair = ids.map((id) => page.elements.find((e) => e.id === id));
  return pair.every((e) => e && e.type !== "line") ? (pair as [DesignElement, DesignElement]) : null;
}

/* ---------------- keeping lines aimed ---------------- */

const EPSILON = 0.01;
const isBound = (el: DesignElement): el is LineElement => el.type === "line" && !!(el.start || el.end);
const sameBinding = (a: LineBinding | null | undefined, b: LineBinding | null | undefined) =>
  (a?.elementId ?? null) === (b?.elementId ?? null) && (a?.anchor ?? null) === (b?.anchor ?? null);
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

/**
 * Brings the lines of a design that has just been changed in step with the elements that they are attached to. `before` is the design
 * as it was: what changed is found by comparing elements (an element that changed is a new object). The same design when nothing
 * needs fixing.
 */
export function reflowLines(next: Design, before: Design | null): Design {
  let changed = false;
  const pages = next.pages.map((page) => {
    const result = reflowPage(page, before?.pages.find((p) => p.id === page.id) ?? null);
    if (result !== page) changed = true;
    return result;
  });
  return changed ? { ...next, pages } : next;
}

/** What `reflowLine` needs to know about the page: its elements now and before, and which ones are inside groups. */
interface Surroundings {
  here: Map<string, DesignElement>;
  there: Map<string, DesignElement>;
  nested: Set<string>;
}

function idsInsideGroups(elements: DesignElement[], inside = false, out = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (inside) out.add(el.id);
    if (el.type === "group") idsInsideGroups(el.children, true, out);
  }
  return out;
}

function reflowPage(page: Page, before: Page | null): Page {
  // a page that is the one it was is as it was left; only lines on the page itself are kept aimed (those in a group move with it)
  if (before === page || !page.elements.some(isBound)) return page;
  const around: Surroundings = {
    here: new Map(page.elements.map((e) => [e.id, e])),
    there: new Map((before?.elements ?? []).map((e) => [e.id, e])),
    nested: idsInsideGroups(page.elements),
  };
  const elements: DesignElement[] = [];
  let touched = false;
  for (const el of page.elements) {
    const fixed = isBound(el) ? reflowLine(el, around) : el;
    if (fixed !== el) touched = true;
    if (fixed) elements.push(fixed);
  }
  return touched ? { ...page, elements } : page;
}

/** The line, aimed again; null when it has to go; the same object when it is right as it is. */
function reflowLine(line: LineElement, { here, there, nested }: Surroundings): LineElement | null {
  const old = there.get(line.id);
  const previous = old?.type === "line" ? old : null;
  let start = line.start ?? null;
  let end = line.end ?? null;

  // an end can only be attached to another element of the page that is not a line
  for (const side of ["start", "end"] as const) {
    const binding = side === "start" ? start : end;
    if (!binding) continue;
    const target = here.get(binding.elementId);
    if (target && target.type !== "line") continue;
    // it was attached to an element that has been removed (one that has only been put in a group is still there: the line lets go of it)
    const was = there.get(binding.elementId);
    if (!target && was && was.type !== "line" && !nested.has(binding.elementId)) return null;
    if (side === "start") start = null;
    else end = null;
  }
  if (!start && !end) return { ...line, start: null, end: null };

  const targetsMoved = [start, end].some((b) => b && here.get(b.elementId) !== there.get(b.elementId));
  const attachmentsChanged = !previous || !sameBinding(previous.start, start) || !sameBinding(previous.end, end);
  const intact = start === (line.start ?? null) && end === (line.end ?? null);

  const own = lineEndpoints(line);
  const frameOf = (b: LineBinding) => here.get(b.elementId) as DesignElement;
  const aimed = connectedEnds({
    start: start ? { frame: frameOf(start), anchor: start.anchor } : { point: own.start },
    end: end ? { frame: frameOf(end), anchor: end.anchor } : { point: own.end },
  });
  const right = samePoint(own.start, aimed.start) && samePoint(own.end, aimed.end);

  // changed by hand, with its elements and its attachments as they were: it is where the person put it, and no longer attached
  if (previous && previous !== line && !attachmentsChanged && !targetsMoved && !right) return { ...line, start: null, end: null };
  if (right && intact) return line;
  return { ...line, ...lineFromPoints(aimed.start, aimed.end), start, end };
}

/**
 * Makes the copies of some elements keep to each other: a copy of a line is attached to the copies of the elements that the
 * original was attached to, and cut loose from those that were not copied with it (a copied line alone is a free line).
 * `clones[i]` is the copy of `originals[i]`, and the copy of a group has the same children in the same order. Changes the
 * copies, also those inside copied groups.
 */
export function rebindClones(originals: DesignElement[], clones: DesignElement[]): void {
  const copyOf = new Map<string, string>();
  const pair = (from: DesignElement[], to: DesignElement[]) =>
    from.forEach((el, i) => {
      const copy = to[i];
      if (!copy) return;
      copyOf.set(el.id, copy.id);
      if (el.type === "group" && copy.type === "group") pair(el.children, copy.children);
    });
  pair(originals, clones);

  const remap = (b: LineBinding | null | undefined) => (b ? (copyOf.has(b.elementId) ? { ...b, elementId: copyOf.get(b.elementId) as string } : null) : b);
  const visit = (list: DesignElement[]) =>
    list.forEach((el) => {
      if (el.type === "group") visit(el.children);
      if (el.type !== "line") return;
      if (el.start) el.start = remap(el.start);
      if (el.end) el.end = remap(el.end);
    });
  visit(clones);
}

/**
 * The lines of elements that have been replaced by one new element (shapes combined into one) are attached to the new element
 * instead, with the sides that were chosen; a line that is left joining the new element to itself goes. Changes `elements`,
 * the elements of a page or of a group, and the groups inside them.
 */
export function retargetLines(elements: DesignElement[], replaced: string[], to: string): void {
  if (!replaced.length) return;
  const gone = new Set(replaced);
  const retarget = (b: LineBinding | null | undefined) => (b && gone.has(b.elementId) ? { ...b, elementId: to } : b);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type === "group") retargetLines(el.children, replaced, to);
    if (el.type !== "line") continue;
    if (el.start) el.start = retarget(el.start);
    if (el.end) el.end = retarget(el.end);
    if (el.start?.elementId === to && el.end?.elementId === to) elements.splice(i, 1);
  }
}

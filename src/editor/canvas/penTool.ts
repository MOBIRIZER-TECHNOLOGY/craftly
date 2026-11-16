/**
 * The Pen tool. A click places a point; a press that is dragged pulls a curve out of the point (a handle on each side);
 * the path ends with a click on its last point, Enter, Esc, a double click, or by choosing another tool, and closes with a
 * click on its first point. The path being placed lives in `useGesture().pen` (design px); finishing it makes an ordinary
 * path shape (src/core/penShape.ts) and gives the page back to the Select tool with the new path selected. The canvas
 * controller routes the pointer here; the keys (src/editor/hotkeys.ts) call `finishPen`, `backspacePen`, `penHistory` and
 * `cancelPen`. A path stays on the page it was started on: choosing another page finishes it there. The second half of the
 * file is the same tool for somebody without a pointer (`penKey`).
 */
import { createShape } from "@/core/factory";
import { closePath, type PenNode } from "@/core/pen";
import { newPathShape } from "@/core/penShape";
import { getActions, useEditor } from "@/core/store";
import type { Point } from "@/core/types";
import { getDrawStroke } from "@/editor/panels/shared/drawSettings";
import { m } from "@/i18n";
import { useGesture, type PenCursor } from "./gestureStore";
import { getMetrics, screenToDesign, type ViewMetrics } from "./viewStore";

/** Screen px a press has to be dragged before it is a curve and not a click. */
export const DRAG_SLOP = 3;
/** Screen px around the first point inside which a click closes the path. */
export const CLOSE_RADIUS = 9;
/** Screen px around the last point inside which a click ends the path instead of adding a point. */
const SAME_SPOT = 3;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/** `-n` without the minus zero. */
const negate = (n: number) => (n === 0 ? 0 : -n);
const draftOf = () => useGesture.getState().pen;

/** `to` brought onto the nearest line through `from` at a multiple of 45 degrees: the pointer's own coordinate along that line. */
export function constrainTo45(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: from.x + Math.cos(angle) * along, y: from.y + Math.sin(angle) * along };
}

export const hasPenDraft = (): boolean => draftOf() !== null;

/** `node` with a handle on each side, `out` and its mirror image, or with none. */
const withHandles = (node: PenNode, out: Point | null): PenNode => ({ ...node, handleOut: out, handleIn: out && { x: negate(out.x), y: negate(out.y) } });

/**
 * What a press at `pt` does to a path of `nodes`: on the first point of three or more it closes the path, on the last point it
 * ends it, anywhere else it places a point.
 */
export function penTarget(pt: Point, nodes: readonly PenNode[], zoom: number): "close" | "end" | "place" {
  if (nodes.length >= 3 && distance(pt, nodes[0]) * zoom <= CLOSE_RADIUS) return "close";
  const last = nodes[nodes.length - 1];
  return last && distance(pt, last) * zoom <= SAME_SPOT ? "end" : "place";
}

/**
 * A press of the pen at `pt`. Returns the index of the point it placed, so that dragging can pull its handles, or null when
 * the press ended the path instead (a click on the last point, or on the first of a path of three or more, which closes it).
 */
export function penPress(pt: Point, options: { zoom: number; shift: boolean }): { shaping: number } | null {
  const draft = draftOf();
  const nodes = draft?.path.nodes ?? [];
  const target = penTarget(pt, nodes, options.zoom);
  if (target !== "place") {
    finishPen(target === "close");
    return null;
  }
  const last = nodes[nodes.length - 1];
  const at = options.shift && last ? constrainTo45(last, pt) : pt;
  const placed: PenNode = { x: at.x, y: at.y, handleIn: null, handleOut: null };
  const pageId = draft?.pageId ?? useEditor.getState().activePageId;
  useGesture.getState().set({ pen: { path: { nodes: [...nodes, placed], closed: false }, hover: null, pageId } });
  return { shaping: nodes.length };
}

/** The pointer moves with the button down: the point at `index` gets a handle on each side, pulled towards `pt`. */
export function penDrag(index: number, pt: Point, zoom: number): void {
  const draft = draftOf();
  const node = draft?.path.nodes[index];
  if (!draft || !node) return;
  const out = { x: pt.x - node.x, y: pt.y - node.y };
  const pulled = Math.hypot(out.x, out.y) * zoom >= DRAG_SLOP;
  const nodes = draft.path.nodes.map((n, i) => (i === index ? withHandles(n, pulled ? out : null) : n));
  useGesture.getState().set({ pen: { ...draft, path: { ...draft.path, nodes }, hover: null } });
}

/** The pointer moves with no button down: shows the side the next click would make. */
export function penHover(pt: Point, shift: boolean): void {
  const draft = draftOf();
  if (!draft) return;
  const last = draft.path.nodes[draft.path.nodes.length - 1];
  useGesture.getState().set({ pen: { ...draft, hover: shift && last ? constrainTo45(last, pt) : pt } });
}

/**
 * Makes the path out of the points placed so far (nothing for fewer than two) and selects it. The Select tool takes over,
 * unless the path is being finished because another tool was chosen (`keepTool`). When it is finished after another page was
 * chosen it goes on the page it was drawn on, and the page, the tool and the selection are left as the person made them.
 */
export function finishPen(closed = false, keepTool = false): void {
  const draft = draftOf();
  useGesture.getState().set({ pen: null });
  const design = useEditor.getState().design;
  if (!draft || !design || draft.path.nodes.length < 2) return;
  const path = closed ? closePath(draft.path) : draft.path;
  const stroke = getDrawStroke(design.width);
  const actions = getActions();
  const shape = createShape("path", newPathShape(path, { color: stroke.color, strokeWidth: stroke.width }));
  if (useEditor.getState().activePageId !== draft.pageId) {
    actions.addElement(shape, { center: false, pageId: draft.pageId, select: false });
    return;
  }
  if (!keepTool) actions.setTool("select");
  actions.addElement(shape, { center: false });
}

/** Throws the path away. */
export function cancelPen(): void {
  if (draftOf()) useGesture.getState().set({ pen: null });
}

/** Takes the last point back; the path is gone when none is left. */
export function backspacePen(): void {
  const draft = draftOf();
  if (!draft) return;
  const nodes = draft.path.nodes.slice(0, -1);
  if (!nodes.length) return cancelPen();
  useGesture.getState().set({ pen: { ...draft, path: { ...draft.path, nodes } } });
}

/**
 * Undo and redo belong to the path while one is being placed: undo takes the last point back, and redo does nothing (a point
 * that was taken back is not kept), so that neither reaches into the document under the path. True when the key or the button
 * was used up, false when no path is being placed and undo and redo are the document's.
 */
export function penHistory(redo: boolean): boolean {
  if (!draftOf()) return false;
  if (!redo) backspacePen();
  return true;
}

/* ---------------- the Pen from the keyboard ---------------- */

/*
 * A person without a pointer draws with a point that the arrow keys move over the page (`useGesture().penCursor`). Enter is
 * the click of that point: it goes through `penPress`, so that it places, closes and ends exactly as a click does. The point
 * shows up with the first arrow key and hides, but is remembered, as soon as the pointer moves: a person who draws with the
 * pointer never sees it, and for them Enter stays what it was, the end of the path.
 */

interface PageSize {
  width: number;
  height: number;
}

const cursorOf = () => useGesture.getState().penCursor;
const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
/** A place in words: whole pixels, since a pointer may have put a point between two. */
// (`|| 0`: a place a little left of or above the edge is said as 0, not as minus 0)
const spoken = (p: Point) => m.editor.pen.place(Math.round(p.x) || 0, Math.round(p.y) || 0);

/** The middle of the part of the page that the window shows, in whole design px; of the whole page when none of it shows. */
export function visibleMiddle(metrics: ViewMetrics, page: PageSize): Point {
  const from = screenToDesign(metrics, 0, 0);
  const to = screenToDesign(metrics, metrics.width, metrics.height);
  const left = Math.max(0, from.x);
  const right = Math.min(page.width, to.x);
  const top = Math.max(0, from.y);
  const bottom = Math.min(page.height, to.y);
  if (left >= right || top >= bottom) return { x: Math.round(page.width / 2), y: Math.round(page.height / 2) };
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

/** Shows the keyboard point at `pt` and runs the side that the next point would make to it. */
function showPenCursor(pt: Point, say?: string): void {
  const draft = draftOf();
  const target = penTarget(pt, draft?.path.nodes ?? [], useEditor.getState().zoom);
  useGesture.getState().set({
    penCursor: { x: pt.x, y: pt.y, shown: true, say: say ?? m.editor.pen.at(spoken(pt), target) },
    ...(draft ? { pen: { ...draft, hover: { x: pt.x, y: pt.y } } } : {}),
  });
}

/** The pointer moved: the keyboard point steps aside, and comes back where it was with the next arrow key. */
export function hidePenCursor(): void {
  const cursor = cursorOf();
  if (cursor?.shown) useGesture.getState().set({ penCursor: { ...cursor, shown: false, say: "" } });
}

/** The pointer pressed, or the tool, the page or the design changed: the keyboard point starts afresh the next time. */
export function forgetPenCursor(): void {
  if (cursorOf()) useGesture.getState().set({ penCursor: null });
}

export const penCursorShown = (): boolean => !!cursorOf()?.shown;

/** Alt and an arrow: the curve of the last point grows by (dx, dy), the same on both sides, as a drag out of the point makes it. */
function pullLastHandle(cursor: PenCursor, dx: number, dy: number): void {
  const draft = draftOf();
  if (!draft) return;
  const last = draft.path.nodes[draft.path.nodes.length - 1];
  const out = { x: (last.handleOut?.x ?? 0) + dx, y: (last.handleOut?.y ?? 0) + dy };
  const pulled = out.x !== 0 || out.y !== 0;
  const nodes = draft.path.nodes.map((n) => (n === last ? withHandles(n, pulled ? out : null) : n));
  useGesture
    .getState()
    .set({ pen: { ...draft, path: { ...draft.path, nodes } }, penCursor: { ...cursor, say: pulled ? m.editor.pen.curveHandle(spoken(out)) : m.editor.pen.noCurveHandle } });
}

/**
 * Enter on the keyboard point: what a click there does. With `smooth` (Shift) the new point gets a curve that goes on in the
 * direction the path came in, a third as long as the side before it; the first point has no such direction and stays a corner.
 */
function pressAtPenCursor(at: Point, smooth: boolean): void {
  const zoom = useEditor.getState().zoom;
  const before = draftOf()?.path.nodes ?? [];
  const press = penPress(at, { zoom, shift: false });
  if (!press) {
    // the path was closed or ended, and the Select tool has taken over; a single point made nothing, and the pen stays in hand
    if (useEditor.getState().tool === "pen") showPenCursor(at, m.editor.pen.singlePoint);
    else forgetPenCursor();
    return;
  }
  const previous = before.length ? before[before.length - 1] : null;
  const draft = draftOf();
  const curved = smooth && previous !== null && draft !== null;
  if (curved) {
    const out = { x: (at.x - previous.x) / 3, y: (at.y - previous.y) / 3 };
    const nodes = draft.path.nodes.map((n, i) => (i === press.shaping ? withHandles(n, out) : n));
    useGesture.getState().set({ pen: { ...draft, path: { ...draft.path, nodes } } });
  }
  showPenCursor(at, m.editor.pen.placed(curved, press.shaping + 1, spoken(at)));
}

/**
 * The keys of the Pen while it is in hand: the arrows move the keyboard point (Shift: ten pixels, as for the nudging of an
 * element) and stop at the edges of the page, Enter places a point there (Shift+Enter a smooth one), Alt and the arrows pull
 * the curve of the last point, and Home goes to the first point, where Enter closes the path. Returns true when the key was
 * used. Enter is only taken while the keyboard point is shown; otherwise it stays with the editor, which ends the path.
 */
export function penKey(e: KeyboardEvent, page: PageSize): boolean {
  if (e.ctrlKey || e.metaKey) return false;
  const key = e.key.toLowerCase();
  const cursor = cursorOf();
  if (key.startsWith("arrow")) {
    const step = e.shiftKey ? 10 : 1;
    const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
    const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
    if (e.altKey) {
      // while the keyboard point is shown the browser never gets Alt and an arrow, which would leave the editor for the page before
      if (!cursor?.shown) return false;
      pullLastHandle(cursor, dx, dy);
      return true;
    }
    // the first arrow only shows the point (where it was, on the last point of the path, or in the middle of what is in view)
    const nodes = draftOf()?.path.nodes ?? [];
    if (!cursor?.shown) showPenCursor(cursor ?? nodes[nodes.length - 1] ?? visibleMiddle(getMetrics(), page));
    else showPenCursor({ x: clamp(cursor.x + dx, page.width), y: clamp(cursor.y + dy, page.height) });
    return true;
  }
  if (e.altKey) return false;
  if (key === "home") {
    const first = draftOf()?.path.nodes[0];
    if (!first) return false;
    showPenCursor(first);
    return true;
  }
  if (key === "enter" && cursor?.shown) {
    pressAtPenCursor({ x: cursor.x, y: cursor.y }, e.shiftKey);
    return true;
  }
  return false;
}

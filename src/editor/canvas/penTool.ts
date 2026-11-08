/**
 * The Pen tool. A click places a point; a press that is dragged pulls a curve out of the point (a handle on each side);
 * the path ends with a click on its last point, Enter, Esc, a double click, or by choosing another tool, and closes with a
 * click on its first point. The path being placed lives in `useGesture().pen` (design px); finishing it makes an ordinary
 * path shape (src/core/penShape.ts) and gives the page back to the Select tool with the new path selected. The canvas
 * controller routes the pointer here; the keys (src/editor/hotkeys.ts) call `finishPen`, `backspacePen` and `cancelPen`.
 */
import { createShape } from "@/core/factory";
import { closePath, type PenNode } from "@/core/pen";
import { newPathShape } from "@/core/penShape";
import { getActions, useEditor } from "@/core/store";
import type { Point } from "@/core/types";
import { getDrawStroke } from "@/editor/panels/shared/drawSettings";
import { useGesture } from "./gestureStore";

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

/**
 * A press of the pen at `pt`. Returns the index of the point it placed, so that dragging can pull its handles, or null when
 * the press ended the path instead (a click on the last point, or on the first of a path of three or more, which closes it).
 */
export function penPress(pt: Point, options: { zoom: number; shift: boolean }): { shaping: number } | null {
  const draft = draftOf();
  const nodes = draft?.path.nodes ?? [];
  if (nodes.length >= 3 && distance(pt, nodes[0]) * options.zoom <= CLOSE_RADIUS) {
    finishPen(true);
    return null;
  }
  const last = nodes[nodes.length - 1];
  if (last && distance(pt, last) * options.zoom <= SAME_SPOT) {
    finishPen(false);
    return null;
  }
  const at = options.shift && last ? constrainTo45(last, pt) : pt;
  const placed: PenNode = { x: at.x, y: at.y, handleIn: null, handleOut: null };
  useGesture.getState().set({ pen: { path: { nodes: [...nodes, placed], closed: false }, hover: null } });
  return { shaping: nodes.length };
}

/** The pointer moves with the button down: the point at `index` gets a handle on each side, pulled towards `pt`. */
export function penDrag(index: number, pt: Point, zoom: number): void {
  const draft = draftOf();
  const node = draft?.path.nodes[index];
  if (!draft || !node) return;
  const out = { x: pt.x - node.x, y: pt.y - node.y };
  const pulled = Math.hypot(out.x, out.y) * zoom >= DRAG_SLOP;
  const nodes = draft.path.nodes.map((n, i) => (i === index ? { ...n, handleOut: pulled ? out : null, handleIn: pulled ? { x: negate(out.x), y: negate(out.y) } : null } : n));
  useGesture.getState().set({ pen: { path: { ...draft.path, nodes }, hover: null } });
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
 * unless the path is being finished because another tool was chosen (`keepTool`).
 */
export function finishPen(closed = false, keepTool = false): void {
  const draft = draftOf();
  useGesture.getState().set({ pen: null });
  const design = useEditor.getState().design;
  if (!draft || !design || draft.path.nodes.length < 2) return;
  const path = closed ? closePath(draft.path) : draft.path;
  const stroke = getDrawStroke(design.width);
  const actions = getActions();
  if (!keepTool) actions.setTool("select");
  actions.addElement(createShape("path", newPathShape(path, { color: stroke.color, strokeWidth: stroke.width })), { center: false });
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
  useGesture.getState().set({ pen: { path: { ...draft.path, nodes }, hover: draft.hover } });
}

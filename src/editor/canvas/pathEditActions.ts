/**
 * What point editing does to the path, shared by the overlay (pointer), the keys and the toolbar. Every function works on the
 * path element that `usePathEdit` has open and writes its changes through `patchForPath`, which gives the element a box that
 * fits the new curve without moving anything on the page.
 */
import { closePath, deleteNodes, moveNodes, setNodeKind, type NodeKind, type PenPath } from "@/core/pen";
import { designToLocal, elementPath, patchForPath } from "@/core/penShape";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, useEditor, type UpdateOptions } from "@/core/store";
import type { ShapeElement } from "@/core/types";
import { stopPathEdit, usePathEdit } from "./pathEditStore";

/** The path element that is open for point editing, with its path in the pixels of its box. */
export function editedPath(): { el: ShapeElement; path: PenPath } | null {
  const id = usePathEdit.getState().id;
  const state = useEditor.getState();
  const page = id ? getActivePage(state) : null;
  const el = page && id ? findElement(page, id) : null;
  if (el?.type !== "shape") return null;
  const path = elementPath(el);
  return path ? { el, path } : null;
}

/** The selected points that exist in `path`. A component that subscribes to the selection hands in the list it got; everything else reads the store. */
export const selectedIn = (path: PenPath, selected: readonly number[] = usePathEdit.getState().selected): number[] => selected.filter((i) => i < path.nodes.length);

export function selectNodes(indices: readonly number[]): void {
  usePathEdit.setState({ selected: [...new Set(indices)].sort((a, b) => a - b) });
}

/** Puts `path` (the pixels of `el`'s own box) on the element. `el` is the element as it was before the change. */
export function applyPath(el: ShapeElement, path: PenPath, options?: UpdateOptions): void {
  const patch = patchForPath(el, path);
  getActions().updateElements(
    [el.id],
    (d) => {
      Object.assign(d, patch);
    },
    options,
  );
}

/** Takes the selected points away and joins their neighbours; the whole path goes when fewer than two points would be left. */
export function deleteSelectedNodes(): void {
  const edited = editedPath();
  if (!edited) return;
  const selected = selectedIn(edited.path);
  if (!selected.length) return;
  const next = deleteNodes(edited.path, selected);
  if (!next) {
    getActions().deleteElements([edited.el.id]);
    stopPathEdit();
    return;
  }
  applyPath(edited.el, next);
  selectNodes([]);
}

/** Moves the selected points by (dx, dy) on the page, whatever the turn and mirror of the element. */
export function nudgeSelectedNodes(dx: number, dy: number): void {
  const edited = editedPath();
  if (!edited) return;
  const selected = selectedIn(edited.path);
  if (!selected.length) return;
  const origin = designToLocal(edited.el, { x: 0, y: 0 });
  const target = designToLocal(edited.el, { x: dx, y: dy });
  applyPath(edited.el, moveNodes(edited.path, selected, target.x - origin.x, target.y - origin.y), { coalesce: `pathnudge:${edited.el.id}` });
}

export function setSelectedKind(kind: NodeKind): void {
  const edited = editedPath();
  if (!edited) return;
  const selected = selectedIn(edited.path);
  if (!selected.length) return;
  applyPath(
    edited.el,
    selected.reduce((path, index) => setNodeKind(path, index, kind), edited.path),
  );
}

/** Joins the last point of an open path to the first. */
export function closeEditedPath(): void {
  const edited = editedPath();
  if (!edited) return;
  const closed = closePath(edited.path);
  if (closed !== edited.path) applyPath(edited.el, closed);
}

/**
 * Selects the next (or previous) point; with nothing selected it starts at the first (or last). It stops at the ends and
 * says so (false), as the walk through the elements of a page does: the key then goes on to the toolbar of the points, and
 * the focus is never stuck on the canvas.
 */
export function cycleSelectedNode(step: 1 | -1): boolean {
  const edited = editedPath();
  if (!edited) return false;
  const count = edited.path.nodes.length;
  const selected = selectedIn(edited.path);
  const next = selected.length ? selected[selected.length - 1] + step : step > 0 ? 0 : count - 1;
  if (next < 0 || next >= count) return false;
  selectNodes([next]);
  return true;
}

/**
 * The keys of point editing: Delete takes the selected points away, the arrows move them, Tab walks through the points (and
 * after the last one, or before the first, is the browser's) and Enter is done. Returns true when the key was used (the
 * editor's own key handling then leaves it alone).
 */
export function pathEditKey(e: KeyboardEvent): boolean {
  if (!usePathEdit.getState().id) return false;
  const edited = editedPath();
  const hasSelection = !!edited && selectedIn(edited.path).length > 0;
  const key = e.key.toLowerCase();
  if (key === "delete" || key === "backspace") {
    deleteSelectedNodes();
    return true;
  }
  if (key === "enter") {
    stopPathEdit();
    return true;
  }
  if (key === "tab") return cycleSelectedNode(e.shiftKey ? -1 : 1);
  if (key.startsWith("arrow") && hasSelection) {
    const step = e.shiftKey ? 10 : 1;
    nudgeSelectedNodes(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
    return true;
  }
  return false;
}

/**
 * Combining shapes and turning shapes into paths, as actions of the editor. The geometry (src/core/combine.ts) is loaded the
 * first time it is needed, so these finish a moment after they were asked for, and whatever the person did in that moment wins:
 * a result that was worked out from shapes that have changed since is thrown away, and the person is told.
 */
import { createElement, type ComponentType } from "react";
import { combineShapes, combinedShape, makePath, shapeAsPath, shapesToCombine, type CombineOp } from "@/core/combine";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, pageOf, useEditor } from "@/core/store";
import type { DesignElement, ID, Page, ShapeElement } from "@/core/types";
import { m } from "@/i18n";
import { IconExclude, IconIntersect, IconSubtract, IconUnion, toast, type MenuEntry } from "@/ui";

const WAYS: Array<{ op: CombineOp; icon: ComponentType }> = [
  { op: "union", icon: IconUnion },
  { op: "subtract", icon: IconSubtract },
  { op: "intersect", icon: IconIntersect },
  { op: "exclude", icon: IconExclude },
];

/** True while the page still holds these very shapes: an element that was edited since is another object. */
function stillThere(pageId: ID, shapes: readonly DesignElement[]): boolean {
  const page = pageOf(useEditor.getState().design, pageId);
  return !!page && shapes.every((shape) => findElement(page, shape.id) === shape);
}

/**
 * The toolbar button that chose a combine is gone once the new shape is selected (a single shape has no Combine), and the focus
 * of an element that goes falls to the page. Put it on the canvas, where the keys of the editor work, unless the person has
 * moved it somewhere else in the meantime.
 */
export function keepFocusInEditor(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body) document.querySelector<HTMLElement>("[data-cf-workspace]")?.focus();
  });
}

/** The entries of the "Combine" menu. They are switched off unless `ids` are two or more shapes that can be combined. */
export function combineMenuItems(page: Page | null, ids: readonly ID[]): MenuEntry[] {
  const possible = !!page && !!shapesToCombine(page, ids);
  return WAYS.map(({ op, icon }) => ({
    id: `combine-${op}`,
    label: m.editor.combine.ways[op].label,
    hint: m.editor.combine.ways[op].hint,
    icon: createElement(icon),
    disabled: !possible,
    onSelect: () => void combineElements(op, ids),
  }));
}

/**
 * Replaces shapes of the open page with the one shape that combining them makes, in one step of undo. Resolves to whether
 * that happened; when it did not, the person is told why unless there was nothing to do in the first place.
 */
export async function combineElements(op: CombineOp, ids: readonly ID[]): Promise<boolean> {
  const page = getActivePage(useEditor.getState());
  const shapes = page && shapesToCombine(page, ids);
  if (!page || !shapes) return false;
  let geometry;
  try {
    geometry = await combineShapes(shapes, op);
  } catch {
    toast.error(m.editor.combine.failed);
    return false;
  }
  if (!stillThere(page.id, shapes)) {
    toast.info(m.editor.combine.changed);
    return false;
  }
  if (!geometry) {
    toast.info(m.editor.combine.nothingLeft[op]);
    return false;
  }
  const id = getActions().replaceElements(
    shapes.map((shape) => shape.id),
    combinedShape(shapes[0], geometry),
    page.id,
  );
  if (id) keepFocusInEditor();
  return id !== "";
}

const convertible = (el: DesignElement | null): el is ShapeElement => el?.type === "shape" && el.shape !== "path" && !el.locked && !el.hidden;

const convertibleShapes = (page: Page, ids: readonly ID[]): ShapeElement[] => [...new Set(ids)].map((id) => findElement(page, id)).filter(convertible);

/** Whether any of `ids` is a shape that "Convert to path" can work on: not a path already, and not locked. */
export const canConvertToPath = (page: Page | null, ids: readonly ID[]): boolean => !!page && convertibleShapes(page, ids).length > 0;

/**
 * Writes the shapes among `ids` that are not paths yet as paths, where they are, in one step of undo, so that their points
 * can be edited. Resolves to whether any shape was converted.
 */
export async function convertToPath(ids: readonly ID[]): Promise<boolean> {
  const page = getActivePage(useEditor.getState());
  const shapes = page ? convertibleShapes(page, ids) : [];
  if (!page || !shapes.length) return false;
  let paths;
  try {
    paths = await Promise.all(shapes.map((shape) => shapeAsPath(shape)));
  } catch {
    toast.error(m.editor.combine.pathFailed);
    return false;
  }
  if (!stillThere(page.id, shapes)) {
    toast.info(m.editor.combine.changed);
    return false;
  }
  const made = new Map(shapes.flatMap((shape, i) => (paths[i] ? [[shape.id, paths[i]] as const] : [])));
  if (!made.size) {
    toast.info(m.editor.combine.noOutline);
    return false;
  }
  // the ids are those of the shapes that were converted, so every element the recipe meets is one of them
  getActions().updateElementsOnPage(page.id, [...made.keys()], (el) => makePath(el as ShapeElement, made.get(el.id) as string));
  return true;
}

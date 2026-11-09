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
import { IconExclude, IconIntersect, IconSubtract, IconUnion, toast, type MenuEntry } from "@/ui";

const WAYS: Array<{ op: CombineOp; label: string; hint: string; icon: ComponentType }> = [
  { op: "union", label: "Union", hint: "Join into one", icon: IconUnion },
  { op: "subtract", label: "Subtract", hint: "Cut out the front", icon: IconSubtract },
  { op: "intersect", label: "Intersect", hint: "Keep the overlap", icon: IconIntersect },
  { op: "exclude", label: "Exclude", hint: "Remove the overlap", icon: IconExclude },
];

const NOTHING_LEFT: Record<CombineOp, string> = {
  union: "These shapes have no outline to join.",
  subtract: "Nothing is left of the shape behind once the others are cut out of it.",
  intersect: "These shapes do not overlap, so there is nothing to keep.",
  exclude: "Nothing is left: the shapes cover exactly the same area.",
};

const CHANGED = "The shapes changed in the meantime, so nothing was changed.";

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
function keepFocusInEditor(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body) document.querySelector<HTMLElement>("[data-cf-workspace]")?.focus();
  });
}

/** The entries of the "Combine" menu. They are switched off unless `ids` are two or more shapes that can be combined. */
export function combineMenuItems(page: Page | null, ids: readonly ID[]): MenuEntry[] {
  const possible = !!page && !!shapesToCombine(page, ids);
  return WAYS.map(({ op, label, hint, icon }) => ({
    id: `combine-${op}`,
    label,
    hint,
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
    toast.error("The shapes could not be combined. Check your connection and try again.");
    return false;
  }
  if (!stillThere(page.id, shapes)) {
    toast.info(CHANGED);
    return false;
  }
  if (!geometry) {
    toast.info(NOTHING_LEFT[op]);
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
    toast.error("The shapes could not be converted to paths. Check your connection and try again.");
    return false;
  }
  if (!stillThere(page.id, shapes)) {
    toast.info(CHANGED);
    return false;
  }
  const made = new Map(shapes.flatMap((shape, i) => (paths[i] ? [[shape.id, paths[i]] as const] : [])));
  if (!made.size) {
    toast.info("These shapes have no outline to convert.");
    return false;
  }
  // the ids are those of the shapes that were converted, so every element the recipe meets is one of them
  getActions().updateElementsOnPage(page.id, [...made.keys()], (el) => makePath(el as ShapeElement, made.get(el.id) as string));
  return true;
}

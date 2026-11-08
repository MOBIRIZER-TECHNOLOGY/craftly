/**
 * What connects a path made of points (src/core/pen.ts) to a shape element: the path of an element lives in the 0..100 space
 * of its box, and the box may be turned and mirrored, so a change to the points has to give the element a new box without
 * moving anything on the page.
 */
import { denormalizePath, normalizePath, parsePath, type PenPath } from "./pen";
import { fromLocalPoint, toLocalPoint } from "./geometry";
import type { Fill, Point, ShapeElement, Stroke } from "./types";

/** The part of an element that places it on the page. */
export interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
}

/** A point of the element's own box (origin at the top-left of the unturned box, before the mirror) as a point of the page. */
export function localToDesign(el: PlacedBox, p: Point): Point {
  return fromLocalPoint(el, { x: el.flipH ? el.width - p.x : p.x, y: el.flipV ? el.height - p.y : p.y });
}

/** The other way: a point of the page as a point of the element's own box. */
export function designToLocal(el: PlacedBox, p: Point): Point {
  const local = toLocalPoint(el, p);
  return { x: el.flipH ? el.width - local.x : local.x, y: el.flipV ? el.height - local.y : local.y };
}

/** The path of a shape in the pixels of its box, or null when it is not a path that can be edited point by point. */
export function elementPath(el: Pick<ShapeElement, "shape" | "path" | "width" | "height">): PenPath | null {
  if (el.shape !== "path" || !el.path) return null;
  const path = parsePath(el.path);
  return path ? denormalizePath(path, el.width, el.height) : null;
}

/**
 * The fields that make `path` (in the pixels of the element's own box) the path of the element: a new box that fits the
 * curve, and the path data in it. The box moves so that every point stays exactly where it is on the page, however the
 * element is turned or mirrored.
 */
export function patchForPath(el: PlacedBox, path: PenPath): Pick<ShapeElement, "x" | "y" | "width" | "height" | "path"> {
  const { d, box } = normalizePath(path);
  const centre = localToDesign(el, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
  return { x: centre.x - box.w / 2, y: centre.y - box.h / 2, width: box.w, height: box.h, path: d };
}

/**
 * A new path element from points on the page: an open path is a stroke, a closed one is filled with the same colour and has
 * no outline.
 */
export function newPathShape(
  path: PenPath,
  style: { color: string; strokeWidth: number },
): Pick<ShapeElement, "x" | "y" | "width" | "height"> & { path: string; fill: Fill | null; stroke: Stroke | null } {
  const { d, box } = normalizePath(path);
  return {
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    path: d,
    fill: path.closed ? { type: "solid", color: style.color } : null,
    stroke: path.closed ? null : { color: style.color, width: style.strokeWidth, style: "solid", cap: "round", join: "round" },
  };
}

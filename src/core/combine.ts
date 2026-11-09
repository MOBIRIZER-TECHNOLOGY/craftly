/**
 * Combining shapes (union, subtract, intersect, exclude) and turning a shape into a path. paper.js does the geometry on Bezier
 * outlines; it is loaded on first use, in a chunk of its own, so the editor does not carry it until somebody combines shapes.
 * A result is described the way a path element stores it: a box on the page and the path data in that box's 0..100 space
 * (src/core/penShape.ts), so a result is an ordinary shape, drawn and exported like any other.
 */
import { shapeFillRule, shapePathData } from "@/render/shapePaths";
import { fitPaths, inBoxSpace, pathToString, type PenNode, type PenPath } from "./pen";
import type { ID, Page, Point, ShapeElement } from "./types";

export type CombineOp = "union" | "subtract" | "intersect" | "exclude";

/** The box on the page and the path data (in the box's own 0..100 space) of a path element. */
export interface PathGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  path: string;
}

type Scope = paper.PaperScope;

let loading: Promise<Scope> | null = null;

/** The typings of a project ask for a canvas; the library does not need one, and the boolean operations have nothing to draw. */
type ViewlessProject = new () => paper.Project;

/** One paper scope for the whole page, with a project that has no view. A load that failed is tried again the next time. */
export function paperScope(): Promise<Scope> {
  loading ??= import("paper/dist/paper-core")
    .then((module) => {
      const core = module.default;
      const scope = new core.PaperScope();
      scope.project = new (scope.Project as unknown as ViewlessProject)();
      return scope;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** The outline of a shape in its own box (pixels from the box's top left corner), or null when it has none. */
function outlineOf(scope: Scope, shape: ShapeElement): paper.CompoundPath | null {
  const d = shapePathData(shape.shape, shape.width, shape.height, { radius: shape.radius, params: shape.params, path: shape.path });
  if (!d) return null;
  const rule = shapeFillRule(shape.shape);
  const outline = new scope.CompoundPath({ pathData: d, fillRule: rule, insert: false });
  // A hole that only the even-odd rule makes, because its piece runs the same way round as the one it is in, would be filled by
  // the non-zero rule that a stored path is drawn with: the pieces are turned so that both rules leave the same hole. (The
  // other way, reorient(true, ...), resolves the pieces by the non-zero rule and so takes such a hole away.) What the
  // boolean operations give back is already turned the right way round.
  if (rule === "evenodd") outline.reorient(false, true);
  return outline.isEmpty() ? null : outline;
}

/** Moves an outline from the box of its shape to the page: mirrored and turned about the centre of the box, then put in place. */
function placeOnPage(scope: Scope, outline: paper.CompoundPath, shape: ShapeElement): void {
  const centre = new scope.Point(shape.width / 2, shape.height / 2);
  if (shape.flipH || shape.flipV) outline.scale(shape.flipH ? -1 : 1, shape.flipV ? -1 : 1, centre);
  if (shape.rotation) outline.rotate(shape.rotation, centre);
  outline.translate(new scope.Point(shape.x, shape.y));
}

/** A handle that is not there, or is no longer than the arithmetic of the turn left behind, is no handle. */
const handleOf = (offset: paper.Point): Point | null => (Math.hypot(offset.x, offset.y) < 1e-6 ? null : { x: offset.x, y: offset.y });

/** The pieces of an outline as paths of points and handles. A piece with no area (nothing left of it) is not one. */
function piecesOf(outline: paper.PathItem): PenPath[] {
  const parts = outline.className === "CompoundPath" ? ((outline as paper.CompoundPath).children as paper.Path[]) : [outline as paper.Path];
  return parts
    .filter((part) => Math.abs(part.area) > 1e-6)
    .map((part) => ({
      closed: part.closed,
      nodes: part.segments.map((s): PenNode => ({ x: s.point.x, y: s.point.y, handleIn: handleOf(s.handleIn), handleOut: handleOf(s.handleOut) })),
    }));
}

const OPERATIONS = { union: "unite", subtract: "subtract", intersect: "intersect", exclude: "exclude" } as const;

/**
 * Combines shapes given from the back to the front of the page. The first one is the shape that the others are taken from,
 * with `subtract` (what is left of it when all the others are cut out), and the others are added, kept or removed in turn
 * for the other operations. Null when fewer than two of them have an outline, or when nothing is left.
 */
export async function combineShapes(shapes: readonly ShapeElement[], op: CombineOp): Promise<PathGeometry | null> {
  const scope = await paperScope();
  const outlines = shapes.flatMap((shape) => {
    const outline = outlineOf(scope, shape);
    if (outline) placeOnPage(scope, outline, shape);
    return outline ? [outline] : [];
  });
  if (outlines.length < 2) return null;
  let result: paper.PathItem = outlines[0];
  for (const next of outlines.slice(1)) result = result[OPERATIONS[op]](next, { insert: false });
  const pieces = piecesOf(result);
  if (!pieces.length) return null;
  const { d, box } = fitPaths(pieces);
  return { x: box.x, y: box.y, width: box.w, height: box.h, path: d };
}

/**
 * The outline of a shape as path data in the 0..100 space of its own box, so that the shape can become a path without its
 * box, turn or mirror changing. A path is a path already. Null for a shape that has no outline.
 */
export async function shapeAsPath(shape: ShapeElement): Promise<string | null> {
  if (shape.shape === "path") return shape.path ?? null;
  const outline = outlineOf(await paperScope(), shape);
  if (!outline) return null;
  const pieces = piecesOf(outline);
  return pieces.length ? pieces.map((piece) => pathToString(inBoxSpace(piece, shape.width, shape.height))).join(" ") : null;
}

/**
 * The shapes that combining works on, from the back to the front of the page. Every one of `ids` has to be a shape on the page
 * itself (not inside a group) that is shown and not locked, and there have to be at least two; otherwise null.
 */
export function shapesToCombine(page: Page, ids: readonly ID[]): ShapeElement[] | null {
  const wanted = new Set(ids);
  if (wanted.size < 2) return null;
  const shapes = page.elements.filter((e): e is ShapeElement => wanted.has(e.id) && e.type === "shape" && !e.hidden && !e.locked);
  return shapes.length === wanted.size ? shapes : null;
}

/**
 * The shape that takes the place of combined ones: the look of the one at the back (fill, border, effects, link ...) with the
 * box and outline of the result. The result is a new shape, so it keeps no name, and it is neither turned nor mirrored: the
 * outline is already where it should be on the page.
 */
export function combinedShape(base: ShapeElement, geometry: PathGeometry): ShapeElement {
  const { name: _name, params: _params, flipH: _flipH, flipV: _flipV, ...look } = base;
  return { ...look, shape: "path", path: geometry.path, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: 0, radius: 0 };
}

/**
 * Turns a shape into a path, in place (a plain shape or an immer draft): the box, turn, mirror and look stay, only the outline is
 * now its own. `path` comes from `shapeAsPath`.
 */
export function makePath(shape: ShapeElement, path: string): void {
  shape.shape = "path";
  shape.path = path;
  shape.radius = 0;
  delete shape.params;
}

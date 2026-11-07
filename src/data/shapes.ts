/**
 * Presets for the Elements panel: shapes, lines, frames and photo grids.
 * Geometry itself lives in render/shapePaths.ts.
 */
import { createFrame, createLine, createShape, solid } from "@/core/factory";
import type { ArrowKind, DesignElement, ImageElement, ShapeElement, Stroke } from "@/core/types";
import { SHAPES, type ShapeGroup } from "@/render/shapePaths";

export const SHAPE_GROUP_LABELS: Record<ShapeGroup, string> = {
  basic: "Basic shapes",
  polygons: "Polygons",
  stars: "Stars & badges",
  arrows: "Arrows",
  symbols: "Symbols",
  bubbles: "Speech bubbles",
  blobs: "Blobs",
};

export interface ShapePreset {
  id: string;
  name: string;
  group: ShapeGroup;
  /** words people look for that the name, group and id do not contain ("rectangle" for the square) */
  keywords?: string;
  /** how the panel draws the thumbnail when it is not simply the shape named by `id` */
  preview?: { kind: string; aspect?: number; radiusRatio?: number };
  /** builds a ready to insert element, sized relative to the page */
  create(pageMin: number): ShapeElement;
}

/** Size of a new shape: wide ones get a little more width than the square ones, so they weigh about the same on the page. */
function sizeFor(pageMin: number, aspect: number): { width: number; height: number } {
  const base = Math.round(pageMin * 0.22);
  const width = aspect >= 1 ? Math.round(base * Math.min(aspect, 1.8) * 0.9 + base * 0.1) : base;
  return { width, height: Math.round(width / aspect) };
}

const SHAPE_KEYWORDS: Record<string, string> = { rect: "rectangle box", ellipse: "round disc dot" };

export const SHAPE_PRESETS: ShapePreset[] = SHAPES.map((def) => ({
  id: def.id,
  name: def.name,
  group: def.group,
  keywords: SHAPE_KEYWORDS[def.id],
  create(pageMin) {
    return createShape(def.id, { ...sizeFor(pageMin, def.aspect ?? 1), fill: solid("#0e1318"), params: def.params ? ({ ...def.params } as Record<string, number>) : undefined });
  },
}));

export const ROUNDED_RECT_PRESET: ShapePreset = {
  id: "rounded-rect",
  name: "Rounded square",
  group: "basic",
  keywords: "rounded rectangle",
  preview: { kind: "rect", radiusRatio: 0.22 },
  create(pageMin) {
    const s = Math.round(pageMin * 0.22);
    return createShape("rect", { width: s, height: s, radius: Math.round(s * 0.2), fill: solid("#0e1318") });
  },
};

/** Width over height of the Ellipse entry (the Circle entry is square). */
export const ELLIPSE_ASPECT = 1.5;

/** The Circle drawing, wider than tall: it is the same shape kind, listed under its own name so that an ellipse can be found. */
export const ELLIPSE_PRESET: ShapePreset = {
  id: "oval",
  name: "Ellipse",
  group: "basic",
  keywords: "oval elliptical",
  preview: { kind: "ellipse", aspect: ELLIPSE_ASPECT },
  create(pageMin) {
    return createShape("ellipse", { ...sizeFor(pageMin, ELLIPSE_ASPECT), fill: solid("#0e1318") });
  },
};

/* ---------------- lines ---------------- */

export interface LinePreset {
  id: string;
  name: string;
  stroke: Pick<Stroke, "style" | "cap">;
  start: ArrowKind;
  end: ArrowKind;
}

export const LINE_PRESETS: LinePreset[] = [
  { id: "line", name: "Line", stroke: { style: "solid", cap: "round" }, start: "none", end: "none" },
  { id: "line-dashed", name: "Dashed line", stroke: { style: "dashed", cap: "butt" }, start: "none", end: "none" },
  { id: "line-dotted", name: "Dotted line", stroke: { style: "dotted", cap: "round" }, start: "none", end: "none" },
  { id: "arrow", name: "Arrow", stroke: { style: "solid", cap: "round" }, start: "none", end: "arrow" },
  { id: "arrow-open", name: "Open arrow", stroke: { style: "solid", cap: "round" }, start: "none", end: "open-arrow" },
  { id: "arrow-double", name: "Double arrow", stroke: { style: "solid", cap: "round" }, start: "arrow", end: "arrow" },
  { id: "line-dot-end", name: "Dot end", stroke: { style: "solid", cap: "round" }, start: "circle", end: "circle" },
  { id: "arrow-dashed", name: "Dashed arrow", stroke: { style: "dashed", cap: "butt" }, start: "none", end: "arrow" },
];

export function createLineFromPreset(p: LinePreset, pageMin: number): DesignElement {
  return createLine({ width: Math.round(pageMin * 0.3), stroke: { color: "#0e1318", width: Math.max(4, Math.round(pageMin * 0.006)), ...p.stroke }, startArrow: p.start, endArrow: p.end });
}

/* ---------------- frames ---------------- */

export interface FramePreset {
  id: string;
  name: string;
  mask: string;
  /** width / height */
  aspect: number;
  radius?: number;
}

export const FRAME_PRESETS: FramePreset[] = [
  { id: "frame-square", name: "Square frame", mask: "rect", aspect: 1 },
  { id: "frame-rounded", name: "Rounded frame", mask: "rect", aspect: 1, radius: 60 },
  { id: "frame-circle", name: "Circle frame", mask: "ellipse", aspect: 1 },
  { id: "frame-arch", name: "Arch frame", mask: "arch", aspect: 0.7 },
  { id: "frame-heart", name: "Heart frame", mask: "heart", aspect: 1.1 },
  { id: "frame-star", name: "Star frame", mask: "star", aspect: 1 },
  { id: "frame-hexagon", name: "Hexagon frame", mask: "hexagon", aspect: 1.15 },
  { id: "frame-scallop", name: "Scallop frame", mask: "scallop", aspect: 1 },
  { id: "frame-flower", name: "Flower frame", mask: "flower", aspect: 1 },
  { id: "frame-diamond", name: "Diamond frame", mask: "diamond", aspect: 1 },
  { id: "frame-cut", name: "Cut corner frame", mask: "cut-corner", aspect: 1 },
  { id: "frame-tag", name: "Tag frame", mask: "tag", aspect: 1.7 },
  { id: "frame-blob-1", name: "Blob frame 1", mask: "blob-1", aspect: 1 },
  { id: "frame-blob-2", name: "Blob frame 2", mask: "blob-2", aspect: 1 },
  { id: "frame-blob-3", name: "Blob frame 3", mask: "blob-3", aspect: 1 },
  { id: "frame-blob-4", name: "Blob frame 4", mask: "blob-4", aspect: 1 },
  { id: "frame-cloud", name: "Cloud frame", mask: "cloud", aspect: 1.6 },
  { id: "frame-speech", name: "Speech frame", mask: "speech", aspect: 1.35 },
];

export function createFrameFromPreset(p: FramePreset, pageMin: number): ImageElement {
  const base = Math.round(pageMin * 0.4);
  const width = p.aspect >= 1 ? Math.round(base * Math.min(p.aspect, 1.5)) : Math.round(base * p.aspect);
  return createFrame(p.mask, { width, height: Math.round(width / p.aspect), radius: p.radius ?? 0 });
}

/* ---------------- photo grids ---------------- */

export interface GridPreset {
  id: string;
  name: string;
  /** cells as fractions of the grid box: [x, y, w, h] */
  cells: Array<[number, number, number, number]>;
}

const g = (cols: number, rows: number): GridPreset["cells"] => {
  const out: GridPreset["cells"] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c / cols, r / rows, 1 / cols, 1 / rows]);
  return out;
};

export const GRID_PRESETS: GridPreset[] = [
  { id: "grid-2", name: "Two columns", cells: g(2, 1) },
  { id: "grid-2x2", name: "Four squares", cells: g(2, 2) },
  { id: "grid-3", name: "Three columns", cells: g(3, 1) },
  { id: "grid-3x2", name: "Six photos", cells: g(3, 2) },
  { id: "grid-1-2", name: "One big, two small", cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: "grid-2-1", name: "Two small, one wide", cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1, 0.5]] },
  { id: "grid-hero", name: "Hero and strip", cells: [[0, 0, 1, 0.68], [0, 0.68, 1 / 3, 0.32], [1 / 3, 0.68, 1 / 3, 0.32], [2 / 3, 0.68, 1 / 3, 0.32]] },
  { id: "grid-mosaic", name: "Mosaic", cells: [[0, 0, 0.4, 0.6], [0.4, 0, 0.6, 0.35], [0.4, 0.35, 0.3, 0.65], [0.7, 0.35, 0.3, 0.65], [0, 0.6, 0.4, 0.4]] },
];

/** Frames for each grid cell with a small gutter, positioned inside `box` (design px). */
export function createGridFrames(preset: GridPreset, box: { x: number; y: number; w: number; h: number }, gap = 10): ImageElement[] {
  return preset.cells.map(([x, y, w, h]) =>
    createFrame("rect", {
      x: box.x + x * box.w + gap / 2,
      y: box.y + y * box.h + gap / 2,
      width: Math.max(8, w * box.w - gap),
      height: Math.max(8, h * box.h - gap),
    }),
  );
}

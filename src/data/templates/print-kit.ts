/**
 * Shared authoring helpers for the print templates (print-*.ts). Thin wrappers over the DSL in
 * dsl.ts: library illustrations by id, photos with a real aspect ratio and focal point, hairline
 * rules and frames, a font-bound text writer and a few ornament builders.
 */
import { createGroup, createTable, defaultFilter } from "@/core/factory";
import type { Color, DesignElement, GraphicElement, GroupElement, ImageElement, ImageFilter, LinearGradientFill, TableElement } from "@/core/types";
import { getGraphic } from "@/data/graphics";
import { getPhotoDef } from "@/data/photos";
import { G, L, P, R, S, T, type ShapeOpts, type TextOpts } from "./dsl";

/* ---------------- illustrations ---------------- */

/** viewBox width / height of a library graphic (1 when unknown). */
function ratioOf(svg: string): number {
  const m = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1;
}

const invisible = (x: number, y: number, w: number, h: number): DesignElement => S("rect", x, y, w, h, null);

/** Library illustration with explicit box. Unknown ids degrade to an invisible box, never an error. */
export function gx(id: string, x: number, y: number, w: number, h: number, opts: Partial<GraphicElement> = {}): DesignElement {
  const def = getGraphic(id);
  return def ? G(def.svg, x, y, w, h, { source: { kind: "illustration", id }, ...opts }) : invisible(x, y, w, h);
}

/** Library illustration by width; height follows the artwork's aspect ratio. */
export function gxw(id: string, x: number, y: number, w: number, opts: Partial<GraphicElement> = {}): DesignElement {
  const def = getGraphic(id);
  return def ? gx(id, x, y, w, Math.round(w / ratioOf(def.svg)), opts) : invisible(x, y, w, w);
}

/** Library illustration by width that stands on a baseline: its bottom edge sits on `baseY`. */
export function gxb(id: string, x: number, baseY: number, w: number, opts: Partial<GraphicElement> = {}): DesignElement {
  const def = getGraphic(id);
  const h = def ? Math.round(w / ratioOf(def.svg)) : w;
  return def ? gx(id, x, baseY - h, w, h, opts) : invisible(x, baseY - h, w, h);
}

/* ---------------- groups and tables ---------------- */

/**
 * Elements a person would move as one (a mark, a row of bars, a pattern of tiles), given in page
 * coordinates. Only for elements that are not rotated and whose size is known here: shapes, graphics, photos.
 */
export function group(name: string, children: DesignElement[]): GroupElement {
  const x = Math.min(...children.map((c) => c.x));
  const y = Math.min(...children.map((c) => c.y));
  const right = Math.max(...children.map((c) => c.x + c.width));
  const bottom = Math.max(...children.map((c) => c.y + c.height));
  for (const c of children) {
    c.x -= x;
    c.y -= y;
  }
  return createGroup(children, { name, x, y, width: right - x, height: bottom - y });
}

/** Table with a header row: column widths, one row height, and the cells row by row. */
export function table(x: number, y: number, colWidths: number[], rowHeight: number, cells: string[][], opts: Partial<TableElement> = {}): TableElement {
  const width = colWidths.reduce((a, b) => a + b, 0);
  return createTable({ x, y, width, height: rowHeight * cells.length, colWidths, rowHeights: cells.map(() => rowHeight), cells, headerRow: true, ...opts });
}

/* ---------------- photos ---------------- */

export interface PhotoOpts extends Partial<ImageElement> {
  /** focal point 0..1 inside the source picture (default centre) */
  fx?: number;
  fy?: number;
  /** extra zoom >= 1 */
  zoom?: number;
  /** two-tone grade, dark -> light */
  duo?: [Color, Color];
  /** quick filter tweaks */
  tune?: Partial<ImageFilter>;
}

/** Procedural photo cover-fitted into the box with the picture's true aspect ratio and a focal point. */
export function ph(id: string, x: number, y: number, w: number, h: number, o: PhotoOpts = {}): ImageElement {
  const { fx = 0.5, fy = 0.5, zoom = 1, duo, tune, ...rest } = o;
  const def = getPhotoDef(id);
  const nw = def?.width ?? 1600;
  const nh = def?.height ?? 1067;
  const s = Math.max(w / nw, h / nh) * zoom;
  const iw = (nw * s) / w;
  const ih = (nh * s) / h;
  const filter: ImageFilter = { ...defaultFilter(), ...(duo ? { duotone: { dark: duo[0], light: duo[1] } } : {}), ...tune };
  return P(id, x, y, w, h, {
    naturalWidth: nw,
    naturalHeight: nh,
    crop: { x: -(iw - 1) * fx, y: -(ih - 1) * fy, w: iw, h: ih },
    filter,
    ...rest,
  });
}

/* ---------------- shapes and rules ---------------- */

/** Hairline horizontal rule drawn as a rectangle (crisp at any scale). */
export const hr = (x: number, y: number, w: number, color: Color, t = 1.5, opts: ShapeOpts = {}) => R(x, y, w, t, color, opts);
/** Hairline vertical rule. */
export const vr = (x: number, y: number, h: number, color: Color, t = 1.5, opts: ShapeOpts = {}) => R(x, y, t, h, color, opts);

/** Outline rectangle (no fill) whose stroke sits on the inside of the given box. */
export function frame(x: number, y: number, w: number, h: number, color: Color, t = 2, opts: ShapeOpts = {}) {
  return S("rect", x + t / 2, y + t / 2, w - t, h - t, null, { stroke: { color, width: t, style: "solid", join: "miter" }, ...opts });
}

/** Outline circle by centre and outer radius (the stroke sits on the inside of r). Used over empty photo frames. */
export function ring(cx: number, cy: number, r: number, color: Color, t = 2, opts: ShapeOpts = {}) {
  return S("ellipse", cx - r + t / 2, cy - r + t / 2, (r - t / 2) * 2, (r - t / 2) * 2, null, { stroke: { color, width: t, style: "solid" }, ...opts });
}

/** Diamond ornament centred on (cx, cy). */
export const diamond = (cx: number, cy: number, r: number, color: Color, opts: ShapeOpts = {}) => S("diamond", cx - r, cy - r, r * 2, r * 2, color, opts);

/** Linear gradient from evenly spaced stops; rgba() stops give fades into the page colour. */
export function fade(angle: number, ...stops: Color[]): LinearGradientFill {
  return { type: "linear", angle, stops: stops.map((color, i) => ({ offset: stops.length === 1 ? 0 : i / (stops.length - 1), color })) };
}

/* ---------------- text ---------------- */

/** Text writer bound to a font family (and optional defaults), used as `const sans = font("Inter", {...})`. */
export function font(family: string, base: TextOpts = {}) {
  return (text: string, x: number, y: number, w: number, size: number, o: TextOpts = {}) => T(text, x, y, w, size, { fontFamily: family, ...base, ...o });
}

/**
 * Rough height of wrapped text (greedy word wrap on an average glyph width), used to stack blocks while
 * authoring. The dev contact sheet reports the measured heights, so any drift is caught and corrected.
 */
export function est(text: string, width: number, size: number, lineHeight = 1.5, em = 0.5): number {
  const cpl = Math.max(4, Math.floor(width / (size * em)));
  let lines = 0;
  for (const para of text.split("\n")) {
    let cur = 0;
    let n = 1;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (cur === 0) cur = word.length;
      else if (cur + 1 + word.length <= cpl) cur += 1 + word.length;
      else {
        n += 1;
        cur = word.length;
      }
    }
    lines += n;
  }
  return Math.ceil(lines * size * lineHeight);
}

/** Dotted leader line between a menu item and its price. */
export function leader(x1: number, x2: number, y: number, color: Color, t = 1.6): DesignElement {
  return L(x1, y, Math.max(x1, x2), y, color, t, { stroke: { color, width: t, style: "dotted", cap: "round" } });
}

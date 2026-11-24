/**
 * Pure geometry edits behind the Position panel's Advanced fields. Every function MUTATES the element it
 * is given (the store hands them immer drafts; tests hand them clones).
 *
 * Conventions: X / Y are the top-left of the axis-aligned bounds of the selection. For a single element
 * Width / Height are the element's own box (what the selection frame shows); for several elements they are
 * the bounds of the whole selection and edits scale every element about its top-left corner.
 */
import { boundsOfElements, boxCenter, clamp, rotatePoint } from "@/core/geometry";
import * as ops from "@/core/ops";
import type { DesignElement, ID, ImageElement, Page, TextElement, VideoElement } from "@/core/types";

export const MIN_SIZE = 1;
export const MIN_TEXT_WIDTH = 24;

/** The selection reduced to its top-level elements (a group and its child are not both moved). */
export function topElements(page: Page, ids: ID[]): DesignElement[] {
  return ops
    .topLevelIds(page, ids)
    .map((id) => ops.findElement(page, id))
    .filter((e): e is DesignElement => !!e);
}

export interface PositionModel {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** exactly one element is selected */
  single: boolean;
  /** Height cannot be typed: text height follows the layout, lines have no height */
  heightReadOnly: boolean;
  /** every selected element is locked */
  allLocked: boolean;
}

export function describePosition(tops: DesignElement[]): PositionModel | null {
  const b = boundsOfElements(tops);
  if (!b) return null;
  const allLocked = tops.every((e) => e.locked);
  if (tops.length === 1) {
    const el = tops[0];
    return {
      x: b.x,
      y: b.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation,
      single: true,
      heightReadOnly: el.type === "text" || el.type === "line",
      allLocked,
    };
  }
  return { x: b.x, y: b.y, width: b.w, height: b.h, rotation: 0, single: false, heightReadOnly: false, allLocked };
}

export const normalizeRotation = (deg: number) => ((deg % 360) + 360) % 360;

/** Should the aspect ratio lock start on for this selection? Photos, clips, graphics, groups and multi-selections keep their shape. */
export function defaultRatioLock(els: DesignElement[]): boolean {
  if (els.length !== 1) return true;
  const t = els[0].type;
  return t === "image" || t === "video" || t === "graphic" || t === "group";
}

/* ------------------------------------------------------------------ */
/* moving                                                              */
/* ------------------------------------------------------------------ */

export function translate(el: DesignElement, dx: number, dy: number): void {
  el.x += dx;
  el.y += dy;
}

/* ------------------------------------------------------------------ */
/* resizing a single element                                           */
/* ------------------------------------------------------------------ */

/** Keeps the visual position: an unrotated box stays pinned by its top-left corner, a rotated one by its centre. */
function reanchor(el: DesignElement, ow: number, oh: number): void {
  if (!el.rotation) return;
  el.x += (ow - el.width) / 2;
  el.y += (oh - el.height) / 2;
}

function resizeText(el: TextElement, nw: number, lock: boolean): void {
  const width = Math.max(MIN_TEXT_WIDTH, nw);
  if (lock) {
    // like dragging a corner handle: the type scales with the box
    const s = width / Math.max(1, el.width);
    el.fontSize *= s;
    for (const p of el.paragraphs) for (const r of p.runs) if (r.size) r.size *= s;
    el.width = width;
  } else {
    el.autoWidth = false;
    el.width = width;
  }
}

/** A picture, or a clip, which is framed the same way. */
function resizeImage(el: ImageElement | VideoElement, nw: number, nh: number, lock: boolean): void {
  const ow = el.width;
  const oh = el.height;
  if (lock || !el.src) {
    el.radius *= (nw / Math.max(MIN_SIZE, ow) + nh / Math.max(MIN_SIZE, oh)) / 2;
    el.width = nw;
    el.height = nh;
    return;
  }
  // Without the ratio lock the frame moves over the picture (like the side handles): the picture keeps its size and
  // position; if it can no longer cover the frame it is zoomed just enough.
  let iw = el.crop.w * ow;
  let ih = el.crop.h * oh;
  let ix = el.crop.x * ow;
  let iy = el.crop.y * oh;
  const k = Math.max(nw / iw, nh / ih);
  if (k > 1) {
    iw *= k;
    ih *= k;
  }
  ix = clamp(ix, nw - iw, 0);
  iy = clamp(iy, nh - ih, 0);
  el.width = nw;
  el.height = nh;
  el.crop = { x: ix / nw, y: iy / nh, w: iw / nw, h: ih / nh };
}

/**
 * Sets the size of one element. `nh` is ignored for text (height is derived) and lines (height 0).
 * With `lock` the caller passes `nh` already scaled to the old ratio; text then scales its type size.
 */
export function resizeSingle(el: DesignElement, nw: number, nh: number, lock: boolean): void {
  const ow = el.width;
  const oh = el.height;
  const w = Math.max(MIN_SIZE, nw);
  const h = Math.max(MIN_SIZE, nh);
  // never divide by a degenerate old size
  const sx = w / Math.max(MIN_SIZE, ow);
  const sy = h / Math.max(MIN_SIZE, oh);
  switch (el.type) {
    case "text":
      resizeText(el, w, lock);
      return;
    case "line":
      el.width = w;
      break;
    case "image":
    case "video":
      resizeImage(el, w, h, lock);
      break;
    case "shape":
      el.radius *= Math.min(sx, sy);
      el.width = w;
      el.height = h;
      break;
    case "group":
      for (const c of el.children) ops.scaleElement(c, sx, sy);
      el.width = w;
      el.height = h;
      break;
    case "table":
      el.colWidths = el.colWidths.map((cw) => cw * sx);
      el.rowHeights = el.rowHeights.map((rh) => rh * sy);
      el.width = w;
      el.height = h;
      break;
    default:
      el.width = w;
      el.height = h;
  }
  reanchor(el, ow, oh);
}

/* ------------------------------------------------------------------ */
/* several elements                                                    */
/* ------------------------------------------------------------------ */

/** Scales an element (geometry and size-dependent style) about the point (ax, ay) of its parent space. */
export function scaleAbout(el: DesignElement, sx: number, sy: number, ax: number, ay: number): void {
  el.x -= ax;
  el.y -= ay;
  ops.scaleElement(el, sx, sy);
  el.x += ax;
  el.y += ay;
}

/** Rotates the original elements (snapshots) by `delta` degrees about the centre of their union, writing onto `el`. */
export function rotateFromSnapshot(el: DesignElement, orig: DesignElement, centre: { x: number; y: number }, delta: number): void {
  const c = rotatePoint(boxCenter(orig), centre, delta);
  el.x = c.x - orig.width / 2;
  el.y = c.y - orig.height / 2;
  el.rotation = normalizeRotation(orig.rotation + delta);
}

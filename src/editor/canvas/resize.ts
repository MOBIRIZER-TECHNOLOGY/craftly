/**
 * Rotation-aware box resizing used by the selection handles.
 * All maths happen in the element's own (rotated) axes, anchored on the
 * opposite handle (or the centre with `fromCenter`).
 */
import { boxCenter, rotatePoint } from "@/core/geometry";
import type { Point } from "@/core/types";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLE_VEC: Record<Handle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

export const isCorner = (h: Handle) => h.length === 2;

export interface BoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface ResizeOptions {
  keepAspect?: boolean;
  fromCenter?: boolean;
  minSize?: number;
  /** only change the width (text boxes whose height is derived) */
  widthOnly?: boolean;
}

/**
 * By how much a side changed: `to / from`. A side that had no length (a line has no height, and so has a selection of lines side
 * by side) cannot be scaled, and dividing by it gives no number at all, which would then be written into every element: 1 then.
 */
export function scaleOf(to: number, from: number): number {
  const s = to / from;
  return from > 0 && Number.isFinite(s) ? s : 1;
}

export function resizeBox(orig: BoxLike, handle: Handle, pointer: Point, opts: ResizeOptions = {}): BoxLike {
  const [hx, hy] = HANDLE_VEC[handle];
  const min = opts.minSize ?? 4;
  const c0 = boxCenter(orig);
  const p = rotatePoint(pointer, c0, -orig.rotation);
  const rel = { x: p.x - c0.x, y: p.y - c0.y };
  const fromCenter = !!opts.fromCenter;
  const ax = fromCenter ? 0 : -hx * (orig.width / 2);
  const ay = fromCenter ? 0 : -hy * (orig.height / 2);

  let w = orig.width;
  let h = orig.height;
  if (hx !== 0) w = Math.max(min, (rel.x - ax) * hx * (fromCenter ? 2 : 1));
  if (hy !== 0 && !opts.widthOnly) h = Math.max(min, (rel.y - ay) * hy * (fromCenter ? 2 : 1));

  let aspectAnchorX = ax;
  let aspectAnchorY = ay;
  if (opts.keepAspect && !opts.widthOnly) {
    if (hx !== 0 && hy !== 0) {
      const s = Math.max(scaleOf(w, orig.width), scaleOf(h, orig.height));
      w = Math.max(min, orig.width * s);
      h = Math.max(min, orig.height * s);
    } else if (hx !== 0) {
      h = Math.max(min, orig.height * scaleOf(w, orig.width));
      aspectAnchorY = 0;
    } else if (hy !== 0) {
      w = Math.max(min, orig.width * scaleOf(h, orig.height));
      aspectAnchorX = 0;
    }
  }

  const offX = fromCenter ? 0 : aspectAnchorX + (hx !== 0 ? (hx * w) / 2 : 0);
  const offY = fromCenter ? 0 : aspectAnchorY + (hy !== 0 ? (hy * h) / 2 : 0);
  const shift = rotatePoint({ x: offX, y: offY }, { x: 0, y: 0 }, orig.rotation);
  const cx = c0.x + shift.x;
  const cy = c0.y + shift.y;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation: orig.rotation };
}

/** Rotation (degrees) that points the rotate handle (which sits below the box) at `pointer`. */
export function angleToPointer(center: Point, pointer: Point): number {
  return (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI - 90;
}

/** Handle position in a box's own frame as a fraction of width/height (0..1). */
export const handleFraction = (h: Handle): [number, number] => [(HANDLE_VEC[h][0] + 1) / 2, (HANDLE_VEC[h][1] + 1) / 2];

/**
 * The maths of a two-finger pinch on the canvas. Nothing here knows about pointers or the DOM: the controller hands in
 * where the fingers are and gets back what the view should be.
 */
import { clamp } from "@/core/geometry";
import type { Point } from "@/core/types";

/** The point half way between two fingers, and how far apart they are. */
export function fingerSpan(a: Point, b: Point): { mid: Point; dist: number } {
  return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(b.x - a.x, b.y - a.y) };
}

/**
 * The zoom a pinch asks for: the zoom it began with, times how much further apart the fingers are now, within the limits.
 * Two fingers on the very same spot have no distance to compare with, so a distance never counts as less than a pixel.
 */
export function pinchZoom(startZoom: number, startDist: number, dist: number, min: number, max: number): number {
  return clamp((startZoom * Math.max(dist, 1)) / Math.max(startDist, 1), min, max);
}

/** The scroll offsets at which the point `design` (design px) is drawn at `screen` (px from the corner of the workspace). */
export function scrollToKeep(design: Point, screen: Point, page: { pageLeft: number; pageTop: number }, zoom: number): { left: number; top: number } {
  return { left: page.pageLeft + design.x * zoom - screen.x, top: page.pageTop + design.y * zoom - screen.y };
}

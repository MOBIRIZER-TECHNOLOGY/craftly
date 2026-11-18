/**
 * Geometry of the scrollable workspace: where the page sits on screen and how
 * to convert between design px, workspace-relative CSS px and client px.
 * Kept out of the document store because it changes on every scroll event.
 */
import { create } from "zustand";
import { pageMarginX } from "@/core/store";
import type { Point } from "@/core/types";

/** space kept around the page: left/right (on a screen 600 px wide or more; a phone keeps less, see pageMarginX) and top/bottom */
export const MARGIN_X = 72;
export const MARGIN_Y = 48;

export interface ViewMetrics {
  /** scroll offsets of the workspace scroller */
  scrollLeft: number;
  scrollTop: number;
  /** visible size of the workspace */
  width: number;
  height: number;
  /** page position inside the scrollable content */
  pageLeft: number;
  pageTop: number;
  /** page size on screen (design size x zoom) */
  pageW: number;
  pageH: number;
  zoom: number;
  /** scrollable content size */
  contentW: number;
  contentH: number;
}

export const initialMetrics: ViewMetrics = {
  scrollLeft: 0,
  scrollTop: 0,
  width: 1000,
  height: 700,
  pageLeft: 0,
  pageTop: 0,
  pageW: 960,
  pageH: 540,
  zoom: 0.5,
  contentW: 1000,
  contentH: 700,
};

export function layoutFor(designW: number, designH: number, zoom: number, viewW: number, viewH: number, extraBottom = 0) {
  const pageW = designW * zoom;
  const pageH = designH * zoom;
  const contentW = Math.max(viewW, pageW + pageMarginX(viewW) * 2);
  const contentH = Math.max(viewH, pageH + MARGIN_Y * 2 + extraBottom);
  return {
    pageW,
    pageH,
    contentW,
    contentH,
    pageLeft: (contentW - pageW) / 2,
    pageTop: Math.max(MARGIN_Y, (contentH - extraBottom - pageH) / 2),
  };
}

interface ViewStore extends ViewMetrics {
  set(patch: Partial<ViewMetrics>): void;
}

export const useView = create<ViewStore>()((set) => ({
  ...initialMetrics,
  set: (patch) => set(patch),
}));

export const getMetrics = (): ViewMetrics => useView.getState();

/**
 * When the user zooms with the wheel, the design point under the cursor must
 * stay under the cursor. The controller records it here; the workspace
 * consumes it after it has re-laid-out for the new zoom.
 */
let zoomAnchor: { sx: number; sy: number; dx: number; dy: number } | null = null;
export const setZoomAnchor = (a: { sx: number; sy: number; dx: number; dy: number } | null) => {
  zoomAnchor = a;
};
export const takeZoomAnchor = () => {
  const a = zoomAnchor;
  zoomAnchor = null;
  return a;
};

/** design px -> workspace-relative CSS px */
export function designToScreen(m: ViewMetrics, x: number, y: number): Point {
  return { x: m.pageLeft + x * m.zoom - m.scrollLeft, y: m.pageTop + y * m.zoom - m.scrollTop };
}

/** workspace-relative CSS px -> design px */
export function screenToDesign(m: ViewMetrics, sx: number, sy: number): Point {
  return { x: (sx + m.scrollLeft - m.pageLeft) / m.zoom, y: (sy + m.scrollTop - m.pageTop) / m.zoom };
}

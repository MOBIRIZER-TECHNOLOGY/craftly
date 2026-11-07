/**
 * Hyperlinks of a page in page space: used by the PDF writer (link annotations) and the SVG exporter
 * (anchors). Also hosts the tiny 2D affine helpers both exporters share, so a rotated element inside a
 * rotated group gets the same bounding box everywhere.
 */
import { DEG } from "@/core/geometry";
import type { DesignElement, Page } from "@/core/types";

/** [a, b, c, d, e, f] exactly like CanvasRenderingContext2D.setTransform / the SVG matrix() function. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m · n: the result applies `n` first, then `m`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Maps an element's local space (origin at its top-left corner) into its parent's space, mirroring
 * `drawElement` in render/renderPage.ts: translate to the centre, rotate, flip, translate back.
 */
export function elementMatrix(el: Pick<DesignElement, "x" | "y" | "width" | "height" | "rotation" | "flipH" | "flipV">): Matrix {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  let m: Matrix = [1, 0, 0, 1, cx, cy];
  if (el.rotation) {
    const cos = Math.cos(el.rotation * DEG);
    const sin = Math.sin(el.rotation * DEG);
    m = multiply(m, [cos, sin, -sin, cos, 0, 0]);
  }
  if (el.flipH || el.flipV) m = multiply(m, [el.flipH ? -1 : 1, 0, 0, el.flipV ? -1 : 1, 0, 0]);
  return multiply(m, [1, 0, 0, 1, -el.width / 2, -el.height / 2]);
}

/**
 * The part of a matrix that rotates / flips (no translation), used to keep canvas style screen-space
 * shadow offsets pointing the same way inside rotated elements.
 */
export function inverseLinear(m: Matrix, dx: number, dy: number): { x: number; y: number } {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return { x: dx, y: dy };
  return { x: (m[3] * dx - m[2] * dy) / det, y: (-m[1] * dx + m[0] * dy) / det };
}

/* ------------------------------------------------------------------ */
/* Links                                                              */
/* ------------------------------------------------------------------ */

const SAFE_SCHEMES = /^(https?|mailto|tel):/i;

/**
 * Turns whatever was typed into the "Link" field into a URL that is safe to write into a file, or null.
 * "example.com/x" becomes "https://example.com/x"; javascript:, data: and friends are rejected.
 */
export function safeLinkUrl(raw: string | undefined | null): string | null {
  const text = (raw ?? "").trim();
  // eslint-disable-next-line no-control-regex -- a link has no control characters
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return null;
  if (SAFE_SCHEMES.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null; // some other scheme: javascript:, data:, file: ...
  if (/\s/.test(text) || !/^[^./?#]+(\.[^./?#]+)+(?:[/?#].*)?$/.test(text)) return null;
  return `https://${text}`;
}

export interface PageLink {
  url: string;
  /** axis-aligned bounds in design px, origin top-left of the page */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every visible element with a usable `link`, in paint order, as page-space rectangles. */
export function collectPageLinks(page: Page): PageLink[] {
  const out: PageLink[] = [];
  const visit = (el: DesignElement, parent: Matrix) => {
    if (el.hidden) return;
    const m = multiply(parent, elementMatrix(el));
    const url = safeLinkUrl(el.link);
    if (url) {
      const corners = [applyMatrix(m, 0, 0), applyMatrix(m, el.width, 0), applyMatrix(m, el.width, el.height), applyMatrix(m, 0, el.height)];
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      // a straight line has no height; give the hot area the stroke's thickness
      const pad = el.type === "line" ? Math.max(el.stroke.width, 8) / 2 : 0;
      out.push({ url, x: x - pad, y: y - pad, w: Math.max(...xs) - x + pad * 2, h: Math.max(...ys) - y + pad * 2 });
    }
    if (el.type === "group") for (const child of el.children) visit(child, m);
  };
  for (const el of page.elements) visit(el, IDENTITY);
  return out;
}

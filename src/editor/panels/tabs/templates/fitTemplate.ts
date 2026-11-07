/**
 * Fitting a template page to a design of another size (pure: no store, no UI).
 *
 * Templates are authored for their own size. When the design differs, the content is scaled uniformly to fit and
 * centred, while full-bleed backgrounds (a shape or photo covering the whole template page) are stretched to cover the
 * whole design so no bars of page colour show.
 */
import { scaleElement } from "@/core/ops";
import type { DesignElement, Page } from "@/core/types";

export interface Size {
  width: number;
  height: number;
}

/** Does the element cover (nearly) the whole template page? Backgrounds drawn as shapes or photos do. */
export function isFullBleed(el: DesignElement, t: Size): boolean {
  if (el.type !== "shape" && el.type !== "image") return false;
  if (el.rotation) return false;
  return el.x <= t.width * 0.01 && el.y <= t.height * 0.01 && el.width >= t.width * 0.98 && el.height >= t.height * 0.98;
}

/** A copy of a template page that fits a design of another size (the original is never touched). */
export function fitTemplatePage(template: Size, page: Page, design: Size): Page {
  const copy = structuredClone(page);
  if (Math.round(template.width) === Math.round(design.width) && Math.round(template.height) === Math.round(design.height)) return copy;
  const s = Math.min(design.width / template.width, design.height / template.height);
  const ox = (design.width - template.width * s) / 2;
  const oy = (design.height - template.height * s) / 2;
  for (const el of copy.elements) {
    if (isFullBleed(el, template)) {
      el.x = 0;
      el.y = 0;
      el.width = design.width;
      el.height = design.height;
      continue;
    }
    scaleElement(el, s, s);
    el.x += ox;
    el.y += oy;
  }
  return copy;
}

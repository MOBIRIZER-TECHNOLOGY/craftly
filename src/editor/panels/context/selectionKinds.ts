/** Small selection helpers shared by the panels (what the current selection is made of). */
import type { DesignElement, TextElement } from "@/core/types";

/** Text elements of the selection, including the ones inside groups. */
export function collectTexts(els: DesignElement[]): TextElement[] {
  const out: TextElement[] = [];
  const visit = (el: DesignElement) => {
    if (el.type === "text") out.push(el);
    else if (el.type === "group") el.children.forEach(visit);
  };
  els.forEach(visit);
  return out;
}

/** Runs `fn` on the element, or on every text element inside it when it is a group. */
export function forEachText(el: DesignElement, fn: (text: TextElement) => void): void {
  if (el.type === "text") fn(el);
  else if (el.type === "group") el.children.forEach((c) => forEachText(c, fn));
}

/** The renderer paints a drop shadow for these types only. */
export const supportsShadow = (el: DesignElement): boolean => el.type === "shape" || el.type === "line" || el.type === "image" || el.type === "video" || el.type === "graphic";

/** Elements that have a stroke / border (an image only when it is not an empty frame being decorated). */
export const supportsStroke = (el: DesignElement): boolean => el.type === "shape" || el.type === "line" || el.type === "image" || el.type === "video";

export const isImage = (el: DesignElement): el is Extract<DesignElement, { type: "image" }> => el.type === "image";

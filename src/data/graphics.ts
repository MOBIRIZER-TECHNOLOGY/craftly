/** Illustration / sticker library: both hand-drawn packs merged, with search and element creation. */
import { createGraphic } from "@/core/factory";
import type { GraphicElement } from "@/core/types";
import { GRAPHICS_A } from "./graphicsA";
import { GRAPHICS_B } from "./graphicsB";
import { GRAPHIC_CATEGORY_LABELS, type GraphicCategory, type GraphicDef } from "./graphicTypes";

export const GRAPHICS: GraphicDef[] = [...GRAPHICS_A, ...GRAPHICS_B];

export const GRAPHIC_CATEGORIES: Array<{ id: GraphicCategory; label: string; count: number }> = (Object.keys(GRAPHIC_CATEGORY_LABELS) as GraphicCategory[])
  .map((id) => ({ id, label: GRAPHIC_CATEGORY_LABELS[id], count: GRAPHICS.filter((g) => g.category === id).length }))
  .filter((c) => c.count > 0);

const BY_ID = new Map(GRAPHICS.map((g) => [g.id, g]));
export const getGraphic = (id: string): GraphicDef | undefined => BY_ID.get(id);

export function searchGraphics(query: string, category?: GraphicCategory | null): GraphicDef[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  return GRAPHICS.filter((g) => {
    if (category && g.category !== category) return false;
    if (!words.length) return true;
    const hay = `${g.name} ${g.category} ${g.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A ready to insert element sized relative to the page. */
export function createGraphicElement(def: GraphicDef, pageMin: number): GraphicElement {
  return createGraphic({ svg: def.svg, source: { kind: def.kind === "sticker" ? "sticker" : "illustration", id: def.id }, ...fitWidth(def.svg, Math.round(pageMin * 0.3)) });
}

function fitWidth(svg: string, size: number): { width: number; height: number } {
  const m = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const w = m ? parseFloat(m[1]) : 1;
  const h = m ? parseFloat(m[2]) : 1;
  return w >= h ? { width: size, height: Math.round((size * h) / w) } : { width: Math.round((size * w) / h), height: size };
}

/** Fonts a design uses ("Document fonts" in the Font panel) and the font list filter. Pure, so it is unit tested. */
import type { Design, DesignElement } from "@/core/types";
import type { FontDef } from "@/render/fonts";

/** Font families used by text, tables and charts on every page, most used first. */
export function collectDocumentFonts(design: Pick<Design, "pages">): string[] {
  const counts = new Map<string, { count: number; first: number }>();
  let order = 0;
  const add = (family: string | undefined) => {
    if (!family) return;
    const hit = counts.get(family);
    if (hit) hit.count += 1;
    else counts.set(family, { count: 1, first: order++ });
  };
  const visit = (el: DesignElement) => {
    if (el.type === "text") {
      add(el.fontFamily);
      for (const p of el.paragraphs) for (const r of p.runs) add(r.font);
    } else if (el.type === "table" || el.type === "chart") add(el.fontFamily);
    else if (el.type === "group") el.children.forEach(visit);
  };
  for (const page of design.pages) page.elements.forEach(visit);
  return [...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first).map(([family]) => family);
}

/** Case-insensitive name filter; an empty query keeps everything. */
export function filterFonts(fonts: FontDef[], query: string): FontDef[] {
  const q = query.trim().toLowerCase();
  return q ? fonts.filter((f) => f.family.toLowerCase().includes(q)) : fonts;
}

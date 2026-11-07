/** The colours a design uses ("Document colors" in the Colour panel). Pure, so it is unit tested. */
import { parseColor, toHex } from "@/core/color";
import { extractSvgColors } from "@/core/svg";
import type { Design, DesignElement, Fill } from "@/core/types";

/**
 * Unique colours (#rrggbb) used by fills, gradients, patterns, strokes, text, text effects, tables, charts and
 * recoloured graphics across every page, most used first (ties keep the order they appear in).
 */
export function collectDocumentColors(design: Pick<Design, "pages">, limit = 60): string[] {
  const counts = new Map<string, { count: number; first: number }>();
  let order = 0;
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const c = parseColor(raw);
    if (!c || c.a < 0.05) return;
    const hex = toHex(c);
    const hit = counts.get(hex);
    if (hit) hit.count += 1;
    else counts.set(hex, { count: 1, first: order++ });
  };
  const addFill = (fill: Fill | null | undefined) => {
    if (!fill) return;
    if (fill.type === "solid") add(fill.color);
    else if (fill.type === "linear" || fill.type === "radial") fill.stops.forEach((s) => add(s.color));
    else if (fill.type === "pattern") {
      add(fill.color);
      add(fill.background);
    }
  };
  const visit = (el: DesignElement) => {
    switch (el.type) {
      case "text":
        add(el.color);
        el.gradient?.stops.forEach((s) => add(s.color));
        for (const p of el.paragraphs) for (const r of p.runs) add(r.color);
        if (el.effect.kind !== "none") add(el.effect.color);
        break;
      case "shape":
        addFill(el.fill);
        add(el.stroke?.color);
        break;
      case "line":
        add(el.stroke.color);
        break;
      case "image":
        add(el.stroke?.color);
        break;
      case "graphic":
        for (const k of extractSvgColors(el.svg)) add(el.colors[k] ?? (k === "currentColor" ? null : k));
        break;
      case "group":
        el.children.forEach(visit);
        break;
      case "table":
        add(el.headerFill);
        add(el.headerColor);
        add(el.stripeFill);
        add(el.borderColor);
        add(el.color);
        break;
      case "chart": {
        const used = el.chart === "pie" || el.chart === "donut" ? el.labels.length : el.series.length;
        el.palette.slice(0, Math.max(1, used)).forEach(add);
        add(el.textColor);
        break;
      }
    }
  };
  for (const page of design.pages) {
    addFill(page.background);
    page.elements.forEach(visit);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, limit)
    .map(([hex]) => hex);
}

/** Names and ordering rules for the Layers tab. Pure, so they are unit tested. */
import { paragraphsToText } from "@/core/factory";
import type { ChartKind, DesignElement, GraphicElement, ShapeElement } from "@/core/types";
import { getPhotoDef } from "@/data/photos";
import { m } from "@/i18n";
import { getShape } from "@/render/shapePaths";

const CHART_LABEL: Record<ChartKind, string> = m.panelsContext.chart.kinds;

const GRAPHIC_LABEL: Record<NonNullable<GraphicElement["source"]>["kind"], string> = m.panelsContext.layerNames.graphics;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "Rectangle" for a wide rect, "Circle" for a round ellipse: the catalogue's single name per shape reads wrong once the shape is stretched. */
function shapeName(el: ShapeElement): string {
  const square = Math.abs(el.width - el.height) <= Math.max(el.width, el.height) * 0.08;
  if (el.shape === "rect") {
    if (el.radius > 0) return square ? m.panelsContext.layerNames.roundedSquare : m.panelsContext.layerNames.roundedRectangle;
    return square ? m.panelsContext.layerNames.square : m.panelsContext.layerNames.rectangle;
  }
  if (el.shape === "ellipse") return square ? m.panelsContext.layerNames.circle : m.panelsContext.layerNames.ellipse;
  return getShape(el.shape)?.name ?? m.panelsContext.layerNames.shape;
}

/** A generic label for the element's type ("Text", "Image" ...). */
export function layerKind(el: DesignElement): string {
  switch (el.type) {
    case "text":
      return m.panelsContext.layerNames.text;
    case "shape":
      return m.panelsContext.layerNames.shape;
    case "line":
      return m.panelsContext.layerNames.line;
    case "image":
      return el.isFrame && !el.src ? m.panelsContext.layerNames.frame : m.panelsContext.layerNames.image;
    case "graphic":
      return GRAPHIC_LABEL[el.source?.kind ?? "other"];
    case "group":
      return m.panelsContext.layerNames.group;
    case "table":
      return m.panelsContext.layerNames.table;
    case "chart":
      return m.panelsContext.layerNames.chart;
    case "video":
      return m.panelsContext.layerNames.video;
  }
}

/** The name shown in the Layers list: the user's own name, or one derived from the content. */
export function layerName(el: DesignElement): string {
  const own = el.name?.trim();
  if (own) return own;
  switch (el.type) {
    case "text": {
      const text = paragraphsToText(el.paragraphs).replace(/\s+/g, " ").trim();
      return text ? truncate(text, 40) : m.panelsContext.layerNames.emptyText;
    }
    case "shape":
      return shapeName(el);
    case "line":
      return el.startArrow !== "none" || el.endArrow !== "none" ? m.panelsContext.layerNames.arrow : m.panelsContext.layerNames.line;
    case "image": {
      if (el.isFrame && !el.src) return m.panelsContext.layerNames.frame;
      if (el.src?.startsWith("builtin:")) return getPhotoDef(el.src.slice(8))?.name ?? m.panelsContext.layerNames.image;
      return m.panelsContext.layerNames.image;
    }
    case "group":
      return m.panelsContext.layerNames.groupOf(el.children.length);
    case "chart":
      return CHART_LABEL[el.chart];
    default:
      return layerKind(el);
  }
}

/**
 * Index to hand to `moveToIndex` (it removes the element first, then inserts) when `from` is dropped on
 * the upper or lower half of the row of the element at paint index `target`. The list is shown top-most
 * first, so "above" a row means a higher paint index.
 */
export function dropIndex(from: number, target: number, edge: "above" | "below"): number {
  const afterRemoval = target - (from < target ? 1 : 0);
  return edge === "above" ? afterRemoval + 1 : afterRemoval;
}

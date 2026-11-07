/** Names and ordering rules for the Layers tab. Pure, so they are unit tested. */
import { paragraphsToText } from "@/core/factory";
import type { ChartKind, DesignElement, GraphicElement, ShapeElement } from "@/core/types";
import { getPhotoDef } from "@/data/photos";
import { getShape } from "@/render/shapePaths";

const CHART_LABEL: Record<ChartKind, string> = { bar: "Bar", column: "Column", line: "Line", area: "Area", pie: "Pie", donut: "Donut" };

const GRAPHIC_LABEL: Record<NonNullable<GraphicElement["source"]>["kind"], string> = {
  icon: "Icon",
  illustration: "Illustration",
  sticker: "Sticker",
  qr: "QR code",
  emoji: "Emoji",
  other: "Graphic",
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "Rectangle" for a wide rect, "Circle" for a round ellipse: the catalogue's single name per shape reads wrong once the shape is stretched. */
function shapeName(el: ShapeElement): string {
  const square = Math.abs(el.width - el.height) <= Math.max(el.width, el.height) * 0.08;
  if (el.shape === "rect") return `${el.radius > 0 ? "Rounded " : ""}${square ? "square" : "rectangle"}`.replace(/^./, (c) => c.toUpperCase());
  if (el.shape === "ellipse") return square ? "Circle" : "Ellipse";
  return getShape(el.shape)?.name ?? "Shape";
}

/** A generic label for the element's type ("Text", "Image" ...). */
export function layerKind(el: DesignElement): string {
  switch (el.type) {
    case "text":
      return "Text";
    case "shape":
      return "Shape";
    case "line":
      return "Line";
    case "image":
      return el.isFrame && !el.src ? "Frame" : "Image";
    case "graphic":
      return GRAPHIC_LABEL[el.source?.kind ?? "other"];
    case "group":
      return "Group";
    case "table":
      return "Table";
    case "chart":
      return "Chart";
  }
}

/** The name shown in the Layers list: the user's own name, or one derived from the content. */
export function layerName(el: DesignElement): string {
  const own = el.name?.trim();
  if (own) return own;
  switch (el.type) {
    case "text": {
      const text = paragraphsToText(el.paragraphs).replace(/\s+/g, " ").trim();
      return text ? truncate(text, 40) : "Empty text";
    }
    case "shape":
      return shapeName(el);
    case "line":
      return el.startArrow !== "none" || el.endArrow !== "none" ? "Arrow" : "Line";
    case "image": {
      if (el.isFrame && !el.src) return "Frame";
      if (el.src?.startsWith("builtin:")) return getPhotoDef(el.src.slice(8))?.name ?? "Image";
      return "Image";
    }
    case "group":
      return `Group (${el.children.length})`;
    case "chart":
      return `${CHART_LABEL[el.chart]} chart`;
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

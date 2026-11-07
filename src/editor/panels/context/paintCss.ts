import type { Fill } from "@/core/types";

/** CSS `background` value for a solid / gradient fill (patterns and images have no single CSS equivalent). */
export function paintCss(fill: Fill): string {
  switch (fill.type) {
    case "solid":
      return fill.color;
    case "linear":
      return `linear-gradient(${fill.angle}deg, ${fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ")})`;
    case "radial":
      return `radial-gradient(circle at ${(fill.cx ?? 0.5) * 100}% ${(fill.cy ?? 0.5) * 100}%, ${fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ")})`;
    case "pattern":
      return fill.background;
    case "image":
      return "#e9ebf0";
  }
}

/** First colour of a fill, for places that can only show one colour. */
export function firstColor(fill: Fill): string {
  switch (fill.type) {
    case "solid":
      return fill.color;
    case "linear":
    case "radial":
      return fill.stops[0]?.color ?? "#000000";
    case "pattern":
      return fill.background;
    case "image":
      return "#e9ebf0";
  }
}

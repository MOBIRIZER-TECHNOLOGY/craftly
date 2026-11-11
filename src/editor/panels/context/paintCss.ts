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

/**
 * An address as a CSS `url("...")`. A quote, a backslash or a line break in it is written as an escape, so the address cannot end
 * its own quotes and add a second picture to the value (`data:x"), url("https://...`).
 */
export function cssUrl(address: string): string {
  return `url("${address.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
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

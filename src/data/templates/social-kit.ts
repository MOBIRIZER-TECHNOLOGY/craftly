/**
 * Shared helpers for the social + logo templates (social-*.ts): illustration lookup, a tiny stroke
 * icon set, rich text runs, grain, stars and a few composite building blocks (pills, stickers).
 * Everything returns plain document elements built with the DSL.
 */
import { createText } from "@/core/factory";
import { parseViewBox } from "@/core/svg";
import type { Color, DesignElement, Fill, GraphicElement, ShapeElement, TextElement, TextEffect, TextParagraph, TextRun } from "@/core/types";
import { englishGraphicName, getGraphic } from "@/data/graphics";
import { G, RR, S, T, patternBg, type ShapeOpts, type TextOpts } from "./dsl";

/* ---------------- illustrations ---------------- */

/**
 * An illustration from the graphics library by id, sized by width (height follows the artwork's aspect
 * ratio unless `h` is given). `colors` recolours it (keys are the lower-case hex colours of the artwork).
 */
export function gfx(id: string, x: number, y: number, w: number, opts: Partial<GraphicElement> & { h?: number } = {}): GraphicElement {
  const def = getGraphic(id);
  if (!def) throw new Error(`social-kit: unknown graphic "${id}"`);
  const vb = parseViewBox(def.svg) ?? { x: 0, y: 0, w: 1, h: 1 };
  const { h, ...rest } = opts;
  return G(def.svg, x, y, w, h ?? Math.round((w * vb.h) / vb.w), {
    source: { kind: def.kind === "sticker" ? "sticker" : "illustration", id },
    name: englishGraphicName(id),
    alt: englishGraphicName(id),
    ...rest,
  });
}

/* ---------------- stroke icons (24 x 24, recolourable) ---------------- */

const ICON_PATHS = {
  check: `<path d="M4.5 12.5l5 5L19.5 7"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  arrowRight: `<path d="M4 12h15M13 5.5L19.5 12 13 18.5"/>`,
  arrowUpRight: `<path d="M7 17L17 7M8.5 7H17v8.5"/>`,
  arrowDown: `<path d="M12 4v15M5.5 13L12 19.5 18.5 13"/>`,
  pin: `<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>`,
  heart: `<path d="M12 20.5l-7.2-7.1A4.9 4.9 0 0 1 12 6.6a4.9 4.9 0 0 1 7.2 6.8z"/>`,
  bookmark: `<path d="M6.5 3.5h11a1 1 0 0 1 1 1V21L12 17l-6.5 4V4.5a1 1 0 0 1 1-1z"/>`,
  send: `<path d="M21.5 2.5L10.5 13.5M21.5 2.5l-6.8 19-4.2-8-8-4.2z"/>`,
  mic: `<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.6-6 7.5-6s6.7 2 7.5 6"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`,
  home: `<path d="M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5"/>`,
  bed: `<path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-6v3"/><circle cx="7.5" cy="10.5" r="1.8"/>`,
  bath: `<path d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V6.5A2.5 2.5 0 0 1 8.5 4M7 19l-1 2M17 19l1 2"/>`,
  ruler: `<path d="M3 9h18v6H3zM7 9v3M11 9v2.4M15 9v3M19 9v2.4"/>`,
  flame: `<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3-2-5-3.4-6.6-.4 1.6-1.2 2.4-2.1 2.9C13.4 7 12.2 4.8 10 3c.1 3-4.5 5.6-4.5 11.5A6.5 6.5 0 0 0 12 21z"/>`,
  zap: `<path d="M13 2.5L4.5 13.5H11L10 21.5l9-11.5h-6.5z"/>`,
  sparkle: `<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>`,
  bell: `<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.500 6 9z"/><path d="M10.200 21a2 2 0 0 0 3.600 0"/>`,
  users: `<circle cx="9" cy="8" r="3.600"/><path d="M2.500 20c.7-3.600 3.200-5.500 6.500-5.500s5.800 1.900 6.500 5.500M16 4.600a3.600 3.600 0 0 1 0 6.800M18 14.800c2 .6 3.200 2.300 3.500 5.200"/>`,
  music: `<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>`,
  trophy: `<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.500A3.500 3.500 0 0 0 7.500 11M17 6h3v1.500A3.500 3.500 0 0 1 16.500 11M12 14v4M8 21h8M9.500 18h5"/>`,
} as const;
export type IconName = keyof typeof ICON_PATHS;

/** Stroke icon as an inline SVG graphic. */
export function icon(name: IconName, x: number, y: number, size: number, color: Color, opts: Partial<GraphicElement> & { stroke?: number; fillColor?: Color } = {}): GraphicElement {
  const { stroke = 2, fillColor, ...rest } = opts;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fillColor ?? "none"}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
  const label = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return G(svg, x, y, size, size, { name: `${label.charAt(0).toUpperCase()}${label.slice(1)} icon`, strokeWidth: stroke, source: { kind: "icon", id: name }, ...rest });
}

/** Filled play triangle in a 24 box. */
export function playGlyph(x: number, y: number, size: number, color: Color, opts: Partial<GraphicElement> = {}): GraphicElement {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7.5 4.5v15l12.5-7.5z" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  return G(svg, x, y, size, size, { name: "Play", source: { kind: "icon", id: "play" }, ...opts });
}

/* ---------------- text ---------------- */

/** A run of text; extra style fields override the text box. */
export const run = (text: string, style: Omit<TextRun, "text"> = {}): TextRun => ({ text, ...style });

/** A paragraph of runs, e.g. `para("Be ", run("gentle", { italic: true, color: "#d9482b" }), " now")`. */
export const para = (...parts: Array<string | TextRun>): TextParagraph => ({ runs: parts.map((p) => (typeof p === "string" ? { text: p } : p)) });

/** Text box built from paragraphs of styled runs. */
export function RT(paragraphs: TextParagraph[], x: number, y: number, w: number, size: number, opts: TextOpts = {}): TextElement {
  return createText({ paragraphs, x, y, width: w, autoWidth: false, fontSize: size, lineHeight: 1.2, ...opts });
}

/** Small uppercase tracked label (eyebrows, tags, meta lines). */
export function label(text: string, x: number, y: number, w: number, size: number, color: Color, opts: TextOpts = {}): TextElement {
  return T(text, x, y, w, size, { fontWeight: 700, letterSpacing: 160, textCase: "upper", color, ...opts });
}

/** Single line of text centred on (cx, cy); the box height of one line is size * lineHeight. */
export function centered(text: string, cx: number, cy: number, w: number, size: number, opts: TextOpts = {}): TextElement {
  const lh = opts.lineHeight ?? 1.2;
  return T(text, cx - w / 2, cy - (size * lh) / 2, w, size, { align: "center", ...opts });
}

/** Hard offset drop shadow for display type. */
export const hardShadow = (color: Color, distance = 8, direction = 45): TextEffect => ({ kind: "shadow", color, offset: Math.round((distance / 0.22) * 100) / 100, direction, blur: 0, transparency: 0 });
/** Soft glow / lift-free shadow. */
export const softShadow = (color: Color, blur = 40, transparency = 60): TextEffect => ({ kind: "shadow", color, offset: 30, direction: 90, blur, transparency });
/** Outline stroke around filled type (thickness is 0..100). */
export const outlineFx = (color: Color, thickness = 50): TextEffect => ({ kind: "outline", color, thickness });
/** Highlighter bar behind each line. */
export const barFx = (color: Color, roundness = 40, spread = 30): TextEffect => ({ kind: "background", color, roundness, spread, transparency: 0 });
/** Hollow (outline only) display type. */
export const hollowFx = (thickness = 50): TextEffect => ({ kind: "hollow", thickness });

/* ---------------- shapes ---------------- */

/** Five point star by top-left corner and size. */
export function star(x: number, y: number, size: number, fill: Color | Fill, opts: ShapeOpts = {}): ShapeElement {
  return S("star", x, y, size, size, fill, { name: "Star", ...opts });
}

/** A row of rating stars, `size` px each, `gap` px apart. */
export function stars(count: number, x: number, y: number, size: number, gap: number, fill: Color, opts: ShapeOpts = {}): ShapeElement[] {
  return Array.from({ length: count }, (_v, i) => star(x + i * (size + gap), y, size, fill, opts));
}

/** Four-point sparkle centred on (cx, cy). */
export function sparkle(cx: number, cy: number, size: number, fill: Color, opts: ShapeOpts = {}): ShapeElement {
  return S("star-4", cx - size / 2, cy - size / 2, size, size, fill, { name: "Sparkle", ...opts });
}

/** Subtle film grain over the whole page (a noise pattern at low opacity). */
export function grain(w: number, h: number, opacity = 0.06): ShapeElement {
  return S("rect", 0, 0, w, h, patternBg("noise", "#000000", "#ffffff", 1), { opacity, name: "Grain", locked: true });
}

/** Rounded pill with centred text; returns [shape, text]. */
export function pill(text: string, x: number, y: number, w: number, h: number, fill: Color | Fill | null, color: Color, size: number, opts: { weight?: number; font?: string; stroke?: Color; strokeWidth?: number; spacing?: number; upper?: boolean; shadow?: ShapeElement["shadow"] } = {}): DesignElement[] {
  const { weight = 700, font, stroke, strokeWidth = 3, spacing = 0, upper = false, shadow } = opts;
  const shape = RR(x, y, w, h, h / 2, fill, { name: "Pill", ...(stroke ? { stroke: { color: stroke, width: strokeWidth, style: "solid" as const } } : {}), ...(shadow ? { shadow } : {}) });
  const txt = centered(text, x + w / 2, y + h / 2, w - 16, size, { fontWeight: weight, color, letterSpacing: spacing, textCase: upper ? "upper" : "none", lineHeight: 1.1, ...(font ? { fontFamily: font } : {}) });
  return [shape, txt];
}

/** Soft card shadow. */
export const cardShadow = (color = "rgba(20,16,40,0.18)", blur = 40, y = 18): ShapeElement["shadow"] => ({ color, blur, x: 0, y });

/**
 * Rotates a set of elements together about (cx, cy), the way a tilted card with its photo and caption
 * would turn. Each element keeps its own box; its centre orbits the pivot and its rotation increases by `deg`.
 * Use it for single-line text only (the box height of wrapped text is measured later).
 */
export function tilt<E extends DesignElement>(els: E[], cx: number, cy: number, deg: number): E[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return els.map((el) => {
    const ex = el.x + el.width / 2 - cx;
    const ey = el.y + el.height / 2 - cy;
    const nx = cx + ex * c - ey * s;
    const ny = cy + ex * s + ey * c;
    return { ...el, x: nx - el.width / 2, y: ny - el.height / 2, rotation: el.rotation + deg };
  });
}

/**
 * Shared layout kit for the presentation templates: the 1920 x 1080 grid (12 columns, 96px outer
 * margins, 24px gutters), real font metrics for optical alignment, photo cropping and a few
 * small element builders. Everything returns plain document elements built with the DSL.
 */
import { rgba } from "@/core/color";
import { parseViewBox } from "@/core/svg";
import { getGraphic } from "@/data/graphics";
import type { Color, DesignElement, Fill, GraphicElement, ImageElement, LinearGradientFill, Page, ShapeElement, TextElement, TextRun } from "@/core/types";
import { C, F, G, P, R, T, pg, type TextOpts } from "./dsl";

/* ------------------------------------------------------------------ */
/* grid                                                                */
/* ------------------------------------------------------------------ */

export const W = 1920;
export const H_ = 1080;
export const MARGIN = 96;
export const GUTTER = 24;
export const COL = 122;
/** Left edge of column `c` (0 based, 0..11). */
export const X = (c: number): number => MARGIN + c * (COL + GUTTER);
/** Width of `n` columns including the gutters between them. */
export const SPAN = (n: number): number => n * COL + (n - 1) * GUTTER;
/** Right edge of the content area. */
export const RIGHT = W - MARGIN;
export const TOP = MARGIN;
export const BOTTOM = H_ - MARGIN;
/** Content stops here on slides that carry a folio line. */
export const SAFE_BOTTOM = BOTTOM - 72;

/** Type scale (px). Nothing in a deck is set below LABEL. */
export const SCALE = { display: 120, h1: 64, h2: 40, body: 28, label: 26 } as const;

/* ------------------------------------------------------------------ */
/* font metrics (measured with the real renderer, in em)               */
/* ------------------------------------------------------------------ */

/** [ascent, descent, cap height, x height] of the font's content area. */
const FM: Record<string, readonly [number, number, number, number]> = {
  "Plus Jakarta Sans": [1.038, 0.222, 0.75, 0.547],
  Inter: [0.969, 0.241, 0.734, 0.547],
  Poppins: [1.05, 0.35, 0.703, 0.547],
  Montserrat: [0.968, 0.251, 0.703, 0.531],
  "DM Sans": [0.992, 0.31, 0.703, 0.516],
  "Playfair Display": [1.082, 0.251, 0.719, 0.516],
  Lora: [1.006, 0.274, 0.703, 0.5],
  Raleway: [0.94, 0.234, 0.719, 0.531],
  "Open Sans": [1.069, 0.293, 0.719, 0.547],
  Roboto: [0.95, 0.25, 0.719, 0.531],
  Lato: [0.987, 0.213, 0.719, 0.516],
  "Work Sans": [0.93, 0.243, 0.672, 0.5],
  Manrope: [1.066, 0.3, 0.719, 0.547],
  Outfit: [1, 0.26, 0.703, 0.484],
  Nunito: [1.011, 0.353, 0.719, 0.5],
  "Josefin Sans": [0.75, 0.25, 0.734, 0.422],
  "Space Grotesk": [0.984, 0.292, 0.703, 0.5],
  "Bricolage Grotesque": [0.93, 0.27, 0.672, 0.516],
  Merriweather: [0.984, 0.273, 0.75, 0.563],
  "Cormorant Garamond": [0.924, 0.287, 0.625, 0.391],
  Fraunces: [0.978, 0.255, 0.703, 0.469],
  "Libre Baskerville": [0.97, 0.27, 0.781, 0.531],
  "DM Serif Display": [1.036, 0.335, 0.672, 0.484],
  Cinzel: [0.976, 0.372, 0.703, 0.609],
  Oswald: [1.193, 0.289, 0.813, 0.578],
  "Bebas Neue": [0.95, 0.35, 0.703, 0.703],
  Anton: [1.176, 0.329, 0.859, 0.734],
  "Archivo Black": [1.035, 0.312, 0.688, 0.531],
  "Abril Fatface": [1.058, 0.291, 0.703, 0.484],
  "Yeseva One": [0.915, 0.24, 0.703, 0.5],
  Syne: [0.925, 0.275, 0.656, 0.5],
  Righteous: [0.985, 0.257, 0.703, 0.531],
  Bungee: [1.02, 0.3, 0.719, 0.719],
  Fredoka: [0.974, 0.236, 0.688, 0.484],
  Caveat: [0.96, 0.3, 0.703, 0.359],
  "JetBrains Mono": [1.02, 0.3, 0.734, 0.563],
  "Space Mono": [1.12, 0.361, 0.703, 0.5],
};

const metric = (font: string) => FM[font] ?? [1, 0.25, 0.7, 0.5];

/** Distance from the top of a text box to the cap line of its first line. */
export function capOffset(font: string, size: number, lineHeight: number): number {
  const [a, d, cap] = metric(font);
  return size * ((lineHeight - a - d) / 2 + a - cap);
}

/** Distance from the top of a text box to the baseline of its first line. */
export function baseOffset(font: string, size: number, lineHeight: number): number {
  const [a, d] = metric(font);
  return size * ((lineHeight - a - d) / 2 + a);
}

/** y of the box top that puts the first line's cap line at `capY`. */
export const atCap = (font: string, size: number, lineHeight: number, capY: number): number => Math.round(capY - capOffset(font, size, lineHeight));

/** y of the box top that puts the first line's baseline at `baseY`. */
export const atBase = (font: string, size: number, lineHeight: number, baseY: number): number => Math.round(baseY - baseOffset(font, size, lineHeight));

/** Height of `lines` lines of text at this size / line height. */
export const blockH = (size: number, lineHeight: number, lines: number): number => Math.round(size * lineHeight * lines);

/* ------------------------------------------------------------------ */
/* photos and frames                                                   */
/* ------------------------------------------------------------------ */

/** Intrinsic sizes of the procedural photos (they decide the cover crop). */
const PHOTO_DIMS: Record<string, readonly [number, number]> = {
  "sunset-hills": [1600, 1067],
  "ocean-waves": [1600, 900],
  "mountain-lake": [1600, 1067],
  "desert-dunes": [1200, 1500],
  "forest-mist": [1200, 1500],
  "aurora-night": [1600, 900],
  "tropical-beach": [1600, 1067],
  "snowy-peaks": [1200, 1500],
  "rolling-fields": [1600, 900],
  "canyon-glow": [1200, 1500],
  "city-night": [1600, 900],
  "city-dawn": [1200, 1500],
  "glass-towers": [1200, 1500],
  "mesh-sunrise": [1400, 1400],
  "mesh-ocean": [1600, 900],
  "mesh-candy": [1200, 1500],
  "mesh-forest": [1400, 1400],
  "mesh-midnight": [1600, 900],
  "liquid-purple": [1200, 1500],
  "neon-grid": [1600, 900],
  "soft-blobs": [1400, 1400],
  "paper-cream": [1400, 1400],
  "marble-white": [1400, 1400],
  "concrete-gray": [1200, 1500],
  "linen-beige": [1400, 1400],
  terrazzo: [1400, 1400],
  "palm-leaves": [1200, 1500],
  monstera: [1400, 1400],
  wildflowers: [1200, 1500],
  "bokeh-gold": [1600, 900],
  "water-ripples": [1400, 1400],
  nebula: [1600, 900],
  starfield: [1600, 900],
};

export interface PhotoOpts extends Partial<ImageElement> {
  /** focal point in the source photo, 0..1 (default centre) */
  fx?: number;
  fy?: number;
  /** extra magnification beyond "cover" (default 1) */
  zoom?: number;
}

/** A procedural photo cover-fitted into the box around a focal point, without distortion. */
export function photo(id: string, x: number, y: number, w: number, h: number, o: PhotoOpts = {}): ImageElement {
  const { fx = 0.5, fy = 0.5, zoom = 1, ...rest } = o;
  const [nw, nh] = PHOTO_DIMS[id] ?? [1600, 1067];
  const s = Math.max(w / nw, h / nh) * zoom;
  const cw = (nw * s) / w;
  const ch = (nh * s) / h;
  const cx = Math.min(0, Math.max(1 - cw, 0.5 - fx * cw));
  const cy = Math.min(0, Math.max(1 - ch, 0.5 - fy * ch));
  return P(id, x, y, w, h, { naturalWidth: nw, naturalHeight: nh, crop: { x: cx, y: cy, w: cw, h: ch }, ...rest });
}

/** Empty drop-a-photo frame with a sensible layer name and alt text. */
export function frame(x: number, y: number, w: number, h: number, o: Partial<ImageElement> & { mask?: string } = {}): ImageElement {
  const { mask = "rect", ...rest } = o;
  return F(x, y, w, h, mask, { name: "Photo frame", alt: "Placeholder: drop your photo here", ...rest });
}

/* ------------------------------------------------------------------ */
/* small builders                                                      */
/* ------------------------------------------------------------------ */

const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

/**
 * An illustration from the graphics library by id, sized by width (height follows the artwork's
 * aspect ratio unless `h` is given). `colors` recolours it: original #rrggbb -> replacement.
 */
export function gfx(id: string, x: number, y: number, w: number, o: Partial<GraphicElement> & { h?: number } = {}): GraphicElement {
  const def = getGraphic(id);
  const svg = def?.svg ?? EMPTY_SVG;
  const vb = parseViewBox(svg) ?? { x: 0, y: 0, w: 10, h: 10 };
  const { h, ...rest } = o;
  return G(svg, x, y, w, h ?? Math.round((w * vb.h) / vb.w), { name: def?.name ?? "Illustration", source: { kind: def?.kind === "sticker" ? "sticker" : "illustration", id }, ...rest });
}

/**
 * Soft radial glow: a circle whose colour fades to transparent exactly at its edge.
 * (The renderer sizes a radial gradient to the farthest corner of the box, so the last visible
 * stop sits at 1/sqrt(2) of the gradient to land on the circle's rim.)
 */
export function glow(cx: number, cy: number, r: number, color: Color, alpha = 0.5, o: Partial<ShapeElement> = {}): ShapeElement {
  const k = Math.SQRT1_2;
  return C(
    cx,
    cy,
    r,
    {
      type: "radial",
      stops: [
        { offset: 0, color: rgba(color, alpha) },
        { offset: 0.35 * k, color: rgba(color, alpha * 0.62) },
        { offset: 0.65 * k, color: rgba(color, alpha * 0.24) },
        { offset: 0.85 * k, color: rgba(color, alpha * 0.06) },
        { offset: k, color: rgba(color, 0) },
        { offset: 1, color: rgba(color, 0) },
      ],
    },
    { name: "Glow", ...o },
  );
}

/**
 * Gradient of one colour fading in and out: `stops` are [offset, alpha] pairs, `rgb` is "r,g,b".
 * Used for the dimming overlays on top of photos (angle 180 = top to bottom).
 */
export function vshade(stops: Array<[number, number]>, rgb = "0,0,0", angle = 180): LinearGradientFill {
  return { type: "linear", angle, stops: stops.map(([offset, a]) => ({ offset, color: `rgba(${rgb},${a})` })) };
}

/** Crisp horizontal rule (a thin rectangle, so its edges sit exactly on pixels). */
export const hrule = (x: number, y: number, w: number, color: Color, t = 2, o: Partial<ShapeElement> = {}): ShapeElement => R(x, y, w, t, color, o);
/** Crisp vertical rule. */
export const vrule = (x: number, y: number, h: number, color: Color, t = 2, o: Partial<ShapeElement> = {}): ShapeElement => R(x, y, t, h, color, o);

/** Zero padded index: 1 -> "01". */
export const num = (n: number): string => String(n).padStart(2, "0");

/**
 * Replaces the text of `el` with styled runs, one array per paragraph:
 * `rich(T("", ...), [["Plain "], [{ text: "italic", italic: true }]])`.
 */
export function rich(el: TextElement, paragraphs: Array<Array<string | TextRun>>): TextElement {
  el.paragraphs = paragraphs.map((p) => ({ runs: p.map((r) => (typeof r === "string" ? { text: r } : r)) }));
  return el;
}

/** One page with a name for the page strip and presenter notes. */
export function slide(name: string, background: Fill | Color, elements: DesignElement[], notes?: string): Page {
  const page = pg(background, elements, notes);
  page.name = name;
  return page;
}

/* ------------------------------------------------------------------ */
/* per-deck type setter                                                */
/* ------------------------------------------------------------------ */

export interface TypeCfg {
  /** display family (headlines, numerals) */
  display: string;
  /** text family (labels, running text) */
  text: string;
  /** default colour of display type and running text */
  ink: Color;
  displayWeight?: number;
  /** headline line height (default 1.0) */
  displayLh?: number;
  /** letter spacing (1/1000 em) of display type by size */
  tracking?: (size: number) => number;
  textWeight?: number;
  /** running text line height (default 1.5) */
  bodyLh?: number;
  labelWeight?: number;
  labelTracking?: number;
}

/**
 * Binds a deck's two families to three small builders:
 * `D` display type with its first cap line on `capY`, `LBL` tracked caps label (26px) with its
 * cap line on `capY`, and `B` running text (28px unless `fontSize` is given) whose box top is `y`.
 */
export function makeType(cfg: TypeCfg) {
  const track = cfg.tracking ?? ((s: number) => (s >= 100 ? -20 : -10));
  const D = (text: string, x: number, capY: number, w: number, size = 120, o: TextOpts = {}) => {
    const lh = o.lineHeight ?? cfg.displayLh ?? 1.0;
    return T(text, x, atCap(cfg.display, size, lh, capY), w, size, { fontFamily: cfg.display, fontWeight: cfg.displayWeight ?? 800, lineHeight: lh, letterSpacing: track(size), color: cfg.ink, ...o });
  };
  const LBL = (text: string, x: number, capY: number, w: number, color: Color = cfg.ink, o: TextOpts = {}) =>
    T(text, x, atCap(cfg.text, 26, 1.2, capY), w, 26, { fontFamily: cfg.text, fontWeight: cfg.labelWeight ?? 700, letterSpacing: cfg.labelTracking ?? 160, textCase: "upper", color, ...o });
  const B = (text: string, x: number, y: number, w: number, color: Color = cfg.ink, o: TextOpts = {}) =>
    T(text, x, y, w, 28, { fontFamily: cfg.text, fontWeight: cfg.textWeight ?? 400, lineHeight: cfg.bodyLh ?? 1.5, color, ...o });
  return { D, LBL, B };
}

export type { TextElement };

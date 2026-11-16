/**
 * Tiny authoring DSL for built-in templates. Every helper returns a plain
 * document element positioned in design px, so a template reads like a layout
 * spec: `T("Hello", x, y, w, size, {...})`, `R(x, y, w, h, color)` ...
 *
 * Text boxes are fixed-width (they wrap inside `w`); their height is measured
 * by the editor when a template is opened, so leave it out.
 */
import { createGraphic, createImage, createLine, createPage, createShape, createText, solid } from "@/core/factory";
import type {
  Color,
  DesignElement,
  Fill,
  GraphicElement,
  ImageElement,
  LineElement,
  LinearGradientFill,
  Page,
  ShapeElement,
  Template,
  TemplateCategory,
  TextElement,
} from "@/core/types";
import { m } from "@/i18n";
import { nameIn } from "../names";

/** Canonical sizes (design px) and the design type id used when the template is opened. */
export const SIZES = {
  presentation: { width: 1920, height: 1080, typeId: "presentation" },
  instagram: { width: 1080, height: 1350, typeId: "instagram-post" },
  square: { width: 1080, height: 1080, typeId: "instagram-square" },
  story: { width: 1080, height: 1920, typeId: "instagram-story" },
  facebook: { width: 940, height: 788, typeId: "facebook-post" },
  youtube: { width: 1280, height: 720, typeId: "youtube-thumbnail" },
  linkedin: { width: 1200, height: 627, typeId: "linkedin-post" },
  twitter: { width: 1600, height: 900, typeId: "twitter-post" },
  pinterest: { width: 1000, height: 1500, typeId: "pinterest-pin" },
  poster: { width: 1728, height: 2304, typeId: "poster" },
  flyer: { width: 816, height: 1056, typeId: "flyer" },
  document: { width: 794, height: 1123, typeId: "doc-a4" },
  resume: { width: 816, height: 1056, typeId: "resume" },
  logo: { width: 500, height: 500, typeId: "logo" },
  invitation: { width: 480, height: 672, typeId: "invitation" },
  businessCard: { width: 336, height: 192, typeId: "business-card" },
  postcard: { width: 576, height: 384, typeId: "postcard" },
  certificate: { width: 1123, height: 794, typeId: "certificate" },
  menu: { width: 816, height: 1056, typeId: "menu" },
  banner: { width: 1920, height: 480, typeId: "banner" },
  wallpaper: { width: 1920, height: 1080, typeId: "wallpaper" },
} as const;

export type SizeKey = keyof typeof SIZES;

/* ---------------- text ---------------- */

export type TextOpts = Partial<Omit<TextElement, "type" | "id" | "paragraphs" | "x" | "y" | "width">>;

/** Fixed-width text box: text, x, y, width, font size. `\n` makes a new paragraph. */
export function T(text: string, x: number, y: number, w: number, size: number, opts: TextOpts = {}): TextElement {
  return createText({ text, x, y, width: w, autoWidth: false, fontSize: size, lineHeight: 1.2, ...opts });
}

/** Bold display headline helper. */
export function H(text: string, x: number, y: number, w: number, size: number, opts: TextOpts = {}): TextElement {
  return T(text, x, y, w, size, { fontWeight: 800, lineHeight: 1.05, ...opts });
}

/* ---------------- shapes ---------------- */

export type ShapeOpts = Partial<Omit<ShapeElement, "type" | "id" | "x" | "y" | "width" | "height" | "fill" | "shape">>;

const paint = (f: Color | Fill | null): Fill | null => (f === null ? null : typeof f === "string" ? solid(f) : f);

/** Any catalogue shape (see render/shapePaths.ts for ids). */
export function S(kind: string, x: number, y: number, w: number, h: number, fill: Color | Fill | null, opts: ShapeOpts = {}): ShapeElement {
  return createShape(kind, { x, y, width: w, height: h, fill: paint(fill), ...opts });
}
/** Rectangle, optional corner radius. */
export function R(x: number, y: number, w: number, h: number, fill: Color | Fill | null, opts: ShapeOpts = {}): ShapeElement {
  return S("rect", x, y, w, h, fill, opts);
}
/** Rounded rectangle. */
export function RR(x: number, y: number, w: number, h: number, radius: number, fill: Color | Fill | null, opts: ShapeOpts = {}): ShapeElement {
  return S("rect", x, y, w, h, fill, { radius, ...opts });
}
/** Circle by centre and radius. */
export function C(cx: number, cy: number, r: number, fill: Color | Fill | null, opts: ShapeOpts = {}): ShapeElement {
  return S("ellipse", cx - r, cy - r, r * 2, r * 2, fill, opts);
}
/** Ring / outline shape helper: no fill, a stroke. */
export function O(kind: string, x: number, y: number, w: number, h: number, stroke: Color, width: number, opts: ShapeOpts = {}): ShapeElement {
  return S(kind, x, y, w, h, null, { stroke: { color: stroke, width, style: "solid" }, ...opts });
}

/** Straight line between two points. */
export function L(x1: number, y1: number, x2: number, y2: number, color: Color, width = 4, opts: Partial<LineElement> = {}): LineElement {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return createLine({ x: (x1 + x2) / 2 - len / 2, y: (y1 + y2) / 2, width: len, rotation: rot, stroke: { color, width, style: "solid", cap: "round" }, ...opts });
}

/* ---------------- media ---------------- */

/** Procedural stock photo (ids: see docs/DESIGN.md 6.6), cover-fitted into the box. */
export function P(photoId: string, x: number, y: number, w: number, h: number, opts: Partial<ImageElement> = {}): ImageElement {
  return createImage({ src: `builtin:${photoId}`, naturalWidth: 1600, naturalHeight: 1067, x, y, width: w, height: h, ...opts });
}

/** Empty frame placeholder, shown with a photo icon until the user drops a picture. */
export function F(x: number, y: number, w: number, h: number, mask = "rect", opts: Partial<ImageElement> = {}): ImageElement {
  return createImage({ src: null, naturalWidth: 1, naturalHeight: 1, x, y, width: w, height: h, mask, isFrame: true, ...opts });
}

/** Inline SVG graphic (use currentColor / literal colours; user can recolour). */
export function G(svg: string, x: number, y: number, w: number, h: number, opts: Partial<GraphicElement> = {}): GraphicElement {
  return createGraphic({ svg, x, y, width: w, height: h, ...opts });
}

/* ---------------- pages and templates ---------------- */

export const solidBg = (color: Color): Fill => solid(color);

export function gradientBg(angle: number, ...colors: Color[]): LinearGradientFill {
  return { type: "linear", angle, stops: colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color })) };
}

export function patternBg(pattern: "dots" | "grid" | "lines" | "diagonal" | "checker" | "waves" | "zigzag" | "plus" | "bubbles" | "noise", color: Color, background: Color, scale = 1): Fill {
  return { type: "pattern", pattern, color, background, scale };
}

export function photoBg(photoId: string, dim = 0): Fill {
  return { type: "image", src: `builtin:${photoId}`, fit: "cover", dim };
}

/** One page: background plus elements in back-to-front order. */
export function pg(background: Fill | Color, elements: DesignElement[], notes?: string): Page {
  return createPage({ background: typeof background === "string" ? solid(background) : background, elements, notes });
}

export interface TemplateMeta {
  /** short slug, unique inside its category, e.g. "pitch-deck-violet" */
  slug: string;
  /**
   * Only for a template that is not built in (a test, a page of src/dev). A built-in template has its name in the catalogs
   * (`templates` in src/i18n/en/data.ts and the other languages), by its id.
   */
  name?: string;
  category: TemplateCategory;
  size: SizeKey;
  /** search keywords, lower case */
  tags: string[];
  /** dominant colour shown while the thumbnail renders */
  accent: Color;
}

export function template(meta: TemplateMeta, pages: Page[]): Template {
  const s = SIZES[meta.size];
  const id = `${meta.category}-${meta.slug}`;
  return {
    id,
    name: meta.name ?? nameIn(m.data.templates, id),
    category: meta.category,
    typeId: s.typeId,
    width: s.width,
    height: s.height,
    tags: meta.tags,
    accent: meta.accent,
    pages,
  };
}

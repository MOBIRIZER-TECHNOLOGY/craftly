/**
 * Pure helpers shared by the exporters and the Download panel: option clamping, pixel sizes, the 8192 px
 * cap, file names and the "estimated size" heuristic. Nothing here touches the DOM, so it is unit tested
 * in node.
 */
import { parseColor } from "@/core/color";
import type { Design, DesignElement, Page } from "@/core/types";
import { m } from "@/i18n";
import { estimateGifBytes, estimateWebmBytes, isAnimatedFormat, pageMotion, planAnimation, type AnimationPlan } from "./animated/frames";
import type { ExportFormat, ExportOptions } from "./exporters";

/** Longest side, in pixels, of any exported raster (and of PDF page images). */
export const MAX_EXPORT_SIDE = 8192;
export const MIN_EXPORT_SCALE = 0.25;
export const MAX_EXPORT_SCALE = 4;
/** Design pixels are CSS pixels: 96 per inch. */
export const CSS_DPI = 96;
export const PRINT_DPI = 300;
/** Raster scale that gives 300 dpi for a design measured in CSS pixels. */
export const PRINT_SCALE = PRINT_DPI / CSS_DPI;
/** PDF user units (points) per design pixel. */
export const PX_TO_PT = 72 / CSS_DPI;
/** Design pixels and PDF points per millimetre (a bleed is given in millimetres). */
export const MM_TO_PX = CSS_DPI / 25.4;
export const MM_TO_PT = 72 / 25.4;
/** The bleed printers usually ask for, and the most the panel offers. */
export const DEFAULT_BLEED_MM = 3;
export const MAX_BLEED_MM = 10;
export const DEFAULT_QUALITY = 0.92;
export const COMPRESSED_QUALITY = 0.6;
export const MIN_QUALITY = 0.1;

export const FORMAT_EXTENSION: Record<ExportFormat, string> = { png: "png", jpg: "jpg", pdf: "pdf", svg: "svg", gif: "gif", webm: "webm" };
export const FORMAT_MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  gif: "image/gif",
  webm: "video/webm",
};

export function clampNumber(value: number, min: number, max: number, fallback: number = min): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* Pixel sizes                                                        */
/* ------------------------------------------------------------------ */

/** Pixel size of a design exported at `scale` (never below 1 px). */
export function exportPixelSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Lowers `scale` so the longest side stays within `limit` pixels. */
export function fitScaleToLimit(width: number, height: number, scale: number, limit: number = MAX_EXPORT_SIDE): { scale: number; clamped: boolean } {
  const longest = Math.max(width, height);
  if (!(longest > 0) || longest * scale <= limit) return { scale, clamped: false };
  return { scale: limit / longest, clamped: true };
}

export interface RasterPlan {
  /** what the options asked for (after clamping to 0.25..4, or 300 dpi for print PDFs) */
  requested: number;
  /** what will actually be rendered (never makes the longest side exceed MAX_EXPORT_SIDE) */
  scale: number;
  clamped: boolean;
  width: number;
  height: number;
}

/** Scale and pixel size a raster of this design will be rendered at, including the print preset and the cap. */
export function planRaster(designWidth: number, designHeight: number, opts: Pick<ExportOptions, "format" | "scale" | "pdfMode">): RasterPlan {
  const requested = opts.format === "pdf" && opts.pdfMode === "print" ? PRINT_SCALE : clampNumber(opts.scale, MIN_EXPORT_SCALE, MAX_EXPORT_SCALE, 1);
  const fit = fitScaleToLimit(designWidth, designHeight, requested);
  const size = exportPixelSize(designWidth, designHeight, fit.scale);
  return { requested, scale: fit.scale, clamped: fit.clamped, width: size.width, height: size.height };
}

/** "x2", "x1.5", "x0.5" */
export function formatScale(scale: number): string {
  return `x${Math.round(scale * 100) / 100}`;
}

/** Sentence telling the user a size was reduced. */
export function clampNote(plan: RasterPlan): string | undefined {
  if (!plan.clamped) return undefined;
  const round = (scale: number) => Math.round(scale * 100) / 100;
  return m.exporting.errors.scaledDown(round(plan.scale), plan.width, plan.height, round(plan.requested), MAX_EXPORT_SIDE);
}

/** Pages up to this many pixels (4K UHD is 8.3 M) are painted in one pass, exactly like the editor canvas. */
export const SINGLE_PASS_PIXELS = 9_000_000;
/** Bigger pages are painted band by band, about this many pixels each, so the tab keeps responding. */
export const BAND_PIXELS = 4_000_000;

/** Splits the canvas height into bands of about `bandPixels` pixels (a single band up to `singlePass` pixels). */
export function planBands(width: number, height: number, bandPixels: number = BAND_PIXELS, singlePass: number = SINGLE_PASS_PIXELS): Array<{ y: number; rows: number }> {
  const total = width * height;
  const count = total <= singlePass ? 1 : Math.max(2, Math.ceil(total / bandPixels));
  const rows = Math.max(1, Math.ceil(height / count));
  const bands: Array<{ y: number; rows: number }> = [];
  for (let y = 0; y < height; y += rows) bands.push({ y, rows: Math.min(rows, height - y) });
  return bands;
}

/* ------------------------------------------------------------------ */
/* Options                                                            */
/* ------------------------------------------------------------------ */

/** Sorted, de-duplicated, in-range integer page indices. */
export function normalizePages(pages: readonly number[], pageCount: number): number[] {
  const set = new Set<number>();
  for (const p of pages) {
    if (Number.isInteger(p) && p >= 0 && p < pageCount) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

export interface ResolvedExport {
  format: ExportFormat;
  /** valid zero based indices, ascending */
  pages: number[];
  /** the pixel size and scale of the output (for a GIF or video: the picture's size and the renderer's scale) */
  plan: RasterPlan;
  quality: number;
  transparent: boolean;
  pdfMode: "standard" | "print";
  /** pdf: write the invisible text layer */
  pdfText: boolean;
  /** print pdf: millimetres the picture reaches beyond the design on every side, 0 .. 10 (0 for everything else) */
  bleedMm: number;
  /** print pdf: draw crop marks around the design (false for everything else) */
  cropMarks: boolean;
  embedFonts: boolean;
  /** gif / webm only: the timeline, frame rate and picture size of the animation; null for every other format */
  animation: AnimationPlan | null;
}

const FORMATS: ExportFormat[] = ["png", "jpg", "pdf", "svg", "gif", "webm"];

/** Validates and clamps user supplied options. Throws a plain Error for an unknown format. */
export function resolveExportOptions(design: Pick<Design, "width" | "height" | "pages">, opts: ExportOptions): ResolvedExport {
  if (!FORMATS.includes(opts.format)) throw new Error(`Unknown export format "${String(opts.format)}".`);
  const pages = normalizePages(opts.pages, design.pages.length);
  const animation = isAnimatedFormat(opts.format) ? planAnimation(design, pages, { format: opts.format, resolution: opts.resolution, fps: opts.fps }) : null;
  // bleed and crop marks are for the printer: only the print PDF has them
  const print = opts.format === "pdf" && opts.pdfMode === "print";
  const bleedMm = print ? clampNumber(opts.bleedMm as number, 0, MAX_BLEED_MM, 0) : 0;
  // the picture of a page with bleed shows the bleed too, so it is that much larger, and the 8192 px cap applies to all of it
  const bleedPx = bleedMm * MM_TO_PX * 2;
  return {
    format: opts.format,
    pages,
    plan: animation
      ? { requested: animation.width / design.width, scale: animation.width / design.width, clamped: false, width: animation.width, height: animation.height }
      : planRaster(design.width + bleedPx, design.height + bleedPx, opts),
    quality: clampNumber(opts.quality, MIN_QUALITY, 1, DEFAULT_QUALITY),
    transparent: opts.format === "png" && !!opts.transparent,
    pdfMode: opts.pdfMode === "print" ? "print" : "standard",
    pdfText: opts.pdfText !== false,
    bleedMm,
    cropMarks: print && opts.cropMarks === true,
    embedFonts: opts.embedFonts !== false,
    animation,
  };
}

/* ------------------------------------------------------------------ */
/* File names                                                         */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line no-control-regex -- a file name has no control characters
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

/** A title turned into something every file system accepts (Windows rules are the strictest). */
export function safeFileName(title: string | undefined | null, fallback = "Untitled design"): string {
  let name = String(title ?? "")
    .normalize("NFC")
    .replace(ILLEGAL_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (Array.from(name).length > 100) name = Array.from(name).slice(0, 100).join("").trim();
  if (RESERVED_NAMES.test(name)) name = `_${name}`;
  return name || fallback;
}

export const exportFileName = (title: string, extension: string) => `${safeFileName(title)}.${extension}`;
/** "Title - 3.png" (the page number is the page's position in the design, starting at 1). */
export const pageFileName = (title: string, pageNumber: number, extension: string) => `${safeFileName(title)} - ${pageNumber}.${extension}`;

/* ------------------------------------------------------------------ */
/* Summaries and size estimate                                        */
/* ------------------------------------------------------------------ */

export const pagesLabel = (count: number) => m.exporting.amounts.pages(count);

export function formatBytes(bytes: number): string {
  const { amounts } = m.exporting;
  if (!Number.isFinite(bytes) || bytes <= 0) return amounts.kb(0);
  if (bytes < 1024 * 1024) return amounts.kb(Math.max(1, Math.round(bytes / 1024)));
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? amounts.mb(mb, true) : amounts.mb(Math.round(mb), false);
}

export interface PageWeight {
  /** fraction of the page covered by photographs (0..1) */
  photo: number;
  /** the page background is a gradient, pattern or image rather than a flat colour */
  busyBackground: boolean;
  /** number of embedded raster images */
  images: number;
  /** text, shapes and everything else */
  elements: number;
  /** distinct font families used (each one is embedded in an SVG with fonts) */
  families: number;
  /** 0..1: how far apart the colours of a gradient background are (smooth ramps compress badly as PNG) */
  gradientSpan: number;
  /** the background is a repeating pattern (hard for JPEG) */
  patterned: boolean;
}

/** Largest channel difference between the first and last stop of a gradient, 0..1. */
function stopSpan(stops: Array<{ color: string }>): number {
  if (stops.length < 2) return 0;
  const a = parseColor(stops[0].color);
  const b = parseColor(stops[stops.length - 1].color);
  if (!a || !b) return 0.5;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) / 255;
}

/** `background: false` weighs the page as if its background were not painted (transparent PNG). */
export function weighPage(design: Pick<Design, "width" | "height">, page: Page, opts: { background?: boolean } = {}): PageWeight {
  const withBackground = opts.background !== false;
  const area = Math.max(1, design.width * design.height);
  let photoArea = 0;
  let images = 0;
  let elements = 0;
  const families = new Set<string>();
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    elements++;
    if (el.type === "image" && el.src) {
      images++;
      photoArea += Math.min(area, el.width * el.height);
    } else if (el.type === "group") {
      for (const child of el.children) visit(child);
    } else if (el.type === "shape" && el.fill?.type === "image") {
      images++;
    } else if (el.type === "text") {
      families.add(el.fontFamily);
      for (const p of el.paragraphs) for (const run of p.runs) if (run.font) families.add(run.font);
    } else if (el.type === "table" || el.type === "chart") {
      families.add(el.fontFamily);
    }
  };
  for (const el of page.elements) visit(el);
  const bg = page.background;
  if (bg.type === "image" && withBackground) {
    images++;
    photoArea += area;
  }
  return {
    photo: Math.min(1, photoArea / area),
    busyBackground: withBackground && bg.type !== "solid",
    images,
    elements,
    families: families.size,
    gradientSpan: withBackground && (bg.type === "linear" || bg.type === "radial") ? stopSpan(bg.stops) : 0,
    patterned: withBackground && bg.type === "pattern",
  };
}

/** JPEG size relative to quality 0.92 (measured: the encoder's size explodes above ~0.95 and flattens below 0.3). */
const QUALITY_CURVE: Array<[number, number]> = [
  [0.1, 0.18],
  [0.3, 0.295],
  [0.6, 0.415],
  [0.92, 1],
  [1, 3.45],
];

export function jpegQualityFactor(quality: number): number {
  const q = clampNumber(quality, QUALITY_CURVE[0][0], 1, DEFAULT_QUALITY);
  for (let i = 1; i < QUALITY_CURVE.length; i++) {
    const [x1, y1] = QUALITY_CURVE[i];
    if (q <= x1) {
      const [x0, y0] = QUALITY_CURVE[i - 1];
      return y0 + ((y1 - y0) * (q - x0)) / (x1 - x0);
    }
  }
  return QUALITY_CURVE[QUALITY_CURVE.length - 1][1];
}

/** Bytes of one design page as a PNG at 1x (the constants were fitted against real exports of ten varied pages). */
function pngBytesAt1x(w: PageWeight, pixels: number): number {
  const density = 0.04 + 0.009 * Math.min(w.elements, 40) + 1.7 * w.photo + 0.95 * Math.min(1, w.gradientSpan * 2.2) + (w.patterned ? 0.05 : 0);
  return pixels * density;
}

/** Bytes of one design page as a JPEG at 1x and quality 0.92. */
function jpegBytesAt1x(w: PageWeight, pixels: number): number {
  const density = 0.02 + 0.005 * Math.min(w.elements, 40) + 0.12 * w.photo + (w.patterned ? 0.18 : 0) + 0.015 * Math.min(1, w.gradientSpan * 2.2);
  return pixels * density;
}

/**
 * A rough prediction of the download size, good enough for a "~2.4 MB" hint (typically within a factor of 1.5,
 * never silly). Photographs and smooth gradients dominate PNG, patterns and busy pages dominate JPEG / PDF; an
 * SVG is the sum of its embedded images and fonts. Bytes grow slower than pixels (4x the pixels is about 3.2x the
 * PNG and 2.6x the JPEG), so the size factor is a power of the scale rather than its square.
 */
export function estimateExportBytes(design: Pick<Design, "width" | "height" | "pages">, opts: ExportOptions): number {
  const resolved = resolveExportOptions(design, opts);
  if (resolved.animation) return estimateAnimatedBytes(design, resolved.animation);
  const pixels1x = design.width * design.height;
  let total = 0;
  for (const index of resolved.pages) {
    const weight = weighPage(design, design.pages[index], { background: !(resolved.format === "png" && resolved.transparent) });
    switch (resolved.format) {
      case "png":
        total += pngBytesAt1x(weight, pixels1x) * resolved.plan.scale ** 1.7 + 2000;
        break;
      case "jpg":
      case "pdf":
        total += jpegBytesAt1x(weight, pixels1x) * resolved.plan.scale ** 1.38 * jpegQualityFactor(resolved.quality) + 3000;
        break;
      case "svg":
        total += 3000 + weight.elements * 700 + weight.images * 250000 + (resolved.embedFonts ? weight.families * 43000 : 0);
        break;
      case "gif":
      case "webm":
        break; // animations are estimated as a whole above, not page by page
    }
  }
  return Math.round(total);
}

/** The size of a GIF or video: what is on each chosen page decides what a frame costs, the timeline how many there are. */
function estimateAnimatedBytes(design: Pick<Design, "width" | "height" | "pages">, plan: AnimationPlan): number {
  const weights = plan.pages.map((i) => weighPage(design, design.pages[i]));
  const motions = plan.pages.map((i) => pageMotion(design, design.pages[i]));
  return plan.format === "webm" ? estimateWebmBytes(plan, weights, motions) : estimateGifBytes(plan, weights, motions);
}

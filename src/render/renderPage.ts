/**
 * The single paint routine. The editor canvas, thumbnails, export and the
 * template previews all go through `renderPage`, so what you see is what you
 * export.
 */
import { evaluateAnimation, isHidden, pageDuration, type AnimState } from "@/core/animation";
import { blendOf } from "@/core/blend";
import { DEG } from "@/core/geometry";
import { recolorSvg, setSvgStrokeWidth } from "@/core/svg";
import type { BlendMode, Design, DesignElement, Fill, GraphicElement, ID, ImageElement, LineElement, Page, Rect, ShapeElement, Stroke } from "@/core/types";
import { drawChart, drawTable } from "./drawBlocks";
import { drawTextElement } from "./drawText";
import { ensureFont, isFontReady } from "./fonts";
import { cssFilter, filterKey, isNeutral, renderFiltered, supportsCtxFilter } from "./imageFilters";
import { getImage, getSvgImage, loadImage, loadSvgImage, type Drawable, drawableSize } from "./images";
import { paintFor } from "./paint";
import { getPath2D, shapeFillRule } from "./shapePaths";
import { layoutText, resolveRunStyle } from "./textLayout";

type Ctx = CanvasRenderingContext2D;

export interface RenderOptions {
  /** design-space rectangle to paint; defaults to the whole page */
  clip?: Rect;
  /** canvas pixels per design pixel (zoom x devicePixelRatio, or export scale) */
  scale: number;
  /** skip the page background (transparent PNG) */
  transparent?: boolean;
  /** element ids that must not be painted (text being edited, image being cropped) */
  hide?: ReadonlySet<ID>;
  /** paint the page `time` seconds into its animations (entrance, exit, emphasis); without it elements sit at rest */
  animation?: { time: number };
  /**
   * Design pixels to paint beyond every edge of the page (a print export with bleed). The canvas then starts `bleed`
   * above and left of the page, and `clip` is measured from that corner; the background is stretched over the larger
   * area, and elements that hang over the edge of the page are painted there. Elements keep their place on the page.
   */
  bleed?: number;
}

interface Env {
  scale: number;
  hide?: ReadonlySet<ID>;
  /** something was not ready yet (image, font) - the caller repaints later */
  pending: boolean;
  /** how many blended elements the one being painted is inside of: which layer it would be painted on */
  depth: number;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function applyStroke(ctx: Ctx, s: Stroke): void {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = s.cap ?? (s.style === "dotted" ? "round" : "butt");
  ctx.lineJoin = s.join ?? "round";
  if (s.style === "dashed") ctx.setLineDash([s.width * 3, s.width * 2]);
  else if (s.style === "dotted") ctx.setLineDash([0.01, s.width * 2]);
  else ctx.setLineDash([]);
}

/** Paints only the shadow of `path` (the shape itself is moved off-canvas). */
function shadowOnly(ctx: Ctx, el: DesignElement, env: Env, paint: () => void): void {
  const sh = el.shadow;
  if (!sh) return;
  const OFF = 20000;
  const m = ctx.getTransform();
  ctx.save();
  ctx.translate(-OFF, 0);
  ctx.shadowColor = sh.color;
  ctx.shadowBlur = sh.blur * env.scale;
  ctx.shadowOffsetX = -m.a * -OFF + sh.x * env.scale;
  ctx.shadowOffsetY = -m.b * -OFF + sh.y * env.scale;
  paint();
  ctx.restore();
}

function textFontsReady(el: DesignElement, env: Env): void {
  if (el.type !== "text") return;
  const seen = new Set<string>();
  const check = (family: string, weight: number, italic: boolean) => {
    const key = `${family}|${weight}|${italic}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!isFontReady(family, weight, italic)) {
      env.pending = true;
      void ensureFont(family, weight, italic);
    }
  };
  for (const p of el.paragraphs) {
    if (!p.runs.length) check(el.fontFamily, el.fontWeight, el.italic);
    for (const r of p.runs) {
      const s = resolveRunStyle(el, r);
      check(s.family, s.weight, s.italic);
    }
  }
}

/* ------------------------------------------------------------------ */
/* background                                                          */
/* ------------------------------------------------------------------ */

function paintBackground(ctx: Ctx, fill: Fill, w: number, h: number, env: Env): void {
  if (fill.type === "image") {
    ctx.fillStyle = "#e9ebf0";
    ctx.fillRect(0, 0, w, h);
    const img = getImage(fill.src);
    if (!img) {
      env.pending = true;
      return;
    }
    const { width: iw, height: ih } = drawableSize(img);
    if (fill.fit === "tile") {
      const p = ctx.createPattern(img as CanvasImageSource, "repeat");
      if (p) {
        ctx.fillStyle = p;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      const s = fill.fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      const dw = iw * s;
      const dh = ih * s;
      ctx.drawImage(img as CanvasImageSource, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    if (fill.dim) {
      ctx.fillStyle = fill.dim > 0 ? `rgba(0,0,0,${Math.min(0.9, fill.dim)})` : `rgba(255,255,255,${Math.min(0.9, -fill.dim)})`;
      ctx.fillRect(0, 0, w, h);
    }
    return;
  }
  ctx.fillStyle = paintFor(ctx, fill, w, h, env.scale);
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* element painters                                                    */
/* ------------------------------------------------------------------ */

function drawShape(ctx: Ctx, el: ShapeElement, env: Env): void {
  const path = getPath2D(el.shape, el.width, el.height, { radius: el.radius, params: el.params, path: el.path });
  const rule = shapeFillRule(el.shape);
  const hasFill = !!el.fill && el.fill.type !== "image";
  const hasStroke = !!el.stroke && el.stroke.width > 0;
  if (el.shadow) {
    shadowOnly(ctx, el, env, () => {
      ctx.fillStyle = "#000";
      if (hasFill) ctx.fill(path, rule);
      if (hasStroke) {
        applyStroke(ctx, el.stroke as Stroke);
        ctx.stroke(path);
      } else if (!hasFill) {
        ctx.stroke(path);
      }
    });
  }
  if (hasFill) {
    ctx.fillStyle = paintFor(ctx, el.fill as Fill, el.width, el.height, env.scale);
    ctx.fill(path, rule);
  }
  if (hasStroke) {
    applyStroke(ctx, el.stroke as Stroke);
    ctx.stroke(path);
  }
}

function arrowHead(ctx: Ctx, kind: string, size: number, color: string, lw: number): number {
  // draws at origin pointing +x; returns how far the shaft should be shortened
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.setLineDash([]);
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  let inset = 0;
  ctx.beginPath();
  switch (kind) {
    case "arrow":
      // notched arrowhead
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * 0.55);
      ctx.lineTo(-size * 0.7, 0);
      ctx.lineTo(-size, size * 0.55);
      ctx.closePath();
      ctx.fill();
      inset = size * 0.55;
      break;
    case "triangle":
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * 0.55);
      ctx.lineTo(-size, size * 0.55);
      ctx.closePath();
      ctx.fill();
      inset = size * 0.9;
      break;
    case "open-arrow":
      ctx.moveTo(-size, -size * 0.6);
      ctx.lineTo(0, 0);
      ctx.lineTo(-size, size * 0.6);
      ctx.stroke();
      break;
    case "circle":
      ctx.arc(-size * 0.4, 0, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      inset = size * 0.6;
      break;
    case "square":
      ctx.rect(-size * 0.8, -size * 0.4, size * 0.8, size * 0.8);
      ctx.fill();
      inset = size * 0.7;
      break;
    case "diamond":
      ctx.moveTo(0, 0);
      ctx.lineTo(-size * 0.5, -size * 0.45);
      ctx.lineTo(-size, 0);
      ctx.lineTo(-size * 0.5, size * 0.45);
      ctx.closePath();
      ctx.fill();
      inset = size * 0.8;
      break;
    case "bar":
      ctx.moveTo(0, -size * 0.55);
      ctx.lineTo(0, size * 0.55);
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
  return inset;
}

function drawLine(ctx: Ctx, el: LineElement, env: Env): void {
  const s = el.stroke;
  const head = Math.max(s.width * 3.2, 14);
  const startInset = el.startArrow !== "none" ? head * 0.1 : 0;
  ctx.save();
  if (el.shadow) {
    ctx.shadowColor = el.shadow.color;
    ctx.shadowBlur = el.shadow.blur * env.scale;
    ctx.shadowOffsetX = el.shadow.x * env.scale;
    ctx.shadowOffsetY = el.shadow.y * env.scale;
  }
  // shaft
  let x0 = 0;
  let x1 = el.width;
  ctx.save();
  ctx.translate(el.width, 0);
  const endInset = el.endArrow !== "none" ? arrowHead(ctx, el.endArrow, head, s.color, s.width) : 0;
  ctx.restore();
  ctx.save();
  ctx.translate(0, 0);
  ctx.scale(-1, 1);
  const startShaft = el.startArrow !== "none" ? arrowHead(ctx, el.startArrow, head, s.color, s.width) : 0;
  ctx.restore();
  x0 += startShaft + startInset;
  x1 -= endInset;
  applyStroke(ctx, s);
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(Math.max(x0, x1), 0);
  ctx.stroke();
  ctx.restore();
}

const placeholderIcon = new Path2D("M4 18 L9 11 L13 16 L16 12 L22 18 Z M17 7 A2 2 0 1 1 16.99 7 Z");

function drawImageElement(ctx: Ctx, el: ImageElement, env: Env): void {
  const w = el.width;
  const h = el.height;
  const clip = getPath2D(el.mask || "rect", w, h, { radius: el.radius });
  if (!el.src) {
    ctx.save();
    ctx.clip(clip);
    ctx.fillStyle = "#e7e9ef";
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h) * 0.26;
    ctx.translate(w / 2 - s / 2, h / 2 - s / 2);
    ctx.scale(s / 26, s / 26);
    ctx.fillStyle = "#b3b8c4";
    ctx.fill(placeholderIcon);
    ctx.restore();
    return;
  }
  const img = getImage(el.src);
  if (!img) {
    env.pending = true;
    ctx.save();
    ctx.clip(clip);
    ctx.fillStyle = "#eceef3";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  const dx = el.crop.x * w;
  const dy = el.crop.y * h;
  const dw = el.crop.w * w;
  const dh = el.crop.h * h;
  const neutral = isNeutral(el.filter);

  if (el.shadow) {
    shadowOnly(ctx, el, env, () => {
      ctx.fillStyle = "#000";
      ctx.fill(clip);
    });
  }
  ctx.save();
  ctx.clip(clip);
  if (neutral) {
    ctx.drawImage(img as CanvasImageSource, dx, dy, dw, dh);
  } else {
    const filtered = renderFiltered({ key: el.src, img, dx, dy, dw, dh, boxW: w, boxH: h, filter: el.filter, scale: env.scale });
    ctx.drawImage(filtered, 0, 0, w, h);
  }
  ctx.restore();
  if (el.stroke && el.stroke.width > 0) {
    applyStroke(ctx, el.stroke);
    ctx.stroke(clip);
  }
}

const svgCache = new WeakMap<GraphicElement, string>();
/** Final markup of a graphic after recolouring (shared with the SVG exporter). */
export function graphicMarkup(el: GraphicElement): string {
  let s = svgCache.get(el);
  if (s === undefined) {
    s = recolorSvg(el.svg, el.colors);
    if (el.strokeWidth) s = setSvgStrokeWidth(s, el.strokeWidth);
    svgCache.set(el, s);
  }
  return s;
}

function drawGraphic(ctx: Ctx, el: GraphicElement, env: Env): void {
  const img = getSvgImage(graphicMarkup(el));
  if (!img) {
    env.pending = true;
    return;
  }
  if (el.shadow) {
    ctx.shadowColor = el.shadow.color;
    ctx.shadowBlur = el.shadow.blur * env.scale;
    ctx.shadowOffsetX = el.shadow.x * env.scale;
    ctx.shadowOffsetY = el.shadow.y * env.scale;
  }
  ctx.drawImage(img as CanvasImageSource, 0, 0, el.width, el.height);
}

/* ------------------------------------------------------------------ */
/* element dispatcher                                                  */
/* ------------------------------------------------------------------ */

function drawElement(ctx: Ctx, el: DesignElement, env: Env): void {
  if (el.hidden || env.hide?.has(el.id)) return;
  const mode = blendOf(el);
  if (mode && drawBlended(ctx, el, env, mode)) return;
  drawFramed(ctx, el, env);
}

/** The element in its own place, turn, size, opacity and blur. */
function drawFramed(ctx: Ctx, el: DesignElement, env: Env): void {
  ctx.save();
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  if (el.rotation) ctx.rotate(el.rotation * DEG);
  if (el.flipH || el.flipV) ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
  ctx.translate(-el.width / 2, -el.height / 2);
  ctx.globalAlpha *= el.opacity;
  if (el.blur && supportsCtxFilter) ctx.filter = `blur(${(el.blur * env.scale).toFixed(2)}px)`;

  // one broken element must never take the whole page down with it
  try {
    paintByType(ctx, el, env);
  } catch (err) {
    if (!reported.has(el.id)) {
      reported.add(el.id);
      console.warn(`Craftly: could not paint ${el.type} ${el.id}`, err);
    }
  }
  ctx.restore();
}

const reported = new Set<string>();

/* ------------------------------------------------------------------ */
/* blend modes                                                         */
/* ------------------------------------------------------------------ */

/**
 * An element with a blend mode is painted on a layer of its own, which is then laid over what is painted so far the way the
 * mode mixes the two. A layer is a canvas at least as big as the one that is painted (it grows, and is never made smaller:
 * a thumbnail painted between two paints of the page would otherwise make it again each time). There is one for each level
 * of blended elements inside each other: a group that is mixed as one has elements that can have a mode of their own, mixed
 * on its layer.
 */
const layers: HTMLCanvasElement[] = [];

/** Lets go of the layers and of the memory behind them (it can be hundreds of MB after a big export); the next element with a mode makes one again. */
export function releaseLayers(): void {
  for (const canvas of layers) canvas.width = canvas.height = 0;
  layers.length = 0;
}

/** The layer for this level, big enough for `like`; nothing where no layer can be made: no document, a canvas with no size (which could not be laid over anything), no context. */
function layerAt(level: number, like: HTMLCanvasElement): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  if (typeof document === "undefined" || !like.width || !like.height) return null;
  const canvas = (layers[level] ??= document.createElement("canvas"));
  if (canvas.width < like.width) canvas.width = like.width;
  if (canvas.height < like.height) canvas.height = like.height;
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

/** Paints `el` on a layer and lays that over `ctx` as `mode`. False, with nothing painted, when there is no layer to paint on: the element is then painted straight. */
function drawBlended(ctx: Ctx, el: DesignElement, env: Env, mode: BlendMode): boolean {
  const { width, height } = ctx.canvas;
  const layer = layerAt(env.depth, ctx.canvas);
  if (!layer) return false;
  const now = ctx.getTransform();
  const own = layer.ctx;
  own.save();
  own.setTransform(1, 0, 0, 1, 0, 0);
  own.clearRect(0, 0, width, height);
  // the layer has the transform that the page has now, so the element finds its place in it as it finds it on the page
  own.setTransform(now.a, now.b, now.c, now.d, now.e, now.f);
  env.depth++;
  try {
    drawFramed(own, el, env);
  } finally {
    env.depth--;
  }
  own.restore();
  // laid over in device pixels, inside the clip the page has now and with the opacity that came down from what the element is in
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = mode;
  ctx.drawImage(layer.canvas, 0, 0, width, height, 0, 0, width, height);
  ctx.restore();
  return true;
}

function paintByType(ctx: Ctx, el: DesignElement, env: Env): void {
  switch (el.type) {
    case "text":
      textFontsReady(el, env);
      drawTextElement(ctx, el, { scale: env.scale });
      break;
    case "shape":
      drawShape(ctx, el, env);
      break;
    case "line":
      drawLine(ctx, el, env);
      break;
    case "image":
      drawImageElement(ctx, el, env);
      break;
    case "graphic":
      drawGraphic(ctx, el, env);
      break;
    case "group":
      for (const child of el.children) drawElement(ctx, child, env);
      break;
    case "table":
      drawTable(ctx, el);
      break;
    case "chart":
      drawChart(ctx, el);
      break;
  }
}

/* ------------------------------------------------------------------ */
/* animation                                                           */
/* ------------------------------------------------------------------ */

/**
 * The part of an element that is visible, as rectangles in the element's own frame (origin at its centre), or
 * null when all of it is. Combines the wipe / mask window with the typewriter reveal.
 */
function revealRects(el: DesignElement, st: AnimState): Array<[number, number, number, number]> | null {
  const rects: Array<[number, number, number, number]> = [];
  const { width: w, height: h } = el;
  if (st.clip) rects.push([(st.clip.x0 - 0.5) * w, (st.clip.y0 - 0.5) * h, (st.clip.x1 - st.clip.x0) * w, (st.clip.y1 - st.clip.y0) * h]);
  if (st.reveal !== null) {
    if (el.type === "text") {
      // typed line by line: finished lines show whole, the current one up to the typing position
      const layout = layoutText(el);
      let left = st.reveal * layout.lines.reduce((sum, line) => sum + line.width, 0);
      for (const line of layout.lines) {
        const pad = line.size * 0.25;
        const shown = Math.min(line.width, Math.max(0, left));
        left -= line.width;
        if (shown <= 0) continue;
        const done = shown >= line.width - 0.01;
        const x0 = line.x - pad * 2;
        // a finished line keeps a margin for italics and shadows; the line being typed ends exactly at the cursor
        const x1 = done ? line.x + line.width + pad * 2 : line.x + shown;
        rects.push([x0 - w / 2, line.y - pad - h / 2, x1 - x0, line.height + pad * 2]);
      }
      if (!rects.length) rects.push([0, 0, 0, 0]);
    } else {
      // anything else: a left-to-right wipe whose far left stays open
      rects.push([-w, -h, w / 2 + st.reveal * w, h * 2]);
    }
  }
  return rects.length ? rects : null;
}

/** Draws a top-level element with its animation state applied: motion, scale, rotation, fade and the reveal window. */
function drawAnimated(ctx: Ctx, el: DesignElement, env: Env, st: AnimState, unit: number): void {
  if (el.hidden || env.hide?.has(el.id) || isHidden(st)) return;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ctx.save();
  ctx.translate(cx + st.dx * unit, cy + st.dy * unit);
  if (st.rotate) ctx.rotate(st.rotate * DEG);
  if (st.scale !== 1) ctx.scale(st.scale, st.scale);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha *= st.opacity;
  const rects = revealRects(el, st);
  if (rects || st.innerDx || st.innerDy) {
    // the window and the content offset are expressed in the element's own, possibly rotated, frame
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate(el.rotation * DEG);
    if (rects) {
      ctx.beginPath();
      for (const [x, y, w, h] of rects) ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.translate(st.innerDx * el.width, st.innerDy * el.height);
    if (el.rotation) ctx.rotate(-el.rotation * DEG);
    ctx.translate(-cx, -cy);
  }
  drawElement(ctx, el, env);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Paints `page` into `ctx`. The context's transform is reset; `opts.scale`
 * maps design px to canvas px and `opts.clip` selects the visible region.
 * Returns true when everything (images, fonts) was ready.
 */
export function renderPage(ctx: Ctx, design: Pick<Design, "width" | "height">, page: Page, opts: RenderOptions): boolean {
  const { scale, clip } = opts;
  const env: Env = { scale, hide: opts.hide, pending: false, depth: 0 };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const bleed = opts.bleed && opts.bleed > 0 ? opts.bleed : 0;
  ctx.setTransform(scale, 0, 0, scale, -((clip?.x ?? 0) - bleed) * scale, -((clip?.y ?? 0) - bleed) * scale);
  ctx.beginPath();
  ctx.rect(0 - bleed, 0 - bleed, design.width + bleed * 2, design.height + bleed * 2);
  ctx.clip();
  if (!opts.transparent) {
    // with a bleed the background is painted as that of a page larger by the bleed on every side, so a colour, a gradient,
    // a pattern or a picture covers the bleed too (a picture is a little larger for it: by 2 x bleed over the page's size)
    if (bleed) {
      ctx.save();
      ctx.translate(-bleed, -bleed);
      paintBackground(ctx, page.background, design.width + bleed * 2, design.height + bleed * 2, env);
      ctx.restore();
    } else paintBackground(ctx, page.background, design.width, design.height, env);
  }
  if (opts.animation) {
    const duration = pageDuration(page);
    const unit = Math.min(design.width, design.height);
    for (const el of page.elements) {
      const state = el.animation ? evaluateAnimation(el.animation, opts.animation.time, duration) : null;
      if (state) drawAnimated(ctx, el, env, state, unit);
      else drawElement(ctx, el, env);
    }
  } else {
    for (const el of page.elements) drawElement(ctx, el, env);
  }
  ctx.restore();
  return !env.pending;
}

interface Resources {
  images: Set<string>;
  svgs: Set<string>;
  fonts: Map<string, { family: string; weight: number; italic: boolean }>;
}

export function collectResources(page: Page): Resources {
  const r: Resources = { images: new Set(), svgs: new Set(), fonts: new Map() };
  if (page.background.type === "image") r.images.add(page.background.src);
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    if (el.type === "image" && el.src) r.images.add(el.src);
    else if (el.type === "graphic") r.svgs.add(graphicMarkup(el));
    else if (el.type === "group") el.children.forEach(visit);
    else if (el.type === "text") {
      for (const p of el.paragraphs) {
        for (const run of p.runs.length ? p.runs : [null]) {
          const s = resolveRunStyle(el, run);
          r.fonts.set(`${s.family}|${s.weight}|${s.italic}`, { family: s.family, weight: s.weight, italic: s.italic });
        }
      }
    } else if (el.type === "table" || el.type === "chart") {
      r.fonts.set(`${el.fontFamily}|400|false`, { family: el.fontFamily, weight: 400, italic: false });
      r.fonts.set(`${el.fontFamily}|700|false`, { family: el.fontFamily, weight: 700, italic: false });
    }
  };
  page.elements.forEach(visit);
  return r;
}

/** Waits until every image, graphic and font the page needs is ready. */
export async function preparePage(page: Page): Promise<void> {
  const res = collectResources(page);
  await Promise.all([
    ...[...res.images].map((s) => loadImage(s)),
    ...[...res.svgs].map((s) => loadSvgImage(s)),
    ...[...res.fonts.values()].map((f) => ensureFont(f.family, f.weight, f.italic)),
  ]);
}

/**
 * Renders a page to a new canvas `width` px wide (height follows the design's
 * aspect ratio). Waits for fonts and images first - used by thumbnails and export.
 */
export async function renderPageToCanvas(
  design: Pick<Design, "width" | "height">,
  page: Page,
  opts: { width: number; transparent?: boolean; /** seconds into the page's animations */ time?: number },
): Promise<HTMLCanvasElement> {
  const scale = opts.width / design.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(design.width * scale));
  canvas.height = Math.max(1, Math.round(design.height * scale));
  const ctx = canvas.getContext("2d")!;
  for (let attempt = 0; attempt < 3; attempt++) {
    await preparePage(page);
    const complete = renderPage(ctx, design, page, { scale, transparent: opts.transparent, animation: opts.time === undefined ? undefined : { time: opts.time } });
    if (complete) break;
  }
  return canvas;
}

export type { Drawable };
export { cssFilter, filterKey };

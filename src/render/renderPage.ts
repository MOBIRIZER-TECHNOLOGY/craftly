/**
 * The single paint routine. The editor canvas, thumbnails, export and the
 * template previews all go through `renderPage`, so what you see is what you
 * export.
 */
import {
  captionAt,
  captionOutlineIsDark,
  clipCaptions,
  clipCaptionStyle,
  clipPlayTime,
  clipPlayingLength,
  evaluateAnimation,
  isHidden,
  pageDuration,
  type AnimState,
} from "@/core/animation";
import { blendOf } from "@/core/blend";
import { clipFilter } from "@/core/factory";
import { DEG } from "@/core/geometry";
import { lineLabelPoint, linePath, lineRouteAngles } from "@/core/lineRoute";
import { recolorSvg, setSvgStrokeWidth } from "@/core/svg";
import type {
  BlendMode,
  CaptionStyle,
  Design,
  DesignElement,
  Fill,
  GraphicElement,
  ID,
  ImageElement,
  LineElement,
  Page,
  Rect,
  ShapeElement,
  Stroke,
  VideoElement,
} from "@/core/types";
import { drawChart, drawTable } from "./drawBlocks";
import { drawTextElement } from "./drawText";
import { ensureFont, isFontReady } from "./fonts";
import { cssFilter, filterKey, isNeutral, renderFiltered, supportsCtxFilter } from "./imageFilters";
import { getImage, getSvgImage, loadImage, loadSvgImage, type Drawable, drawableSize, videoPosterKey } from "./images";
import { paintFor } from "./paint";
import { getPath2D, shapeFillRule } from "./shapePaths";
import { layoutText, resolveRunStyle } from "./textLayout";
import { clipFinished, clipWaiting, playingFrame } from "./videos";

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
   * Play the clips of video elements at `animation.time` (src/render/videos.ts), with their sound when `sound` is set: for what
   * plays in real time (Present, the animation preview, a video recorded as it plays). Without it a clip is its first frame, which
   * is what every still download and a GIF (painted faster or slower than real time) hold. `time` plays them that many seconds into the
   * page without animating anything else (Present with reduced motion); without it they play at `animation.time`. `frame` hands
   * over the picture of a clip `time` seconds into the page instead of the clip's own <video> (a video download made frame by frame,
   * which decodes the clips itself); null draws its first frame.
   */
  playVideos?: { sound?: boolean; time?: number; frame?: ClipFrameSource };
  /**
   * Design pixels to paint beyond every edge of the page (a print export with bleed). The canvas then starts `bleed`
   * above and left of the page, and `clip` is measured from that corner; the background is stretched over the larger
   * area, and elements that hang over the edge of the page are painted there. Elements keep their place on the page.
   */
  bleed?: number;
  /**
   * Paint only the top-level elements `from` up to (not including) `to`, in the same place and inside the same clip as the
   * whole page: with `background` false the page background is left out, with `keep` the canvas is not emptied first, so
   * the part goes over what is there. Used while something is dragged (dragLayers.ts); animations are not looked at.
   */
  part?: { from: number; to: number; background: boolean; keep?: boolean };
}

interface Env {
  scale: number;
  hide?: ReadonlySet<ID>;
  /** something was not ready yet (image, font) - the caller repaints later */
  pending: boolean;
  /** how many blended elements the one being painted is inside of: which layer it would be painted on */
  depth: number;
  /** clips play, this many seconds into the page (RenderOptions.playVideos) */
  videoTime?: number;
  videoSound?: boolean;
  videoFrame?: ClipFrameSource;
}

/** The picture of clip `el` when its page has been shown for `time` seconds, or null for its first frame. */
export type ClipFrameSource = (el: VideoElement, time: number) => CanvasImageSource | null;

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
  const routed = el.routing && el.routing !== "straight" && el.route && el.route.length >= 2;
  if (routed) {
    const path = linePath(el);
    const angles = lineRouteAngles(el);
    const last = path[path.length - 1];
    ctx.save();
    ctx.translate(last.x, last.y);
    ctx.rotate(angles.end);
    if (el.endArrow !== "none") arrowHead(ctx, el.endArrow, head, s.color, s.width);
    ctx.restore();
    ctx.save();
    ctx.translate(path[0].x, path[0].y);
    ctx.rotate(angles.start + Math.PI);
    if (el.startArrow !== "none") arrowHead(ctx, el.startArrow, head, s.color, s.width);
    ctx.restore();
    applyStroke(ctx, s);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    if (el.routing === "curved" && path.length === 4) ctx.bezierCurveTo(path[1].x, path[1].y, path[2].x, path[2].y, path[3].x, path[3].y);
    else for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  } else {
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
  }
  if (el.label) {
    const point = lineLabelPoint(el);
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.font = "600 14px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(el.label, point.x, point.y - 8);
    ctx.restore();
  }
  ctx.restore();
}

const placeholderIcon = new Path2D("M4 18 L9 11 L13 16 L16 12 L22 18 Z M17 7 A2 2 0 1 1 16.99 7 Z");

function drawImageElement(ctx: Ctx, el: ImageElement, env: Env): void {
  const w = el.width;
  const h = el.height;
  const clip = getPath2D(el.mask || "rect", w, h, { radius: el.radius, path: el.maskPath });
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
  if (el.crop.rotation) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(el.crop.rotation * DEG);
    ctx.translate(-w / 2, -h / 2);
  }
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

/** The caption line of `el` when its page has been shown for `time` seconds, or null (none, or the clip waits or has finished). */
export function captionNow(el: VideoElement, time: number): string | null {
  const lines = clipCaptions(el);
  if (!lines.length || clipWaiting(el, time) || clipFinished(el, time)) return null;
  return captionAt(lines, clipPlayTime(el, time) % clipPlayingLength(el))?.text ?? null;
}

/** Most lines a caption is wrapped to; what does not fit ends in an ellipsis. */
const CAPTION_LINES = 3;

/** Breaks `text` into lines no wider than `max` (a word longer than that gets a line of its own), at most CAPTION_LINES of them. */
function wrapCaption(ctx: Ctx, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= CAPTION_LINES) return lines;
  const kept = lines.slice(0, CAPTION_LINES);
  kept[CAPTION_LINES - 1] = `${kept[CAPTION_LINES - 1]}…`;
  return kept;
}

const CAPTION_FONTS: Record<CaptionStyle["font"] & string, string> = {
  sans: 'Inter, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
};
const CAPTION_SIZES: Record<CaptionStyle["size"] & string, number> = { s: 0.75, m: 1, l: 1.35 };

/**
 * A caption over a clip `w` x `h`, centred and sized to the clip, as its style says (clipCaptionStyle): over its bottom, middle or
 * top; small, medium or large; on a dark band, a light band, or on nothing, the words then outlined in the colour that stands out
 * against theirs.
 */
export function drawCaption(ctx: Ctx, text: string, w: number, h: number, style: Required<CaptionStyle> = clipCaptionStyle({})): void {
  const size = Math.max(6, Math.min(h * 0.075, w * 0.06) * CAPTION_SIZES[style.size]);
  ctx.save();
  ctx.font = `600 ${size}px ${CAPTION_FONTS[style.font]}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapCaption(ctx, text, w * 0.86);
  const lineHeight = size * 1.3;
  const pad = size * 0.45;
  const width = Math.min(w * 0.94, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
  const height = lines.length * lineHeight + pad;
  const margin = h * 0.06;
  const top = style.place === "top" ? margin : style.place === "middle" ? (h - height) / 2 : h - margin - height;
  if (style.band !== "none") {
    ctx.fillStyle = style.band === "light" ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.66)";
    ctx.beginPath();
    // a browser without roundRect (Safari before 16) gets square corners
    if (typeof ctx.roundRect === "function") ctx.roundRect((w - width) / 2, top, width, height, size * 0.3);
    else ctx.rect((w - width) / 2, top, width, height);
    ctx.fill();
  } else {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, size * 0.18);
    ctx.strokeStyle = captionOutlineIsDark(style.color) ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.9)";
    lines.forEach((l, i) => ctx.strokeText(l, w / 2, top + pad / 2 + lineHeight * (i + 0.5)));
  }
  ctx.fillStyle = style.color;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + pad / 2 + lineHeight * (i + 0.5)));
  ctx.restore();
}

/** A clip: the frame that plays now, or its first frame, drawn as a picture is (crop, filter, frame shape, shadow, outline). */
function drawVideoElement(ctx: Ctx, el: VideoElement, env: Env): void {
  const w = el.width;
  const h = el.height;
  const clip = getPath2D(el.mask || "rect", w, h, { radius: el.radius, path: el.maskPath });
  const playing = env.videoTime === undefined ? null : env.videoFrame ? env.videoFrame(el, env.videoTime) : playingFrame(el, env.videoTime, env.videoSound);
  const frame: CanvasImageSource | null = playing ?? (getImage(videoPosterKey(el)) as CanvasImageSource | null);
  if (el.shadow) {
    shadowOnly(ctx, el, env, () => {
      ctx.fillStyle = "#000";
      ctx.fill(clip);
    });
  }
  ctx.save();
  ctx.clip(clip);
  if (!frame) {
    // still loading (the page is painted again when it has come), or a clip this browser cannot play: a dark box with a play sign
    if (env.videoTime === undefined) env.pending = true;
    ctx.fillStyle = "#2a2f3a";
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h) * 0.18;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(w / 2 - s * 0.4, h / 2 - s / 2);
    ctx.lineTo(w / 2 + s * 0.5, h / 2);
    ctx.lineTo(w / 2 - s * 0.4, h / 2 + s / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    if (el.crop.rotation) {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(el.crop.rotation * DEG);
      ctx.translate(-w / 2, -h / 2);
    }
    const filter = clipFilter(el);
    if (isNeutral(filter)) ctx.drawImage(frame, el.crop.x * w, el.crop.y * h, el.crop.w * w, el.crop.h * h);
    else {
      const key = playing ? `play:${el.id}` : videoPosterKey(el);
      const out = renderFiltered({
        key,
        img: frame as Drawable | HTMLVideoElement,
        dx: el.crop.x * w,
        dy: el.crop.y * h,
        dw: el.crop.w * w,
        dh: el.crop.h * h,
        boxW: w,
        boxH: h,
        filter,
        scale: env.scale,
        live: !!playing,
      });
      ctx.drawImage(out, 0, 0, w, h);
    }
  }
  // captions show while the clip plays (Present, the editor's Play, a video download); at rest it is its first frame, without them
  if (env.videoTime !== undefined) {
    const text = captionNow(el, env.videoTime);
    if (text) drawCaption(ctx, text, w, h, clipCaptionStyle(el));
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
    case "video":
      drawVideoElement(ctx, el, env);
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
  const videoTime = opts.playVideos?.time ?? opts.animation?.time;
  if (opts.playVideos && videoTime !== undefined) {
    env.videoTime = videoTime;
    env.videoSound = !!opts.playVideos.sound;
    env.videoFrame = opts.playVideos.frame;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const part = opts.part;
  if (!part?.keep) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const bleed = opts.bleed && opts.bleed > 0 ? opts.bleed : 0;
  ctx.setTransform(scale, 0, 0, scale, -((clip?.x ?? 0) - bleed) * scale, -((clip?.y ?? 0) - bleed) * scale);
  ctx.beginPath();
  ctx.rect(0 - bleed, 0 - bleed, design.width + bleed * 2, design.height + bleed * 2);
  ctx.clip();
  if (!opts.transparent && part?.background !== false) {
    // with a bleed the background is painted as that of a page larger by the bleed on every side, so a colour, a gradient,
    // a pattern or a picture covers the bleed too (a picture is a little larger for it: by 2 x bleed over the page's size)
    if (bleed) {
      ctx.save();
      ctx.translate(-bleed, -bleed);
      paintBackground(ctx, page.background, design.width + bleed * 2, design.height + bleed * 2, env);
      ctx.restore();
    } else paintBackground(ctx, page.background, design.width, design.height, env);
  }
  if (part) {
    for (let i = Math.max(0, part.from); i < Math.min(part.to, page.elements.length); i++) drawElement(ctx, page.elements[i], env);
  } else if (opts.animation) {
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
    else if (el.type === "video") r.images.add(videoPosterKey(el));
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

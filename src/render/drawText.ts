/**
 * Paints a laid-out TextElement onto a canvas: fills, decorations, list
 * markers, gradient paint, the ten text effects and curved text.
 * The context is expected to be positioned at the element's top-left corner.
 */
import { rgba } from "@/core/color";
import { DEG } from "@/core/geometry";
import type { TextElement, TextEffect } from "@/core/types";
import { curveGeometry, layoutText, type CurveGeometry, type LayoutLine, type LayoutSegment, type TextLayout } from "./textLayout";

type Ctx = CanvasRenderingContext2D;
type Paint = string | CanvasGradient;

export interface TextEnv {
  /** canvas px per design px, needed because shadow blur/offset are not scaled by the transform */
  scale: number;
}

interface PassOptions {
  mode: "fill" | "stroke";
  /** overrides the segment colour */
  paint?: Paint;
  dx?: number;
  dy?: number;
  lineWidth?: number;
  /** skip underline / strike (shadow copies) */
  decorations?: boolean;
  /** draw list markers */
  markers?: boolean;
}

const hasLetterSpacing = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;

function drawGlyphs(ctx: Ctx, text: string, x: number, y: number, spacing: number, mode: "fill" | "stroke"): void {
  const paint = mode === "fill" ? ctx.fillText.bind(ctx) : ctx.strokeText.bind(ctx);
  if (!spacing) {
    paint(text, x, y);
    return;
  }
  if (hasLetterSpacing) {
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${spacing}px`;
    paint(text, x, y);
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = "0px";
    return;
  }
  let cx = x;
  for (const ch of Array.from(text)) {
    paint(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

function paintSegment(ctx: Ctx, seg: LayoutSegment, line: LayoutLine, o: PassOptions, gradient: Paint | null): void {
  if (!seg.text || (seg.isSpace && !seg.style.underline && !seg.style.strike)) return;
  const x = line.x + seg.x + (o.dx ?? 0);
  const y = line.y + line.baseline + (o.dy ?? 0);
  ctx.font = seg.font;
  const paint = o.paint ?? gradient ?? seg.style.color;
  if (o.mode === "fill") ctx.fillStyle = paint;
  else {
    ctx.strokeStyle = paint;
    ctx.lineWidth = o.lineWidth ?? 1;
  }
  if (!seg.isSpace) drawGlyphs(ctx, seg.text, x, y, seg.style.spacing, o.mode);
  if (o.mode === "fill" && o.decorations !== false) {
    const t = Math.max(1, seg.style.size * 0.06);
    ctx.fillStyle = o.paint ?? gradient ?? seg.style.color;
    if (seg.style.underline) ctx.fillRect(x, y + seg.style.size * 0.1, seg.width, t);
    if (seg.style.strike) ctx.fillRect(x, y - seg.style.size * 0.3, seg.width, t);
  }
}

function paintMarker(ctx: Ctx, line: LayoutLine, o: PassOptions, gradient: Paint | null): void {
  if (!line.marker) return;
  ctx.font = line.marker.font;
  ctx.fillStyle = o.paint ?? gradient ?? line.marker.style.color;
  ctx.fillText(line.marker.text, line.marker.x + (o.dx ?? 0), line.y + line.baseline + (o.dy ?? 0));
}

function pass(ctx: Ctx, layout: TextLayout, o: PassOptions, gradient: Paint | null): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const line of layout.lines) {
    for (const seg of line.segments) paintSegment(ctx, seg, line, o, gradient);
    if (o.mode === "fill" && o.markers !== false) paintMarker(ctx, line, o, gradient);
  }
}

/** The gradient axis of a text element in its own space (origin at the top-left of the text box). */
function gradientAxis(el: TextElement, w: number, h: number) {
  const g = el.gradient;
  if (!g) return null;
  const a = (g.angle - 90) * DEG;
  const cx = w / 2;
  const cy = h / 2;
  const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
  return { x0: cx - Math.cos(a) * half, y0: cy - Math.sin(a) * half, x1: cx + Math.cos(a) * half, y1: cy + Math.sin(a) * half, stops: g.stops };
}

function makeGradient(ctx: Ctx, axis: NonNullable<ReturnType<typeof gradientAxis>>, p0: { x: number; y: number }, p1: { x: number; y: number }): CanvasGradient {
  const grad = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
  for (const s of axis.stops) grad.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
  return grad;
}

function linearGradient(ctx: Ctx, el: TextElement, w: number, h: number): CanvasGradient | null {
  const axis = gradientAxis(el, w, h);
  return axis ? makeGradient(ctx, axis, { x: axis.x0, y: axis.y0 }, { x: axis.x1, y: axis.y1 }) : null;
}

const shadowOf = (e: TextEffect, fs: number) => {
  const dist = ((e.offset ?? 50) / 100) * fs * 0.22;
  const dir = ((e.direction ?? 45) * Math.PI) / 180;
  return { dx: Math.cos(dir) * dist, dy: Math.sin(dir) * dist, blur: ((e.blur ?? 0) / 100) * fs * 0.35, dist };
};

/* ------------------------------------------------------------------ */
/* effects                                                             */
/* ------------------------------------------------------------------ */

function drawWithEffect(ctx: Ctx, el: TextElement, layout: TextLayout, env: TextEnv, gradient: Paint | null): void {
  const e = el.effect;
  const fs = el.fontSize;
  const base: PassOptions = { mode: "fill" };
  const thick = Math.max(1, ((e.thickness ?? 50) / 100) * fs * 0.09 + fs * 0.01);

  switch (e.kind) {
    case "shadow": {
      const s = shadowOf(e, fs);
      ctx.save();
      ctx.shadowColor = rgba(e.color ?? "#000000", 1 - (e.transparency ?? 60) / 100);
      ctx.shadowOffsetX = s.dx * env.scale;
      ctx.shadowOffsetY = s.dy * env.scale;
      ctx.shadowBlur = s.blur * env.scale;
      pass(ctx, layout, base, gradient);
      ctx.restore();
      return;
    }
    case "lift": {
      const k = (e.intensity ?? 50) / 100;
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.18 + k * 0.3})`;
      ctx.shadowOffsetY = fs * 0.06 * env.scale;
      ctx.shadowBlur = fs * (0.12 + k * 0.4) * env.scale;
      pass(ctx, layout, base, gradient);
      ctx.restore();
      return;
    }
    case "hollow": {
      pass(ctx, layout, { mode: "stroke", lineWidth: thick, decorations: false }, gradient);
      return;
    }
    case "outline": {
      pass(ctx, layout, { mode: "stroke", lineWidth: thick * 2, paint: e.color ?? "#000000" }, null);
      pass(ctx, layout, base, gradient);
      return;
    }
    case "splice": {
      // two hollow copies, the second one offset and tinted
      const s = shadowOf({ ...e, offset: e.offset ?? 50, direction: e.direction ?? 45 }, fs);
      const lw = Math.max(1, thick * 0.7);
      pass(ctx, layout, { mode: "stroke", lineWidth: lw, paint: e.color ?? "#8b3dff", dx: s.dx, dy: s.dy, decorations: false }, null);
      pass(ctx, layout, { mode: "stroke", lineWidth: lw, decorations: false }, gradient);
      return;
    }
    case "echo": {
      const s = shadowOf({ ...e, offset: e.offset ?? 50, direction: e.direction ?? 45 }, fs);
      const color = e.color ?? null;
      ctx.save();
      ctx.globalAlpha *= 0.28;
      pass(ctx, layout, { mode: "fill", dx: s.dx * 2, dy: s.dy * 2, paint: color ?? undefined, decorations: false }, gradient);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= 0.55;
      pass(ctx, layout, { mode: "fill", dx: s.dx, dy: s.dy, paint: color ?? undefined, decorations: false }, gradient);
      ctx.restore();
      pass(ctx, layout, base, gradient);
      return;
    }
    case "glitch": {
      const d = Math.max(1, ((e.offset ?? 50) / 100) * fs * 0.06 + fs * 0.01);
      ctx.save();
      ctx.globalAlpha *= 0.9;
      pass(ctx, layout, { mode: "fill", dx: -d, dy: 0, paint: "#ff2d95", decorations: false }, null);
      pass(ctx, layout, { mode: "fill", dx: d, dy: 0, paint: "#19e6ff", decorations: false }, null);
      ctx.restore();
      pass(ctx, layout, base, gradient);
      return;
    }
    case "neon": {
      const glow = e.color ?? "#ff2fb3";
      const k = 0.6 + ((e.intensity ?? 50) / 100) * 0.9;
      for (const f of [0.55, 0.24, 0.1]) {
        ctx.save();
        ctx.shadowColor = glow;
        ctx.shadowBlur = fs * f * k * env.scale;
        pass(ctx, layout, { mode: "fill", paint: glow, decorations: false }, null);
        ctx.restore();
      }
      pass(ctx, layout, base, gradient);
      return;
    }
    case "background": {
      const pad = fs * (0.12 + ((e.spread ?? 50) / 100) * 0.28);
      const radius = ((e.roundness ?? 50) / 100) * (fs * 0.6);
      ctx.save();
      ctx.fillStyle = rgba(e.color ?? "#ffe066", 1 - (e.transparency ?? 0) / 100);
      for (const line of layout.lines) {
        if (!line.segments.length || line.width <= 0) continue;
        const x = line.x - pad;
        const y = line.y + (line.height - line.size * 1.15) / 2 - pad * 0.15;
        const w = line.width + pad * 2;
        const h = line.size * 1.15 + pad * 0.3;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(radius, h / 2));
        else ctx.rect(x, y, w, h);
        ctx.fill();
      }
      ctx.restore();
      pass(ctx, layout, base, gradient);
      return;
    }
    default:
      pass(ctx, layout, base, gradient);
  }
}

/* ------------------------------------------------------------------ */
/* curved text                                                         */
/* ------------------------------------------------------------------ */

function drawCurved(ctx: Ctx, el: TextElement, layout: TextLayout, geo: CurveGeometry): void {
  const { radius, dir, sag } = geo;
  const cx = layout.width / 2;
  const axis = gradientAxis(el, layout.width, layout.height);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const line of layout.lines) {
    const y0 = line.y + line.baseline + (dir > 0 ? 0 : sag);
    // the circle centre sits below the baseline for arches, above for bows
    const cy = dir > 0 ? y0 + radius : y0 - radius;
    for (const seg of line.segments) {
      if (seg.isSpace || !seg.text) continue;
      ctx.font = seg.font;
      ctx.fillStyle = seg.style.color;
      let pos = line.x + seg.x;
      for (const ch of Array.from(seg.text)) {
        const w = ctx.measureText(ch).width + seg.style.spacing;
        const theta = (pos + w / 2 - cx) / radius;
        const tx = cx + radius * Math.sin(theta);
        const ty = dir > 0 ? cy - radius * Math.cos(theta) : cy + radius * Math.cos(theta);
        const rot = dir > 0 ? theta : -theta;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(rot);
        if (axis) {
          // each letter is drawn in its own translated + rotated frame, so the gradient axis (defined for the whole
          // text box) is mapped into that frame; otherwise every letter would sample the first colour stop
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const local = (x: number, y: number) => ({ x: (x - tx) * cos + (y - ty) * sin, y: -(x - tx) * sin + (y - ty) * cos });
          ctx.fillStyle = makeGradient(ctx, axis, local(axis.x0, axis.y0), local(axis.x1, axis.y1));
        }
        ctx.fillText(ch, -w / 2, 0);
        ctx.restore();
        pos += w;
      }
    }
  }
}

/* ------------------------------------------------------------------ */

export function drawTextElement(ctx: Ctx, el: TextElement, env: TextEnv): void {
  const layout = layoutText(el);
  const gradient = linearGradient(ctx, el, layout.width, layout.height);
  // a curve too slight to bend the text (|curve| < 0.52) has no geometry: such text is drawn straight
  const curve = el.curve ? curveGeometry(el, layout) : null;
  ctx.save();
  if (curve) drawCurved(ctx, el, layout, curve);
  else drawWithEffect(ctx, el, layout, env, gradient);
  ctx.restore();
}

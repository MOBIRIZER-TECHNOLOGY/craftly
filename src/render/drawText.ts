/**
 * Paints a laid-out TextElement onto a canvas: fills, decorations, list
 * markers, gradient paint, the ten text effects and curved text.
 * The context is expected to be positioned at the element's top-left corner.
 *
 * The effects are written once, against a `Painter`: a pass over the text and the band behind each line. Straight text
 * has a painter that writes each segment at its place on the line; curved text one that sets each letter on the arc, so
 * that every effect (the shadows, the glow of Neon, the hollow and offset copies, the Background band) bends with it.
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

/** What the effects paint with: the same calls lay the text on a line or on the arc of curved text. */
interface Painter {
  /** one pass over the text; `withGradient` false leaves the text's gradient out (a copy that has a colour of its own) */
  pass(o: PassOptions, withGradient: boolean): void;
  /** the box of the Background effect behind each line, in the context's fill style */
  band(pad: number, radius: number): void;
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

/** The box of the Background effect for one line, as the straight painter draws it. */
const bandHeight = (line: LayoutLine, pad: number) => line.size * 1.15 + pad * 0.3;

/* ------------------------------------------------------------------ */
/* straight text                                                       */
/* ------------------------------------------------------------------ */

function straightPainter(ctx: Ctx, layout: TextLayout, gradient: Paint | null): Painter {
  return {
    pass: (o, withGradient) => pass(ctx, layout, o, withGradient ? gradient : null),
    band(pad, radius) {
      for (const line of layout.lines) {
        if (!line.segments.length || line.width <= 0) continue;
        const h = bandHeight(line, pad);
        const x = line.x - pad;
        const y = line.y + (line.height - line.size * 1.15) / 2 - pad * 0.15;
        const w = line.width + pad * 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(radius, h / 2));
        else ctx.rect(x, y, w, h);
        ctx.fill();
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* curved text                                                         */
/* ------------------------------------------------------------------ */

/**
 * Curved text, one letter at a time: each is turned to follow a circle whose centre sits below the baseline for an arch and
 * above it for a bow. A pass offset by (dx, dy) moves the whole arc, as it moves the whole line of straight text; the canvas
 * draws shadows (Shadow, Lift, Neon) in the space of the page, so they fall the same way under every letter however it is turned.
 */
function curvedPainter(ctx: Ctx, el: TextElement, layout: TextLayout, geo: CurveGeometry): Painter {
  const { radius, dir, sag } = geo;
  const cx = layout.width / 2;
  const axis = gradientAxis(el, layout.width, layout.height);
  const centreY = (line: LayoutLine) => {
    const y0 = line.y + line.baseline + (dir > 0 ? 0 : sag);
    return dir > 0 ? y0 + radius : y0 - radius;
  };
  return {
    pass(o, withGradient) {
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const dx = o.dx ?? 0;
      const dy = o.dy ?? 0;
      for (const line of layout.lines) {
        const cy = centreY(line);
        for (const seg of line.segments) {
          if (seg.isSpace || !seg.text) continue;
          ctx.font = seg.font;
          let pos = line.x + seg.x;
          for (const ch of Array.from(seg.text)) {
            const w = ctx.measureText(ch).width + seg.style.spacing;
            const theta = (pos + w / 2 - cx) / radius;
            const tx = cx + radius * Math.sin(theta) + dx;
            const ty = (dir > 0 ? cy - radius * Math.cos(theta) : cy + radius * Math.cos(theta)) + dy;
            const rot = dir > 0 ? theta : -theta;
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(rot);
            let paint: Paint = o.paint ?? seg.style.color;
            if (!o.paint && withGradient && axis) {
              // each letter is drawn in its own translated + rotated frame, so the gradient axis (defined for the whole
              // text box) is mapped into that frame; otherwise every letter would sample the first colour stop
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);
              const local = (x: number, y: number) => ({ x: (x - tx) * cos + (y - ty) * sin, y: -(x - tx) * sin + (y - ty) * cos });
              paint = makeGradient(ctx, axis, local(axis.x0, axis.y0), local(axis.x1, axis.y1));
            }
            if (o.mode === "fill") {
              ctx.fillStyle = paint;
              ctx.fillText(ch, -w / 2, 0);
            } else {
              ctx.strokeStyle = paint;
              ctx.lineWidth = o.lineWidth ?? 1;
              ctx.strokeText(ch, -w / 2, 0);
            }
            ctx.restore();
            pos += w;
          }
        }
      }
    },
    band(pad, roundness) {
      // the straight box bent onto the arc: a thick stroke along a circle with the letters' centre, from the start of the
      // line to its end (each lengthened by the padding), whose middle is where the middle of the straight box is
      for (const line of layout.lines) {
        if (!line.segments.length || line.width <= 0) continue;
        const h = bandHeight(line, pad);
        const middle = line.height / 2 - line.baseline; // from the baseline, negative above it
        // for an arch "up" points away from the centre, for a bow towards it
        const r = dir > 0 ? radius - middle : radius + middle;
        if (r <= 0) continue;
        // a box with rounded corners has round ends on the arc, a square one square ends
        const round = roundness > 0;
        // a round cap reaches half the band's height past the end of the stroke: start and stop that much sooner
        const inset = round ? h / 2 / r : 0;
        let t0 = (line.x - pad - cx) / radius + inset;
        let t1 = (line.x + line.width + pad - cx) / radius - inset;
        if (t1 < t0) t0 = t1 = (t0 + t1) / 2;
        ctx.beginPath();
        if (dir > 0) ctx.arc(cx, centreY(line), r, t0 - Math.PI / 2, t1 - Math.PI / 2, false);
        else ctx.arc(cx, centreY(line), r, Math.PI / 2 - t0, Math.PI / 2 - t1, true);
        ctx.lineWidth = h;
        ctx.lineCap = round ? "round" : "butt";
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* effects                                                             */
/* ------------------------------------------------------------------ */

function drawWithEffect(ctx: Ctx, el: TextElement, env: TextEnv, p: Painter): void {
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
      p.pass(base, true);
      ctx.restore();
      return;
    }
    case "lift": {
      const k = (e.intensity ?? 50) / 100;
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.18 + k * 0.3})`;
      ctx.shadowOffsetY = fs * 0.06 * env.scale;
      ctx.shadowBlur = fs * (0.12 + k * 0.4) * env.scale;
      p.pass(base, true);
      ctx.restore();
      return;
    }
    case "hollow": {
      p.pass({ mode: "stroke", lineWidth: thick, decorations: false }, true);
      return;
    }
    case "outline": {
      p.pass({ mode: "stroke", lineWidth: thick * 2, paint: e.color ?? "#000000" }, false);
      p.pass(base, true);
      return;
    }
    case "splice": {
      // two hollow copies, the second one offset and tinted
      const s = shadowOf({ ...e, offset: e.offset ?? 50, direction: e.direction ?? 45 }, fs);
      const lw = Math.max(1, thick * 0.7);
      p.pass({ mode: "stroke", lineWidth: lw, paint: e.color ?? "#8b3dff", dx: s.dx, dy: s.dy, decorations: false }, false);
      p.pass({ mode: "stroke", lineWidth: lw, decorations: false }, true);
      return;
    }
    case "echo": {
      const s = shadowOf({ ...e, offset: e.offset ?? 50, direction: e.direction ?? 45 }, fs);
      const color = e.color ?? null;
      ctx.save();
      ctx.globalAlpha *= 0.28;
      p.pass({ mode: "fill", dx: s.dx * 2, dy: s.dy * 2, paint: color ?? undefined, decorations: false }, true);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= 0.55;
      p.pass({ mode: "fill", dx: s.dx, dy: s.dy, paint: color ?? undefined, decorations: false }, true);
      ctx.restore();
      p.pass(base, true);
      return;
    }
    case "glitch": {
      const d = Math.max(1, ((e.offset ?? 50) / 100) * fs * 0.06 + fs * 0.01);
      ctx.save();
      ctx.globalAlpha *= 0.9;
      p.pass({ mode: "fill", dx: -d, dy: 0, paint: "#ff2d95", decorations: false }, false);
      p.pass({ mode: "fill", dx: d, dy: 0, paint: "#19e6ff", decorations: false }, false);
      ctx.restore();
      p.pass(base, true);
      return;
    }
    case "neon": {
      const glow = e.color ?? "#ff2fb3";
      const k = 0.6 + ((e.intensity ?? 50) / 100) * 0.9;
      for (const f of [0.55, 0.24, 0.1]) {
        ctx.save();
        ctx.shadowColor = glow;
        ctx.shadowBlur = fs * f * k * env.scale;
        p.pass({ mode: "fill", paint: glow, decorations: false }, false);
        ctx.restore();
      }
      p.pass(base, true);
      return;
    }
    case "background": {
      const pad = fs * (0.12 + ((e.spread ?? 50) / 100) * 0.28);
      const radius = ((e.roundness ?? 50) / 100) * (fs * 0.6);
      ctx.save();
      ctx.fillStyle = rgba(e.color ?? "#ffe066", 1 - (e.transparency ?? 0) / 100);
      p.band(pad, radius);
      ctx.restore();
      p.pass(base, true);
      return;
    }
    default:
      p.pass(base, true);
  }
}

/* ------------------------------------------------------------------ */

export function drawTextElement(ctx: Ctx, el: TextElement, env: TextEnv): void {
  const layout = layoutText(el);
  const gradient = linearGradient(ctx, el, layout.width, layout.height);
  // a curve too slight to bend the text (|curve| < 0.52) has no geometry: such text is drawn straight
  const curve = el.curve ? curveGeometry(el, layout) : null;
  ctx.save();
  drawWithEffect(ctx, el, env, curve ? curvedPainter(ctx, el, layout, curve) : straightPainter(ctx, layout, gradient));
  ctx.restore();
}

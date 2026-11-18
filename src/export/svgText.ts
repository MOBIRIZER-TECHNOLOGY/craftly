/**
 * Text elements as SVG. The positions come straight from `layoutText` (the same layout the canvas paints and
 * the text editor measures), so every word lands where it does on screen: one <tspan> per layout segment
 * with an absolute x / baseline y. The ten text effects and curved text mirror render/drawText.ts:
 *
 *   shadow, lift, neon  -> <filter> (blurred, tinted copy of the glyphs, like canvas shadowBlur)
 *   hollow, outline, splice, echo, glitch, background -> extra stroked / offset copies and <rect>s
 *   curved text         -> <textPath> on a circular arc, one <text> per word; every effect above is drawn on it too
 *                          (offset copies move the arc, the Background box is a thick stroke along it)
 *
 * Underline and strike-through are drawn as rectangles with the canvas geometry (not text-decoration), so
 * they match the on-screen result exactly and also cover the spaces between words.
 */
import type { TextEffect, TextElement } from "@/core/types";
import { cssFontFamily } from "@/render/fonts";
import { curveGeometry, layoutText, type CurveGeometry, type LayoutLine, type LayoutSegment, type RunStyle, type TextLayout } from "@/render/textLayout";
import { inverseLinear, type Matrix } from "./links";
import { colorAttr, esc, num, paintAttr, svgFontFamily, type PaintRef, type SvgDoc } from "./svgUtil";

export interface TextRenderContext {
  doc: SvgDoc;
  /** page space -> element space, including the element's own rotation / flip (for screen-space shadow offsets) */
  matrix: Matrix;
  /** product of the opacities of the element and its ancestors */
  alpha: number;
}

interface PassSpec {
  mode: "fill" | "stroke";
  /** overrides the segment colours (and the gradient) */
  paint?: PaintRef;
  /** offset of the whole pass, element space */
  dx?: number;
  dy?: number;
  lineWidth?: number;
  /** underline / strike rectangles (fill passes only; default true) */
  decorations?: boolean;
  /** multiplies the element's alpha (echo / glitch layers) */
  alphaMul?: number;
  /** filter id wrapped around the pass (shadows, glow) */
  filter?: string;
}

const shadowOf = (e: TextEffect, fs: number) => {
  const dist = ((e.offset ?? 50) / 100) * fs * 0.22;
  const dir = ((e.direction ?? 45) * Math.PI) / 180;
  return { dx: Math.cos(dir) * dist, dy: Math.sin(dir) * dist, blur: ((e.blur ?? 0) / 100) * fs * 0.35 };
};

/** Text attributes shared by every <tspan> of a pass; tspans only repeat what differs. */
function baseStyle(el: TextElement): RunStyle {
  return {
    family: el.fontFamily,
    weight: el.fontWeight,
    italic: el.italic,
    size: el.fontSize,
    color: el.color,
    underline: el.underline,
    strike: el.strike,
    spacing: (el.letterSpacing / 1000) * el.fontSize,
  };
}

function fontAttrs(style: RunStyle, base: RunStyle | null): string {
  let out = "";
  if (!base || style.family !== base.family) out += ` font-family="${svgFontFamily(cssFontFamily(style.family))}"`;
  if (!base || style.size !== base.size) out += ` font-size="${num(style.size)}"`;
  if (!base || style.weight !== base.weight) out += ` font-weight="${num(style.weight)}"`;
  if (!base ? style.italic : style.italic !== base.italic) out += ` font-style="${style.italic ? "italic" : "normal"}"`;
  if (!base ? style.spacing : style.spacing !== base.spacing) out += ` letter-spacing="${num(style.spacing)}"`;
  return out;
}

function segmentPaint(spec: PassSpec, gradient: PaintRef | null, style: RunStyle): PaintRef {
  return spec.paint ?? gradient ?? { kind: "color", color: style.color };
}

/** Is there anything to paint on this segment in this kind of pass? Mirrors paintSegment's early return. */
function paintable(seg: LayoutSegment): boolean {
  return !!seg.text && (!seg.isSpace || seg.style.underline || seg.style.strike);
}

function pass(el: TextElement, layout: TextLayout, gradient: PaintRef | null, cx: TextRenderContext, spec: PassSpec): string {
  const base = baseStyle(el);
  const alpha = cx.alpha * (spec.alphaMul ?? 1);
  const dx = spec.dx ?? 0;
  const dy = spec.dy ?? 0;
  const prop = spec.mode === "fill" ? "fill" : "stroke";
  const basePaint = segmentPaint(spec, gradient, base);
  const baseAttr = paintAttr(prop, basePaint, alpha);
  const tspans: string[] = [];
  const rects: string[] = [];

  const run = (text: string, x: number, y: number, style: RunStyle, paint: PaintRef) => {
    const paintText = paintAttr(prop, paint, alpha);
    tspans.push(`<tspan x="${num(x)}" y="${num(y)}"${fontAttrs(style, base)}${paintText !== baseAttr ? paintText : ""}>${esc(text)}</tspan>`);
  };

  for (const line of layout.lines) {
    const y = line.y + line.baseline + dy;
    for (const seg of line.segments) {
      if (!paintable(seg)) continue;
      const x = line.x + seg.x + dx;
      const paint = segmentPaint(spec, gradient, seg.style);
      if (!seg.isSpace) run(seg.text, x, y, seg.style, paint);
      if (spec.mode === "fill" && spec.decorations !== false) {
        const t = Math.max(1, seg.style.size * 0.06);
        if (seg.style.underline)
          rects.push(`<rect x="${num(x)}" y="${num(y + seg.style.size * 0.1)}" width="${num(seg.width)}" height="${num(t)}"${paintAttr("fill", paint, alpha)}/>`);
        if (seg.style.strike)
          rects.push(`<rect x="${num(x)}" y="${num(y - seg.style.size * 0.3)}" width="${num(seg.width)}" height="${num(t)}"${paintAttr("fill", paint, alpha)}/>`);
      }
    }
    if (spec.mode === "fill" && line.marker) {
      const mark = line.marker;
      run(mark.text, mark.x + dx, y, mark.style, spec.paint ?? gradient ?? { kind: "color", color: mark.style.color });
    }
  }
  if (!tspans.length && !rects.length) return "";

  let text = "";
  if (tspans.length) {
    const stroke = spec.mode === "stroke" ? ` fill="none" stroke-width="${num(spec.lineWidth ?? 1)}" stroke-linejoin="round" stroke-linecap="round"` : "";
    text = `<text${fontAttrs(base, null)}${stroke}${baseAttr}>${tspans.join("")}</text>`;
  }
  const body = text + rects.join("");
  return spec.filter ? `<g filter="url(#${spec.filter})">${body}</g>` : body;
}

/* ------------------------------------------------------------------ */
/* effects                                                            */
/* ------------------------------------------------------------------ */

function textRegion(layout: TextLayout, fs: number): { x: number; y: number; w: number; h: number } {
  const pad = fs * 0.75;
  return { x: -pad, y: -pad, w: layout.width + pad * 2, h: layout.height + pad * 2 };
}

/** What the effects are written with: passes over the text and the band behind each line, on a line or on the arc (as in render/drawText.ts). */
interface Painter {
  pass(spec: PassSpec): string;
  /** the box of the Background effect behind each line, in `color` at `opacity` */
  band(pad: number, radius: number, color: string, opacity: number): string;
}

function straightPainter(el: TextElement, layout: TextLayout, gradient: PaintRef | null, cx: TextRenderContext): Painter {
  return {
    pass: (spec) => pass(el, layout, gradient, cx, spec),
    band(pad, radius, color, opacity) {
      const fill = colorAttr("fill", color, opacity);
      let boxes = "";
      for (const line of layout.lines) {
        if (!line.segments.length || line.width <= 0) continue;
        const x = line.x - pad;
        const y = line.y + (line.height - line.size * 1.15) / 2 - pad * 0.15;
        const w = line.width + pad * 2;
        const h = line.size * 1.15 + pad * 0.3;
        const r = Math.max(0, Math.min(radius, h / 2, w / 2));
        boxes += `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${r ? ` rx="${num(r)}"` : ""}${fill}/>`;
      }
      return boxes;
    },
  };
}

function drawWithEffect(el: TextElement, layout: TextLayout, cx: TextRenderContext, painter: Painter): string {
  const e = el.effect;
  const fs = el.fontSize;
  const doc = cx.doc;
  const base: PassSpec = { mode: "fill" };
  const thick = Math.max(1, ((e.thickness ?? 50) / 100) * fs * 0.09 + fs * 0.01);
  const region = textRegion(layout, fs);
  const P = (spec: PassSpec) => painter.pass(spec);

  /** a canvas style shadow: offsets are in screen space, so rotate them back into element space */
  const shadowPass = (dxScreen: number, dyScreen: number, blur: number, color: string, opacity: number, includeSource = true, paint?: PaintRef) => {
    const local = inverseLinear(cx.matrix, dxScreen, dyScreen);
    const filter = doc.shadowFilter({ dx: local.x, dy: local.y, sigma: blur / 2, color, opacity, includeSource, region });
    return P({ ...base, filter, paint, decorations: paint ? false : undefined });
  };

  switch (e.kind) {
    case "shadow": {
      const s = shadowOf(e, fs);
      return shadowPass(s.dx, s.dy, s.blur, e.color ?? "#000000", 1 - (e.transparency ?? 60) / 100);
    }
    case "lift": {
      const k = (e.intensity ?? 50) / 100;
      return shadowPass(0, fs * 0.06, fs * (0.12 + k * 0.4), "#000000", 0.18 + k * 0.3);
    }
    case "hollow":
      return P({ mode: "stroke", lineWidth: thick, decorations: false });
    case "outline":
      return P({ mode: "stroke", lineWidth: thick * 2, paint: { kind: "color", color: e.color ?? "#000000" } }) + P(base);
    case "splice": {
      const s = shadowOf({ ...e, offset: e.offset ?? 50, direction: e.direction ?? 45 }, fs);
      const lw = Math.max(1, thick * 0.7);
      return (
        P({ mode: "stroke", lineWidth: lw, paint: { kind: "color", color: e.color ?? "#8b3dff" }, dx: s.dx, dy: s.dy, decorations: false }) +
        P({ mode: "stroke", lineWidth: lw, decorations: false })
      );
    }
    case "echo": {
      const s = shadowOf({ ...e, offset: e.offset ?? 50, direction: e.direction ?? 45 }, fs);
      const paint: PaintRef | undefined = e.color ? { kind: "color", color: e.color } : undefined;
      return (
        P({ mode: "fill", dx: s.dx * 2, dy: s.dy * 2, paint, decorations: false, alphaMul: 0.28 }) +
        P({ mode: "fill", dx: s.dx, dy: s.dy, paint, decorations: false, alphaMul: 0.55 }) +
        P(base)
      );
    }
    case "glitch": {
      const d = Math.max(1, ((e.offset ?? 50) / 100) * fs * 0.06 + fs * 0.01);
      return (
        P({ mode: "fill", dx: -d, dy: 0, paint: { kind: "color", color: "#ff2d95" }, decorations: false, alphaMul: 0.9 }) +
        P({ mode: "fill", dx: d, dy: 0, paint: { kind: "color", color: "#19e6ff" }, decorations: false, alphaMul: 0.9 }) +
        P(base)
      );
    }
    case "neon": {
      const glow = e.color ?? "#ff2fb3";
      const k = 0.6 + ((e.intensity ?? 50) / 100) * 0.9;
      let out = "";
      for (const f of [0.55, 0.24, 0.1]) out += shadowPass(0, 0, fs * f * k, glow, 1, true, { kind: "color", color: glow });
      return out + P(base);
    }
    case "background": {
      const pad = fs * (0.12 + ((e.spread ?? 50) / 100) * 0.28);
      const radius = ((e.roundness ?? 50) / 100) * (fs * 0.6);
      return painter.band(pad, radius, e.color ?? "#ffe066", cx.alpha * (1 - (e.transparency ?? 0) / 100)) + P(base);
    }
    default:
      return P(base);
  }
}

/* ------------------------------------------------------------------ */
/* curved text                                                         */
/* ------------------------------------------------------------------ */

/**
 * Curved text on <textPath>: one arc per line, shared by every pass of the effect, and one <text> per word on it. A pass that is
 * offset moves the whole arc (a translated group), as the canvas moves it; the Background box is a thick stroke along the arc.
 */
function curvedPainter(el: TextElement, layout: TextLayout, gradient: PaintRef | null, cx: TextRenderContext, geo: CurveGeometry): Painter {
  const { radius, dir, sag } = geo;
  const centerX = layout.width / 2;
  const doc = cx.doc;
  const centerYOf = (line: LayoutLine) => {
    const y0 = line.y + line.baseline + (dir > 0 ? 0 : sag);
    return dir > 0 ? y0 + radius : y0 - radius;
  };
  /** the point of a circle round the line's centre that lies under `pos` (a distance along the baseline) */
  const pointOn = (line: LayoutLine, r: number, pos: number) => {
    const theta = (pos - centerX) / radius;
    const centerY = centerYOf(line);
    return { x: centerX + r * Math.sin(theta), y: dir > 0 ? centerY - r * Math.cos(theta) : centerY + r * Math.cos(theta) };
  };
  const arcPath = (line: LayoutLine, r: number, from: number, to: number) => {
    const a = pointOn(line, r, from);
    const b = pointOn(line, r, to);
    const large = (to - from) / radius > Math.PI ? 1 : 0;
    return `M${num(a.x)} ${num(a.y)}A${num(r)} ${num(r)} 0 ${large} ${dir > 0 ? 1 : 0} ${num(b.x)} ${num(b.y)}`;
  };
  const arcs = new Map<LayoutLine, string>();
  const arcOf = (line: LayoutLine) => {
    let id = arcs.get(line);
    if (!id) {
      // the arc starts at the line's left edge and runs a little past its end so the last glyph is not cut off
      const span = Math.min(line.width + Math.max(line.size, 24), radius * (Math.PI * 2 - 0.05));
      id = doc.id("arc");
      doc.defs.push(`<path id="${id}" d="${arcPath(line, radius, line.x, line.x + span)}"/>`);
      arcs.set(line, id);
    }
    return id;
  };
  return {
    pass(spec) {
      const alpha = cx.alpha * (spec.alphaMul ?? 1);
      const prop = spec.mode === "fill" ? "fill" : "stroke";
      const stroke = spec.mode === "stroke" ? ` fill="none" stroke-width="${num(spec.lineWidth ?? 1)}" stroke-linejoin="round" stroke-linecap="round"` : "";
      let out = "";
      for (const line of layout.lines) {
        const words = line.segments.filter((s) => !s.isSpace && s.text);
        if (!words.length) continue;
        const id = arcOf(line);
        for (const seg of words) {
          const paint = spec.paint ?? gradient ?? ({ kind: "color", color: seg.style.color } as PaintRef);
          // the canvas places curved text one character at a time (no kerning, no ligatures): switch both off here too
          const textAttr = `${fontAttrs(seg.style, null)}${stroke}${paintAttr(prop, paint, alpha)} style="font-kerning:none;font-variant-ligatures:none"`;
          out += `<text${textAttr}><textPath xlink:href="#${id}" startOffset="${num(seg.x)}">${esc(seg.text)}</textPath></text>`;
        }
      }
      if (!out) return "";
      const dx = spec.dx ?? 0;
      const dy = spec.dy ?? 0;
      if (dx || dy) out = `<g transform="translate(${num(dx)} ${num(dy)})">${out}</g>`;
      return spec.filter ? `<g filter="url(#${spec.filter})">${out}</g>` : out;
    },
    band(pad, roundness, color, opacity) {
      const strokeColor = colorAttr("stroke", color, opacity);
      let out = "";
      for (const line of layout.lines) {
        if (!line.segments.length || line.width <= 0) continue;
        const h = line.size * 1.15 + pad * 0.3;
        const middle = line.height / 2 - line.baseline;
        const r = dir > 0 ? radius - middle : radius + middle;
        if (r <= 0) continue;
        const round = roundness > 0;
        // in distance along the baseline: a round cap reaches half the band's height past each end
        const inset = round ? ((h / 2) * radius) / r : 0;
        let from = line.x - pad + inset;
        let to = line.x + line.width + pad - inset;
        if (to < from) from = to = (from + to) / 2;
        out += `<path d="${arcPath(line, r, from, to)}" fill="none" stroke-width="${num(h)}" stroke-linecap="${round ? "round" : "butt"}"${strokeColor}/>`;
      }
      return out;
    },
  };
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

/** Markup of a text element's contents (origin = the element's top-left corner). */
export function textElementSvg(el: TextElement, cx: TextRenderContext): string {
  const layout = layoutText(el);
  const gradient: PaintRef | null = el.gradient ? { kind: "url", id: cx.doc.linearGradient(el.gradient, layout.width, layout.height) } : null;
  // a curve too slight to bend the text has no geometry: such text is drawn straight, as on the canvas
  const geo = el.curve ? curveGeometry(el, layout) : null;
  return drawWithEffect(el, layout, cx, geo ? curvedPainter(el, layout, gradient, cx, geo) : straightPainter(el, layout, gradient, cx));
}

/** Exposed for tests: which line / segment geometry a text element produces. */
export function textGeometry(el: TextElement): Array<{ line: LayoutLine; words: string[] }> {
  return layoutText(el).lines.map((line) => ({ line, words: line.segments.filter((s) => !s.isSpace).map((s) => s.text) }));
}

/**
 * Building blocks of the SVG exporter: XML escaping, number and colour formatting, and `SvgDoc`, the
 * document-wide registry of <defs> (gradients, patterns, filters, clip paths) with de-duplication.
 *
 * Everything reproduces what the canvas renderer (render/paint.ts, render/drawText.ts ...) does, so the
 * geometry formulas below deliberately mirror those files.
 */
import { parseColor, toHex } from "@/core/color";
import { DEG } from "@/core/geometry";
import type { GradientStop, LinearGradientFill, PatternFill, PaintFill, RadialGradientFill } from "@/core/types";

/* ------------------------------------------------------------------ */
/* XML                                                                */
/* ------------------------------------------------------------------ */

// characters XML 1.0 cannot represent at all (control codes, U+FFFE / U+FFFF) and lone surrogates
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripInvalidXml(text: string): string {
  return text.replace(INVALID_XML, "");
}

/** Escapes text content. */
export function esc(text: string): string {
  return stripInvalidXml(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes an attribute value (written inside double quotes). */
export function escAttr(text: string): string {
  return esc(text).replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
}

/** Numbers with at most 3 decimals and no exponent (SVG allows one, but editors choke on some). */
export function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const r = Math.round(value * 1000) / 1000;
  if (Object.is(r, -0) || r === 0) return "0";
  return String(r);
}

/** `name="value"` for defined, non-empty values; used to build tags without empty attributes. */
export function attrs(map: Record<string, string | number | undefined | null | false>): string {
  let out = "";
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    out += ` ${key}="${typeof value === "number" ? num(value) : escAttr(value)}"`;
  }
  return out;
}

/** A CSS font-family list that is safe inside a double quoted attribute (names in single quotes). */
export function svgFontFamily(cssFamily: string): string {
  return escAttr(cssFamily.replace(/"((?:[^"\\]|\\.)*)"/g, (_m, name: string) => `'${name.replace(/\\"/g, '"').replace(/'/g, "\\'")}'`));
}

/* ------------------------------------------------------------------ */
/* Colour                                                             */
/* ------------------------------------------------------------------ */

export interface SplitColor {
  /** #rrggbb, or the keyword itself when it is a plain CSS colour name we cannot parse (red, currentColor ...) */
  hex: string;
  /** 0..1 */
  a: number;
  /** false when the colour could not be parsed and `hex` is the untouched input */
  parsed: boolean;
}

/** SVG 1.1 has no rgba(): split a CSS colour into an opaque colour and an opacity. */
export function splitColor(color: string): SplitColor {
  const c = parseColor(color);
  if (c) return { hex: toHex(c), a: Math.max(0, Math.min(1, c.a)), parsed: true };
  // keep plain CSS colour keywords ("red", "currentColor"); anything else (url(...), var(...), junk) must not reach the file
  const text = color.trim();
  return { hex: /^[a-z]{3,24}$/i.test(text) ? text : "#000000", a: 1, parsed: false };
}

type PaintProp = "fill" | "stroke" | "stop-color" | "flood-color";
const OPACITY_PROP: Record<PaintProp, string> = {
  fill: "fill-opacity",
  stroke: "stroke-opacity",
  "stop-color": "stop-opacity",
  "flood-color": "flood-opacity",
};

/** `fill="#rrggbb" fill-opacity="0.5"` (opacity omitted when 1, `fill="none"` when fully transparent). */
export function colorAttr(prop: PaintProp, color: string, alpha = 1): string {
  const c = splitColor(color);
  const a = c.a * alpha;
  if (a <= 0.0005 && (prop === "fill" || prop === "stroke")) return ` ${prop}="none"`;
  return ` ${prop}="${escAttr(c.hex)}"${a < 0.9995 ? ` ${OPACITY_PROP[prop]}="${num(a)}"` : ""}`;
}

/** Either a plain colour or a reference to a gradient / pattern defined in <defs>. */
export type PaintRef = { kind: "color"; color: string } | { kind: "url"; id: string };

export function paintAttr(prop: "fill" | "stroke", paint: PaintRef, alpha = 1): string {
  if (paint.kind === "color") return colorAttr(prop, paint.color, alpha);
  return ` ${prop}="url(#${paint.id})"${alpha < 0.9995 ? ` ${OPACITY_PROP[prop]}="${num(alpha)}"` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Gradient geometry (same formulas as render/paint.ts)                */
/* ------------------------------------------------------------------ */

export function linearGradientVector(angle: number, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angle - 90) * DEG;
  const cx = w / 2;
  const cy = h / 2;
  const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2 || 1;
  return { x1: cx - Math.cos(a) * half, y1: cy - Math.sin(a) * half, x2: cx + Math.cos(a) * half, y2: cy + Math.sin(a) * half };
}

export function radialGradientCircle(g: RadialGradientFill, w: number, h: number): { cx: number; cy: number; r: number } {
  const cx = (g.cx ?? 0.5) * w;
  const cy = (g.cy ?? 0.5) * h;
  return { cx, cy, r: Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) };
}

/** Stops clamped to 0..1 and stably sorted - what a canvas gradient does implicitly. */
export function stopsMarkup(stops: GradientStop[]): string {
  const sorted = stops.map((s, i) => ({ offset: Math.min(1, Math.max(0, s.offset)), color: s.color, i })).sort((a, b) => a.offset - b.offset || a.i - b.i);
  return sorted.map((s) => `<stop offset="${num(s.offset)}"${colorAttr("stop-color", s.color)}/>`).join("");
}

/* ------------------------------------------------------------------ */
/* Procedural patterns (mirror render/paint.ts makeTile)               */
/* ------------------------------------------------------------------ */

/** Base tile size in design px for each pattern kind - keep in sync with render/paint.ts. */
export const PATTERN_TILE: Record<PatternFill["pattern"], [number, number]> = {
  dots: [26, 26],
  grid: [44, 44],
  lines: [24, 24],
  diagonal: [30, 30],
  checker: [64, 64],
  waves: [64, 28],
  zigzag: [36, 20],
  plus: [40, 40],
  bubbles: [120, 120],
  noise: [180, 180],
};

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pixel data of the `noise` pattern tile (RGBA), identical to the canvas version. */
export function noiseTilePixels(p: PatternFill, w: number, h: number): Uint8ClampedArray {
  const rnd = mulberry(11);
  const fg = parseColor(p.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const bg = parseColor(p.background) ?? { r: 255, g: 255, b: 255, a: 1 };
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const t = rnd() * rnd() * 0.9;
    data[i] = bg.r + (fg.r - bg.r) * t;
    data[i + 1] = bg.g + (fg.g - bg.g) * t;
    data[i + 2] = bg.b + (fg.b - bg.b) * t;
    data[i + 3] = 255;
  }
  return data;
}

/** Vector content of one pattern tile (everything except `noise`, which is a raster). */
export function patternTileMarkup(p: PatternFill): { width: number; height: number; body: string } {
  const [bw, bh] = PATTERN_TILE[p.pattern];
  const u = p.scale;
  // the canvas snaps a tile to whole pixels (at 1 px per design px); do the same so long runs of tiles stay in step
  const w = Math.max(2, Math.round(bw * u));
  const h = Math.max(2, Math.round(bh * u));
  const ink = colorAttr("fill", p.color);
  const inkStroke = (width: number) => `${colorAttr("stroke", p.color)} stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  let body = `<rect width="${num(w)}" height="${num(h)}"${colorAttr("fill", p.background)}/>`;
  switch (p.pattern) {
    case "dots":
      body += `<circle cx="${num(w / 2)}" cy="${num(h / 2)}" r="${num(2.6 * u)}"${ink}/>`;
      break;
    case "grid":
      body += `<path d="M0 0H${num(w)}M0 0V${num(h)}"${inkStroke(1.6 * u)}/>`;
      break;
    case "lines":
      body += `<rect width="${num(w)}" height="${num(5 * u)}"${ink}/>`;
      break;
    case "diagonal":
      body += `<path d="M${num(-w * 0.1)} ${num(h * 1.1)}L${num(w * 1.1)} ${num(-h * 0.1)}M${num(-w * 0.6)} ${num(h * 1.1)}L${num(w * 0.6)} ${num(-h * 0.1)}M${num(w * 0.4)} ${num(h * 1.1)}L${num(w * 1.6)} ${num(-h * 0.1)}"${inkStroke(6 * u)}/>`;
      break;
    case "checker":
      body += `<rect width="${num(w / 2)}" height="${num(h / 2)}"${ink}/><rect x="${num(w / 2)}" y="${num(h / 2)}" width="${num(w / 2)}" height="${num(h / 2)}"${ink}/>`;
      break;
    case "waves":
      body += `<path d="M0 ${num(h / 2)}C${num(w * 0.16)} ${num(h * 0.05)} ${num(w * 0.34)} ${num(h * 0.05)} ${num(w / 2)} ${num(h / 2)}C${num(w * 0.66)} ${num(h * 0.95)} ${num(w * 0.84)} ${num(h * 0.95)} ${num(w)} ${num(h / 2)}"${inkStroke(3 * u)}/>`;
      break;
    case "zigzag":
      body += `<path d="M0 ${num(h * 0.8)}L${num(w / 4)} ${num(h * 0.2)}L${num(w / 2)} ${num(h * 0.8)}L${num((w * 3) / 4)} ${num(h * 0.2)}L${num(w)} ${num(h * 0.8)}"${inkStroke(3 * u)}/>`;
      break;
    case "plus":
      body += `<path d="M${num(w / 2 - 6 * u)} ${num(h / 2)}H${num(w / 2 + 6 * u)}M${num(w / 2)} ${num(h / 2 - 6 * u)}V${num(h / 2 + 6 * u)}"${inkStroke(3 * u)}/>`;
      break;
    case "bubbles": {
      const rnd = mulberry(7);
      for (let i = 0; i < 7; i++) {
        const r = (6 + rnd() * 16) * u;
        const x = rnd() * w;
        const y = rnd() * h;
        for (const ox of [-w, 0, w]) {
          for (const oy of [-h, 0, h]) {
            const cx = x + ox;
            const cy = y + oy;
            // skip copies that cannot touch the tile
            if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
            body += i % 2 ? `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"${ink}/>` : `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"${inkStroke(2.4 * u)}/>`;
          }
        }
      }
      break;
    }
    default:
      break;
  }
  return { width: w, height: h, body };
}

/* ------------------------------------------------------------------ */
/* Document registry                                                  */
/* ------------------------------------------------------------------ */

export interface ShadowSpec {
  /** offset in the user space of the element that references the filter */
  dx: number;
  dy: number;
  /** standard deviation of the blur (canvas shadowBlur / 2) */
  sigma: number;
  color: string;
  /** extra opacity multiplied into the colour's own alpha */
  opacity?: number;
  /** keep the element itself above its shadow (drop shadow) or output only the shadow */
  includeSource: boolean;
  /** area the filter may paint into, in the same user space */
  region: { x: number; y: number; w: number; h: number };
}

export class SvgDoc {
  private counter = 0;
  readonly defs: string[] = [];
  readonly warnings: string[] = [];
  private readonly cache = new Map<string, string>();

  id(prefix: string): string {
    return `cf-${prefix}${++this.counter}`;
  }

  warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** Defines something once per key; returns its id. */
  private define(prefix: string, key: string, make: (id: string) => string): string {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const id = this.id(prefix);
    this.defs.push(make(id));
    this.cache.set(key, id);
    return id;
  }

  linearGradient(g: LinearGradientFill, w: number, h: number): string {
    const v = linearGradientVector(g.angle, w, h);
    const key = `lg|${JSON.stringify(g)}|${num(w)}|${num(h)}`;
    return this.define(
      "lg",
      key,
      (id) =>
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(v.x1)}" y1="${num(v.y1)}" x2="${num(v.x2)}" y2="${num(v.y2)}">${stopsMarkup(g.stops)}</linearGradient>`,
    );
  }

  radialGradient(g: RadialGradientFill, w: number, h: number): string {
    const c = radialGradientCircle(g, w, h);
    const key = `rg|${JSON.stringify(g)}|${num(w)}|${num(h)}`;
    return this.define(
      "rg",
      key,
      (id) =>
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(c.cx)}" cy="${num(c.cy)}" r="${num(c.r)}" fx="${num(c.cx)}" fy="${num(c.cy)}">${stopsMarkup(g.stops)}</radialGradient>`,
    );
  }

  /** A pattern fill. `noiseHref` supplies the raster tile for the noise pattern. */
  pattern(p: PatternFill, noiseHref?: () => string): string {
    const key = `pt|${JSON.stringify(p)}`;
    return this.define("pt", key, (id) => {
      if (p.pattern === "noise") {
        const [bw, bh] = PATTERN_TILE.noise;
        const w = Math.max(2, Math.round(bw * p.scale));
        const h = Math.max(2, Math.round(bh * p.scale));
        const href = noiseHref ? noiseHref() : "";
        return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(w)}" height="${num(h)}"><rect width="${num(w)}" height="${num(h)}"${colorAttr("fill", p.background)}/>${href ? `<image width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" image-rendering="pixelated" xlink:href="${href}"/>` : ""}</pattern>`;
      }
      const tile = patternTileMarkup(p);
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(tile.width)}" height="${num(tile.height)}">${tile.body}</pattern>`;
    });
  }

  /** Paint for a solid / gradient / pattern fill over a w x h box. */
  paint(fill: PaintFill | PatternFill, w: number, h: number, noiseHref?: () => string): PaintRef {
    switch (fill.type) {
      case "solid":
        return { kind: "color", color: fill.color };
      case "linear":
        return { kind: "url", id: this.linearGradient(fill, w, h) };
      case "radial":
        return { kind: "url", id: this.radialGradient(fill, w, h) };
      case "pattern":
        return { kind: "url", id: this.pattern(fill, noiseHref) };
    }
  }

  /** A clip path made of one shape (path data or rect), referenced by `clip-path="url(#id)"`. */
  clipPath(shapeMarkup: string, key: string): string {
    return this.define("cp", `cp|${key}`, (id) => `<clipPath id="${id}">${shapeMarkup}</clipPath>`);
  }

  /** Gaussian blur of a whole element (the canvas `ctx.filter = blur()` path). */
  blurFilter(sigma: number, region: { x: number; y: number; w: number; h: number }): string {
    const pad = sigma * 3 + 2;
    const key = `bl|${num(sigma)}|${num(region.x)}|${num(region.y)}|${num(region.w)}|${num(region.h)}`;
    return this.define(
      "bl",
      key,
      (id) =>
        `<filter id="${id}" filterUnits="userSpaceOnUse" x="${num(region.x - pad)}" y="${num(region.y - pad)}" width="${num(region.w + pad * 2)}" height="${num(region.h + pad * 2)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${num(sigma)}"/></filter>`,
    );
  }

  /** Canvas style shadow: blurred, offset, tinted copy of the element's alpha (plus the element itself). */
  shadowFilter(s: ShadowSpec): string {
    const key = `sh|${num(s.dx)}|${num(s.dy)}|${num(s.sigma)}|${s.color}|${num(s.opacity ?? 1)}|${s.includeSource}|${num(s.region.x)}|${num(s.region.y)}|${num(s.region.w)}|${num(s.region.h)}`;
    return this.define("sh", key, (id) => {
      const c = splitColor(s.color);
      const pad = s.sigma * 3 + Math.max(Math.abs(s.dx), Math.abs(s.dy)) + 2;
      const x = s.region.x - pad;
      const y = s.region.y - pad;
      const w = s.region.w + pad * 2;
      const h = s.region.h + pad * 2;
      let body = "";
      if (s.sigma > 0.01) body += `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(s.sigma)}" result="b"/><feOffset in="b" dx="${num(s.dx)}" dy="${num(s.dy)}" result="o"/>`;
      else body += `<feOffset in="SourceAlpha" dx="${num(s.dx)}" dy="${num(s.dy)}" result="o"/>`;
      body += `<feFlood flood-color="${escAttr(c.hex)}" flood-opacity="${num(c.a * (s.opacity ?? 1))}" result="c"/><feComposite in="c" in2="o" operator="in" result="s"/>`;
      if (s.includeSource) body += `<feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>`;
      return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" color-interpolation-filters="sRGB">${body}</filter>`;
    });
  }

  /** `<defs>` block (empty string when nothing was defined). */
  defsMarkup(extra: string[] = []): string {
    const all = [...extra, ...this.defs];
    return all.length ? `<defs>${all.join("")}</defs>` : "";
  }
}

/** Shape / box path helpers shared by several element types. */
export function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${num(x)} ${num(y)}H${num(x + w)}V${num(y + h)}H${num(x)}Z`;
}

/**
 * Rounded rectangle path with per-corner radii [tl, tr, br, bl], scaled down like `CanvasRenderingContext2D.roundRect`
 * does when the radii do not fit.
 */
export function roundRectPath(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): string {
  let [tl, tr, br, bl] = radii.map((r) => Math.max(0, r)) as [number, number, number, number];
  const scale = Math.min(1, w / Math.max(tl + tr, 1e-9), w / Math.max(bl + br, 1e-9), h / Math.max(tl + bl, 1e-9), h / Math.max(tr + br, 1e-9));
  if (scale < 1) {
    tl *= scale;
    tr *= scale;
    br *= scale;
    bl *= scale;
  }
  const p = (v: number) => num(v);
  let d = `M${p(x + tl)} ${p(y)}H${p(x + w - tr)}`;
  if (tr) d += `A${p(tr)} ${p(tr)} 0 0 1 ${p(x + w)} ${p(y + tr)}`;
  d += `V${p(y + h - br)}`;
  if (br) d += `A${p(br)} ${p(br)} 0 0 1 ${p(x + w - br)} ${p(y + h)}`;
  d += `H${p(x + bl)}`;
  if (bl) d += `A${p(bl)} ${p(bl)} 0 0 1 ${p(x)} ${p(y + h - bl)}`;
  d += `V${p(y + tl)}`;
  if (tl) d += `A${p(tl)} ${p(tl)} 0 0 1 ${p(x + tl)} ${p(y)}`;
  return d + "Z";
}

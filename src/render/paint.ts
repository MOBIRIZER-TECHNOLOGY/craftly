/**
 * Fills: solid colours, gradients and procedural patterns as canvas paint.
 */
import { DEG } from "@/core/geometry";
import type { Fill, LinearGradientFill, PatternFill, RadialGradientFill } from "@/core/types";

type Ctx = CanvasRenderingContext2D;

export function linearGradientFor(ctx: Ctx, g: LinearGradientFill, w: number, h: number): CanvasGradient {
  // CSS convention: 0deg points up, 90deg points right
  const a = (g.angle - 90) * DEG;
  const cx = w / 2;
  const cy = h / 2;
  const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2 || 1;
  const grad = ctx.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
  for (const s of g.stops) grad.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
  return grad;
}

export function radialGradientFor(ctx: Ctx, g: RadialGradientFill, w: number, h: number): CanvasGradient {
  const cx = (g.cx ?? 0.5) * w;
  const cy = (g.cy ?? 0.5) * h;
  const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const s of g.stops) grad.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
  return grad;
}

/* ---------------- patterns ---------------- */

const tileCache = new Map<string, HTMLCanvasElement>();

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Base tile size in design px for each pattern kind. */
const TILE: Record<PatternFill["pattern"], [number, number]> = {
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

function makeTile(p: PatternFill, px: number): HTMLCanvasElement {
  const [bw, bh] = TILE[p.pattern];
  const s = p.scale * px;
  const w = Math.max(2, Math.round(bw * s));
  const h = Math.max(2, Math.round(bh * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = p.background;
  g.fillRect(0, 0, w, h);
  g.fillStyle = p.color;
  g.strokeStyle = p.color;
  g.lineCap = "round";
  g.lineJoin = "round";
  const u = s; // one design px
  switch (p.pattern) {
    case "dots":
      g.beginPath();
      g.arc(w / 2, h / 2, 2.6 * u, 0, Math.PI * 2);
      g.fill();
      break;
    case "grid":
      g.lineWidth = 1.6 * u;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w, 0);
      g.moveTo(0, 0);
      g.lineTo(0, h);
      g.stroke();
      break;
    case "lines":
      g.fillRect(0, 0, w, 5 * u);
      break;
    case "diagonal":
      g.lineWidth = 6 * u;
      g.beginPath();
      g.moveTo(-w * 0.1, h * 1.1);
      g.lineTo(w * 1.1, -h * 0.1);
      g.moveTo(-w * 0.6, h * 1.1);
      g.lineTo(w * 0.6, -h * 0.1);
      g.moveTo(w * 0.4, h * 1.1);
      g.lineTo(w * 1.6, -h * 0.1);
      g.stroke();
      break;
    case "checker":
      g.fillRect(0, 0, w / 2, h / 2);
      g.fillRect(w / 2, h / 2, w / 2, h / 2);
      break;
    case "waves":
      g.lineWidth = 3 * u;
      g.beginPath();
      g.moveTo(0, h / 2);
      g.bezierCurveTo(w * 0.16, h * 0.05, w * 0.34, h * 0.05, w / 2, h / 2);
      g.bezierCurveTo(w * 0.66, h * 0.95, w * 0.84, h * 0.95, w, h / 2);
      g.stroke();
      break;
    case "zigzag":
      g.lineWidth = 3 * u;
      g.beginPath();
      g.moveTo(0, h * 0.8);
      g.lineTo(w / 4, h * 0.2);
      g.lineTo(w / 2, h * 0.8);
      g.lineTo((w * 3) / 4, h * 0.2);
      g.lineTo(w, h * 0.8);
      g.stroke();
      break;
    case "plus":
      g.lineWidth = 3 * u;
      g.beginPath();
      g.moveTo(w / 2 - 6 * u, h / 2);
      g.lineTo(w / 2 + 6 * u, h / 2);
      g.moveTo(w / 2, h / 2 - 6 * u);
      g.lineTo(w / 2, h / 2 + 6 * u);
      g.stroke();
      break;
    case "bubbles": {
      g.lineWidth = 2.4 * u;
      const rnd = mulberry(7);
      for (let i = 0; i < 7; i++) {
        const r = (6 + rnd() * 16) * u;
        const x = rnd() * w;
        const y = rnd() * h;
        for (const ox of [-w, 0, w])
          for (const oy of [-h, 0, h]) {
            g.beginPath();
            g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
            if (i % 2) g.fill();
            else g.stroke();
          }
      }
      break;
    }
    case "noise": {
      const rnd = mulberry(11);
      const img = g.getImageData(0, 0, w, h);
      const ink = g.createImageData(1, 1);
      void ink;
      const fg = parseRGB(p.color);
      const bg = parseRGB(p.background);
      for (let i = 0; i < img.data.length; i += 4) {
        const t = rnd() * rnd() * 0.9;
        img.data[i] = bg[0] + (fg[0] - bg[0]) * t;
        img.data[i + 1] = bg[1] + (fg[1] - bg[1]) * t;
        img.data[i + 2] = bg[2] + (fg[2] - bg[2]) * t;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      break;
    }
  }
  return c;
}

function parseRGB(color: string): [number, number, number] {
  const c = document.createElement("canvas").getContext("2d")!;
  c.fillStyle = color;
  const v = c.fillStyle as string;
  if (v.startsWith("#")) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}

/** Repeating pattern for `ctx`; `px` is canvas pixels per design pixel. */
export function patternPaint(ctx: Ctx, p: PatternFill, px: number): CanvasPattern | string {
  const bucket = Math.max(1, Math.round(px * 4) / 4);
  const key = `${p.pattern}|${p.color}|${p.background}|${p.scale}|${bucket}`;
  let tile = tileCache.get(key);
  if (!tile) {
    if (tileCache.size > 60) tileCache.clear();
    tile = makeTile(p, bucket);
    tileCache.set(key, tile);
  }
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return p.background;
  // the tile was rendered at `bucket` px per design px; map it back to design space
  pattern.setTransform(new DOMMatrix().scale(1 / bucket));
  return pattern;
}

/** Fill style for solid / gradient / pattern fills (images are handled by the page painter). */
export function paintFor(ctx: Ctx, fill: Fill, w: number, h: number, px: number): string | CanvasGradient | CanvasPattern {
  switch (fill.type) {
    case "solid":
      return fill.color;
    case "linear":
      return linearGradientFor(ctx, fill, w, h);
    case "radial":
      return radialGradientFor(ctx, fill, w, h);
    case "pattern":
      return patternPaint(ctx, fill, px);
    default:
      return "#ffffff";
  }
}

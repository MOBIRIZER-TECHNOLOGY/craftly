/**
 * Turns an ImageFilter (preset + sliders) into canvas operations.
 * Brightness / contrast / saturation / hue / blur use `ctx.filter`; warmth,
 * fade, vignette and duotone are composited as overlays on an off-screen copy.
 */
import type { ImageFilter } from "@/core/types";
import { FILTER_PRESETS } from "@/data/filters";
import type { Drawable } from "./images";

const NUMERIC: Array<keyof ImageFilter> = [
  "brightness",
  "contrast",
  "saturation",
  "warmth",
  "fade",
  "vignette",
  "blur",
  "hue",
  "highlights",
  "shadows",
  "sharpen",
  "tint",
  "curves",
  "levels",
];

/** Sliders plus the preset's contribution (scaled by intensity). */
export function effectiveFilter(f: ImageFilter): ImageFilter {
  if (!f.preset || f.preset === "none") return f;
  const preset = FILTER_PRESETS.find((p) => p.id === f.preset);
  if (!preset) return f;
  const k = Math.max(0, Math.min(1, f.intensity / 100));
  const out: ImageFilter = { ...f };
  for (const key of NUMERIC) {
    const add = (preset.patch[key] as number | undefined) ?? 0;
    (out as unknown as Record<string, number>)[key] = ((f[key] as number | undefined) ?? 0) + add * k;
  }
  if (preset.patch.duotone && k > 0.01) out.duotone = preset.patch.duotone;
  return out;
}

export function isNeutral(f: ImageFilter): boolean {
  const e = effectiveFilter(f);
  return NUMERIC.every((k) => Math.abs((e[k] as number | undefined) ?? 0) < 0.5) && !e.duotone;
}

export const filterKey = (f: ImageFilter) => JSON.stringify(effectiveFilter(f));

export const supportsCtxFilter = (() => {
  try {
    return typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
  } catch {
    return false;
  }
})();

/** CSS filter() chain for the parts `ctx.filter` handles. `scale` converts design px to canvas px for blur. */
export function cssFilter(f: ImageFilter, scale: number): string {
  const e = effectiveFilter(f);
  const parts: string[] = [];
  if (e.duotone) parts.push("grayscale(1)");
  if (Math.abs(e.brightness) > 0.5) parts.push(`brightness(${(1 + e.brightness / 100).toFixed(3)})`);
  if (Math.abs(e.contrast) > 0.5) parts.push(`contrast(${(1 + e.contrast / 100).toFixed(3)})`);
  if (Math.abs(e.saturation) > 0.5) parts.push(`saturate(${Math.max(0, 1 + e.saturation / 100).toFixed(3)})`);
  if (Math.abs(e.hue) > 0.5) parts.push(`hue-rotate(${(e.hue * 1.8).toFixed(1)}deg)`);
  if (e.blur > 0.5) parts.push(`blur(${((e.blur / 100) * 14 * scale).toFixed(2)}px)`);
  return parts.length ? parts.join(" ") : "none";
}

type Ctx = CanvasRenderingContext2D;

/** Overlays that need blend modes; drawn onto the already filtered image. */
function paintOverlays(ctx: Ctx, w: number, h: number, e: ImageFilter): void {
  ctx.save();
  if (e.duotone) {
    ctx.globalCompositeOperation = "lighten";
    ctx.fillStyle = e.duotone.dark;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "darken";
    ctx.fillStyle = e.duotone.light;
    ctx.fillRect(0, 0, w, h);
  }
  if (Math.abs(e.warmth) > 0.5) {
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = Math.min(1, Math.abs(e.warmth) / 100) * 0.85;
    ctx.fillStyle = e.warmth > 0 ? "#ff9a2e" : "#2e8bff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = "source-over";
  if (e.fade > 0.5) {
    ctx.globalAlpha = Math.min(1, e.fade / 100) * 0.45;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  if (e.vignette > 0.5) {
    ctx.globalAlpha = Math.min(1, e.vignette / 100) * 0.85;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.55);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function paintPixelAdjustments(ctx: Ctx, w: number, h: number, e: ImageFilter): void {
  const keys = ["highlights", "shadows", "sharpen", "tint", "curves", "levels"] as const;
  if (keys.every((key) => Math.abs(e[key] ?? 0) < 0.5)) return;
  try {
    const image = ctx.getImageData(0, 0, w, h);
    const source = new Uint8ClampedArray(image.data);
    const shadows = (e.shadows ?? 0) / 100;
    const highlights = (e.highlights ?? 0) / 100;
    const tint = (e.tint ?? 0) / 100;
    const curves = (e.curves ?? 0) / 100;
    const levels = (e.levels ?? 0) / 100;
    const tone = (value: number, luminance: number) => {
      let out = value / 255;
      out += shadows * (1 - luminance) * 0.65 + highlights * luminance * 0.65;
      out = (out - 0.5) * (1 + levels * 0.6) + 0.5;
      out += curves * (out - 0.5) * Math.max(0, 1 - Math.abs(out - 0.5) * 2);
      return out * 255;
    };
    for (let i = 0; i < image.data.length; i += 4) {
      const luminance = (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) / 255;
      image.data[i] = tone(source[i], luminance) - tint * 18;
      image.data[i + 1] = tone(source[i + 1], luminance) + tint * 28;
      image.data[i + 2] = tone(source[i + 2], luminance) - tint * 18;
    }
    const sharpen = (e.sharpen ?? 0) / 100;
    if (sharpen > 0 && w > 2 && h > 2) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const at = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const neighbours = source[at - w * 4 + c] + source[at + w * 4 + c] + source[at - 4 + c] + source[at + 4 + c];
            image.data[at + c] += sharpen * 0.7 * (source[at + c] * 4 - neighbours);
          }
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  } catch {
    // A browser may refuse pixels from a protected canvas; the ordinary image is still useful.
  }
}

const MAX_SIDE = 2048;
const cache = new Map<string, HTMLCanvasElement>();

export interface FilteredDraw {
  key: string;
  img: Drawable;
  /** destination of the full source image inside the element box, px */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** element box in px */
  boxW: number;
  boxH: number;
  filter: ImageFilter;
  /** canvas px per design px */
  scale: number;
}

/**
 * Renders the visible part of an image through its filter into an off-screen
 * canvas the size of the box (cached), ready to be drawn into the element.
 */
export function renderFiltered(d: FilteredDraw): HTMLCanvasElement {
  const k = Math.min(1, MAX_SIDE / Math.max(d.boxW * d.scale, d.boxH * d.scale, 1));
  const s = d.scale * k;
  const pw = Math.max(1, Math.round(d.boxW * s));
  const ph = Math.max(1, Math.round(d.boxH * s));
  const key = `${d.key}|${pw}x${ph}|${d.dx.toFixed(1)},${d.dy.toFixed(1)},${d.dw.toFixed(1)},${d.dh.toFixed(1)}|${filterKey(d.filter)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = pw;
  c.height = ph;
  const ctx = c.getContext("2d")!;
  const e = effectiveFilter(d.filter);
  if (supportsCtxFilter) ctx.filter = cssFilter(d.filter, s);
  ctx.drawImage(d.img as CanvasImageSource, d.dx * s, d.dy * s, d.dw * s, d.dh * s);
  ctx.filter = "none";
  paintPixelAdjustments(ctx, pw, ph, e);
  paintOverlays(ctx, pw, ph, e);
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  cache.set(key, c);
  return c;
}

/**
 * Pluggable text measurement. The browser implementation uses a shared
 * off-screen canvas; tests (node) fall back to a deterministic estimate or a
 * measurer installed with `setTextMeasurer`.
 */

export interface FontMetricsInfo {
  /** px above the baseline of the font's content area */
  ascent: number;
  /** px below the baseline */
  descent: number;
}

export interface TextMeasurer {
  width(font: string, text: string): number;
  metrics(font: string): FontMetricsInfo;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function parseSize(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : 16;
}

const estimateMeasurer: TextMeasurer = {
  width: (font, text) => text.length * parseSize(font) * 0.55,
  metrics: (font) => ({ ascent: parseSize(font) * 0.95, descent: parseSize(font) * 0.25 }),
};

let ctx: Ctx2D | null = null;
let widthCache = new Map<string, number>();
let metricsCache = new Map<string, FontMetricsInfo>();

function getCtx(): Ctx2D | null {
  if (ctx) return ctx;
  try {
    if (typeof OffscreenCanvas !== "undefined") ctx = new OffscreenCanvas(4, 4).getContext("2d");
    else if (typeof document !== "undefined") ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

const canvasMeasurer: TextMeasurer = {
  width(font, text) {
    const key = `${font}\u0000${text}`;
    const hit = widthCache.get(key);
    if (hit !== undefined) return hit;
    const c = getCtx();
    if (!c) return estimateMeasurer.width(font, text);
    c.font = font;
    const w = c.measureText(text).width;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
    return w;
  },
  metrics(font) {
    const hit = metricsCache.get(font);
    if (hit) return hit;
    const c = getCtx();
    if (!c) return estimateMeasurer.metrics(font);
    c.font = font;
    const m = c.measureText("Hxg");
    const size = parseSize(font);
    const out: FontMetricsInfo = {
      ascent: m.fontBoundingBoxAscent || size * 0.95,
      descent: m.fontBoundingBoxDescent || size * 0.25,
    };
    metricsCache.set(font, out);
    return out;
  },
};

let current: TextMeasurer = typeof document === "undefined" && typeof OffscreenCanvas === "undefined" ? estimateMeasurer : canvasMeasurer;

export function setTextMeasurer(m: TextMeasurer | null): void {
  current = m ?? canvasMeasurer;
  clearMeasureCache();
}

export function clearMeasureCache(): void {
  widthCache = new Map();
  metricsCache = new Map();
}

export const measureWidth = (font: string, text: string) => current.width(font, text);
export const measureMetrics = (font: string) => current.metrics(font);

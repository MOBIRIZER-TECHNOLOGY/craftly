/**
 * The two canvas jobs around the model: squeeze a photo into the model's square, and put the model's mask back on the
 * photo at the photo's own size. The mask is applied with a `destination-in` draw, so the browser does the per-pixel
 * work and no full-size pixel array is ever built.
 */
import type { Drawable } from "@/render/images";
import { MlError } from "./errors";
import { MAX_OUTPUT_PIXELS, MAX_SIDE } from "./limits";
import { maskToRgba } from "./pixels";

export function fitWithin(width: number, height: number, maxPixels: number = MAX_OUTPUT_PIXELS): { width: number; height: number; scaled: boolean } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), MAX_SIDE / Math.max(width, height));
  if (scale >= 1) return { width, height, scaled: false };
  // the epsilon stops floating point noise (16383.999999999998) from costing a pixel
  const fitted = { width: Math.max(1, Math.floor(width * scale + 1e-9)), height: Math.max(1, Math.floor(height * scale + 1e-9)) };
  return { ...fitted, scaled: fitted.width !== width || fitted.height !== height };
}

/** The size a picture is stored at (an image element's natural size, not the size it is shown at). */
export const sizeOf = (d: Drawable) => (d instanceof HTMLImageElement ? { width: d.naturalWidth, height: d.naturalHeight } : { width: d.width, height: d.height });

function make2d(width: number, height: number, willReadFrequently = false) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new MlError("unsupported");
  return { canvas, ctx };
}

/** Zero size lets Safari free the bitmap now instead of when the page is closed. */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

const toBlobOf = (canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new MlError("image"))), type, quality));
const toPng = (canvas: HTMLCanvasElement) => toBlobOf(canvas, "image/png");

/** What the model gets to see: the photo squeezed into size x size on white (transparent areas must not be read as black). */
export function modelInput(source: Drawable, size: number): Uint8ClampedArray {
  const { canvas, ctx } = make2d(size, size, true);
  try {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, size, size);
    return new Uint8ClampedArray(ctx.getImageData(0, 0, size, size).data);
  } finally {
    release(canvas);
  }
}

export interface CutOut {
  blob: Blob;
  width: number;
  height: number;
  /** true when the photo had to be reduced to stay inside the pixel budget */
  scaled: boolean;
}

/** The photo with everything the mask does not cover made transparent, as a PNG. */
export async function cutOut(source: Drawable, mask: Uint8ClampedArray, maskSize: number, maxPixels: number = MAX_OUTPUT_PIXELS): Promise<CutOut> {
  const natural = sizeOf(source);
  if (!(natural.width > 0 && natural.height > 0)) throw new MlError("image");
  const { width, height, scaled } = fitWithin(natural.width, natural.height, maxPixels);
  let out: ReturnType<typeof make2d> | undefined;
  let matte: ReturnType<typeof make2d> | undefined;
  try {
    out = make2d(width, height);
    matte = make2d(maskSize, maskSize);
    const pixels = matte.ctx.createImageData(maskSize, maskSize);
    pixels.data.set(maskToRgba(mask));
    matte.ctx.putImageData(pixels, 0, 0);

    out.ctx.imageSmoothingQuality = "high";
    out.ctx.drawImage(source, 0, 0, width, height);
    out.ctx.globalCompositeOperation = "destination-in";
    out.ctx.drawImage(matte.canvas, 0, 0, width, height);
    return { blob: await toPng(out.canvas), width, height, scaled };
  } finally {
    if (out) release(out.canvas);
    if (matte) release(matte.canvas);
  }
}

/* ---------------- jobs that work on the pixels: making a picture larger, blurring its background ---------------- */

export interface SourcePixels {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** true when the picture was drawn smaller than it is, to stay inside the pixel budget it was read with */
  scaled?: boolean;
}

/**
 * Every pixel of a picture, at its own size, or, when a budget of pixels is given, at the size that fits it: a picture over
 * the budget is drawn smaller (keeping its shape) and `scaled` says so.
 */
export function readPixels(source: Drawable, maxPixels?: number): SourcePixels {
  const natural = sizeOf(source);
  if (!(natural.width > 0 && natural.height > 0)) throw new MlError("image");
  const { width, height, scaled } = maxPixels === undefined ? { ...natural, scaled: false } : fitWithin(natural.width, natural.height, maxPixels);
  const { canvas, ctx } = make2d(width, height, true);
  try {
    if (scaled) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    return { rgba: new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data), width, height, scaled };
  } finally {
    release(canvas);
  }
}

/** The opacity of the original picture, as RGBA pixels with only the alpha set: what a `destination-in` draw needs. */
export interface Matte {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ResultCanvas {
  /** Puts a finished piece (RGBA, `width` x `height`: a tile of a larger picture, a few rows of a blurred one) at x, y of the result. */
  put(x: number, y: number, rgba: Uint8ClampedArray, width: number, height: number): void;
  /**
   * The result as a file. With a `matte` the result is drawn through the original's opacity, which the browser stretches to
   * the result's size, so transparent parts stay transparent. Without one the result is solid: a JPEG when `jpeg` is set
   * (for photographs: a lossless file of a large photograph is several times the size), otherwise a PNG.
   */
  finish(options: { matte?: Matte; jpeg?: boolean }): Promise<Blob>;
  /** Frees the canvas now. */
  dispose(): void;
}

/** JPEG quality of a photograph a tool made: high enough that the file's own noise stays below what the tool changed. */
const JPEG_QUALITY = 0.95;

/** The canvas the pieces of a result are assembled on. It never holds the picture as a second array of pixels. */
export function createResultCanvas(width: number, height: number): ResultCanvas {
  const { canvas, ctx } = make2d(width, height);
  return {
    put(x, y, rgba, tileWidth, tileHeight) {
      const pixels = ctx.createImageData(tileWidth, tileHeight);
      pixels.data.set(rgba);
      ctx.putImageData(pixels, x, y);
    },
    async finish({ matte, jpeg }) {
      if (matte) {
        const stencil = make2d(matte.width, matte.height);
        try {
          const pixels = stencil.ctx.createImageData(matte.width, matte.height);
          pixels.data.set(matte.rgba);
          stencil.ctx.putImageData(pixels, 0, 0);
          ctx.imageSmoothingQuality = "high";
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(stencil.canvas, 0, 0, width, height);
        } finally {
          release(stencil.canvas);
        }
        return toPng(canvas);
      }
      return jpeg ? toBlobOf(canvas, "image/jpeg", JPEG_QUALITY) : toPng(canvas);
    },
    dispose: () => release(canvas),
  };
}

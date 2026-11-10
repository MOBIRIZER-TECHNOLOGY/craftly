/**
 * Page -> canvas -> encoded bytes. Everything the PNG / JPG / PDF exporters and the print / clipboard helpers
 * share: it renders through the editor's own `renderPage` (so the export cannot drift from the screen) at an
 * exact scale, optionally flattened onto a solid colour, and encodes with a cancelable `toBlob`.
 */
import type { Design, Page } from "@/core/types";
import { fontsEpoch } from "@/render/fonts";
import { imagesEpoch } from "@/render/images";
import { releaseLayers, renderPage } from "@/render/renderPage";
import { nextMacrotask } from "./yield";
import { ExportError, throwIfAborted } from "./errors";
import { planBands } from "./options";
import { loadPageResources } from "./resources";

export interface RasterRequest {
  /** canvas pixels per design pixel (already clamped by `planRaster`) */
  scale: number;
  /** skip the page background */
  transparent?: boolean;
  /** paint this colour behind everything (JPEG and PDF have no alpha channel) */
  flatten?: string;
  signal?: AbortSignal;
}

const TOO_LARGE = "This design is too large to export at this size - try a smaller size.";

/** How long the main thread may be held before it is handed back to the browser. */
const SLICE_MS = 24;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Renders `page` into a fresh canvas of `round(design.width * scale)` x `round(design.height * scale)` pixels.
 * Waits for fonts, images and graphics first; the caller owns the canvas (see `releaseCanvas`).
 *
 * Large pages are painted in horizontal bands (`renderPage`'s `clip` option) through one reusable band canvas,
 * handing the thread back to the browser between bands: the result is pixel-identical to a single pass, but no
 * single step holds the main thread for more than a fraction of a second.
 */
export async function renderExportCanvas(design: Pick<Design, "width" | "height">, page: Page, req: RasterRequest): Promise<HTMLCanvasElement> {
  const width = Math.max(1, Math.round(design.width * req.scale));
  const height = Math.max(1, Math.round(design.height * req.scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width !== width || canvas.height !== height) throw new ExportError("too-large", TOO_LARGE);

  // same recipe as render/renderPage.renderPageToCanvas: the scale follows the pixel width so thumbnails and exports agree
  const scale = width / design.width;
  const bands = planBands(width, height);
  let sliceStart = now();
  const breathe = async () => {
    throwIfAborted(req.signal);
    if (now() - sliceStart > SLICE_MS) {
      await nextMacrotask();
      sliceStart = now();
    }
  };

  // a pass is repeated only when something finished loading while it ran (a broken image would never get better)
  const settledEpoch = () => fontsEpoch() * 1_000_003 + imagesEpoch();

  if (bands.length === 1) {
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(req.signal);
      await loadPageResources(page, req.signal);
      const before = settledEpoch();
      if (renderPage(ctx, design, page, { scale, transparent: req.transparent }) || settledEpoch() === before) break;
    }
  } else {
    const band = document.createElement("canvas");
    band.width = width;
    band.height = bands[0].rows;
    // software backed: drawing is executed (not just recorded) when the band is read back, which is what keeps each step short
    const bandCtx = band.getContext("2d", { willReadFrequently: true });
    if (!bandCtx) throw new ExportError("too-large", TOO_LARGE);
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(req.signal);
      await loadPageResources(page, req.signal);
      const before = settledEpoch();
      let complete = true;
      for (const { y, rows } of bands) {
        if (band.height !== rows) band.height = rows; // only the last band can be shorter (this also clears it)
        const done = renderPage(bandCtx, design, page, { scale, clip: { x: 0, y: y / scale, w: design.width, h: rows / scale }, transparent: req.transparent });
        complete = complete && done;
        bandCtx.getImageData(0, 0, 1, 1); // flush: rasterise this band now instead of all bands at the very end
        ctx.clearRect(0, y, width, rows); // a repeated pass must replace, not blend over, the first one
        ctx.drawImage(band, 0, y);
        await breathe();
      }
      if (complete || settledEpoch() === before) break;
    }
    band.width = band.height = 0;
  }
  // the layers that elements with a blend mode were painted on are as big as the export: not kept for the editor
  releaseLayers();
  throwIfAborted(req.signal);

  if (req.flatten) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = req.flatten;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  return canvas;
}

/** Frees the pixel memory right away (it can be hundreds of MB for a big export). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** `canvas.toBlob` as a promise; a null result means the browser could not encode a canvas this big. */
export function canvasToBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob && blob.size > 0 ? resolve(blob) : reject(new ExportError("too-large", TOO_LARGE))), type, quality);
    } catch (cause) {
      reject(new ExportError("too-large", TOO_LARGE, { cause }));
    }
  });
}

/** Renders a page and encodes it, releasing the canvas whatever happens. */
export async function renderPageBlob(
  design: Pick<Design, "width" | "height">,
  page: Page,
  req: RasterRequest & { type: "image/png" | "image/jpeg"; quality?: number },
): Promise<Blob> {
  const canvas = await renderExportCanvas(design, page, req);
  try {
    return await canvasToBlob(canvas, req.type, req.quality);
  } finally {
    releaseCanvas(canvas);
  }
}

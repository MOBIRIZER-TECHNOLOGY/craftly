/**
 * The export engine: PNG, JPG, PDF and SVG (plus ZIP bundles for multi-page raster / SVG output), animated GIF
 * and WebM video, the browser download helper, printing and "copy page as image".
 *
 * Every raster goes through `render/renderPage.renderPage` - the same painter as the editor canvas - so what
 * you download is what you see. One page produces one file, several pages a `.zip` (PNG, JPG, SVG) or one
 * multi-page PDF. The thread is handed back to the browser after every page so a large export never freezes
 * the tab, and progress is reported page by page.
 *
 * An animated GIF or video is always one file: the chosen pages play one after another with their animations
 * and transitions (see `animated/`), and progress counts frames instead of pages.
 */
import type { Design } from "@/core/types";
import { ExportError, cancelledError, isCancelled, throwIfAborted } from "./errors";
import { nextMacrotask } from "./yield";
import type { AnimResolution } from "./animated/frames";
import { collectPageLinks } from "./links";
import { FORMAT_EXTENSION, FORMAT_MIME, PX_TO_PT, clampNote, exportFileName, pageFileName, planRaster, resolveExportOptions, type ResolvedExport } from "./options";
import { buildPdfParts, type PdfPageInput } from "./pdf";
import { canvasToBlob, releaseCanvas, renderExportCanvas, renderPageBlob } from "./raster";
import { designPageToSvg } from "./svg";
import { createZip } from "./zip";

export type ExportFormat = "png" | "jpg" | "pdf" | "svg" | "gif" | "webm";

export interface ExportOptions {
  format: ExportFormat;
  /** zero based page indices to export (a gif / webm plays them in this order, as one animation) */
  pages: number[];
  /** pixel multiplier for raster output, 0.25 .. 4 (not used by gif / webm: they take `resolution`) */
  scale: number;
  /** jpg / pdf quality 0.1 .. 1 */
  quality: number;
  /** png only: keep the page background transparent */
  transparent: boolean;
  /** pdf: "standard" = screen size, "print" = 300 dpi */
  pdfMode: "standard" | "print";
  /** svg: embed the fonts used */
  embedFonts: boolean;
  /** gif / webm: length of the picture's shorter side in pixels, 480 | 720 | 1080 (default 720) */
  resolution?: AnimResolution;
  /** gif: frames per second, 1 .. 30 (default 15); a video is always recorded at 30 */
  fps?: number;
}

export interface ExportFile {
  name: string;
  blob: Blob;
  /**
   * Something worth telling the user: the size was reduced to the 8192 px limit, an image could not be
   * embedded ... Absent when the export is exactly what was asked for.
   */
  note?: string;
}

export type ExportProgress = (done: number, total: number) => void;

export { ExportError, isCancelled } from "./errors";
export { printDesign } from "./print";
export { MAX_EXPORT_SIDE } from "./options";

/* ------------------------------------------------------------------ */
/* page loop                                                           */
/* ------------------------------------------------------------------ */

/** Runs `work` for every selected page, reporting progress and yielding to the browser between pages. */
async function forEachPage<T>(
  resolved: ResolvedExport,
  onProgress: ExportProgress | undefined,
  signal: AbortSignal | undefined,
  work: (index: number, step: number) => Promise<T>,
): Promise<T[]> {
  const total = resolved.pages.length;
  const results: T[] = [];
  onProgress?.(0, total);
  for (let step = 0; step < total; step++) {
    throwIfAborted(signal);
    results.push(await work(resolved.pages[step], step));
    onProgress?.(step + 1, total);
    await nextMacrotask();
  }
  return results;
}

const joinNotes = (...notes: Array<string | undefined>) => {
  const text = notes.filter((n): n is string => !!n).join(" ");
  return text || undefined;
};

/* ------------------------------------------------------------------ */
/* per format                                                          */
/* ------------------------------------------------------------------ */

async function exportRaster(design: Design, resolved: ResolvedExport, onProgress: ExportProgress | undefined, signal: AbortSignal | undefined): Promise<ExportFile> {
  const { format, plan } = resolved;
  const type = format === "png" ? "image/png" : "image/jpeg";
  const ext = FORMAT_EXTENSION[format];
  const blobs = await forEachPage(resolved, onProgress, signal, (index) =>
    renderPageBlob(design, design.pages[index], {
      scale: plan.scale,
      type,
      quality: format === "jpg" ? resolved.quality : undefined,
      transparent: format === "png" && resolved.transparent,
      flatten: format === "jpg" ? "#ffffff" : undefined,
      signal,
    }),
  );
  const note = clampNote(plan);
  if (blobs.length === 1) return { name: exportFileName(design.title, ext), blob: blobs[0], note };
  const blob = await createZip(
    blobs.map((data, i) => ({ name: pageFileName(design.title, resolved.pages[i] + 1, ext), data })),
    { signal },
  );
  return { name: exportFileName(design.title, "zip"), blob, note };
}

async function exportSvg(design: Design, resolved: ResolvedExport, onProgress: ExportProgress | undefined, signal: AbortSignal | undefined): Promise<ExportFile> {
  const warnings = new Set<string>();
  const many = resolved.pages.length > 1;
  const files = await forEachPage(resolved, onProgress, signal, async (index) => {
    const result = await designPageToSvg(
      design,
      design.pages[index],
      {
        embedFonts: resolved.embedFonts,
        title: many ? `${design.title} - ${index + 1}` : design.title,
      },
      signal,
    );
    result.warnings.forEach((w) => warnings.add(w));
    return { index, blob: new Blob([result.svg], { type: `${FORMAT_MIME.svg};charset=utf-8` }) };
  });
  const note = joinNotes(...warnings);
  if (files.length === 1) return { name: exportFileName(design.title, "svg"), blob: files[0].blob, note };
  const blob = await createZip(
    files.map((f) => ({ name: pageFileName(design.title, f.index + 1, "svg"), data: f.blob })),
    { signal },
  );
  return { name: exportFileName(design.title, "zip"), blob, note };
}

async function exportPdf(design: Design, resolved: ResolvedExport, onProgress: ExportProgress | undefined, signal: AbortSignal | undefined): Promise<ExportFile> {
  const { plan } = resolved;
  const widthPt = design.width * PX_TO_PT;
  const heightPt = design.height * PX_TO_PT;
  const pages = await forEachPage<PdfPageInput>(resolved, onProgress, signal, async (index) => {
    const page = design.pages[index];
    const canvas = await renderExportCanvas(design, page, { scale: plan.scale, flatten: "#ffffff", signal });
    let jpeg: Uint8Array;
    try {
      jpeg = new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", resolved.quality)).arrayBuffer());
    } finally {
      releaseCanvas(canvas);
    }
    const links = collectPageLinks(page).map((l) => ({ url: l.url, x: l.x * PX_TO_PT, y: l.y * PX_TO_PT, w: l.w * PX_TO_PT, h: l.h * PX_TO_PT }));
    return { widthPt, heightPt, jpeg, links };
  });
  const { parts } = buildPdfParts(pages, { title: design.title });
  return { name: exportFileName(design.title, "pdf"), blob: new Blob(parts as BlobPart[], { type: FORMAT_MIME.pdf }), note: clampNote(plan) };
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Exports the selected pages. Several raster / SVG pages produce one `.zip`, a PDF, GIF or video always one file.
 * `onProgress(done, total)` fires once up front (0 done) and after every page (every frame, for a GIF or video);
 * pass an `AbortSignal` to cancel between pages (frames). Rejects with `ExportError` (see errors.ts) when nothing
 * is selected, a page is too large for the browser to encode, or the browser cannot record video.
 */
export async function exportDesign(design: Design, opts: ExportOptions, onProgress?: ExportProgress, signal?: AbortSignal): Promise<ExportFile> {
  const resolved = resolveExportOptions(design, opts);
  if (!resolved.pages.length) throw new ExportError("no-pages", "Select at least one page to download.");
  throwIfAborted(signal);
  try {
    switch (resolved.format) {
      case "png":
      case "jpg":
        return await exportRaster(design, resolved, onProgress, signal);
      case "pdf":
        return await exportPdf(design, resolved, onProgress, signal);
      case "svg":
        return await exportSvg(design, resolved, onProgress, signal);
      case "gif":
      case "webm": {
        // the encoders are only needed here: they load as their own chunk the first time a GIF or video is made
        const { exportAnimated } = await import("./animated/animatedExport");
        return await exportAnimated(design, resolved, onProgress, signal);
      }
    }
  } catch (error) {
    if (isCancelled(error)) throw cancelledError();
    throw error;
  }
}

/** A PNG of one page at `scale` x the design size (clamped to 8192 px on the longest side). */
export async function pagePngBlob(design: Design, pageIndex: number, scale = 1): Promise<Blob> {
  const page = design.pages[pageIndex];
  if (!page) throw new ExportError("no-pages", "That page does not exist.");
  const plan = planRaster(design.width, design.height, { format: "png", scale, pdfMode: "standard" });
  return renderPageBlob(design, page, { scale: plan.scale, type: "image/png" });
}

/** Puts a PNG of the page on the clipboard (call it from a click handler: browsers require a user gesture). */
export async function copyPageAsImage(design: Design, pageIndex: number): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new ExportError("unsupported", "Your browser cannot copy images. Download the page instead.");
  }
  try {
    // handing over the promise (not the finished blob) keeps Safari happy: the write stays inside the user gesture
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pagePngBlob(design, pageIndex, 1) })]);
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("unsupported", "Could not copy the page. Allow clipboard access for this site, or download it instead.", { cause: error });
  }
}

/** Saves a Blob through a temporary link (the browser's normal download). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

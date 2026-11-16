/**
 * Print: every page is rendered to an image (PNG), laid out one per sheet in a hidden iframe whose `@page` size
 * is the design size, and the browser's print dialog is opened for it.
 */
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import { ExportError, throwIfAborted } from "./errors";
import { nextMacrotask } from "./yield";
import { planRaster } from "./options";
import { renderPageBlob } from "./raster";

/** Up to this many pages the print images are PNG; beyond it JPEG keeps memory in check. */
const LOSSLESS_PAGE_LIMIT = 12;

export interface PrintOptions {
  /** zero based page indices (default: all pages) */
  pages?: number[];
  /** called after each page has been rendered */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** replaces `window.print()` (tests) */
  openPrintDialog?: (win: Window) => void;
}

/** Escapes text for a double-quoted HTML attribute. */
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The document placed in the print iframe: one full-bleed image per page, `@page` as large as the design. */
export function printDocumentHtml(design: Pick<Design, "title" | "width" | "height">, urls: string[]): string {
  const w = Math.round(design.width);
  const h = Math.round(design.height);
  const images = urls.map((url, i) => `<img src="${attr(url)}" alt="Page ${i + 1}">`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${attr(design.title)}</title><style>
@page { size: ${w}px ${h}px; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img { display: block; width: ${w}px; height: ${h}px; break-after: page; page-break-after: always; }
img:last-child { break-after: auto; page-break-after: auto; }
</style></head><body>${images}</body></html>`;
}

/** Renders every page and opens the print dialog. Resolves once the dialog has been requested. */
export async function printDesign(design: Design, options: PrintOptions = {}): Promise<void> {
  if (typeof document === "undefined") throw new ExportError("unsupported", m.exporting.print.unavailable);
  const wanted = (options.pages ?? design.pages.map((_p, i) => i)).filter((i) => i >= 0 && i < design.pages.length);
  if (!wanted.length) throw new ExportError("no-pages", m.exporting.print.nothing);

  // about 190 dpi on a 1080p design: sharp on paper without a gigantic file per page. Lossless PNG for ordinary
  // documents, high-quality JPEG once there are so many pages that PNGs would eat the tab's memory.
  const plan = planRaster(design.width, design.height, { format: "png", scale: 2, pdfMode: "standard" });
  const lossless = wanted.length <= LOSSLESS_PAGE_LIMIT;
  const urls: string[] = [];
  const cleanupUrls = () => urls.forEach((u) => URL.revokeObjectURL(u));
  try {
    for (let n = 0; n < wanted.length; n++) {
      throwIfAborted(options.signal);
      const blob = await renderPageBlob(design, design.pages[wanted[n]], {
        scale: plan.scale,
        type: lossless ? "image/png" : "image/jpeg",
        quality: lossless ? undefined : 0.95,
        flatten: "#ffffff", // paper has no transparency
        signal: options.signal,
      });
      urls.push(URL.createObjectURL(blob));
      options.onProgress?.(n + 1, wanted.length);
      await nextMacrotask();
    }
  } catch (error) {
    cleanupUrls();
    throw error;
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  const cleanup = () => {
    frame.remove();
    cleanupUrls();
  };

  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new ExportError("unsupported", m.exporting.print.prepareFailed));
    frame.srcdoc = printDocumentHtml(design, urls);
    document.body.appendChild(frame);
  }).catch((error) => {
    cleanup();
    throw error;
  });

  const win = frame.contentWindow;
  if (!win) {
    cleanup();
    throw new ExportError("unsupported", m.exporting.print.dialogFailed);
  }
  // every <img> must be decoded before the dialog opens, or sheets come out blank
  await Promise.all(
    Array.from(win.document.images).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.onload = img.onerror = () => resolve();
          }),
    ),
  );
  await Promise.all(Array.from(win.document.images).map((img) => img.decode().catch(() => undefined)));

  // keep the frame until the dialog is done (Firefox / Safari return from print() immediately)
  const timer = window.setTimeout(cleanup, 5 * 60 * 1000);
  win.addEventListener("afterprint", () => {
    window.clearTimeout(timer);
    window.setTimeout(cleanup, 500);
  });
  win.focus();
  (options.openPrintDialog ?? ((w: Window) => w.print()))(win);
}

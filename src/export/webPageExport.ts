/**
 * "Download as a web page", the part that needs a browser: every chosen page is painted by the ordinary exporter
 * (the editor's own painter), turned into a data URL, and handed to `buildWebPage` (webPage.ts), which writes the file.
 */
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import { blobToDataUrl } from "./encoding";
import { ExportError, cancelledError, isCancelled, throwIfAborted } from "./errors";
import { exportDesign, type ExportFile, type ExportOptions, type ExportProgress } from "./exporters";
import { exportFileName, normalizePages } from "./options";
import { MAX_WEB_PAGE_BYTES, buildWebPage, pageAltText, webPageTooLarge, type WebPageSlide } from "./webPage";
import { nextMacrotask } from "./yield";

export interface WebPageRequest {
  /** zero based page indices */
  pages: number[];
  /** write the presenter notes into the file (they are private: off unless asked for) */
  notes: boolean;
  /** language of the file, as a BCP 47 tag */
  lang?: string;
}

/** A picture this long on its longer side fills a full HD screen; a small design is painted at twice its size at most. */
const LONG_SIDE = 1920;
const MAX_SCALE = 2;
/** JPEG, because a page with a photograph is a tenth of its PNG, and at this quality text stays clean. */
const QUALITY = 0.9;

/** The options one page of a web page is painted with. */
export function webPageOptions(design: Pick<Design, "width" | "height">, page: number): ExportOptions {
  const scale = Math.min(MAX_SCALE, LONG_SIDE / Math.max(design.width, design.height));
  return { format: "jpg", pages: [page], scale, quality: QUALITY, transparent: false, pdfMode: "standard", embedFonts: true };
}

/**
 * The chosen pages of `design` as one self-contained .html file. `onProgress(done, total)` counts pages; the signal
 * cancels between pages. Rejects with an `ExportError` when no page is chosen or the file would be larger than
 * MAX_WEB_PAGE_BYTES (it stops painting as soon as that is certain).
 */
export async function exportWebPage(design: Design, request: WebPageRequest, onProgress?: ExportProgress, signal?: AbortSignal): Promise<ExportFile> {
  const pages = normalizePages(request.pages, design.pages.length);
  if (!pages.length) throw new ExportError("no-pages", m.exporting.errors.noPages);
  throwIfAborted(signal);

  const slides: WebPageSlide[] = [];
  const notes = new Set<string>();
  let bytes = 0;
  onProgress?.(0, pages.length);
  try {
    for (const index of pages) {
      throwIfAborted(signal);
      const page = design.pages[index];
      const file = await exportDesign(design, webPageOptions(design, index), undefined, signal);
      if (file.note) notes.add(file.note);
      const src = await blobToDataUrl(file.blob);
      bytes += src.length;
      // the rest need not be painted to know the answer
      if (bytes > MAX_WEB_PAGE_BYTES) throw webPageTooLarge();
      slides.push({ src, alt: pageAltText(page), name: page.name, notes: page.notes });
      onProgress?.(slides.length, pages.length);
      await nextMacrotask();
    }
    const html = buildWebPage({ title: design.title, width: design.width, height: design.height, slides, lang: request.lang, notes: request.notes });
    return { name: exportFileName(design.title, "html"), blob: new Blob([html], { type: "text/html;charset=utf-8" }), note: [...notes].join(" ") || undefined };
  } catch (error) {
    if (isCancelled(error)) throw cancelledError();
    throw error;
  }
}

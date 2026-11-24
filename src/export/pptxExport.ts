/**
 * "Download as PowerPoint", the part that needs a browser: every chosen page is painted by the ordinary exporter (the editor's
 * own painter), and `buildPptxParts` (pptx.ts) writes the presentation around the pictures, which the ZIP writer packs.
 */
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import { ExportError, cancelledError, isCancelled, throwIfAborted } from "./errors";
import { exportDesign, type ExportFile, type ExportOptions, type ExportProgress } from "./exporters";
import { exportFileName, normalizePages } from "./options";
import { buildPptxParts, type PptxSlide } from "./pptx";
import { pptxObjects } from "./pptxObjects";
import { pageAltText } from "./webPage";
import { createZip } from "./zip";
import { nextMacrotask } from "./yield";

export interface PptxRequest {
  /** zero based page indices */
  pages: number[];
  /** write the presenter notes into the file (they are private: off unless asked for) */
  notes: boolean;
}

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** A picture this long on its longer side is sharp on a large screen; a small design is painted at twice its size at most. */
const LONG_SIDE = 2560;
const MAX_SCALE = 2;
/** JPEG, because a page with a photograph is a tenth of its PNG, and at this quality text stays clean. */
const QUALITY = 0.92;

/** The options one page of a presentation is painted with. */
export function pptxOptions(design: Pick<Design, "width" | "height">, page: number): ExportOptions {
  const scale = Math.min(MAX_SCALE, LONG_SIDE / Math.max(design.width, design.height));
  return { format: "jpg", pages: [page], scale, quality: QUALITY, transparent: false, pdfMode: "standard", embedFonts: true };
}

/**
 * The chosen pages of `design` as one .pptx file, a slide for each. `onProgress(done, total)` counts pages; the signal cancels
 * between pages. Rejects with an `ExportError` when no page is chosen.
 */
export async function exportPptx(design: Design, request: PptxRequest, onProgress?: ExportProgress, signal?: AbortSignal): Promise<ExportFile> {
  const pages = normalizePages(request.pages, design.pages.length);
  if (!pages.length) throw new ExportError("no-pages", m.exporting.errors.noPages);
  throwIfAborted(signal);

  const slides: PptxSlide[] = [];
  const notes = new Set<string>();
  onProgress?.(0, pages.length);
  try {
    for (const index of pages) {
      throwIfAborted(signal);
      const page = design.pages[index];
      const objects = pptxObjects(page);
      const nativeIds = new Set(objects.map((object) => object.id));
      const background = nativeIds.size
        ? { ...design, pages: design.pages.map((item) => (item.id === page.id ? { ...item, elements: item.elements.filter((el) => !nativeIds.has(el.id)) } : item)) }
        : design;
      const file = await exportDesign(background, pptxOptions(design, index), undefined, signal);
      if (file.note) notes.add(file.note);
      slides.push({
        image: new Uint8Array(await file.blob.arrayBuffer()),
        type: "image/jpeg",
        name: page.name,
        alt: pageAltText(page),
        notes: page.notes,
        objects,
        transition: page.transition ?? undefined,
      });
      onProgress?.(slides.length, pages.length);
      await nextMacrotask();
    }
    const parts = buildPptxParts({ title: design.title, width: design.width, height: design.height, slides, notes: request.notes, created: new Date() });
    const zip = await createZip(parts, { signal });
    return { name: exportFileName(design.title, "pptx"), blob: new Blob([zip], { type: PPTX_MIME }), note: [...notes].join(" ") || undefined };
  } catch (error) {
    if (isCancelled(error)) throw cancelledError();
    throw error;
  }
}

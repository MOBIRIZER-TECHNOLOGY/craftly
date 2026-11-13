/**
 * "Several sizes": the chosen pages of one design at a set of sizes, in one ZIP.
 *
 * Every size is made from a copy of the design that is refitted in memory the way the Resize dialog refits it
 * (`resizeDesign`: scaled to fit, centred) and then handed to the ordinary exporter, so a file of this download is
 * what Resize followed by Download would have given. The design that is open, its history and the library are
 * never written to. Which sizes, which names and how much is allowed is decided in multiSizePlan.ts.
 */
import { cloneDeep } from "@/core/clone";
import { resizeDesign } from "@/core/ops";
import type { Design } from "@/core/types";
import { ExportError, cancelledError, isCancelled, throwIfAborted } from "./errors";
import { exportDesign, type ExportFile, type ExportProgress } from "./exporters";
import { multiSizeFileName, multiSizeOptions, multiSizeZipName, planMultiSize, type MultiSizeFormat } from "./multiSizePlan";
import { FORMAT_EXTENSION, normalizePages } from "./options";
import { nextMacrotask } from "./yield";
import { createZip, type ZipInput } from "./zip";

export interface MultiSizeRequest {
  /** ids from `sizeChoices` */
  sizeIds: string[];
  /** zero based page indices */
  pages: number[];
  format: MultiSizeFormat;
  /** jpg quality 0.1 .. 1 */
  quality: number;
}

/**
 * Exports `request.pages` of `design` at every size of `request.sizeIds` and packs the files into one archive:
 * a picture per page and size, or one PDF per size. `onProgress(done, total)` counts pages over all sizes;
 * the signal cancels between pages. Rejects with an `ExportError` in the plan's words when nothing is chosen or
 * the download would be more than the limits allow.
 */
export async function exportSeveralSizes(design: Design, request: MultiSizeRequest, onProgress?: ExportProgress, signal?: AbortSignal): Promise<ExportFile> {
  const plan = planMultiSize(design, request.sizeIds, request.pages, request.format);
  const pages = normalizePages(request.pages, design.pages.length);
  if (plan.problem) throw new ExportError(plan.sizes.length && pages.length ? "too-large" : "no-pages", plan.problem);
  throwIfAborted(signal);

  const extension = FORMAT_EXTENSION[request.format];
  const total = plan.sizes.length * pages.length;
  const entries: ZipInput[] = [];
  const notes = new Set<string>();
  let done = 0;
  onProgress?.(0, total);
  try {
    for (const size of plan.sizes) {
      throwIfAborted(signal);
      // the copy lives for this turn of the loop only: when the next size starts, nothing of this one is held but its encoded files
      const copy = cloneDeep(design);
      if (!size.current) resizeDesign(copy, size.width, size.height, true);
      if (request.format === "pdf") {
        const base = done;
        const file = await exportDesign(copy, multiSizeOptions("pdf", request.quality, pages), (pagesDone) => onProgress?.(base + pagesDone, total), signal);
        entries.push({ name: multiSizeFileName(design.title, size, null, extension), data: file.blob });
        if (file.note) notes.add(file.note);
        done = base + pages.length;
      } else {
        for (const index of pages) {
          throwIfAborted(signal);
          const file = await exportDesign(copy, multiSizeOptions(request.format, request.quality, [index]), undefined, signal);
          entries.push({ name: multiSizeFileName(design.title, size, pages.length > 1 ? index + 1 : null, extension), data: file.blob });
          if (file.note) notes.add(file.note);
          onProgress?.(++done, total);
        }
      }
      // a breath between sizes: the browser can paint, take a Cancel, and let go of the canvases of the size just done
      await nextMacrotask();
    }
    const blob = await createZip(entries, { signal });
    return { name: multiSizeZipName(design.title, plan.sizes.length), blob, note: [...notes].join(" ") || undefined };
  } catch (error) {
    if (isCancelled(error)) throw cancelledError();
    throw error;
  }
}

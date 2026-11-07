/**
 * Loads everything a page needs (pictures, graphics, fonts) before it is painted or converted, one resource at
 * a time with a breather in between. `preparePage` would start them all at once - fine for a thumbnail, but the
 * built-in photos are generated on a canvas (100-200 ms each), and a page with eight of them would hold the main
 * thread for a second. Loading them in sequence keeps every step short.
 */
import type { Page } from "@/core/types";
import { loadImage, loadSvgImage } from "@/render/images";
import { collectResources, preparePage } from "@/render/renderPage";
import { nextMacrotask } from "./yield";
import { throwIfAborted } from "./errors";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Hands the thread back when `sliceMs` have passed since `since`; returns the new slice start. */
export async function breathe(since: number, sliceMs = 24, signal?: AbortSignal): Promise<number> {
  throwIfAborted(signal);
  if (now() - since <= sliceMs) return since;
  await nextMacrotask();
  throwIfAborted(signal);
  return now();
}

/** Same guarantee as `preparePage`, without long main-thread stalls. */
export async function loadPageResources(page: Page, signal?: AbortSignal): Promise<void> {
  const res = collectResources(page);
  let slice = now();
  for (const src of res.images) {
    await loadImage(src);
    slice = await breathe(slice, 16, signal);
  }
  for (const svg of res.svgs) {
    await loadSvgImage(svg);
    slice = await breathe(slice, 16, signal);
  }
  await preparePage(page); // fonts, and a final check that nothing is missing
}

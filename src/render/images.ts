/**
 * Image and SVG loading with caching. `getImage` is synchronous (returns the
 * cached bitmap, or null while it loads and notifies subscribers when ready) so
 * the painter never awaits; `loadImage` is the awaitable twin used by export.
 */
import { getAssetUrl } from "@/core/assets";
import { svgToDataUrl } from "@/core/svg";
import { getPhotoImage, getPhotoThumb } from "@/data/photos";

export type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const loaded = new Map<string, Drawable>();
const inflight = new Map<string, Promise<Drawable | null>>();
const failed = new Set<string>();
const subs = new Set<() => void>();
let epoch = 0;

export const imagesEpoch = () => epoch;

export function retryAssetImage(id: string): void {
  if (!failed.delete(`asset:${id}`)) return;
  epoch++;
  subs.forEach((cb) => cb());
}
export function onImagesChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function loadElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${url.slice(0, 60)}`));
    img.src = url;
  });
}

async function resolveSource(src: string): Promise<Drawable | null> {
  if (src.startsWith("builtin:")) return getPhotoImage(src.slice(8), 1600);
  if (src.startsWith("asset:")) {
    const url = await getAssetUrl(src.slice(6));
    return url ? loadElement(url) : null;
  }
  return loadElement(src);
}

function begin(key: string, make: () => Promise<Drawable | null>): Promise<Drawable | null> {
  const running = inflight.get(key);
  if (running) return running;
  const p = make()
    .then((img) => {
      if (img) {
        loaded.set(key, img);
        if (loaded.size > 500) loaded.delete(loaded.keys().next().value as string);
      } else failed.add(key);
      return img;
    })
    .catch(() => {
      failed.add(key);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
      epoch++;
      subs.forEach((cb) => cb());
    });
  inflight.set(key, p);
  return p;
}

export function loadImage(src: string): Promise<Drawable | null> {
  const hit = loaded.get(src);
  if (hit) return Promise.resolve(hit);
  if (failed.has(src)) return Promise.resolve(null);
  return begin(src, () => resolveSource(src));
}

export function getImage(src: string): Drawable | null {
  const hit = loaded.get(src);
  if (hit) return hit;
  if (!failed.has(src) && !inflight.has(src)) void loadImage(src);
  return null;
}

/* ---------------- SVG graphics ---------------- */

const svgKey = (svg: string) => `svg:${svg}`;

export function loadSvgImage(svg: string): Promise<Drawable | null> {
  const key = svgKey(svg);
  const hit = loaded.get(key);
  if (hit) return Promise.resolve(hit);
  if (failed.has(key)) return Promise.resolve(null);
  return begin(key, () => loadElement(svgToDataUrl(svg)));
}

export function getSvgImage(svg: string): Drawable | null {
  const key = svgKey(svg);
  const hit = loaded.get(key);
  if (hit) return hit;
  if (!failed.has(key) && !inflight.has(key)) void loadSvgImage(svg);
  return null;
}

/** A URL usable in <img> / CSS for any image source (builtin photos become object URLs). */
export async function imageUrl(src: string): Promise<string | null> {
  if (src.startsWith("builtin:")) return getPhotoThumb(src.slice(8), 1600);
  if (src.startsWith("asset:")) return getAssetUrl(src.slice(6));
  return src;
}

export function drawableSize(d: Drawable): { width: number; height: number } {
  if (d instanceof HTMLImageElement) return { width: d.naturalWidth, height: d.naturalHeight };
  return { width: (d as HTMLCanvasElement | ImageBitmap).width, height: (d as HTMLCanvasElement | ImageBitmap).height };
}

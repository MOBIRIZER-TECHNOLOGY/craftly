/**
 * Uploaded media (the "Uploads" tab). Files are stored as Blobs in IndexedDB
 * and referenced from documents as `asset:<id>`.
 */
import { m } from "@/i18n";
import { uid } from "./ids";
import { dbDelete, dbGet, dbGetAll, dbPut, dbPutMany, openDb, wrap, writeTransaction } from "./persistence";
import { parseViewBox } from "./svg";
import { svgProblem } from "./svgSafety";
import type { Asset } from "./types";

const listeners = new Set<() => void>();
export const subscribeAssets = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const emit = () => listeners.forEach((l) => l());

const urlCache = new Map<string, string>();

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif", "image/bmp"];

/** An SVG that could not be kept and could not be drawn either is refused with these words. */
export const UNDRAWABLE_SVG_MESSAGE = m.core.undrawableSvg;

const SVG_TYPE = "image/svg+xml";
/** The longest side, in pixels, of the picture an SVG is drawn as: twice its own size, but not under the first and not over the second. */
const DRAWN_MIN = 1024;
const DRAWN_MAX = 2048;

const flattenedListeners = new Set<() => void>();
/** Called each time an SVG was stored as a picture because it was more than plain drawing (src/uploadNotices.ts tells the person). */
export const subscribeFlattenedSvg = (cb: () => void) => {
  flattenedListeners.add(cb);
  return () => flattenedListeners.delete(cb);
};

async function decoded<T>(blob: Blob, read: (img: HTMLImageElement) => T | Promise<T>): Promise<T> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await read(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function measure(blob: Blob, markup?: string): Promise<{ width: number; height: number }> {
  const vb = markup === undefined ? null : parseViewBox(markup);
  if (vb) return { width: vb.w, height: vb.h };
  return decoded(blob, (img) => ({ width: img.naturalWidth || 800, height: img.naturalHeight || 600 }));
}

/**
 * The SVG as a PNG. An image element runs no script and asks no other computer for anything, whatever the markup says, and what
 * it shows is painted on a canvas and read back as pixels: the result is a picture and nothing else. A browser that will not draw
 * it, or will not hand the pixels out, leaves nothing to keep.
 */
async function drawAsPicture(markup: string): Promise<{ blob: Blob; width: number; height: number }> {
  try {
    return await decoded(new Blob([markup], { type: SVG_TYPE }), async (img) => {
      const stated = parseViewBox(markup);
      const w = stated?.w ?? img.naturalWidth;
      const h = stated?.h ?? img.naturalHeight;
      if (!(w > 0 && h > 0)) throw new Error("no size");
      const longest = Math.max(w, h);
      const scale = Math.min(DRAWN_MAX, Math.max(DRAWN_MIN, longest * 2)) / longest;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("no picture");
      return { blob, width: canvas.width, height: canvas.height };
    });
  } catch {
    throw new Error(UNDRAWABLE_SVG_MESSAGE);
  }
}

export interface CheckedUpload {
  /** what is stored: its type is always `mime` */
  blob: Blob;
  kind: Asset["kind"];
  mime: string;
  /** the markup, when it is kept as an SVG */
  markup?: string;
  /** the size in pixels, when an SVG was drawn as a picture */
  drawn?: { width: number; height: number };
}

const typed = (blob: Blob, mime: string) => (blob.type === mime ? blob : new Blob([blob], { type: mime }));

/**
 * What may be stored of a picture that came from outside: an upload, a project file, a backup, somebody else in a shared design.
 * Every one of them goes through here, because a stored upload is shown through a blob: address, and a browser that is sent to
 * such an address ("Open image in new tab") runs what it finds there as a page of this site.
 *   - An SVG that is plain drawing (`svgProblem`) is kept as it is.
 *   - Any other SVG (a style sheet, a comment, a script, a link, a picture from the web) is not kept as an SVG: it is drawn and
 *     stored as a PNG, and `subscribeFlattenedSvg` is told. One that cannot be drawn is refused (`UNDRAWABLE_SVG_MESSAGE`).
 *   - Anything else is stored under its own type only when that is a picture type, and as a PNG otherwise, so that nothing is
 *     ever stored as a page.
 * An SVG is known by its type or by the name it came with. The size of the picture is not measured here.
 */
export async function checkUpload(blob: Blob, name = ""): Promise<CheckedUpload> {
  if (!/svg/i.test(blob.type) && !/\.svg$/i.test(name)) {
    const mime = blob.type.startsWith("image/") ? blob.type : "image/png";
    return { blob: typed(blob, mime), kind: "image", mime };
  }
  const markup = await blob.text();
  if (svgProblem(markup) === null) return { blob: typed(blob, SVG_TYPE), kind: "svg", mime: SVG_TYPE, markup };
  const drawn = await drawAsPicture(markup);
  flattenedListeners.forEach((l) => l());
  return { blob: drawn.blob, kind: "image", mime: "image/png", drawn: { width: drawn.width, height: drawn.height } };
}

/**
 * The bytes of an upload as they are stored by a browser whose database will not keep a Blob: WebKit in a private window (and
 * Playwright's WebKit) refuses one with "Error preparing Blob/File data to be stored in object store", but keeps an ArrayBuffer.
 */
interface StoredBytes {
  bytes: ArrayBuffer;
  type: string;
}
/** An upload as it is in the "assets" store: with a Blob, or with its bytes (`StoredBytes`). */
export type StoredAsset = Omit<Asset, "blob"> & { blob: Blob | StoredBytes };

const PROBE_ID = "\u0000blob-probe";
let blobsKept: Promise<boolean> | null = null;

/**
 * Whether this browser's database keeps a Blob, asked once by writing one and taking the write back (the transaction is given
 * up either way, so nothing of it is ever stored).
 */
function databaseKeepsBlobs(): Promise<boolean> {
  blobsKept ??= openDb()
    .then(
      (db) =>
        new Promise<boolean>((resolve) => {
          const tx = db.transaction("assets", "readwrite");
          const settle = (kept: boolean) => {
            resolve(kept);
            try {
              tx.abort();
            } catch {
              // the transaction has already ended
            }
          };
          try {
            const request = tx.objectStore("assets").put({ id: PROBE_ID, blob: new Blob(["probe"]) });
            request.onsuccess = () => settle(true);
            request.onerror = (event) => {
              event.preventDefault();
              settle(false);
            };
          } catch {
            settle(false);
          }
        }),
    )
    .catch(() => {
      blobsKept = null;
      return true;
    });
  return blobsKept;
}

/** The upload as it can be stored here: as it is, or with its bytes in place of the Blob when the database will not keep one. */
export async function storableAsset(asset: Asset): Promise<StoredAsset> {
  if (await databaseKeepsBlobs()) return asset;
  return { ...asset, blob: { bytes: await asset.blob.arrayBuffer(), type: asset.blob.type || asset.mime } };
}

/** The upload as it was stored, with a Blob again. */
export function storedAsset(stored: StoredAsset): Asset {
  const { blob } = stored;
  if (blob instanceof Blob || !blob || typeof blob !== "object" || !("bytes" in blob)) return stored as Asset;
  return { ...stored, blob: new Blob([blob.bytes], { type: blob.type || stored.mime }) };
}

export function isAcceptedImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.name);
}

export async function prepareAssetFromFile(file: File, id = uid("a")): Promise<Asset> {
  const checked = await checkUpload(file, file.name);
  const size = checked.drawn ?? (await measure(checked.blob, checked.markup));
  return {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "Upload",
    kind: checked.kind,
    mime: checked.mime,
    size: checked.blob.size,
    width: size.width,
    height: size.height,
    createdAt: Date.now(),
    blob: checked.blob,
  };
}

export async function addAssetFromFile(file: File): Promise<Asset> {
  const asset = await prepareAssetFromFile(file);
  await dbPut("assets", await storableAsset(asset));
  emit();
  return asset;
}

/** Stores uploads from a backup as they are (ids kept) in one transaction and tells subscribers once. */
export async function restoreAssets(assets: Asset[]): Promise<void> {
  if (!assets.length) return;
  const stored = await Promise.all(assets.map(storableAsset));
  await dbPutMany(stored.map((value) => ({ store: "assets" as const, value })));
  emit();
}

/** Cache a collaborator's image without replacing a local upload with the same id. */
export async function cacheSharedAsset(asset: Asset): Promise<void> {
  const stored = await storableAsset(asset);
  const added = await writeTransaction(["assets"], async (tx) => {
    const store = tx.objectStore("assets");
    if ((await wrap(store.getKey(asset.id))) !== undefined) return false;
    store.add(stored);
    return true;
  });
  if (added) emit();
}

export async function listAssets(): Promise<Asset[]> {
  return (await dbGetAll<StoredAsset>("assets")).map(storedAsset).sort((a, b) => b.createdAt - a.createdAt);
}

export const getAsset = (id: string) => dbGet<StoredAsset>("assets", id).then((a) => (a ? storedAsset(a) : null));

export async function renameAsset(id: string, name: string): Promise<void> {
  const a = await getAsset(id);
  if (!a) return;
  await dbPut("assets", await storableAsset({ ...a, name: name.trim() || a.name }));
  emit();
}

export async function deleteAsset(id: string): Promise<void> {
  await dbDelete("assets", id);
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  emit();
}

/** Object URL for an asset (cached for the life of the page). */
export async function getAssetUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const asset = await getAsset(id);
  if (!asset) return null;
  const url = URL.createObjectURL(asset.blob);
  urlCache.set(id, url);
  return url;
}

export const assetSrc = (id: string) => `asset:${id}`;

/** Reads any image blob (e.g. from the clipboard or a drop) into the library. */
export async function addAssetFromBlob(blob: Blob, name = m.core.pastedImage): Promise<Asset> {
  const ext = blob.type.split("/")[1]?.replace("svg+xml", "svg") || "png";
  return addAssetFromFile(new File([blob], `${name}.${ext}`, { type: blob.type }));
}

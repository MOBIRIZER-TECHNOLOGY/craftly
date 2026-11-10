/**
 * Uploaded media (the "Uploads" tab). Files are stored as Blobs in IndexedDB
 * and referenced from documents as `asset:<id>`.
 */
import { uid } from "./ids";
import { dbDelete, dbGet, dbGetAll, dbPut, dbPutMany, wrap, writeTransaction } from "./persistence";
import { parseViewBox } from "./svg";
import type { Asset } from "./types";

const listeners = new Set<() => void>();
export const subscribeAssets = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const emit = () => listeners.forEach((l) => l());

const urlCache = new Map<string, string>();

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif", "image/bmp"];

async function measure(file: Blob, isSvg: boolean): Promise<{ width: number; height: number }> {
  if (isSvg) {
    const vb = parseViewBox(await file.text());
    if (vb) return { width: vb.w, height: vb.h };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 800, height: img.naturalHeight || 600 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isAcceptedImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.name);
}

export async function prepareAssetFromFile(file: File, id = uid("a")): Promise<Asset> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const size = await measure(file, isSvg);
  return {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "Upload",
    kind: isSvg ? "svg" : "image",
    mime: file.type || (isSvg ? "image/svg+xml" : "image/png"),
    size: file.size,
    width: size.width,
    height: size.height,
    createdAt: Date.now(),
    blob: file,
  };
}

export async function addAssetFromFile(file: File): Promise<Asset> {
  const asset = await prepareAssetFromFile(file);
  await dbPut("assets", asset);
  emit();
  return asset;
}

/** Stores uploads from a backup as they are (ids kept) in one transaction and tells subscribers once. */
export async function restoreAssets(assets: Asset[]): Promise<void> {
  if (!assets.length) return;
  await dbPutMany(assets.map((value) => ({ store: "assets" as const, value })));
  emit();
}

/** Cache a collaborator's image without replacing a local upload with the same id. */
export async function cacheSharedAsset(asset: Asset): Promise<void> {
  const added = await writeTransaction(["assets"], async (tx) => {
    const store = tx.objectStore("assets");
    if ((await wrap(store.getKey(asset.id))) !== undefined) return false;
    store.add(asset);
    return true;
  });
  if (added) emit();
}

export async function listAssets(): Promise<Asset[]> {
  return (await dbGetAll<Asset>("assets")).sort((a, b) => b.createdAt - a.createdAt);
}

export const getAsset = (id: string) => dbGet<Asset>("assets", id).then((a) => a ?? null);

export async function renameAsset(id: string, name: string): Promise<void> {
  const a = await getAsset(id);
  if (!a) return;
  await dbPut("assets", { ...a, name: name.trim() || a.name });
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
export async function addAssetFromBlob(blob: Blob, name = "Pasted image"): Promise<Asset> {
  const ext = blob.type.split("/")[1]?.replace("svg+xml", "svg") || "png";
  return addAssetFromFile(new File([blob], `${name}.${ext}`, { type: blob.type }));
}

import { cacheSharedAsset, getAsset, prepareAssetFromFile } from "@/core/assets";
import type { Design, LiveLink } from "@/core/types";
import { blobToDataUrl } from "@/export/encoding";
import { collectAssetIds, dataUrlToBytes, extensionForMime } from "@/export/projectFormat";
import { retryAssetImage } from "@/render/images";
import { apiUrl } from "./links";

const assetPath = (link: LiveLink, id: string) => apiUrl(link.server, `/api/rooms/${encodeURIComponent(link.room)}/assets/${encodeURIComponent(id)}`);
const imageType = /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;

export function sharedMedia(link: LiveLink, request: typeof fetch = fetch) {
  const uploaded = new Set<string>();
  const downloads = new Map<string, Promise<void>>();
  return {
    async upload(design: Design, allowed?: ReadonlySet<string>): Promise<void> {
      for (const id of collectAssetIds(design)) {
        if (uploaded.has(id) || (allowed && !allowed.has(id))) continue;
        const asset = await getAsset(id);
        // An asset from another member may still be downloading. It already belongs to this room.
        if (!asset) {
          const existing = await request(assetPath(link, id), { headers: { "x-craftly-key": link.key }, signal: AbortSignal.timeout(15000) });
          if (existing.ok) {
            uploaded.add(id);
            continue;
          }
          throw new Error("An uploaded image is missing. Replace it to sync this design.");
        }
        const url = await blobToDataUrl(asset.blob);
        const res = await request(assetPath(link, id), {
          method: "PUT",
          headers: { "x-craftly-key": link.key, "content-type": "application/json" },
          body: JSON.stringify({ mime: asset.mime, base64: url.slice(url.indexOf(",") + 1) }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Could not share an uploaded image (server response ${res.status}). Check the image size and try again.`);
        uploaded.add(id);
      }
    },
    async download(design: Design): Promise<void> {
      await Promise.all(
        collectAssetIds(design).map(async (id) => {
          if (await getAsset(id)) return;
          let pending = downloads.get(id);
          if (!pending) {
            pending = (async () => {
              const res = await request(assetPath(link, id), { headers: { "x-craftly-key": link.key }, signal: AbortSignal.timeout(15000) });
              if (!res.ok) throw new Error("A shared image could not be loaded.");
              const { mime, base64 } = (await res.json()) as { mime?: unknown; base64?: unknown };
              if (typeof mime !== "string" || !imageType.test(mime) || typeof base64 !== "string" || base64.length > 12 * 1024 * 1024) {
                throw new Error("The server returned an unsupported image.");
              }
              const decoded = dataUrlToBytes(`data:${mime};base64,${base64}`);
              if (!decoded) throw new Error("The shared image is damaged.");
              const file = new File([decoded.bytes as BlobPart], `Shared image.${extensionForMime(mime)}`, { type: mime });
              await cacheSharedAsset(await prepareAssetFromFile(file, id));
              uploaded.add(id);
              retryAssetImage(id);
            })().finally(() => downloads.delete(id));
            downloads.set(id, pending);
          }
          await pending;
        }),
      );
    },
  };
}

import { PermanentSendError } from "@/collab/live";
import { cacheSharedAsset, getAsset, prepareAssetFromFile } from "@/core/assets";
import type { Design, LiveLink } from "@/core/types";
import { blobToDataUrl } from "@/export/encoding";
import { m } from "@/i18n";
import { collectAssetIds, dataUrlToBytes, extensionForMime } from "@/export/projectFormat";
import { retryAssetImage } from "@/render/images";
import { apiUrl } from "./links";

const assetPath = (link: LiveLink, id: string) => apiUrl(link.server, `/api/rooms/${encodeURIComponent(link.room)}/assets/${encodeURIComponent(id)}`);
/**
 * Whether the server refused the request itself (too big, the room is full of images, the id is taken, not allowed), so that asking
 * again gets the same answer; as opposed to a server that is busy or broken for the moment, which is asked again later.
 */
const refused = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;
const imageType = /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;

/**
 * The pictures of a shared design, sent to its room and fetched from it. Its clips are not: a room keeps pictures only, so the
 * others see a clip's element without the clip. With `session`, the room is one bound to a design of a team
 * (docs/ACCOUNTS.md): the member's session goes as a bearer token in place of the key.
 */
export function sharedMedia(link: LiveLink, request: typeof fetch = fetch, session?: string) {
  const credential: Record<string, string> = session ? { authorization: `Bearer ${session}` } : { "x-craftly-key": link.key };
  const uploaded = new Set<string>();
  const downloads = new Map<string, Promise<void>>();
  return {
    async upload(design: Design, allowed?: ReadonlySet<string>): Promise<void> {
      for (const id of collectAssetIds(design, { clips: false })) {
        if (uploaded.has(id) || (allowed && !allowed.has(id))) continue;
        const asset = await getAsset(id);
        // An asset from another member may still be downloading. It already belongs to this room.
        if (!asset) {
          const existing = await request(assetPath(link, id), { headers: credential, signal: AbortSignal.timeout(15000) });
          if (existing.ok) {
            uploaded.add(id);
            continue;
          }
          if (refused(existing.status)) throw new PermanentSendError(m.editor.live.media.missing);
          throw new Error(m.editor.live.media.checkFailed(existing.status));
        }
        const url = await blobToDataUrl(asset.blob);
        const res = await request(assetPath(link, id), {
          method: "PUT",
          headers: { ...credential, "content-type": "application/json" },
          body: JSON.stringify({ mime: asset.mime, base64: url.slice(url.indexOf(",") + 1) }),
          signal: AbortSignal.timeout(15000),
        });
        if (refused(res.status)) throw new PermanentSendError(m.editor.live.media.cannotShare(res.status));
        if (!res.ok) throw new Error(m.editor.live.media.shareFailed(res.status));
        uploaded.add(id);
      }
    },
    async download(design: Design): Promise<void> {
      await Promise.all(
        collectAssetIds(design, { clips: false }).map(async (id) => {
          if (await getAsset(id)) return;
          let pending = downloads.get(id);
          if (!pending) {
            pending = (async () => {
              const res = await request(assetPath(link, id), { headers: credential, signal: AbortSignal.timeout(15000) });
              if (!res.ok) throw new Error(m.editor.live.media.loadFailed);
              const { mime, base64 } = (await res.json()) as { mime?: unknown; base64?: unknown };
              if (typeof mime !== "string" || !imageType.test(mime) || typeof base64 !== "string" || base64.length > 12 * 1024 * 1024) {
                throw new Error(m.editor.live.media.unsupported);
              }
              const decoded = dataUrlToBytes(`data:${mime};base64,${base64}`);
              if (!decoded) throw new Error(m.editor.live.media.damaged);
              const file = new File([decoded.bytes as BlobPart], `${m.editor.live.media.fileName}.${extensionForMime(mime)}`, { type: mime });
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

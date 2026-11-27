import { PermanentSendError } from "@/collab/live";
import { cacheSharedAsset, getAsset, prepareAssetFromFile } from "@/core/assets";
import type { Design, LiveLink } from "@/core/types";
import { blobToDataUrl } from "@/export/encoding";
import { m } from "@/i18n";
import { clipIds, collectAssetIds, dataUrlToBytes, extensionForMime } from "@/export/projectFormat";
import { retryAssetImage } from "@/render/images";
import { retrySound } from "@/render/soundTracks";
import { retryClip } from "@/render/videos";
import { retrySoundPeaks } from "@/editor/timeline/soundPeaks";
import { toast } from "@/ui";
import { apiUrl } from "./links";

const assetPath = (link: LiveLink, id: string) => apiUrl(link.server, `/api/rooms/${encodeURIComponent(link.room)}/assets/${encodeURIComponent(id)}`);
/**
 * Whether the server refused the request itself (too big, the room is full of images, the id is taken, not allowed), so that asking
 * again gets the same answer; as opposed to a server that is busy or broken for the moment, which is asked again later.
 */
const refused = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;
const imageType = /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;

export { clipIds };

/**
 * The pictures of a shared design, sent to its room and fetched from it (`upload`, `download`), and its clips and sounds
 * (`sendClips`, `fetchClips`; docs/COLLABORATION.md, "Clips and sounds"). With `session`, the room is one bound to a design of a
 * team (docs/ACCOUNTS.md): the member's session goes as a bearer token in place of the key.
 */
export function sharedMedia(link: LiveLink, request: typeof fetch = fetch, session?: string) {
  const credential: Record<string, string> = session ? { authorization: `Bearer ${session}` } : { "x-craftly-key": link.key };
  const uploaded = new Set<string>();
  const downloads = new Map<string, Promise<void>>();
  // clips and sounds: those the room has, those being sent, those being fetched, those the room refused, and how often one has been
  // asked for (sending and fetching are apart: an editor's first look for clips of its own to send must not stop the fetching of the others')
  const clipsThere = new Set<string>();
  const clipsSending = new Set<string>();
  const clipsFetching = new Set<string>();
  const clipsRefused = new Set<string>();
  const clipTries = new Map<string, number>();
  const waits = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  const clipPath = (id: string) => apiUrl(link.server, `/api/rooms/${encodeURIComponent(link.room)}/media/${encodeURIComponent(id)}`);

  /** Sends one clip or sound of this device to the room, unless the room has it; says so when the room will not take it. */
  async function sendClip(id: string): Promise<void> {
    const asset = await getAsset(id);
    // somebody else's clip, still on its way here: it is the room's already
    if (!asset || stopped) return;
    const there = await request(clipPath(id), { method: "HEAD", headers: credential });
    if (there.ok) return void clipsThere.add(id);
    const res = await request(clipPath(id), { method: "PUT", headers: { ...credential, "content-type": asset.mime }, body: asset.blob });
    // taken, or the very same id taken by another clip (the room keeps the first): either way there is nothing more to send
    if (res.ok || res.status === 409) return void clipsThere.add(id);
    if (res.status === 413) {
      clipsRefused.add(id);
      const said = (await res.json().catch(() => ({}))) as { error?: unknown; limit?: unknown };
      const mb = typeof said.limit === "number" ? Math.round(said.limit / (1024 * 1024)) : 0;
      toast.error(/clip is too large/.test(String(said.error)) ? m.editor.live.media.clipTooBig(asset.name, mb) : m.editor.live.media.clipsFull(asset.name));
      return;
    }
    if (refused(res.status)) {
      clipsRefused.add(id);
      toast.error(m.editor.live.media.clipRefused(asset.name, res.status));
      return;
    }
    throw new Error(String(res.status));
  }

  /** Fetches one clip or sound of the room that this device lacks: false when the room has not got it yet (it is still being sent). */
  async function fetchClip(id: string): Promise<boolean> {
    const res = await request(clipPath(id), { headers: credential });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(String(res.status));
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const blob = await res.blob();
    const file = new File([blob], `${m.editor.live.media.clipFileName}.${extensionForMime(mime)}`, { type: mime });
    // checked as an upload is: a clip or a sound that this browser plays, of the types the app keeps
    await cacheSharedAsset(await prepareAssetFromFile(file, id));
    clipsThere.add(id);
    retryAssetImage(id);
    retryClip(id);
    retrySound(id);
    retrySoundPeaks(`asset:${id}`);
    return true;
  }

  /** Asks again for `id` a little later, for up to ten minutes: whoever added it may still be sending it. */
  function later(id: string, again: () => void): void {
    const tries = (clipTries.get(id) ?? 0) + 1;
    clipTries.set(id, tries);
    if (stopped || tries > 120) return;
    const wait = setTimeout(() => {
      waits.delete(wait);
      again();
    }, 5000);
    waits.add(wait);
  }

  return {
    /**
     * Sends the clips and sounds of `design` that are on this device and that the room has not got, one at a time and in the
     * background: an edit never waits for one. One the room refuses (too large, the room full) stays on this device, and the person
     * is told once. One that could not be sent for another reason is tried again with the next call.
     */
    sendClips(design: Pick<Design, "pages" | "audio">): void {
      for (const id of clipIds(design)) {
        if (clipsThere.has(id) || clipsSending.has(id) || clipsRefused.has(id)) continue;
        clipsSending.add(id);
        void sendClip(id)
          .catch(() => undefined)
          .finally(() => clipsSending.delete(id));
      }
    },
    /** Fetches the clips and sounds of `design` that this device has not got, asking again a little later for one not yet in the room. */
    fetchClips(design: Pick<Design, "pages" | "audio">): void {
      const fetchOne = (id: string) => {
        if (stopped || clipsThere.has(id) || clipsFetching.has(id)) return;
        clipsFetching.add(id);
        void (async () => (await getAsset(id)) !== null || (await fetchClip(id)))()
          .then((got) => {
            if (got) clipsThere.add(id);
            else later(id, () => fetchOne(id));
          })
          .catch(() => later(id, () => fetchOne(id)))
          .finally(() => clipsFetching.delete(id));
      };
      clipIds(design).forEach(fetchOne);
    },
    /** No more sending, fetching or asking again (the connection was closed). */
    stop(): void {
      stopped = true;
      waits.forEach(clearTimeout);
      waits.clear();
    },
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

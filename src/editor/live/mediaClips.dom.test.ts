/**
 * The clips and sounds of a shared design (docs/COLLABORATION.md, "Clips and sounds"): sent to the room in the background, once,
 * as themselves; a refusal said once and not tried again; fetched by those who lack them, asked for again while they are still on
 * their way; and the players, posters and sound shapes told when one has come.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { createAudioTrack } from "@/core/audioTracks";
import { createDesign, createImage, createPage, createVideo } from "@/core/factory";
import type { Asset, Design, LiveLink } from "@/core/types";
import { toast } from "@/ui";

vi.mock("@/core/assets", async (original) => ({
  ...(await original<typeof import("@/core/assets")>()),
  getAsset: vi.fn(),
  prepareAssetFromFile: vi.fn(async (file: File, id: string) => ({
    id,
    name: file.name,
    kind: "video",
    mime: file.type,
    size: file.size,
    width: 1,
    height: 1,
    createdAt: 0,
    blob: file,
  })),
  cacheSharedAsset: vi.fn(async () => undefined),
}));
const told = vi.hoisted(() => ({ images: [] as string[], clips: [] as string[], sounds: [] as string[], peaks: [] as string[] }));
vi.mock("@/render/images", async (original) => ({ ...(await original<typeof import("@/render/images")>()), retryAssetImage: (id: string) => told.images.push(id) }));
vi.mock("@/render/videos", async (original) => ({ ...(await original<typeof import("@/render/videos")>()), retryClip: (id: string) => told.clips.push(id) }));
vi.mock("@/render/soundTracks", async (original) => ({ ...(await original<typeof import("@/render/soundTracks")>()), retrySound: (id: string) => told.sounds.push(id) }));
vi.mock("@/editor/timeline/soundPeaks", async (original) => ({
  ...(await original<typeof import("@/editor/timeline/soundPeaks")>()),
  retrySoundPeaks: (src: string) => told.peaks.push(src),
}));

const { clipIds, sharedMedia } = await import("./media");

const link: LiveLink = { server: "https://live.example.test", room: "TW-FaxWt8edjpnT-bGQyjA", key: "WjGO30NJy5udhntaj-8j9w", role: "edit" };
const design = (): Design => ({
  ...createDesign({
    title: "Clips",
    width: 800,
    height: 600,
    pages: [createPage({ elements: [createImage({ id: "i", src: "asset:pic" }), createVideo({ src: "asset:clip", duration: 2 })] })],
  }),
  audio: [createAudioTrack({ src: "asset:song", duration: 3 })],
});
const clip: Asset = { id: "clip", name: "Beach", kind: "video", mime: "video/mp4", size: 4, width: 1, height: 1, createdAt: 0, blob: new Blob(["mp4!"], { type: "video/mp4" }) };
const getAsset = vi.mocked(assets.getAsset);
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A room that answers by method and id: `status[method id]`, or 404; a GET of a clip it has gives its bytes. */
function room(status: Record<string, number>, bodies: Record<string, { mime: string; body: string }> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const id = decodeURIComponent(String(url).split("/").pop()!);
    const method = init?.method ?? "GET";
    const code = status[`${method} ${id}`] ?? (method === "GET" && bodies[id] ? 200 : 404);
    const body = bodies[id];
    return new Response(
      method === "GET" && code === 200 && body ? body.body : code === 413 ? JSON.stringify({ error: "this clip is too large to share", limit: 100 * 1024 * 1024 }) : null,
      {
        status: code,
        headers: body ? { "content-type": body.mime } : {},
      },
    );
  });
}

beforeEach(() => {
  getAsset.mockReset();
  getAsset.mockImplementation(async (id: string) => (id === "clip" ? clip : null));
  vi.mocked(assets.cacheSharedAsset).mockClear();
  Object.assign(told, { images: [], clips: [], sounds: [], peaks: [] });
  vi.spyOn(toast, "error").mockImplementation(() => 0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the clips and sounds of a shared design", () => {
  it("are the uploads of its clips and sounds, not its pictures", () => {
    expect(clipIds(design())).toEqual(["clip", "song"]);
  });

  it("are sent as themselves, under their type, once, and only those on this device that the room has not got", async () => {
    const request = room({ "PUT clip": 201 });
    const media = sharedMedia(link, request as unknown as typeof fetch);
    media.sendClips(design());
    await flush();
    const calls = request.mock.calls.map(([url, init]) => `${init?.method} ${String(url).split("/").slice(-2).join("/")}`);
    // the song is not on this device (somebody else's, on its way here): nothing is sent of it
    expect(calls).toEqual(["HEAD media/clip", "PUT media/clip"]);
    const put = request.mock.calls[1][1]!;
    expect((put.headers as Record<string, string>)["content-type"]).toBe("video/mp4");
    expect((put.headers as Record<string, string>)["x-craftly-key"]).toBe(link.key);
    expect(put.body).toBe(clip.blob);
    media.sendClips(design());
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("are not sent again when the room has them", async () => {
    const request = room({ "HEAD clip": 200 });
    sharedMedia(link, request as unknown as typeof fetch).sendClips(design());
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stay on this device when the room refuses one, which the person is told once", async () => {
    const request = room({ "PUT clip": 413 });
    const media = sharedMedia(link, request as unknown as typeof fetch);
    media.sendClips(design());
    await flush();
    media.sendClips(design());
    await flush();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      '"Beach" is larger than this shared design can carry (100 MB): it stays on this device, and the others see an empty box in its place.',
    );
    expect(request.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });

  it("are sent again with the next call after a passing problem", async () => {
    const request = room({ "PUT clip": 503 });
    const media = sharedMedia(link, request as unknown as typeof fetch);
    media.sendClips(design());
    await flush();
    media.sendClips(design());
    await flush();
    expect(request.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("are fetched by whoever lacks them, kept as uploads under their ids, and the painters told", async () => {
    getAsset.mockResolvedValue(null);
    const request = room({}, { clip: { mime: "video/mp4", body: "mp4!" }, song: { mime: "audio/mpeg", body: "mp3" } });
    sharedMedia(link, request as unknown as typeof fetch).fetchClips(design());
    await vi.waitFor(() => expect(assets.cacheSharedAsset).toHaveBeenCalledTimes(2));
    const prepared = vi.mocked(assets.prepareAssetFromFile).mock.calls.map(([file, id]) => [id, file.type, file.name]);
    expect(prepared).toEqual(
      expect.arrayContaining([
        ["clip", "video/mp4", "Shared clip.mp4"],
        ["song", "audio/mpeg", "Shared clip.mp3"],
      ]),
    );
    await vi.waitFor(() => expect(told.clips.sort()).toEqual(["clip", "song"]));
    expect(told.images.sort()).toEqual(["clip", "song"]);
    expect(told.sounds.sort()).toEqual(["clip", "song"]);
    expect(told.peaks.sort()).toEqual(["asset:clip", "asset:song"]);
  });

  it("are asked for again a little later while they are still on their way, and no more once the connection is closed", async () => {
    vi.useFakeTimers();
    getAsset.mockResolvedValue(null);
    const bodies: Record<string, { mime: string; body: string }> = {};
    const request = room({}, bodies);
    const media = sharedMedia(link, request as unknown as typeof fetch);
    media.fetchClips({ pages: design().pages, audio: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    // it has come to the room meanwhile
    bodies.clip = { mime: "video/mp4", body: "mp4!" };
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(assets.cacheSharedAsset).toHaveBeenCalledTimes(1);
    // one that never comes is asked for until the connection closes
    const asking = room({});
    const other = sharedMedia(link, asking as unknown as typeof fetch);
    other.fetchClips({ pages: design().pages, audio: [] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(asking).toHaveBeenCalledTimes(2);
    other.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asking).toHaveBeenCalledTimes(2);
  });

  it("are fetched by an editor even while it looks for clips of its own to send (both start when the connection is live)", async () => {
    getAsset.mockResolvedValue(null);
    const request = room({}, { clip: { mime: "video/mp4", body: "mp4!" }, song: { mime: "audio/mpeg", body: "mp3" } });
    const media = sharedMedia(link, request as unknown as typeof fetch);
    media.sendClips(design());
    media.fetchClips(design());
    await vi.waitFor(() => expect(assets.cacheSharedAsset).toHaveBeenCalledTimes(2));
  });

  it("are not fetched when they are on this device already", async () => {
    const request = room({});
    sharedMedia(link, request as unknown as typeof fetch).fetchClips({ pages: design().pages, audio: [] });
    await flush();
    expect(request).not.toHaveBeenCalled();
  });
});

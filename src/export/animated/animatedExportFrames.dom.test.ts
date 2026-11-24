import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, createVideo, solid } from "@/core/factory";
import type { Design, DesignElement } from "@/core/types";
import type { ExportOptions } from "../exporters";
import { resolveExportOptions } from "../options";
import { VIDEO_FPS, videoBitrate } from "./frames";

/*
 * A video download in a browser with WebCodecs: made frame by frame with the clips' sound (encode.ts and clipSound.ts are stood in
 * for here and tested on their own in videoEncode.dom.test.ts), and recorded as it plays when no encoder takes the picture.
 */

const encode = vi.hoisted(() => ({
  encoding: { container: "mp4", video: "avc", audio: "aac" } as { container: "mp4" | "webm"; video: string; audio: string | null } | null,
  chosen: [] as Array<[number, number, number, number, boolean]>,
  runs: [] as Array<{ frames: number; fps: number; bitrate: number; sound: unknown; painted: number }>,
  mixed: [] as Array<{ pages: number; total: number }>,
}));

vi.mock("./encode", () => ({
  chooseEncoding: vi.fn(async (w: number, h: number, bitrate: number, rate: number, withSound: boolean) => {
    encode.chosen.push([w, h, bitrate, rate, withSound]);
    if (!encode.encoding) return null;
    return withSound ? encode.encoding : { ...encode.encoding, audio: null };
  }),
  encodeFrames: vi.fn(
    async (o: {
      frames: number;
      fps: number;
      bitrate: number;
      sound: unknown;
      paint: (i: number) => Promise<void>;
      onFrame?: (n: number) => void;
      encoding: { container: string };
    }) => {
      const run = { frames: o.frames, fps: o.fps, bitrate: o.bitrate, sound: o.sound, painted: 0 };
      encode.runs.push(run);
      for (let i = 0; i < o.frames; i++) {
        await o.paint(i);
        run.painted++;
        o.onFrame?.(i + 1);
      }
      return new Blob(["VIDEO"], { type: o.encoding.container === "mp4" ? "video/mp4" : "video/webm" });
    },
  ),
}));

vi.mock("./clipSound", () => ({
  SOUND_RATE: 48_000,
  mixClipSound: vi.fn(async (pages: unknown[], _timeline: unknown, total: number) => {
    encode.mixed.push({ pages: pages.length, total });
    return { sound: "mixed" };
  }),
}));

const { exportAnimated } = await import("./animatedExport");

const video = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  format: "webm",
  pages: [0],
  scale: 1,
  quality: 0.92,
  transparent: false,
  pdfMode: "standard",
  embedFonts: false,
  resolution: 480,
  fps: VIDEO_FPS,
  ...over,
});
const run = (design: Design, options: ExportOptions, onProgress?: (done: number, total: number) => void) =>
  exportAnimated(design, resolveExportOptions(design, options), onProgress, undefined);

const clip = (muted = false) => createVideo({ src: "asset:clip", duration: 2, naturalWidth: 64, naturalHeight: 36, width: 40, height: 20, muted });
const designWith = (elements: DesignElement[] = [createShape("rect", { x: 5, y: 5, width: 20, height: 20 })], title = "Clip: one") =>
  createDesign({ title, width: 100, height: 100, pages: [createPage({ duration: 1, background: solid("#ffffff"), elements })] });

beforeEach(() => {
  encode.encoding = { container: "mp4", video: "avc", audio: "aac" };
  encode.chosen = [];
  encode.runs = [];
  encode.mixed = [];
  vi.stubGlobal("VideoEncoder", function VideoEncoder() {});
  vi.stubGlobal("VideoFrame", function VideoFrame() {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a video made frame by frame", () => {
  it("is an MP4 of every frame, with the clips' sound mixed in", async () => {
    const progress: Array<[number, number]> = [];
    const file = await run(designWith([clip()]), video(), (done, total) => progress.push([done, total]));
    expect(file.name).toBe("Clip one.mp4");
    expect(file.blob.type).toBe("video/mp4");
    expect(file.note).toBeUndefined();
    expect(encode.chosen).toEqual([[480, 480, videoBitrate(480, 480), 48_000, true]]);
    expect(encode.mixed).toEqual([{ pages: 1, total: 1 }]);
    expect(encode.runs).toEqual([{ frames: VIDEO_FPS, fps: VIDEO_FPS, bitrate: videoBitrate(480, 480), sound: { sound: "mixed" }, painted: VIDEO_FPS }]);
    // progress counts frames, from nothing to all of them
    expect(progress[0]).toEqual([0, VIDEO_FPS]);
    expect(progress.at(-1)).toEqual([VIDEO_FPS, VIDEO_FPS]);
  });

  it("has no sound track, and mixes nothing, when no clip makes a sound", async () => {
    await run(designWith([clip(true)]), video());
    expect(encode.chosen[0][4]).toBe(false);
    expect(encode.mixed).toEqual([]);
    expect(encode.runs[0].sound).toBeNull();
  });

  it("is a WebM when that is what the browser encodes", async () => {
    encode.encoding = { container: "webm", video: "vp9", audio: "opus" };
    const file = await run(designWith([clip()]), video());
    expect(file.name).toBe("Clip one.webm");
    expect(file.blob.type).toBe("video/webm");
  });

  it("says the video is silent when a clip makes a sound but the browser can encode none", async () => {
    encode.encoding = { container: "mp4", video: "avc", audio: null };
    const file = await run(designWith([clip()]), video());
    expect(file.note).toBe("This browser cannot add sound to a video, so the video is silent. Chrome, Edge and Safari can.");
    expect(encode.mixed).toEqual([]);
  });

  it("is recorded as it plays instead when no encoder takes the picture", async () => {
    encode.encoding = null;
    // no recorder either: the reason a recording would give
    vi.stubGlobal("MediaRecorder", undefined);
    await expect(run(designWith(), video())).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining("cannot record video") });
    expect(encode.runs).toEqual([]);
  });
});

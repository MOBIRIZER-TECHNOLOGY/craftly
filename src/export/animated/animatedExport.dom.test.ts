import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import { PlaybackRenderer } from "@/render/playback";
import { ExportError, isCancelled } from "../errors";
import type { ExportOptions } from "../exporters";
import { resolveExportOptions } from "../options";
import { exportAnimated } from "./animatedExport";
import { VIDEO_FPS, videoBitrate } from "./frames";

// What a painting pass "sees" of loading pictures is scripted: the real counter only moves when a picture finishes loading.
const epochs = vi.hoisted(() => ({ moving: false, n: 0 }));
vi.mock("@/render/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/render/images")>();
  return { ...actual, imagesEpoch: vi.fn(() => (epochs.moving ? ++epochs.n : actual.imagesEpoch())) };
});

const pages = (count: number, duration: number) =>
  Array.from({ length: count }, (_v, i) =>
    createPage({ duration, background: solid(i % 2 ? "#eeeeee" : "#ffffff"), elements: [createShape("rect", { x: 5, y: 5, width: 20, height: 20 })] }),
  );
const designOf = (count = 2, duration = 1, title = "Loop: one"): Design => createDesign({ title, width: 100, height: 100, pages: pages(count, duration) });
const gif = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  format: "gif",
  pages: [0, 1],
  scale: 1,
  quality: 0.92,
  transparent: false,
  pdfMode: "standard",
  embedFonts: false,
  resolution: 480,
  fps: 2,
  ...over,
});
const webm = (over: Partial<ExportOptions> = {}): ExportOptions => gif({ format: "webm", ...over });
const run = (design: Design, options: ExportOptions, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) =>
  exportAnimated(design, resolveExportOptions(design, options), onProgress, signal);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** The canvas the exporter paints on, found through the contexts the browser is asked for. */
function watchCanvases() {
  const real = HTMLCanvasElement.prototype.getContext;
  const asked: Array<{ canvas: HTMLCanvasElement; options: unknown }> = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string, options?: unknown) {
    asked.push({ canvas: this, options });
    return real.call(this, type) as never;
  } as never);
  return asked;
}

/** The canvas the GIF exporter paints on: the one it asked to be quick to read back. */
const readbackCanvas = (asked: ReturnType<typeof watchCanvases>) =>
  asked.find((a) => (a.options as { willReadFrequently?: boolean } | undefined)?.willReadFrequently === true)?.canvas;

beforeEach(() => {
  epochs.moving = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */

describe("exporting a GIF", () => {
  it("writes a GIF the size of the animation, named after the design", async () => {
    const file = await run(designOf(), gif());
    expect(file.name).toBe("Loop one.gif");
    expect(file.blob.type).toBe("image/gif");
    const bytes = await bytesOf(file.blob);
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    // 480 x 480: the shorter side of the animation is the resolution that was asked for
    expect([bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8)]).toEqual([480, 480]);
    expect(bytes.at(-1)).toBe(0x3b);
  });

  it("reports the frames as they are done, from none to all", async () => {
    const progress: Array<[number, number]> = [];
    await run(designOf(), gif({ fps: 2 }), (done, total) => progress.push([done, total]));
    // two pages of a second at two frames a second
    expect(progress).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it("works without anyone listening to the progress", async () => {
    await expect(run(designOf(1), gif({ pages: [0], fps: 1 }))).resolves.toMatchObject({ name: "Loop one.gif" });
  });

  it("asks for a canvas that is quick to read back, and gives it up when it is done", async () => {
    const asked = watchCanvases();
    await run(designOf(1), gif({ pages: [0], fps: 1 }));
    const frame = readbackCanvas(asked);
    expect(frame).toBeDefined();
    expect([frame!.width, frame!.height]).toEqual([0, 0]);
  });

  it("paints a frame a second time when a picture finished loading while it was painted, but not more than three times", async () => {
    const renderAt = vi.spyOn(PlaybackRenderer.prototype, "renderAt").mockReturnValue(false);
    // one frame for the palette and one for the file: two paints
    epochs.moving = true;
    await run(designOf(1), gif({ pages: [0], fps: 1 }));
    expect(renderAt).toHaveBeenCalledTimes(6);
    renderAt.mockClear();
    epochs.moving = false;
    await run(designOf(1), gif({ pages: [0], fps: 1 }));
    expect(renderAt).toHaveBeenCalledTimes(2);
    renderAt.mockClear().mockReturnValue(true);
    epochs.moving = true;
    await run(designOf(1), gif({ pages: [0], fps: 1 }));
    expect(renderAt).toHaveBeenCalledTimes(2);
  });

  it("samples a big picture sparsely when it chooses the colours", async () => {
    // 1920 x 1080 is more pixels than are worth counting one by one
    const wide = createDesign({ title: "Wide", width: 160, height: 90, pages: pages(1, 1) });
    const file = await run(wide, gif({ pages: [0], fps: 1, resolution: 1080 }));
    const bytes = await bytesOf(file.blob);
    expect([bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8)]).toEqual([1920, 1080]);
  });

  describe("when it is stopped", () => {
    it("stops between frames and gives the canvas up", async () => {
      const asked = watchCanvases();
      const controller = new AbortController();
      const error = await run(designOf(), gif(), (done) => done === 2 && controller.abort(), controller.signal).catch((e) => e);
      expect(isCancelled(error)).toBe(true);
      expect(readbackCanvas(asked)?.width).toBe(0);
    });

    it("stops before it starts when the signal is already aborted", async () => {
      const asked = watchCanvases();
      const renderAt = vi.spyOn(PlaybackRenderer.prototype, "renderAt");
      const controller = new AbortController();
      controller.abort();
      await expect(run(designOf(), gif(), undefined, controller.signal)).rejects.toSatisfy(isCancelled);
      // nothing was painted, and the canvas that was made for it is already given up
      expect(renderAt).not.toHaveBeenCalled();
      expect(readbackCanvas(asked)?.width ?? 0).toBe(0);
    });
  });

  describe("when it is not possible", () => {
    it("says an animation is too long for a GIF before doing any work", async () => {
      const progress = vi.fn();
      const long = designOf(3, 60);
      const error = await run(long, gif({ pages: [0, 1, 2], fps: 30 }), progress).catch((e) => e);
      expect(error).toBeInstanceOf(ExportError);
      expect(error.code).toBe("too-large");
      expect(error.message).toBe("This animation is too long to save as a GIF. Choose fewer pages or a lower frame rate.");
      expect(progress).not.toHaveBeenCalled();
    });

    it("refuses an export that is not an animation", async () => {
      const design = designOf();
      const resolved = resolveExportOptions(design, gif({ format: "png" }));
      await expect(exportAnimated(design, resolved, undefined, undefined)).rejects.toThrow("exportAnimated needs a gif or webm export.");
    });

    it("says so when the browser will not make a canvas of the size", async () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      await expect(run(designOf(1), gif({ pages: [0], fps: 1 }))).rejects.toMatchObject({
        code: "too-large",
        message: "This animation is too large for your browser to draw. Try a lower resolution.",
      });
    });
  });
});

/* ------------------------------------------------------------------ */

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported: string[] = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  static isTypeSupported = (type: string) => FakeRecorder.supported.includes(type);
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  requestData = vi.fn(() => this.ondataavailable?.({ data: new Blob(["WEBMDATA"], { type: "video/webm" }) }));
  stop = vi.fn(() => {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  });

  constructor(
    public readonly stream: unknown,
    public readonly options: { mimeType: string; videoBitsPerSecond: number },
  ) {
    FakeRecorder.instances.push(this);
  }
}

/** A browser that can record: MediaRecorder, canvas capture, and animation frames on timers `step` ms of display time apart. */
function installRecordingBrowser(step = 100, gaps: Record<number, number> = {}) {
  FakeRecorder.instances = [];
  FakeRecorder.supported = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const captured = vi.fn(() => ({ getTracks: () => [{ stop: vi.fn() }] }));
  Object.defineProperty(proto, "captureStream", { configurable: true, writable: true, value: captured });
  let now = 0;
  let n = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => setTimeout(() => callback((now += gaps[++n] ?? step)), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
  return { captured, uninstall: () => delete proto.captureStream };
}

describe("exporting a WebM video", () => {
  let browser: ReturnType<typeof installRecordingBrowser>;
  afterEach(() => browser?.uninstall());

  it("says so, before doing anything, when the browser cannot record video", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const progress = vi.fn();
    await expect(run(designOf(), webm(), progress)).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining("cannot record video") });
    expect(progress).not.toHaveBeenCalled();
  });

  it("says so when it can record, but neither WebM nor MP4", async () => {
    browser = installRecordingBrowser();
    FakeRecorder.supported = [];
    await expect(run(designOf(), webm())).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining("cannot record video as WebM or MP4") });
  });

  it("records an MP4, named so and with no WebM header written into it, in a browser that records no WebM (Safari)", async () => {
    browser = installRecordingBrowser();
    FakeRecorder.supported = ["video/mp4"];
    const file = await run(designOf(1, 1), webm({ pages: [0] }));
    expect(FakeRecorder.instances[0].options.mimeType).toBe("video/mp4");
    expect(file.name).toBe("Loop one.mp4");
    expect(file.blob.type).toBe("video/mp4");
  });

  it("records the animation in real time and returns the video", async () => {
    browser = installRecordingBrowser();
    const progress: Array<[number, number]> = [];
    const design = designOf(1, 1);
    const file = await run(design, webm({ pages: [0] }), (done, total) => progress.push([done, total]));
    expect(file.name).toBe("Loop one.webm");
    expect(file.blob.type).toBe("video/webm");
    expect(file.note).toBeUndefined();

    // 30 frames a second for a second; progress runs from nothing to everything, never backwards
    expect(progress[0]).toEqual([0, VIDEO_FPS]);
    expect(progress.at(-1)).toEqual([VIDEO_FPS, VIDEO_FPS]);
    const done = progress.map((p) => p[0]);
    expect([...done].sort((a, b) => a - b)).toEqual(done);
    expect(Math.max(...done)).toBeLessThanOrEqual(VIDEO_FPS);

    // the best codec the browser has, at a bitrate that suits the picture
    const [recorder] = FakeRecorder.instances;
    expect(recorder.options).toEqual({ mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: videoBitrate(480, 480) });
    expect(browser.captured).toHaveBeenCalledWith(VIDEO_FPS);
  });

  it("uses the plain WebM type when that is all the browser offers", async () => {
    browser = installRecordingBrowser();
    FakeRecorder.supported = ["video/webm"];
    await run(designOf(1, 1), webm({ pages: [0] }));
    expect(FakeRecorder.instances[0].options.mimeType).toBe("video/webm");
  });

  it("does not ask for a canvas made for reading, and gives the canvas up", async () => {
    browser = installRecordingBrowser();
    const asked = watchCanvases();
    await run(designOf(1, 1), webm({ pages: [0] }));
    expect(asked.some((a) => (a.options as { willReadFrequently?: boolean } | undefined)?.willReadFrequently === true)).toBe(false);
    expect(asked[0].canvas.width).toBe(0);
  });

  it("warns that part of the video may stand still when the tab was in the background", async () => {
    browser = installRecordingBrowser(100, { 4: 5000 });
    const file = await run(designOf(1, 1), webm({ pages: [0] }));
    expect(file.note).toBe("The tab was in the background while the video recorded, so part of it may stand still. Keep the tab visible while a video records.");
  });

  it("says a video is too long to record in real time before it starts", async () => {
    browser = installRecordingBrowser();
    const long = designOf(11, 60);
    const progress = vi.fn();
    await expect(run(long, webm({ pages: Array.from({ length: 11 }, (_v, i) => i) }), progress)).rejects.toMatchObject({
      code: "too-large",
      message: expect.stringContaining("at most 10 minutes"),
    });
    expect(progress).not.toHaveBeenCalled();
  });

  it("can be cancelled while it records", async () => {
    browser = installRecordingBrowser();
    const controller = new AbortController();
    const error = await run(designOf(1, 1), webm({ pages: [0] }), (done) => done >= 2 && controller.abort(), controller.signal).catch((e) => e);
    expect(isCancelled(error)).toBe(true);
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalled();
  });
});

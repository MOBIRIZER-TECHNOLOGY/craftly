import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportError, isCancelled } from "../errors";
import { VIDEO_FPS } from "./frames";
import { recordCanvas, type RecordOptions } from "./video";

/* ------------------------------------------------------------------ */
/* A browser that records: a canvas that can be captured, a recorder, and animation frames on a clock we control.   */
/* ------------------------------------------------------------------ */

interface Track {
  stop: ReturnType<typeof vi.fn>;
}

const events: string[] = [];
let tracks: Track[];
let recorders: FakeRecorder[];

/** What the fake recorder does; changed per test. */
const behaviour = {
  constructError: null as Error | null,
  /** bytes the recorder delivers when asked for data */
  data: "WEBMDATA" as string,
  /** the recorder says it has stopped when it is stopped */
  reportsStop: true,
  stopThrows: false,
  /** chunks with nothing in them are delivered before the data */
  emptyChunks: false,
};

class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  start = vi.fn((_timeslice?: number) => {
    events.push("start");
    this.state = "recording";
  });
  requestData = vi.fn(() => {
    if (behaviour.emptyChunks) {
      this.ondataavailable?.({ data: new Blob([]) });
      this.ondataavailable?.({ data: null as unknown as Blob });
    }
    if (behaviour.data) this.ondataavailable?.({ data: new Blob([behaviour.data], { type: "video/webm" }) });
  });
  stop = vi.fn(() => {
    if (behaviour.stopThrows) throw new Error("InvalidStateError");
    this.state = "inactive";
    if (behaviour.reportsStop) queueMicrotask(() => this.onstop?.());
  });

  constructor(
    public readonly stream: unknown,
    public readonly options: { mimeType: string; videoBitsPerSecond: number },
  ) {
    if (behaviour.constructError) throw behaviour.constructError;
    recorders.push(this);
  }
}

/** Animation frames that arrive on timers, `step` milliseconds of display time apart, with optional longer gaps. */
function installFrames(options: { step?: number; gaps?: Record<number, number>; onFrame?: (n: number) => void } = {}) {
  let now = 0;
  let n = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    return setTimeout(() => {
      n++;
      now += options.gaps?.[n] ?? options.step ?? 100;
      options.onFrame?.(n);
      callback(now);
    }, 0) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
}

function setup(over: Partial<RecordOptions> = {}) {
  const stream = { getTracks: () => tracks };
  const canvas = {
    captureStream: vi.fn((_fps?: number) => {
      events.push("capture");
      return stream;
    }),
  } as unknown as HTMLCanvasElement;
  const painted: number[] = [];
  const progress: number[] = [];
  const options: RecordOptions = {
    canvas,
    paint: (seconds) => {
      events.push(`paint:${seconds}`);
      painted.push(seconds);
    },
    seconds: 1,
    fps: 10,
    mimeType: "video/webm;codecs=vp9",
    bitsPerSecond: 2_000_000,
    onProgress: (seconds) => progress.push(seconds),
    ...over,
  };
  return { options, canvas: canvas as unknown as { captureStream: ReturnType<typeof vi.fn> }, painted, progress };
}

beforeEach(() => {
  events.length = 0;
  recorders = [];
  tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  behaviour.constructError = null;
  behaviour.data = "WEBMDATA";
  behaviour.reportsStop = true;
  behaviour.stopThrows = false;
  behaviour.emptyChunks = false;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  installFrames();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe("recordCanvas", () => {
  it("paints the first picture, then records while the animation plays to its end", async () => {
    const { options, canvas, painted, progress } = setup();
    const result = await recordCanvas(options);

    // the first picture is on the canvas before the stream is captured, so the video does not start blank
    expect(events.slice(0, 3)).toEqual(["paint:0", "capture", "start"]);
    expect(canvas.captureStream).toHaveBeenCalledWith(10);
    const [recorder] = recorders;
    expect(recorder.options).toEqual({ mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 2_000_000 });
    expect(recorder.start).toHaveBeenCalledWith(1000);

    // the animation is shown from its first second to its last, in order, nothing past the end
    expect(painted[0]).toBe(0);
    expect(painted.at(-1)).toBe(1);
    expect([...painted].sort((a, b) => a - b)).toEqual(painted);
    expect(Math.max(...painted)).toBe(1);
    // progress follows the frames that were painted after the first picture
    expect(progress).toEqual(painted.slice(1));

    expect(result.stalled).toBe(false);
    expect(result.blob.type).toBe("video/webm");
    expect(await result.blob.text()).toBe("WEBMDATA");
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    // the last chunk is asked for before the recorder is stopped
    expect(recorder.requestData.mock.invocationCallOrder[0]).toBeLessThan(recorder.stop.mock.invocationCallOrder[0]);
  });

  it("keeps only the chunks that have something in them", async () => {
    behaviour.emptyChunks = true;
    const { options } = setup();
    const result = await recordCanvas(options);
    expect(await result.blob.text()).toBe("WEBMDATA");
  });

  it("records at the frame rate of the video unless told another", async () => {
    const { options, canvas } = setup({ fps: undefined });
    await recordCanvas(options);
    expect(canvas.captureStream).toHaveBeenCalledWith(VIDEO_FPS);
  });

  it("says when the page stood still because the tab was in the background", async () => {
    installFrames({ gaps: { 3: 5000 } });
    const { options } = setup();
    expect((await recordCanvas(options)).stalled).toBe(true);
  });

  it("does not need a progress callback", async () => {
    const { options } = setup({ onProgress: undefined });
    await expect(recordCanvas(options)).resolves.toMatchObject({ stalled: false });
  });

  it("stops listening for the signal once it is done", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { options } = setup({ signal: controller.signal });
    await recordCanvas(options);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  describe("when it is cancelled", () => {
    it("does nothing at all if the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const { options, canvas, painted } = setup({ signal: controller.signal });
      await expect(recordCanvas(options)).rejects.toSatisfy(isCancelled);
      expect(painted).toEqual([]);
      expect(canvas.captureStream).not.toHaveBeenCalled();
      expect(recorders).toHaveLength(0);
    });

    it("stops recording, lets the recorder go and says it was cancelled", async () => {
      const controller = new AbortController();
      installFrames({ onFrame: (n) => n === 3 && controller.abort() });
      const { options, painted } = setup({ signal: controller.signal });
      await expect(recordCanvas(options)).rejects.toSatisfy(isCancelled);
      const [recorder] = recorders;
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      // there is no point in collecting what was recorded
      expect(recorder.requestData).not.toHaveBeenCalled();
      expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
      expect(Math.max(...painted)).toBeLessThan(1);
    });
  });

  describe("when the browser cannot record", () => {
    it("stops the capture and explains, keeping the reason, when the recorder cannot be made", async () => {
      const cause = new Error("no such codec");
      behaviour.constructError = cause;
      const { options, painted } = setup();
      const error = await recordCanvas(options).catch((e) => e);
      expect(error).toBeInstanceOf(ExportError);
      expect(error.code).toBe("unsupported");
      expect(error.message).toContain("Download an animated GIF instead");
      expect(error.cause).toBe(cause);
      expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
      // only the first picture was painted
      expect(painted).toEqual([0]);
    });

    it("stops the recorder and the capture, and passes the error on, when frames cannot be asked for", async () => {
      const failure = new Error("no animation frames");
      vi.stubGlobal("requestAnimationFrame", () => {
        throw failure;
      });
      const { options } = setup();
      await expect(recordCanvas(options)).rejects.toBe(failure);
      expect(recorders[0].stop).toHaveBeenCalledTimes(1);
      expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    });

    it("leaves a recorder alone that had already stopped by itself", async () => {
      const failure = new Error("no animation frames");
      vi.stubGlobal("requestAnimationFrame", () => {
        recorders[0].state = "inactive";
        throw failure;
      });
      const { options } = setup();
      await expect(recordCanvas(options)).rejects.toBe(failure);
      expect(recorders[0].stop).not.toHaveBeenCalled();
      expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    });

    it("passes the original error on even if the recorder cannot be stopped either", async () => {
      const failure = new Error("no animation frames");
      behaviour.stopThrows = true;
      vi.stubGlobal("requestAnimationFrame", () => {
        throw failure;
      });
      const { options } = setup();
      await expect(recordCanvas(options)).rejects.toBe(failure);
    });

    it("reports a recorder that fails while it records", async () => {
      const event = { type: "error" };
      installFrames({ onFrame: (n) => n === 2 && recorders[0].onerror?.(event) });
      const { options } = setup();
      const error = await recordCanvas(options).catch((e) => e);
      expect(error).toBeInstanceOf(ExportError);
      expect(error.code).toBe("encode-failed");
      expect(error.message).toBe("The video could not be recorded. Please try again.");
      expect(error.cause).toBe(event);
      expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    });

    it("reports a recording with nothing in it", async () => {
      behaviour.data = "";
      const { options } = setup();
      await expect(recordCanvas(options)).rejects.toMatchObject({ code: "encode-failed", message: "The video could not be recorded. Please try again." });
    });
  });

  it("fails, instead of waiting for ever, when a frame cannot be painted, and lets the recorder go", async () => {
    const failure = new Error("the canvas was lost");
    const { options } = setup({
      paint: (seconds) => {
        if (seconds > 0.3) throw failure;
      },
    });
    await expect(recordCanvas(options)).rejects.toBe(failure);
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  }, 3000);

  it("takes what was recorded when the recorder stops by itself", async () => {
    installFrames({
      onFrame: (n) => {
        if (n !== 2) return;
        const recorder = recorders[0];
        recorder.state = "inactive";
        recorder.ondataavailable?.({ data: new Blob(["EARLY"], { type: "video/webm" }) });
        recorder.onstop?.();
      },
    });
    const { options } = setup();
    const result = await recordCanvas(options);
    expect(await result.blob.text()).toBe("EARLY");
    // it had already stopped: it is not stopped again, nor asked for more
    expect(recorders[0].stop).not.toHaveBeenCalled();
    expect(recorders[0].requestData).not.toHaveBeenCalled();
  });

  describe("a recorder that is slow to say it has stopped", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    it("is waited for, but not longer than eight seconds", async () => {
      behaviour.reportsStop = false;
      const { options } = setup();
      let settled = false;
      const done = recordCanvas(options).then((result) => {
        settled = true;
        return result;
      });
      // the animation itself: about a second and a quarter of frames
      await vi.advanceTimersByTimeAsync(7000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(settled).toBe(true);
      expect(await (await done).blob.text()).toBe("WEBMDATA");
    });

    it("carries on when the recorder was already stopped and refuses to be stopped again", async () => {
      behaviour.stopThrows = true;
      behaviour.reportsStop = false;
      const { options } = setup();
      const done = recordCanvas(options);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await (await done).blob.text()).toBe("WEBMDATA");
    });
  });
});

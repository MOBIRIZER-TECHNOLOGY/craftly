/**
 * WebM video: the playback is drawn onto a canvas in real time and recorded with `canvas.captureStream()` and
 * `MediaRecorder`, so the encoder is the browser's own (VP9 or VP8) and no library is needed.
 *
 * Real time is the catch. A recording lasts exactly as long as the animation, and it is driven by
 * `requestAnimationFrame`, which browsers pause or throttle hard in a background tab: switch away while a video is
 * being recorded and nothing is painted until the tab is shown again. The clock below therefore keeps the *wall
 * clock* as the frame time (so a slow computer drops frames instead of slowing the animation down) but holds still
 * across a long gap, so the animation continues where it stopped instead of skipping ahead; the result says it
 * happened (`stalled`) and the panel tells the person to keep the tab visible while a video records.
 */
import { m } from "@/i18n";
import { ExportError, cancelledError, throwIfAborted } from "../errors";
import { VIDEO_FPS } from "./frames";
import { withWebmDuration } from "./webm";

/* ------------------------------------------------------------------ */
/* is it possible here?                                                */
/* ------------------------------------------------------------------ */

/** The browser APIs the recorder needs, injectable so the detection is unit tested in node. */
export interface RecorderEnv {
  MediaRecorder?: { isTypeSupported?: (type: string) => boolean };
  HTMLCanvasElement?: { prototype?: { captureStream?: unknown } };
}

export interface VideoSupport {
  ok: boolean;
  /** the first container / codec combination the browser can record */
  mimeType: string | null;
  /** a sentence for the person when it is not possible, null when it is */
  reason: string | null;
}

/**
 * In order of preference: VP9 is the smallest, VP8 the most widely recordable, plain `video/webm` lets the browser choose. A
 * browser that records no WebM (Safari records MP4 with H.264) gets an MP4 instead.
 */
export const VIDEO_MIME_TYPES: readonly string[] = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"];

/** The container a recorder type writes: "mp4" or "webm". */
export const videoContainer = (mimeType: string | null): "mp4" | "webm" => (mimeType?.startsWith("video/mp4") ? "mp4" : "webm");

const NO_RECORDER = m.exporting.animation.noRecorder;

export function detectVideoSupport(env: RecorderEnv = globalThis as unknown as RecorderEnv): VideoSupport {
  const recorder = env.MediaRecorder;
  if (!recorder || typeof recorder.isTypeSupported !== "function") return { ok: false, mimeType: null, reason: NO_RECORDER };
  if (typeof env.HTMLCanvasElement?.prototype?.captureStream !== "function") return { ok: false, mimeType: null, reason: NO_RECORDER };
  for (const type of VIDEO_MIME_TYPES) {
    try {
      if (recorder.isTypeSupported(type)) return { ok: true, mimeType: type, reason: null };
    } catch {
      /* try the next one */
    }
  }
  return { ok: false, mimeType: null, reason: m.exporting.animation.noWebm };
}

/* ------------------------------------------------------------------ */
/* the clock                                                           */
/* ------------------------------------------------------------------ */

/** A gap this long between two animation frames means the tab was hidden or the thread was blocked. */
const STALL_MS = 1500;
/** After the last moment of the animation, keep painting it this long so the final picture has a duration. */
const HOLD_SECONDS = 0.15;
/** Paint a frame this much early rather than skip it when the display's frame times do not divide `1 / fps` evenly. */
const SLACK_SECONDS = 0.004;

export interface ClockTick {
  /** the second of the animation to paint */
  time: number;
  /** a frame is due */
  paint: boolean;
  /** the recording may stop */
  done: boolean;
}

/**
 * Turns the timestamps of `requestAnimationFrame` into animation time. Time is wall-clock time since the first
 * tick, clamped to the animation's length; a frame is painted about every `1 / fps` seconds; after the end the
 * last picture is held for a moment before the recording stops.
 */
export class RecordingClock {
  /** a long gap was held out: the tab was in the background (or the page froze) while recording */
  stalled = false;
  private start = -1;
  private first = -1;
  private last = 0;
  private lastPainted = -Infinity;

  constructor(
    private readonly total: number,
    private readonly fps: number,
    private readonly hold: number = HOLD_SECONDS,
  ) {}

  tick(now: number): ClockTick {
    if (this.start < 0) {
      this.start = now;
      this.first = now;
      this.last = now;
    }
    const gap = now - this.last;
    if (gap > STALL_MS) {
      // nothing could be painted for a while: carry on from where the animation stopped, not from where the clock is
      this.start += gap - 1000 / 60;
      this.stalled = true;
    }
    this.last = now;
    const elapsed = (now - this.start) / 1000;
    const done = elapsed >= this.total + this.hold;
    const paint = !done && elapsed - this.lastPainted >= 1 / this.fps - SLACK_SECONDS;
    if (paint) this.lastPainted = elapsed;
    return { time: Math.min(Math.max(0, elapsed), this.total), paint, done };
  }

  /** Wall-clock seconds from the first tick to the last one: how long the recording really is. */
  get recordedSeconds(): number {
    return this.first < 0 ? 0 : (this.last - this.first) / 1000;
  }
}

/* ------------------------------------------------------------------ */
/* recording                                                           */
/* ------------------------------------------------------------------ */

export interface RecordOptions {
  canvas: HTMLCanvasElement;
  /** draws the animation `seconds` into the playback onto `canvas` */
  paint: (seconds: number) => void;
  /** length of the animation */
  seconds: number;
  fps?: number;
  mimeType: string;
  bitsPerSecond: number;
  /** called with how far the animation has got, in seconds */
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
}

export interface RecordResult {
  blob: Blob;
  /** the tab was in the background (or the page froze) for a while, so part of the video may stand still */
  stalled: boolean;
}

const SAVE_FAILED = m.exporting.animation.recordFailed;

/** Resolves after `ms`, or as soon as `until` settles. */
function waitFor(until: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void until.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Records `canvas` while `paint` animates it for `seconds` and returns the WebM (with its duration filled in) or the MP4. */
export async function recordCanvas(options: RecordOptions): Promise<RecordResult> {
  const { canvas, paint, seconds, signal } = options;
  const fps = options.fps ?? VIDEO_FPS;
  throwIfAborted(signal);

  paint(0); // the recording starts with the first picture, not a blank canvas
  const stream = canvas.captureStream(fps);
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: options.mimeType, videoBitsPerSecond: options.bitsPerSecond });
  } catch (cause) {
    stopTracks();
    throw new ExportError("unsupported", m.exporting.animation.cannotStart, { cause });
  }

  // an object, not loose variables: the recorder's callbacks change these while this function awaits
  const state = { cancelled: false, ended: false, failure: null as ExportError | null };
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      state.ended = true;
      resolve();
    };
    recorder.onerror = (event) => {
      state.failure = new ExportError("encode-failed", SAVE_FAILED, { cause: event });
      state.ended = true;
      resolve();
    };
  });
  const onAbort = () => {
    state.cancelled = true;
  };
  signal?.addEventListener("abort", onAbort);
  const clock = new RecordingClock(seconds, fps);
  let frame = 0;

  try {
    // a chunk per second keeps the data moving to the browser's own storage while it records
    recorder.start(1000);
    // Do not wait for the recorder's "start" event: Chrome only fires it once the first frame has arrived, and a canvas
    // that nothing paints produces none - the clock below is what starts the frames.
    await new Promise<void>((resolve, reject) => {
      const step = (now: number) => {
        try {
          if (state.cancelled || state.ended) return resolve();
          const tick = clock.tick(now);
          if (tick.paint) {
            paint(tick.time);
            options.onProgress?.(tick.time);
          }
          if (tick.done) return resolve();
          frame = requestAnimationFrame(step);
        } catch (error) {
          // a frame that cannot be painted ends the recording; thrown here it would only be reported to the page, and the wait would never end
          reject(error);
        }
      };
      frame = requestAnimationFrame(step);
    });
  } catch (error) {
    stopTracks();
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    throw error;
  } finally {
    cancelAnimationFrame(frame);
    signal?.removeEventListener("abort", onAbort);
  }

  // finish the recording (also when cancelled, so the browser releases the encoder)
  if (recorder.state !== "inactive") {
    try {
      if (!state.cancelled && !state.ended) recorder.requestData();
      recorder.stop();
    } catch {
      /* already stopped */
    }
  }
  await waitFor(stopped, 8000);
  stopTracks();

  if (state.cancelled) throw cancelledError();
  if (state.failure) throw state.failure;
  const container = videoContainer(options.mimeType);
  const raw = new Blob(chunks, { type: `video/${container}` });
  if (raw.size === 0) throw new ExportError("encode-failed", SAVE_FAILED);
  // a WebM recorder cannot write the length of a file it is still producing; the clock knows it (an MP4 has it at its end)
  const blob = container === "webm" ? await withWebmDuration(raw, Math.max(seconds, clock.recordedSeconds)) : raw;
  return { blob, stalled: clock.stalled };
}

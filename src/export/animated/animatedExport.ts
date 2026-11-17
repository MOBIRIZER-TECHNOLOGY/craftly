/**
 * Runs an animated export. The chosen pages become one `PlaybackRenderer` (the same painter the editor's preview
 * and the presenter use), every resource they need is loaded first, and then:
 *
 *   GIF   frame `i` is painted at `i / fps`, quantised and handed to the `GifEncoder` straight away, as fast as the
 *         computer can go. The thread is given back to the browser after every frame, so progress is shown and
 *         Cancel works; only the latest frame and the bytes produced so far are ever in memory.
 *   WebM  the playback is painted onto a canvas in real time while `MediaRecorder` records it (see video.ts); a browser
 *         that records no WebM (Safari) records an MP4 the same way.
 *
 * Pictures are flattened onto white: neither format has an alpha channel worth using, and a page with a
 * see-through background would otherwise come out black in the video.
 */
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import { fontsEpoch } from "@/render/fonts";
import { imagesEpoch } from "@/render/images";
import { PlaybackRenderer } from "@/render/playback";
import { ExportError, throwIfAborted } from "../errors";
import type { ExportFile, ExportProgress } from "../exporters";
import { exportFileName, type ResolvedExport } from "../options";
import { loadPageResources } from "../resources";
import { nextMacrotask } from "../yield";
import { VIDEO_FPS, animationProblem, frameDelays, frameTime, paletteSampleFrames, planFrames, videoBitrate, type AnimationPlan, type FramePlan } from "./frames";
import { GifEncoder } from "./gif";
import { ColorHistogram, buildPalette } from "./palette";
import { detectVideoSupport, recordCanvas, videoContainer } from "./video";

/** Pictures with more pixels than this are counted every other pixel when choosing the palette. */
const PALETTE_FULL_PIXELS = 1_200_000;
/** A GIF this large is not going to be shared or opened: stop before the tab runs out of memory. */
const GIF_MAX_BYTES = 400 * 1024 * 1024;

const TOO_BIG_TO_DRAW = m.exporting.animation.tooBigToDraw;
const STALLED_NOTE = m.exporting.animation.stalled;

/* ------------------------------------------------------------------ */
/* painting frames                                                     */
/* ------------------------------------------------------------------ */

/** One canvas and one `PlaybackRenderer` over the chosen pages. */
class FrameSource {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: PlaybackRenderer;
  private readonly width: number;
  private readonly height: number;

  /** `readback` is for the GIF, which reads the pixels of every frame: it asks for a canvas that is cheap to read. */
  constructor(
    design: Design,
    private readonly plan: AnimationPlan,
    readback: boolean,
  ) {
    this.width = plan.width;
    this.height = plan.height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = plan.width;
    this.canvas.height = plan.height;
    const ctx = this.canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined);
    if (!ctx || this.canvas.width !== plan.width || this.canvas.height !== plan.height) throw new ExportError("too-large", TOO_BIG_TO_DRAW);
    this.ctx = ctx;
    // the timeline indexes the chosen pages, so the renderer gets exactly those, in playing order
    this.renderer = new PlaybackRenderer({ width: design.width, height: design.height, pages: plan.pages.map((i) => design.pages[i]) });
  }

  /** Paints the moment `t` seconds into the playback; false when an image or font was not ready. */
  private paint(t: number): boolean {
    const ready = this.renderer.renderAt(this.ctx, this.plan.timeline, t);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "destination-over";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.restore();
    return ready;
  }

  /**
   * `paint`, repeated when something finished loading while it ran (a photo generated on first use, say). A
   * resource that never arrives (a broken image) does not change the epochs, so it cannot make this loop.
   */
  paintSettled(t: number): void {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = fontsEpoch() * 1_000_003 + imagesEpoch();
      if (this.paint(t) || fontsEpoch() * 1_000_003 + imagesEpoch() === before) return;
    }
  }

  read(): ImageData {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  /** Frees the pixel memory at once (a 1080p canvas is 8 MB, and the transitions keep two more). */
  dispose(): void {
    this.renderer.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/** Waits for the pictures, graphics and fonts of every chosen page, one page at a time. */
async function loadPlanResources(design: Design, plan: AnimationPlan, signal: AbortSignal | undefined): Promise<void> {
  for (const index of plan.pages) await loadPageResources(design.pages[index], signal);
}

/* ------------------------------------------------------------------ */
/* GIF                                                                 */
/* ------------------------------------------------------------------ */

const sameWords = (a: Uint32Array, b: Uint32Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Collects encoder output as a Blob without keeping thousands of small arrays alive. */
class BlobBuilder {
  size = 0;
  private parts: BlobPart[] = [];
  private loose = 0;

  add(chunks: Uint8Array[]): void {
    for (const chunk of chunks) {
      this.parts.push(chunk as BlobPart);
      this.loose += chunk.length;
      this.size += chunk.length;
    }
    // fold what piled up into one Blob: the browser may keep that off the JavaScript heap
    if (this.loose > 8 * 1024 * 1024) {
      this.parts = [new Blob(this.parts)];
      this.loose = 0;
    }
  }

  toBlob(type: string): Blob {
    return new Blob(this.parts, { type });
  }
}

/** One global palette for the whole animation, from frames spread over the timeline. */
async function choosePalette(source: FrameSource, plan: AnimationPlan, frames: FramePlan, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const histogram = new ColorHistogram();
  let previous: Uint32Array | null = null;
  // frames spread over the timeline plus some inside every transition, painted before the encoding starts
  for (const index of paletteSampleFrames(plan.timeline, frames)) {
    throwIfAborted(signal);
    source.paintSettled(frameTime(frames, index));
    const { data } = source.read();
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    // a picture that sits still would only count the same colours again and crowd out the moving parts
    if (!previous || !sameWords(words, previous)) histogram.addFrame(data, words.length > PALETTE_FULL_PIXELS ? 2 : 1);
    previous = words;
    await nextMacrotask();
  }
  // 255, not 256: one entry is kept for the "unchanged" colour of the frame differencing
  return buildPalette(histogram, 255);
}

async function exportGif(design: Design, plan: AnimationPlan, onProgress: ExportProgress | undefined, signal: AbortSignal | undefined): Promise<ExportFile> {
  const frames = planFrames(plan.total, plan.fps);
  const delays = frameDelays(frames);
  onProgress?.(0, frames.count);
  await loadPlanResources(design, plan, signal);

  const source = new FrameSource(design, plan, true);
  try {
    const palette = await choosePalette(source, plan, frames, signal);
    const encoder = new GifEncoder({ width: plan.width, height: plan.height, palette });
    const out = new BlobBuilder();
    out.add(encoder.takeChunks());
    for (let i = 0; i < frames.count; i++) {
      throwIfAborted(signal);
      source.paintSettled(frameTime(frames, i));
      const { data } = source.read();
      // painting and encoding are each tens of milliseconds on a big frame: never chain them in one task
      await nextMacrotask();
      throwIfAborted(signal);
      encoder.addFrame(data, delays[i]);
      out.add(encoder.takeChunks());
      if (out.size > GIF_MAX_BYTES) throw new ExportError("too-large", m.exporting.animation.gifTooBig(GIF_MAX_BYTES / (1024 * 1024)));
      onProgress?.(i + 1, frames.count);
      await nextMacrotask();
    }
    out.add(encoder.finish());
    return { name: exportFileName(design.title, "gif"), blob: out.toBlob("image/gif") };
  } finally {
    source.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* WebM                                                                */
/* ------------------------------------------------------------------ */

async function exportWebm(design: Design, plan: AnimationPlan, onProgress: ExportProgress | undefined, signal: AbortSignal | undefined): Promise<ExportFile> {
  const support = detectVideoSupport();
  if (!support.ok || !support.mimeType) throw new ExportError("unsupported", support.reason ?? m.exporting.animation.cannotRecord);
  onProgress?.(0, plan.frames);
  await loadPlanResources(design, plan, signal);

  const source = new FrameSource(design, plan, false);
  try {
    const result = await recordCanvas({
      canvas: source.canvas,
      paint: (seconds) => source.paintSettled(seconds),
      seconds: plan.total,
      fps: VIDEO_FPS,
      mimeType: support.mimeType,
      bitsPerSecond: videoBitrate(plan.width, plan.height),
      // progress counts frames at the video's rate, like the GIF's, so one progress bar fits both
      onProgress: (seconds) => onProgress?.(Math.min(plan.frames, Math.round(seconds * VIDEO_FPS)), plan.frames),
      signal,
    });
    onProgress?.(plan.frames, plan.frames);
    return { name: exportFileName(design.title, videoContainer(support.mimeType)), blob: result.blob, note: result.stalled ? STALLED_NOTE : undefined };
  } finally {
    source.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

/** Exports the playback of the chosen pages as a GIF or a WebM (`resolved.animation` says which, and how). */
export async function exportAnimated(design: Design, resolved: ResolvedExport, onProgress: ExportProgress | undefined, signal: AbortSignal | undefined): Promise<ExportFile> {
  const plan = resolved.animation;
  if (!plan) throw new Error("exportAnimated needs a gif or webm export.");
  const problem = animationProblem(plan);
  if (problem) throw new ExportError("too-large", problem);
  return plan.format === "gif" ? exportGif(design, plan, onProgress, signal) : exportWebm(design, plan, onProgress, signal);
}

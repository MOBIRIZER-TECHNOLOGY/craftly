/**
 * The pictures of the clips for a video made frame by frame. A <video> plays in real time and cannot be asked for "the frame at
 * 1.2 s" quickly, so each clip is decoded from its stored file instead (Mediabunny over WebCodecs): one reader per clip moves
 * forward through its frames as the export moves forward through time, and starts again at the trim when the clip loops.
 *
 * The renderer paints synchronously, so frames are fetched before a page is painted:
 *
 *   1. `prefetch(dt)` reads, for every clip asked for in the frame before, the frame `dt` seconds later (the usual case);
 *   2. the page is painted; `frame(el, time)` answers from what was read and notes any clip it had no frame for;
 *   3. when something was missing (a clip seen for the first time, a jump), `fill()` reads it and the page is painted again.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from "mediabunny";
import { getAsset } from "@/core/assets";
import type { VideoElement } from "@/core/types";
import { clipTime, isVideoSource } from "@/render/videos";

/** A frame read for this place in the clip may stand for any time up to this far after it (a frame lasts 1/30 s or less). */
const SAME_PLACE = 1e-6;

/** Moves through the frames of one clip in order; asked for an earlier place, it starts again from there. */
class ClipReader {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  /** the place the reader was last asked for */
  private at = Number.NaN;

  constructor(
    private readonly sink: CanvasSink,
    private readonly input: Input,
  ) {}

  /** The frame showing at `seconds` into the clip (the last one that starts at or before it); null when the clip has none there. */
  async frameAt(seconds: number): Promise<CanvasImageSource | null> {
    if (!this.iterator || !(seconds >= this.at)) await this.restart(seconds);
    this.at = seconds;
    while (this.next && this.next.timestamp <= seconds + SAME_PLACE) {
      this.current = this.next;
      const step = await this.iterator!.next();
      this.next = step.done ? null : step.value;
    }
    return this.current?.canvas ?? null;
  }

  private async restart(seconds: number): Promise<void> {
    await this.iterator?.return();
    // the frame showing at `seconds` may have started a little before it: begin one frame early, and let `frameAt` walk forward
    this.iterator = this.sink.canvases(Math.max(0, seconds - 0.1));
    const first = await this.iterator.next();
    this.current = first.done ? null : first.value;
    const second = first.done ? { done: true as const, value: undefined } : await this.iterator.next();
    this.next = second.done ? null : second.value;
    if (this.current && this.current.timestamp > seconds + SAME_PLACE) {
      // nothing starts before `seconds` (the very start of the clip): its first frame stands in
      this.next = this.current;
    }
  }

  async dispose(): Promise<void> {
    await this.iterator?.return().catch(() => undefined);
    this.iterator = null;
    this.input.dispose();
  }
}

interface Wanted {
  el: VideoElement;
  /** seconds into the page */
  time: number;
}

/** The clip frames of one export. `frame` is the renderer's `playVideos.frame`. */
export class ClipFrames {
  /** one reader per stored clip; null when the clip cannot be decoded here (its first frame is drawn instead) */
  private readers = new Map<string, Promise<ClipReader | null>>();
  /** element id -> the place in the clip that was read, and its picture */
  private ready = new Map<string, { place: number; picture: CanvasImageSource | null }>();
  /** clips asked for in the last painting that had no frame read for that place */
  private missing = new Map<string, Wanted>();
  /** every clip asked for in the last painting, for the next prefetch */
  private asked = new Map<string, Wanted>();

  /** For the renderer: the picture read for `el` at `time` seconds into its page (null: the first frame is drawn). */
  readonly frame = (el: VideoElement, time: number): CanvasImageSource | null => {
    const place = clipTime(el, time);
    this.asked.set(el.id, { el, time });
    const got = this.ready.get(el.id);
    if (got && Math.abs(got.place - place) <= SAME_PLACE) return got.picture;
    this.missing.set(el.id, { el, time });
    return got?.picture ?? null;
  };

  /** True when the last painting asked for a frame that had not been read: read it (`fill`) and paint again. */
  get incomplete(): boolean {
    return this.missing.size > 0;
  }

  /** Reads what the last painting was missing. */
  async fill(): Promise<void> {
    const wanted = [...this.missing.values()];
    this.missing.clear();
    await Promise.all(wanted.map((w) => this.read(w.el, w.time)));
  }

  /** Reads, for every clip of the last painting, its frame `dt` seconds later: what the next painting will most likely ask for. */
  async prefetch(dt: number): Promise<void> {
    const wanted = [...this.asked.values()];
    this.asked.clear();
    this.missing.clear();
    await Promise.all(wanted.map((w) => this.read(w.el, w.time + dt)));
  }

  private async read(el: VideoElement, time: number): Promise<void> {
    const place = clipTime(el, time);
    const reader = await this.readerFor(el);
    const picture = reader ? await reader.frameAt(place).catch(() => null) : null;
    this.ready.set(el.id, { place, picture });
  }

  /** Readers are per element, not per file: two copies of one clip play at different places and each needs its own. */
  private readerFor(el: VideoElement): Promise<ClipReader | null> {
    let reader = this.readers.get(el.id);
    if (!reader) {
      reader = openReader(el);
      this.readers.set(el.id, reader);
    }
    return reader;
  }

  async dispose(): Promise<void> {
    const readers = await Promise.all(this.readers.values());
    await Promise.all(readers.map((r) => r?.dispose()));
    this.readers.clear();
    this.ready.clear();
  }
}

async function openReader(el: VideoElement): Promise<ClipReader | null> {
  if (!isVideoSource(el.src)) return null;
  try {
    const asset = await getAsset(el.src.slice(6));
    if (!asset) return null;
    const input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    // the clip at its own size: the renderer scales it into the element as it does a playing <video>
    return new ClipReader(new CanvasSink(track), input);
  } catch {
    return null;
  }
}

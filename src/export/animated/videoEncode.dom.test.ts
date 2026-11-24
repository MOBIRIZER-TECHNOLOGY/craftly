import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage, createVideo } from "@/core/factory";
import type { VideoElement } from "@/core/types";
import { buildTimeline } from "@/core/transition";
import { ExportError, isCancelled } from "../errors";

/*
 * The video made frame by frame, with Mediabunny and Web Audio replaced by stand-ins that write down what they were asked: jsdom has
 * neither WebCodecs nor an audio engine. That the real ones produce a playable MP4 with the right pictures and sound is checked in
 * Chrome (the browser journey reads a download back from its pixels and its pitch).
 */

const mb = vi.hoisted(() => ({
  /** what canEncodeVideo / canEncodeAudio answer, by codec */
  video: {} as Record<string, boolean>,
  audio: {} as Record<string, boolean>,
  /** the stored clips: per asset id, its frames' timestamps (null: no picture track) and its sound (null: none) */
  clips: {} as Record<string, { frames: number[] | null; sound: { rate: number; seconds: number; channels: number } | null; decodes?: boolean; broken?: boolean }>,
  /** every `canvases(start)` asked of a clip, as [asset id, start] */
  seeks: [] as Array<[string, number]>,
  inputsDisposed: 0,
  outputs: [] as Array<{ format: string; started: boolean; finalized: boolean; cancelled: boolean; frames: number[]; sound: number[]; videoCodec?: string; audioCodec?: string }>,
  /** a frame number at which CanvasSource.add fails */
  failAt: -1,
}));

vi.mock("mediabunny", () => {
  class Quality {
    constructor(readonly options: unknown) {}
  }
  class BlobSource {
    constructor(readonly blob: Blob & { assetId?: string }) {}
  }
  class Input {
    private readonly id: string;
    constructor(opts: { source: BlobSource }) {
      this.id = opts.source.blob.assetId!;
    }
    async getPrimaryVideoTrack() {
      const clip = mb.clips[this.id];
      if (clip?.broken) throw new Error("not a media file");
      return clip?.frames ? { id: this.id, frames: clip.frames, canDecode: async () => clip.decodes !== false } : null;
    }
    async getPrimaryAudioTrack() {
      const clip = mb.clips[this.id];
      if (clip?.broken) throw new Error("not a media file");
      return clip?.sound ? { id: this.id, sound: clip.sound, canDecode: async () => clip.decodes !== false } : null;
    }
    dispose() {
      mb.inputsDisposed++;
    }
  }
  class CanvasSink {
    constructor(private readonly track: { id: string; frames: number[] }) {}
    async *canvases(start = 0) {
      mb.seeks.push([this.track.id, start]);
      // like Mediabunny: from the frame showing at `start` on
      const frames = this.track.frames;
      let first = frames.findIndex((t, i) => t <= start && (i === frames.length - 1 || frames[i + 1] > start));
      if (first < 0) first = 0;
      for (const t of frames.slice(first)) yield { canvas: { picture: `${this.track.id}@${t}` }, timestamp: t, duration: 1 / 30 };
    }
  }
  class AudioBufferSink {
    constructor(private readonly track: { sound: { rate: number; seconds: number; channels: number } }) {}
    async *buffers(start: number, end: number) {
      // one-second pieces from the start of the clip; the piece holding `start` first, as Mediabunny does
      const { rate, seconds, channels } = this.track.sound;
      for (let at = Math.floor(start); at < Math.min(end, seconds); at++) {
        const length = Math.round(Math.min(1, seconds - at) * rate);
        const data = Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => (c + 1) * 0.1 + (at * rate + i) / 1e9));
        yield { buffer: { sampleRate: rate, numberOfChannels: channels, length, getChannelData: (c: number) => data[c] }, timestamp: at, duration: length / rate };
      }
    }
  }
  class BufferTarget {
    buffer: ArrayBuffer | null = null;
  }
  class Mp4OutputFormat {
    readonly name = "mp4";
  }
  class WebMOutputFormat {
    readonly name = "webm";
  }
  class CanvasSource {
    output?: (typeof mb.outputs)[number];
    constructor(
      readonly canvas: unknown,
      readonly config: { codec: string },
    ) {}
    async add(timestamp: number) {
      if (mb.failAt >= 0 && this.output!.frames.length === mb.failAt) throw new Error("the encoder broke");
      this.output!.frames.push(timestamp);
    }
  }
  class AudioBufferSource {
    output?: (typeof mb.outputs)[number];
    constructor(readonly config: { codec: string }) {}
    async add(buffer: { length: number }) {
      this.output!.sound.push(buffer.length);
    }
  }
  class Output {
    private readonly record: (typeof mb.outputs)[number];
    constructor(private readonly opts: { format: { name: string }; target: BufferTarget }) {
      this.record = { format: opts.format.name, started: false, finalized: false, cancelled: false, frames: [], sound: [] };
      mb.outputs.push(this.record);
    }
    addVideoTrack(source: CanvasSource) {
      source.output = this.record;
      this.record.videoCodec = source.config.codec;
    }
    addAudioTrack(source: AudioBufferSource) {
      source.output = this.record;
      this.record.audioCodec = source.config.codec;
    }
    async start() {
      this.record.started = true;
    }
    async finalize() {
      this.record.finalized = true;
      this.opts.target.buffer = new Uint8Array([1, 2, 3, this.record.frames.length]).buffer;
    }
    async cancel() {
      this.record.cancelled = true;
    }
  }
  return {
    ALL_FORMATS: [],
    AudioBufferSink,
    AudioBufferSource,
    BlobSource,
    BufferTarget,
    CanvasSink,
    CanvasSource,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
    WebMOutputFormat,
    canEncodeVideo: vi.fn(async (codec: string) => mb.video[codec] ?? false),
    canEncodeAudio: vi.fn(async (codec: string) => mb.audio[codec] ?? false),
  };
});

vi.mock("@/core/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/assets")>()),
  getAsset: vi.fn(async (id: string) => (mb.clips[id] ? { id, blob: Object.assign(new Blob(["x"]), { assetId: id }) } : null)),
}));

/** Web Audio's AudioBuffer, which jsdom does not have. */
class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(o: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = o.length;
    this.numberOfChannels = o.numberOfChannels;
    this.sampleRate = o.sampleRate;
    this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
  }
  getChannelData(c: number) {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number) {
    this.data[c].set(src);
  }
}

/** An OfflineAudioContext that writes down the sources it plays and when. */
class FakeOfflineContext {
  static last: FakeOfflineContext | null = null;
  readonly played: Array<{ buffer: FakeAudioBuffer; loop: boolean; start: number; stop: number; fades: Array<[string, number, number]> }> = [];
  readonly destination = {};
  constructor(readonly options: { numberOfChannels: number; length: number; sampleRate: number }) {
    FakeOfflineContext.last = this;
  }
  createBufferSource() {
    const entry = { buffer: null as unknown as FakeAudioBuffer, loop: false, start: Number.NaN, stop: Number.NaN, fades: [] as Array<[string, number, number]> };
    const node = {
      set buffer(b: FakeAudioBuffer) {
        entry.buffer = b;
      },
      set loop(v: boolean) {
        entry.loop = v;
      },
      connect: (gain: { fades: Array<[string, number, number]> }) => {
        entry.fades = gain.fades;
        return gain;
      },
      start: (at: number) => (entry.start = at),
      stop: (at: number) => (entry.stop = at),
    };
    this.played.push(entry);
    return node;
  }
  createGain() {
    // the gain is set up before the source is connected to it: the source takes its list of changes when it is
    const fades: Array<[string, number, number]> = [];
    return {
      fades,
      gain: {
        setValueAtTime: (v: number, t: number) => fades.push(["set", v, t]),
        linearRampToValueAtTime: (v: number, t: number) => fades.push(["ramp", v, t]),
      },
      connect: () => undefined,
    };
  }
  /** what the rendered mix holds: the same sample everywhere, or a few loud ones */
  static level = 0;
  static spikes: Array<[number, number, number]> = [];
  async startRendering() {
    const out = new FakeAudioBuffer({ length: this.options.length, numberOfChannels: 2, sampleRate: this.options.sampleRate });
    for (let c = 0; c < 2; c++) out.getChannelData(c).fill(FakeOfflineContext.level);
    for (const [c, i, v] of FakeOfflineContext.spikes) out.getChannelData(c)[i] = v;
    return out;
  }
}

const { ClipFrames } = await import("./clipFrames");
const { chooseEncoding, encodeFrames } = await import("./encode");
const { MIX_CEILING, mixClipSound } = await import("./clipSound");

const frames30 = (seconds: number) => Array.from({ length: Math.round(seconds * 30) }, (_, i) => i / 30);
const clip = (over: Partial<VideoElement> & { src?: string } = {}) =>
  createVideo({ src: "asset:a", duration: 2, naturalWidth: 64, naturalHeight: 36, width: 64, height: 36, ...over } as Parameters<typeof createVideo>[0]);

beforeEach(() => {
  mb.video = {};
  mb.audio = {};
  mb.clips = { a: { frames: frames30(2), sound: { rate: 1000, seconds: 2, channels: 2 } } };
  mb.seeks = [];
  mb.inputsDisposed = 0;
  mb.outputs = [];
  mb.failAt = -1;
  FakeOfflineContext.level = 0;
  FakeOfflineContext.spikes = [];
  vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
  vi.stubGlobal("OfflineAudioContext", FakeOfflineContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe("the clips' pictures, frame by frame", () => {
  const picture = (frames: InstanceType<typeof ClipFrames>, el: VideoElement, t: number) => (frames.frame(el, t) as { picture: string } | null)?.picture ?? null;

  it("has nothing the first time a clip is asked for, then reads the frame showing at that place", async () => {
    const frames = new ClipFrames();
    const el = clip();
    expect(frames.frame(el, 0.5)).toBeNull();
    expect(frames.incomplete).toBe(true);
    await frames.fill();
    expect(frames.incomplete).toBe(false);
    expect(picture(frames, el, 0.5)).toBe("a@0.5");
    // between two frames: the one that started last
    await frames.prefetch(0.02);
    expect(picture(frames, el, 0.52)).toBe("a@0.5");
    await frames.dispose();
    expect(mb.inputsDisposed).toBe(1);
  });

  it("reads ahead one frame at a time without seeking again, so a whole clip is decoded once", async () => {
    const frames = new ClipFrames();
    const el = clip();
    frames.frame(el, 0);
    await frames.fill();
    for (let i = 1; i < 45; i++) {
      await frames.prefetch(1 / 30);
      const shown = picture(frames, el, i / 30);
      expect(frames.incomplete).toBe(false);
      expect(shown).toBe(`a@${i / 30}`);
    }
    expect(mb.seeks).toHaveLength(1);
  });

  it("goes back to the trim when the clip loops, at its speed", async () => {
    const frames = new ClipFrames();
    const el = clip({ trimStart: 0.5, trimEnd: 1, speed: 2 });
    frames.frame(el, 0);
    await frames.fill();
    expect(picture(frames, el, 0)).toBe("a@0.5");
    // 0.2 s of the page is 0.4 s of the clip at 2x
    await frames.prefetch(0.2);
    expect(picture(frames, el, 0.2)).toBe(`a@${27 / 30}`);
    // 0.3 s is 0.6 s: once round the half-second loop, and 0.1 s into it again
    await frames.prefetch(0.1);
    expect(picture(frames, el, 0.3)).toBe(`a@${18 / 30}`);
    expect(mb.seeks.length).toBe(2);
    expect(mb.seeks[1][1]).toBeLessThan(0.6);
  });

  it("holds the last frame of a clip that plays once", async () => {
    const frames = new ClipFrames();
    const el = clip({ trimEnd: 1, once: true });
    frames.frame(el, 2.5);
    await frames.fill();
    expect(picture(frames, el, 2.5)).toBe(`a@${28 / 30}`);
  });

  it("reads two copies of one clip separately, each at its own place", async () => {
    const frames = new ClipFrames();
    const one = clip();
    const two = clip({ trimStart: 1 });
    frames.frame(one, 0);
    frames.frame(two, 0);
    await frames.fill();
    expect(picture(frames, one, 0)).toBe("a@0");
    expect(picture(frames, two, 0)).toBe("a@1");
  });

  it("draws the first frame of a clip it cannot read: not stored, no picture track, not decodable here", async () => {
    mb.clips.b = { frames: null, sound: null };
    mb.clips.c = { frames: frames30(1), sound: null, decodes: false };
    const frames = new ClipFrames();
    for (const el of [clip({ src: "asset:gone" }), clip({ src: "asset:b" }), clip({ src: "asset:c" }), clip({ src: "https://x.test/v.mp4" })]) {
      frames.frame(el, 0);
      await frames.fill();
      expect(frames.frame(el, 0)).toBeNull();
      expect(frames.incomplete).toBe(false);
    }
    await frames.dispose();
  });
});

/* ------------------------------------------------------------------ */

describe("choosing the encoding", () => {
  it("prefers MP4 with H.264 and AAC", async () => {
    mb.video = { avc: true, vp9: true, vp8: true };
    mb.audio = { aac: true, opus: true };
    expect(await chooseEncoding(1280, 720, 5e6, 48000, true)).toEqual({ container: "mp4", video: "avc", audio: "aac" });
  });

  it("writes Opus in the MP4 in a browser with no AAC encoder (Firefox)", async () => {
    mb.video = { avc: true, vp9: true };
    mb.audio = { opus: true };
    expect(await chooseEncoding(1280, 720, 5e6, 48000, true)).toEqual({ container: "mp4", video: "avc", audio: "opus" });
  });

  it("writes WebM in a browser with no H.264 encoder", async () => {
    mb.video = { vp9: true, vp8: true };
    mb.audio = { opus: true };
    expect(await chooseEncoding(1280, 720, 5e6, 48000, true)).toEqual({ container: "webm", video: "vp9", audio: "opus" });
    mb.video = { vp8: true };
    expect(await chooseEncoding(1280, 720, 5e6, 48000, true)).toEqual({ container: "webm", video: "vp8", audio: "opus" });
  });

  it("makes a silent video when there is no sound, or no sound the browser can encode", async () => {
    mb.video = { avc: true };
    mb.audio = { aac: true };
    expect(await chooseEncoding(1280, 720, 5e6, 48000, false)).toEqual({ container: "mp4", video: "avc", audio: null });
    mb.audio = {};
    expect(await chooseEncoding(1280, 720, 5e6, 48000, true)).toEqual({ container: "mp4", video: "avc", audio: null });
  });

  it("gives up when no picture can be encoded at this size", async () => {
    mb.audio = { aac: true, opus: true };
    expect(await chooseEncoding(1280, 720, 5e6, 48000, true)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe("encoding the frames", () => {
  const canvas = () => document.createElement("canvas");
  const sound = (seconds: number, rate = 1000) => new FakeAudioBuffer({ length: seconds * rate, numberOfChannels: 2, sampleRate: rate }) as unknown as AudioBuffer;

  it("paints and encodes every frame at its time, and returns the file", async () => {
    const painted: number[] = [];
    const done: number[] = [];
    const blob = await encodeFrames({
      encoding: { container: "mp4", video: "avc", audio: null },
      canvas: canvas(),
      paint: async (i) => void painted.push(i),
      frames: 6,
      fps: 30,
      bitrate: 1e6,
      sound: null,
      onFrame: (n) => done.push(n),
    });
    expect(painted).toEqual([0, 1, 2, 3, 4, 5]);
    expect(done).toEqual([1, 2, 3, 4, 5, 6]);
    expect(blob.type).toBe("video/mp4");
    expect(mb.outputs[0]).toMatchObject({ format: "mp4", started: true, finalized: true, videoCodec: "avc", sound: [] });
    expect(mb.outputs[0].frames.map((t) => Math.round(t * 30))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mb.outputs[0].audioCodec).toBeUndefined();
  });

  it("hands the sound over a second at a time alongside the pictures, cut to the length of the video", async () => {
    await encodeFrames({
      encoding: { container: "webm", video: "vp9", audio: "opus" },
      canvas: canvas(),
      paint: async () => undefined,
      frames: 75,
      fps: 30,
      bitrate: 1e6,
      sound: sound(4),
    });
    const out = mb.outputs[0];
    expect(out).toMatchObject({ format: "webm", audioCodec: "opus" });
    // 75 frames are 2.5 s: two whole seconds and a half, of the four the sound lasts
    expect(out.sound).toEqual([1000, 1000, 500]);
  });

  it("leaves the sound out when the encoding has no sound track", async () => {
    await encodeFrames({
      encoding: { container: "mp4", video: "avc", audio: null },
      canvas: canvas(),
      paint: async () => undefined,
      frames: 3,
      fps: 30,
      bitrate: 1e6,
      sound: sound(1),
    });
    expect(mb.outputs[0].audioCodec).toBeUndefined();
    expect(mb.outputs[0].sound).toEqual([]);
  });

  it("stops and throws away the file when cancelled", async () => {
    const abort = new AbortController();
    const error = await encodeFrames({
      encoding: { container: "mp4", video: "avc", audio: null },
      canvas: canvas(),
      paint: async (i) => {
        if (i === 2) abort.abort();
      },
      frames: 10,
      fps: 30,
      bitrate: 1e6,
      sound: null,
      signal: abort.signal,
    }).catch((e: unknown) => e);
    expect(isCancelled(error)).toBe(true);
    expect(mb.outputs[0]).toMatchObject({ cancelled: true, finalized: false });
    expect(mb.outputs[0].frames.length).toBe(3);
  });

  it("says in a sentence that the video could not be made when the encoder fails", async () => {
    mb.failAt = 1;
    const error = await encodeFrames({
      encoding: { container: "mp4", video: "avc", audio: null },
      canvas: canvas(),
      paint: async () => undefined,
      frames: 4,
      fps: 30,
      bitrate: 1e6,
      sound: null,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect((error as ExportError).message).toBe("The video could not be made. Please try again.");
    expect(mb.outputs[0].cancelled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("mixing the clips' sound", () => {
  const page = (elements: VideoElement[], duration = 3, transition?: number) =>
    createPage({ duration, elements, transition: transition ? { kind: "dissolve", duration: transition } : undefined });

  it("is nothing when no clip makes a sound, so the video gets no sound track", async () => {
    mb.clips.quiet = { frames: frames30(2), sound: null };
    const pages = [page([clip({ muted: true }), clip({ src: "asset:quiet" })])];
    expect(await mixClipSound(pages, buildTimeline(pages), 3)).toBeNull();
  });

  it("plays each clip over and over while its page is on screen, and not during the transition into the next", async () => {
    const pages = [page([clip()], 3), page([], 2, 1), page([clip({ trimStart: 0.5, trimEnd: 1.5 })], 2, 0.5)];
    const timeline = buildTimeline(pages);
    const mixed = await mixClipSound(pages, timeline, timeline.total);
    expect(mixed).not.toBeNull();
    const ctx = FakeOfflineContext.last!;
    expect(ctx.options).toEqual({ numberOfChannels: 2, sampleRate: 48000, length: Math.ceil(timeline.total * 48000) });
    // page 1 from 0 to 3; nothing on page 2; page 3 from its start after the half-second transition (6.5) to its end (8.5)
    expect(ctx.played.map((p) => [p.start, p.stop, p.loop])).toEqual([
      [0, 3, true],
      [6.5, 8.5, true],
    ]);
    // the whole clip loops on page 1, and only its trimmed second on page 3
    expect(ctx.played[0].buffer.length).toBe(2000);
    expect(ctx.played[1].buffer.length).toBe(1000);
    // each fades out over the last 10 ms of its page instead of stopping with a click
    expect(ctx.played[0].fades).toEqual([
      ["set", 1, 2.99],
      ["ramp", 0, 3],
    ]);
  });

  it("stretches a clip to its speed (a 2 s clip at 2x loops every second)", async () => {
    const pages = [page([clip({ speed: 2 })])];
    await mixClipSound(pages, buildTimeline(pages), 3);
    expect(FakeOfflineContext.last!.played[0].buffer.length).toBe(1000);
  });

  it("keeps the clip's channels, two at most, from where the trim starts", async () => {
    mb.clips.wide = { frames: frames30(2), sound: { rate: 1000, seconds: 2, channels: 6 } };
    const pages = [page([clip({ src: "asset:wide", trimStart: 1.25, trimEnd: 2 })])];
    await mixClipSound(pages, buildTimeline(pages), 3);
    const buffer = FakeOfflineContext.last!.played[0].buffer;
    expect(buffer.numberOfChannels).toBe(2);
    // the first sample (after the fade in) is the clip's sample at 1.25 s
    expect(buffer.getChannelData(1)[100]).toBeCloseTo(0.2 + (1250 + 100) / 1e9, 6);
  });

  it("reads a clip once for two copies of it on two pages", async () => {
    const pages = [page([clip()]), page([clip()])];
    await mixClipSound(pages, buildTimeline(pages), 6);
    expect(FakeOfflineContext.last!.played).toHaveLength(2);
    expect(mb.inputsDisposed).toBe(1);
  });

  it("leaves out a clip that is gone or that this browser cannot decode, and stops when cancelled", async () => {
    mb.clips.locked = { frames: frames30(2), sound: { rate: 1000, seconds: 2, channels: 2 }, decodes: false };
    const pages = [page([clip({ src: "asset:gone" }), clip({ src: "asset:locked" })])];
    expect(await mixClipSound(pages, buildTimeline(pages), 3)).toBeNull();
    const abort = new AbortController();
    abort.abort();
    const error = await mixClipSound([page([clip()])], buildTimeline([page([clip()])]), 3, abort.signal).catch((e: unknown) => e);
    expect(isCancelled(error)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("edge cases of a clip's pictures", () => {
  const picture = (frames: InstanceType<typeof ClipFrames>, el: VideoElement, t: number) => (frames.frame(el, t) as { picture: string } | null)?.picture ?? null;

  it("shows the first frame of a clip whose frames start a little after its beginning", async () => {
    mb.clips.late = { frames: [0.25, 0.5, 0.75], sound: null };
    const frames = new ClipFrames();
    const el = clip({ src: "asset:late" });
    frames.frame(el, 0);
    await frames.fill();
    expect(picture(frames, el, 0)).toBe("late@0.25");
    await frames.prefetch(0.6);
    expect(picture(frames, el, 0.6)).toBe("late@0.5");
  });

  it("has no picture for a clip without frames, and for one that is not a media file", async () => {
    mb.clips.empty = { frames: [], sound: null };
    mb.clips.junk = { frames: frames30(1), sound: null, broken: true };
    const frames = new ClipFrames();
    for (const src of ["asset:empty", "asset:junk"]) {
      const el = clip({ src });
      frames.frame(el, 0);
      await frames.fill();
      expect(frames.frame(el, 0)).toBeNull();
    }
    await frames.dispose();
  });
});

describe("edge cases of the mix", () => {
  const page = (elements: VideoElement[]) => createPage({ duration: 3, elements });

  it("lowers a mix that goes past full scale evenly, so the encoder does not clip it", async () => {
    FakeOfflineContext.level = 0.5;
    FakeOfflineContext.spikes = [[1, 10, -1.96]];
    const mixed = (await mixClipSound([page([clip(), clip({ trimStart: 0.5 })])], buildTimeline([page([])]), 3))!;
    expect(Math.abs(mixed.getChannelData(1)[10])).toBeCloseTo(MIX_CEILING, 5);
    // everything else by the same amount: the balance between the clips is kept
    expect(mixed.getChannelData(0)[0]).toBeCloseTo(0.25, 5);
  });

  it("leaves a mix that fits exactly as it is", async () => {
    FakeOfflineContext.level = 0.7;
    const mixed = (await mixClipSound([page([clip()])], buildTimeline([page([])]), 3))!;
    expect(mixed.getChannelData(0)[5]).toBeCloseTo(0.7, 6);
  });

  it("keeps a mono clip mono (the mix spreads it to both sides)", async () => {
    mb.clips.mono = { frames: frames30(2), sound: { rate: 1000, seconds: 2, channels: 1 } };
    await mixClipSound([page([clip({ src: "asset:mono" })])], buildTimeline([page([])]), 3);
    expect(FakeOfflineContext.last!.played[0].buffer.numberOfChannels).toBe(1);
  });

  it("leaves out a clip with a sound track that holds nothing, or a file that is not media", async () => {
    mb.clips.hollow = { frames: frames30(2), sound: { rate: 1000, seconds: 0, channels: 2 } };
    mb.clips.junk = { frames: frames30(2), sound: { rate: 1000, seconds: 2, channels: 2 }, broken: true };
    expect(await mixClipSound([page([clip({ src: "asset:hollow" }), clip({ src: "asset:junk" })])], buildTimeline([page([])]), 3)).toBeNull();
  });

  it("skips a page the timeline has no room for", async () => {
    const pages = [page([clip()]), page([clip()])];
    // the second page starts at 3 s; a total of 3 s leaves it no time
    await mixClipSound(pages, buildTimeline(pages), 3);
    expect(FakeOfflineContext.last!.played.map((p) => p.start)).toEqual([0]);
  });
});

describe("a clip's volume and fades in the mix", () => {
  const page = (elements: VideoElement[]) => createPage({ duration: 3, elements });
  const loop = async (el: VideoElement) => {
    await mixClipSound([page([el])], buildTimeline([page([])]), 3);
    return FakeOfflineContext.last!.played[0].buffer;
  };
  // the stand-in clip's left channel is 0.1 plus a tiny ramp, at 1,000 samples a second
  const sample = (at: number) => 0.1 + at / 1e9;

  it("plays the clip's sound at its volume", async () => {
    const buffer = await loop(clip({ volume: 0.5 }));
    expect(buffer.getChannelData(0)[1000]).toBeCloseTo(sample(1000) * 0.5, 6);
  });

  it("rises over its fade in and falls over its fade out, once every play", async () => {
    const buffer = await loop(clip({ fadeIn: 1, fadeOut: 0.5 }));
    const left = buffer.getChannelData(0);
    expect(left[500]).toBeCloseTo(sample(500) * 0.5, 6);
    expect(left[1200]).toBeCloseTo(sample(1200), 6);
    expect(left[1750]).toBeCloseTo(sample(1750) * 0.5, 6);
  });

  it("plays a clip that plays once a single time, and loops any other", async () => {
    await mixClipSound([page([clip({ once: true }), clip({ trimStart: 1 })])], buildTimeline([page([])]), 3);
    expect(FakeOfflineContext.last!.played.map((p) => p.loop)).toEqual([false, true]);
  });

  it("reads a clip again when only its volume differs, and once for two copies alike", async () => {
    await mixClipSound([page([clip(), clip(), clip({ volume: 0.2 })])], buildTimeline([page([])]), 3);
    expect(FakeOfflineContext.last!.played).toHaveLength(3);
    expect(mb.inputsDisposed).toBe(2);
  });
});

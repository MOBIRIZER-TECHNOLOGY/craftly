import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The sounds Mediabunny reads, by upload id: pieces of [timestamp, samples of the left channel], or no sound, or one it cannot decode. */
const media = vi.hoisted(() => ({
  sounds: {} as Record<string, { pieces?: Array<[number, number[]]>; rate?: number; decodes?: boolean; broken?: boolean }>,
  disposed: 0,
  reads: 0,
}));
vi.mock("@/core/assets", () => ({ getAsset: vi.fn(async (id: string) => (id === "gone" ? null : { id, blob: new Blob([id]) })) }));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {
    constructor(readonly blob: Blob) {}
  },
  Input: class {
    private id = "";
    constructor(options: { source: { blob: Blob } }) {
      void options.source.blob.text().then((t) => (this.id = t));
    }
    async getPrimaryAudioTrack() {
      await Promise.resolve();
      media.reads++;
      const sound = media.sounds[this.id];
      if (sound?.broken) throw new Error("not a media file");
      return sound?.pieces ? { sound, canDecode: async () => sound.decodes !== false } : null;
    }
    dispose() {
      media.disposed++;
    }
  },
  AudioBufferSink: class {
    constructor(private readonly track: { sound: { pieces: Array<[number, number[]]>; rate?: number } }) {}
    async *buffers() {
      const rate = this.track.sound.rate ?? 10;
      for (const [timestamp, left] of this.track.sound.pieces) {
        const data = Float32Array.from(left);
        yield { timestamp, buffer: { sampleRate: rate, numberOfChannels: 1, getChannelData: () => data } };
      }
    }
  },
}));

const { addToPeaks, clearSoundPeaks, normalizePeaks, peaksBetween, useSoundPeaks } = await import("./soundPeaks");

beforeEach(() => {
  clearSoundPeaks();
  media.sounds = {};
  media.disposed = 0;
  media.reads = 0;
});
afterEach(() => clearSoundPeaks());

describe("the shape of a sound", () => {
  it("keeps the loudest sample of each peak, of either channel, from where each piece starts", () => {
    const peaks = new Float32Array(4);
    // 10 samples a second, 2 peaks a second: 5 samples a peak
    addToPeaks(peaks, 2, 0, 10, [Float32Array.from([0.1, -0.5, 0.2, 0, 0, 0.3]), Float32Array.from([0, 0, 0, 0, 0, -0.8])]);
    addToPeaks(peaks, 2, 1.5, 10, [Float32Array.from([0.25, 0, 0, 0, 0, 0.9, 0.9])]);
    expect([...peaks].map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 0.8, 0, 0.25]);
    // a piece before the start or past the end adds nothing there
    addToPeaks(peaks, 2, -1, 10, [Float32Array.from([1])]);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(normalizePeaks(Float32Array.from([0.2, 0.4]))).toEqual(Float32Array.from([0.5, 1]));
    expect(normalizePeaks(new Float32Array(2))).toEqual(new Float32Array(2));
  });

  it("gives one play's columns, each the loudest of the peaks it covers", () => {
    const sound = { perSecond: 2, peaks: Float32Array.from([0.1, 0.5, 0.2, 1, 0.3, 0]) };
    expect(peaksBetween(sound, 0, 3, 3).map((v) => Math.round(v * 10) / 10)).toEqual([0.5, 1, 0.3]);
    // trimmed: 1 s to 2 s, in four columns (more columns than peaks repeat them)
    expect(peaksBetween(sound, 1, 2, 4).map((v) => Math.round(v * 10) / 10)).toEqual([0.2, 0.2, 1, 1]);
    expect(peaksBetween(sound, 2.5, 4, 2)).toEqual([0, 0]);
  });

  it("reads a sound once, a piece at a time, and gives it to every bar of it", async () => {
    media.sounds.song = {
      pieces: [
        [0, [0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1]],
        [1, [0.25]],
      ],
      rate: 10,
    };
    const first = renderHook(() => useSoundPeaks("asset:song", 1.1));
    expect(first.result.current).toBeNull();
    await waitFor(() => expect(first.result.current).not.toBeNull());
    const shape = first.result.current!;
    // 20 a second: half a second of 0.5 and half of 1, then 0.25
    expect(shape.perSecond).toBe(20);
    expect(shape.peaks).toHaveLength(22);
    expect(shape.peaks[0]).toBe(0.5);
    expect(shape.peaks[10]).toBe(1);
    expect(shape.peaks[20]).toBe(0.25);
    const second = renderHook(() => useSoundPeaks("asset:song", 1.1));
    expect(second.result.current).toBe(shape);
    expect(media.reads).toBe(1);
    expect(media.disposed).toBe(1);
  });

  it("reads fewer a second of a very long sound", async () => {
    media.sounds.long = { pieces: [[0, [1]]], rate: 10 };
    const view = renderHook(() => useSoundPeaks("asset:long", 7200));
    await waitFor(() => expect(view.result.current).not.toBeNull());
    expect(view.result.current!.perSecond).toBe(10);
    expect(view.result.current!.peaks).toHaveLength(72000);
  });

  it("gives nothing for a sound that is gone, has no sound, cannot be decoded here or is not a media file", async () => {
    media.sounds.quiet = {};
    media.sounds.locked = { pieces: [[0, [1]]], decodes: false };
    media.sounds.junk = { broken: true };
    for (const src of ["asset:gone", "asset:quiet", "asset:locked", "asset:junk"]) {
      const view = renderHook(() => useSoundPeaks(src, 2));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(view.result.current).toBeNull();
    }
    expect(media.disposed).toBe(3);
  });
});

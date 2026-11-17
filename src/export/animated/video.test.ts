import { describe, expect, it } from "vitest";
import { RecordingClock, VIDEO_MIME_TYPES, detectVideoSupport, videoContainer, type RecorderEnv } from "./video";
import { encodeEbmlSize, patchWebmDuration, withWebmDuration } from "./webm";

const env = (supported: readonly string[] | "throws", captureStream: unknown = () => undefined): RecorderEnv => ({
  MediaRecorder: {
    isTypeSupported: (type: string) => {
      if (supported === "throws") throw new Error("boom");
      return supported.includes(type);
    },
  },
  HTMLCanvasElement: { prototype: { captureStream } },
});

describe("detectVideoSupport", () => {
  it("prefers VP9, then VP8, then whatever WebM the browser has, then MP4", () => {
    expect(VIDEO_MIME_TYPES).toEqual(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"]);
    expect(detectVideoSupport(env(VIDEO_MIME_TYPES))).toEqual({ ok: true, mimeType: "video/webm;codecs=vp9", reason: null });
    expect(detectVideoSupport(env(["video/webm;codecs=vp8", "video/webm"])).mimeType).toBe("video/webm;codecs=vp8");
    expect(detectVideoSupport(env(["video/webm", "video/mp4"])).mimeType).toBe("video/webm");
  });

  it("records MP4 in a browser that records no WebM (Safari)", () => {
    expect(detectVideoSupport(env(["video/mp4;codecs=avc1", "video/mp4"]))).toEqual({ ok: true, mimeType: "video/mp4;codecs=avc1", reason: null });
    expect(detectVideoSupport(env(["video/mp4"])).mimeType).toBe("video/mp4");
    expect(videoContainer("video/mp4;codecs=avc1")).toBe("mp4");
    expect(videoContainer("video/webm;codecs=vp9")).toBe("webm");
    expect(videoContainer(null)).toBe("webm");
  });

  it("is not possible without MediaRecorder or canvas capture, and says so in a sentence", () => {
    for (const missing of [
      {},
      { MediaRecorder: undefined },
      { MediaRecorder: {} },
      { ...env(VIDEO_MIME_TYPES), HTMLCanvasElement: undefined },
      env(VIDEO_MIME_TYPES, null),
      env(VIDEO_MIME_TYPES, "no"),
    ]) {
      const support = detectVideoSupport(missing as RecorderEnv);
      expect(support.ok).toBe(false);
      expect(support.mimeType).toBeNull();
      expect(support.reason).toMatch(/cannot record video.*Chrome, Edge or Firefox.*GIF/);
    }
  });

  it("is not possible when the browser records neither WebM nor MP4", () => {
    const support = detectVideoSupport(env(["video/x-matroska"]));
    expect(support).toMatchObject({ ok: false, mimeType: null });
    expect(support.reason).toMatch(/cannot record video as WebM or MP4/);
  });

  it("survives a browser that throws from isTypeSupported", () => {
    expect(detectVideoSupport(env("throws")).ok).toBe(false);
  });

  it("reports node (no browser APIs) as unsupported instead of throwing", () => {
    expect(() => detectVideoSupport()).not.toThrow();
    expect(detectVideoSupport().ok).toBe(false);
  });
});

describe("RecordingClock", () => {
  /** Runs the clock with ticks `step` ms apart and returns everything it asked to paint. */
  function run(total: number, fps: number, step = 1000 / 60, startAt = 5000) {
    const clock = new RecordingClock(total, fps);
    const painted: number[] = [];
    let now = startAt;
    for (let i = 0; i < 100_000; i++, now += step) {
      const tick = clock.tick(now);
      if (tick.paint) painted.push(tick.time);
      if (tick.done) return { clock, painted, endedAt: now - startAt };
    }
    throw new Error("the clock never finished");
  }

  it("paints the first picture at once, at second zero", () => {
    const clock = new RecordingClock(5, 30);
    expect(clock.tick(123_456)).toEqual({ time: 0, paint: true, done: false });
  });

  it("paints about fps frames per second at the wall clock time, in order, never beyond the end", () => {
    const { painted } = run(2, 30);
    expect(painted[0]).toBe(0);
    for (let i = 1; i < painted.length; i++) expect(painted[i]).toBeGreaterThanOrEqual(painted[i - 1]);
    expect(Math.max(...painted)).toBe(2);
    // 2 s of animation plus the hold at the end, at ~30 fps
    expect(painted.length).toBeGreaterThanOrEqual(2 * 30 - 2);
    expect(painted.length).toBeLessThanOrEqual((2 + 0.2) * 30 + 2);
    // while the animation runs, the frame time is the elapsed time of the tick (60 Hz ticks, every other one painted)
    expect(painted[1]).toBeCloseTo(1 / 30, 1);
    expect(painted[30]).toBeCloseTo(1, 1);
  });

  it("holds the last picture briefly and then stops", () => {
    const { endedAt } = run(1, 30);
    expect(endedAt).toBeGreaterThanOrEqual(1000 + 150);
    expect(endedAt).toBeLessThan(1000 + 150 + 50);
  });

  it("does not skip frames when the display's frame times do not divide the frame interval", () => {
    const { painted } = run(1, 30, 33); // ticks every 33 ms, a hair under 1 / 30 s
    expect(painted.length).toBeGreaterThanOrEqual(30);
    const { painted: p144 } = run(1, 30, 1000 / 144);
    expect(p144.length).toBeGreaterThanOrEqual(1 * 30 - 3);
    expect(p144.length).toBeLessThanOrEqual((1 + 0.2) * 30 + 3);
  });

  it("paints every tick when the display is slower than the frame rate", () => {
    const { painted } = run(1, 30, 100);
    expect(painted.length).toBeGreaterThanOrEqual(10);
    expect(painted[1]).toBeCloseTo(0.1, 5);
  });

  it("holds still across a long gap instead of skipping the animation", () => {
    const clock = new RecordingClock(10, 30);
    let now = 1000;
    let before = 0;
    for (let i = 0; i < 60; i++, now += 1000 / 60) before = clock.tick(now).time; // 1 s in
    expect(before).toBeCloseTo(1, 1);
    expect(clock.stalled).toBe(false);
    now += 20_000; // the tab was in the background for 20 s
    const after = clock.tick(now);
    expect(clock.stalled).toBe(true);
    expect(after.time).toBeGreaterThanOrEqual(before);
    expect(after.time).toBeLessThan(before + 0.2); // carries on from where it stopped
    expect(after.done).toBe(false);
    expect(clock.recordedSeconds).toBeGreaterThan(20); // but the file really is that long
  });

  it("ignores the ordinary hiccups of a busy page", () => {
    const clock = new RecordingClock(10, 30);
    clock.tick(0);
    clock.tick(16);
    const t = clock.tick(16 + 400); // a 400 ms hiccup is not a stall
    expect(clock.stalled).toBe(false);
    expect(t.time).toBeCloseTo(0.416, 3);
  });

  it("handles an animation of no length", () => {
    const clock = new RecordingClock(0, 30);
    expect(clock.tick(0)).toMatchObject({ time: 0, paint: true, done: false });
    expect(clock.tick(500)).toMatchObject({ time: 0, done: true });
  });

  it("reports how long the recording really was", () => {
    const clock = new RecordingClock(1, 30);
    expect(clock.recordedSeconds).toBe(0);
    clock.tick(1000);
    clock.tick(3500);
    expect(clock.recordedSeconds).toBe(2.5);
  });
});

/* ------------------------------------------------------------------ */
/* the WebM duration patch (webm.ts) */
/* ------------------------------------------------------------------ */

/* ---- a tiny EBML builder and reader, independent of the code under test except for the size encoding it shares ---- */

const bytes = (...values: number[]) => Uint8Array.from(values);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** id bytes + size + payload */
const element = (id: number[], payload: Uint8Array, unknownSize = false) =>
  concat(Uint8Array.from(id), unknownSize ? bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff) : encodeEbmlSize(payload.length), payload);

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  segment: [0x18, 0x53, 0x80, 0x67],
  info: [0x15, 0x49, 0xa9, 0x66],
  scale: [0x2a, 0xd7, 0xb1],
  muxing: [0x4d, 0x80],
  writing: [0x57, 0x41],
  duration: [0x44, 0x89],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  seekHead: [0x11, 0x4d, 0x9b, 0x74],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  timecode: [0xe7],
  block: [0xa3],
  void: [0xec],
};

const scaleElement = (ns: number) => element(ID.scale, bytes((ns >> 16) & 255, (ns >> 8) & 255, ns & 255));

interface Options {
  segmentUnknown?: boolean;
  infoChildren?: Uint8Array[];
  seekHead?: boolean;
  noInfo?: boolean;
  clusters?: number;
}

function webm(o: Options = {}): Uint8Array {
  const ebml = element(ID.ebml, concat(element([0x42, 0x82], ascii("webm")), element([0x42, 0x87], bytes(4))));
  const info = element(ID.info, concat(...(o.infoChildren ?? [scaleElement(1_000_000), element(ID.muxing, ascii("libwebm-0.2.1.0")), element(ID.writing, ascii("Chrome"))])));
  const tracks = element(ID.tracks, ascii("track data goes here"));
  const clusters = Array.from({ length: o.clusters ?? 2 }, (_v, i) => element(ID.cluster, concat(element(ID.timecode, bytes(i)), element(ID.block, ascii(`frame ${i}`))), true));
  const children = concat(...(o.seekHead ? [element(ID.seekHead, ascii("seek entries"))] : []), ...(o.noInfo ? [] : [info]), tracks, ...clusters);
  return concat(ebml, element(ID.segment, children, o.segmentUnknown ?? true));
}

interface Parsed {
  id: number;
  at: number;
  size: number;
  unknown: boolean;
  dataAt: number;
}

/** Byte length of a variable length integer from its first byte (throws on the invalid all-zero patterns). */
function vintLength(first: number | undefined, max: number): number {
  for (let length = 1; length <= max; length++) if ((first ?? 0) & (0x100 >> length)) return length;
  throw new Error(`invalid variable length integer starting with ${first}`);
}

/** Reads the elements directly inside [from, to). */
function children(data: Uint8Array, from: number, to: number): Parsed[] {
  const out: Parsed[] = [];
  let p = from;
  while (p < to) {
    const idLength = vintLength(data[p], 4);
    let id = 0;
    for (let i = 0; i < idLength; i++) id = id * 256 + data[p + i];
    const sizeAt = p + idLength;
    const sizeLength = vintLength(data[sizeAt], 8);
    let size = data[sizeAt] & (0xff >> sizeLength);
    let ones = size === 0xff >> sizeLength;
    for (let i = 1; i < sizeLength; i++) {
      size = size * 256 + data[sizeAt + i];
      if (data[sizeAt + i] !== 0xff) ones = false;
    }
    const dataAt = sizeAt + sizeLength;
    out.push({ id, at: p, size, unknown: ones, dataAt });
    p = ones ? to : dataAt + size;
  }
  return out;
}

/** Duration (in timecode ticks) found in the Info block of a file, or null. */
function durationOf(file: Uint8Array): number | null {
  const top = children(file, 0, file.length);
  const segment = top.find((e) => e.id === 0x18538067)!;
  const end = segment.unknown ? file.length : segment.dataAt + segment.size;
  const info = children(file, segment.dataAt, end).find((e) => e.id === 0x1549a966);
  if (!info) return null;
  const d = children(file, info.dataAt, info.dataAt + info.size).find((e) => e.id === 0x4489);
  if (!d) return null;
  expect(d.size).toBe(8);
  return new DataView(file.buffer, file.byteOffset + d.dataAt, 8).getFloat64(0, false);
}

const apply = (file: Uint8Array, seconds: number): Uint8Array | null => {
  const patch = patchWebmDuration(file.subarray(0, 8192), seconds);
  return patch ? concat(patch.patched, file.subarray(patch.consumed)) : null;
};

describe("encodeEbmlSize", () => {
  it("uses the fewest bytes and never produces the reserved all-ones value", () => {
    expect(Array.from(encodeEbmlSize(0))).toEqual([0x80]);
    expect(Array.from(encodeEbmlSize(11))).toEqual([0x8b]);
    expect(Array.from(encodeEbmlSize(126))).toEqual([0xfe]);
    expect(Array.from(encodeEbmlSize(127))).toEqual([0x40, 0x7f]); // 0xFF would mean "unknown"
    expect(Array.from(encodeEbmlSize(16382))).toEqual([0x7f, 0xfe]);
    expect(Array.from(encodeEbmlSize(16383))).toEqual([0x20, 0x3f, 0xff]);
  });

  it("keeps at least the length it is given", () => {
    expect(Array.from(encodeEbmlSize(5, 3))).toEqual([0x20, 0x00, 0x05]);
    expect(encodeEbmlSize(5, 8)).toHaveLength(8);
    expect(Array.from(encodeEbmlSize(1, 8))).toEqual([0x01, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("round-trips through a decoder", () => {
    const decode = (b: Uint8Array) => {
      const length = vintLength(b[0], 8);
      let value = b[0] & (0xff >> length);
      for (let i = 1; i < length; i++) value = value * 256 + b[i];
      return { value, length };
    };
    for (const v of [0, 1, 126, 127, 300, 16382, 16383, 2_097_150, 2_097_151, 123_456_789, 2 ** 40]) {
      const encoded = encodeEbmlSize(v);
      expect(decode(encoded), String(v)).toEqual({ value: v, length: encoded.length });
    }
  });
});

describe("patchWebmDuration", () => {
  it("adds a Duration to the Info block of a live recording and leaves the rest alone", () => {
    const file = webm();
    expect(durationOf(file)).toBeNull();
    const patched = apply(file, 16.6)!;
    expect(patched).not.toBeNull();
    expect(patched.length).toBe(file.length + 11);
    expect(durationOf(patched)).toBeCloseTo(16600, 6); // milliseconds: the default timecode scale is 1,000,000 ns
    // everything after the Info block is byte for byte what it was
    const tail = ascii("track data goes here");
    const hay = Array.from(patched).join(",");
    expect(hay.includes(Array.from(tail).join(","))).toBe(true);
    expect(Array.from(patched.subarray(patched.length - 30))).toEqual(Array.from(file.subarray(file.length - 30)));
    // the structure still parses: EBML header, then a Segment whose children are Info, Tracks and the clusters
    const top = children(patched, 0, patched.length);
    expect(top.map((e) => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const segment = top[1];
    expect(segment.unknown).toBe(true);
    const ids = children(patched, segment.dataAt, patched.length).map((e) => e.id);
    expect(ids.slice(0, 2)).toEqual([0x1549a966, 0x1654ae6b]);
  });

  it("grows a Segment of known size by exactly the bytes it added", () => {
    const file = webm({ segmentUnknown: false });
    const before = children(file, 0, file.length)[1];
    expect(before.unknown).toBe(false);
    const patched = apply(file, 5)!;
    const after = children(patched, 0, patched.length)[1];
    expect(after.size).toBe(before.size + 11);
    expect(after.dataAt + after.size).toBe(patched.length); // the Segment still ends with the file
    expect(durationOf(patched)).toBeCloseTo(5000, 6);
  });

  it("re-encodes the Info size when the extra bytes no longer fit its size field", () => {
    // an Info block of 120 bytes of children: 120 fits a one byte size, 131 does not
    const filler = element(ID.muxing, new Uint8Array(110).fill(0x41));
    const file = webm({ infoChildren: [scaleElement(1_000_000), filler], segmentUnknown: false });
    const info = children(file, children(file, 0, file.length)[1].dataAt, file.length).find((e) => e.id === 0x1549a966)!;
    expect(info.size).toBeLessThanOrEqual(126);
    expect(info.size + 11).toBeGreaterThan(126);
    const patched = apply(file, 2.5)!;
    expect(patched.length).toBe(file.length + 11 + 1); // one more byte for the wider size field
    const segment = children(patched, 0, patched.length)[1];
    expect(segment.dataAt + segment.size).toBe(patched.length);
    expect(durationOf(patched)).toBeCloseTo(2500, 6);
  });

  it("honours another timecode scale", () => {
    const file = webm({ infoChildren: [scaleElement(1000), element(ID.writing, ascii("x"))] }); // microsecond ticks
    expect(durationOf(apply(file, 2)!)).toBeCloseTo(2_000_000, 3);
  });

  it("assumes milliseconds when the file does not say", () => {
    const file = webm({ infoChildren: [element(ID.writing, ascii("x"))] });
    expect(durationOf(apply(file, 3)!)).toBeCloseTo(3000, 6);
  });

  it("does nothing to a file that already has a duration", () => {
    const withDuration = element(ID.duration, new Uint8Array(8));
    const file = webm({ infoChildren: [scaleElement(1_000_000), concat(Uint8Array.from(ID.duration), bytes(0x88), new Uint8Array(8))] });
    expect(withDuration.length).toBe(11);
    expect(patchWebmDuration(file, 4)).toBeNull();
  });

  it("refuses files whose byte offsets the extra bytes would break", () => {
    expect(patchWebmDuration(webm({ seekHead: true }), 4)).toBeNull();
  });

  it("refuses what is not a WebM, a missing Info block, a truncated head and nonsense lengths", () => {
    expect(patchWebmDuration(ascii("GIF89a not a webm at all"), 4)).toBeNull();
    expect(patchWebmDuration(new Uint8Array(0), 4)).toBeNull();
    expect(patchWebmDuration(webm({ noInfo: true }), 4)).toBeNull();
    const file = webm();
    const info = children(file, children(file, 0, file.length)[1].dataAt, file.length).find((e) => e.id === 0x1549a966)!;
    expect(patchWebmDuration(file.subarray(0, info.dataAt + 4), 4)).toBeNull(); // Info cut off
    expect(patchWebmDuration(file, 0)).toBeNull();
    expect(patchWebmDuration(file, -1)).toBeNull();
    expect(patchWebmDuration(file, Number.NaN)).toBeNull();
    expect(patchWebmDuration(file, Infinity)).toBeNull();
  });
});

describe("withWebmDuration", () => {
  it("returns a blob of the same type with the duration added", async () => {
    const file = webm();
    const blob = new Blob([file as BlobPart], { type: "video/webm" });
    const fixed = await withWebmDuration(blob, 12);
    expect(fixed.type).toBe("video/webm");
    expect(fixed.size).toBe(file.length + 11);
    expect(durationOf(new Uint8Array(await fixed.arrayBuffer()))).toBeCloseTo(12000, 6);
  });

  it("hands back the original blob when it cannot be patched", async () => {
    const blob = new Blob([ascii("not a webm")], { type: "video/webm" });
    expect(await withWebmDuration(blob, 12)).toBe(blob);
    const empty = new Blob([], { type: "video/webm" });
    expect(await withWebmDuration(empty, 12)).toBe(empty);
  });
});

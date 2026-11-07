import { describe, expect, it } from "vitest";
import { GIF_MAX_DELAY, GifEncoder, concatChunks, type GifEncoderOptions } from "./gif";
import { LZW_MAX_CODES, lzwEncode } from "./lzw";
import { ColorHistogram, ColorMapper, buildPalette } from "./palette";

/* ------------------------------------------------------------------ */
/* a small reference decoder, written from the GIF89a spec             */
/* ------------------------------------------------------------------ */

interface LzwResult {
  indices: Uint8Array;
  /** clear codes found after the first one: how often the encoder reset its dictionary */
  resets: number;
  /** the stream ended exactly where its data ended */
  exact: boolean;
}

/** Standard GIF LZW decoding, strict about everything an encoder can get wrong. */
function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): LzwResult {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int32Array(LZW_MAX_CODES);
  const suffix = new Uint8Array(LZW_MAX_CODES);
  const out = new Uint8Array(expected);
  const stack = new Uint8Array(LZW_MAX_CODES + 1);
  let outPos = 0;
  let width = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 0;
  let resets = -1;

  const firstOf = (code: number): number => {
    while (code >= clear) code = prefix[code];
    return code;
  };

  for (;;) {
    while (bitCount < width) {
      if (pos >= data.length) throw new Error("the code stream ended before the end-of-information code");
      bitBuffer |= data[pos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << width) - 1);
    bitBuffer >>>= width;
    bitCount -= width;

    if (code === clear) {
      resets++;
      width = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (resets < 0) throw new Error("the stream does not start with a clear code");
    if (prev === -1) {
      if (code >= clear) throw new Error(`the first code after a clear must be a literal, got ${code}`);
      if (outPos >= expected) throw new Error("more pixels than the image holds");
      out[outPos++] = code;
      prev = code;
      continue;
    }
    let sp = 0;
    let first: number;
    if (code > next) throw new Error(`code ${code} is beyond the next free entry ${next}`);
    if (code === next) {
      first = firstOf(prev); // the string being defined: previous string + its own first character
      stack[sp++] = first;
      let c = prev;
      while (c >= clear) {
        stack[sp++] = suffix[c];
        c = prefix[c];
      }
      stack[sp++] = c;
    } else {
      let c = code;
      while (c >= clear) {
        stack[sp++] = suffix[c];
        c = prefix[c];
      }
      stack[sp++] = c;
      first = c;
    }
    if (outPos + sp > expected) throw new Error("more pixels than the image holds");
    while (sp) out[outPos++] = stack[--sp];
    if (next < LZW_MAX_CODES) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if (next === 1 << width && width < 12) width++;
    }
    prev = code;
  }
  if (outPos !== expected) throw new Error(`decoded ${outPos} pixels, expected ${expected}`);
  return { indices: out, resets: Math.max(0, resets), exact: pos === data.length };
}

interface DecodedFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
  disposal: number;
  transparentIndex: number | null;
  indices: Uint8Array;
  resets: number;
  /** the picture on screen after this frame, as palette indices (frames drawn over each other, transparency honoured) */
  screen: Uint8Array;
}

interface DecodedGif {
  signature: string;
  width: number;
  height: number;
  screenPacked: number;
  tableSize: number;
  palette: Uint8Array;
  backgroundIndex: number;
  loop: { present: boolean; count: number };
  frames: DecodedFrame[];
  hasTrailer: boolean;
}

function decodeGif(bytes: Uint8Array): DecodedGif {
  let p = 0;
  const u8 = () => {
    if (p >= bytes.length) throw new Error("unexpected end of file");
    return bytes[p++];
  };
  const u16 = () => u8() | (u8() << 8);
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  p = 6;
  const width = u16();
  const height = u16();
  const screenPacked = u8();
  const backgroundIndex = u8();
  u8(); // pixel aspect ratio
  let tableSize = 0;
  let palette = new Uint8Array(0);
  if (screenPacked & 0x80) {
    tableSize = 1 << ((screenPacked & 7) + 1);
    palette = bytes.slice(p, p + tableSize * 3);
    p += tableSize * 3;
  }

  const subBlocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) {
      const len = u8();
      if (len === 0) break;
      for (let i = 0; i < len; i++) parts.push(u8());
    }
    return Uint8Array.from(parts);
  };

  const loop = { present: false, count: -1 };
  const frames: DecodedFrame[] = [];
  const screen = new Uint8Array(width * height).fill(0xff);
  let gce: { delay: number; disposal: number; transparent: number | null } | null = null;
  let hasTrailer: boolean;

  for (;;) {
    const marker = u8();
    if (marker === 0x3b) {
      hasTrailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        expect(u8()).toBe(4); // block size
        const packed = u8();
        const delay = u16();
        const index = u8();
        expect(u8()).toBe(0); // terminator
        gce = { delay, disposal: (packed >> 2) & 7, transparent: packed & 1 ? index : null };
      } else if (label === 0xff) {
        expect(u8()).toBe(11);
        const name = String.fromCharCode(...bytes.subarray(p, p + 11));
        p += 11;
        const data = subBlocks();
        if (name === "NETSCAPE2.0") {
          expect(data[0]).toBe(1);
          loop.present = true;
          loop.count = data[1] | (data[2] << 8);
        }
      } else {
        subBlocks(); // comment, plain text: skipped
      }
      continue;
    }
    if (marker !== 0x2c) throw new Error(`unknown block 0x${marker.toString(16)} at ${p - 1}`);
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const packed = u8();
    expect(packed & 0x80, "no local colour table").toBe(0);
    expect(packed & 0x40, "not interlaced").toBe(0);
    expect(x + w, "frame inside the screen").toBeLessThanOrEqual(width);
    expect(y + h, "frame inside the screen").toBeLessThanOrEqual(height);
    const minCodeSize = u8();
    const data = subBlocks();
    const decoded = lzwDecode(data, minCodeSize, w * h);
    expect(decoded.exact, "no bytes after the end-of-information code").toBe(true);
    const meta = gce ?? { delay: 0, disposal: 0, transparent: null };
    gce = null;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const v = decoded.indices[row * w + col];
        if (meta.transparent !== null && v === meta.transparent) continue;
        screen[(y + row) * width + x + col] = v;
      }
    }
    frames.push({
      x,
      y,
      w,
      h,
      delay: meta.delay,
      disposal: meta.disposal,
      transparentIndex: meta.transparent,
      indices: decoded.indices,
      resets: decoded.resets,
      screen: screen.slice(),
    });
  }
  return { signature, width, height, screenPacked, tableSize, palette, backgroundIndex, loop, frames, hasTrailer };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type RGB = readonly [number, number, number];

/** Deterministic pseudo random numbers (xorshift32). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function frameOf(w: number, h: number, colour: (x: number, y: number) => RGB): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colour(x, y);
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

const flat = (w: number, h: number, c: RGB) => frameOf(w, h, () => c);
const paletteOf = (...colours: RGB[]) => Uint8Array.from(colours.flat());

/** What a viewer shows after frame `n`: the screen indices turned into RGBA through the file's colour table. */
function rgbaOfScreen(gif: DecodedGif, frame: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gif.width * gif.height * 4);
  const screen = gif.frames[frame].screen;
  for (let i = 0; i < screen.length; i++) {
    expect(screen[i], `pixel ${i} was never painted`).not.toBe(0xff);
    out[i * 4] = gif.palette[screen[i] * 3];
    out[i * 4 + 1] = gif.palette[screen[i] * 3 + 1];
    out[i * 4 + 2] = gif.palette[screen[i] * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function encodeAll(options: GifEncoderOptions, frames: Array<{ rgba: Uint8ClampedArray; delay: number }>): { bytes: Uint8Array; encoder: GifEncoder } {
  const encoder = new GifEncoder(options);
  const chunks: Uint8Array[] = [];
  for (const f of frames) {
    encoder.addFrame(f.rgba, f.delay);
    chunks.push(...encoder.takeChunks());
  }
  chunks.push(...encoder.finish());
  return { bytes: concatChunks(chunks), encoder };
}

const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a as ArrayLike<number> as number[]).every((v, i) => v === b[i]);

function psnr(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const d = a[i + k] - b[i + k];
      sum += d * d;
      n++;
    }
  }
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / n));
}

/* ------------------------------------------------------------------ */
/* LZW                                                                 */
/* ------------------------------------------------------------------ */

describe("lzwEncode", () => {
  const roundTrip = (pixels: Uint8Array, minCodeSize: number): LzwResult => {
    const stream = lzwEncode(pixels, minCodeSize);
    expect(stream[0], "minimum code size byte").toBe(minCodeSize);
    // sub-blocks: every length is 1..255 and the data ends with a zero length block
    let p = 1;
    const data: number[] = [];
    for (;;) {
      const len = stream[p++];
      if (len === 0) break;
      expect(len).toBeLessThanOrEqual(255);
      for (let i = 0; i < len; i++) data.push(stream[p++]);
    }
    expect(p, "nothing follows the terminator").toBe(stream.length);
    const result = lzwDecode(Uint8Array.from(data), minCodeSize, pixels.length);
    expect(sameBytes(result.indices, pixels)).toBe(true);
    expect(result.exact).toBe(true);
    return result;
  };

  it("round-trips every length around each code-width change, for runs and for random data", () => {
    // all zeros grow the dictionary by one entry per code, so every length from 1 to 700 ends the stream
    // at a different dictionary size - including the sizes where the code width has just grown
    for (let minCodeSize = 2; minCodeSize <= 8; minCodeSize++) {
      for (let n = 1; n <= 700; n++) roundTrip(new Uint8Array(n), minCodeSize);
    }
    const next = rng(7);
    for (const alphabet of [2, 3, 4]) {
      for (let n = 1; n <= 400; n++)
        roundTrip(
          Uint8Array.from({ length: n }, () => Math.floor(next() * alphabet)),
          2,
        );
    }
  });

  it("round-trips lengths around the point where the 4096 entry dictionary fills up", () => {
    const next = rng(99);
    for (const alphabet of [4, 16, 256]) {
      const minCodeSize = Math.max(2, Math.ceil(Math.log2(alphabet)));
      for (const n of [4090, 4095, 4096, 4097, 4098, 6000, 8190, 8192, 8193, 12000]) {
        roundTrip(
          Uint8Array.from({ length: n }, () => Math.floor(next() * alphabet)),
          minCodeSize,
        );
      }
    }
  });

  it("resets the dictionary when it is full and keeps going", () => {
    const next = rng(1234);
    const noise = Uint8Array.from({ length: 60_000 }, () => Math.floor(next() * 200));
    const result = roundTrip(noise, 8);
    expect(result.resets).toBeGreaterThanOrEqual(3);
  });

  it("compresses long runs to almost nothing", () => {
    const stream = lzwEncode(new Uint8Array(1_000_000), 2);
    expect(stream.length).toBeLessThan(3000);
    roundTrip(new Uint8Array(1_000_000), 2);
  });

  it("handles an image with no pixels and rejects bad code sizes", () => {
    const empty = lzwEncode(new Uint8Array(0), 2);
    expect(Array.from(empty.slice(0, 2))).toEqual([2, expect.any(Number)]);
    expect(() => lzwEncode(new Uint8Array(4), 1)).toThrow(RangeError);
    expect(() => lzwEncode(new Uint8Array(4), 9)).toThrow(RangeError);
  });

  it("round-trips structured pictures: stripes, gradients and a checkerboard", () => {
    const w = 64;
    const h = 48;
    const pic = (f: (x: number, y: number) => number) => Uint8Array.from({ length: w * h }, (_v, i) => f(i % w, Math.floor(i / w)));
    roundTrip(
      pic((x) => (x >> 3) & 1),
      2,
    );
    roundTrip(
      pic((x, y) => (x + y) & 255),
      8,
    );
    roundTrip(
      pic((x, y) => ((x >> 2) + (y >> 2)) & 1),
      2,
    );
    roundTrip(
      pic((x, y) => Math.floor((x * 16) / w) + 16 * Math.floor((y * 8) / h)),
      7,
    );
  });
});

/* ------------------------------------------------------------------ */
/* container                                                           */
/* ------------------------------------------------------------------ */

describe("GifEncoder file structure", () => {
  const red: RGB = [255, 0, 0];
  const green: RGB = [0, 255, 0];
  const blue: RGB = [0, 0, 255];

  it("writes the GIF89a header, a global colour table and the infinite loop extension", () => {
    const { bytes } = encodeAll({ width: 20, height: 10, palette: paletteOf(red, green, blue) }, [
      { rgba: flat(20, 10, red), delay: 7 },
      { rgba: flat(20, 10, green), delay: 6 },
      { rgba: flat(20, 10, blue), delay: 12 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.signature).toBe("GIF89a");
    expect([gif.width, gif.height]).toEqual([20, 10]);
    // three colours plus the colour kept for "unchanged" need a 4 entry table (2 bits)
    expect(gif.tableSize).toBe(4);
    expect(gif.screenPacked).toBe(0x80 | (1 << 4) | 1);
    expect(Array.from(gif.palette.slice(0, 9))).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(gif.loop).toEqual({ present: true, count: 0 });
    expect(gif.hasTrailer).toBe(true);
    expect(bytes[bytes.length - 1]).toBe(0x3b);
    // the NETSCAPE2.0 block comes before the first image
    const text = String.fromCharCode(...bytes);
    expect(text.indexOf("NETSCAPE2.0")).toBeGreaterThan(0);
    expect(text.indexOf("NETSCAPE2.0")).toBeLessThan(bytes.indexOf(0x2c, 13 + 12));
  });

  it("stores the frame count and the delay of every frame", () => {
    const delays = [7, 6, 12];
    const { bytes, encoder } = encodeAll({ width: 8, height: 8, palette: paletteOf(red, green, blue) }, [
      { rgba: flat(8, 8, red), delay: delays[0] },
      { rgba: flat(8, 8, green), delay: delays[1] },
      { rgba: flat(8, 8, blue), delay: delays[2] },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(3);
    expect(gif.frames.map((f) => f.delay)).toEqual(delays);
    expect(encoder.frames).toBe(3);
    expect(encoder.duration).toBe(25);
    expect(gif.frames.every((f) => f.disposal === 1)).toBe(true);
  });

  it("reproduces flat colour frames exactly", () => {
    const sources = [flat(20, 10, red), flat(20, 10, green), flat(20, 10, blue)];
    const { bytes } = encodeAll(
      { width: 20, height: 10, palette: paletteOf(red, green, blue) },
      sources.map((rgba) => ({ rgba, delay: 5 })),
    );
    const gif = decodeGif(bytes);
    sources.forEach((src, i) => expect(sameBytes(rgbaOfScreen(gif, i), src), `frame ${i}`).toBe(true));
  });

  it("sizes the table for the palette: 2, 4, 16 and 256 entries", () => {
    const sized = (colours: number, delta = true) => {
      const pal = Uint8Array.from({ length: colours * 3 }, (_v, i) => (i * 7) & 255);
      return decodeGif(encodeAll({ width: 2, height: 2, palette: pal, delta }, [{ rgba: flat(2, 2, [pal[0], pal[1], pal[2]]), delay: 5 }]).bytes);
    };
    expect(sized(1).tableSize).toBe(2);
    expect(sized(2).tableSize).toBe(4);
    expect(sized(3).tableSize).toBe(4);
    expect(sized(15).tableSize).toBe(16);
    expect(sized(16).tableSize).toBe(32);
    expect(sized(255).tableSize).toBe(256);
    expect(sized(255).screenPacked).toBe(0xf7);
    expect(sized(256, false).tableSize).toBe(256);
    expect(sized(16, false).tableSize).toBe(16);
  });

  it("rejects what a GIF cannot hold", () => {
    const pal = paletteOf(red);
    expect(() => new GifEncoder({ width: 0, height: 5, palette: pal })).toThrow(RangeError);
    expect(() => new GifEncoder({ width: 70000, height: 5, palette: pal })).toThrow(RangeError);
    expect(() => new GifEncoder({ width: 5, height: 5, palette: new Uint8Array(256 * 3) })).toThrow(/255/);
    expect(() => new GifEncoder({ width: 5, height: 5, palette: new Uint8Array(257 * 3), delta: false })).toThrow(RangeError);
    const enc = new GifEncoder({ width: 4, height: 4, palette: pal });
    expect(() => enc.addFrame(new Uint8ClampedArray(10), 5)).toThrow(RangeError);
    enc.finish();
    expect(() => enc.addFrame(new Uint8ClampedArray(64), 5)).toThrow(/finished/);
  });

  it("writes a loop count when asked and clamps delays to what a GIF can store", () => {
    const { bytes } = encodeAll({ width: 2, height: 2, palette: paletteOf(red, green), loops: 3 }, [
      { rgba: flat(2, 2, red), delay: -4 },
      { rgba: flat(2, 2, green), delay: 999_999 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.loop.count).toBe(3);
    expect(gif.frames.map((f) => f.delay)).toEqual([0, GIF_MAX_DELAY]);
  });

  it("hands over finished bytes as it goes and the pieces add up to a valid file", () => {
    const encoder = new GifEncoder({ width: 16, height: 16, palette: paletteOf(red, green, blue) });
    const first = encoder.takeChunks();
    expect(first.length).toBeGreaterThan(0); // header, colour table, loop block are ready at once
    expect(encoder.takeChunks()).toEqual([]);
    encoder.addFrame(flat(16, 16, red), 5);
    encoder.addFrame(flat(16, 16, green), 5);
    const mid = encoder.takeChunks(); // the first frame is complete, the second still waits for its final delay
    const rest = encoder.finish();
    const whole = concatChunks([...first, ...mid, ...rest]);
    expect(decodeGif(whole).frames).toHaveLength(2);
    expect(encoder.byteLength).toBe(whole.length);
  });
});

/* ------------------------------------------------------------------ */
/* frame differencing                                                  */
/* ------------------------------------------------------------------ */

describe("frame differencing", () => {
  const colours: RGB[] = [
    [255, 255, 255],
    [0, 0, 0],
    [200, 30, 30],
    [30, 30, 200],
  ];
  const palette = paletteOf(...colours);
  const W = 40;
  const H = 30;
  const withBox = (x0: number, y0: number, x1: number, y1: number, c: RGB, base: RGB = colours[0]) =>
    frameOf(W, H, (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? c : base));

  it("writes only the rectangle around what changed, with the rest transparent", () => {
    const a = withBox(0, 0, -1, -1, colours[1]); // plain white
    const b = withBox(10, 5, 19, 14, colours[2]);
    const c = withBox(10, 5, 19, 14, colours[2]); // identical to b
    const d = withBox(12, 7, 30, 20, colours[3]);
    const { bytes } = encodeAll({ width: W, height: H, palette }, [
      { rgba: a, delay: 5 },
      { rgba: b, delay: 5 },
      { rgba: c, delay: 5 },
      { rgba: d, delay: 5 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(3); // b and c are one frame
    expect(gif.frames[0]).toMatchObject({ x: 0, y: 0, w: W, h: H, transparentIndex: null });
    expect(gif.frames[1]).toMatchObject({ x: 10, y: 5, w: 10, h: 10, delay: 10 });
    expect(gif.frames[1].transparentIndex).toBeNull(); // every pixel of the rectangle changed: nothing needs hiding
    // the third stored frame covers the old rectangle (it turns white again) and the new one, with gaps left transparent
    expect(gif.frames[2]).toMatchObject({ x: 10, y: 5, w: 21, h: 16, transparentIndex: 4 });
    const transparentCount = gif.frames[2].indices.filter((v) => v === 4).length;
    expect(transparentCount).toBeGreaterThan(0);
    [a, b, d].forEach((src, i) => expect(sameBytes(rgbaOfScreen(gif, i), src), `screen after stored frame ${i}`).toBe(true));
  });

  it("merges identical frames into one with the delays added", () => {
    const x = flat(10, 10, colours[2]);
    const y = flat(10, 10, colours[3]);
    const { bytes, encoder } = encodeAll({ width: 10, height: 10, palette }, [
      { rgba: x, delay: 7 },
      { rgba: x.slice(), delay: 6 },
      { rgba: x.slice(), delay: 7 },
      { rgba: y, delay: 10 },
      { rgba: y.slice(), delay: 4 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.frames.map((f) => f.delay)).toEqual([20, 14]);
    expect(encoder.frames).toBe(2);
    expect(encoder.duration).toBe(34); // the true time is untouched by the merging
  });

  it("treats a change that rounds to the same palette entries as no change", () => {
    const a = flat(10, 10, [200, 30, 30]);
    const b = flat(10, 10, [201, 30, 30]); // not a palette colour, but its nearest entry is the same
    const { bytes } = encodeAll({ width: 10, height: 10, palette, dither: false }, [
      { rgba: a, delay: 5 },
      { rgba: b, delay: 5 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(1);
    expect(gif.frames[0].delay).toBe(10);
  });

  it("splits a very long still frame instead of overflowing the 16 bit delay", () => {
    const x = flat(6, 6, colours[2]);
    const { bytes, encoder } = encodeAll({ width: 6, height: 6, palette }, [
      { rgba: x, delay: 40_000 },
      { rgba: x.slice(), delay: 40_000 },
      { rgba: x.slice(), delay: 60_000 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.frames.reduce((sum, f) => sum + f.delay, 0)).toBe(140_000);
    expect(Math.max(...gif.frames.map((f) => f.delay))).toBeLessThanOrEqual(GIF_MAX_DELAY);
    expect(encoder.duration).toBe(140_000);
    // the filler frames change nothing
    gif.frames.forEach((_f, i) => expect(sameBytes(rgbaOfScreen(gif, i), x), `screen ${i}`).toBe(true));
  });

  it("writes complete frames when differencing is off, and still merges identical ones", () => {
    const a = withBox(0, 0, -1, -1, colours[1]);
    const b = withBox(10, 5, 19, 14, colours[2]);
    const { bytes } = encodeAll({ width: W, height: H, palette, delta: false }, [
      { rgba: a, delay: 5 },
      { rgba: b, delay: 5 },
      { rgba: b.slice(), delay: 5 },
    ]);
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(2);
    expect(gif.frames.every((f) => f.x === 0 && f.y === 0 && f.w === W && f.h === H && f.transparentIndex === null)).toBe(true);
    expect(sameBytes(rgbaOfScreen(gif, 1), b)).toBe(true);
    expect(gif.tableSize).toBe(4);
  });

  it("keeps working when the caller reuses one buffer for every frame", () => {
    const shared = new Uint8ClampedArray(W * H * 4);
    const encoder = new GifEncoder({ width: W, height: H, palette });
    const sources = [withBox(0, 0, -1, -1, colours[1]), withBox(3, 3, 12, 9, colours[2]), withBox(8, 8, 25, 25, colours[3])];
    for (const src of sources) {
      shared.set(src);
      encoder.addFrame(shared, 5);
    }
    const gif = decodeGif(concatChunks([...encoder.takeChunks(), ...encoder.finish()]));
    expect(gif.frames).toHaveLength(3);
    sources.forEach((src, i) => expect(sameBytes(rgbaOfScreen(gif, i), src), `frame ${i}`).toBe(true));
  });

  it("accepts pixel data that does not start on a 4 byte boundary", () => {
    const src = withBox(2, 2, 9, 9, colours[2]);
    const padded = new Uint8Array(src.length + 3);
    padded.set(src, 3);
    const offset = padded.subarray(3);
    const { bytes } = encodeAll({ width: W, height: H, palette }, [{ rgba: offset as unknown as Uint8ClampedArray, delay: 5 }]);
    expect(sameBytes(rgbaOfScreen(decodeGif(bytes), 0), src)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* the pictures the brief asks for: flat, gradient, noise              */
/* ------------------------------------------------------------------ */

describe("GifEncoder pictures", () => {
  it("reproduces a gradient of palette colours exactly, even where colours share a 5 bit bucket", () => {
    const greys: RGB[] = Array.from({ length: 100 }, (_v, i) => [i * 2, i * 2, i * 2] as RGB); // neighbours are in the same bucket
    const w = 100;
    const h = 20;
    const src = frameOf(w, h, (x) => greys[x]);
    const { bytes } = encodeAll({ width: w, height: h, palette: paletteOf(...greys) }, [{ rgba: src, delay: 5 }]);
    const gif = decodeGif(bytes);
    expect(gif.tableSize).toBe(128);
    expect(sameBytes(rgbaOfScreen(gif, 0), src)).toBe(true);
  });

  it("reproduces noise exactly and survives the dictionary resets it forces", () => {
    const next = rng(2024);
    const noise: RGB[] = Array.from({ length: 200 }, (_v, i) => [(i * 53) & 255, (i * 97) & 255, (i * 193 + 7) & 255] as RGB);
    const w = 220;
    const h = 180;
    const pick = Array.from({ length: w * h }, () => Math.floor(next() * noise.length));
    const src = frameOf(w, h, (x, y) => noise[pick[y * w + x]]);
    const { bytes } = encodeAll({ width: w, height: h, palette: paletteOf(...noise) }, [{ rgba: src, delay: 5 }]);
    const gif = decodeGif(bytes);
    expect(gif.frames[0].resets).toBeGreaterThanOrEqual(3); // 39,600 random pixels cannot fit one dictionary
    expect(sameBytes(rgbaOfScreen(gif, 0), src)).toBe(true);
  });

  it("follows a short animation of moving noise frame by frame", () => {
    const next = rng(5);
    const colours: RGB[] = Array.from({ length: 64 }, (_v, i) => [i * 4, 255 - i * 4, (i * 29) & 255] as RGB);
    const w = 60;
    const h = 40;
    const base = Array.from({ length: w * h }, () => Math.floor(next() * colours.length));
    const frames = [0, 1, 2, 3].map((t) => frameOf(w, h, (x, y) => colours[(base[y * w + x] + (x < 10 * (t + 1) ? t : 0)) % colours.length]));
    const { bytes } = encodeAll(
      { width: w, height: h, palette: paletteOf(...colours) },
      frames.map((rgba) => ({ rgba, delay: 4 })),
    );
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(4);
    frames.forEach((src, i) => expect(sameBytes(rgbaOfScreen(gif, i), src), `frame ${i}`).toBe(true));
  });

  it("quantises a photographic picture with a median cut palette and dithering", () => {
    const w = 160;
    const h = 120;
    const next = rng(11);
    // a smooth colour field with a little grain: far more than 256 distinct colours
    const src = frameOf(w, h, (x, y) => {
      const grain = (next() - 0.5) * 6;
      return [Math.round(40 + (x / w) * 180 + grain), Math.round(60 + (y / h) * 140 + grain), Math.round(200 - (x / w) * 120 + (y / h) * 30 + grain)].map((v) =>
        Math.min(255, Math.max(0, v)),
      ) as unknown as RGB;
    });
    const hist = new ColorHistogram();
    hist.addFrame(src);
    expect(hist.distinct).toBeGreaterThan(256);
    const palette = buildPalette(hist, 255);
    expect(palette.length / 3).toBe(255);
    const dithered = decodeGif(encodeAll({ width: w, height: h, palette, dither: true }, [{ rgba: src, delay: 5 }]).bytes);
    const plain = decodeGif(encodeAll({ width: w, height: h, palette, dither: false }, [{ rgba: src, delay: 5 }]).bytes);
    expect(psnr(src, rgbaOfScreen(plain, 0))).toBeGreaterThan(33);
    expect(psnr(src, rgbaOfScreen(dithered, 0))).toBeGreaterThan(28); // dithering trades a little accuracy for no banding
  });

  it("is deterministic: the same frames give the same bytes", () => {
    const palette = paletteOf([255, 255, 255], [0, 0, 0], [180, 40, 90]);
    const frames = [0, 1, 2].map((t) => ({ rgba: frameOf(30, 20, (x, y) => (x + t * 5 > y ? [180, 40, 90] : [255, 255, 255])), delay: 6 }));
    const a = encodeAll({ width: 30, height: 20, palette }, frames).bytes;
    const b = encodeAll({ width: 30, height: 20, palette }, frames).bytes;
    expect(sameBytes(a, b)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* palette                                                             */
/* ------------------------------------------------------------------ */

describe("buildPalette", () => {
  const histogramOf = (...frames: Uint8ClampedArray[]) => {
    const h = new ColorHistogram();
    frames.forEach((f) => h.addFrame(f));
    return h;
  };

  it("gives a few flat colours back exactly", () => {
    const colours: RGB[] = [
      [124, 58, 237],
      [18, 194, 185],
      [255, 255, 255],
      [14, 19, 24],
    ];
    const frame = frameOf(8, 4, (x) => colours[x % 4]);
    const palette = buildPalette(histogramOf(frame), 255);
    const found = new Set<string>();
    for (let i = 0; i < palette.length; i += 3) found.add(`${palette[i]},${palette[i + 1]},${palette[i + 2]}`);
    colours.forEach((c) => expect(found.has(c.join(",")), c.join(",")).toBe(true));
    expect(palette.length / 3).toBe(4);
  });

  it("never returns more colours than asked for, and counts every frame it was given", () => {
    const next = rng(3);
    const a = frameOf(100, 100, () => [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)]);
    const b = frameOf(100, 100, () => [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)]);
    const hist = histogramOf(a, b);
    expect(hist.pixels).toBe(20000);
    for (const limit of [2, 16, 100, 255, 256]) {
      const palette = buildPalette(hist, limit);
      expect(palette.length / 3).toBeLessThanOrEqual(limit);
      expect(palette.length / 3).toBeGreaterThanOrEqual(Math.min(limit, 2));
      expect(palette.length % 3).toBe(0);
    }
    expect(buildPalette(hist, 256).length / 3).toBe(256);
  });

  it("falls back to a single black entry when nothing was sampled", () => {
    expect(Array.from(buildPalette(new ColorHistogram(), 255))).toEqual([0, 0, 0]);
  });

  it("represents a colour that covers most of the picture better than a rare one", () => {
    // 96% of the picture is one bluish grey, the rest is a spread of colours
    const next = rng(8);
    const frame = frameOf(100, 100, (x, y) => (y < 96 ? [90, 100, 120] : [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)]));
    const palette = buildPalette(histogramOf(frame), 8);
    const mapper = new ColorMapper(palette);
    const dominant = mapper.index(90, 100, 120);
    expect(Math.abs(palette[dominant * 3] - 90)).toBeLessThanOrEqual(8);
    expect(Math.abs(palette[dominant * 3 + 1] - 100)).toBeLessThanOrEqual(8);
    expect(Math.abs(palette[dominant * 3 + 2] - 120)).toBeLessThanOrEqual(8);
  });

  it("subsamples with a step", () => {
    const frame = flat(10, 10, [1, 2, 3]);
    const h = new ColorHistogram();
    h.addFrame(frame, 4);
    expect(h.pixels).toBe(25);
  });
});

describe("ColorMapper", () => {
  it("maps a colour that is in the palette to itself, even when others share its bucket", () => {
    const pal = paletteOf([10, 10, 10], [12, 12, 12], [14, 14, 14], [200, 0, 0]);
    const m = new ColorMapper(pal);
    expect(m.index(10, 10, 10)).toBe(0);
    expect(m.index(12, 12, 12)).toBe(1);
    expect(m.index(14, 14, 14)).toBe(2);
    expect(m.index(200, 0, 0)).toBe(3);
    // the same answers after the cache has been filled by a nearby colour
    expect(m.index(11, 11, 11)).toBeGreaterThanOrEqual(0);
    expect(m.index(12, 12, 12)).toBe(1);
  });

  it("finds the nearest entry for colours that are not in the palette", () => {
    const m = new ColorMapper(paletteOf([0, 0, 0], [255, 255, 255], [255, 0, 0]));
    expect(m.index(10, 10, 10)).toBe(0);
    expect(m.index(240, 250, 245)).toBe(1);
    expect(m.index(230, 20, 10)).toBe(2);
    expect(m.nearest(100, 100, 100)).toBe(0);
  });

  it("keeps duplicate palette colours on their first entry", () => {
    const m = new ColorMapper(paletteOf([5, 5, 5], [5, 5, 5], [9, 9, 9]));
    expect(m.index(5, 5, 5)).toBe(0);
  });

  it("leaves colours the palette matches alone and spreads the rest over the two nearest entries", () => {
    const m = new ColorMapper(paletteOf([0, 0, 0], [40, 40, 40], [80, 80, 80], [255, 255, 255]));
    // exact colours never move
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) expect(m.indexDithered(40, 40, 40, x, y)).toBe(1);
    // a grey halfway between two entries is split between them in a fixed pattern, roughly half and half
    const used = new Map<number, number>();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = m.indexDithered(60, 60, 60, x, y);
        used.set(i, (used.get(i) ?? 0) + 1);
      }
    }
    expect([...used.keys()].sort()).toEqual([1, 2]);
    expect(used.get(1)).toBeGreaterThanOrEqual(20);
    expect(used.get(2)).toBeGreaterThanOrEqual(20);
    // and the pattern does not depend on anything but the position
    expect(m.indexDithered(60, 60, 60, 3, 5)).toBe(m.indexDithered(60, 60, 60, 3 + 8, 5 + 16));
  });

  it("rejects an empty or oversized palette", () => {
    expect(() => new ColorMapper(new Uint8Array(0))).toThrow(RangeError);
    expect(() => new ColorMapper(new Uint8Array(257 * 3))).toThrow(RangeError);
  });
});

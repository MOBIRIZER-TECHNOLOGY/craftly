/**
 * An animated GIF (GIF89a) encoder with no dependencies, built to be fed one frame at a time:
 *
 *   const encoder = new GifEncoder({ width, height, palette });
 *   encoder.addFrame(imageData.data, delayCentiseconds);   // as many times as there are frames
 *   const parts = [...encoder.takeChunks(), ...encoder.finish()];
 *
 * - One global palette (see `palette.ts`), the NETSCAPE2.0 extension so the loop never stops, a delay per frame.
 * - Only what changed is stored. A frame is compared with the one before it; pixels that look the same become a
 *   reserved transparent colour and only the rectangle around the changes is written (disposal "leave in place", so
 *   the viewer keeps the previous picture underneath). A frame identical to the previous one is not written at all:
 *   its delay is added to the previous frame instead. A page that sits still for five seconds therefore costs one
 *   frame, however high the frame rate.
 * - Memory stays flat: the encoder keeps the previous frame (as pixels and as indices) and the bytes produced so
 *   far; `takeChunks` hands finished bytes over so the caller can move them to a Blob while encoding goes on.
 *
 * Frame delays are in centiseconds, the unit a GIF stores. Browsers show a delay of 0 or 1 as 10 (a quirk inherited
 * from old banner ads), so callers should stay at 2 or more, which every frame rate up to 50 fps does.
 */
import { lzwEncode } from "./lzw";
import { ColorMapper } from "./palette";

export const GIF_MAX_DELAY = 0xffff;

export interface GifEncoderOptions {
  width: number;
  height: number;
  /**
   * Global colour table as RGB triplets. At most 255 colours when `delta` is on (one more entry is kept for the
   * transparent colour), 256 otherwise.
   */
  palette: Uint8Array;
  /** How many times the animation plays; 0 (the default) means forever. */
  loops?: number;
  /** Ordered dithering of colours the palette cannot match closely (default true). */
  dither?: boolean;
  /** Store only the changed part of each frame (default true). */
  delta?: boolean;
}

interface PendingFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** the frame uses the transparent colour */
  transparent: boolean;
  delay: number;
  data: Uint8Array;
}

const u16 = (out: number[], v: number) => out.push(v & 0xff, (v >> 8) & 0xff);

// Where the red, green and blue bytes of an RGBA pixel sit in a 32 bit word read from canvas data (little endian on
// every browser that matters, but the other order costs nothing to support).
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const SHIFT_R = LITTLE_ENDIAN ? 0 : 24;
const SHIFT_G = LITTLE_ENDIAN ? 8 : 16;
const SHIFT_B = LITTLE_ENDIAN ? 16 : 8;

export class GifEncoder {
  readonly width: number;
  readonly height: number;
  /** entries in the global colour table (a power of two, 2..256) */
  readonly tableSize: number;
  /** index of the colour reserved for "unchanged", -1 when `delta` is off */
  readonly transparentIndex: number;

  private readonly minCodeSize: number;
  private readonly mapper: ColorMapper;
  private readonly dither: boolean;
  private readonly delta: boolean;
  private chunks: Uint8Array[] = [];
  private pending: PendingFrame | null = null;
  private previousPixels: Uint32Array | null = null;
  private previousIndices: Uint8Array;
  private done = false;
  private bytes = 0;
  private centiseconds = 0;
  private frameCount = 0;

  constructor(options: GifEncoderOptions) {
    const { width, height, palette } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
      throw new RangeError("A GIF is 1 to 65535 pixels wide and high.");
    }
    this.width = width;
    this.height = height;
    this.dither = options.dither !== false;
    this.delta = options.delta !== false;
    const colours = Math.floor(palette.length / 3) || 1;
    const needed = colours + (this.delta ? 1 : 0);
    if (needed > 256) throw new RangeError(this.delta ? "With frame differencing a GIF palette holds at most 255 colours." : "A GIF palette holds at most 256 colours.");
    let bits = 1;
    while (1 << bits < needed) bits++;
    this.tableSize = 1 << bits;
    this.minCodeSize = Math.max(2, bits);
    this.transparentIndex = this.delta ? colours : -1;
    this.mapper = new ColorMapper(palette.length >= 3 ? palette.subarray(0, colours * 3) : new Uint8Array(3));
    this.previousIndices = new Uint8Array(width * height);

    const header: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
    u16(header, width);
    u16(header, height);
    // global colour table present, colour resolution and table size both `bits`, not sorted
    header.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
    const table = new Uint8Array(this.tableSize * 3);
    table.set(palette.subarray(0, colours * 3));
    // NETSCAPE2.0 application extension: loop count (0 = forever)
    const loops = Math.max(0, Math.min(0xffff, Math.floor(options.loops ?? 0)));
    const loop: number[] = [0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)), 0x03, 0x01];
    u16(loop, loops);
    loop.push(0x00);
    this.push(new Uint8Array(header));
    this.push(table);
    this.push(new Uint8Array(loop));
  }

  /** Frames that will be in the file (identical neighbours count once). */
  get frames(): number {
    return this.frameCount;
  }

  /** Bytes produced so far, not counting the frame still waiting for its final delay. */
  get byteLength(): number {
    return this.bytes;
  }

  /** Total playing time of the frames added so far, in centiseconds. */
  get duration(): number {
    return this.centiseconds;
  }

  private push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
  }

  /** The bytes finished since the last call, in order. */
  takeChunks(): Uint8Array[] {
    const out = this.chunks;
    this.chunks = [];
    return out;
  }

  /**
   * Adds a frame of `width x height` RGBA pixels (alpha is ignored) that stays on screen for `delayCs`
   * centiseconds. The pixels are copied if they are needed later, so the caller may reuse its buffer.
   */
  addFrame(rgba: Uint8ClampedArray | Uint8Array, delayCs: number): void {
    if (this.done) throw new Error("The GIF is already finished.");
    const w = this.width;
    const h = this.height;
    if (rgba.length < w * h * 4) throw new RangeError("The frame has fewer pixels than the GIF is wide and high.");
    const delay = Math.max(0, Math.min(GIF_MAX_DELAY, Math.round(delayCs)));
    this.centiseconds += delay;

    // a Uint32Array view needs 4 byte alignment; canvas data always has it
    const bytes = rgba.byteOffset % 4 === 0 ? rgba : rgba.slice();
    const pixels = new Uint32Array(bytes.buffer, bytes.byteOffset, w * h);
    const previous = this.previousPixels;
    const first = previous === null;

    // the rectangle around the pixels whose colour changed
    let x0 = 0;
    let y0 = 0;
    let x1 = w - 1;
    let y1 = h - 1;
    if (previous) {
      x0 = w;
      x1 = -1;
      y0 = h;
      y1 = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let a = 0;
        while (a < w && pixels[row + a] === previous[row + a]) a++;
        if (a === w) continue;
        let b = w - 1;
        while (pixels[row + b] === previous[row + b]) b--;
        if (y < y0) y0 = y;
        y1 = y;
        if (a < x0) x0 = a;
        if (b > x1) x1 = b;
      }
      if (x1 < 0) {
        this.extendPending(delay); // identical to the last frame: it simply stays up longer
        return;
      }
      if (!this.delta) {
        x0 = 0;
        y0 = 0;
        x1 = w - 1;
        y1 = h - 1;
      }
    }

    // quantise the changed region; unchanged pixels inside it become the transparent colour
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;
    const region = new Uint8Array(rw * rh);
    const useDelta = this.delta && !first;
    const transparent = this.transparentIndex;
    const indices = this.previousIndices;
    const mapper = this.mapper;
    const dither = this.dither;
    let minX = rw;
    let maxX = -1;
    let minY = rh;
    let maxY = -1;
    let sawTransparent = false;
    for (let y = 0; y < rh; y++) {
      const source = (y0 + y) * w + x0;
      const target = y * rw;
      for (let x = 0; x < rw; x++) {
        const at = source + x;
        const word = pixels[at];
        if (useDelta && word === previous![at]) {
          region[target + x] = transparent;
          sawTransparent = true;
          continue;
        }
        const r = (word >>> SHIFT_R) & 0xff;
        const g = (word >>> SHIFT_G) & 0xff;
        const b = (word >>> SHIFT_B) & 0xff;
        const index = dither ? mapper.indexDithered(r, g, b, x0 + x, y0 + y) : mapper.index(r, g, b);
        if (useDelta && index === indices[at]) {
          region[target + x] = transparent; // the colour changed a little, but not enough to change the palette entry
          sawTransparent = true;
          continue;
        }
        indices[at] = index;
        region[target + x] = index;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (previous) previous.set(pixels);
    else this.previousPixels = pixels.slice();

    if (useDelta && maxX < 0) {
      this.extendPending(delay); // every change rounded to the same palette entries
      return;
    }

    let data = region;
    let fx = x0;
    let fy = y0;
    let fw = rw;
    let fh = rh;
    if (useDelta && (minX > 0 || minY > 0 || maxX < rw - 1 || maxY < rh - 1)) {
      // crop to the pixels that really changed
      fw = maxX - minX + 1;
      fh = maxY - minY + 1;
      fx = x0 + minX;
      fy = y0 + minY;
      data = new Uint8Array(fw * fh);
      for (let y = 0; y < fh; y++) {
        const from = (minY + y) * rw + minX;
        data.set(region.subarray(from, from + fw), y * fw);
      }
    }

    this.flushPending();
    this.pending = { x: fx, y: fy, w: fw, h: fh, transparent: useDelta && sawTransparent, delay, data: lzwEncode(data, this.minCodeSize) };
    this.frameCount++;
  }

  /** Adds `delay` centiseconds to the frame on screen, splitting off a one pixel frame when it would overflow. */
  private extendPending(delay: number): void {
    const frame = this.pending;
    if (!frame) return;
    let rest = delay;
    while (frame.delay + rest > GIF_MAX_DELAY) {
      rest -= GIF_MAX_DELAY - frame.delay;
      frame.delay = GIF_MAX_DELAY;
      this.flushPending();
      // a delay is a 16 bit number: carry on with a 1 x 1 frame that changes nothing (transparent, or the pixel's own colour)
      const transparent = this.transparentIndex >= 0;
      const pixel = transparent ? this.transparentIndex : this.previousIndices[0];
      this.pending = { x: 0, y: 0, w: 1, h: 1, transparent, delay: 0, data: lzwEncode(new Uint8Array([pixel]), this.minCodeSize) };
      this.frameCount++;
      return this.extendPending(rest);
    }
    frame.delay += rest;
  }

  private flushPending(): void {
    const f = this.pending;
    if (!f) return;
    this.pending = null;
    const head: number[] = [
      0x21,
      0xf9,
      0x04,
      (1 << 2) | (f.transparent ? 1 : 0), // disposal 1: leave the frame in place
    ];
    u16(head, f.delay);
    head.push(f.transparent ? this.transparentIndex : 0, 0x00);
    head.push(0x2c);
    u16(head, f.x);
    u16(head, f.y);
    u16(head, f.w);
    u16(head, f.h);
    head.push(0x00); // no local colour table, not interlaced
    this.push(new Uint8Array(head));
    this.push(f.data);
  }

  /** Ends the file. Returns the bytes not yet taken (the last frame and the trailer). */
  finish(): Uint8Array[] {
    if (!this.done) {
      this.flushPending();
      this.push(new Uint8Array([0x3b]));
      this.done = true;
    }
    return this.takeChunks();
  }
}

/** All the bytes of a finished GIF in one array (tests and small animations; exports keep the chunks as a Blob). */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const c of chunks) size += c.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * GIF flavoured LZW: codes start `minCodeSize + 1` bits wide and grow to 12 bits as the dictionary fills, a clear
 * code starts every dictionary and an end-of-information code closes the stream. When all 4096 codes are taken the
 * encoder emits a clear code and starts over, so any amount of data can be compressed.
 *
 * The result is the whole "table based image data" part of a GIF image: the minimum code size byte, the codes packed
 * LSB first into sub-blocks of at most 255 bytes, and the zero length block that ends them.
 *
 * Code width follows the decoder, which learns one dictionary entry later than the encoder adds it: after the
 * encoder adds entry N it must widen the next code as soon as N + 1 no longer fits in the current width.
 */

export const LZW_MAX_CODES = 4096;

const HASH_BITS = 13;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const HASH_SHIFT = 32 - HASH_BITS;

// The dictionary is an open addressing hash table keyed by `prefix code << 8 | next pixel` (at most 4096 entries in
// 8192 slots, so probes stay short). Encoding is synchronous, so one pair of tables serves every call and a frame
// allocates nothing but its output.
const hashKeys = new Int32Array(HASH_SIZE);
const hashCodes = new Uint16Array(HASH_SIZE);

/** Packs codes into bytes and bytes into GIF sub-blocks (a length byte, then up to 255 bytes of data). */
class BlockWriter {
  buf: Uint8Array;
  pos: number;
  /** where the length byte of the sub-block being filled lives */
  private blockAt: number;
  private blockLen = 0;
  private acc = 0;
  private bits = 0;

  constructor(minCodeSize: number, capacity: number) {
    this.buf = new Uint8Array(Math.max(256, capacity));
    this.buf[0] = minCodeSize;
    this.blockAt = 1;
    this.pos = 2;
  }

  put(code: number, width: number): void {
    this.acc |= code << this.bits;
    this.bits += width;
    while (this.bits >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.bits -= 8;
    }
  }

  private byte(value: number): void {
    if (this.pos + 2 > this.buf.length) this.grow();
    this.buf[this.pos++] = value;
    if (++this.blockLen === 255) {
      this.buf[this.blockAt] = 255;
      this.blockAt = this.pos++; // the next sub-block's length byte, filled in when that block closes
      this.blockLen = 0;
    }
  }

  private grow(): void {
    const next = new Uint8Array(this.buf.length * 2);
    next.set(this.buf);
    this.buf = next;
  }

  finish(): Uint8Array {
    if (this.bits > 0) this.byte(this.acc & 0xff);
    if (this.blockLen === 0) {
      // the length byte reserved for a block that never got any data is the terminator
      this.buf[this.blockAt] = 0;
      this.pos = this.blockAt + 1;
    } else {
      this.buf[this.blockAt] = this.blockLen;
      if (this.pos + 1 > this.buf.length) this.grow();
      this.buf[this.pos++] = 0;
    }
    return this.buf.slice(0, this.pos);
  }
}

/**
 * Compresses one image's palette indices (`pixels[i] < 1 << minCodeSize`, row by row). `minCodeSize` is the number
 * of bits per pixel of the palette, but at least 2, as the GIF format requires.
 */
export function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  if (!(minCodeSize >= 2 && minCodeSize <= 8)) throw new RangeError("The LZW minimum code size must be between 2 and 8.");
  const n = pixels.length;
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const firstFree = eoiCode + 1;
  // a picture usually shrinks well below this; the writer doubles its buffer in the rare case it does not
  const out = new BlockWriter(minCodeSize, (n >> 2) + 64);
  const keys = hashKeys;
  const codes = hashCodes;
  keys.fill(-1);

  let nextCode = firstFree;
  let width = minCodeSize + 1;
  out.put(clearCode, width);
  if (n === 0) {
    out.put(eoiCode, width);
    return out.finish();
  }

  let prefix = pixels[0];
  for (let i = 1; i < n; i++) {
    const c = pixels[i];
    const key = (prefix << 8) | c;
    let h = Math.imul(key, 0x9e3779b1) >>> HASH_SHIFT;
    let k = keys[h];
    while (k !== -1 && k !== key) {
      h = (h + 1) & HASH_MASK;
      k = keys[h];
    }
    if (k === key) {
      prefix = codes[h]; // the string is already in the dictionary: keep extending it
      continue;
    }
    out.put(prefix, width);
    if (nextCode < LZW_MAX_CODES) {
      keys[h] = key;
      codes[h] = nextCode++;
      if (nextCode > 1 << width) width++;
    } else {
      // the dictionary is full: tell the decoder to start over (the code is still 12 bits wide here)
      out.put(clearCode, width);
      keys.fill(-1);
      nextCode = firstFree;
      width = minCodeSize + 1;
    }
    prefix = c;
  }

  out.put(prefix, width);
  // the decoder adds an entry on reading this code too, which can widen the end-of-information code that follows
  if (nextCode < LZW_MAX_CODES) {
    nextCode++;
    if (nextCode > 1 << width) width++;
  }
  out.put(eoiCode, width);
  return out.finish();
}

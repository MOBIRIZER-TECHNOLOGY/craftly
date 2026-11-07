/**
 * Pixel maths for models that turn a picture into a mask. No DOM and no runtime, so it works in the worker and in
 * plain tests: picture -> input tensor, model output -> 0-255 coverage, and the half precision numbers some models use.
 */

export type Rgb = readonly [number, number, number];

/** RGBA bytes of a size x size picture -> planar float tensor (all reds, then greens, then blues), normalised per channel. */
export function toInputTensor(rgba: ArrayLike<number>, size: number, mean: Rgb, std: Rgb): Float32Array {
  const count = size * size;
  if (rgba.length !== count * 4) throw new RangeError(`Expected ${count * 4} bytes for a ${size} x ${size} picture, got ${rgba.length}.`);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let channel = 0; channel < 3; channel++) {
      out[channel * count + i] = (rgba[i * 4 + channel]! / 255 - mean[channel]!) / std[channel]!;
    }
  }
  return out;
}

/**
 * Model output -> coverage 0-255 per pixel. `sigmoid` turns logits into probabilities first. With `stretch` the
 * probabilities are first spread over the full range of this picture (lowest becomes 0, highest 1), as the authors of ISNet
 * recommend. NaN and out-of-range values become 0 or 255.
 */
export function maskFromOutput(values: ArrayLike<number>, activation: "sigmoid" | "none", stretch = false): Uint8ClampedArray {
  const probability = (v: number) => (activation === "sigmoid" ? 1 / (1 + Math.exp(-v)) : v);
  let low = 0;
  let span = 1;
  if (stretch) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const p = probability(values[i]!);
      if (p < min) min = p; // a NaN is neither lower nor higher: it cannot move the range
      if (p > max) max = p;
    }
    if (max > min) {
      low = min;
      span = max - min;
    }
  }
  const out = new Uint8ClampedArray(values.length);
  for (let i = 0; i < values.length; i++) out[i] = ((probability(values[i]!) - low) / span) * 255;
  return out;
}

/** Share of pixels that are at least half covered (0 for an empty mask). */
export function subjectShare(mask: ArrayLike<number>): number {
  if (mask.length === 0) return 0;
  let covered = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]! >= 128) covered++;
  return covered / mask.length;
}

/** A mask as RGBA pixels whose alpha is the coverage, ready for `ImageData` and a `destination-in` draw. */
export function maskToRgba(mask: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) out[i * 4 + 3] = mask[i]!;
  return out;
}

/* ---------------- half precision (IEEE 754 binary16) ---------------- */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The 16 bits of the nearest half precision number (ties to even, overflow to infinity). */
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const biased = (x >>> 23) & 0xff;
  let mantissa = x & 0x7fffff;
  if (biased === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  const exponent = biased - 127 + 15;
  if (exponent >= 0x1f) return sign | 0x7c00;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    // subnormal: shift the mantissa, with its implicit leading one, into place
    mantissa |= 0x800000;
    const shift = 14 - exponent;
    let half = mantissa >> shift;
    const rest = mantissa & ((1 << shift) - 1);
    const middle = 1 << (shift - 1);
    if (rest > middle || (rest === middle && half & 1)) half++;
    return sign | half;
  }
  let half = sign | (exponent << 10) | (mantissa >> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && half & 1)) half++; // a carry into the exponent is correct
  return half;
}

/** The number a half precision bit pattern stands for. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

export function toHalfArray(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = floatToHalf(values[i]!);
  return out;
}

export function fromHalfArray(bits: Uint16Array): Float32Array {
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = halfToFloat(bits[i]!);
  return out;
}

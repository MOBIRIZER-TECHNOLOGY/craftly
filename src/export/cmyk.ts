/**
 * CMYK pages for the print PDF. A browser can only encode RGB pictures, so the rendered RGB pixels are turned into CMYK
 * here and written as an 8-bit /DeviceCMYK image, compressed with /FlateDecode (the browser's CompressionStream).
 *
 * The conversion is the naive, device-independent one, NOT a colour-managed (ICC) conversion:
 *
 * 1. Paper is white: a pixel that is not fully opaque is first laid over white.
 * 2. Each ink is what the light lacks: c = 1 - r, m = 1 - g, y = 1 - b (r, g, b from 0 to 1).
 * 3. Grey component replacement, in full: the grey that all three share, k = min(c, m, y), is printed with black ink
 *    instead, and what is left of each colour is scaled so that the colour stays the same under the simple model
 *    (1 - C)(1 - K) = 1 - c: C = (c - k) / (1 - k). So black is black ink alone (0/0/0/100, which keeps text sharp
 *    without the colour fringes a rich black gets when the plates are slightly out of register), every neutral grey is
 *    black ink alone too (no colour cast on press), and a colour keeps its saturation.
 * 4. Total ink limit (default 300 %): when C + M + Y + K is more than the limit, the three colours are scaled down
 *    together and the black is kept. With step 3 only the darkest saturated colours come near 300 %, so the default
 *    rarely acts; a printer who wants less (260 % is common for uncoated paper) can be given that.
 *
 * This is how most simple tools convert, and it looks right for designs on white paper, but the colours on press will
 * differ from what an ICC profile for the printer's press and paper would give. A printer may want to convert the RGB PDF
 * with their own profile instead.
 *
 * Rows are filtered with the PNG predictors (None, Sub or Up per row, whichever looks smallest) before they are deflated:
 * flat colour and smooth gradients then compress to a fraction of their size.
 */
import { m as words } from "@/i18n";
import { ExportError, throwIfAborted } from "./errors";
import { nextMacrotask } from "./yield";

/** Total ink limit: 3 = 300 % (each of the four inks counts from 0 to 1). */
export const INK_LIMIT = 3;

/**
 * One RGB colour (0..255 each, laid over white by `alpha` 0..255) as CMYK, each ink from 0 to 1. See the notes at the top
 * of this file for how it is computed.
 */
export function rgbToCmyk(r: number, g: number, b: number, alpha = 255, limit = INK_LIMIT): [number, number, number, number] {
  const a = alpha / 255;
  // over white: what is not covered shows the paper
  const c0 = (a * (255 - r)) / 255;
  const m0 = (a * (255 - g)) / 255;
  const y0 = (a * (255 - b)) / 255;
  const k = Math.min(c0, m0, y0);
  if (k >= 1) return [0, 0, 0, 1];
  const rest = 1 - k;
  let c = (c0 - k) / rest;
  let m = (m0 - k) / rest;
  let y = (y0 - k) / rest;
  const colour = c + m + y;
  if (colour + k > limit && colour > 0) {
    const s = Math.max(0, limit - k) / colour;
    c *= s;
    m *= s;
    y *= s;
  }
  return [c, m, y, k];
}

/** RGBA pixels (as a canvas gives them) to CMYK bytes, 0 = no ink and 255 = full ink, four per pixel. */
export function rgbaToCmykBytes(rgba: Uint8ClampedArray | Uint8Array, out: Uint8Array = new Uint8Array(rgba.length), limit = INK_LIMIT): Uint8Array {
  // rgbToCmyk written out, without an array per pixel: a 300 dpi page has millions of them
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 65025; // alpha / 255, and / 255 again for the channel
    const c0 = a * (255 - rgba[i]);
    const m0 = a * (255 - rgba[i + 1]);
    const y0 = a * (255 - rgba[i + 2]);
    const k = c0 < m0 ? (c0 < y0 ? c0 : y0) : m0 < y0 ? m0 : y0;
    if (k >= 1) {
      out[i] = out[i + 1] = out[i + 2] = 0;
      out[i + 3] = 255;
      continue;
    }
    const rest = 1 - k;
    let c = (c0 - k) / rest;
    let m = (m0 - k) / rest;
    let y = (y0 - k) / rest;
    const colour = c + m + y;
    if (colour + k > limit && colour > 0) {
      const s = Math.max(0, limit - k) / colour;
      c *= s;
      m *= s;
      y *= s;
    }
    out[i] = Math.round(c * 255);
    out[i + 1] = Math.round(m * 255);
    out[i + 2] = Math.round(y * 255);
    out[i + 3] = Math.round(k * 255);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* PNG predictors                                                      */
/* ------------------------------------------------------------------ */

const BPP = 4;

/** Sum of the filtered bytes read as signed numbers: the usual guess of which filter compresses best. */
function cost(bytes: Uint8Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += bytes[i] < 128 ? bytes[i] : 256 - bytes[i];
  return sum;
}

/**
 * Writes `rows` rows of CMYK bytes as PNG-predicted rows (one filter type byte, then the row) into a new array. `above` is the
 * row before the first one (null at the top of the picture: Up then sees zeros, as PNG defines it).
 */
export function predictRows(cmyk: Uint8Array, width: number, rows: number, above: Uint8Array | null): Uint8Array<ArrayBuffer> {
  const stride = width * BPP;
  const out = new Uint8Array(rows * (stride + 1));
  const sub = new Uint8Array(stride);
  const up = new Uint8Array(stride);
  for (let row = 0; row < rows; row++) {
    const at = row * stride;
    const prev = row > 0 ? cmyk.subarray(at - stride, at) : above;
    for (let i = 0; i < stride; i++) {
      const v = cmyk[at + i];
      sub[i] = (v - (i >= BPP ? cmyk[at + i - BPP] : 0)) & 0xff;
      up[i] = (v - (prev ? prev[i] : 0)) & 0xff;
    }
    const none = cost(cmyk, at, at + stride);
    const s = cost(sub, 0, stride);
    const u = cost(up, 0, stride);
    const o = row * (stride + 1);
    if (none <= s && none <= u) {
      out[o] = 0;
      out.set(cmyk.subarray(at, at + stride), o + 1);
    } else if (s <= u) {
      out[o] = 1;
      out.set(sub, o + 1);
    } else {
      out[o] = 2;
      out.set(up, o + 1);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The image                                                           */
/* ------------------------------------------------------------------ */

export interface CmykImage {
  width: number;
  height: number;
  /** the zlib (/FlateDecode) stream of the PNG-predicted rows, in pieces */
  data: Uint8Array[];
}

/** Rows read at a time: about a million pixels, so a 300 dpi page never needs all its RGBA and CMYK bytes at once. */
const BAND_PIXELS = 1 << 20;

/**
 * Turns an RGB picture into a compressed CMYK image. `readRows(y, rows)` gives the RGBA bytes of `rows` rows starting at `y`
 * (a canvas's getImageData); they are read band by band, converted, filtered and deflated while the next band is read.
 */
export async function encodeCmykImage(
  width: number,
  height: number,
  readRows: (y: number, rows: number) => Uint8ClampedArray | Uint8Array,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<CmykImage> {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const data: Uint8Array[] = [];
  const reading = (async () => {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      data.push(value);
    }
  })();
  const band = Math.max(1, Math.floor(BAND_PIXELS / Math.max(1, width)));
  let above: Uint8Array | null = null;
  try {
    for (let y = 0; y < height; y += band) {
      throwIfAborted(opts.signal);
      const rows = Math.min(band, height - y);
      const cmyk = rgbaToCmykBytes(readRows(y, rows), undefined, opts.limit);
      await writer.write(predictRows(cmyk, width, rows, above));
      above = cmyk.slice((rows - 1) * width * BPP);
      await nextMacrotask();
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await reading.catch(() => undefined);
    throw error;
  }
  await reading;
  return { width, height, data };
}

/** The pixels of a rendered page as a compressed CMYK image. */
export async function canvasToCmykImage(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<CmykImage> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ExportError("too-large", words.exporting.errors.tooLargeAtThisSize);
  return encodeCmykImage(canvas.width, canvas.height, (y, rows) => ctx.getImageData(0, y, canvas.width, rows).data, { signal });
}

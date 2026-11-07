/**
 * Colour quantisation for the GIF encoder.
 *
 *   ColorHistogram  counts the colours of any number of frames, bucketed to 5 bits per channel (32768 buckets) but
 *                   remembering each bucket's true average, so a flat colour that is alone in its bucket stays exact
 *   buildPalette    median cut over the buckets: the box with the most colour error is split at its weighted median
 *                   until there are as many boxes as colours; each box becomes one palette entry
 *   ColorMapper     pixel -> palette index. Colours that are in the palette map to themselves, everything else goes
 *                   through a 32768 entry cache of nearest colours (one search per bucket for the whole animation,
 *                   not per pixel), optionally with ordered dithering
 *
 * Ordered (Bayer) dithering is used rather than error diffusion on purpose: its pattern is fixed to the picture, so
 * a still area gets the same indices in every frame. That keeps frame differencing effective and the animation free
 * of shimmering noise.
 */

/** Channel weights of the colour error: the eye resolves green best and blue worst. */
const WEIGHT_R = 0.6;
const WEIGHT_G = 1;
const WEIGHT_B = 0.45;

const BUCKETS = 32768;

const bucketOf = (r: number, g: number, b: number): number => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/* ------------------------------------------------------------------ */
/* histogram                                                           */
/* ------------------------------------------------------------------ */

export class ColorHistogram {
  readonly counts = new Uint32Array(BUCKETS);
  readonly sumR = new Float64Array(BUCKETS);
  readonly sumG = new Float64Array(BUCKETS);
  readonly sumB = new Float64Array(BUCKETS);
  /** pixels counted so far */
  pixels = 0;

  /** Adds every `step`-th pixel of an RGBA frame (alpha is ignored; frames are painted on an opaque background). */
  addFrame(rgba: ArrayLike<number>, step = 1): void {
    const stride = 4 * Math.max(1, Math.floor(step));
    const { counts, sumR, sumG, sumB } = this;
    let added = 0;
    for (let i = 0; i + 3 < rgba.length; i += stride) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const k = bucketOf(r, g, b);
      counts[k]++;
      sumR[k] += r;
      sumG[k] += g;
      sumB[k] += b;
      added++;
    }
    this.pixels += added;
  }

  /** Number of buckets that hold at least one pixel. */
  get distinct(): number {
    let n = 0;
    for (let k = 0; k < BUCKETS; k++) if (this.counts[k] > 0) n++;
    return n;
  }
}

/* ------------------------------------------------------------------ */
/* median cut                                                          */
/* ------------------------------------------------------------------ */

interface Box {
  lo: number;
  hi: number;
  weight: number;
  r: number;
  g: number;
  b: number;
  /** colour error inside the box (what splitting it would remove); -1 when it holds a single bucket */
  score: number;
}

/**
 * At most `maxColors` RGB triplets (3 bytes each) that represent the histogram. An image with fewer distinct
 * buckets than that gets one entry per bucket, so flat colours come out exactly; an empty histogram gives black.
 */
export function buildPalette(hist: ColorHistogram, maxColors: number): Uint8Array {
  const limit = Math.max(1, Math.min(256, Math.floor(maxColors)));
  const keys: number[] = [];
  for (let k = 0; k < BUCKETS; k++) if (hist.counts[k] > 0) keys.push(k);
  const m = keys.length;
  if (m === 0) return new Uint8Array(3);

  // per bucket: pixel count and true average colour
  const w = new Float64Array(m);
  const mr = new Float64Array(m);
  const mg = new Float64Array(m);
  const mb = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const k = keys[i];
    const c = hist.counts[k];
    w[i] = c;
    mr[i] = hist.sumR[k] / c;
    mg[i] = hist.sumG[k] / c;
    mb[i] = hist.sumB[k] / c;
  }

  const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  if (m <= limit) {
    const out = new Uint8Array(m * 3);
    for (let i = 0; i < m; i++) {
      out[i * 3] = byte(mr[i]);
      out[i * 3 + 1] = byte(mg[i]);
      out[i * 3 + 2] = byte(mb[i]);
    }
    return out;
  }

  const order = new Uint16Array(m);
  for (let i = 0; i < m; i++) order[i] = i;
  const scratch = new Uint16Array(m);

  const measure = (lo: number, hi: number): Box => {
    let weight = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = lo; i < hi; i++) {
      const j = order[i];
      weight += w[j];
      sr += w[j] * mr[j];
      sg += w[j] * mg[j];
      sb += w[j] * mb[j];
    }
    const r = sr / weight;
    const g = sg / weight;
    const b = sb / weight;
    let error = 0;
    if (hi - lo > 1) {
      for (let i = lo; i < hi; i++) {
        const j = order[i];
        const dr = mr[j] - r;
        const dg = mg[j] - g;
        const db = mb[j] - b;
        error += w[j] * (WEIGHT_R * dr * dr + WEIGHT_G * dg * dg + WEIGHT_B * db * db);
      }
    }
    return { lo, hi, weight, r, g, b, score: hi - lo > 1 ? error : -1 };
  };

  const channelWeight = new Float64Array(32);
  /** Splits a box at the weighted median of its widest channel; both halves are never empty. */
  const split = (box: Box): [Box, Box] => {
    const { lo, hi } = box;
    let minR = 31;
    let maxR = 0;
    let minG = 31;
    let maxG = 0;
    let minB = 31;
    let maxB = 0;
    for (let i = lo; i < hi; i++) {
      const key = keys[order[i]];
      const r = key >> 10;
      const g = (key >> 5) & 31;
      const b = key & 31;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
    const spanR = (maxR - minR) * Math.sqrt(WEIGHT_R);
    const spanG = (maxG - minG) * Math.sqrt(WEIGHT_G);
    const spanB = (maxB - minB) * Math.sqrt(WEIGHT_B);
    let shift: number;
    let min: number;
    let max: number;
    if (spanG >= spanR && spanG >= spanB) {
      shift = 5;
      min = minG;
      max = maxG;
    } else if (spanR >= spanB) {
      shift = 10;
      min = minR;
      max = maxR;
    } else {
      shift = 0;
      min = minB;
      max = maxB;
    }
    channelWeight.fill(0);
    for (let i = lo; i < hi; i++) {
      const j = order[i];
      channelWeight[(keys[j] >> shift) & 31] += w[j];
    }
    const half = box.weight / 2;
    let seen = 0;
    let cut = min;
    for (let v = min; v <= max; v++) {
      seen += channelWeight[v];
      if (seen >= half) {
        cut = v;
        break;
      }
    }
    if (cut >= max) cut = max - 1;
    // stable partition: buckets whose value is <= cut first
    let left = lo;
    let right = 0;
    for (let i = lo; i < hi; i++) {
      const j = order[i];
      if (((keys[j] >> shift) & 31) <= cut) order[left++] = j;
      else scratch[right++] = j;
    }
    for (let t = 0; t < right; t++) order[left + t] = scratch[t];
    return [measure(lo, left), measure(left, hi)];
  };

  const boxes: Box[] = [measure(0, m)];
  while (boxes.length < limit) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].score > bestScore) {
        bestScore = boxes[i].score;
        best = i;
      }
    }
    if (best < 0) break; // everything left is a single colour
    const [a, b] = split(boxes[best]);
    boxes[best] = a;
    boxes.push(b);
  }

  const out = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    out[i * 3] = byte(box.r);
    out[i * 3 + 1] = byte(box.g);
    out[i * 3 + 2] = byte(box.b);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* pixel -> palette index                                              */
/* ------------------------------------------------------------------ */

/** 8x8 Bayer threshold map, centred on zero: values in (-0.5, 0.5). */
const BAYER: Float32Array = (() => {
  let m = [[0]];
  for (let size = 1; size < 8; size *= 2) {
    const next: number[][] = Array.from({ length: size * 2 }, () => new Array<number>(size * 2).fill(0));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    }
    m = next;
  }
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = (m[y][x] + 0.5) / 64 - 0.5;
  return out;
})();

/** A colour whose nearest palette entry is this close (squared RGB distance) is left undithered: flat colours stay flat. */
const DITHER_MIN_ERROR = 9;
/** The dither never swings a channel by more than this many levels. */
const DITHER_MAX_SWING = 28;

const EXACT_SLOTS = 1024;
const EXACT_MASK = EXACT_SLOTS - 1;
const EXACT_SHIFT = 32 - 10;

export class ColorMapper {
  /** colours in the palette */
  readonly size: number;
  private readonly pr: Uint8Array;
  private readonly pg: Uint8Array;
  private readonly pb: Uint8Array;
  /** nearest palette entry of the first colour seen in each 5 bit bucket, -1 until then */
  private readonly cache = new Int16Array(BUCKETS).fill(-1);
  /** how far the dither may swing the colours of a bucket (0 = the match is close, leave them alone), set with `cache` */
  private readonly swing = new Uint8Array(BUCKETS);
  /** exact `rgb` -> index of the palette entries, so a colour that is in the palette always maps to itself */
  private readonly exactKeys = new Int32Array(EXACT_SLOTS).fill(-1);
  private readonly exactValues = new Uint8Array(EXACT_SLOTS);
  /** 1 for the buckets that hold a palette entry: only a colour in one of those can be an exact match, so the rest skip the lookup */
  private readonly paletteBuckets = new Uint8Array(BUCKETS);

  /** `palette` is RGB triplets, 1 to 256 colours. */
  constructor(palette: Uint8Array) {
    this.size = Math.floor(palette.length / 3);
    if (this.size < 1 || this.size > 256) throw new RangeError("A GIF palette has 1 to 256 colours.");
    this.pr = new Uint8Array(this.size);
    this.pg = new Uint8Array(this.size);
    this.pb = new Uint8Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const r = palette[i * 3];
      const g = palette[i * 3 + 1];
      const b = palette[i * 3 + 2];
      this.pr[i] = r;
      this.pg[i] = g;
      this.pb[i] = b;
      this.paletteBuckets[bucketOf(r, g, b)] = 1;
      const rgb = (r << 16) | (g << 8) | b;
      let h = Math.imul(rgb, 0x9e3779b1) >>> EXACT_SHIFT;
      let taken = false;
      while (this.exactKeys[h] !== -1) {
        if (this.exactKeys[h] === rgb) {
          taken = true; // a duplicate colour: the first entry wins
          break;
        }
        h = (h + 1) & EXACT_MASK;
      }
      if (!taken) {
        this.exactKeys[h] = rgb;
        this.exactValues[h] = i;
      }
    }
  }

  /** The palette entry closest to the colour (weighted RGB distance), by searching them all. */
  nearest(r: number, g: number, b: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.size; i++) {
      const dr = r - this.pr[i];
      const dg = g - this.pg[i];
      const db = b - this.pb[i];
      const d = WEIGHT_R * dr * dr + WEIGHT_G * dg * dg + WEIGHT_B * db * db;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
        if (d === 0) break;
      }
    }
    return best;
  }

  /** Palette index of a colour (integers 0..255). */
  index(r: number, g: number, b: number): number {
    const bucket = bucketOf(r, g, b);
    if (this.paletteBuckets[bucket] !== 0) {
      const rgb = (r << 16) | (g << 8) | b;
      let h = Math.imul(rgb, 0x9e3779b1) >>> EXACT_SHIFT;
      let k = this.exactKeys[h];
      while (k !== -1) {
        if (k === rgb) return this.exactValues[h];
        h = (h + 1) & EXACT_MASK;
        k = this.exactKeys[h];
      }
    }
    const v = this.cache[bucket];
    return v >= 0 ? v : this.fill(bucket, r, g, b);
  }

  /** First colour seen in a bucket: remember its nearest entry, and how far off that entry is (which sets the dither). */
  private fill(bucket: number, r: number, g: number, b: number): number {
    const v = this.nearest(r, g, b);
    this.cache[bucket] = v;
    const dr = r - this.pr[v];
    const dg = g - this.pg[v];
    const db = b - this.pb[v];
    const error = dr * dr + dg * dg + db * db;
    this.swing[bucket] = error <= DITHER_MIN_ERROR ? 0 : Math.min(DITHER_MAX_SWING, Math.round(2 * Math.sqrt(error)));
    return v;
  }

  /**
   * Like `index`, but a colour the palette cannot match closely is nudged by the Bayer threshold at (x, y) first,
   * so smooth gradients become a fine pattern of the two nearest palette colours instead of visible bands. The
   * nudge scales with how far the plain match is off, which is about the palette's spacing there; it is decided once
   * per bucket, so a pixel costs two cache reads, not a distance calculation.
   */
  indexDithered(r: number, g: number, b: number, x: number, y: number): number {
    const bucket = bucketOf(r, g, b);
    if (this.paletteBuckets[bucket] !== 0) {
      const rgb = (r << 16) | (g << 8) | b;
      let h = Math.imul(rgb, 0x9e3779b1) >>> EXACT_SHIFT;
      let k = this.exactKeys[h];
      while (k !== -1) {
        if (k === rgb) return this.exactValues[h];
        h = (h + 1) & EXACT_MASK;
        k = this.exactKeys[h];
      }
    }
    let v = this.cache[bucket];
    if (v < 0) v = this.fill(bucket, r, g, b);
    const swing = this.swing[bucket];
    if (swing === 0) return v;
    const t = BAYER[((y & 7) << 3) | (x & 7)] * swing;
    const rr = r + t;
    const gg = g + t;
    const bb = b + t;
    return this.index(rr < 0 ? 0 : rr > 255 ? 255 : rr | 0, gg < 0 ? 0 : gg > 255 ? 255 : gg | 0, bb < 0 ? 0 : bb > 255 ? 255 : bb | 0);
  }
}

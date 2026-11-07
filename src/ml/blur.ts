/**
 * Blurs what is behind the main subject of a picture and leaves the subject as it is. Pixel maths only (no DOM, no canvas),
 * so it runs in plain tests, and the work can be done a few rows at a time: the screen stays alive and Cancel works.
 *
 * Two things make the result look right:
 *  - Only background pixels are averaged. A plain blur of the whole picture pulls the subject's colours into the background
 *    around its outline: a halo. Here every pixel gets a weight (1 well behind the subject, 0 on it) and the blurred colour
 *    is "sum of colour x weight / sum of weight", a weighted average (normalised convolution). Pixels that are not there
 *    (transparent) weigh nothing either, so a hole in a cut-out does not darken its surroundings.
 *  - A wide blur is smooth, so it is worked out on a coarser grid (one cell for step x step pixels) and stretched back. The
 *    work then depends on how smooth the result is, not on how many pixels the photo has: a 25-megapixel photo costs about
 *    as much as a 2-megapixel one.
 */

import { checkInputs, coverSampler, type CoverageMask, type Picture } from "./coverage";

/* ---------------- how much to blur ---------------- */

export type BlurStrength = "light" | "medium" | "strong";
export const BLUR_STRENGTHS: readonly BlurStrength[] = ["light", "medium", "strong"];

/** The blur's standard deviation as a share of the picture's longer side, so a photo looks the same at any resolution. */
const SIGMA_SHARE: Record<BlurStrength, number> = { light: 0.005, medium: 0.012, strong: 0.025 };
/** A blur under two pixels would hardly show on the smallest picture. */
const MIN_SIGMA = 2;

/** The blur's standard deviation in pixels for a picture of this size. */
export function blurSigma(width: number, height: number, strength: BlurStrength): number {
  return Math.max(MIN_SIGMA, Math.max(width, height) * SIGMA_SHARE[strength]);
}

/**
 * Widths of three box blurs that together blur about as much as a Gaussian of this standard deviation does (the usual
 * "three boxes" method: two sizes of odd width are mixed so that their variances add up to the Gaussian's). A box of width
 * w has variance (w * w - 1) / 12.
 */
export function boxSizes(sigma: number, passes = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  lower = Math.max(1, lower);
  const upper = lower + 2;
  const lowerCount = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4));
  return Array.from({ length: passes }, (_, i) => (i < lowerCount ? lower : upper));
}

/** Less background than this (as a share of the picture, counting only pixels that are at least half there) is not worth blurring. */
const MIN_BACKGROUND_SHARE = 0.001;

/** The grid the blur is worked out on is at most this many times coarser than the picture. */
const MAX_STEP = 16;

export interface BlurPlan {
  /** one cell of the working grid covers step x step pixels */
  step: number;
  cols: number;
  rows: number;
  /** the widths of the three box blurs, in cells */
  boxes: number[];
}

/** Which grid to work on: coarse enough to be cheap, fine enough (a deviation of at least four cells) to stay smooth. */
export function planBlur(width: number, height: number, sigma: number): BlurPlan {
  const step = Math.min(MAX_STEP, Math.max(1, Math.floor(sigma / 4)));
  return { step, cols: Math.ceil(width / step), rows: Math.ceil(height / step), boxes: boxSizes(sigma / step) };
}

/* ---------------- the pieces of the work ---------------- */

/**
 * Sums over a window of 2 * radius + 1 cells along each row, the window cut off at the edges (no padding: what is not
 * there is not counted, and the weights are summed the same way, so the average stays right at the edges). The running sum
 * is kept in double precision: every number in it is a single precision number, so it stays exact.
 */
function sumAlongRows(plane: Float32Array, cols: number, rows: number, radius: number, line: Float32Array): void {
  if (radius <= 0) return;
  for (let y = 0; y < rows; y++) {
    const base = y * cols;
    let sum = 0;
    for (let x = 0; x <= Math.min(radius, cols - 1); x++) sum += plane[base + x]!;
    for (let x = 0; x < cols; x++) {
      line[x] = sum;
      if (x + 1 + radius < cols) sum += plane[base + x + 1 + radius]!;
      if (x - radius >= 0) sum -= plane[base + x - radius]!;
    }
    plane.set(line.subarray(0, cols), base);
  }
}

function sumAlongColumns(plane: Float32Array, cols: number, rows: number, radius: number, line: Float32Array): void {
  if (radius <= 0) return;
  for (let x = 0; x < cols; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(radius, rows - 1); y++) sum += plane[y * cols + x]!;
    for (let y = 0; y < rows; y++) {
      line[y] = sum;
      if (y + 1 + radius < rows) sum += plane[(y + 1 + radius) * cols + x]!;
      if (y - radius >= 0) sum -= plane[(y - radius) * cols + x]!;
    }
    for (let y = 0; y < rows; y++) plane[y * cols + x] = line[y]!;
  }
}

/**
 * Where each pixel of a row (or column) of `length` pixels lies on the working grid: between cell `low` and cell `high`,
 * `fraction` of the way. Stretching the grid back to the picture blends the two cells.
 */
function gridAxis(length: number, cells: number, step: number): { low: Int32Array; high: Int32Array; fraction: Float32Array } {
  const low = new Int32Array(length);
  const high = new Int32Array(length);
  const fraction = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    // the middle of cell n lies at pixel n * step + (step - 1) / 2
    const g = Math.min(cells - 1, Math.max(0, (i + 0.5) / step - 0.5));
    const n = Math.floor(g);
    low[i] = n;
    high[i] = Math.min(cells - 1, n + 1);
    fraction[i] = g - n;
  }
  return { low, high, fraction };
}

export interface BackgroundBlur {
  /** Takes the rows from `from` up to (not including) `to` into the average. Rows in order, each once. */
  addRows(from: number, to: number): void;
  /** Blurs what the rows gave. False when there is nothing to blur with (no background, or a blur too small to see). */
  solve(): boolean;
  /** Writes the result into the rows from `from` up to `to` of the picture. Does nothing after a `solve` that said false. */
  paintRows(from: number, to: number): void;
}

/**
 * Blurs the background of `picture` in place, in three steps that each take a few rows at a time: `addRows` for every row,
 * `solve` once, then `paintRows` for every row. The subject (coverage 1) is never touched; the opacity never is.
 */
export function createBackgroundBlur(picture: Picture, mask: CoverageMask, sigma: number): BackgroundBlur {
  const { rgba, width, height } = picture;
  checkInputs(picture, mask);

  const plan = planBlur(width, height, sigma);
  const { step, cols, rows } = plan;
  const active = sigma > 0 && plan.boxes.some((w) => w > 1);
  const cover = coverSampler(mask, width, height);
  const coverRow = new Float32Array(width);

  // the sums over the cells: colour times weight, and the weight. After `solve` they hold the blurred background's colour.
  const red = new Float32Array(cols * rows);
  const green = new Float32Array(cols * rows);
  const blue = new Float32Array(cols * rows);
  const weight = new Float32Array(cols * rows);
  const cellOf = new Int32Array(width);
  for (let x = 0; x < width; x++) cellOf[x] = Math.floor(x / step);
  const gridX = gridAxis(width, cols, step);
  const field = [red, green, blue];
  let visible = 0; // background pixels that are at least half there: the faint rim of a cut-out is not background
  let solved = false;

  return {
    addRows(from, to) {
      if (!active) return;
      for (let y = from; y < to; y++) {
        cover(y, coverRow);
        const base = Math.floor(y / step) * cols;
        for (let x = 0; x < width; x++) {
          const c = coverRow[x]!;
          if (!(c < 0.5)) continue; // on the subject (or the edge of it), or not a number: not background
          const p = (y * width + x) * 4;
          const alpha = rgba[p + 3]!;
          if (alpha === 0) continue;
          if (alpha >= 128) visible++;
          const w = (1 - 2 * c) * (alpha / 255); // 1 well behind the subject, falling to 0 half way up its edge
          const cell = base + cellOf[x]!;
          red[cell] += rgba[p]! * w;
          green[cell] += rgba[p + 1]! * w;
          blue[cell] += rgba[p + 2]! * w;
          weight[cell] += w;
        }
      }
    },

    solve() {
      if (!active || visible < width * height * MIN_BACKGROUND_SHARE) return false;
      let total = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let i = 0; i < weight.length; i++) {
        total += weight[i]!;
        sumR += red[i]!;
        sumG += green[i]!;
        sumB += blue[i]!;
      }
      if (!(total > 0)) return false;

      const line = new Float32Array(Math.max(cols, rows));
      for (const plane of [red, green, blue, weight]) {
        for (const w of plan.boxes) sumAlongRows(plane, cols, rows, (w - 1) / 2, line);
        for (const w of plan.boxes) sumAlongColumns(plane, cols, rows, (w - 1) / 2, line);
      }
      // where no background lies within reach (deep inside the subject) the average of all of it stands in: it is never seen
      // there, because the subject is painted over it, but it keeps the soft edge of a subject that fills the frame sensible
      for (let i = 0; i < weight.length; i++) {
        const w = weight[i]!;
        red[i] = w > 0 ? red[i]! / w : sumR / total;
        green[i] = w > 0 ? green[i]! / w : sumG / total;
        blue[i] = w > 0 ? blue[i]! / w : sumB / total;
      }
      solved = true;
      return true;
    },

    paintRows(from, to) {
      if (!solved) return;
      for (let y = from; y < to; y++) {
        cover(y, coverRow);
        const g = Math.min(rows - 1, Math.max(0, (y + 0.5) / step - 0.5));
        const upper = Math.floor(g);
        const down = g - upper;
        const upperRow = upper * cols;
        const lowerRow = Math.min(rows - 1, upper + 1) * cols;
        for (let x = 0; x < width; x++) {
          const c = coverRow[x]!;
          if (!(c < 0.999)) continue; // the subject stays exactly as it is
          const p = (y * width + x) * 4;
          if (rgba[p + 3] === 0) continue;
          const a = gridX.low[x]!;
          const b = gridX.high[x]!;
          const f = gridX.fraction[x]!;
          for (let k = 0; k < 3; k++) {
            const plane = field[k]!;
            const top = plane[upperRow + a]! * (1 - f) + plane[upperRow + b]! * f;
            const bottom = plane[lowerRow + a]! * (1 - f) + plane[lowerRow + b]! * f;
            rgba[p + k] = c * rgba[p + k]! + (1 - c) * (top * (1 - down) + bottom * down);
          }
        }
      }
    },
  };
}

/** The whole job in one call, for callers that do not need to work in pieces. */
export function blurBehindSubject(picture: Picture, mask: CoverageMask, sigma: number): void {
  const blur = createBackgroundBlur(picture, mask, sigma);
  blur.addRows(0, picture.height);
  if (blur.solve()) blur.paintRows(0, picture.height);
}

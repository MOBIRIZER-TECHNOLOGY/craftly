/**
 * The pixel maths of a model that makes a picture larger. No DOM and no runtime, so it runs in plain tests: cut a picture
 * into tiles, hand each tile to the model with some of its surroundings, and keep from each answer only the part that
 * belongs to the picture. The context around a tile is what makes the tiles meet without a seam, because every layer of the
 * network looks a few pixels past the pixel it computes.
 */
import { MAX_OUTPUT_PIXELS, MAX_SIDE } from "./limits";

/** The part of the picture one run is responsible for. */
export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TilePlan {
  cols: number;
  rows: number;
  /** pixels of the picture's surroundings that every tile is given on each side */
  halo: number;
  /** the picture every run gets: the part it keeps plus the halo, the same size for every tile of one picture */
  windowWidth: number;
  windowHeight: number;
  /** in reading order */
  tiles: Tile[];
}

function whole(value: number, what: string, least: number): void {
  if (!Number.isInteger(value) || value < least) throw new RangeError(`${what} has to be a whole number of at least ${least}, got ${value}.`);
}

/**
 * Cuts a width x height picture into tiles of at most `tile` pixels a side, halo included. The parts the tiles keep are equal
 * (the last one in a row may be a pixel or two short), instead of full tiles and a sliver, so no run is mostly wasted.
 */
export function planTiles(width: number, height: number, tile: number, halo: number): TilePlan {
  whole(width, "The width", 1);
  whole(height, "The height", 1);
  whole(tile, "The tile size", 1);
  whole(halo, "The halo", 0);
  if (tile <= 2 * halo) throw new RangeError(`A tile of ${tile} pixels leaves nothing to keep after ${halo} pixels of halo on each side.`);
  const room = tile - 2 * halo;
  const cols = Math.ceil(width / room);
  const rows = Math.ceil(height / room);
  const partWidth = Math.ceil(width / cols);
  const partHeight = Math.ceil(height / rows);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    const y = row * partHeight;
    for (let col = 0; col < cols; col++) {
      const x = col * partWidth;
      tiles.push({ x, y, width: Math.min(partWidth, width - x), height: Math.min(partHeight, height - y) });
    }
  }
  return { cols, rows, halo, windowWidth: partWidth + 2 * halo, windowHeight: partHeight + 2 * halo, tiles };
}

/** Where an index outside 0..size-1 lands when the picture is mirrored at its edges (the edge pixel is repeated). */
export function reflectIndex(index: number, size: number): number {
  const period = 2 * size;
  const inside = ((index % period) + period) % period;
  return inside < size ? inside : period - 1 - inside;
}

/**
 * What the model gets for one tile: its window of the picture as planar numbers from 0 to 1 (all reds, then all greens,
 * then all blues). Where the window reaches past the picture's edge, the picture is mirrored.
 */
export function extractTile(rgba: ArrayLike<number>, width: number, height: number, plan: TilePlan, tile: Tile): Float32Array {
  if (rgba.length !== width * height * 4) throw new RangeError(`Expected ${width * height * 4} bytes for a ${width} x ${height} picture, got ${rgba.length}.`);
  const { windowWidth, windowHeight, halo } = plan;
  const plane = windowWidth * windowHeight;
  const out = new Float32Array(3 * plane);
  const columns = new Int32Array(windowWidth);
  for (let wx = 0; wx < windowWidth; wx++) columns[wx] = reflectIndex(tile.x - halo + wx, width);
  for (let wy = 0; wy < windowHeight; wy++) {
    const row = reflectIndex(tile.y - halo + wy, height) * width;
    for (let wx = 0; wx < windowWidth; wx++) {
      const from = (row + columns[wx]!) * 4;
      const to = wy * windowWidth + wx;
      out[to] = rgba[from]! / 255;
      out[plane + to] = rgba[from + 1]! / 255;
      out[2 * plane + to] = rgba[from + 2]! / 255;
    }
  }
  return out;
}

/**
 * The part of the model's answer for a tile that belongs to the picture, as RGBA bytes. `output` is planar RGB, `scale` times
 * larger than the window. With a `factor` below `scale` the answer is averaged down to `factor` times the size of the
 * picture (a model that makes everything four times larger gives twice as large by averaging 2 x 2 pixels). Every number is
 * clamped to 0..1 first, because a network overshoots a little at sharp edges; a number that is not one becomes black.
 */
export function keepTile(output: ArrayLike<number>, plan: TilePlan, tile: Tile, scale: number, factor: number): { rgba: Uint8ClampedArray; width: number; height: number } {
  whole(scale, "The scale", 1);
  whole(factor, "The factor", 1);
  if (scale % factor !== 0) throw new RangeError(`A model that makes pictures ${scale} times larger cannot make them ${factor} times larger.`);
  const outWidth = plan.windowWidth * scale;
  const outHeight = plan.windowHeight * scale;
  if (output.length !== 3 * outWidth * outHeight)
    throw new RangeError(`Expected ${3 * outWidth * outHeight} numbers for a ${outWidth} x ${outHeight} answer, got ${output.length}.`);
  const block = scale / factor;
  const width = tile.width * factor;
  const height = tile.height * factor;
  const margin = plan.halo * scale;
  const plane = outWidth * outHeight;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const norm = 255 / (block * block);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let dy = 0; dy < block; dy++) {
          const row = channel * plane + (margin + y * block + dy) * outWidth + margin + x * block;
          for (let dx = 0; dx < block; dx++) {
            const value = output[row + dx]!;
            sum += value > 0 ? (value < 1 ? value : 1) : 0; // NaN is not greater than 0
          }
        }
        rgba[at + channel] = sum * norm;
      }
      rgba[at + 3] = 255;
    }
  }
  return { rgba, width, height };
}

/* ---------------- transparency ---------------- */

/** True when any pixel is not fully opaque. */
export function hasTransparency(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 255) return true;
  return false;
}

/** The opacity of every pixel, one byte each. */
export function alphaOf(rgba: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3]!;
  return out;
}

export interface BleedOptions {
  /** from this opacity (0-255) on, a pixel's own colour is trusted */
  solid?: number;
  /** how many pixels the colours of the solid ones are spread; what is further away gets their average */
  reach?: number;
}

/**
 * A copy of the picture whose colours are fit for a model that only reads colours. A transparent pixel is stored as black
 * (or white, or anything), and a model that sees black around an object draws a dark fringe along its edge. So every pixel
 * that is (nearly) transparent takes the colour of the nearest solid pixel, and what is out of reach takes the average colour
 * of the solid ones. Opacity is never touched: the caller puts it back afterwards.
 */
export function bleedColours(rgba: ArrayLike<number>, width: number, height: number, { solid = 128, reach = 48 }: BleedOptions = {}): Uint8ClampedArray {
  const count = width * height;
  if (rgba.length !== count * 4) throw new RangeError(`Expected ${count * 4} bytes for a ${width} x ${height} picture, got ${rgba.length}.`);
  const out = Uint8ClampedArray.from(rgba);
  const known = new Uint8Array(count);
  const distance = new Uint8Array(count);
  const queue = new Int32Array(count);
  let tail = 0;
  const total = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (out[i * 4 + 3]! < solid) continue;
    known[i] = 1;
    queue[tail++] = i;
    for (let c = 0; c < 3; c++) total[c]! += out[i * 4 + c]!;
  }
  if (tail === 0 || tail === count) return out; // nothing to copy from, or nothing to fix
  const solidCount = tail;

  // spread the colours one pixel at a time, nearest first: a pixel is reached by the closest solid one
  const spread = (from: number, to: number, nextDistance: number) => {
    known[to] = 1;
    distance[to] = nextDistance;
    out[to * 4] = out[from * 4]!;
    out[to * 4 + 1] = out[from * 4 + 1]!;
    out[to * 4 + 2] = out[from * 4 + 2]!;
    queue[tail++] = to;
  };
  for (let head = 0; head < tail; head++) {
    const at = queue[head]!;
    const steps = distance[at]!;
    if (steps >= reach) continue;
    const x = at % width;
    if (x > 0 && !known[at - 1]) spread(at, at - 1, steps + 1);
    if (x < width - 1 && !known[at + 1]) spread(at, at + 1, steps + 1);
    if (at >= width && !known[at - width]) spread(at, at - width, steps + 1);
    if (at < count - width && !known[at + width]) spread(at, at + width, steps + 1);
  }

  if (tail < count) {
    const average = total.map((sum) => Math.round(sum / solidCount));
    for (let i = 0; i < count; i++) {
      if (known[i]) continue;
      out[i * 4] = average[0]!;
      out[i * 4 + 1] = average[1]!;
      out[i * 4 + 2] = average[2]!;
    }
  }
  return out;
}

/* ---------------- sizes ---------------- */

/** The factors the upscaler offers. The model makes everything four times larger; two is that, averaged down. */
export const UPSCALE_FACTORS: readonly number[] = [2, 4];

export interface UpscaleChoice {
  factor: number;
  /** the size the result would have */
  width: number;
  height: number;
  /** false when the result would be larger than the app can keep (25 megapixels, or a side longer than a canvas can be) */
  fits: boolean;
}

export function upscaleChoices(width: number, height: number, factors: readonly number[] = UPSCALE_FACTORS): UpscaleChoice[] {
  return factors.map((factor) => {
    const w = width * factor;
    const h = height * factor;
    return { factor, width: w, height: h, fits: width > 0 && height > 0 && w * h <= MAX_OUTPUT_PIXELS && Math.max(w, h) <= MAX_SIDE };
  });
}

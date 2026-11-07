/**
 * What the pixel tools that work on "everything but the subject" have in common: a picture, the mask the model gave, and the
 * coverage of every pixel of a row (how much of that spot is subject, from 0 to 1). Pixel maths only: no DOM, no canvas.
 */

export interface Picture {
  /** RGBA, row by row, `width` x `height` pixels. The tools write into it. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** How much of each spot is subject, 0 to 255, as a `size` x `size` grid that is stretched over the whole picture. */
export interface CoverageMask {
  data: ArrayLike<number>;
  size: number;
}

/** Refuses buffers that are not the size they come with: a picture of width x height needs 4 bytes a pixel, a mask size x size values. */
export function checkInputs(picture: Picture, mask: CoverageMask): void {
  const { rgba, width, height } = picture;
  if (!(width > 0 && height > 0) || rgba.length !== width * height * 4)
    throw new RangeError(`A ${width} x ${height} picture needs ${width * height * 4} bytes, got ${rgba.length}.`);
  if (!(mask.size > 0) || mask.data.length !== mask.size * mask.size)
    throw new RangeError(`A ${mask.size} x ${mask.size} mask needs ${mask.size * mask.size} values, got ${mask.data.length}.`);
}

/** Subject share of every pixel of one row (0 to 1), by stretching the mask over the picture and blending between its values. */
export function coverSampler(mask: CoverageMask, width: number, height: number): (y: number, out: Float32Array) => void {
  const { data, size } = mask;
  const left = new Int32Array(width);
  const right = new Int32Array(width);
  const across = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const u = Math.min(size - 1, Math.max(0, ((x + 0.5) * size) / width - 0.5));
    const i = Math.floor(u);
    left[x] = i;
    right[x] = Math.min(size - 1, i + 1);
    across[x] = u - i;
  }
  return (y, out) => {
    const v = Math.min(size - 1, Math.max(0, ((y + 0.5) * size) / height - 0.5));
    const j = Math.floor(v);
    const down = v - j;
    const upperRow = j * size;
    const lowerRow = Math.min(size - 1, j + 1) * size;
    for (let x = 0; x < width; x++) {
      const f = across[x]!;
      const top = data[upperRow + left[x]!]! * (1 - f) + data[upperRow + right[x]!]! * f;
      const bottom = data[lowerRow + left[x]!]! * (1 - f) + data[lowerRow + right[x]!]! * f;
      out[x] = (top * (1 - down) + bottom * down) / 255;
    }
  };
}

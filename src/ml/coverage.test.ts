import { describe, expect, it } from "vitest";
import { checkInputs, coverSampler, type CoverageMask } from "./coverage";

function mask(size: number, at: (x: number, y: number) => number): CoverageMask & { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = at(x, y);
  return { data, size };
}

/** The coverage the sampler gives for row `y` of a picture `width` pixels wide. */
function row(sampler: ReturnType<typeof coverSampler>, y: number, width: number): number[] {
  const out = new Float32Array(width);
  sampler(y, out);
  return Array.from(out);
}

describe("coverSampler", () => {
  it("gives the mask's own values, exactly, when the mask is as large as the picture", () => {
    const sampler = coverSampler(
      mask(8, (x, y) => (x < 3 ? 255 : y < 4 ? 0 : 255)),
      8,
      8,
    );
    expect(row(sampler, 0, 8)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    expect(row(sampler, 6, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("stretches a smaller mask over the picture, blending between its values and holding the edge ones beyond the first and last cell", () => {
    // 4 cells over 16 pixels: pixel x lies at x / 4 - 0.375 of the way along the mask, so the border between cell 1 (subject) and cell 2 (not) is at pixel 6.5
    const sampler = coverSampler(
      mask(4, (x) => (x < 2 ? 255 : 0)),
      16,
      16,
    );
    expect(row(sampler, 8, 16)).toEqual([1, 1, 1, 1, 1, 1, 0.875, 0.625, 0.375, 0.125, 0, 0, 0, 0, 0, 0]);
  });

  it("blends down the picture the same way", () => {
    // 2 cells over 8 pixels: the top cell is subject, the bottom one is not
    const sampler = coverSampler(
      mask(2, (_x, y) => (y === 0 ? 255 : 0)),
      4,
      8,
    );
    const column = Array.from({ length: 8 }, (_, y) => row(sampler, y, 4)[0]);
    expect(column).toEqual([1, 1, 0.875, 0.625, 0.375, 0.125, 0, 0]);
  });

  it("works for a mask of one value, and for a picture of one pixel", () => {
    expect(
      row(
        coverSampler(
          mask(1, () => 51),
          5,
          3,
        ),
        1,
        5,
      ),
    ).toEqual([0.2, 0.2, 0.2, 0.2, 0.2].map((v) => Math.fround(v)));
    expect(
      row(
        coverSampler(
          mask(4, (x, y) => (x + y) * 10),
          1,
          1,
        ),
        0,
        1,
      ),
    ).toHaveLength(1);
  });

  it("does not change the mask", () => {
    const given = mask(4, (x, y) => x * 40 + y);
    const before = given.data.slice();
    coverSampler(given, 10, 10)(3, new Float32Array(10));
    expect(given.data).toEqual(before);
  });
});

describe("checkInputs", () => {
  const picture = { rgba: new Uint8ClampedArray(3 * 2 * 4), width: 3, height: 2 };

  it("accepts a picture and a mask whose buffers are the size they say", () => {
    expect(() =>
      checkInputs(
        picture,
        mask(2, () => 0),
      ),
    ).not.toThrow();
  });

  it("refuses a picture whose buffer is not width x height x 4, or that has no size", () => {
    expect(() =>
      checkInputs(
        { ...picture, rgba: new Uint8ClampedArray(10) },
        mask(2, () => 0),
      ),
    ).toThrow(RangeError);
    expect(() =>
      checkInputs(
        { rgba: new Uint8ClampedArray(0), width: 0, height: 0 },
        mask(2, () => 0),
      ),
    ).toThrow(RangeError);
  });

  it("refuses a mask whose buffer is not size x size, or that has no size", () => {
    expect(() => checkInputs(picture, { data: new Uint8ClampedArray(3), size: 2 })).toThrow(RangeError);
    expect(() => checkInputs(picture, { data: new Uint8ClampedArray(0), size: 0 })).toThrow(RangeError);
  });
});

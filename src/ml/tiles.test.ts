import { describe, expect, it } from "vitest";
import { MAX_OUTPUT_PIXELS, MAX_SIDE } from "./limits";
import { alphaOf, bleedColours, extractTile, hasTransparency, keepTile, planTiles, reflectIndex, upscaleChoices } from "./tiles";

/** RGBA bytes from a list of [r, g, b, a] pixels. */
const picture = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat());

describe("reflectIndex", () => {
  it("leaves an index inside the picture alone", () => {
    expect([0, 1, 4].map((i) => reflectIndex(i, 5))).toEqual([0, 1, 4]);
  });

  it("mirrors an index outside the picture, repeating the edge pixel", () => {
    expect([-1, -2, -5].map((i) => reflectIndex(i, 5))).toEqual([0, 1, 4]);
    expect([5, 6, 9].map((i) => reflectIndex(i, 5))).toEqual([4, 3, 0]);
  });

  it("keeps mirroring when the window reaches further than one picture away", () => {
    expect([-6, -10, -11].map((i) => reflectIndex(i, 5))).toEqual([4, 0, 0]);
    expect([10, 14, 15].map((i) => reflectIndex(i, 5))).toEqual([0, 4, 4]);
  });

  it("has only one pixel to give for a picture one pixel wide", () => {
    expect([-3, 0, 7].map((i) => reflectIndex(i, 1))).toEqual([0, 0, 0]);
  });
});

describe("planTiles", () => {
  it("makes one tile for a small picture, with the context all around it", () => {
    const plan = planTiles(100, 60, 256, 16);
    expect(plan.tiles).toEqual([{ x: 0, y: 0, width: 100, height: 60 }]);
    expect([plan.cols, plan.rows, plan.halo]).toEqual([1, 1, 16]);
    expect([plan.windowWidth, plan.windowHeight]).toEqual([132, 92]);
  });

  it("splits a picture into equal parts instead of a row of full tiles and a sliver", () => {
    const plan = planTiles(449, 100, 256, 16);
    expect(plan.tiles.map((t) => [t.x, t.width])).toEqual([
      [0, 150],
      [150, 150],
      [300, 149],
    ]);
    expect([plan.windowWidth, plan.windowHeight]).toEqual([182, 132]);
  });

  it("lists the tiles in reading order", () => {
    const plan = planTiles(1000, 500, 256, 16);
    expect([plan.cols, plan.rows]).toEqual([5, 3]);
    expect(plan.tiles).toHaveLength(15);
    expect(plan.tiles.slice(0, 6).map((t) => [t.x, t.y])).toEqual([
      [0, 0],
      [200, 0],
      [400, 0],
      [600, 0],
      [800, 0],
      [0, 167],
    ]);
  });

  it.each([
    [1, 1, 256, 16],
    [2, 3, 256, 16],
    [223, 224, 256, 16],
    [224, 225, 256, 16],
    [225, 1, 256, 16],
    [448, 448, 256, 16],
    [449, 450, 256, 16],
    [1000, 333, 256, 16],
    [13, 11, 64, 8],
    [9, 7, 35, 17],
  ])("covers every pixel of a %d x %d picture exactly once (tile %d, halo %d)", (width, height, tile, halo) => {
    const plan = planTiles(width, height, tile, halo);
    const seen = new Uint8Array(width * height);
    for (const t of plan.tiles) {
      expect(t.width).toBeGreaterThanOrEqual(1);
      expect(t.height).toBeGreaterThanOrEqual(1);
      expect(t.width + 2 * halo).toBeLessThanOrEqual(tile);
      expect(t.height + 2 * halo).toBeLessThanOrEqual(tile);
      expect(t.x + t.width).toBeLessThanOrEqual(width);
      expect(t.y + t.height).toBeLessThanOrEqual(height);
      for (let y = t.y; y < t.y + t.height; y++) {
        for (let x = t.x; x < t.x + t.width; x++) seen[y * width + x] = seen[y * width + x]! + 1;
      }
    }
    expect(seen.every((n) => n === 1)).toBe(true);
    expect(plan.tiles).toHaveLength(plan.cols * plan.rows);
  });

  it("refuses sizes that make no sense", () => {
    expect(() => planTiles(0, 10, 256, 16)).toThrow(RangeError);
    expect(() => planTiles(10, -1, 256, 16)).toThrow(RangeError);
    expect(() => planTiles(10.5, 10, 256, 16)).toThrow(RangeError);
    expect(() => planTiles(10, 10, 32, 16)).toThrow(RangeError); // no room left for the part the tile keeps
    expect(() => planTiles(10, 10, 256, -1)).toThrow(RangeError);
    expect(() => planTiles(10, 10, 256, 0.5)).toThrow(RangeError);
  });
});

describe("extractTile", () => {
  it("gives the colours of the window as planar numbers from 0 to 1, mirroring the picture where the window leaves it", () => {
    // 3 x 1 picture, 2 pixels of context all around: the window is 7 x 5
    const rgba = picture([10, 40, 70, 255], [20, 50, 80, 255], [30, 60, 90, 255]);
    const plan = planTiles(3, 1, 7, 2);
    const out = extractTile(rgba, 3, 1, plan, plan.tiles[0]!);
    expect(out).toHaveLength(3 * 7 * 5);
    const reds = [20, 10, 10, 20, 30, 30, 20].map((v) => v / 255);
    for (let row = 0; row < 5; row++) reds.forEach((v, x) => expect(out[row * 7 + x]).toBeCloseTo(v, 6));
    expect(out[35]).toBeCloseTo(50 / 255, 6); // the first green is the picture's second pixel, mirrored
    expect(out[70]).toBeCloseTo(80 / 255, 6); // and so is the first blue
  });

  it("takes the window of a tile that is not the first one from the picture, not from the mirror", () => {
    const rgba = picture(...[0, 10, 20, 30, 40, 50].map((v) => [v, 0, 0, 255]));
    const plan = planTiles(6, 1, 5, 1);
    expect(plan.tiles.map((t) => t.x)).toEqual([0, 3]);
    const out = extractTile(rgba, 6, 1, plan, plan.tiles[1]!);
    expect(Array.from(out.subarray(0, 5)).map((v) => Math.round(v * 255))).toEqual([20, 30, 40, 50, 50]);
  });

  it("refuses pixels that do not belong to a picture of that size", () => {
    const plan = planTiles(2, 2, 256, 16);
    expect(() => extractTile(new Uint8ClampedArray(15), 2, 2, plan, plan.tiles[0]!)).toThrow(RangeError);
  });
});

describe("keepTile", () => {
  // a 2 x 1 piece with 1 pixel of context: the window is 4 x 3, and the model makes it twice as large: 8 x 6
  const plan = planTiles(2, 1, 4, 1);
  const tile = plan.tiles[0]!;
  const output = (value: (channel: number, x: number, y: number) => number) => {
    const out = new Float32Array(3 * 8 * 6);
    for (let c = 0; c < 3; c++) for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) out[c * 48 + y * 8 + x] = value(c, x, y);
    return out;
  };

  it("cuts the context away and gives the rest as RGBA bytes", () => {
    const kept = keepTile(
      output((c, x, y) => (c * 100 + y * 8 + x) / 255),
      plan,
      tile,
      2,
      2,
    );
    expect([kept.width, kept.height]).toEqual([4, 2]);
    expect(kept.rgba).toHaveLength(4 * 2 * 4);
    // the kept part starts 2 output pixels in from the left and from the top
    expect(Array.from(kept.rgba.subarray(0, 4))).toEqual([18, 118, 218, 255]);
    expect(Array.from(kept.rgba.subarray((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 4))).toEqual([29, 129, 229, 255]);
  });

  it("averages blocks of pixels when the result is smaller than the model's output", () => {
    // every 2 x 2 block holds one value, so the average of a block is that value
    const kept = keepTile(
      output((c, x, y) => (c * 60 + (y >> 1) * 10 + (x >> 1)) / 255),
      plan,
      tile,
      2,
      1,
    );
    expect([kept.width, kept.height]).toEqual([2, 1]);
    expect(Array.from(kept.rgba)).toEqual([11, 71, 131, 255, 12, 72, 132, 255]);
  });

  it("averages unequal pixels, not just equal ones", () => {
    // the first kept block is 0, 1, 1, 1 (a quarter of the way to black): 0.75 of 255 is 191
    const out = output(() => 1);
    for (let c = 0; c < 3; c++) out[c * 48 + 2 * 8 + 2] = 0;
    const kept = keepTile(out, plan, tile, 2, 1);
    expect(Array.from(kept.rgba.subarray(0, 4))).toEqual([191, 191, 191, 255]);
  });

  it("clamps numbers outside 0 to 1, and turns a number that is not one into black", () => {
    const out = output(() => 0.2);
    out[2 * 8 + 2] = -0.5;
    out[2 * 8 + 3] = 1.7;
    out[2 * 8 + 4] = Number.NaN;
    const kept = keepTile(out, plan, tile, 2, 2);
    expect(Array.from(kept.rgba.subarray(0, 12))).toEqual([0, 51, 51, 255, 255, 51, 51, 255, 0, 51, 51, 255]);
  });

  it("clamps before it averages, so an overshoot cannot brighten its neighbours", () => {
    const out = output(() => 0);
    out[2 * 8 + 2] = 4; // far above 1: counts as 1, not as 4
    const kept = keepTile(out, plan, tile, 2, 1);
    expect(kept.rgba[0]).toBe(64); // a quarter of 255
  });

  it("refuses an output of the wrong size, and a result size that is not a whole fraction of the model's", () => {
    expect(() => keepTile(new Float32Array(10), plan, tile, 2, 2)).toThrow(RangeError);
    expect(() =>
      keepTile(
        output(() => 0),
        plan,
        tile,
        2,
        3,
      ),
    ).toThrow(RangeError);
  });
});

describe("hasTransparency", () => {
  it("is false for a solid picture, and for no picture at all", () => {
    expect(hasTransparency(picture([1, 2, 3, 255], [4, 5, 6, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray(0))).toBe(false);
  });

  it("is true as soon as one pixel is not fully solid", () => {
    expect(hasTransparency(picture([1, 2, 3, 255], [4, 5, 6, 254]))).toBe(true);
    expect(hasTransparency(picture([1, 2, 3, 0]))).toBe(true);
  });
});

describe("alphaOf", () => {
  it("gives the opacity of every pixel", () => {
    expect(Array.from(alphaOf(picture([9, 9, 9, 0], [9, 9, 9, 128], [9, 9, 9, 255])))).toEqual([0, 128, 255]);
  });
});

describe("bleedColours", () => {
  const red = [255, 0, 0, 255];
  const clear = [0, 0, 0, 0];

  it("leaves a solid picture as it is", () => {
    const solid = picture(red, [0, 255, 0, 255]);
    expect(Array.from(bleedColours(solid, 2, 1))).toEqual(Array.from(solid));
  });

  it("gives a transparent pixel the colour of the nearest solid one, and keeps its opacity", () => {
    const out = bleedColours(picture(red, clear, clear), 3, 1);
    expect(Array.from(out)).toEqual([255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0]);
  });

  it("takes the colour of the closer one of two solid pixels", () => {
    const out = bleedColours(picture(red, clear, clear, clear, [0, 0, 255, 255]), 5, 1);
    expect(Array.from(out.subarray(4, 8))).toEqual([255, 0, 0, 0]);
    expect(Array.from(out.subarray(12, 16))).toEqual([0, 0, 255, 0]);
    expect([255, 0].includes(out[8]!)).toBe(true); // the middle one is as far from either: red or blue, but a solid colour
    expect(out[9]).toBe(0);
  });

  it("goes by the nearest pixel across rows too", () => {
    // 2 x 2: the solid pixel is at the top left, the others are clear
    const out = bleedColours(picture(red, clear, clear, clear), 2, 2);
    for (const i of [1, 2, 3]) expect(Array.from(out.subarray(i * 4, i * 4 + 3))).toEqual([255, 0, 0]);
  });

  it("replaces the colour of a pixel that is mostly transparent, and keeps one that is mostly solid", () => {
    const out = bleedColours(picture(red, [0, 255, 0, 200], [0, 0, 255, 100]), 3, 1);
    expect(Array.from(out.subarray(4, 7))).toEqual([0, 255, 0]); // 200 of 255: its colour is trusted
    expect(Array.from(out.subarray(8, 11))).toEqual([0, 255, 0]); // 100 of 255: it takes the green next to it
  });

  it("fills what is too far from any solid pixel with the average colour of the solid ones", () => {
    const row = [[200, 0, 0, 255], ...Array(8).fill(clear), [0, 0, 100, 255]];
    const out = bleedColours(picture(...row), 10, 1, { reach: 1 });
    expect(Array.from(out.subarray(4, 7))).toEqual([200, 0, 0]); // within reach of the red
    expect(Array.from(out.subarray(4 * 4, 4 * 4 + 3))).toEqual([100, 0, 50]); // out of reach of both: the average
    expect(Array.from(out.subarray(8 * 4, 8 * 4 + 3))).toEqual([0, 0, 100]); // within reach of the blue
  });

  it("has nothing to copy from when no pixel is solid, so the colours stay", () => {
    const faint = picture([10, 20, 30, 10], [40, 50, 60, 20]);
    expect(Array.from(bleedColours(faint, 2, 1))).toEqual(Array.from(faint));
  });

  it("does not change the picture it is given", () => {
    const source = picture(red, clear);
    const before = Array.from(source);
    bleedColours(source, 2, 1);
    expect(Array.from(source)).toEqual(before);
  });

  it("refuses pixels that do not belong to a picture of that size", () => {
    expect(() => bleedColours(new Uint8ClampedArray(7), 2, 1)).toThrow(RangeError);
  });
});

describe("upscaleChoices", () => {
  it("lists the sizes of the result for each factor, and whether it stays within the limits", () => {
    expect(upscaleChoices(1000, 750)).toEqual([
      { factor: 2, width: 2000, height: 1500, fits: true },
      { factor: 4, width: 4000, height: 3000, fits: true },
    ]);
  });

  it("does not offer a factor that would make the result larger than 25 megapixels", () => {
    expect(MAX_OUTPUT_PIXELS).toBe(25_000_000);
    const choices = upscaleChoices(2000, 1500);
    expect(choices.map((c) => c.fits)).toEqual([true, false]); // 4000 x 3000 is fine, 8000 x 6000 is 48 megapixels
    expect(upscaleChoices(1250, 1250).map((c) => c.fits)).toEqual([true, true]); // 5000 x 5000 is exactly 25 megapixels
    expect(upscaleChoices(1251, 1250).map((c) => c.fits)).toEqual([true, false]);
  });

  it("does not offer a factor that would make a side longer than a canvas can be", () => {
    expect(MAX_SIDE).toBe(16_384);
    expect(upscaleChoices(8192, 100).map((c) => c.fits)).toEqual([true, false]); // 32768 wide at 4x
    expect(upscaleChoices(8193, 100).map((c) => c.fits)).toEqual([false, false]); // 16386 wide at 2x
  });

  it("offers nothing for a picture without a size", () => {
    expect(upscaleChoices(0, 100).every((c) => !c.fits)).toBe(true);
  });
});

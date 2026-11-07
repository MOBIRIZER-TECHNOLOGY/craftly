import { describe, expect, it } from "vitest";
import { createColourPop, popAmount, popColourBehindSubject, POP_STYLES } from "./colourPop";
import type { CoverageMask, Picture } from "./coverage";

/** A picture whose pixel at x, y is `colour(x, y)`: [red, green, blue] (opaque) or [red, green, blue, alpha]. */
function picture(width: number, height: number, colour: (x: number, y: number) => readonly number[]): Picture {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = colour(x, y);
      rgba.set([r!, g!, b!, a], (y * width + x) * 4);
    }
  }
  return { rgba, width, height };
}

/** A square mask of size x size values, 0 (background) to 255 (subject). */
function coverage(size: number, at: (x: number, y: number) => number): CoverageMask & { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = at(x, y);
  return { data, size };
}

const pixelAt = (p: Picture, x: number, y: number) => Array.from(p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));
const channel = (p: Picture, x: number, y: number, c = 0) => p.rgba[(y * p.width + x) * 4 + c]!;

/** The grey of (200, 100, 50) by the weights of the CSS grayscale() filter: 0.2126 x 200 + 0.7152 x 100 + 0.0722 x 50. */
const GREY = 0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50; // 117.65

/** The same numbers on every run: pictures with texture, without a random generator. */
function noise(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("the styles", () => {
  it("are black and white, which takes all the colour out, and faded, which takes out 60 % of it", () => {
    expect(POP_STYLES).toEqual(["black-and-white", "faded"]);
    expect(popAmount("black-and-white")).toBe(1);
    expect(popAmount("faded")).toBe(0.6);
  });
});

describe("popColourBehindSubject", () => {
  it("makes the background grey with the weights of the app's own black and white filter", () => {
    const p = picture(6, 4, () => [200, 100, 50]);
    expect(
      popColourBehindSubject(
        p,
        coverage(3, () => 0),
        1,
      ),
    ).toBe(24);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) expect(pixelAt(p, x, y)).toEqual([118, 118, 118, 255]); // 117.65
  });

  it("takes out only a share of the colour when asked to: 60 % leaves 40 % of the way back to the colour", () => {
    const p = picture(4, 4, () => [200, 100, 50]);
    popColourBehindSubject(
      p,
      coverage(2, () => 0),
      0.6,
    );
    // each channel moves 60 % of the way to the grey: 200 -> 150.6, 100 -> 110.6, 50 -> 90.6
    expect(pixelAt(p, 2, 2)).toEqual([Math.round(200 + (GREY - 200) * 0.6), Math.round(100 + (GREY - 100) * 0.6), Math.round(50 + (GREY - 50) * 0.6), 255]);
    expect(pixelAt(p, 2, 2)).toEqual([151, 111, 91, 255]);
  });

  it("leaves the subject exactly as it was, byte for byte, and greys the rest", () => {
    const random = noise(5);
    const p = picture(24, 12, () => [random() * 255, random() * 255, random() * 255]);
    const before = p.rgba.slice();
    popColourBehindSubject(
      p,
      coverage(24, (x) => (x < 12 ? 255 : 0)),
      1,
    ); // the left half is the subject
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) expect(pixelAt(p, x, y)).toEqual(Array.from(before.subarray((y * 24 + x) * 4, (y * 24 + x) * 4 + 4)));
    for (let y = 0; y < 12; y++) for (let x = 12; x < 24; x++) expect(new Set([channel(p, x, y, 0), channel(p, x, y, 1), channel(p, x, y, 2)]).size).toBe(1); // red = green = blue
  });

  it("changes nothing when the whole picture is the subject, or when no colour is asked to go", () => {
    const p = picture(8, 8, (x, y) => [x * 30, y * 30, 7]);
    const before = p.rgba.slice();
    expect(
      popColourBehindSubject(
        p,
        coverage(4, () => 255),
        1,
      ),
    ).toBe(0);
    expect(
      popColourBehindSubject(
        p,
        coverage(4, () => 0),
        0,
      ),
    ).toBe(0);
    expect(p.rgba).toEqual(before);
  });

  it("blends with the mask at the outline, whatever size the mask has: the colour fades out over the pixels the mask fades over", () => {
    // a 4 x 4 mask over a 16 x 16 picture: coverage by column is 1 for 0 to 5, then 0.875, 0.625, 0.375, 0.125, then 0
    const p = picture(16, 16, () => [200, 100, 50]);
    popColourBehindSubject(
      p,
      coverage(4, (x) => (x < 2 ? 255 : 0)),
      1,
    );
    const red = Array.from({ length: 12 }, (_, x) => channel(p, x, 8));
    // c x 200 + (1 - c) x 117.65, rounded: 189.7, 169.1, 148.5, 127.9 and then the grey itself
    expect(red).toEqual([200, 200, 200, 200, 200, 200, 190, 169, 149, 128, 118, 118]);
  });

  it("never touches the opacity, and leaves pixels that are not there as they are", () => {
    const p = picture(8, 8, (x, y) => (x < 3 ? [200, 100, 50, 0] : y < 3 ? [200, 100, 50, 128] : [200, 100, 50, 255]));
    const before = p.rgba.slice();
    popColourBehindSubject(
      p,
      coverage(4, () => 0),
      1,
    );
    for (let i = 3; i < p.rgba.length; i += 4) expect(p.rgba[i]).toBe(before[i]);
    expect(pixelAt(p, 1, 5)).toEqual([200, 100, 50, 0]); // nothing there: its colour is not touched
    expect(pixelAt(p, 5, 1)).toEqual([118, 118, 118, 128]); // half there: grey, half there
  });

  it("leaves grey alone, and does not count what changed by less than it can be seen", () => {
    const grey = picture(6, 6, () => [90, 90, 90]);
    expect(
      popColourBehindSubject(
        grey,
        coverage(3, () => 0),
        1,
      ),
    ).toBe(0);
    // grey of (100, 101, 100) is 100.7: no channel moves by two levels
    const nearly = picture(6, 6, () => [100, 101, 100]);
    expect(
      popColourBehindSubject(
        nearly,
        coverage(3, () => 0),
        1,
      ),
    ).toBe(0);
    expect(pixelAt(nearly, 2, 2)).toEqual([101, 101, 101, 255]);
  });

  it("does not count pixels that are mostly not there: the faint rim of a cut-out is not background", () => {
    const p = picture(8, 8, (x) => (x < 4 ? [200, 100, 50, 40] : [200, 100, 50, 128]));
    // both halves are greyed, but only the half that is at least half there counts
    expect(
      popColourBehindSubject(
        p,
        coverage(4, () => 0),
        1,
      ),
    ).toBe(32);
    expect(pixelAt(p, 1, 1)).toEqual([118, 118, 118, 40]);
    expect(pixelAt(p, 6, 1)).toEqual([118, 118, 118, 128]);
  });

  it("greys the subject side of a soft outline a little, but does not count that: it is not the background's colour going", () => {
    // coverage 0.749 everywhere: the colour of every pixel goes a quarter of the way to its grey, and none of them is background
    const p = picture(6, 6, () => [200, 100, 50]);
    expect(
      popColourBehindSubject(
        p,
        coverage(3, () => 191),
        1,
      ),
    ).toBe(0);
    expect(pixelAt(p, 2, 2)).toEqual([179, 104, 67, 255]); // 0.749 x 200 + 0.251 x 117.65 and so on
  });

  it("counts the pixels it changed", () => {
    const p = picture(10, 10, (x) => (x < 5 ? [200, 100, 50] : [90, 90, 90]));
    expect(
      popColourBehindSubject(
        p,
        coverage(10, (x, y) => (y < 4 ? 255 : 0)),
        1,
      ),
    ).toBe(30); // 6 rows of the coloured half, 5 pixels each
  });

  it("does not change the mask it was given", () => {
    const mask = coverage(8, (x, y) => (x + y) * 15);
    const before = mask.data.slice();
    popColourBehindSubject(
      picture(24, 24, (x, y) => [x * 10, y * 10, 0]),
      mask,
      1,
    );
    expect(mask.data).toEqual(before);
  });

  it("refuses buffers that do not match the sizes they come with", () => {
    expect(() =>
      popColourBehindSubject(
        { rgba: new Uint8ClampedArray(10), width: 3, height: 3 },
        coverage(2, () => 0),
        1,
      ),
    ).toThrow(RangeError);
    expect(() =>
      popColourBehindSubject(
        picture(3, 3, () => [0, 0, 0]),
        { data: new Uint8ClampedArray(3), size: 2 },
        1,
      ),
    ).toThrow(RangeError);
  });
});

describe("createColourPop, a few rows at a time", () => {
  const textured = () => {
    const random = noise(21);
    return picture(37, 29, () => [random() * 255, random() * 255, random() * 255]);
  };
  const disc = () => coverage(16, (x, y) => Math.max(0, Math.min(255, (5 - Math.hypot(x - 7.5, y - 7.5)) * 80)));

  it("gives the same picture, and the same count, however the rows are split, so the work can be done in pieces", () => {
    const whole = textured();
    const total = popColourBehindSubject(whole, disc(), 1);

    const pieces = textured();
    const pop = createColourPop(pieces, disc(), 1);
    let counted = 0;
    for (const [from, to] of [
      [0, 4],
      [4, 5],
      [5, 29],
    ] as const)
      counted += pop.paintRows(from, to);
    expect(pieces.rgba).toEqual(whole.rgba);
    expect(counted).toBe(total);
    expect(total).toBeGreaterThan(500);
  });
});

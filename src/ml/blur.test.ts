import { describe, expect, it } from "vitest";
import { BLUR_STRENGTHS, blurBehindSubject, blurSigma, boxSizes, createBackgroundBlur, planBlur } from "./blur";
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

/** The same numbers on every run: pictures with texture, without a random generator. */
function noise(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("blurSigma", () => {
  it("grows with the strength", () => {
    const [light, medium, strong] = BLUR_STRENGTHS.map((s) => blurSigma(1200, 800, s));
    expect(light).toBeLessThan(medium!);
    expect(medium).toBeLessThan(strong!);
  });

  it("is 0.5, 1.2 and 2.5 per cent of the longer side for light, medium and strong", () => {
    expect(blurSigma(1000, 500, "light")).toBeCloseTo(5, 9);
    expect(blurSigma(1000, 500, "medium")).toBeCloseTo(12, 9);
    expect(blurSigma(1000, 500, "strong")).toBeCloseTo(25, 9);
  });

  it("goes by the longer side, so a photo and the same photo turned look alike", () => {
    expect(blurSigma(1200, 800, "medium")).toBe(blurSigma(800, 1200, "medium"));
  });

  it("is a fixed share of the picture, so the look does not depend on the resolution", () => {
    expect(blurSigma(4000, 3000, "medium")).toBeCloseTo(blurSigma(1000, 750, "medium") * 4, 9);
  });

  it("never drops below two pixels, which a very small picture would not show", () => {
    expect(blurSigma(100, 50, "light")).toBe(2);
    expect(blurSigma(1, 1, "strong")).toBe(2);
  });

  it("offers three strengths, light first", () => {
    expect(BLUR_STRENGTHS).toEqual(["light", "medium", "strong"]);
  });
});

describe("boxSizes", () => {
  it("makes three odd widths whose passes together blur about as much as the standard deviation asked for", () => {
    for (const sigma of [2, 3, 4, 6, 8, 12, 24]) {
      const widths = boxSizes(sigma);
      expect(widths).toHaveLength(3);
      for (const w of widths) expect(w % 2).toBe(1);
      const variance = widths.reduce((sum, w) => sum + (w * w - 1) / 12, 0); // a box of width w has variance (w*w - 1) / 12
      expect(Math.sqrt(variance) / sigma).toBeGreaterThan(0.88);
      expect(Math.sqrt(variance) / sigma).toBeLessThan(1.12);
    }
  });

  it("blurs more with a larger deviation", () => {
    const spread = (sigma: number) => boxSizes(sigma).reduce((sum, w) => sum + (w * w - 1) / 12, 0);
    expect(spread(3)).toBeLessThan(spread(6));
    expect(spread(6)).toBeLessThan(spread(12));
  });
});

describe("planBlur", () => {
  it("works at full size when the blur is small", () => {
    expect(planBlur(1000, 600, 3)).toMatchObject({ step: 1, cols: 1000, rows: 600 });
  });

  it("works on a smaller grid when the blur is wide, because a wide blur is smooth anyway", () => {
    expect(planBlur(1000, 600, 8)).toMatchObject({ step: 2, cols: 500, rows: 300 });
    expect(planBlur(1001, 601, 20)).toMatchObject({ step: 5, cols: 201, rows: 121 });
  });

  it("keeps the blur on that grid between four and eight cells, so it stays smooth and the work stays small", () => {
    const plan = planBlur(3000, 2000, 36);
    expect(plan.step).toBe(9);
    const reduced = Math.sqrt(plan.boxes.reduce((sum, w) => sum + (w * w - 1) / 12, 0));
    expect(reduced).toBeGreaterThan(3.5);
    expect(reduced).toBeLessThan(8.5);
  });

  it("never reduces the grid by more than sixteen times", () => {
    expect(planBlur(5000, 4000, 125).step).toBe(16);
    expect(planBlur(5000, 4000, 900).step).toBe(16);
  });
});

describe("blurBehindSubject", () => {
  it("changes nothing when the whole picture is the subject", () => {
    const p = picture(20, 10, (x, y) => [x * 12, y * 25, 7 * x + y]);
    const before = p.rgba.slice();
    blurBehindSubject(
      p,
      coverage(4, () => 255),
      6,
    );
    expect(p.rgba).toEqual(before);
  });

  it("changes nothing when the blur is too small to see", () => {
    const p = picture(20, 10, (x, y) => [x * 12, y * 25, 7 * x + y]);
    const before = p.rgba.slice();
    blurBehindSubject(
      p,
      coverage(4, () => 0),
      0.3,
    );
    expect(p.rgba).toEqual(before);
  });

  it("leaves the subject exactly as it was, byte for byte, and blurs the rest", () => {
    const random = noise(7);
    const p = picture(24, 12, () => [random() * 255, random() * 255, random() * 255]);
    const before = p.rgba.slice();
    blurBehindSubject(
      p,
      coverage(24, (x) => (x < 12 ? 255 : 0)),
      3,
    ); // the left half is the subject
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) expect(pixelAt(p, x, y)).toEqual(Array.from(before.subarray((y * 24 + x) * 4, (y * 24 + x) * 4 + 4)));
    let changed = 0;
    for (let y = 0; y < 12; y++) for (let x = 12; x < 24; x++) if (p.rgba[(y * 24 + x) * 4] !== before[(y * 24 + x) * 4]) changed++;
    expect(changed).toBeGreaterThan(100); // of 144 pixels
  });

  it("does not let the subject's colour bleed into the blurred background: a plain background stays exactly as it was", () => {
    // a naive blur of the whole picture would put a red halo around the disc; this one only averages what is behind it
    const n = 40;
    const inside = (x: number, y: number) => (x - 20) ** 2 + (y - 20) ** 2 <= 8 ** 2;
    const p = picture(n, n, (x, y) => (inside(x, y) ? [250, 10, 10] : [30, 60, 90]));
    const before = p.rgba.slice();
    blurBehindSubject(
      p,
      coverage(n, (x, y) => (inside(x, y) ? 255 : 0)),
      6,
    );
    expect(p.rgba).toEqual(before);
  });

  it("keeps that exact on a smaller working grid, and when the size is not a multiple of the grid", () => {
    for (const [n, sigma] of [
      [64, 24],
      [61, 16],
      [47, 9],
    ] as const) {
      const inside = (x: number, y: number) => (x - n / 2) ** 2 + (y - n / 2) ** 2 <= (n / 5) ** 2;
      const p = picture(n, n, (x, y) => (inside(x, y) ? [250, 10, 10] : [30, 60, 90]));
      const before = p.rgba.slice();
      blurBehindSubject(
        p,
        coverage(n, (x, y) => (inside(x, y) ? 255 : 0)),
        sigma,
      );
      expect(planBlur(n, n, sigma).step).toBeGreaterThan(1);
      expect(p.rgba).toEqual(before);
    }
  });

  it("keeps every blurred colour between the colours that were behind the subject", () => {
    // a row: background 10, a bright subject, background 50. Averaging the whole row would push the pixels next to the subject above 50.
    const p = picture(30, 1, (x) => (x >= 10 && x < 14 ? [255, 255, 255] : x < 10 ? [10, 10, 10] : [50, 50, 50]));
    blurBehindSubject(
      p,
      coverage(30, (x) => (x >= 10 && x < 14 ? 255 : 0)),
      4,
    );
    for (let x = 0; x < 30; x++) {
      if (x >= 10 && x < 14) {
        expect(channel(p, x, 0)).toBe(255);
      } else {
        expect(channel(p, x, 0)).toBeGreaterThanOrEqual(10);
        expect(channel(p, x, 0)).toBeLessThanOrEqual(50);
      }
    }
    expect(channel(p, 0, 0)).toBe(10); // far from the right half the blur only sees the left one
    expect(channel(p, 9, 0)).toBeGreaterThan(10); // next to the subject it reaches round it to the other side
  });

  it("counts the pixels at the edge of the subject for less than the pixels well behind it", () => {
    // the same row twice: two light pixels next to the subject are either almost subject (coverage 0.45) or plain background
    const row = (edgeCoverage: number) => {
      const p = picture(30, 1, (x) => (x < 10 ? [0, 0, 0] : x < 12 ? [200, 200, 200] : [255, 255, 255]));
      blurBehindSubject(
        p,
        coverage(30, (x) => (x < 10 ? 0 : x < 12 ? edgeCoverage : 255)),
        3,
      );
      return channel(p, 5, 0);
    };
    expect(row(115)).toBeLessThan(row(0)); // 115 of 255: a weight of about a tenth, against a whole
    expect(row(0)).toBeGreaterThan(0);
  });

  it("does not move a smooth background when it is blurred on a coarse grid: a ramp comes out as it went in", () => {
    // a blur that is the same on both sides keeps a straight ramp as it is, so any shift between the grid and the picture shows as a difference
    for (const sigma of [24, 36]) {
      const p = picture(600, 20, (x) => {
        const v = Math.min(255, Math.max(0, x - 100)); // a ramp from x = 100 to 355, one step per pixel
        return [v, v, v];
      });
      expect(planBlur(600, 20, sigma).step).toBeGreaterThanOrEqual(6);
      blurBehindSubject(
        p,
        coverage(20, () => 0),
        sigma,
      );
      for (let x = 215; x < 245; x++) expect(Math.abs(channel(p, x, 10) - (x - 100))).toBeLessThanOrEqual(1); // further from its ends than the blur reaches
    }
  });

  it("and the same from top to bottom", () => {
    for (const sigma of [24, 36]) {
      const p = picture(20, 600, (_x, y) => {
        const v = Math.min(255, Math.max(0, y - 100));
        return [v, v, v];
      });
      blurBehindSubject(
        p,
        coverage(20, () => 0),
        sigma,
      );
      for (let y = 215; y < 245; y++) expect(Math.abs(channel(p, 10, y) - (y - 100))).toBeLessThanOrEqual(1);
    }
  });

  it("stands in the average colour of the background where there is none within reach, for a soft spot of the mask inside the subject", () => {
    // background at the left end only; the mask is 0.9 at x = 60, much further than the blur reaches
    const p = picture(80, 1, (x) => (x < 5 ? [20, 20, 20] : [200, 200, 200]));
    blurBehindSubject(
      p,
      coverage(80, (x) => (x < 5 ? 0 : x === 60 ? 230 : 255)),
      3,
    );
    const c = 230 / 255;
    expect(channel(p, 60, 0)).toBe(Math.round(c * 200 + (1 - c) * 20));
    expect(channel(p, 59, 0)).toBe(200); // the rest of the subject is untouched
  });

  it("smooths a background that has fine detail", () => {
    const p = picture(60, 60, (x, y) => (x < 10 && y < 10 ? [255, 255, 255] : x % 2 === 0 ? [0, 0, 0] : [200, 200, 200]));
    blurBehindSubject(
      p,
      coverage(60, (x, y) => (x < 10 && y < 10 ? 255 : 0)),
      6,
    );
    for (let x = 30; x < 50; x++) {
      expect(Math.abs(channel(p, x, 40) - channel(p, x + 1, 40))).toBeLessThan(10); // it was 200
      expect(channel(p, x, 40)).toBeGreaterThan(85); // the stripes average out to the middle
      expect(channel(p, x, 40)).toBeLessThan(115);
    }
  });

  it("blurs a picture that has no subject at all, like an ordinary blur", () => {
    const p = picture(31, 31, (x, y) => (x === 15 && y === 15 ? [255, 255, 255] : [0, 0, 0]));
    blurBehindSubject(
      p,
      coverage(31, () => 0),
      4,
    );
    expect(channel(p, 15, 15)).toBeLessThan(25);
    expect(channel(p, 17, 15)).toBeGreaterThan(0);
    expect(channel(p, 15, 17)).toBe(channel(p, 17, 15)); // the same in every direction
    expect(channel(p, 13, 15)).toBe(channel(p, 17, 15));
  });

  it("blurs a little with a deviation of one pixel too, where two of the three boxes are a single pixel wide", () => {
    expect(boxSizes(1)).toEqual([1, 1, 3]);
    const p = picture(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255] : [0, 0, 0]));
    blurBehindSubject(
      p,
      coverage(21, () => 0),
      1,
    );
    // one box of three pixels in each direction: the bright pixel becomes a 3 x 3 block of a ninth of its brightness
    expect(channel(p, 10, 10)).toBe(28);
    expect(channel(p, 11, 11)).toBe(28);
    expect(channel(p, 9, 10)).toBe(28);
    expect(channel(p, 12, 10)).toBe(0);
  });

  it("blurs more with a larger deviation", () => {
    const peak = (sigma: number) => {
      const p = picture(61, 61, (x, y) => (x === 30 && y === 30 ? [255, 255, 255] : [0, 0, 0]));
      blurBehindSubject(
        p,
        coverage(61, () => 0),
        sigma,
      );
      return channel(p, 30, 30);
    };
    expect(peak(2)).toBeGreaterThan(peak(4));
    expect(peak(4)).toBeGreaterThan(peak(8));
  });

  it("never touches the opacity, and pixels that are not there add no colour to what is behind the subject", () => {
    const p = picture(30, 30, (x, y) => {
      if (x < 6 && y < 6) return [255, 0, 0, 255]; // the subject
      if (x >= 10 && x < 20 && y >= 10 && y < 20) return [0, 0, 0, 0]; // a hole in the background
      if (x >= 22) return [200, 100, 50, 128]; // half-transparent
      return [200, 100, 50, 255];
    });
    const before = p.rgba.slice();
    blurBehindSubject(
      p,
      coverage(30, (x, y) => (x < 6 && y < 6 ? 255 : 0)),
      4,
    );
    for (let i = 3; i < p.rgba.length; i += 4) expect(p.rgba[i]).toBe(before[i]);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        if (x >= 10 && x < 20 && y >= 10 && y < 20)
          expect(pixelAt(p, x, y)).toEqual([0, 0, 0, 0]); // still nothing
        else expect(pixelAt(p, x, y).slice(0, 3)).toEqual(Array.from(before.subarray((y * 30 + x) * 4, (y * 30 + x) * 4 + 3))); // no darkening from the hole
      }
    }
  });

  it("puts the mask over the picture whatever size it has, blending between its values", () => {
    // a 4 x 4 mask over a 16 x 16 picture: subject on the left half; the picture's colours do not agree with it at the border
    const p = picture(16, 16, (x) => (x < 8 ? [240, 240, 240] : [40, 40, 40]));
    blurBehindSubject(
      p,
      coverage(4, (x) => (x < 2 ? 255 : 0)),
      4,
    );
    const row = Array.from({ length: 12 }, (_, x) => channel(p, x, 8));
    // coverage by column: 1, 1, 1, 1, 1, 1, 0.875, 0.625, 0.375, 0.125, 0, 0; the background behind it is a plain 40
    expect(row.slice(0, 6)).toEqual([240, 240, 240, 240, 240, 240]);
    expect(row.slice(6, 8)).toEqual([0.875 * 240 + 0.125 * 40, 0.625 * 240 + 0.375 * 40]); // 215, 165
    expect(row.slice(8)).toEqual([40, 40, 40, 40]);
  });

  it("does not change the mask it was given", () => {
    const mask = coverage(8, (x, y) => (x + y) * 15);
    const before = mask.data.slice();
    blurBehindSubject(
      picture(24, 24, (x, y) => [x * 10, y * 10, 0]),
      mask,
      5,
    );
    expect(mask.data).toEqual(before);
  });

  it("refuses buffers that do not match the sizes they come with", () => {
    expect(() =>
      blurBehindSubject(
        { rgba: new Uint8ClampedArray(10), width: 3, height: 3 },
        coverage(2, () => 0),
        4,
      ),
    ).toThrow(RangeError);
    expect(() =>
      blurBehindSubject(
        picture(3, 3, () => [0, 0, 0]),
        { data: new Uint8ClampedArray(3), size: 2 },
        4,
      ),
    ).toThrow(RangeError);
    expect(() =>
      blurBehindSubject(
        { rgba: new Uint8ClampedArray(0), width: 0, height: 0 },
        coverage(2, () => 0),
        4,
      ),
    ).toThrow(RangeError);
  });
});

describe("createBackgroundBlur, a few rows at a time", () => {
  const textured = () => {
    const random = noise(11);
    return picture(37, 29, (x, y) => [(x * 7 + y * 3) % 256, random() * 255, (x * y) % 256]);
  };
  // a soft disc: 255 in the middle, falling to 0 over a few cells
  const disc = () => coverage(16, (x, y) => Math.max(0, Math.min(255, (5 - Math.hypot(x - 7.5, y - 7.5)) * 80)));

  it("gives the same picture however the rows are split, so the work can be done in pieces", () => {
    const whole = textured();
    blurBehindSubject(whole, disc(), 8);

    const pieces = textured();
    const blur = createBackgroundBlur(pieces, disc(), 8);
    for (const [from, to] of [
      [0, 5],
      [5, 6],
      [6, 29],
    ] as const)
      blur.addRows(from, to);
    expect(blur.solve()).toBe(true);
    for (const [from, to] of [
      [0, 2],
      [2, 9],
      [9, 10],
      [10, 29],
    ] as const)
      blur.paintRows(from, to);
    expect(pieces.rgba).toEqual(whole.rgba);
  });

  it("says there is nothing to blur when all that is around the subject is the faint rim of an anti-aliased edge, as on a cut-out", () => {
    const n = 40;
    const distance = (x: number, y: number) => Math.hypot(x - 19.5, y - 19.5);
    const p = picture(n, n, (x, y) => (distance(x, y) <= 10 ? [200, 100, 50, 255] : distance(x, y) <= 11 ? [200, 100, 50, 40] : [0, 0, 0, 0]));
    const before = p.rgba.slice();
    const blur = createBackgroundBlur(
      p,
      coverage(n, (x, y) => (distance(x, y) <= 10.5 ? 255 : 0)),
      6,
    );
    blur.addRows(0, n);
    expect(blur.solve()).toBe(false);
    blur.paintRows(0, n);
    expect(p.rgba).toEqual(before);
  });

  it("blurs a background that is small but really there, and not one that is a few stray pixels", () => {
    const solveWith = (backgroundPixels: number) => {
      const n = 100; // 10,000 pixels: the background is the first `backgroundPixels` of the top row, the rest is subject
      const p = picture(n, n, () => [90, 90, 90]);
      const blur = createBackgroundBlur(
        p,
        coverage(n, (x, y) => (y === 0 && x < backgroundPixels ? 0 : 255)),
        6,
      );
      blur.addRows(0, n);
      return blur.solve();
    };
    expect(solveWith(100)).toBe(true); // a row: 1 % of the picture
    expect(solveWith(10)).toBe(true); // 0.1 %
    expect(solveWith(5)).toBe(false); // half of that
    expect(solveWith(0)).toBe(false);
  });

  it("paints nothing before the blur has been solved, and says there is no background when there is none", () => {
    const p = textured();
    const before = p.rgba.slice();
    const blur = createBackgroundBlur(
      p,
      coverage(4, () => 255),
      6,
    );
    blur.addRows(0, 29);
    expect(blur.solve()).toBe(false);
    blur.paintRows(0, 29);
    expect(p.rgba).toEqual(before);
  });
});

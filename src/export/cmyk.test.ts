import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { INK_LIMIT, encodeCmykImage, predictRows, rgbToCmyk, rgbaToCmykBytes } from "./cmyk";
import { unpredict } from "./pdfTestUtil";

/** CMYK in whole percent, so the expectations read like a printer's swatch. */
const percent = (r: number, g: number, b: number, alpha?: number, limit?: number) => rgbToCmyk(r, g, b, alpha, limit).map((v) => Math.round(v * 100));
const total = (cmyk: number[]) => cmyk.reduce((a, b) => a + b, 0);

describe("rgbToCmyk", () => {
  it("leaves white paper without ink", () => {
    expect(percent(255, 255, 255)).toEqual([0, 0, 0, 0]);
  });

  it("prints black with black ink alone (0/0/0/100), so text stays sharp", () => {
    expect(percent(0, 0, 0)).toEqual([0, 0, 0, 100]);
  });

  it("prints every neutral grey with black ink alone (grey component replacement)", () => {
    expect(percent(128, 128, 128)).toEqual([0, 0, 0, 50]);
    expect(percent(230, 230, 230)).toEqual([0, 0, 0, 10]);
  });

  it("makes the primaries of the screen from two inks, and the inks from one", () => {
    expect(percent(255, 0, 0)).toEqual([0, 100, 100, 0]);
    expect(percent(0, 255, 0)).toEqual([100, 0, 100, 0]);
    expect(percent(0, 0, 255)).toEqual([100, 100, 0, 0]);
    expect(percent(0, 255, 255)).toEqual([100, 0, 0, 0]);
    expect(percent(255, 0, 255)).toEqual([0, 100, 0, 0]);
    expect(percent(255, 255, 0)).toEqual([0, 0, 100, 0]);
  });

  it("takes the grey out of a dark colour into black and keeps the colour's saturation", () => {
    // navy: the grey they share (50 %) is black ink, what is left is full cyan and magenta
    expect(percent(0, 0, 128)).toEqual([100, 100, 0, 50]);
    // the simple model holds: (1 - C)(1 - K) is what the light lacked
    const [c, , , k] = rgbToCmyk(51, 102, 153);
    expect((1 - c) * (1 - k)).toBeCloseTo(51 / 255, 6);
  });

  it("lays a colour that is not opaque over white paper", () => {
    expect(percent(0, 0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(percent(0, 0, 0, 128)).toEqual([0, 0, 0, 50]);
    expect(percent(255, 0, 0, 255)).toEqual([0, 100, 100, 0]);
  });

  it("never puts more than 300 % ink on the paper", () => {
    expect(INK_LIMIT).toBe(3);
    let most = 0;
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 5) most = Math.max(most, total(rgbToCmyk(r, g, b)));
    expect(most).toBeLessThanOrEqual(3 + 1e-9);
    // the darkest saturated colours come closest
    expect(total(rgbToCmyk(0, 0, 3))).toBeGreaterThan(2.95);
  });

  it("brings a colour above a lower ink limit down to it by taking colour away and keeping the black", () => {
    const free = rgbToCmyk(0, 0, 40, 255, 10);
    expect(total(free)).toBeGreaterThan(2.8);
    const limited = rgbToCmyk(0, 0, 40, 255, 2.4);
    expect(total(limited)).toBeCloseTo(2.4, 9);
    expect(limited[3]).toBeCloseTo(free[3], 9);
    // the colours keep their proportions
    expect(limited[0] / limited[1]).toBeCloseTo(free[0] / free[1], 9);
    // a colour under the limit is not touched
    expect(rgbToCmyk(255, 0, 0, 255, 2.4)).toEqual(rgbToCmyk(255, 0, 0));
  });
});

describe("rgbaToCmykBytes", () => {
  it("gives the same inks as rgbToCmyk, as bytes from 0 (none) to 255 (full)", () => {
    const rgba = Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 128, 255, 51, 102, 153, 255, 0, 0, 0, 0]);
    const bytes = Array.from(rgbaToCmykBytes(rgba));
    expect(bytes.slice(0, 16)).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 255, 255, 0, 255, 255, 0, 127]);
    for (let p = 0; p < 6; p++) {
      const expected = rgbToCmyk(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2], rgba[p * 4 + 3]).map((v) => Math.round(v * 255));
      expect(bytes.slice(p * 4, p * 4 + 4), `pixel ${p}`).toEqual(expected);
    }
  });
});

describe("predictRows", () => {
  it("writes a filter type before every row, and the rows can be read back", () => {
    const width = 5;
    const rows = 4;
    const cmyk = new Uint8Array(width * rows * 4);
    for (let i = 0; i < cmyk.length; i++) cmyk[i] = (i * 37 + (i >> 4) * 11) & 0xff;
    // a flat row and a gradient row, which Up and Sub make small
    cmyk.fill(200, 0, width * 4);
    for (let x = 0; x < width * 4; x++) cmyk[width * 4 * 2 + x] = x * 3;
    const out = predictRows(cmyk, width, rows, null);
    expect(out).toHaveLength(rows * (width * 4 + 1));
    for (let row = 0; row < rows; row++) expect([0, 1, 2]).toContain(out[row * (width * 4 + 1)]);
    expect(unpredict(out, width, rows)).toEqual(cmyk);
  });
});

describe("encodeCmykImage", () => {
  it("converts, filters and deflates a picture band by band into one zlib stream", async () => {
    const width = 1500; // more than one band: a band is about a million pixels
    const height = 900;
    const reads: number[][] = [];
    const image = await encodeCmykImage(width, height, (y, rows) => {
      reads.push([y, rows]);
      const rgba = new Uint8ClampedArray(width * rows * 4);
      for (let row = 0; row < rows; row++)
        for (let x = 0; x < width; x++) {
          const i = (row * width + x) * 4;
          // red on the left half, a grey ramp on the right
          if (x < width / 2) rgba.set([255, 0, 0, 255], i);
          else rgba.set([(y + row) % 256, (y + row) % 256, (y + row) % 256, 255], i);
        }
      return rgba;
    });
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.reduce((n, [, rows]) => n + rows, 0)).toBe(height);
    const zlib = Buffer.concat(image.data);
    // zlib header (deflate with a window), as /FlateDecode wants it
    expect(zlib[0] & 0x0f).toBe(8);
    expect(((zlib[0] << 8) | zlib[1]) % 31).toBe(0);
    const pixels = unpredict(new Uint8Array(inflateSync(zlib)), width, height);
    expect(Array.from(pixels.subarray(0, 4))).toEqual([0, 255, 255, 0]);
    const at = (x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
    expect(at(width - 1, 0)).toEqual([0, 0, 0, 255]);
    expect(at(width - 1, 255)).toEqual([0, 0, 0, 0]);
    expect(at(10, height - 1)).toEqual([0, 255, 255, 0]);
    // flat colour compresses to a small fraction of four bytes a pixel
    expect(zlib.length).toBeLessThan(width * height * 4 * 0.05);
  });

  it("stops when the download is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(encodeCmykImage(10, 10, () => new Uint8ClampedArray(400), { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { stubCanvasPixels } from "@/test/tabsHarness";
import { extractPalette } from "./quantize";

let restore: (() => void) | null = null;
function pixels(colors: Array<[number, number, number, number?]>, perColor = 300) {
  const stub = stubCanvasPixels(colors, perColor);
  restore = stub.restore;
  return stub;
}
afterEach(() => {
  restore?.();
  restore = null;
});

const naturalSize = (width: number, height: number) => {
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(height);
};

describe("extractPalette", () => {
  it("finds the main colours of a picture, the most common first", async () => {
    pixels([
      [220, 40, 60],
      [220, 40, 60],
      [30, 120, 220],
      [250, 200, 20],
    ]);
    expect(await extractPalette("blob:test/photo", 6)).toEqual(["#dc283c", "#1e78dc", "#fac814"]);
  });

  it("returns at most the number of colours asked for", async () => {
    pixels([
      [220, 40, 60],
      [30, 120, 220],
      [250, 200, 20],
      [20, 200, 80],
      [120, 20, 200],
    ]);
    expect(await extractPalette("blob:test/photo", 2)).toHaveLength(2);
    expect(await extractPalette("blob:test/photo")).toHaveLength(5);
  });

  it("reads the picture shrunk to fit 96 px", async () => {
    const { sizes } = pixels([[10, 20, 30]], 10);
    naturalSize(960, 480);
    await extractPalette("blob:test/big");
    expect(sizes.at(-1)).toEqual([96, 48]);
  });

  it("keeps a small picture at its own size", async () => {
    const { sizes } = pixels([[10, 20, 30]], 10);
    naturalSize(40, 20);
    await extractPalette("blob:test/small");
    expect(sizes.at(-1)).toEqual([40, 20]);
  });

  it("falls back to a square when the picture reports no size", async () => {
    const { sizes } = pixels([[10, 20, 30]], 10);
    naturalSize(0, 0);
    await extractPalette("blob:test/unknown");
    expect(sizes.at(-1)).toEqual([96, 96]);
  });

  it("finds nothing in a transparent picture", async () => {
    // the harness canvas is blank (fully transparent) unless told otherwise
    expect(await extractPalette("blob:test/blank")).toEqual([]);
  });

  it("gives an empty palette when the browser offers no drawing surface", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(await extractPalette("blob:test/photo")).toEqual([]);
  });

  it("fails when the picture cannot be decoded", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValueOnce(new Error("not an image"));
    await expect(extractPalette("blob:test/broken")).rejects.toThrow("not an image");
  });
});

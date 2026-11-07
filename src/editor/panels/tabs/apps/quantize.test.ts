import { describe, expect, it } from "vitest";
import { medianCut, paletteFromPixels } from "./quantize";

const rgba = (colors: Array<[number, number, number]>, each: number) => {
  const data = new Uint8ClampedArray(colors.length * each * 4);
  let i = 0;
  for (const [r, g, b] of colors) for (let k = 0; k < each; k++, i += 4) data.set([r, g, b, 255], i);
  return data;
};

describe("medianCut", () => {
  it("splits along the colour channel that varies most", () => {
    // only blue differs: red and green are the same everywhere
    const blue = medianCut(
      [
        { r: 10, g: 10, b: 0, n: 50 },
        { r: 10, g: 10, b: 250, n: 50 },
      ],
      2,
    );
    expect(blue.map((c) => [c.r, c.g, c.b]).sort((a, b) => a[2] - b[2])).toEqual([
      [10, 10, 0],
      [10, 10, 250],
    ]);

    const green = medianCut(
      [
        { r: 5, g: 0, b: 5, n: 10 },
        { r: 5, g: 200, b: 5, n: 10 },
      ],
      2,
    );
    expect(green.map((c) => c.g).sort((a, b) => a - b)).toEqual([0, 200]);

    const red = medianCut(
      [
        { r: 0, g: 5, b: 5, n: 10 },
        { r: 220, g: 5, b: 5, n: 10 },
      ],
      2,
    );
    expect(red.map((c) => c.r).sort((a, b) => a - b)).toEqual([0, 220]);
  });

  it("stops when no box can be split any more", () => {
    const boxes = medianCut([{ r: 1, g: 2, b: 3, n: 5 }], 6);
    expect(boxes).toEqual([{ r: 1, g: 2, b: 3, n: 5 }]);
  });

  it("averages each box by how many pixels each colour has", () => {
    const [box] = medianCut(
      [
        { r: 0, g: 0, b: 0, n: 1 },
        { r: 100, g: 100, b: 100, n: 3 },
      ],
      1,
    );
    expect([box.r, box.g, box.b, box.n]).toEqual([75, 75, 75, 4]);
  });
});

describe("paletteFromPixels", () => {
  const EIGHT: Array<[number, number, number]> = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [0, 0, 0],
    [255, 255, 255],
  ];

  it("stops at the number of colours asked for", () => {
    expect(paletteFromPixels(rgba(EIGHT, 100), 3)).toHaveLength(3);
    expect(paletteFromPixels(rgba(EIGHT, 100), 6)).toHaveLength(6);
  });

  it("returns every distinct colour when there are fewer than asked for", () => {
    expect(paletteFromPixels(rgba(EIGHT.slice(0, 2), 100), 6).sort()).toEqual(["#00ff00", "#ff0000"]);
  });

  it("gives nothing for a picture with no pixels", () => {
    expect(paletteFromPixels(new Uint8ClampedArray(0))).toEqual([]);
  });

  it("drops a sliver of blended pixels once two real colours are found", () => {
    // 1000 pixels of black, 1000 of white and 10 of an orange blend: the blend covers about 0.5% of the picture
    const data = new Uint8ClampedArray((2000 + 10) * 4);
    let at = 0;
    for (const [color, count] of [
      [[0, 0, 0], 1000],
      [[255, 255, 255], 1000],
      [[240, 130, 20], 10],
    ] as const) {
      for (let i = 0; i < count; i++, at += 4) data.set([...color, 255], at);
    }
    expect(paletteFromPixels(data, 6).sort()).toEqual(["#000000", "#ffffff"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fill, PatternFill } from "@/core/types";
import { captureContexts, spyContext, stubDomMatrix, type SpyContext, type SpyPattern } from "@/test/logicPaint";
import { linearGradientFor, paintFor, patternPaint, radialGradientFor } from "./paint";

type Gradient = { kind: string; args: number[]; stops: Array<{ offset: number; color: string }> };

const stops = [
  { offset: 0, color: "#ff0000" },
  { offset: 1, color: "#0000ff" },
];

function expectNumbers(actual: unknown[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i] as number).toBeCloseTo(value, 6));
}

describe("linear gradients", () => {
  const linear = (angle: number, w: number, h: number, s = stops) => linearGradientFor(spyContext().ctx, { type: "linear", angle, stops: s }, w, h) as unknown as Gradient;

  it.each([
    [0, [50, 100, 50, 0]],
    [90, [0, 50, 100, 50]],
    [180, [50, 0, 50, 100]],
    [270, [100, 50, 0, 50]],
  ])("runs at %s degrees (0 points up, 90 points right) across a square", (angle, line) => {
    expectNumbers(linear(angle, 100, 100).args, line);
  });

  it("reaches the corners of a wide box on the diagonal", () => {
    expectNumbers(linear(45, 200, 100).args, [25, 125, 175, -25]);
  });

  it("keeps a gradient of an empty box valid", () => {
    expectNumbers(linear(90, 0, 0).args, [-1, 0, 1, 0]);
  });

  it("clamps the stops to the line and keeps their order", () => {
    const gradient = linear(90, 100, 100, [
      { offset: -2, color: "#111111" },
      { offset: 0.5, color: "#222222" },
      { offset: 3, color: "#333333" },
    ]);
    expect(gradient.stops).toEqual([
      { offset: 0, color: "#111111" },
      { offset: 0.5, color: "#222222" },
      { offset: 1, color: "#333333" },
    ]);
  });
});

describe("radial gradients", () => {
  const radial = (w: number, h: number, extra: { cx?: number; cy?: number } = {}) =>
    radialGradientFor(spyContext().ctx, { type: "radial", stops, ...extra }, w, h) as unknown as Gradient;

  it("starts in the middle and reaches the farthest corner", () => {
    expectNumbers(radial(200, 100).args, [100, 50, 0, 100, 50, Math.hypot(100, 50)]);
  });

  it("can be centred elsewhere", () => {
    expectNumbers(radial(200, 100, { cx: 0.25, cy: 0.75 }).args, [50, 75, 0, 50, 75, Math.hypot(150, 75)]);
  });

  it("carries the stops, clamped", () => {
    const gradient = radialGradientFor(
      spyContext().ctx,
      {
        type: "radial",
        stops: [
          { offset: -1, color: "#000000" },
          { offset: 9, color: "#ffffff" },
        ],
      },
      10,
      10,
    ) as unknown as Gradient;
    expect(gradient.stops.map((s) => s.offset)).toEqual([0, 1]);
  });
});

describe("paintFor", () => {
  const ctx = () => spyContext().ctx;

  it("returns the colour of a solid fill", () => {
    expect(paintFor(ctx(), { type: "solid", color: "#abcdef" }, 10, 10, 1)).toBe("#abcdef");
  });

  it("returns gradients for gradient fills", () => {
    expect((paintFor(ctx(), { type: "linear", angle: 90, stops }, 10, 10, 1) as unknown as Gradient).kind).toBe("linear");
    expect((paintFor(ctx(), { type: "radial", stops }, 10, 10, 1) as unknown as Gradient).kind).toBe("radial");
  });

  it("returns a pattern for a pattern fill", () => {
    const restore = stubDomMatrix();
    const fill: Fill = { type: "pattern", pattern: "grid", color: "#0a0b0c", background: "#ffffff", scale: 1 };
    const paint = paintFor(ctx(), fill, 10, 10, 1) as unknown as SpyPattern;
    expect(paint.repetition).toBe("repeat");
    restore();
  });

  it("falls back to white for a fill the shape painter does not handle (pictures)", () => {
    expect(paintFor(ctx(), { type: "image", src: "x.png", fit: "cover" }, 10, 10, 1)).toBe("#ffffff");
  });
});

describe("patterns", () => {
  let tiles: SpyContext[];
  let target: SpyContext;
  let serial = 0;
  /** a unique ink colour: tiles are cached by their settings, and every test wants a fresh one */
  const ink = () => `#${(++serial + 0x100000).toString(16)}`;
  const pattern = (kind: PatternFill["pattern"], over: Partial<PatternFill> = {}): PatternFill => ({
    type: "pattern",
    pattern: kind,
    color: ink(),
    background: "#fafafa",
    scale: 1,
    ...over,
  });
  let latest: SpyPattern;
  const paint = (fill: PatternFill, px = 1) => (latest = patternPaint(target.ctx, fill, px) as unknown as SpyPattern);
  /** the recording of the canvas the latest pattern was drawn on (colour parsing makes canvases of its own, too) */
  const lastTile = () => tiles.find((t) => t.canvas === latest.image)!;

  beforeEach(() => {
    stubDomMatrix();
    target = spyContext();
    tiles = captureContexts();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("repeats a tile and maps it back to design pixels", () => {
    const result = paint(pattern("dots"), 2);
    expect(result.repetition).toBe("repeat");
    expect(result.image).toBeInstanceOf(HTMLCanvasElement);
    expect(lastTile().to("fillRect")).toHaveLength(1);
    expect(result.transforms.map((m) => m.scaleBy)).toEqual([0.5]);
  });

  it("makes the tile larger with the canvas scale and the pattern scale", () => {
    const small = paint(pattern("dots"), 1).image;
    const big = paint(pattern("dots", { scale: 2 }), 1.5).image;
    expect([small.width, small.height]).toEqual([26, 26]);
    // bucket 1.5 x pattern scale 2 = 3 canvas px per design px
    expect([big.width, big.height]).toEqual([78, 78]);
    const arc = lastTile().to("arc")[0];
    expect(arc.args[2]).toBeCloseTo(2.6 * 3);
  });

  it("never makes a tile smaller than two pixels", () => {
    const tile = paint(pattern("dots", { scale: 0.01 })).image;
    expect([tile.width, tile.height]).toEqual([2, 2]);
  });

  it("snaps the canvas scale to quarter steps, never below one", () => {
    const reference = paint(pattern("dots", { color: "#123456" }), 1).image;
    expect(paint(pattern("dots", { color: "#123456" }), 1.1).image).toBe(reference);
    expect(paint(pattern("dots", { color: "#123456" }), 0.3).image).toBe(reference);
    const quarter = paint(pattern("dots", { color: "#123456" }), 1.3);
    expect(quarter.image).not.toBe(reference);
    expect(quarter.transforms[0].scaleBy).toBeCloseTo(1 / 1.25);
  });

  it("reuses the tile for the same settings and builds another for different ones", () => {
    const fill = pattern("checker");
    const first = paint(fill).image;
    expect(paint(fill).image).toBe(first);
    expect(paint({ ...fill, background: "#000000" }).image).not.toBe(first);
    expect(paint({ ...fill, scale: 1.5 }).image).not.toBe(first);
    expect(paint({ ...fill, pattern: "plus" }).image).not.toBe(first);
  });

  it("forgets old tiles once too many are cached", () => {
    const first = pattern("dots", { color: "#00aa11" });
    const original = paint(first).image;
    for (let i = 0; i < 65; i++) paint(pattern("dots", { scale: 0.5 + i / 100 }));
    expect(paint(first).image).not.toBe(original);
  });

  it("falls back to the paper colour when the context makes no pattern", () => {
    const empty = spyContext({ returns: { createPattern: null } });
    expect(patternPaint(empty.ctx, pattern("dots", { background: "#bada55" }), 1)).toBe("#bada55");
  });

  describe("tiles", () => {
    const kinds: Array<[PatternFill["pattern"], number, number]> = [
      ["dots", 26, 26],
      ["grid", 44, 44],
      ["lines", 24, 24],
      ["diagonal", 30, 30],
      ["checker", 64, 64],
      ["waves", 64, 28],
      ["zigzag", 36, 20],
      ["plus", 40, 40],
      ["bubbles", 120, 120],
      ["noise", 180, 180],
    ];

    it.each(kinds)("%s: a %s x %s px tile on the paper colour", (kind, w, h) => {
      const tile = paint(pattern(kind, { background: "#fafafa" })).image;
      expect([tile.width, tile.height]).toEqual([w, h]);
      const paper = lastTile().to("fillRect")[0];
      expect(paper.args).toEqual([0, 0, w, h]);
      expect(paper.state.fillStyle).toBe("#fafafa");
    });

    it("dots: one round dot in the middle", () => {
      const fill = pattern("dots");
      paint(fill);
      const [dot] = lastTile().to("arc");
      expect(dot.args).toEqual([13, 13, 2.6, 0, Math.PI * 2]);
      expect(lastTile().to("fill")[0].state.fillStyle).toBe(fill.color);
    });

    it("grid: lines along the top and left edges", () => {
      const fill = pattern("grid");
      paint(fill);
      const t = lastTile();
      expect(t.to("moveTo").map((c) => c.args)).toEqual([
        [0, 0],
        [0, 0],
      ]);
      expect(t.to("lineTo").map((c) => c.args)).toEqual([
        [44, 0],
        [0, 44],
      ]);
      const stroke = t.to("stroke")[0];
      expect(stroke.state.strokeStyle).toBe(fill.color);
      expect(stroke.state.lineWidth).toBeCloseTo(1.6);
      expect(stroke.state.lineCap).toBe("round");
    });

    it("lines: a band across the top", () => {
      const fill = pattern("lines");
      paint(fill);
      const band = lastTile().to("fillRect")[1];
      expect(band.args).toEqual([0, 0, 24, 5]);
      expect(band.state.fillStyle).toBe(fill.color);
    });

    it("diagonal: three slanted strokes so the stripes join across tiles", () => {
      paint(pattern("diagonal"));
      const t = lastTile();
      expect(t.to("moveTo")).toHaveLength(3);
      expect(t.to("stroke")).toHaveLength(1);
      expect(t.to("stroke")[0].state.lineWidth).toBe(6);
    });

    it("checker: two squares on the diagonal", () => {
      paint(pattern("checker"));
      expect(
        lastTile()
          .to("fillRect")
          .slice(1)
          .map((c) => c.args),
      ).toEqual([
        [0, 0, 32, 32],
        [32, 32, 32, 32],
      ]);
    });

    it("waves: a double curve across the tile", () => {
      paint(pattern("waves"));
      const t = lastTile();
      expect(t.to("moveTo")[0].args).toEqual([0, 14]);
      expect(t.to("bezierCurveTo")).toHaveLength(2);
      expect(t.to("bezierCurveTo")[1].args.slice(4)).toEqual([64, 14]);
    });

    it("zigzag: a line up and down", () => {
      paint(pattern("zigzag"));
      const t = lastTile();
      expect(t.to("moveTo")[0].args).toEqual([0, 16]);
      expect(t.to("lineTo").map((c) => c.args)).toEqual([
        [9, 4],
        [18, 16],
        [27, 4],
        [36, 16],
      ]);
    });

    it("plus: a cross in the middle", () => {
      paint(pattern("plus"));
      const t = lastTile();
      expect(t.to("moveTo").map((c) => c.args)).toEqual([
        [14, 20],
        [20, 14],
      ]);
      expect(t.to("lineTo").map((c) => c.args)).toEqual([
        [26, 20],
        [20, 26],
      ]);
    });

    it("bubbles: seven circles repeated around the edges so they tile, alternating rings and discs", () => {
      paint(pattern("bubbles"));
      const t = lastTile();
      expect(t.to("arc")).toHaveLength(7 * 9);
      expect(t.to("fill")).toHaveLength(3 * 9);
      expect(t.to("stroke")).toHaveLength(4 * 9);
      expect(t.to("stroke")[0].state.lineWidth).toBeCloseTo(2.4);
    });

    it("noise: speckles whose colours stay between the paper and the ink", () => {
      paint(pattern("noise", { color: "rgb(200, 100, 50)", background: "#101010" }));
      const t = lastTile();
      expect(t.to("getImageData")[0].args).toEqual([0, 0, 180, 180]);
      const [image] = t.to("putImageData")[0].args as [{ data: Uint8ClampedArray; width: number }];
      expect(image.width).toBe(180);
      let darker = 0;
      for (let i = 0; i < image.data.length; i += 4) {
        expect(image.data[i]).toBeGreaterThanOrEqual(16);
        expect(image.data[i]).toBeLessThanOrEqual(200);
        expect(image.data[i + 1]).toBeGreaterThanOrEqual(16);
        expect(image.data[i + 1]).toBeLessThanOrEqual(100);
        expect(image.data[i + 3]).toBe(255);
        if (image.data[i] < 40) darker++;
      }
      // most of the tile is close to the paper colour
      expect(darker).toBeGreaterThan((image.data.length / 4) * 0.3);
    });

    it("noise: is the same every time for the same settings", () => {
      const fill = pattern("noise", { color: "#303030", background: "#d0d0d0" });
      paint(fill);
      const first = Array.from((lastTile().to("putImageData")[0].args[0] as { data: Uint8ClampedArray }).data.slice(0, 64));
      paint({ ...fill, scale: 1.0001 });
      const second = Array.from((lastTile().to("putImageData")[0].args[0] as { data: Uint8ClampedArray }).data.slice(0, 64));
      expect(second).toEqual(first);
    });

    it("noise: treats a colour it cannot read as black", () => {
      paint(pattern("noise", { color: "red", background: "#ffffff" }));
      const [image] = lastTile().to("putImageData")[0].args as [{ data: Uint8ClampedArray }];
      let min = 255;
      for (let i = 0; i < image.data.length; i += 4) min = Math.min(min, image.data[i]);
      expect(min).toBeLessThan(255 * 0.4);
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A fresh copy of the module: it chooses its measurer when it is loaded, and keeps its caches in module state. */
async function load() {
  vi.resetModules();
  return import("./textMetrics");
}

/** A canvas class whose context measures every character as 7 px wide. */
function stubOffscreen(metrics: { ascent?: number; descent?: number } = { ascent: 15, descent: 4 }) {
  const measureText = vi.fn((text: string) => ({ width: text.length * 7, fontBoundingBoxAscent: metrics.ascent ?? 0, fontBoundingBoxDescent: metrics.descent ?? 0 }));
  const context = { font: "", measureText };
  const created: unknown[] = [];
  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      created.push(this);
    }
    getContext() {
      return context;
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return { context, measureText, created };
}

describe("without a canvas (node)", () => {
  it("estimates the width of text at 55 % of the font size per character", async () => {
    const { measureWidth } = await load();
    expect(measureWidth("12px Inter", "abcd")).toBeCloseTo(26.4);
    expect(measureWidth("italic 700 20.5px Lora", "ab")).toBeCloseTo(22.55);
    expect(measureWidth("12px Inter", "")).toBe(0);
  });

  it("assumes 16 px when the font has no size", async () => {
    const { measureWidth } = await load();
    expect(measureWidth("serif", "ab")).toBeCloseTo(17.6);
  });

  it("estimates ascent and descent from the font size", async () => {
    const { measureMetrics } = await load();
    const m = measureMetrics("20px Inter");
    expect(m.ascent).toBeCloseTo(19);
    expect(m.descent).toBeCloseTo(5);
  });

  it("measures with a measurer you install, and forgets what it knew before", async () => {
    const { measureWidth, measureMetrics, setTextMeasurer } = await load();
    setTextMeasurer({ width: (_font, text) => text.length * 3, metrics: () => ({ ascent: 8, descent: 2 }) });
    expect(measureWidth("12px Inter", "abcd")).toBe(12);
    expect(measureMetrics("12px Inter")).toEqual({ ascent: 8, descent: 2 });
  });

  it("goes back to the canvas measurer, which falls back to the estimate without a canvas", async () => {
    const { measureWidth, measureMetrics, setTextMeasurer } = await load();
    setTextMeasurer({ width: () => 1, metrics: () => ({ ascent: 1, descent: 1 }) });
    setTextMeasurer(null);
    expect(measureWidth("10px Inter", "ab")).toBeCloseTo(11);
    expect(measureMetrics("10px Inter").ascent).toBeCloseTo(9.5);
  });
});

describe("with a canvas", () => {
  it("uses the canvas to measure text, in the font asked for", async () => {
    const { context, measureText } = stubOffscreen();
    const { measureWidth } = await load();
    expect(measureWidth("16px Lora", "abc")).toBe(21);
    expect(context.font).toBe("16px Lora");
    expect(measureText).toHaveBeenCalledWith("abc");
  });

  it("makes one canvas for the whole life of the module", async () => {
    const { created } = stubOffscreen();
    const { measureWidth, measureMetrics } = await load();
    measureWidth("10px A", "x");
    measureWidth("10px B", "y");
    measureMetrics("10px C");
    expect(created).toHaveLength(1);
  });

  it("remembers each width, per font and text", async () => {
    const { measureText } = stubOffscreen();
    const { measureWidth, clearMeasureCache } = await load();
    measureWidth("10px A", "same");
    measureWidth("10px A", "same");
    expect(measureText).toHaveBeenCalledTimes(1);
    measureWidth("10px B", "same");
    measureWidth("10px A", "other");
    expect(measureText).toHaveBeenCalledTimes(3);
    clearMeasureCache();
    measureWidth("10px A", "same");
    expect(measureText).toHaveBeenCalledTimes(4);
  });

  it("forgets everything once it has remembered a great many widths", async () => {
    const { measureText } = stubOffscreen();
    const { measureWidth } = await load();
    for (let i = 0; i < 20002; i++) measureWidth("10px A", `t${i}`);
    expect(measureText).toHaveBeenCalledTimes(20002);
    // the very first width is gone, so measuring it again asks the canvas; the next time it is remembered again
    measureWidth("10px A", "t0");
    expect(measureText).toHaveBeenCalledTimes(20003);
    measureWidth("10px A", "t0");
    expect(measureText).toHaveBeenCalledTimes(20003);
  });

  it("takes the ascent and descent of the font from the canvas, once per font", async () => {
    const { measureText } = stubOffscreen({ ascent: 15, descent: 4 });
    const { measureMetrics } = await load();
    expect(measureMetrics("20px Lora")).toEqual({ ascent: 15, descent: 4 });
    expect(measureMetrics("20px Lora")).toEqual({ ascent: 15, descent: 4 });
    expect(measureText).toHaveBeenCalledTimes(1);
    expect(measureText).toHaveBeenCalledWith("Hxg");
  });

  it("estimates the metrics when the canvas does not know them", async () => {
    stubOffscreen({ ascent: 0, descent: 0 });
    const { measureMetrics } = await load();
    const m = measureMetrics("20px Lora");
    expect(m.ascent).toBeCloseTo(19);
    expect(m.descent).toBeCloseTo(5);
  });

  it("uses a document canvas where there is no OffscreenCanvas", async () => {
    const measureText = vi.fn((text: string) => ({ width: text.length * 5, fontBoundingBoxAscent: 1, fontBoundingBoxDescent: 1 }));
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ font: "", measureText }) }) });
    const { measureWidth } = await load();
    expect(measureWidth("10px A", "abcd")).toBe(20);
  });

  it("estimates when the canvas cannot be made", async () => {
    class BrokenCanvas {
      constructor() {
        throw new Error("no canvas here");
      }
    }
    vi.stubGlobal("OffscreenCanvas", BrokenCanvas);
    const { measureWidth, measureMetrics } = await load();
    expect(measureWidth("10px A", "ab")).toBeCloseTo(11);
    expect(measureMetrics("10px A").descent).toBeCloseTo(2.5);
  });

  it("estimates when the canvas has no 2D context", async () => {
    class NoContext {
      getContext() {
        return null;
      }
    }
    vi.stubGlobal("OffscreenCanvas", NoContext);
    const { measureWidth } = await load();
    expect(measureWidth("10px A", "ab")).toBeCloseTo(11);
  });
});

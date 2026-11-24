import { describe, expect, it } from "vitest";
import { defaultFilter } from "@/core/factory";
import type { ImageFilter } from "@/core/types";
import { FILTER_PRESETS } from "@/data/filters";
import { captureContexts, type SpyContext } from "@/test/logicPaint";
import { cssFilter, effectiveFilter, filterKey, isNeutral, renderFiltered, supportsCtxFilter, type FilteredDraw } from "./imageFilters";

const filter = (patch: Partial<ImageFilter> = {}): ImageFilter => ({ ...defaultFilter(), ...patch });

describe("effectiveFilter", () => {
  it("returns the sliders as they are without a preset", () => {
    const f = filter({ brightness: 20 });
    expect(effectiveFilter(f)).toBe(f);
    const none = filter({ preset: "none", brightness: 20 });
    expect(effectiveFilter(none)).toBe(none);
  });

  it("ignores a preset it does not know", () => {
    const f = filter({ preset: "from-the-future", contrast: 5 });
    expect(effectiveFilter(f)).toBe(f);
  });

  it("adds the preset on top of the sliders, scaled by its intensity", () => {
    const fresco = FILTER_PRESETS.find((p) => p.id === "fresco")!.patch;
    const full = effectiveFilter(filter({ preset: "fresco", intensity: 100, brightness: 10 }));
    expect(full.brightness).toBe(10 + (fresco.brightness ?? 0));
    expect(full.warmth).toBe(fresco.warmth);
    const half = effectiveFilter(filter({ preset: "fresco", intensity: 50 }));
    expect(half.contrast).toBeCloseTo((fresco.contrast ?? 0) / 2);
    expect(half.saturation).toBeCloseTo((fresco.saturation ?? 0) / 2);
  });

  it("keeps the intensity between none and full", () => {
    const fresco = FILTER_PRESETS.find((p) => p.id === "fresco")!.patch;
    expect(effectiveFilter(filter({ preset: "fresco", intensity: 400 })).warmth).toBe(fresco.warmth);
    expect(effectiveFilter(filter({ preset: "fresco", intensity: -50 })).warmth).toBe(0);
  });

  it("brings in the duotone of a preset unless its intensity is zero", () => {
    const ocean = FILTER_PRESETS.find((p) => p.id === "duo-ocean")!.patch;
    expect(effectiveFilter(filter({ preset: "duo-ocean", intensity: 100 })).duotone).toEqual(ocean.duotone);
    expect(effectiveFilter(filter({ preset: "duo-ocean", intensity: 0 })).duotone).toBeNull();
    expect(effectiveFilter(filter({ preset: "duo-ocean", intensity: 0.5 })).duotone).toBeNull();
  });

  it("does not change the filter it is given", () => {
    const f = filter({ preset: "fresco", intensity: 100 });
    effectiveFilter(f);
    expect(f.brightness).toBe(0);
  });
});

describe("isNeutral", () => {
  it("is true for an untouched filter and for tiny adjustments", () => {
    expect(isNeutral(filter())).toBe(true);
    expect(isNeutral(filter({ brightness: 0.4, hue: -0.4 }))).toBe(true);
  });

  it("is false as soon as one slider moves", () => {
    for (const key of [
      "brightness",
      "contrast",
      "saturation",
      "warmth",
      "fade",
      "vignette",
      "blur",
      "hue",
      "highlights",
      "shadows",
      "sharpen",
      "tint",
      "curves",
      "levels",
    ] as const) {
      expect(isNeutral(filter({ [key]: 5 })), key).toBe(false);
    }
  });

  it("treats every new field as zero in a filter from an older design", () => {
    const legacy = filter();
    for (const key of ["highlights", "shadows", "sharpen", "tint", "curves", "levels"] as const) delete legacy[key];
    expect(isNeutral(legacy)).toBe(true);
  });

  it("is false for a duotone and for a preset that has any effect", () => {
    expect(isNeutral(filter({ duotone: { dark: "#000000", light: "#ffffff" } }))).toBe(false);
    expect(isNeutral(filter({ preset: "fresco" }))).toBe(false);
    expect(isNeutral(filter({ preset: "fresco", intensity: 0 }))).toBe(true);
  });
});

describe("filterKey", () => {
  it("is the same for equal filters and differs when the effect differs", () => {
    expect(filterKey(filter({ contrast: 5 }))).toBe(filterKey(filter({ contrast: 5 })));
    expect(filterKey(filter({ contrast: 5 }))).not.toBe(filterKey(filter({ contrast: 6 })));
    expect(filterKey(filter({ preset: "fresco", intensity: 50 }))).not.toBe(filterKey(filter({ preset: "fresco", intensity: 60 })));
  });

  it("describes the filter as it is applied, preset included", () => {
    const f = filter({ preset: "fresco", intensity: 50 });
    expect(filterKey(f)).toBe(JSON.stringify(effectiveFilter(f)));
    expect(JSON.parse(filterKey(f)).warmth).toBeCloseTo(7);
  });
});

describe("cssFilter", () => {
  it("is `none` for a neutral filter", () => {
    expect(cssFilter(filter(), 1)).toBe("none");
    expect(cssFilter(filter({ brightness: 0.3 }), 1)).toBe("none");
  });

  it("turns each slider into its CSS function", () => {
    expect(cssFilter(filter({ brightness: 30 }), 1)).toBe("brightness(1.300)");
    expect(cssFilter(filter({ contrast: -20 }), 1)).toBe("contrast(0.800)");
    expect(cssFilter(filter({ saturation: 50 }), 1)).toBe("saturate(1.500)");
    expect(cssFilter(filter({ hue: 50 }), 1)).toBe("hue-rotate(90.0deg)");
    expect(cssFilter(filter({ blur: 50 }), 1)).toBe("blur(7.00px)");
  });

  it("never lets saturation go below zero", () => {
    expect(cssFilter(filter({ saturation: -250 }), 1)).toBe("saturate(0.000)");
  });

  it("scales the blur radius to the canvas", () => {
    expect(cssFilter(filter({ blur: 50 }), 2)).toBe("blur(14.00px)");
  });

  it("chains the functions in a fixed order, starting with a grey base for a duotone", () => {
    const f = filter({ brightness: 10, contrast: 10, saturation: 10, hue: 10, blur: 10, duotone: { dark: "#000000", light: "#ffffff" } });
    expect(cssFilter(f, 1)).toBe("grayscale(1) brightness(1.100) contrast(1.100) saturate(1.100) hue-rotate(18.0deg) blur(1.40px)");
  });

  it("includes what a preset adds", () => {
    expect(cssFilter(filter({ preset: "mono" }), 1)).toContain("saturate(0.000)");
  });

  it("leaves the overlay effects (warmth, fade, vignette) to the compositing step", () => {
    expect(cssFilter(filter({ warmth: 50, fade: 50, vignette: 50 }), 1)).toBe("none");
  });
});

describe("renderFiltered", () => {
  let keySerial = 0;
  const draw = (over: Partial<FilteredDraw> = {}): FilteredDraw => ({
    key: `photo-${++keySerial}`,
    img: document.createElement("canvas"),
    dx: 0,
    dy: 0,
    dw: 200,
    dh: 100,
    boxW: 200,
    boxH: 100,
    filter: filter({ warmth: 40 }),
    scale: 1,
    ...over,
  });

  /** render with the copy's context watched; the context is the one the copy canvas asked for */
  function render(d: FilteredDraw): { canvas: HTMLCanvasElement; spy: SpyContext } {
    const spies = captureContexts();
    const canvas = renderFiltered(d);
    return { canvas, spy: spies[0] };
  }

  it("reports whether this browser's canvas has a filter property", () => {
    // jsdom's canvas has none: the CSS filter part is then skipped and only the overlays apply
    expect(supportsCtxFilter).toBe(false);
  });

  it("draws the picture at its place in a canvas the size of the box", () => {
    const { canvas, spy } = render(draw({ dx: -10, dy: -5, dw: 220, dh: 110 }));
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(spy.to("drawImage")[0].args.slice(1)).toEqual([-10, -5, 220, 110]);
  });

  it("works at the output scale", () => {
    const { canvas, spy } = render(draw({ scale: 2, dx: 5, dy: 10, dw: 100, dh: 50 }));
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
    expect(spy.to("drawImage")[0].args.slice(1)).toEqual([10, 20, 200, 100]);
  });

  it("limits the copy to 2048 px on its longer side", () => {
    const { canvas, spy } = render(draw({ boxW: 4000, boxH: 1000, dw: 4000, dh: 1000 }));
    expect([canvas.width, canvas.height]).toEqual([2048, 512]);
    expect(
      spy
        .to("drawImage")[0]
        .args.slice(3)
        .map((v) => Math.round(v as number)),
    ).toEqual([2048, 512]);
  });

  it("makes a duotone from a lightened dark layer and a darkened light layer", () => {
    const { spy } = render(draw({ filter: filter({ duotone: { dark: "#102030", light: "#f0e0d0" } }) }));
    const [dark, light] = spy.to("fillRect");
    expect([dark.state.globalCompositeOperation, dark.state.fillStyle]).toEqual(["lighten", "#102030"]);
    expect([light.state.globalCompositeOperation, light.state.fillStyle]).toEqual(["darken", "#f0e0d0"]);
    expect(dark.args).toEqual([0, 0, 200, 100]);
  });

  it("warms the picture with an orange soft light and cools it with a blue one", () => {
    const warm = render(draw({ filter: filter({ warmth: 40 }) })).spy.to("fillRect")[0];
    expect(warm.state.fillStyle).toBe("#ff9a2e");
    expect(warm.state.globalCompositeOperation).toBe("soft-light");
    expect(warm.state.globalAlpha).toBeCloseTo(0.4 * 0.85);
    const cool = render(draw({ filter: filter({ warmth: -100 }) })).spy.to("fillRect")[0];
    expect(cool.state.fillStyle).toBe("#2e8bff");
    expect(cool.state.globalAlpha).toBeCloseTo(0.85);
  });

  it("fades the picture towards white", () => {
    const fade = render(draw({ filter: filter({ fade: 50 }) })).spy.to("fillRect")[0];
    expect(fade.state.fillStyle).toBe("#ffffff");
    expect(fade.state.globalCompositeOperation).toBe("source-over");
    expect(fade.state.globalAlpha).toBeCloseTo(0.5 * 0.45);
  });

  it("darkens the edges with a vignette", () => {
    const { spy } = render(draw({ filter: filter({ vignette: 100 }) }));
    const gradient = spy.to("createRadialGradient")[0];
    expect(gradient.args).toEqual([100, 50, 25, 100, 50, Math.hypot(200, 100) * 0.55]);
    const fill = spy.to("fillRect")[0];
    expect(fill.state.globalAlpha).toBeCloseTo(0.85);
    expect((fill.state.fillStyle as { stops: unknown[] }).stops).toEqual([
      { offset: 0, color: "rgba(0,0,0,0)" },
      { offset: 1, color: "rgba(0,0,0,0.9)" },
    ]);
  });

  it("applies the overlays in order, then puts the compositing back", () => {
    const { spy } = render(draw({ filter: filter({ duotone: { dark: "#000000", light: "#ffffff" }, warmth: 20, fade: 20, vignette: 20 }) }));
    expect(spy.to("fillRect").map((c) => c.state.globalCompositeOperation)).toEqual(["lighten", "darken", "soft-light", "source-over", "source-over"]);
    expect(spy.ctx.globalCompositeOperation).toBe("source-over");
    expect(spy.ctx.globalAlpha).toBe(1);
  });

  it("leaves a picture with no overlay alone", () => {
    const { spy } = render(draw({ filter: filter({ brightness: 30 }) }));
    expect(spy.to("fillRect")).toHaveLength(0);
  });

  it("applies the overlays of a preset", () => {
    const { spy } = render(draw({ filter: filter({ preset: "duo-ocean" }) }));
    expect(spy.to("fillRect")[0].state.fillStyle).toBe("#0b1f4b");
  });

  it("returns the same canvas for the same picture, box and filter", () => {
    const d = draw();
    const first = renderFiltered(d);
    expect(renderFiltered({ ...d })).toBe(first);
    expect(renderFiltered({ ...d, filter: filter({ warmth: 41 }) })).not.toBe(first);
    expect(renderFiltered({ ...d, dx: 1 })).not.toBe(first);
    expect(renderFiltered({ ...d, scale: 2 })).not.toBe(first);
    expect(renderFiltered({ ...d, key: "other" })).not.toBe(first);
  });

  it("forgets the oldest copies once there are too many", () => {
    const d = draw();
    const first = renderFiltered(d);
    for (let i = 0; i < 45; i++) renderFiltered(draw());
    expect(renderFiltered(d)).not.toBe(first);
  });
});

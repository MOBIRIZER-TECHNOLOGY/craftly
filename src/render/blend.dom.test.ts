/**
 * Elements with a blend mode: each is painted on a layer of its own, which is then laid over the page the way the mode mixes
 * the two. Everything that has no mode must be painted exactly as before, straight onto the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLEND_MODES } from "@/core/blend";
import { createGroup, createPage, createShape, solid } from "@/core/factory";
import type { DesignElement, ElementAnimations, Page } from "@/core/types";
import { captureContexts, type Matrix } from "@/test/logicPaint";
import { releaseLayers, renderPage, type RenderOptions } from "./renderPage";

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A canvas whose context is watched: the first context the watcher made is the page's, any other is a layer. */
function pageCanvas(width = 400, height = 300) {
  const made = captureContexts();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  return { made, ctx, page: made[0], layers: () => made.slice(1) };
}

function paint(elements: DesignElement[], opts: Partial<RenderOptions> = {}, page: Partial<Page> = {}, size = { width: 400, height: 300 }) {
  const canvas = pageCanvas(size.width, size.height);
  const complete = renderPage(canvas.ctx, size, createPage({ elements, ...page }), { scale: 1, ...opts });
  return { page: canvas.page, layers: canvas.layers(), made: canvas.made, complete };
}

const red = (init: Parameters<typeof createShape>[1] = {}) => createShape("rect", { x: 50, y: 40, width: 100, height: 60, fill: solid("#ff0000"), ...init });

const closeTo = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
};

beforeEach(() => releaseLayers());

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("an element with no blend mode", () => {
  it("is painted straight onto the page: no layer, no mixing", () => {
    const { page, layers } = paint([red()]);
    expect(layers).toHaveLength(0);
    expect(page.to("fill")).toHaveLength(1);
    expect(page.to("fill")[0].state.globalCompositeOperation).toBe("source-over");
    expect(page.to("drawImage")).toHaveLength(0);
  });

  it.each([
    ["normal, which is the same as none", "normal"],
    ["what a canvas calls no mixing", "source-over"],
    ["a name that is not a mode", "sparkle"],
    ["a style that came with the name", "multiply;opacity:0"],
    ["a number", 3],
  ])("is painted straight too when the file or another person says %s", (_what, blend) => {
    const { page, layers } = paint([red({ blend: blend as never })]);
    expect(layers).toHaveLength(0);
    expect(page.to("fill")).toHaveLength(1);
    expect(page.to("fill")[0].state.globalCompositeOperation).toBe("source-over");
  });
});

describe("an element with a blend mode", () => {
  it.each(BLEND_MODES)("is painted on a layer the size of the page and laid over the page as %s", (mode) => {
    const { page, layers } = paint([red({ blend: mode })]);
    expect(layers).toHaveLength(1);
    const [layer] = layers;
    expect([layer.canvas.width, layer.canvas.height]).toEqual([400, 300]);
    // the shape is on the layer, painted as any shape is ...
    expect(page.to("fill")).toHaveLength(0);
    expect(layer.to("fill")).toHaveLength(1);
    expect(layer.to("fill")[0].state.globalCompositeOperation).toBe("source-over");
    // ... and the layer is laid over the page once, as the mode, pixel for pixel
    const laid = page.to("drawImage");
    expect(laid).toHaveLength(1);
    expect(laid[0].args).toEqual([layer.canvas, 0, 0, 400, 300, 0, 0, 400, 300]);
    expect(laid[0].state.globalCompositeOperation).toBe(mode);
    expect(laid[0].state.matrix).toEqual(IDENTITY);
  });

  it("lays the layer over the page inside the clip of the page, and puts the mode away afterwards", () => {
    const { page } = paint([red({ blend: "multiply" }), red({ x: 200, fill: solid("#00ff00") })]);
    const names = page.names();
    expect(names.indexOf("clip")).toBeLessThan(names.indexOf("drawImage"));
    // the element after it is painted normally again
    const second = page.to("fill")[0];
    expect(second.state.globalCompositeOperation).toBe("source-over");
    expect(names.indexOf("drawImage")).toBeLessThan(names.indexOf("fill"));
    expect(page.to("save")).toHaveLength(page.to("restore").length);
  });

  it("is painted on the layer exactly as it is painted on the page: same path, same place, same turn", () => {
    const element = { x: 120, y: 80, width: 100, height: 50, rotation: 30, flipH: true, opacity: 0.6 };
    const options = { scale: 1.5 };
    const direct = paint([red(element)], options);
    const blended = paint([red({ ...element, blend: "screen" })], options);
    const was = direct.page.to("fill")[0];
    const now = blended.layers[0].to("fill")[0];
    expect(now.args).toEqual(was.args);
    closeTo(now.state.matrix, was.state.matrix);
    expect(now.state.globalAlpha).toBeCloseTo(0.6);
  });

  it("is painted on the layer at the zoom and the clip that the page is painted with", () => {
    const clip = { x: 100, y: 50, w: 200, h: 100 };
    const { page, layers } = paint([red({ x: 150, y: 80, width: 40, height: 40, blend: "multiply" })], { scale: 2, clip });
    const [layer] = layers;
    // the layer starts with the transform that the page has when the element comes up ...
    expect(layer.to("setTransform").map((call) => call.args)).toContainEqual([2, 0, 0, 2, -200, -100]);
    // ... is cleared in device pixels first ...
    const cleared = layer.to("clearRect")[0];
    expect(cleared.args).toEqual([0, 0, 400, 300]);
    expect(cleared.state.matrix).toEqual(IDENTITY);
    // ... and its shape lands where it would land on the page
    const direct = paint([red({ x: 150, y: 80, width: 40, height: 40 })], { scale: 2, clip });
    closeTo(layer.to("fill")[0].state.matrix, direct.page.to("fill")[0].state.matrix);
    expect(page.to("drawImage")[0].state.matrix).toEqual(IDENTITY);
  });

  it("has its own opacity on the layer and leaves the opacity it inherits for the moment it is laid over the page", () => {
    const group = createGroup([red({ opacity: 0.5, blend: "multiply" })], { opacity: 0.5 });
    const { page, layers } = paint([group]);
    expect(layers[0].to("fill")[0].state.globalAlpha).toBeCloseTo(0.5);
    expect(page.to("drawImage")[0].state.globalAlpha).toBeCloseTo(0.5);
  });

  it("has the opacity of a fade laid over the page, on top of its own", () => {
    const animation: ElementAnimations = { in: { kind: "fade", duration: 1, delay: 0 } };
    const { page, layers } = paint([red({ blend: "overlay", opacity: 0.8, animation })], { animation: { time: 0.5 } });
    expect(layers[0].to("fill")[0].state.globalAlpha).toBeCloseTo(0.8);
    expect(page.to("drawImage")[0].state.globalAlpha).toBeCloseTo(0.5);
  });

  it("is shown through the window of a wipe, which clips what is laid over the page and not the layer", () => {
    const animation: ElementAnimations = { in: { kind: "wipe", duration: 1, delay: 0, direction: "right" } };
    const { page, layers } = paint([red({ blend: "multiply", animation })], { animation: { time: 0.5 } });
    expect(layers[0].to("clip")).toHaveLength(0);
    expect(page.to("clip")).toHaveLength(2);
    expect(page.names().lastIndexOf("clip")).toBeLessThan(page.names().indexOf("drawImage"));
  });

  it("is not painted at all when it is hidden or being edited", () => {
    const hidden = red({ blend: "multiply", hidden: true });
    const edited = red({ blend: "multiply" });
    const { page, layers } = paint([hidden, edited], { hide: new Set([edited.id]) });
    expect(layers).toHaveLength(0);
    expect(page.to("drawImage")).toHaveLength(0);
  });

  it("clears the layer before each element and keeps it as it found it, so one element never shows in the next", () => {
    const { page, layers } = paint([red({ blend: "multiply" }), red({ blend: "screen", x: 200 })]);
    // one layer serves both
    expect(layers).toHaveLength(1);
    const [layer] = layers;
    expect(layer.to("clearRect")).toHaveLength(2);
    const names = layer.names();
    expect(names.indexOf("clearRect")).toBeLessThan(names.indexOf("fill"));
    expect(names.lastIndexOf("clearRect")).toBeGreaterThan(names.indexOf("fill"));
    expect(layer.to("save")).toHaveLength(layer.to("restore").length);
    expect(page.to("drawImage").map((call) => call.state.globalCompositeOperation)).toEqual(["multiply", "screen"]);
  });

  it("clears the layer in device pixels, also when something left its context with a transform", () => {
    const canvas = pageCanvas();
    const page = createPage({ elements: [red({ blend: "multiply" })] });
    renderPage(canvas.ctx, { width: 400, height: 300 }, page, { scale: 1 });
    const [layer] = canvas.layers();
    // what a painter that stopped half way would leave behind
    layer.ctx.setTransform(2, 0, 0, 2, 30, 40);
    layer.clear();
    renderPage(canvas.ctx, { width: 400, height: 300 }, page, { scale: 1 });
    const cleared = layer.to("clearRect")[0];
    expect(cleared.args).toEqual([0, 0, 400, 300]);
    expect(cleared.state.matrix).toEqual(IDENTITY);
  });

  it("is still laid over the page when painting it went wrong, and the page goes on", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const made = captureContexts({ failOn: { fill: new Error("no paint") } });
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const after = createShape("ellipse", { x: 200, y: 100, width: 40, height: 40, fill: solid("#0000ff") });
    // every `fill` fails, on the layer and on the page: the layer is still laid over the page and the next element is still tried
    expect(() => renderPage(ctx, { width: 400, height: 300 }, createPage({ elements: [red({ blend: "multiply" }), after] }), { scale: 1 })).not.toThrow();
    expect(made[0].to("drawImage")).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("a group with a blend mode", () => {
  it("is mixed as one: its elements are painted normally on the layer of the group, which is laid over the page", () => {
    const a = red();
    const b = red({ x: 90, fill: solid("#0000ff") });
    const { page, layers } = paint([createGroup([a, b], { blend: "multiply", x: 0, y: 0, width: 300, height: 200 })]);
    expect(layers).toHaveLength(1);
    expect(layers[0].to("fill")).toHaveLength(2);
    expect(layers[0].to("fill").map((call) => call.state.globalCompositeOperation)).toEqual(["source-over", "source-over"]);
    expect(layers[0].to("drawImage")).toHaveLength(0);
    expect(page.to("drawImage")).toHaveLength(1);
    expect(page.to("drawImage")[0].state.globalCompositeOperation).toBe("multiply");
  });

  it("lets an element in it with a mode of its own mix with the others of the group, on a second layer", () => {
    const below = red({ fill: solid("#336699") });
    const above = red({ blend: "screen", x: 80, fill: solid("#996633") });
    const { page, layers } = paint([createGroup([below, above], { blend: "multiply", x: 0, y: 0, width: 300, height: 200 })]);
    expect(layers).toHaveLength(2);
    const [ofGroup, ofElement] = layers;
    // the element is painted on its own layer, which is laid over the layer of the group ...
    expect(ofElement.to("fill")).toHaveLength(1);
    expect(ofGroup.to("fill")).toHaveLength(1);
    expect(ofGroup.to("drawImage")).toHaveLength(1);
    expect(ofGroup.to("drawImage")[0].args[0]).toBe(ofElement.canvas);
    expect(ofGroup.to("drawImage")[0].state.globalCompositeOperation).toBe("screen");
    // ... and the layer of the group is laid over the page, once
    expect(page.to("drawImage")).toHaveLength(1);
    expect(page.to("drawImage")[0].args[0]).toBe(ofGroup.canvas);
    expect(page.to("drawImage")[0].state.globalCompositeOperation).toBe("multiply");
  });
});

describe("an element with a mode in a group with none", () => {
  it("mixes with what is under the group, as the group were not there", () => {
    const { page, layers } = paint([createGroup([red({ blend: "difference" })], { x: 0, y: 0, width: 300, height: 200 })]);
    expect(layers).toHaveLength(1);
    expect(page.to("drawImage")).toHaveLength(1);
    expect(page.to("drawImage")[0].state.globalCompositeOperation).toBe("difference");
  });
});

describe("the layers", () => {
  it("grow to fit the canvas that is painted and are never made smaller, so a thumbnail between two paints of the page costs no new layer", () => {
    const made = captureContexts();
    const canvasOf = (width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas.getContext("2d") as CanvasRenderingContext2D;
    };
    const page = createPage({ elements: [red({ blend: "multiply" })] });
    renderPage(canvasOf(400, 300), { width: 400, height: 300 }, page, { scale: 1 });
    const layer = made[1].canvas;
    expect([layer.width, layer.height]).toEqual([400, 300]);

    // a smaller canvas: the same layer, as it is, cleared and laid over in the part that the small canvas has
    renderPage(canvasOf(200, 100), { width: 400, height: 300 }, page, { scale: 0.5 });
    expect(made.map((spy) => spy.canvas)).toEqual([made[0].canvas, layer, made[2].canvas]);
    expect([layer.width, layer.height]).toEqual([400, 300]);
    expect(made[1].to("clearRect").map((call) => call.args)).toEqual([
      [0, 0, 400, 300],
      [0, 0, 200, 100],
    ]);
    expect(made[2].to("drawImage")[0].args).toEqual([layer, 0, 0, 200, 100, 0, 0, 200, 100]);

    // a bigger one, in one direction only: the layer grows in that direction
    renderPage(canvasOf(600, 100), { width: 400, height: 300 }, page, { scale: 1.5 });
    expect([layer.width, layer.height]).toEqual([600, 300]);
    renderPage(canvasOf(100, 500), { width: 400, height: 300 }, page, { scale: 1 });
    expect([layer.width, layer.height]).toEqual([600, 500]);
  });

  it("are let go on request, with the memory behind them, and made again when they are needed", () => {
    const first = paint([red({ blend: "multiply" })]);
    expect(first.layers[0].canvas.width).toBe(400);
    releaseLayers();
    expect([first.layers[0].canvas.width, first.layers[0].canvas.height]).toEqual([0, 0]);
    const second = paint([red({ blend: "multiply" })]);
    expect(second.layers[0].canvas).not.toBe(first.layers[0].canvas);
    expect(second.layers[0].to("fill")).toHaveLength(1);
  });

  it("are never made for a canvas that has no size, which could not be laid over anything", () => {
    for (const size of [
      { width: 0, height: 300 },
      { width: 400, height: 0 },
    ]) {
      const { page, layers } = paint([red({ blend: "multiply" })], {}, {}, size);
      expect(layers).toHaveLength(0);
      expect(page.to("drawImage")).toHaveLength(0);
    }
  });
});

describe("an element with a blend mode that has no layer to be painted on", () => {
  it("is painted straight onto the page where there is no document to make a layer in", () => {
    const canvas = pageCanvas();
    vi.stubGlobal("document", undefined);
    renderPage(canvas.ctx, { width: 400, height: 300 }, createPage({ elements: [red({ blend: "multiply" })] }), { scale: 1 });
    expect(canvas.layers()).toHaveLength(0);
    expect(canvas.page.to("fill")).toHaveLength(1);
    expect(canvas.page.to("fill")[0].state.globalCompositeOperation).toBe("source-over");
  });

  it("is painted straight onto the page when the browser gives no context for the layer", () => {
    const canvas = pageCanvas();
    const whole = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation() as (this: HTMLCanvasElement, type: string) => unknown;
    const page = canvas.ctx.canvas;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
      return this === page ? whole.call(this, type) : null;
    } as never);
    renderPage(canvas.ctx, { width: 400, height: 300 }, createPage({ elements: [red({ blend: "multiply" })] }), { scale: 1 });
    expect(canvas.page.to("fill")).toHaveLength(1);
    expect(canvas.page.to("drawImage")).toHaveLength(0);
  });
});

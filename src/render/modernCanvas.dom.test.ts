/**
 * jsdom's canvas knows neither `letterSpacing` nor `filter`, and the painters decide once, when they are loaded, whether
 * the browser has them. These tests give the painters a canvas class that does, and load fresh copies of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImage, createPage, createShape, createText, defaultFilter } from "@/core/factory";
import { captureContexts, spyContext } from "@/test/logicPaint";

class ModernContext2D {}
Object.defineProperty(ModernContext2D.prototype, "letterSpacing", { value: "0px", writable: true, configurable: true });
Object.defineProperty(ModernContext2D.prototype, "filter", { value: "none", writable: true, configurable: true });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("CanvasRenderingContext2D", ModernContext2D);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a canvas with letterSpacing", () => {
  const text = (init: Parameters<typeof createText>[0] = {}) => createText({ text: "Hello", fontSize: 40, x: 0, y: 0, width: 300, autoWidth: false, ...init });

  it("lets the canvas space the letters and draws each word in one piece", async () => {
    const { drawTextElement } = await import("./drawText");
    const spy = spyContext();
    drawTextElement(spy.ctx, text({ letterSpacing: 500 }), { scale: 1 });
    const draws = spy.to("fillText");
    expect(draws).toHaveLength(1);
    expect(draws[0].args[0]).toBe("Hello");
    // 500 thousandths of an em at 40 px
    expect(draws[0].state.letterSpacing).toBe("20px");
  });

  it("puts the spacing back to nothing afterwards", async () => {
    const { drawTextElement } = await import("./drawText");
    const spy = spyContext();
    drawTextElement(spy.ctx, text({ letterSpacing: 500 }), { scale: 1 });
    expect(spy.ctx.letterSpacing).toBe("0px");
  });

  it("spaces stroked letters the same way", async () => {
    const { drawTextElement } = await import("./drawText");
    const spy = spyContext();
    drawTextElement(spy.ctx, text({ letterSpacing: -100, effect: { kind: "hollow" } }), { scale: 1 });
    expect(spy.to("strokeText")).toHaveLength(1);
    expect(spy.to("strokeText")[0].state.letterSpacing).toBe("-4px");
  });

  it("does not touch the spacing of text that has none", async () => {
    const { drawTextElement } = await import("./drawText");
    const spy = spyContext();
    drawTextElement(spy.ctx, text(), { scale: 1 });
    expect(spy.to("fillText")[0].state.letterSpacing).toBe("0px");
  });
});

describe("a canvas with a filter property", () => {
  it("knows it has one", async () => {
    const { supportsCtxFilter } = await import("./imageFilters");
    expect(supportsCtxFilter).toBe(true);
  });

  it("does not claim a filter when looking at the canvas class fails", async () => {
    const Blocked = function Blocked() {} as unknown as typeof CanvasRenderingContext2D;
    Object.defineProperty(Blocked, "prototype", {
      value: new Proxy(
        {},
        {
          has() {
            throw new Error("not for scripts");
          },
        },
      ),
    });
    vi.stubGlobal("CanvasRenderingContext2D", Blocked);
    const { supportsCtxFilter } = await import("./imageFilters");
    expect(supportsCtxFilter).toBe(false);
  });

  it("blurs an element through the context, in canvas pixels", async () => {
    const { renderPage } = await import("./renderPage");
    const spy = spyContext();
    renderPage(spy.ctx, { width: 400, height: 300 }, createPage({ elements: [createShape("rect", { blur: 4 }), createShape("rect", { blur: 0 })] }), { scale: 2 });
    const [blurred, sharp] = spy.to("fill");
    expect(blurred.state.filter).toBe("blur(8.00px)");
    expect(sharp.state.filter).toBe("none");
    expect(spy.ctx.filter).toBe("none");
  });

  it("filters a picture while drawing it into its off-screen copy", async () => {
    const { renderFiltered } = await import("./imageFilters");
    const spies = captureContexts();
    const copy = renderFiltered({
      key: "modern-photo",
      img: document.createElement("canvas"),
      dx: 0,
      dy: 0,
      dw: 200,
      dh: 100,
      boxW: 200,
      boxH: 100,
      filter: { ...defaultFilter(), brightness: 30, blur: 50 },
      scale: 2,
    });
    expect([copy.width, copy.height]).toEqual([400, 200]);
    const draw = spies[0].to("drawImage")[0];
    expect(draw.state.filter).toBe("brightness(1.300) blur(14.00px)");
    expect(spies[0].ctx.filter).toBe("none");
  });

  it("filters the picture of an element when the page is painted", async () => {
    const { renderPage } = await import("./renderPage");
    const { loadImage } = await import("./images");
    const src = "blob:test/modern-page.png";
    await loadImage(src);
    const target = spyContext();
    const spies = captureContexts();
    const element = createImage({ src, width: 200, height: 100, naturalWidth: 64, naturalHeight: 48, filter: { ...defaultFilter(), contrast: -20 } });
    renderPage(target.ctx, { width: 400, height: 300 }, createPage({ elements: [element] }), { scale: 1 });
    const copy = spies.find((s) => s.to("drawImage").length > 0)!;
    expect(copy.to("drawImage")[0].state.filter).toBe("contrast(0.800)");
    expect((target.to("drawImage")[0].args[0] as HTMLCanvasElement).width).toBe(200);
  });
});

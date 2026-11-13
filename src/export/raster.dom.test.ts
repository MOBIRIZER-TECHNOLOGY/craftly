import { afterEach, describe, expect, it, vi } from "vitest";
import { createImage, createPage, createShape, solid } from "@/core/factory";
import { contextOf } from "@/test/canvasMock";
import { captureContexts } from "@/test/logicPaint";
import { ExportError, isCancelled } from "./errors";
import { canvasToBlob, releaseCanvas, renderExportCanvas, renderPageBlob } from "./raster";

const page = (color = "#336699") => createPage({ background: solid(color), elements: [createShape("rect", { x: 10, y: 10, width: 30, height: 30, fill: solid("#ff0000") })] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderExportCanvas", () => {
  it("makes a canvas of the design size times the scale, rounded", async () => {
    const canvas = await renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 2 });
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    const odd = await renderExportCanvas({ width: 101, height: 33 }, page(), { scale: 0.5 });
    expect([odd.width, odd.height]).toEqual([51, 17]);
    const tiny = await renderExportCanvas({ width: 2, height: 2 }, page(), { scale: 0.25 });
    expect([tiny.width, tiny.height]).toEqual([1, 1]);
  });

  it("paints the page once, at the scale of the canvas", async () => {
    const spies = captureContexts();
    await renderExportCanvas({ width: 100, height: 50 }, page("#112233"), { scale: 2 });
    const ctx = spies[0];
    expect(ctx.to("clearRect")).toHaveLength(1);
    expect(ctx.to("setTransform")[1].args.slice(0, 4)).toEqual([2, 0, 0, 2]);
    expect(ctx.to("fillRect")[0].state.fillStyle).toBe("#112233");
    expect(ctx.to("fill")).toHaveLength(1);
  });

  it("leaves out the page background for a transparent export", async () => {
    const spies = captureContexts();
    await renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 1, transparent: true });
    expect(spies[0].to("fillRect")).toHaveLength(0);
    expect(spies[0].to("fill")).toHaveLength(1);
  });

  it("flattens the picture onto a colour behind everything, for formats that have no transparency", async () => {
    const spies = captureContexts();
    await renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 1, transparent: true, flatten: "#ffffff" });
    const flatten = spies[0].to("fillRect").at(-1)!;
    expect(flatten.args).toEqual([0, 0, 100, 50]);
    expect(flatten.state.fillStyle).toBe("#ffffff");
    expect(flatten.state.globalCompositeOperation).toBe("destination-over");
    expect(spies[0].ctx.globalCompositeOperation).toBe("source-over");
  });

  describe("with a bleed", () => {
    it("makes the canvas larger by the bleed on every side and moves the page in by it", async () => {
      const spies = captureContexts();
      const canvas = await renderExportCanvas({ width: 100, height: 50 }, page("#112233"), { scale: 2, bleed: 10 });
      expect([canvas.width, canvas.height]).toEqual([240, 140]);
      const ctx = spies[0];
      expect(ctx.to("setTransform")[1].args).toEqual([2, 0, 0, 2, 20, 20]);
      // what is painted is cut at the edge of the bleed, not at the edge of the page
      expect(ctx.to("rect")[0].args).toEqual([-10, -10, 120, 70]);
      // the background is stretched over the bleed: painted 120 x 70 from the corner of the bleed
      const background = ctx.to("fillRect")[0];
      expect(background.args).toEqual([0, 0, 120, 70]);
      expect(background.state.fillStyle).toBe("#112233");
      expect(background.state.matrix).toEqual([2, 0, 0, 2, 0, 0]);
      // the elements keep their place on the page: the shape at (10, 10) is 20 design pixels from the corner of the canvas
      expect(ctx.to("fill")[0].state.matrix).toEqual([2, 0, 0, 2, 40, 40]);
    });

    it("flattens the whole canvas, bleed included", async () => {
      const spies = captureContexts();
      await renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 1, bleed: 5, flatten: "#ffffff" });
      expect(spies[0].to("fillRect").at(-1)!.args).toEqual([0, 0, 110, 60]);
    });

    it("paints nothing behind a transparent page, in the bleed as on the page", async () => {
      const spies = captureContexts();
      await renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 1, bleed: 5, transparent: true });
      expect(spies[0].to("fillRect")).toHaveLength(0);
    });

    it("paints a large page band by band over the whole height, bleed included", async () => {
      const spies = captureContexts();
      const canvas = await renderExportCanvas({ width: 3980, height: 2980 }, page(), { scale: 1, bleed: 10 });
      expect([canvas.width, canvas.height]).toEqual([4000, 3000]);
      const [main, band] = spies;
      expect(main.to("drawImage").map((c) => c.args.slice(1))).toEqual([
        [0, 0],
        [0, 1000],
        [0, 2000],
      ]);
      // each band sees the page moved in by the bleed, through a window further down
      const offsets = band
        .to("setTransform")
        .filter((_c, i) => i % 2 === 1)
        .map((c) => [c.args[4], c.args[5]]);
      expect(offsets).toEqual([
        [10, 10],
        [10, -990],
        [10, -1990],
      ]);
    });

    it("is the picture without bleed when the bleed is 0 or not a size", async () => {
      for (const bleed of [0, -3, Number.NaN]) {
        const spies = captureContexts();
        const canvas = await renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 2, bleed });
        expect([canvas.width, canvas.height]).toEqual([200, 100]);
        expect(spies[0].to("rect")[0].args).toEqual([0, 0, 100, 50]);
        expect(spies[0].to("fillRect")[0].args).toEqual([0, 0, 100, 50]);
      }
    });
  });

  it("does not paint a picture that never loads more than once", async () => {
    const broken = createPage({ elements: [createImage({ src: "https://example.test/broken-raster.png", width: 50, height: 50 })] });
    const spies = captureContexts();
    await renderExportCanvas({ width: 100, height: 50 }, broken, { scale: 1 });
    expect(spies[0].to("clearRect")).toHaveLength(1);
  });

  describe("elements with a blend mode", () => {
    const blended = () => createPage({ elements: [createShape("rect", { x: 10, y: 10, width: 30, height: 30, fill: solid("#ff0000"), blend: "multiply" })] });

    it("are mixed on a layer as big as the export, which is let go of when the export is done", async () => {
      const first = captureContexts();
      await renderExportCanvas({ width: 100, height: 50 }, blended(), { scale: 2 });
      const [main, layer] = first;
      expect(layer.to("clearRect")[0].args).toEqual([0, 0, 200, 100]);
      expect(layer.to("fill")).toHaveLength(1);
      expect(main.to("drawImage")[0].state.globalCompositeOperation).toBe("multiply");
      expect(layer.canvas.width).toBe(0);
      // the next export makes its own layer
      const second = captureContexts();
      await renderExportCanvas({ width: 100, height: 50 }, blended(), { scale: 2 });
      expect(second[1].canvas).not.toBe(layer.canvas);
    });

    it("are mixed in every band of a page too large for one pass, on layers as big as a band", async () => {
      const spies = captureContexts();
      await renderExportCanvas({ width: 4000, height: 3000 }, blended(), { scale: 1 });
      const [, band, layer] = spies;
      expect(band.to("drawImage").map((call) => call.state.globalCompositeOperation)).toEqual(["multiply", "multiply", "multiply"]);
      expect(layer.to("clearRect").map((call) => call.args)).toEqual([
        [0, 0, 4000, 1000],
        [0, 0, 4000, 1000],
        [0, 0, 4000, 1000],
      ]);
    });
  });

  it("refuses when the browser cannot give it a 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 1 })).rejects.toMatchObject({ code: "too-large" });
  });

  it("refuses when the browser gives a canvas smaller than it was asked for", async () => {
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag === "canvas") {
        // a browser that refuses a huge canvas keeps the old (default) size
        Object.defineProperty(el, "width", { get: () => 300, set: () => undefined, configurable: true });
      }
      return el;
    });
    await expect(renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 4 })).rejects.toThrow(ExportError);
  });

  it("is cancelled before it starts by an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(renderExportCanvas({ width: 100, height: 50 }, page(), { scale: 1, signal: controller.signal })).rejects.toSatisfy(isCancelled);
  });

  describe("a page too large for one pass", () => {
    // 4000 x 3000 px = 12 million pixels, above the 9 million of a single pass: three bands of 1000 rows
    const design = { width: 4000, height: 3000 };

    it("is painted band by band through one band canvas and copied into place", async () => {
      const spies = captureContexts();
      const canvas = await renderExportCanvas(design, page("#445566"), { scale: 1 });
      expect([canvas.width, canvas.height]).toEqual([4000, 3000]);
      const [main, band] = spies;
      expect(main.to("drawImage").map((c) => c.args.slice(1))).toEqual([
        [0, 0],
        [0, 1000],
        [0, 2000],
      ]);
      expect(main.to("clearRect").map((c) => c.args)).toEqual([
        [0, 0, 4000, 1000],
        [0, 1000, 4000, 1000],
        [0, 2000, 4000, 1000],
      ]);
      // each band is the same page seen through a window further down
      const offsets = band
        .to("setTransform")
        .filter((_c, i) => i % 2 === 1)
        .map((c) => c.args[5]);
      expect(offsets.map((v) => Math.abs(v as number))).toEqual([0, 1000, 2000]);
      expect(band.to("getImageData")).toHaveLength(3);
      expect(band.canvas.height).toBe(0);
    });

    it("lets the last band be shorter", async () => {
      const spies = captureContexts();
      await renderExportCanvas({ width: 4000, height: 3001 }, page(), { scale: 1 });
      expect(spies[0].to("clearRect").map((c) => c.args[3])).toEqual([751, 751, 751, 748]);
    });

    it("flattens after the last band", async () => {
      const spies = captureContexts();
      await renderExportCanvas(design, page(), { scale: 1, flatten: "#ffffff" });
      expect(spies[0].to("fillRect").at(-1)!.state.globalCompositeOperation).toBe("destination-over");
    });

    it("stops when it is cancelled half way", async () => {
      const controller = new AbortController();
      captureContexts({ onCall: (name) => name === "getImageData" && controller.abort() });
      await expect(renderExportCanvas(design, page(), { scale: 1, signal: controller.signal })).rejects.toSatisfy(isCancelled);
    });

    it("refuses when the band canvas cannot get a 2D context", async () => {
      const real = HTMLCanvasElement.prototype.getContext;
      let calls = 0;
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
        calls++;
        return calls === 1 ? (real.call(this, type) as never) : (null as never);
      } as never);
      await expect(renderExportCanvas(design, page(), { scale: 1 })).rejects.toMatchObject({ code: "too-large" });
    });
  });
});

describe("releaseCanvas", () => {
  it("empties the canvas so its memory goes back at once", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 400;
    releaseCanvas(canvas);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });
});

describe("canvasToBlob", () => {
  const canvas = () => document.createElement("canvas");

  it("encodes a canvas at the quality asked for", async () => {
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const blob = await canvasToBlob(canvas(), "image/jpeg", 0.8);
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBeGreaterThan(0);
    expect(toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.8]);
    await canvasToBlob(canvas(), "image/png");
    expect(toBlob.mock.calls[1].slice(1)).toEqual(["image/png", undefined]);
  });

  it("says the picture is too large when the browser produces nothing", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    await expect(canvasToBlob(canvas(), "image/png")).rejects.toMatchObject({ code: "too-large" });
  });

  it("says the same when the blob is empty", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob([])));
    await expect(canvasToBlob(canvas(), "image/png")).rejects.toMatchObject({ code: "too-large" });
  });

  it("says the same when encoding throws, keeping the cause", async () => {
    const cause = new Error("SecurityError");
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {
      throw cause;
    });
    const error = await canvasToBlob(canvas(), "image/png").catch((e) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect(error.code).toBe("too-large");
    expect(error.cause).toBe(cause);
  });
});

describe("renderPageBlob", () => {
  it("renders and encodes a page and lets the canvas go", async () => {
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const blob = await renderPageBlob({ width: 100, height: 50 }, page(), { scale: 2, type: "image/png" });
    expect(blob.type).toBe("image/png");
    const rendered = toBlob.mock.contexts[0] as HTMLCanvasElement;
    expect([rendered.width, rendered.height]).toEqual([0, 0]);
    expect(contextOf(rendered)!.callsTo("clearRect")).toHaveLength(1);
  });

  it("lets the canvas go even when encoding fails", async () => {
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    await expect(renderPageBlob({ width: 100, height: 50 }, page(), { scale: 1, type: "image/jpeg", quality: 0.5 })).rejects.toMatchObject({ code: "too-large" });
    expect((toBlob.mock.contexts[0] as HTMLCanvasElement).width).toBe(0);
    expect(toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.5]);
  });
});

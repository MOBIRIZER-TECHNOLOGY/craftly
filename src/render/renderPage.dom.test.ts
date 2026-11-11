import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateAnimation } from "@/core/animation";
import {
  createChart,
  createFrame,
  createGraphic,
  createGroup,
  createImage,
  createLine,
  createPage,
  createShape,
  createTable,
  createText,
  defaultFilter,
  solid,
} from "@/core/factory";
import type { ArrowKind, DesignElement, ElementAnimations, Fill, Page } from "@/core/types";
import { contextOf } from "@/test/canvasMock";
import { spyContext, toDevice, type PaintCall } from "@/test/logicPaint";
import { loadImage, loadSvgImage } from "./images";
import { collectResources, graphicMarkup, preparePage, renderPage, renderPageToCanvas, type RenderOptions } from "./renderPage";
import { layoutText } from "./textLayout";

const DESIGN = { width: 400, height: 300 };
let counter = 0;
/** A fresh image address per call: the image cache lives as long as the module does. */
const url = (name: string) => `blob:test/${name}-${++counter}.png`;

function paint(elements: DesignElement[], opts: Partial<RenderOptions> = {}, page: Partial<Page> = {}, size = DESIGN) {
  const spy = spyContext({ width: 400, height: 300 });
  const complete = renderPage(spy.ctx, size, createPage({ elements, ...page }), { scale: 1, ...opts });
  return { spy, complete };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const pathOf = (call: PaintCall, index = 0) => (call.args[index] as unknown as { data: string }).data;
const origin = (call: PaintCall) => toDevice(call.state.matrix, 0, 0);
const deg = (d: number) => (d * Math.PI) / 180;

describe("page background", () => {
  it("clears the canvas, clips to the page and fills it with the page colour", () => {
    const { spy, complete } = paint([], {}, { background: solid("#112233") });
    expect(complete).toBe(true);
    expect(spy.names().indexOf("clearRect")).toBeLessThan(spy.names().indexOf("fillRect"));
    expect(spy.to("clearRect")[0].args).toEqual([0, 0, 400, 300]);
    expect(spy.to("rect")[0].args).toEqual([0, 0, 400, 300]);
    expect(spy.to("clip")).toHaveLength(1);
    const fill = spy.to("fillRect")[0];
    expect(fill.args).toEqual([0, 0, 400, 300]);
    expect(fill.state.fillStyle).toBe("#112233");
  });

  it("paints at the requested scale and only the clipped region", () => {
    const element = createShape("rect", { x: 150, y: 80, width: 40, height: 40, fill: solid("#ff0000") });
    const { spy } = paint([element], { scale: 2, clip: { x: 100, y: 50, w: 200, h: 100 } });
    expect(spy.to("setTransform")[0].args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(spy.to("setTransform")[1].args).toEqual([2, 0, 0, 2, -200, -100]);
    const where = origin(spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(100);
    expect(where.y).toBeCloseTo(60);
  });

  it("leaves the background out of a transparent export but still paints the elements", () => {
    const element = createShape("rect", { width: 10, height: 10 });
    const { spy } = paint([element], { transparent: true });
    expect(spy.to("fillRect")).toHaveLength(0);
    expect(spy.to("fill")).toHaveLength(1);
  });

  it("fills with a linear gradient along the requested angle, clamping the stops", () => {
    const background: Fill = {
      type: "linear",
      angle: 90,
      stops: [
        { offset: -0.5, color: "#ff0000" },
        { offset: 1.5, color: "#0000ff" },
      ],
    };
    const { spy } = paint([], {}, { background });
    const [x0, y0, x1, y1] = spy.to("createLinearGradient")[0].args as number[];
    expect([x0, y0, x1, y1].map((v) => Math.round(v))).toEqual([0, 150, 400, 150]);
    const gradient = spy.to("fillRect")[0].state.fillStyle as { stops: unknown[] };
    expect(gradient.stops).toEqual([
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ]);
  });

  it("fills with a radial gradient that reaches the farthest corner from its centre", () => {
    const stops = [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#000000" },
    ];
    const centred = paint([], {}, { background: { type: "radial", stops } });
    expect(centred.spy.to("createRadialGradient")[0].args).toEqual([200, 150, 0, 200, 150, 250]);
    const corner = paint([], {}, { background: { type: "radial", stops, cx: 0, cy: 0 } });
    expect(corner.spy.to("createRadialGradient")[0].args).toEqual([0, 0, 0, 0, 0, 500]);
  });

  it("fills with a repeating pattern tile that is mapped back to design pixels", () => {
    vi.stubGlobal(
      "DOMMatrix",
      class {
        scaleBy = 1;
        scale(k: number) {
          this.scaleBy = k;
          return this;
        }
      },
    );
    const background: Fill = { type: "pattern", pattern: "dots", color: "#ab0000", background: "#fafafa", scale: 1 };
    const { spy } = paint([], { scale: 2 }, { background });
    const call = spy.to("createPattern")[0];
    expect(call.args[1]).toBe("repeat");
    const tile = call.args[0] as HTMLCanvasElement;
    expect([tile.width, tile.height]).toEqual([52, 52]);
    const pattern = spy.to("fillRect")[0].state.fillStyle as { transforms: Array<{ scaleBy: number }> };
    expect(pattern.transforms.map((m) => m.scaleBy)).toEqual([0.5]);
  });

  describe("image background", () => {
    const wide = { width: 400, height: 200 };

    it("shows the neutral paper colour while the picture loads, then draws it", async () => {
      const src = url("bg");
      const first = paint([], {}, { background: { type: "image", src, fit: "cover" } }, wide);
      expect(first.complete).toBe(false);
      expect(first.spy.to("fillRect")[0].state.fillStyle).toBe("#e9ebf0");
      expect(first.spy.to("drawImage")).toHaveLength(0);

      await loadImage(src);
      const second = paint([], {}, { background: { type: "image", src, fit: "cover" } }, wide);
      expect(second.complete).toBe(true);
      expect(second.spy.to("drawImage")).toHaveLength(1);
    });

    it("covers the page, cropping the overflow evenly", async () => {
      const src = url("bg-cover");
      await loadImage(src);
      const { spy } = paint([], {}, { background: { type: "image", src, fit: "cover" } }, wide);
      const [, x, y, w, h] = spy.to("drawImage")[0].args as number[];
      expect([x, y, w, h].map((v) => Math.round(v * 100) / 100)).toEqual([0, -50, 400, 300]);
    });

    it("contains the picture inside the page, centred", async () => {
      const src = url("bg-contain");
      await loadImage(src);
      const { spy } = paint([], {}, { background: { type: "image", src, fit: "contain" } }, wide);
      const [, x, y, w, h] = spy.to("drawImage")[0].args as number[];
      expect([x, y, w, h].map((v) => Math.round(v * 100) / 100)).toEqual([66.67, 0, 266.67, 200]);
    });

    it("tiles the picture as a repeating pattern", async () => {
      const src = url("bg-tile");
      await loadImage(src);
      const { spy } = paint([], {}, { background: { type: "image", src, fit: "tile" } }, wide);
      expect(spy.to("createPattern")[0].args[1]).toBe("repeat");
      expect(spy.to("drawImage")).toHaveLength(0);
      expect(spy.to("fillRect")).toHaveLength(2);
    });

    it("keeps the plain paper when the context cannot make a pattern of the picture", async () => {
      const src = url("bg-tile-fail");
      await loadImage(src);
      const spy = spyContext({ returns: { createPattern: null } });
      renderPage(spy.ctx, wide, createPage({ background: { type: "image", src, fit: "tile" } }), { scale: 1 });
      expect(spy.to("createPattern")).toHaveLength(1);
      expect(spy.to("fillRect")).toHaveLength(1);
      expect(spy.to("fillRect")[0].state.fillStyle).toBe("#e9ebf0");
    });

    it.each([
      [0.5, "rgba(0,0,0,0.5)"],
      [2, "rgba(0,0,0,0.9)"],
      [-0.3, "rgba(255,255,255,0.3)"],
    ])("dims the picture by %s", async (dim, expected) => {
      const src = url("bg-dim");
      await loadImage(src);
      const { spy } = paint([], {}, { background: { type: "image", src, fit: "cover", dim } }, wide);
      const overlay = spy.to("fillRect").at(-1)!;
      expect(overlay.state.fillStyle).toBe(expected);
    });

    it("does not dim when no dimming is set", async () => {
      const src = url("bg-nodim");
      await loadImage(src);
      const { spy } = paint([], {}, { background: { type: "image", src, fit: "cover" } }, wide);
      expect(spy.to("fillRect")).toHaveLength(1);
    });
  });
});

describe("shapes", () => {
  it("fills the path of the shape at its position", () => {
    const rect = createShape("rect", { x: 10, y: 20, width: 100, height: 50, fill: solid("#ff0000") });
    const { spy, complete } = paint([rect]);
    expect(complete).toBe(true);
    const fill = spy.to("fill")[0];
    expect(pathOf(fill)).toBe("M0 0H100V50H0Z");
    expect(fill.args[1]).toBe("nonzero");
    expect(fill.state.fillStyle).toBe("#ff0000");
    expect(origin(fill)).toEqual({ x: 10, y: 20 });
  });

  it("rotates a shape about the centre of its box", () => {
    const rect = createShape("rect", { x: 10, y: 20, width: 100, height: 50, rotation: 90 });
    const { spy } = paint([rect]);
    const where = origin(spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(85);
    expect(where.y).toBeCloseTo(-5);
  });

  it("mirrors a flipped shape about the centre of its box", () => {
    const flipped = createShape("rect", { x: 10, y: 20, width: 100, height: 50, flipH: true });
    expect(origin(paint([flipped]).spy.to("fill")[0])).toEqual({ x: 110, y: 20 });
    const upside = createShape("rect", { x: 10, y: 20, width: 100, height: 50, flipV: true });
    expect(origin(paint([upside]).spy.to("fill")[0])).toEqual({ x: 10, y: 70 });
  });

  it("applies the element opacity to its paint", () => {
    const { spy } = paint([createShape("rect", { opacity: 0.4 })]);
    expect(spy.to("fill")[0].state.globalAlpha).toBeCloseTo(0.4);
    expect(spy.ctx.globalAlpha).toBe(1);
  });

  it("uses the even-odd rule for a ring so the hole stays empty", () => {
    const { spy } = paint([createShape("ring", { width: 100, height: 100 })]);
    expect(spy.to("fill")[0].args[1]).toBe("evenodd");
  });

  it("rounds the corners of a rectangle by its radius", () => {
    const { spy } = paint([createShape("rect", { width: 100, height: 50, radius: 10 })]);
    expect(pathOf(spy.to("fill")[0])).toContain("A10 10 0 0 1");
  });

  it("paints a custom path stretched to the box", () => {
    const { spy } = paint([createShape("path", { width: 200, height: 100, path: "M0 0L100 0L100 100Z" })]);
    expect(pathOf(spy.to("fill")[0])).toBe("M0 0L200 0L200 100Z");
  });

  it("fills with a gradient sized to the element box", () => {
    const fill: Fill = {
      type: "linear",
      angle: 180,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    };
    const { spy } = paint([createShape("rect", { width: 100, height: 60, fill })]);
    const [x0, y0, x1, y1] = spy.to("createLinearGradient")[0].args as number[];
    expect([x0, y0, x1, y1].map((v) => Math.round(v) + 0)).toEqual([50, 0, 50, 60]);
  });

  it("paints nothing for an image fill: only pages use those", () => {
    const { spy } = paint([createShape("rect", { fill: { type: "image", src: "x.png", fit: "cover" } })]);
    expect(spy.to("fill")).toHaveLength(0);
    expect(spy.to("stroke")).toHaveLength(0);
  });

  describe("strokes", () => {
    const stroked = (stroke: NonNullable<ReturnType<typeof createShape>["stroke"]>, fill: ReturnType<typeof createShape>["fill"] = null) =>
      paint([createShape("rect", { width: 100, height: 50, fill, stroke })]).spy;

    it("draws a solid outline in the stroke colour and width", () => {
      const spy = stroked({ color: "#00ff00", width: 4, style: "solid" });
      const stroke = spy.to("stroke")[0];
      expect(spy.to("fill")).toHaveLength(0);
      expect(stroke.state.strokeStyle).toBe("#00ff00");
      expect(stroke.state.lineWidth).toBe(4);
      expect(stroke.state.lineDash).toEqual([]);
      expect(stroke.state.lineCap).toBe("butt");
      expect(stroke.state.lineJoin).toBe("round");
    });

    it("dashes a dashed outline in proportion to its width", () => {
      expect(stroked({ color: "#000000", width: 5, style: "dashed" }).to("stroke")[0].state.lineDash).toEqual([15, 10]);
    });

    it("draws a dotted outline as round dots", () => {
      const stroke = stroked({ color: "#000000", width: 5, style: "dotted" }).to("stroke")[0];
      expect(stroke.state.lineDash).toEqual([0.01, 10]);
      expect(stroke.state.lineCap).toBe("round");
    });

    it("honours an explicit cap and join", () => {
      const stroke = stroked({ color: "#000000", width: 5, style: "solid", cap: "square", join: "bevel" }).to("stroke")[0];
      expect(stroke.state.lineCap).toBe("square");
      expect(stroke.state.lineJoin).toBe("bevel");
    });

    it("paints the fill first and the outline over it", () => {
      const spy = stroked({ color: "#000000", width: 2, style: "solid" }, solid("#ff0000"));
      expect(spy.names().indexOf("fill")).toBeLessThan(spy.names().indexOf("stroke"));
    });

    it("skips an outline of no width", () => {
      const spy = stroked({ color: "#000000", width: 0, style: "solid" }, solid("#ff0000"));
      expect(spy.to("stroke")).toHaveLength(0);
      expect(spy.to("fill")).toHaveLength(1);
    });
  });

  describe("shadows", () => {
    const shadow = { color: "rgba(0,0,0,0.5)", blur: 6, x: 10, y: 5 };

    it("casts the shadow first, from a copy of the shape moved off the canvas, landing offset from the shape", () => {
      const element = createShape("rect", { x: 40, y: 30, width: 100, height: 50, rotation: 30, shadow, fill: solid("#336699") });
      const { spy } = paint([element], { scale: 2 });
      const [cast, real] = spy.to("fill");
      expect(cast.state.fillStyle).toBe("#000");
      expect(cast.state.shadowColor).toBe("rgba(0,0,0,0.5)");
      expect(cast.state.shadowBlur).toBe(12);
      expect(real.state.fillStyle).toBe("#336699");
      expect(real.state.shadowBlur).toBe(0);
      // the cast copy is far off the canvas, but its shadow lands where the shape is, plus the offset in canvas pixels
      const copy = origin(cast);
      expect(Math.abs(copy.x) > 1000 || Math.abs(copy.y) > 1000).toBe(true);
      const shape = origin(real);
      expect(copy.x + cast.state.shadowOffsetX).toBeCloseTo(shape.x + shadow.x * 2);
      expect(copy.y + cast.state.shadowOffsetY).toBeCloseTo(shape.y + shadow.y * 2);
    });

    it("shadows only the outline of a shape that has a stroke and no fill", () => {
      const element = createShape("rect", { width: 100, height: 50, fill: null, stroke: { color: "#112233", width: 3, style: "solid" }, shadow });
      const { spy } = paint([element]);
      expect(spy.to("fill")).toHaveLength(0);
      const [cast, real] = spy.to("stroke");
      expect(cast.state.strokeStyle).toBe("#112233");
      expect(cast.state.shadowColor).toBe(shadow.color);
      expect(real.state.shadowBlur).toBe(0);
    });

    it("traces a hairline for a shape that has neither fill nor stroke", () => {
      const element = createShape("rect", { width: 100, height: 50, fill: null, stroke: null, shadow });
      const { spy } = paint([element]);
      expect(spy.to("stroke")).toHaveLength(1);
      expect(spy.to("stroke")[0].state.shadowColor).toBe(shadow.color);
    });
  });
});

describe("lines", () => {
  const line = (init: Parameters<typeof createLine>[0] = {}) => createLine({ x: 10, y: 20, width: 300, stroke: { color: "#0000ff", width: 6, style: "solid" }, ...init });
  const HEAD = 19.2; // max(3.2 x the stroke width, 14)

  it("strokes a straight shaft along the width of the box", () => {
    const { spy } = paint([line()]);
    const stroke = spy.to("stroke");
    expect(stroke).toHaveLength(1);
    expect(spy.to("moveTo").at(-1)!.args).toEqual([0, 0]);
    expect(spy.to("lineTo").at(-1)!.args).toEqual([300, 0]);
    expect(stroke[0].state.strokeStyle).toBe("#0000ff");
    expect(stroke[0].state.lineWidth).toBe(6);
    expect(stroke[0].state.lineCap).toBe("butt");
    expect(origin(stroke[0])).toEqual({ x: 10, y: 20 });
  });

  it.each<[ArrowKind, number, string]>([
    ["arrow", 0.55, "fill"],
    ["triangle", 0.9, "fill"],
    ["circle", 0.6, "fill"],
    ["square", 0.7, "fill"],
    ["diamond", 0.8, "fill"],
    ["open-arrow", 0, "stroke"],
    ["bar", 0, "stroke"],
  ])("ends the shaft before a %s head and draws the head in the line colour", (kind, inset, how) => {
    const { spy } = paint([line({ endArrow: kind })]);
    expect(spy.to("lineTo").at(-1)!.args[0]).toBeCloseTo(300 - inset * HEAD);
    const head = spy.to(how)[0];
    expect(head.state[how === "fill" ? "fillStyle" : "strokeStyle"]).toBe("#0000ff");
    expect(head.state.lineDash).toEqual([]);
    // the head sits at the far end of the line
    expect(toDevice(head.state.matrix, 0, 0).x).toBeCloseTo(10 + 300);
  });

  it("draws nothing extra for an arrow kind it does not know", () => {
    const { spy } = paint([line({ endArrow: "mystery" as ArrowKind })]);
    expect(spy.to("fill")).toHaveLength(0);
    expect(spy.to("stroke")).toHaveLength(1);
    expect(spy.to("lineTo").at(-1)!.args[0]).toBe(300);
  });

  it("starts the shaft after a mirrored head at the near end", () => {
    const { spy } = paint([line({ startArrow: "triangle" })]);
    // inset of the head plus a little air so the round cap does not poke out of the tip
    expect(spy.to("moveTo").at(-1)!.args[0]).toBeCloseTo(0.9 * HEAD + 0.1 * HEAD);
    const base = spy.to("lineTo")[0];
    // the head points away from the line: its base lies towards the line, to the right of the tip
    const tip = toDevice(base.state.matrix, 0, 0).x;
    const corner = toDevice(base.state.matrix, base.args[0] as number, base.args[1] as number).x;
    expect(tip).toBeCloseTo(10);
    expect(corner).toBeCloseTo(10 + HEAD);
  });

  it("keeps the shaft from running backwards when the line is shorter than its heads", () => {
    const { spy } = paint([line({ width: 20, startArrow: "triangle", endArrow: "triangle" })]);
    const from = spy.to("moveTo").at(-1)!.args[0] as number;
    const to = spy.to("lineTo").at(-1)!.args[0] as number;
    expect(to).toBe(from);
  });

  it("casts a shadow on the line and its heads and then puts the shadow away", () => {
    const shadow = { color: "#444444", blur: 3, x: 2, y: 4 };
    const { spy } = paint([line({ shadow, endArrow: "arrow" })], { scale: 2 });
    const shaft = spy.to("stroke")[0];
    expect(shaft.state.shadowColor).toBe("#444444");
    expect(shaft.state.shadowBlur).toBe(6);
    expect([shaft.state.shadowOffsetX, shaft.state.shadowOffsetY]).toEqual([4, 8]);
    expect(spy.ctx.shadowBlur).toBe(0);
  });
});

describe("images", () => {
  it("shows a frame as a soft placeholder with a picture icon, clipped to its mask", () => {
    const { spy, complete } = paint([createFrame("ellipse", { x: 20, y: 30, width: 300, height: 200 })]);
    expect(complete).toBe(true);
    expect(pathOf(spy.to("clip").at(-1)!)).toContain("A150 100");
    const base = spy.to("fillRect").at(-1)!;
    expect(base.state.fillStyle).toBe("#e7e9ef");
    expect(base.args).toEqual([0, 0, 300, 200]);
    const icon = spy.to("fill")[0];
    expect(icon.state.fillStyle).toBe("#b3b8c4");
    expect(pathOf(icon)).toContain("M4 18");
    // the icon is 26 % of the shorter side (52 px, drawn from a 26 unit design) and sits in the middle of the frame
    expect(spy.to("scale").at(-1)!.args).toEqual([2, 2]);
    const iconOrigin = origin(icon);
    expect(iconOrigin.x).toBeCloseTo(20 + 150 - 26);
    expect(iconOrigin.y).toBeCloseTo(30 + 100 - 26);
  });

  it("shows a skeleton while the picture loads and reports that the page is not complete", async () => {
    const src = url("skeleton");
    const element = createImage({ src, x: 10, y: 10, width: 200, height: 100, naturalWidth: 64, naturalHeight: 48 });
    const first = paint([element]);
    expect(first.complete).toBe(false);
    expect(first.spy.to("fillRect").at(-1)!.state.fillStyle).toBe("#eceef3");
    expect(first.spy.to("drawImage")).toHaveLength(0);

    await loadImage(src);
    const second = paint([element]);
    expect(second.complete).toBe(true);
    expect(second.spy.to("drawImage")).toHaveLength(1);
  });

  it("draws the picture inside its clip using the crop", async () => {
    const src = url("crop");
    await loadImage(src);
    const element = createImage({ src, x: 10, y: 20, width: 200, height: 100, naturalWidth: 64, naturalHeight: 48, crop: { x: -0.25, y: -0.1, w: 1.5, h: 1.2 } });
    const { spy } = paint([element]);
    const draw = spy.to("drawImage")[0];
    expect(draw.args.slice(1)).toEqual([-50, -10, 300, 120]);
    expect(pathOf(spy.to("clip").at(-1)!)).toBe("M0 0H200V100H0Z");
    expect(spy.names().lastIndexOf("clip")).toBeLessThan(spy.names().indexOf("drawImage"));
  });

  it("covers its box when the factory computed the crop", async () => {
    const src = url("cover");
    await loadImage(src);
    const element = createImage({ src, x: 0, y: 0, width: 200, height: 100, naturalWidth: 64, naturalHeight: 48 });
    const { spy } = paint([element]);
    expect(spy.to("drawImage")[0].args.slice(1)).toEqual([0, -25, 200, 150]);
  });

  it("masks a picture with the shape it was given", async () => {
    const src = url("mask");
    await loadImage(src);
    const element = createImage({ src, width: 100, height: 100, naturalWidth: 64, naturalHeight: 48, mask: "triangle" });
    const { spy } = paint([element]);
    expect(pathOf(spy.to("clip").at(-1)!)).toBe("M50 0L100 100L0 100Z");
  });

  it("draws an outline over the picture", async () => {
    const src = url("outline");
    await loadImage(src);
    const element = createImage({ src, width: 100, height: 100, naturalWidth: 64, naturalHeight: 48, stroke: { color: "#ff00ff", width: 5, style: "dashed" } });
    const { spy } = paint([element]);
    const stroke = spy.to("stroke")[0];
    expect(stroke.state.strokeStyle).toBe("#ff00ff");
    expect(stroke.state.lineDash).toEqual([15, 10]);
    expect(spy.names().indexOf("drawImage")).toBeLessThan(spy.names().indexOf("stroke"));
  });

  it("casts a shadow from the mask outline before the picture", async () => {
    const src = url("shadow");
    await loadImage(src);
    const shadow = { color: "#000000", blur: 4, x: 3, y: 3 };
    const element = createImage({ src, width: 100, height: 100, naturalWidth: 64, naturalHeight: 48, shadow });
    const { spy } = paint([element]);
    const cast = spy.to("fill")[0];
    expect(cast.state.shadowBlur).toBe(4);
    expect(cast.state.fillStyle).toBe("#000");
    expect(spy.names().indexOf("fill")).toBeLessThan(spy.names().indexOf("drawImage"));
  });

  it("draws a filtered picture from a cached off-screen copy", async () => {
    const src = url("filter");
    await loadImage(src);
    const element = createImage({
      src,
      width: 200,
      height: 100,
      naturalWidth: 64,
      naturalHeight: 48,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      filter: { ...defaultFilter(), warmth: 40 },
    });
    const first = paint([element]);
    const [copy, x, y, w, h] = first.spy.to("drawImage")[0].args as [HTMLCanvasElement, number, number, number, number];
    expect([x, y, w, h]).toEqual([0, 0, 200, 100]);
    expect([copy.width, copy.height]).toEqual([200, 100]);
    expect(contextOf(copy)!.callsTo("drawImage")[0].slice(1)).toEqual([0, 0, 200, 100]);
    const again = paint([element]);
    expect(again.spy.to("drawImage")[0].args[0]).toBe(copy);
  });

  it("keeps a failed picture as a skeleton and never loads it again", async () => {
    const src = url("broken");
    const element = createImage({ src, width: 100, height: 100, naturalWidth: 64, naturalHeight: 48 });
    paint([element]);
    await loadImage(src);
    const after = paint([element]);
    expect(after.complete).toBe(false);
    expect(after.spy.to("drawImage")).toHaveLength(0);
    expect(after.spy.to("fillRect").at(-1)!.state.fillStyle).toBe("#eceef3");
  });
});

describe("graphics", () => {
  /** the markup is the image cache key, so every test gets its own */
  const svgOf = (id: string) => `<svg viewBox="0 0 10 10" data-id="${id}"><rect width="10" height="10" fill="#ff0000"/></svg>`;

  it("draws the recoloured markup once it is loaded", async () => {
    const element = createGraphic({ svg: svgOf("recolour"), x: 5, y: 6, width: 80, height: 60, colors: { "#ff0000": "#00ff00" } });
    const first = paint([element]);
    expect(first.complete).toBe(false);
    expect(first.spy.to("drawImage")).toHaveLength(0);

    await loadSvgImage(graphicMarkup(element));
    const second = paint([element]);
    expect(second.complete).toBe(true);
    const draw = second.spy.to("drawImage")[0];
    expect(draw.args.slice(1)).toEqual([0, 0, 80, 60]);
    expect(origin(draw)).toEqual({ x: 5, y: 6 });
    expect(graphicMarkup(element)).toContain("#00ff00");
    expect(graphicMarkup(element)).not.toContain("#ff0000");
  });

  it("applies the stroke width of a line icon and remembers the markup per element", () => {
    const element = createGraphic({ svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#000000"><path d="M0 0L24 24"/></svg>', strokeWidth: 3 });
    const markup = graphicMarkup(element);
    expect(markup).toContain('stroke-width="3"');
    element.strokeWidth = 9;
    expect(graphicMarkup(element)).toBe(markup);
  });

  it("casts the shadow through the browser's own shadow settings", async () => {
    const element = createGraphic({ svg: svgOf("shadow"), shadow: { color: "#123456", blur: 5, x: 3, y: 4 } });
    await loadSvgImage(graphicMarkup(element));
    const { spy } = paint([element], { scale: 2 });
    const draw = spy.to("drawImage")[0];
    expect(draw.state.shadowColor).toBe("#123456");
    expect(draw.state.shadowBlur).toBe(10);
    expect([draw.state.shadowOffsetX, draw.state.shadowOffsetY]).toEqual([6, 8]);
  });

  it("treats a graphic that fails to load as not ready", async () => {
    const element = createGraphic({ svg: '<svg viewBox="0 0 10 10"><!-- broken --><rect width="10" height="10"/></svg>' });
    paint([element]);
    await loadSvgImage(graphicMarkup(element));
    const { complete } = paint([element]);
    expect(complete).toBe(false);
  });
});

describe("groups, tables and charts", () => {
  it("paints the children of a group in the group's own space with the group's opacity", () => {
    const child = createShape("rect", { x: 10, y: 10, width: 20, height: 20, opacity: 0.5 });
    const group = createGroup([child], { x: 100, y: 100, width: 100, height: 100, opacity: 0.5 });
    const { spy } = paint([group]);
    const fill = spy.to("fill")[0];
    expect(origin(fill)).toEqual({ x: 110, y: 110 });
    expect(fill.state.globalAlpha).toBeCloseTo(0.25);
  });

  it("turns the children with a rotated group", () => {
    const child = createShape("rect", { x: 0, y: 0, width: 10, height: 10 });
    const group = createGroup([child], { x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    const where = origin(paint([group]).spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(100);
    expect(where.y).toBeCloseTo(0);
  });

  it("skips hidden elements, including hidden children, and elements listed in `hide`", () => {
    const shown = createShape("rect", { id: "shown" });
    const hidden = createShape("rect", { id: "hidden", hidden: true });
    const masked = createShape("rect", { id: "masked" });
    const group = createGroup([createShape("rect", { id: "in-group", hidden: true })], { id: "group" });
    const { spy } = paint([shown, hidden, masked, group], { hide: new Set(["masked"]) });
    expect(spy.to("fill")).toHaveLength(1);
  });

  it("paints tables and charts through their own painters", () => {
    const table = createTable({ x: 0, y: 0, width: 600, height: 120 });
    const chart = createChart({ x: 0, y: 150, width: 300, height: 140 });
    const { spy } = paint([table, chart]);
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(expect.arrayContaining(["Heading 1", "Q1", "66"]));
  });

  it("does not touch the context filter on a canvas that has none", () => {
    const { spy } = paint([createShape("rect", { blur: 4 })]);
    // jsdom's canvas has no `filter` property: the element is still painted, just not blurred
    expect(spy.to("fill")).toHaveLength(1);
    expect(spy.to("fill")[0].state.filter).toBe("none");
  });
});

describe("a broken element", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is reported once and leaves the rest of the page painted", () => {
    const bad = createShape("rect", { id: "bad-shape-1", fill: solid("#ff0000") });
    const good = createShape("ellipse", { id: "good-shape-1", fill: solid("#00ff00") });
    const first = spyContext({ failOn: { fill: new Error("boom") } });
    expect(() => renderPage(first.ctx, DESIGN, createPage({ elements: [bad] }), { scale: 1 })).not.toThrow();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toContain("could not paint shape bad-shape-1");

    const second = spyContext({ failOn: { fill: new Error("boom") } });
    renderPage(second.ctx, DESIGN, createPage({ elements: [bad] }), { scale: 1 });
    expect(console.warn).toHaveBeenCalledTimes(1);

    const third = spyContext();
    renderPage(third.ctx, DESIGN, createPage({ elements: [bad, good] }), { scale: 1 });
    expect(third.to("fill")).toHaveLength(2);
    expect(third.names().filter((n) => n === "save")).toHaveLength(third.names().filter((n) => n === "restore").length);
  });
});

describe("animation", () => {
  const box = (animation: ElementAnimations, init: Parameters<typeof createShape>[1] = {}) => createShape("rect", { x: 50, y: 40, width: 100, height: 60, animation, ...init });
  const at = (time: number, elements: DesignElement[], page: Partial<Page> = {}) => paint(elements, { animation: { time } }, page);

  it("paints every element at rest when no animation is requested", () => {
    const { spy } = paint([box({ in: { kind: "fade", duration: 1, delay: 0 } })]);
    expect(spy.to("fill")[0].state.globalAlpha).toBe(1);
  });

  it("hides an element that has not appeared yet", () => {
    const { spy } = at(0, [box({ in: { kind: "fade", duration: 1, delay: 0 } })]);
    expect(spy.to("fill")).toHaveLength(0);
  });

  it("fades an element in, on top of its own opacity", () => {
    const { spy } = at(0.5, [box({ in: { kind: "fade", duration: 1, delay: 0 } }, { opacity: 0.8 })]);
    expect(spy.to("fill")[0].state.globalAlpha).toBeCloseTo(0.4);
  });

  it("paints an element at rest once its entrance is over", () => {
    const { spy } = at(2, [box({ in: { kind: "fade", duration: 1, delay: 0 } })]);
    expect(spy.to("fill")[0].state.globalAlpha).toBe(1);
  });

  it("fades an element out at the end of the page and hides it when the page is over", () => {
    const out: ElementAnimations = { out: { kind: "fade", duration: 1, delay: 0 } };
    expect(at(3.5, [box(out)], { duration: 4 }).spy.to("fill")[0].state.globalAlpha).toBeCloseTo(0.5);
    expect(at(4, [box(out)], { duration: 4 }).spy.to("fill")).toHaveLength(0);
  });

  it("slides a rising element by a fraction of the shorter side of the design", () => {
    const animation: ElementAnimations = { in: { kind: "rise", duration: 1, delay: 0, direction: "up" } };
    const state = evaluateAnimation(animation, 0.5, 5)!;
    const { spy } = at(0.5, [box(animation)]);
    const where = origin(spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(50 + state.dx * 300);
    expect(where.y).toBeCloseTo(40 + state.dy * 300);
    expect(state.dy).toBeGreaterThan(0);
  });

  it("scales a popping element about its centre", () => {
    const animation: ElementAnimations = { in: { kind: "pop", duration: 1, delay: 0 } };
    const state = evaluateAnimation(animation, 0.5, 5)!;
    const { spy } = at(0.5, [box(animation)]);
    expect(spy.to("scale")[0].args).toEqual([state.scale, state.scale]);
    const where = origin(spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(100 - 50 * state.scale);
    expect(where.y).toBeCloseTo(70 - 30 * state.scale);
  });

  it("turns a tumbling element about its centre", () => {
    const animation: ElementAnimations = { in: { kind: "tumble", duration: 1, delay: 0 } };
    const state = evaluateAnimation(animation, 0.5, 5)!;
    const { spy } = at(0.5, [box(animation)]);
    expect(spy.to("rotate")[0].args[0]).toBeCloseTo(deg(state.rotate));
  });

  it("spins an element for as long as the page plays", () => {
    const animation: ElementAnimations = { loop: { kind: "spin", duration: 4, delay: 0 } };
    const { spy } = at(1, [box(animation)]);
    expect(spy.to("rotate")[0].args[0]).toBeCloseTo(deg(90));
  });

  it("reveals an element through a wipe window", () => {
    const animation: ElementAnimations = { in: { kind: "wipe", duration: 1, delay: 0, direction: "right" } };
    const state = evaluateAnimation(animation, 0.5, 5)!;
    const { spy } = at(0.5, [box(animation)]);
    const [x, y, w, h] = spy.to("rect")[1].args as number[];
    const clip = state.clip!;
    expect([x, y, w, h]).toEqual([(clip.x0 - 0.5) * 100, (clip.y0 - 0.5) * 60, (clip.x1 - clip.x0) * 100, (clip.y1 - clip.y0) * 60]);
    expect(spy.to("clip")).toHaveLength(2);
  });

  it("moves the content inside the window of a slide reveal", () => {
    const animation: ElementAnimations = { in: { kind: "slide", duration: 1, delay: 0, direction: "up" } };
    const state = evaluateAnimation(animation, 0.5, 5)!;
    const { spy } = at(0.5, [box(animation)]);
    const where = origin(spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(50 + state.innerDx * 100);
    expect(where.y).toBeCloseTo(40 + state.innerDy * 60);
  });

  it("moves the content of a rotated element along its own rotated axes", () => {
    const animation: ElementAnimations = { in: { kind: "slide", duration: 1, delay: 0, direction: "left" } };
    const state = evaluateAnimation(animation, 0.5, 5)!;
    expect(state.innerDx).toBeGreaterThan(0);
    const { spy } = at(0.5, [box(animation, { rotation: 90 })]);
    // the box is centred on (100, 70); turned a quarter turn, its top-left corner lands at (130, 20),
    // and the slide offset (given along the element's own x axis) is turned with it
    const own = { x: state.innerDx * 100, y: state.innerDy * 60 };
    const where = origin(spy.to("fill")[0]);
    expect(where.x).toBeCloseTo(130 - own.y);
    expect(where.y).toBeCloseTo(20 + own.x);
  });

  it("types text out line by line", () => {
    const text = createText({ text: "Hello world", fontSize: 40, x: 20, y: 20, width: 300, autoWidth: false, animation: { in: { kind: "typewriter", duration: 1, delay: 0 } } });
    const layout = layoutText(text);
    const line = layout.lines[0];
    const { spy } = at(0.5, [text]);
    const [x, y, w, h] = spy.to("rect")[1].args as number[];
    const pad = line.size * 0.25;
    const shown = line.width * 0.5;
    expect(x).toBeCloseTo(line.x - pad * 2 - text.width / 2);
    expect(y).toBeCloseTo(line.y - pad - text.height / 2);
    expect(w).toBeCloseTo(shown + pad * 2);
    expect(h).toBeCloseTo(line.height + pad * 2);
  });

  it("shows finished lines whole while the next one is being typed", () => {
    const text = createText({ text: "one\ntwo", fontSize: 40, x: 0, y: 0, width: 300, autoWidth: false, animation: { in: { kind: "typewriter", duration: 1, delay: 0 } } });
    const layout = layoutText(text);
    const { spy } = at(0.75, [text]);
    const windows = spy
      .to("rect")
      .slice(1)
      .map((c) => c.args as number[]);
    expect(windows).toHaveLength(2);
    const first = layout.lines[0];
    const pad = first.size * 0.25;
    expect(windows[0][2]).toBeCloseTo(first.width + pad * 4);
    expect(windows[1][2]).toBeLessThan(layout.lines[1].width + pad * 4);
  });

  it("wipes a non-text element from the left while it types in", () => {
    const animation: ElementAnimations = { in: { kind: "typewriter", duration: 1, delay: 0 } };
    const { spy } = at(0.5, [box(animation)]);
    const [x, y, w, h] = spy.to("rect")[1].args as number[];
    expect([x, y, w, h]).toEqual([-100, -60, 50 + 0.5 * 100, 120]);
  });

  it("applies a wipe window and a typed reveal together", () => {
    const animation: ElementAnimations = { in: { kind: "wipe", duration: 5, delay: 0, direction: "right" }, out: { kind: "typewriter", duration: 5, delay: 0 } };
    const { spy } = at(2.5, [box(animation)]);
    const windows = spy.to("rect").slice(1);
    expect(windows).toHaveLength(2);
    expect(windows[1].args).toEqual([-100, -60, 50 + 0.5 * 100, 120]);
    expect(spy.to("clip")).toHaveLength(2);
  });

  it("paints elements without an animation at rest next to animated ones", () => {
    const still = createShape("ellipse", { x: 0, y: 0, width: 50, height: 50, fill: solid("#abcdef") });
    const moving = box({ in: { kind: "fade", duration: 1, delay: 0 } });
    const { spy } = at(0.5, [still, moving]);
    const fills = spy.to("fill");
    expect(fills[0].state.globalAlpha).toBe(1);
    expect(fills[1].state.globalAlpha).toBeCloseTo(0.5);
  });

  it("skips hidden elements and elements in `hide` even when they are animated", () => {
    const shown = box({ in: { kind: "fade", duration: 1, delay: 0 } }, { id: "anim-shown" });
    const hidden = box({ in: { kind: "fade", duration: 1, delay: 0 } }, { id: "anim-hidden", hidden: true });
    const masked = box({ in: { kind: "fade", duration: 1, delay: 0 } }, { id: "anim-masked" });
    const { spy } = paint([shown, hidden, masked], { animation: { time: 0.5 }, hide: new Set(["anim-masked"]) });
    expect(spy.to("fill")).toHaveLength(1);
  });
});

describe("resources and preparation", () => {
  const photo = (src: string | null, init: Partial<Parameters<typeof createImage>[0]> = {}) =>
    createImage({ width: 100, height: 100, naturalWidth: 64, naturalHeight: 48, ...init, src });

  it("lists the images, graphics and fonts a page needs, ignoring hidden and empty elements", () => {
    const graphic = createGraphic({ svg: '<svg viewBox="0 0 10 10"><circle r="5" fill="#123456"/></svg>' });
    const page = createPage({
      background: { type: "image", src: "blob:test/bg-res.png", fit: "cover" },
      elements: [
        photo("blob:test/a-res.png"),
        photo(null),
        photo("blob:test/hidden-res.png", { hidden: true }),
        graphic,
        createGroup([photo("blob:test/nested-res.png"), createText({ text: "in group", fontFamily: "Lora" })]),
        createText({ paragraphs: [{ runs: [{ text: "plain" }, { text: "bold", bold: true, font: "Anton" }] }, { runs: [] }], fontFamily: "Inter" }),
        createTable({ fontFamily: "Poppins" }),
        createChart({ fontFamily: "Roboto" }),
        createShape("rect"),
      ],
    });
    const resources = collectResources(page);
    expect([...resources.images].sort()).toEqual(["blob:test/a-res.png", "blob:test/bg-res.png", "blob:test/nested-res.png"]);
    expect([...resources.svgs]).toEqual([graphicMarkup(graphic)]);
    expect([...resources.fonts.keys()].sort()).toEqual([
      "Anton|700|false",
      "Inter|400|false",
      "Lora|400|false",
      "Poppins|400|false",
      "Poppins|700|false",
      "Roboto|400|false",
      "Roboto|700|false",
    ]);
  });

  it("waits until every image and graphic of the page is loaded", async () => {
    const src = url("prepare");
    const graphic = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="#010203"/></svg>' });
    const page = createPage({ elements: [photo(src), graphic] });
    await preparePage(page);
    const { complete } = paint(page.elements);
    expect(complete).toBe(true);
  });

  it("renders a page to a canvas at the requested width", async () => {
    const src = url("canvas");
    const page = createPage({ background: solid("#445566"), elements: [photo(src, { x: 10, y: 10 })] });
    const canvas = await renderPageToCanvas(DESIGN, page, { width: 200 });
    expect([canvas.width, canvas.height]).toEqual([200, 150]);
    const ctx = contextOf(canvas)!;
    expect(ctx.callsTo("drawImage")).toHaveLength(1);
    expect(ctx.callsTo("setTransform")[1].slice(0, 4)).toEqual([0.5, 0, 0, 0.5]);
    expect(ctx.callsTo("clearRect")).toHaveLength(1);
  });

  it("leaves the background out of a transparent canvas", async () => {
    const canvas = await renderPageToCanvas(DESIGN, createPage({ background: solid("#445566") }), { width: 100, transparent: true });
    expect(contextOf(canvas)!.callsTo("fillRect")).toHaveLength(0);
  });

  it("paints the page part-way through its animations when a time is given", async () => {
    const page = createPage({ elements: [createShape("rect", { animation: { in: { kind: "fade", duration: 1, delay: 0 } } })] });
    const hidden = await renderPageToCanvas(DESIGN, page, { width: 400, time: 0 });
    expect(contextOf(hidden)!.callsTo("fill")).toHaveLength(0);
    const shown = await renderPageToCanvas(DESIGN, page, { width: 400, time: 2 });
    expect(contextOf(shown)!.callsTo("fill")).toHaveLength(1);
  });

  it("gives up after three attempts when a picture can never load", async () => {
    const page = createPage({ elements: [photo(url("broken"))] });
    const canvas = await renderPageToCanvas(DESIGN, page, { width: 400 });
    expect(contextOf(canvas)!.callsTo("clearRect")).toHaveLength(3);
  });

  it("makes a canvas at least one pixel wide in each direction", async () => {
    const canvas = await renderPageToCanvas({ width: 1000, height: 2 }, createPage(), { width: 10 });
    expect([canvas.width, canvas.height]).toEqual([10, 1]);
  });
});

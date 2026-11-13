/**
 * Painting while something is dragged: the elements that stay where they are are painted once, on a layer under and a layer
 * over the ones that move, and every further frame lays the layers down and paints only what moves between them. The rules
 * that matter are when a layer may NOT be used again (anything it shows has changed) and when there are no layers at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createImage, createPage, createShape, solid } from "@/core/factory";
import type { DesignElement, Page } from "@/core/types";
import { captureContexts, type SpyContext } from "@/test/logicPaint";
import { createDragPainter, MIN_STEADY, type DragPainter } from "./dragLayers";
import { releaseLayers, renderPage, type RenderOptions } from "./renderPage";

const DESIGN = { width: 400, height: 300 };
const OPTS: RenderOptions = { scale: 1 };

/** `count` squares, each with a colour of its own (#000000, #000001 ...) so that a fill says which element it was. */
const squares = (count: number, init: (i: number) => Partial<DesignElement> = () => ({})) =>
  Array.from({ length: count }, (_, i) =>
    createShape("rect", { id: `s${i}`, x: i * 10, y: 20, width: 30, height: 30, fill: solid(`#${i.toString(16).padStart(6, "0")}`), ...(init(i) as object) }),
  );
/** The page after a change of some elements, as the store makes it: a changed element is a new object, every other one is the same object. */
const change = (page: Page, ids: string[], patch: (el: DesignElement) => Partial<DesignElement> = (el) => ({ x: el.x + 5 })): Page => ({
  ...page,
  elements: page.elements.map((el) => (ids.includes(el.id) ? ({ ...el, ...patch(el) } as DesignElement) : el)),
});
/** which squares a context filled, by number */
const filled = (spy: SpyContext) => spy.to("fill").map((c) => parseInt(String(c.state.fillStyle).slice(1), 16));

interface Rig {
  painter: DragPainter;
  /** the page canvas */
  main: SpyContext;
  /** every other canvas that was painted on, in the order they were made: the layer under, then the layer over */
  layers(): SpyContext[];
  paint(page: Page, opts?: Partial<RenderOptions>, gesture?: boolean, design?: { width: number; height: number }): boolean;
  /** forget what was painted so far */
  clear(): void;
}

function rig(width = 400, height = 300): Rig {
  const made = captureContexts();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const painter = createDragPainter();
  return {
    painter,
    main: made[0],
    layers: () => made.slice(1),
    paint: (page, opts = {}, gesture = true, design = DESIGN) => painter.paint(ctx, design, page, { ...OPTS, ...opts }, gesture),
    clear: () => made.forEach((spy) => spy.clear()),
  };
}

/** A page of twenty squares that was painted at rest, and then twice with square 10 moved: the layers exist. */
function dragging(elements: DesignElement[] = squares(20), moved = ["s10"]) {
  const r = rig();
  let page = createPage({ elements });
  r.paint(page, {}, false);
  page = change(page, moved);
  r.paint(page);
  r.clear();
  return { ...r, page };
}

beforeEach(() => releaseLayers());
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a part of the page", () => {
  it("paints only the elements of the part, over what is there, without the background", () => {
    const made = captureContexts();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const complete = renderPage(ctx, DESIGN, createPage({ elements: squares(6), background: solid("#abcdef") }), {
      scale: 1,
      part: { from: 2, to: 4, background: false, keep: true },
    });
    expect(complete).toBe(true);
    expect(filled(made[0])).toEqual([2, 3]);
    expect(made[0].to("clearRect")).toHaveLength(0);
    expect(made[0].to("fillRect")).toHaveLength(0);
    // in the same place and inside the same clip as the whole page is painted
    expect(made[0].to("setTransform")[1].args.map((v) => (v as number) + 0)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(made[0].to("clip")).toHaveLength(1);
  });

  it("clears first and paints the background when the part says so", () => {
    const made = captureContexts();
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    renderPage(ctx, DESIGN, createPage({ elements: squares(6), background: solid("#abcdef") }), { scale: 1, part: { from: 0, to: 2, background: true } });
    expect(filled(made[0])).toEqual([0, 1]);
    expect(made[0].to("clearRect")).toHaveLength(1);
    expect(made[0].to("fillRect")[0].state.fillStyle).toBe("#abcdef");
  });
});

describe("outside a gesture", () => {
  it("paints the page exactly as renderPage does, on the page canvas alone", () => {
    const plain = captureContexts();
    const page = createPage({ elements: squares(20) });
    const canvas = Object.assign(document.createElement("canvas"), { width: 400, height: 300 });
    renderPage(canvas.getContext("2d") as CanvasRenderingContext2D, DESIGN, page, OPTS);
    const expected = plain[0].calls.map((c) => [c.name, c.args, c.state]);
    vi.restoreAllMocks();

    const r = rig();
    expect(r.paint(page, {}, false)).toBe(true);
    expect(r.paint(change(page, ["s10"]), {}, false)).toBe(true);
    expect(r.layers()).toHaveLength(0);
    expect(r.painter.layered).toBe(false);
    r.clear();
    r.paint(page, {}, false);
    expect(r.main.calls.map((c) => [c.name, c.args, c.state])).toEqual(expected);
  });
});

describe("the first frame of a gesture in which elements changed", () => {
  it("paints the elements under the changed one on one layer with the background, those over it on another, and the changed one between them", () => {
    const r = rig();
    let page = createPage({ elements: squares(20), background: solid("#abcdef") });
    r.paint(page, {}, false);
    r.clear();
    page = change(page, ["s10"]);
    expect(r.paint(page)).toBe(true);
    const [under, over] = r.layers();
    expect(r.painter.layered).toBe(true);
    expect([under.canvas.width, under.canvas.height, over.canvas.width, over.canvas.height]).toEqual([400, 300, 400, 300]);
    expect(filled(under)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(under.to("fillRect")[0].state.fillStyle).toBe("#abcdef");
    expect(filled(over)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19]);
    // the layer over the moving element is see-through where nothing is: no background on it
    expect(over.to("fillRect")).toHaveLength(0);
    expect(over.to("clearRect")).toHaveLength(1);
    // the page: emptied, the layer under, the element, the layer over, pixel for pixel
    expect(filled(r.main)).toEqual([10]);
    expect(r.main.to("fillRect")).toHaveLength(0);
    const order = r.main.calls.filter((c) => ["clearRect", "drawImage", "fill"].includes(c.name));
    expect(order.map((c) => c.name)).toEqual(["clearRect", "drawImage", "fill", "drawImage"]);
    expect(order[0].args).toEqual([0, 0, 400, 300]);
    expect(order[1].args).toEqual([under.canvas, 0, 0]);
    expect(order[3].args).toEqual([over.canvas, 0, 0]);
    for (const laid of [order[1], order[3]]) {
      expect(laid.state.matrix).toEqual([1, 0, 0, 1, 0, 0]);
      expect(laid.state.globalAlpha).toBe(1);
      expect(laid.state.globalCompositeOperation).toBe("source-over");
    }
  });

  it("paints the changed element where it is now", () => {
    const { main, paint, page } = dragging();
    paint(change(page, ["s10"], () => ({ x: 222, y: 111 })));
    const at = main.to("fill")[0].state.matrix;
    expect([at[4], at[5]]).toEqual([222, 111]);
  });
});

describe("the frames after it", () => {
  it("paint only what moves: the layers are laid down as they are", () => {
    const { main, layers, paint, page } = dragging();
    expect(paint(change(page, ["s10"]))).toBe(true);
    const [under, over] = layers();
    expect(under.calls).toHaveLength(0);
    expect(over.calls).toHaveLength(0);
    expect(filled(main)).toEqual([10]);
    expect(main.to("drawImage").map((c) => c.args[0])).toEqual([under.canvas, over.canvas]);
  });

  it("paint everything from the lowest to the highest element that changes, with what lies between them", () => {
    const { main, layers, paint, page } = dragging(squares(20), ["s2", "s8"]);
    paint(change(page, ["s2", "s8"]));
    expect(layers()[0].calls).toHaveLength(0);
    expect(filled(main)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("paint a frame in which only some of the moving elements changed from the same layers", () => {
    const { main, layers, paint, page } = dragging(squares(20), ["s2", "s8"]);
    paint(change(page, ["s8"]));
    expect(layers()[0].calls).toHaveLength(0);
    expect(layers()[1].calls).toHaveLength(0);
    expect(filled(main)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("take an element in that begins to change later in the gesture: the layers are painted again without it", () => {
    const { main, layers, paint, page } = dragging();
    const next = change(page, ["s10", "s15"]);
    paint(next);
    expect(filled(layers()[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(filled(layers()[1])).toEqual([16, 17, 18, 19]);
    expect(filled(main)).toEqual([10, 11, 12, 13, 14, 15]);
    // and it stays in for the rest of the gesture, also in a frame in which it did not change
    layers().forEach((l) => l.clear());
    main.clear();
    paint(change(next, ["s10"]));
    expect(layers()[0].calls).toHaveLength(0);
    expect(layers()[1].calls).toHaveLength(0);
    expect(filled(main)).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("need no layer over the moving element when it is on top", () => {
    const { main, layers, paint, page } = dragging(squares(20), ["s19"]);
    paint(change(page, ["s19"]));
    expect(layers()).toHaveLength(1);
    expect(filled(main)).toEqual([19]);
    expect(main.to("drawImage")).toHaveLength(1);
  });
});

describe("a layer is painted again when what it shows has changed", () => {
  /** paints one more frame of the drag after `alter`, and says what was filled on the layer under, the layer over and the page */
  const after = (alter: (page: Page) => { page?: Page; opts?: Partial<RenderOptions>; design?: { width: number; height: number } }, elements: DesignElement[] = squares(20)) => {
    const r = dragging(elements);
    const altered = alter(r.page);
    r.paint(altered.page ?? r.page, altered.opts ?? {}, true, altered.design);
    return { under: filled(r.layers()[0]), over: filled(r.layers()[1]), main: filled(r.main), r };
  };
  const UNDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const OVER = [11, 12, 13, 14, 15, 16, 17, 18, 19];

  it.each<[string, (el: DesignElement) => Partial<DesignElement>]>([
    ["outline", () => ({ stroke: { color: "#00ff00", width: 2, style: "solid" } }) as Partial<DesignElement>],
    ["place", (el) => ({ x: el.x + 1 })],
    ["size", (el) => ({ width: el.width + 1 })],
    ["turn", () => ({ rotation: 10 })],
    ["opacity", () => ({ opacity: 0.5 })],
    ["blur", () => ({ blur: 3 })],
    ["being hidden", () => ({ hidden: true })],
    // even a change that paints nothing new (a name) makes a new element, and a layer never guesses what a change means
    ["name", () => ({ name: "Renamed" })],
  ])("an element that does not move changes its %s", (_what, patch) => {
    // the element is painted as it is now, with the moving one and what lies between them, and the layers hold the rest
    const hidden = !!patch({ x: 0, width: 0 } as DesignElement).hidden;
    const under = after((page) => ({ page: change(page, ["s3"], patch) }));
    expect(under.under).toEqual([0, 1, 2]);
    expect(under.over).toEqual(OVER);
    expect(under.main).toEqual(hidden ? [4, 5, 6, 7, 8, 9, 10] : [3, 4, 5, 6, 7, 8, 9, 10]);
    const over = after((page) => ({ page: change(page, ["s17"], patch) }));
    expect(over.under).toEqual(UNDER);
    expect(over.over).toEqual([18, 19]);
    expect(over.main).toEqual(hidden ? [10, 11, 12, 13, 14, 15, 16] : [10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("an element that does not move changes its colour or its shadow: it is painted with the new one", () => {
    const colour = after((page) => ({ page: change(page, ["s3"], () => ({ fill: solid("#00ff00") }) as Partial<DesignElement>) }));
    expect(colour.under).toEqual([0, 1, 2]);
    expect(colour.main).toEqual([0x00ff00, 4, 5, 6, 7, 8, 9, 10]);
    const r = dragging();
    r.paint(change(r.page, ["s17"], () => ({ shadow: { color: "#112233", blur: 4, x: 1, y: 1 } })));
    expect(filled(r.layers()[1])).toEqual([18, 19]);
    expect(r.main.to("fill").map((c) => c.state.shadowColor)).toContain("#112233");
  });

  it("an element inside a group that does not move changes", () => {
    const inner = createShape("rect", { id: "inner", x: 0, y: 0, width: 10, height: 10, fill: solid("#0000aa") });
    const elements: DesignElement[] = squares(20);
    elements[3] = createGroup([inner], { id: "s3" });
    const result = after((page) => ({ page: change(page, ["s3"], () => ({ children: [{ ...inner, fill: solid("#0000bb") }] }) as Partial<DesignElement>) }), elements);
    expect(result.main).toContain(0xbb);
  });

  it.each<[string, Partial<RenderOptions>]>([
    ["the zoom", { scale: 2 }],
    ["the place the page is scrolled to", { clip: { x: 10, y: 0, w: 400, h: 300 } }],
    ["the place the page is scrolled to, down", { clip: { x: 0, y: 10, w: 400, h: 300 } }],
    ["what is left out", { hide: new Set(["s2"]) }],
    ["a see-through page", { transparent: true }],
    ["the bleed", { bleed: 5 }],
  ])("%s changes", (_what, opts) => {
    const { under, over, main } = after(() => ({ opts }));
    expect(under).toEqual(opts.hide ? UNDER.filter((i) => i !== 2) : UNDER);
    expect(over).toEqual(OVER);
    expect(main).toEqual([10]);
  });

  it("keeps the layers when the same elements are left out again, in another set", () => {
    const r = dragging();
    r.paint(r.page, { hide: new Set(["s2", "s3"]) });
    r.clear();
    r.paint(change(r.page, ["s10"]), { hide: new Set(["s3", "s2"]) });
    expect(r.layers()[0].calls).toHaveLength(0);
  });

  it("the background of the page changes", () => {
    const { under, over } = after((page) => ({ page: { ...page, background: solid("#123456") } }));
    expect(under).toEqual(UNDER);
    expect(over).toEqual(OVER);
  });

  it("the size of the design changes", () => {
    const { under } = after(() => ({ design: { width: 500, height: 300 } }));
    expect(under).toEqual(UNDER);
    expect(after(() => ({ design: { width: 400, height: 200 } })).under).toEqual(UNDER);
  });

  it("the canvas changes its size, and the layers with it", () => {
    const r = dragging();
    r.main.canvas.width = 800;
    r.paint(change(r.page, ["s10"]));
    expect(filled(r.layers()[0])).toEqual(UNDER);
    expect(r.layers().map((l) => l.canvas.width)).toEqual([800, 800]);
    r.clear();
    r.main.canvas.height = 600;
    r.paint(change(r.page, ["s10"]));
    expect(filled(r.layers()[0])).toEqual(UNDER);
    expect(r.layers().map((l) => l.canvas.height)).toEqual([600, 600]);
  });

  it("a font or a picture has arrived since (the painter is told)", () => {
    const r = dragging();
    r.painter.invalidate();
    r.paint(r.page);
    expect(filled(r.layers()[0])).toEqual(UNDER);
    expect(filled(r.layers()[1])).toEqual(OVER);
    expect(filled(r.main)).toEqual([10]);
  });
});

describe("no layers", () => {
  const all = Array.from({ length: 20 }, (_, i) => i);

  it("when nothing has changed since the gesture began", () => {
    const r = rig();
    const page = createPage({ elements: squares(20) });
    r.paint(page, {}, false);
    r.clear();
    r.paint(page);
    expect(r.layers()).toHaveLength(0);
    expect(filled(r.main)).toEqual(all);
    expect(r.painter.layered).toBe(false);
  });

  it("when the page was not painted before: nothing says what moves", () => {
    const r = rig();
    r.paint(createPage({ elements: squares(20) }));
    expect(r.layers()).toHaveLength(0);
    expect(filled(r.main)).toEqual(all);
  });

  it("when an animation is played", () => {
    const { main, layers, paint, page } = dragging();
    paint(change(page, ["s10"]), { animation: { time: 0.5 } });
    expect(filled(main)).toEqual(all);
    expect(layers().every((l) => l.calls.length === 0)).toBe(true);
  });

  it(`when fewer than ${MIN_STEADY} elements stay where they are: painting them is cheaper than keeping layers`, () => {
    const r = rig();
    let page = createPage({ elements: squares(MIN_STEADY) });
    r.paint(page, {}, false);
    page = change(page, ["s5"]);
    r.clear();
    r.paint(page);
    expect(r.layers()).toHaveLength(0);
    expect(filled(r.main)).toHaveLength(MIN_STEADY);
    // one more and there are layers
    const more = rig();
    let larger = createPage({ elements: squares(MIN_STEADY + 1) });
    more.paint(larger, {}, false);
    larger = change(larger, ["s5"]);
    more.paint(larger);
    expect(more.painter.layered).toBe(true);
  });

  it.each<[string, (page: Page) => Page]>([
    ["an element is added", (page) => ({ ...page, elements: [...page.elements, ...squares(1, () => ({ id: "new" }))] })],
    ["an element is taken away", (page) => ({ ...page, elements: page.elements.slice(1) })],
    ["the elements change their order", (page) => ({ ...page, elements: [page.elements[1], page.elements[0], ...page.elements.slice(2)] })],
    ["another page is shown", (page) => ({ ...page, id: "another" })],
  ])("in the frame in which %s", (_what, alter) => {
    const { main, layers, paint, page, painter } = dragging();
    const next = alter(page);
    paint(next);
    expect(filled(main)).toHaveLength(next.elements.length);
    expect(layers().every((l) => l.calls.length === 0)).toBe(true);
    expect(painter.layered).toBe(false);
  });

  it("when a picture is not there yet: a layer must not keep the grey box that stands in for it", () => {
    const r = rig();
    const elements: DesignElement[] = [
      ...squares(19),
      createImage({ id: "pic", src: "blob:test/not-loaded-yet.png", x: 0, y: 0, width: 50, height: 50, naturalWidth: 50, naturalHeight: 50 }),
    ];
    let page = createPage({ elements });
    r.paint(page, {}, false);
    page = change(page, ["s5"]);
    r.clear();
    expect(r.paint(page)).toBe(false);
    expect(filled(r.main)).toHaveLength(19);
    expect(r.painter.layered).toBe(false);
    // and the next frame tries again
    r.clear();
    expect(r.paint(change(page, ["s5"]))).toBe(false);
    expect(filled(r.main)).toHaveLength(19);
  });

  it("when a canvas for a layer cannot be had", () => {
    const made = captureContexts();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const painter = createDragPainter(() => Object.assign(document.createElement("canvas"), { getContext: () => null }));
    let page = createPage({ elements: squares(20) });
    painter.paint(ctx, DESIGN, page, OPTS, false);
    page = change(page, ["s10"]);
    made[0].clear();
    expect(painter.paint(ctx, DESIGN, page, OPTS, true)).toBe(true);
    expect(filled(made[0])).toEqual(all);
    expect(painter.layered).toBe(false);
  });

  it("when a canvas for the layer over cannot be had", () => {
    const made = captureContexts();
    const ctx = Object.assign(document.createElement("canvas"), { width: 400, height: 300 }).getContext("2d") as CanvasRenderingContext2D;
    let n = 0;
    const painter = createDragPainter(() => (n++ ? Object.assign(document.createElement("canvas"), { getContext: () => null }) : document.createElement("canvas")));
    let page = createPage({ elements: squares(20) });
    painter.paint(ctx, DESIGN, page, OPTS, false);
    page = change(page, ["s10"]);
    made[0].clear();
    painter.paint(ctx, DESIGN, page, OPTS, true);
    expect(filled(made[0])).toEqual(all);
    expect(painter.layered).toBe(false);
  });

  it("when a picture under the moving element is not there yet", () => {
    const r = rig();
    const elements: DesignElement[] = [
      createImage({ id: "pic", src: "blob:test/not-loaded-either.png", x: 0, y: 0, width: 50, height: 50, naturalWidth: 50, naturalHeight: 50 }),
      ...squares(19),
    ];
    let page = createPage({ elements });
    r.paint(page, {}, false);
    page = change(page, ["s15"]);
    r.clear();
    expect(r.paint(page)).toBe(false);
    expect(filled(r.main)).toHaveLength(19);
    expect(r.painter.layered).toBe(false);
  });

  it("when the page canvas has no size", () => {
    const r = rig(0, 0);
    let page = createPage({ elements: squares(20) });
    r.paint(page, {}, false);
    page = change(page, ["s10"]);
    r.clear();
    r.paint(page);
    expect(r.layers()).toHaveLength(0);
    expect(filled(r.main)).toEqual(all);
  });
});

describe("blend modes", () => {
  it("under the moving element are part of the layer under it: what they mix with does not move", () => {
    const { main, layers, paint, page } = dragging(squares(20, (i) => (i === 3 ? { blend: "multiply" } : {})));
    paint(change(page, ["s10"]));
    expect(filled(main)).toEqual([10]);
    expect(layers()[0].calls).toHaveLength(0);
  });

  it("of the moving element itself are mixed with the page as it is under it", () => {
    const { main, paint, page } = dragging(squares(20, (i) => (i === 10 ? { blend: "multiply" } : {})));
    paint(change(page, ["s10"]));
    const laid = main.to("drawImage");
    // the layer under, the element (on a layer of its own, laid over as multiply), the layer over
    expect(laid.map((c) => c.state.globalCompositeOperation)).toEqual(["source-over", "multiply", "source-over"]);
    expect(filled(main)).toEqual([]);
  });

  it.each([
    ["an element over the moving one", (i: number) => (i === 17 ? { blend: "screen" } : {})],
    ["the top element", (i: number) => (i === 19 ? { blend: "screen" } : {})],
  ])("of %s mix with the moving one, so nothing over it is kept on a layer", (_what, init) => {
    const { main, layers, paint, page } = dragging(squares(20, init as (i: number) => Partial<DesignElement>), ["s14"]);
    paint(change(page, ["s14"]));
    // each frame lays down the layer under and the blended element (from a layer of its own), and no layer over
    const laid = main.to("drawImage");
    expect(laid.map((c) => c.state.globalCompositeOperation)).toEqual(["source-over", "screen"]);
    const under = layers().find((l) => l.canvas === laid[0].args[0]) as SpyContext;
    expect(under.calls).toHaveLength(0);
    const live = [
      ...filled(main),
      ...layers()
        .filter((l) => l !== under)
        .flatMap(filled),
    ];
    expect(live.sort((a, b) => a - b)).toEqual([14, 15, 16, 17, 18, 19]);
  });

  it("given to an element over the moving one during the gesture: it is mixed with the moving one from then on", () => {
    const { main, layers, paint, page } = dragging();
    paint(change(page, ["s17"], () => ({ blend: "multiply" })));
    expect(main.to("drawImage").map((c) => c.state.globalCompositeOperation)).toEqual(["source-over", "multiply", "source-over"]);
    expect(filled(main)).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(filled(layers()[1])).toEqual([18, 19]);
  });

  it("inside a group over the moving element count too", () => {
    const elements: DesignElement[] = squares(20);
    elements[15] = createGroup([createGroup([createShape("rect", { id: "deep", width: 5, height: 5, fill: solid("#0000cc"), blend: "overlay" })], { id: "g2" })], { id: "s15" });
    const { main, paint, page } = dragging(elements, ["s13"]);
    paint(change(page, ["s13"]));
    expect(filled(main)).toEqual([13, 14, 16, 17, 18, 19]);
    expect(main.to("drawImage").map((c) => c.state.globalCompositeOperation)).toEqual(["source-over", "overlay"]);
  });

  it("over the moving element leave no layers at all when too little is under it", () => {
    const r = rig();
    let page = createPage({ elements: squares(20, (i) => (i === 19 ? { blend: "screen" } : {})) });
    r.paint(page, {}, false);
    page = change(page, ["s2"]);
    r.paint(page);
    expect(r.painter.layered).toBe(false);
  });
});

describe("the end of the gesture", () => {
  it("paints the whole page again, straight onto the canvas, and lets the layers go", () => {
    const { main, layers, paint, page, painter } = dragging();
    expect(painter.layered).toBe(true);
    paint(page, {}, false);
    expect(filled(main)).toHaveLength(20);
    expect(main.to("drawImage")).toHaveLength(0);
    expect(painter.layered).toBe(false);
    expect(layers().map((l) => [l.canvas.width, l.canvas.height])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("begins the next gesture from nothing: what moved in the last one is not taken for moving", () => {
    const { main, layers, paint, page } = dragging();
    paint(page, {}, false);
    const next = change(page, ["s2"]);
    main.clear();
    paint(next);
    expect(filled(main)).toEqual([2]);
    expect(filled(layers()[layers().length - 1])).toHaveLength(17);
  });

  it("release lets the layers go at once", () => {
    const { layers, painter } = dragging();
    painter.release();
    expect(layers().map((l) => l.canvas.width)).toEqual([0, 0]);
    expect(painter.layered).toBe(false);
  });
});

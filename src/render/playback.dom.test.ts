import { describe, expect, it } from "vitest";
import { createImage, createPage, createShape, solid } from "@/core/factory";
import { buildTimeline, type Timeline } from "@/core/transition";
import type { Page } from "@/core/types";
import { captureContexts, spyContext, toDevice } from "@/test/logicPaint";
import { PlaybackRenderer, drawTransition } from "./playback";

const W = 400;
const H = 300;

function canvas(width = W, height = H): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

describe("drawTransition", () => {
  function run(kind: string, p: number, direction?: Parameters<typeof drawTransition>[5]) {
    const spy = spyContext({ width: W, height: H });
    const from = canvas();
    const to = canvas();
    drawTransition(spy.ctx, from, to, kind, p, direction);
    const draws = spy.to("drawImage");
    return { spy, from, to, draws, at: (i: number) => toDevice(draws[i].state.matrix, 0, 0) };
  }

  it("starts from a black screen and paints the old page over it", () => {
    const { spy, from, draws } = run("dissolve", 0);
    expect(spy.to("setTransform")[0].args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(spy.to("fillRect")[0].args).toEqual([0, 0, W, H]);
    expect(spy.to("fillRect")[0].state.fillStyle).toBe("#000");
    expect(draws).toHaveLength(1);
    expect(draws[0].args).toEqual([from, 0, 0, W, H]);
    expect(draws[0].state.globalAlpha).toBe(1);
  });

  it("fades the new page in over the old one", () => {
    const { draws, from, to } = run("dissolve", 0.5);
    expect(draws.map((d) => d.args[0])).toEqual([from, to]);
    expect(draws[1].state.globalAlpha).toBeCloseTo(0.5);
  });

  it("shows only the new page at the end", () => {
    const { draws, to } = run("dissolve", 1);
    expect(draws[draws.length - 1].args[0]).toBe(to);
    expect(draws[draws.length - 1].state.globalAlpha).toBe(1);
  });

  it("slides the new page in from the right by default", () => {
    const { at } = run("slide", 0.5);
    // an eighth of the width still to travel at the half way point
    expect(at(1).x).toBeCloseTo(0.125 * W);
    expect(at(1).y).toBeCloseTo(0);
    expect(at(0)).toEqual({ x: 0, y: 0 });
  });

  it("slides in from another side when asked to", () => {
    const { at } = run("slide", 0.5, "up");
    expect(at(1).x).toBeCloseTo(0);
    expect(at(1).y).toBeCloseTo(0.125 * H);
    const right = run("slide", 0.5, "right");
    expect(right.at(1).x).toBeCloseTo(-0.125 * W);
  });

  it("pushes the old page out of the way of the new one", () => {
    const { at } = run("push", 0.5, "up");
    expect(at(0).y).toBeCloseTo(-0.5 * H);
    expect(at(1).y).toBeCloseTo(0.5 * H);
    const byDefault = run("push", 0.5);
    expect(byDefault.at(0).x).toBeCloseTo(-0.5 * W);
    expect(byDefault.at(1).x).toBeCloseTo(0.5 * W);
  });

  it("uncovers the new page with a moving window", () => {
    const { spy } = run("wipe", 0.5, "left");
    const window = spy.to("rect")[0].args as number[];
    expect(window).toEqual([0.5 * W, 0, 0.5 * W, H]);
    expect(spy.to("clip")).toHaveLength(1);
    expect(spy.names().indexOf("clip")).toBeLessThan(spy.names().lastIndexOf("drawImage"));
  });

  it("zooms the old page out and the new one in", () => {
    const { spy, draws } = run("zoom", 1);
    expect(spy.to("scale")[0].args[0]).toBeCloseTo(1.18);
    expect(draws[1].state.globalAlpha).toBe(1);
    // the new page is at its normal size by then, so it is not scaled again
    expect(spy.to("scale")).toHaveLength(1);
  });

  it("dips to black between the two pages", () => {
    const early = run("fade-black", 0.25);
    expect(early.draws).toHaveLength(1);
    expect(early.draws[0].state.globalAlpha).toBeCloseTo(0.5);
    const late = run("fade-black", 0.75);
    expect(late.draws).toHaveLength(1);
    expect(late.draws[0].args[0]).toBe(late.to);
    expect(late.draws[0].state.globalAlpha).toBeCloseTo(0.5);
    expect(run("fade-black", 0.5).draws).toHaveLength(0);
  });

  it("treats an unknown kind as a dissolve", () => {
    const { draws } = run("spiral", 0.5);
    expect(draws).toHaveLength(2);
    expect(draws[1].state.globalAlpha).toBeCloseTo(0.5);
  });

  it("leaves the context as it found it", () => {
    const { spy } = run("push", 0.3);
    expect(spy.names().filter((n) => n === "save")).toHaveLength(spy.names().filter((n) => n === "restore").length);
    expect(spy.matrix()).toEqual([1, 0, 0, 1, 0, 0]);
    expect(spy.ctx.globalAlpha).toBe(1);
  });
});

describe("PlaybackRenderer", () => {
  const first = (): Page =>
    createPage({
      duration: 2,
      elements: [
        createShape("rect", { x: 10, y: 10, width: 100, height: 100, fill: solid("#ff0000") }),
        createShape("ellipse", { x: 200, y: 10, width: 100, height: 100, fill: solid("#0000ff"), animation: { out: { kind: "fade", duration: 1, delay: 0 } } }),
      ],
    });
  const second = (over: Partial<Page> = {}): Page =>
    createPage({
      duration: 2,
      transition: { kind: "dissolve", duration: 1 },
      elements: [
        createShape("rect", { x: 10, y: 10, width: 100, height: 100, fill: solid("#00ff00") }),
        createShape("ellipse", { x: 200, y: 10, width: 100, height: 100, fill: solid("#ffff00"), animation: { in: { kind: "fade", duration: 1, delay: 0 } } }),
      ],
      ...over,
    });
  const make = (pages: Page[]) => {
    const design = { width: W, height: H, pages };
    return { renderer: new PlaybackRenderer(design), timeline: buildTimeline(pages), design };
  };

  describe("renderPageAt", () => {
    it("paints one page at the resolution of the target canvas", () => {
      const { renderer, design } = make([first()]);
      const spy = spyContext({ width: 200, height: 150 });
      expect(renderer.renderPageAt(spy.ctx, design.pages[0], 0)).toBe(true);
      expect(spy.to("setTransform")[1].args.slice(0, 4)).toEqual([0.5, 0, 0, 0.5]);
      expect(spy.to("fillRect")[0].args).toEqual([0, 0, W, H]);
    });

    it("paints the page part-way through its animations", () => {
      const { renderer, design } = make([first()]);
      const early = spyContext();
      renderer.renderPageAt(early.ctx, design.pages[0], 0);
      expect(early.to("fill")).toHaveLength(2);
      const late = spyContext();
      renderer.renderPageAt(late.ctx, design.pages[0], 2);
      expect(late.to("fill")).toHaveLength(1);
    });

    it("can leave out the page background", () => {
      const { renderer, design } = make([first()]);
      const spy = spyContext();
      renderer.renderPageAt(spy.ctx, design.pages[0], 0, { transparent: true });
      expect(spy.to("fillRect")).toHaveLength(0);
    });

    it("reports a page that is waiting for a picture as not ready", () => {
      const waiting = createPage({ elements: [createImage({ src: "https://example.test/slow-pb.png", width: 50, height: 50, naturalWidth: 64, naturalHeight: 48 })] });
      const { renderer } = make([waiting]);
      expect(renderer.renderPageAt(spyContext().ctx, waiting, 0)).toBe(false);
    });
  });

  describe("renderAt", () => {
    it("paints straight onto the target while a page is showing", () => {
      const { renderer, timeline } = make([first(), second()]);
      const spy = spyContext();
      expect(renderer.renderAt(spy.ctx, timeline, 1)).toBe(true);
      expect(spy.to("fill").map((c) => c.state.fillStyle)).toEqual(["#ff0000", "#0000ff"]);
      expect(spy.to("drawImage")).toHaveLength(0);
    });

    it("shows the second page's own time once its transition is over", () => {
      const { renderer, timeline } = make([first(), second()]);
      const early = spyContext();
      renderer.renderAt(early.ctx, timeline, 3);
      expect(early.to("fill").map((c) => c.state.fillStyle)).toEqual(["#00ff00"]);
      const later = spyContext();
      renderer.renderAt(later.ctx, timeline, 4);
      expect(later.to("fill")).toHaveLength(2);
      expect(later.to("fill")[1].state.globalAlpha).toBeCloseTo(1);
    });

    it("renders the old page at its last moment and the new page at its first, then blends them", () => {
      const { renderer, timeline } = make([first(), second()]);
      const target = spyContext();
      const scratch = captureContexts();
      expect(renderer.renderAt(target.ctx, timeline, 2.5)).toBe(true);
      expect(scratch).toHaveLength(2);
      // the blue circle has faded out by the end of page one; the yellow one has not started to fade in
      expect(scratch[0].to("fill").map((c) => c.state.fillStyle)).toEqual(["#ff0000"]);
      expect(scratch[1].to("fill").map((c) => c.state.fillStyle)).toEqual(["#00ff00"]);
      const draws = target.to("drawImage");
      expect(draws).toHaveLength(2);
      expect(draws[0].args[0]).toBe(scratch[0].canvas);
      expect(draws[1].args[0]).toBe(scratch[1].canvas);
      expect(draws[1].state.globalAlpha).toBeCloseTo(0.5);
    });

    it("moves the pages the way the transition of the new page says", () => {
      const { renderer, timeline } = make([first(), second({ transition: { kind: "push", duration: 1, direction: "up" } })]);
      const target = spyContext();
      renderer.renderAt(target.ctx, timeline, 2.5);
      const draws = target.to("drawImage");
      expect(toDevice(draws[0].state.matrix, 0, 0).y).toBeCloseTo(-0.5 * H);
      expect(toDevice(draws[1].state.matrix, 0, 0).y).toBeCloseTo(0.5 * H);
    });

    it("reuses its two scratch canvases from frame to frame", () => {
      const { renderer, timeline } = make([first(), second()]);
      const a = spyContext();
      const b = spyContext();
      renderer.renderAt(a.ctx, timeline, 2.2);
      renderer.renderAt(b.ctx, timeline, 2.8);
      expect(b.to("drawImage").map((d) => d.args[0])).toEqual(a.to("drawImage").map((d) => d.args[0]));
    });

    it("makes new scratch canvases when the target changes size", () => {
      const { renderer, timeline } = make([first(), second()]);
      const small = spyContext({ width: 200, height: 150 });
      const large = spyContext({ width: 400, height: 300 });
      renderer.renderAt(small.ctx, timeline, 2.5);
      renderer.renderAt(large.ctx, timeline, 2.5);
      const [oldA] = small.to("drawImage").map((d) => d.args[0] as HTMLCanvasElement);
      const [newA] = large.to("drawImage").map((d) => d.args[0] as HTMLCanvasElement);
      expect(newA).not.toBe(oldA);
      expect([newA.width, newA.height]).toEqual([400, 300]);
    });

    it("falls back to a dissolve for a transition the page does not describe", () => {
      const pages = [first(), second({ transition: undefined })];
      const { renderer } = make(pages);
      const timeline: Timeline = {
        total: 5,
        segments: [
          { page: 0, start: 0, transition: 0, playStart: 0, end: 2 },
          { page: 1, start: 2, transition: 1, playStart: 3, end: 5 },
        ],
      };
      const target = spyContext();
      renderer.renderAt(target.ctx, timeline, 2.5);
      expect(target.to("drawImage")[1].state.globalAlpha).toBeCloseTo(0.5);
    });

    it("says it is not ready while either page of a transition waits for something", () => {
      const slow = createPage({
        duration: 2,
        transition: { kind: "dissolve", duration: 1 },
        elements: [createImage({ src: "https://example.test/slow-pb-2.png", width: 50, height: 50, naturalWidth: 64, naturalHeight: 48 })],
      });
      const { renderer, timeline } = make([first(), slow]);
      expect(renderer.renderAt(spyContext().ctx, timeline, 2.5)).toBe(false);
    });

    it("clamps a time past the end to the last moment of the last page", () => {
      const { renderer, timeline } = make([first(), second()]);
      const spy = spyContext();
      expect(renderer.renderAt(spy.ctx, timeline, 99)).toBe(true);
      expect(spy.to("fill").length).toBe(2);
    });
  });

  describe("dispose", () => {
    it("empties the scratch canvases so their memory goes back at once", () => {
      const { renderer, timeline } = make([first(), second()]);
      const target = spyContext();
      renderer.renderAt(target.ctx, timeline, 2.5);
      const [a, b] = target.to("drawImage").map((d) => d.args[0] as HTMLCanvasElement);
      expect(a.width).toBe(W);
      renderer.dispose();
      expect([a.width, a.height, b.width, b.height]).toEqual([0, 0, 0, 0]);
    });

    it("is harmless before anything was rendered and when called twice", () => {
      const { renderer } = make([first()]);
      expect(() => {
        renderer.dispose();
        renderer.dispose();
      }).not.toThrow();
    });

    it("lets the renderer carry on: the next transition gets fresh canvases", () => {
      const { renderer, timeline } = make([first(), second()]);
      const before = spyContext();
      renderer.renderAt(before.ctx, timeline, 2.5);
      renderer.dispose();
      const after = spyContext();
      renderer.renderAt(after.ctx, timeline, 2.5);
      const [a] = after.to("drawImage").map((d) => d.args[0] as HTMLCanvasElement);
      expect(a).not.toBe(before.to("drawImage")[0].args[0]);
      expect(a.width).toBe(W);
    });
  });
});

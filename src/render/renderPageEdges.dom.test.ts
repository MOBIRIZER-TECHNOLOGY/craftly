import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createImage, createPage, createTable, createText } from "@/core/factory";
import type { DesignElement, ElementAnimations } from "@/core/types";
import { contextOf } from "@/test/canvasMock";
import { spyContext } from "@/test/logicPaint";
import { ensureFont, isFontReady } from "./fonts";
import { preparePage, renderPage, renderPageToCanvas } from "./renderPage";

const DESIGN = { width: 400, height: 300 };

function paint(elements: DesignElement[], opts: { time?: number } = {}) {
  const spy = spyContext();
  const complete = renderPage(spy.ctx, DESIGN, createPage({ elements }), { scale: 1, animation: opts.time === undefined ? undefined : { time: opts.time } });
  return { spy, complete };
}

describe("fonts that are still loading", () => {
  const added: Array<{ family: string; descriptors: unknown }> = [];

  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: unknown,
    ) {}
    load(): Promise<this> {
      return Promise.resolve(this);
    }
  }

  beforeEach(() => {
    added.length = 0;
    vi.stubGlobal("FontFace", FakeFontFace);
    Object.defineProperty(document, "fonts", { value: { add: (face: FakeFontFace) => added.push(face) }, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("reports the page as not ready, starts loading the font and is ready on the next paint", async () => {
    const el = createText({ text: "Hello", fontFamily: "Pacifico", fontSize: 30 });
    expect(isFontReady("Pacifico", 400, false)).toBe(false);
    expect(paint([el]).complete).toBe(false);
    await ensureFont("Pacifico", 400, false);
    expect(added.map((f) => f.family)).toEqual(["Pacifico"]);
    const again = paint([el]);
    expect(again.complete).toBe(true);
    expect(again.spy.to("fillText")).toHaveLength(1);
  });

  it("still paints the text with the fallback font while the font loads", () => {
    const { spy, complete } = paint([createText({ text: "Fallback", fontFamily: "Lobster", fontSize: 30 })]);
    expect(complete).toBe(false);
    expect(spy.to("fillText")[0].args[0]).toBe("Fallback");
    expect(spy.to("fillText")[0].state.font).toContain("Lobster");
  });

  it("waits for each font of every run, including empty paragraphs", async () => {
    const el = createText({
      fontFamily: "Satisfy",
      paragraphs: [
        {
          runs: [
            { text: "one ", font: "Righteous" },
            { text: "two", bold: true, font: "Righteous" },
          ],
        },
        { runs: [] },
      ],
    });
    expect(paint([el]).complete).toBe(false);
    await Promise.all([ensureFont("Righteous", 400, false), ensureFont("Righteous", 700, false), ensureFont("Satisfy", 400, false)]);
    expect(paint([el]).complete).toBe(true);
  });

  it("treats a family it has never heard of as ready", () => {
    expect(paint([createText({ text: "Plain", fontFamily: "Comic Sans MS" })]).complete).toBe(true);
  });

  it("loads the fonts of a page before painting it to a canvas", async () => {
    const page = createPage({ elements: [createText({ text: "Waits", fontFamily: "Shadows Into Light" })] });
    const canvas = await renderPageToCanvas(DESIGN, page, { width: 400 });
    expect(added.map((f) => f.family)).toContain("Shadows Into Light");
    // the font was ready when the page was painted, so one pass was enough
    expect(contextOf(canvas)!.callsTo("clearRect")).toHaveLength(1);
  });

  it("loads the fonts of a table and a chart too", async () => {
    await preparePage(createPage({ elements: [createTable({ fontFamily: "Cinzel" }), createChart({ fontFamily: "Bungee" })] }));
    expect(new Set(added.map((f) => f.family))).toEqual(new Set(["Cinzel", "Bungee"]));
  });
});

describe("shapes and images that are not what they seem", () => {
  it("falls back to a rectangular mask for an image with no mask", () => {
    const el = createImage({ src: null, width: 100, height: 60, mask: "" });
    const { spy } = paint([el]);
    expect((spy.to("clip").at(-1)!.args[0] as unknown as { data: string }).data).toBe("M0 0H100V60H0Z");
  });
});

describe("typed text in unusual states", () => {
  const typing: ElementAnimations = { in: { kind: "typewriter", duration: 1, delay: 0 } };

  it("shows nothing of a later line until the typing reaches it", () => {
    const el = createText({ text: "first line is long\nsecond", fontSize: 40, x: 0, y: 0, width: 600, autoWidth: false, animation: typing });
    const { spy } = paint([el], { time: 0.25 });
    // page clip + one window for the line being typed
    expect(spy.to("rect")).toHaveLength(2);
  });

  it("hides everything while a text with no visible characters is typed", () => {
    const el = createText({ text: "   ", fontSize: 40, x: 0, y: 0, width: 600, autoWidth: false, animation: typing });
    const { spy } = paint([el], { time: 0.5 });
    expect(spy.to("rect")[1].args).toEqual([0, 0, 0, 0]);
  });
});

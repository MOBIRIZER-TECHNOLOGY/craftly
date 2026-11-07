import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImage, createShape } from "@/core/factory";
import type { Design, Fill, Page } from "@/core/types";
import { loadImage } from "@/render/images";
import { contextOf } from "@/test/canvasMock";
import { coloredDesign, recordPaints, type PaintRecord } from "@/test/chromeUtils";
import { PresentPlayer, type PlayerHost, type PlayerView } from "./PresentPlayer";

/*
 * The player owns a canvas and a frame loop. These tests give it a fake clock (timers, requestAnimationFrame and
 * performance.now move together), a recording canvas, and look at what was painted on the stage and which page it shows.
 * The design is 400 x 300 and the stage 800 x 600, so the stage canvas is 800 x 600 and every page background is
 * filled as the rectangle 0, 0, 400, 300 (design pixels, the context is scaled).
 */

const RED = "#e11d48";
const BLUE = "#2563eb";
const GREEN = "#16a34a";

let paints: PaintRecord;
const players: PresentPlayer[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  paints = recordPaints();
});

afterEach(() => {
  players.splice(0).forEach((p) => p.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let the clock run for `ms` (frames fire every 16 ms) and let promises settle on the way. */
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

function setup(design: Design = coloredDesign(3), index = 0) {
  const canvas = document.createElement("canvas");
  const host = { canvas, onIndex: vi.fn(), onAutoplay: vi.fn(), onFailed: vi.fn(), onProgress: vi.fn() } satisfies PlayerHost;
  const player = new PresentPlayer(host, index);
  players.push(player);
  const view = (patch: Partial<PlayerView> = {}): PlayerView => ({ design, docVersion: 1, stageW: 800, stageH: 600, reducedMotion: false, ...patch });
  return { canvas, host, player, view, design };
}

/** Three 2 second pages; the second is reached with a one second slide from the right. */
function slideDesign(): Design {
  const design = coloredDesign(3);
  design.pages[1].transition = { kind: "slide", duration: 1, direction: "left" };
  return design;
}

/** A page whose background is damaged: it passes the resource check but cannot be painted. */
function damage(page: Page): Page {
  page.background = { type: "linear", angle: 0, stops: undefined } as unknown as Fill;
  return page;
}

const fadeIn = { in: { kind: "fade", duration: 1, delay: 0 } };

/** The colour of the page a canvas shows: follows the latest paint back through the canvases it was copied from. */
function colorOf(canvas: unknown, depth = 0): unknown {
  if (!(canvas instanceof HTMLCanvasElement) || depth > 4) return undefined;
  const background = paints.fills.filter((f) => f.canvas === canvas && f.rect[2] === 400 && f.rect[3] === 300).at(-1);
  const image = paints.images.filter((i) => i.canvas === canvas).at(-1);
  if (background && (!image || background.n > image.n)) return background.style;
  return image ? colorOf(image.source, depth + 1) : undefined;
}

/** How many times a page background was painted straight onto `canvas`. */
const repaints = (canvas: HTMLCanvasElement) => paints.fills.filter((f) => f.canvas === canvas && f.rect[2] === 400 && f.rect[3] === 300).length;
/** How many pictures were copied onto `canvas`. */
const copies = (canvas: HTMLCanvasElement) => paints.images.filter((i) => i.canvas === canvas).length;
/** x of the incoming page in every transition frame drawn on `canvas` (the stage is 800 wide: 400 = at rest, 1200 = off the right edge). */
const incomingOrigins = (canvas: HTMLCanvasElement) =>
  contextOf(canvas)!
    .callsTo("translate")
    .filter((args) => args[1] === 300)
    .map((args) => args[0] as number)
    .filter((_x, i) => i % 2 === 1);
const lastProgress = (host: { onProgress: ReturnType<typeof vi.fn> }) => host.onProgress.mock.calls.at(-1)?.[0] as number;

describe("PresentPlayer: arriving at a page", () => {
  it("paints the first page once the stage has a size", async () => {
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.style.width).toBe("800px");
    expect(canvas.style.height).toBe("600px");
    expect(colorOf(canvas)).toBe(RED);
  });

  it("shows nothing until the stage has been measured", async () => {
    const { canvas, player, view } = setup();
    player.configure(view({ stageW: 0, stageH: 0 }));
    await settle(500);
    player.configure(view({ stageW: 7, stageH: 600 }));
    await settle(500);
    expect(copies(canvas)).toBe(0);
    player.configure(view());
    await settle();
    expect(colorOf(canvas)).toBe(RED);
  });

  it("starts on the page it is given", async () => {
    const { canvas, host, player, view } = setup(coloredDesign(3), 1);
    player.configure(view());
    await settle();
    expect(colorOf(canvas)).toBe(BLUE);
    expect(host.onIndex).not.toHaveBeenCalled();
  });

  it("falls back to the last page when the design has fewer pages than the starting index", async () => {
    const { canvas, host, player, view } = setup(coloredDesign(2), 5);
    player.configure(view());
    await settle();
    expect(host.onIndex).toHaveBeenCalledWith(1);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("draws nothing for a missing design or a design without pages", async () => {
    const { canvas, player, view } = setup();
    player.configure(view({ design: null }));
    player.configure(view({ design: { ...coloredDesign(1), pages: [] } }));
    await settle(500);
    expect(copies(canvas)).toBe(0);
    expect(repaints(canvas)).toBe(0);
  });

  it("sizes the canvas at the device pixel ratio, at most twice the stage", async () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle();
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["800px", "600px"]);
  });

  it("treats a device pixel ratio of 0 as 1", async () => {
    vi.stubGlobal("devicePixelRatio", 0);
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle();
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
  });

  it("leaves the stage alone when it is configured again with nothing new", async () => {
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle(400);
    const painted = copies(canvas);
    player.configure(view());
    await settle(400);
    expect(copies(canvas)).toBe(painted);
    expect(repaints(canvas)).toBe(0);
  });

  it("stops showing a design that was taken away", async () => {
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle(400);
    const painted = copies(canvas);
    player.configure(view({ design: null }));
    player.goTo(1);
    await settle(400);
    expect(copies(canvas)).toBe(painted);
  });

  it("shows nothing, and reports no error, when the stage disappears while the page renders; paints it when the stage is back", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view());
    player.configure(view({ stageW: 0, stageH: 0 })); // the stage collapses before the first page is ready
    await settle(300);
    expect(copies(canvas)).toBe(0);
    expect(host.onFailed).not.toHaveBeenCalled();
    player.configure(view());
    await settle();
    expect(colorOf(canvas)).toBe(RED);
  });

  it("drops a page that finishes rendering after the design was taken away", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view());
    player.configure(view({ design: null }));
    await settle(500);
    expect(copies(canvas)).toBe(0);
    expect(host.onFailed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never makes the canvas wider than 3840 pixels", async () => {
    const { canvas, player, view } = setup();
    player.configure(view({ stageW: 5000, stageH: 4000 }));
    await settle();
    expect([canvas.width, canvas.height]).toEqual([3840, 2880]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["5000px", "3750px"]);
  });

  it("keeps at least 64 pixels for a tiny stage", async () => {
    const { canvas, player, view } = setup();
    player.configure(view({ stageW: 10, stageH: 10 }));
    await settle();
    expect([canvas.width, canvas.height]).toEqual([64, 48]);
    expect(colorOf(canvas)).toBe(RED);
  });

  it("fades a cut in, once per page that appears", async () => {
    const { canvas, player, view } = setup();
    const animate = vi.fn();
    (canvas as unknown as { animate: unknown }).animate = animate;
    player.configure(view());
    await settle();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith([{ opacity: 0.2 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    // a resize paints the same page again: no second fade
    player.configure(view({ stageW: 1000, stageH: 750 }));
    await settle();
    expect(animate).toHaveBeenCalledTimes(1);
    player.goTo(1);
    await settle();
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("does not fade in with reduced motion", async () => {
    const { canvas, player, view } = setup();
    const animate = vi.fn();
    (canvas as unknown as { animate: unknown }).animate = animate;
    player.configure(view({ reducedMotion: true }));
    await settle();
    player.goTo(1);
    await settle();
    expect(colorOf(canvas)).toBe(BLUE);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does nothing visible when the canvas has no 2D context", async () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getContext", { value: () => null });
    const host = { canvas, onIndex: vi.fn(), onAutoplay: vi.fn(), onFailed: vi.fn(), onProgress: vi.fn() };
    const player = new PresentPlayer(host, 0);
    players.push(player);
    const design = coloredDesign(3);
    design.pages[2].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: fadeIn }));
    player.configure({ design, docVersion: 1, stageW: 800, stageH: 600, reducedMotion: false });
    await settle(500);
    player.goTo(1);
    await settle(500);
    player.goTo(2); // a page that moves needs frames, which need the context too
    await settle(500);
    player.toggleAutoplay();
    await settle(500);
    expect(host.onIndex).toHaveBeenLastCalledWith(2);
    expect(copies(canvas)).toBe(0);
    expect(host.onFailed).not.toHaveBeenCalled();
  });
});

describe("PresentPlayer: moving between pages", () => {
  it("shows the next page and reports it at once", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view());
    await settle();
    player.step(1);
    expect(host.onIndex).toHaveBeenCalledWith(1);
    await settle();
    expect(colorOf(canvas)).toBe(BLUE);
    player.step(-1);
    expect(host.onIndex).toHaveBeenLastCalledWith(0);
    await settle();
    expect(colorOf(canvas)).toBe(RED);
  });

  it("clamps a move beyond either end to the first or last page", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view());
    await settle();
    player.goTo(99);
    await settle();
    expect(host.onIndex).toHaveBeenLastCalledWith(2);
    expect(colorOf(canvas)).toBe(GREEN);
    player.goTo(-4);
    await settle();
    expect(host.onIndex).toHaveBeenLastCalledWith(0);
    expect(colorOf(canvas)).toBe(RED);
  });

  it("rounds a fractional page number", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view());
    await settle();
    player.goTo(1.4);
    await settle();
    expect(host.onIndex).toHaveBeenCalledWith(1);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("ignores a move to the page it is already on and moves that are not numbers", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view());
    await settle();
    const painted = copies(canvas);
    player.goTo(0);
    player.goTo(Number.NaN);
    player.goTo(Number.POSITIVE_INFINITY);
    await settle(500);
    expect(host.onIndex).not.toHaveBeenCalled();
    expect(copies(canvas)).toBe(painted);
  });

  it("ignores moves before it has a design", () => {
    const { host, player } = setup();
    player.goTo(1);
    player.step(1);
    expect(host.onIndex).not.toHaveBeenCalled();
  });

  it("remembers a move made before the stage was measured and paints that page first", async () => {
    const { canvas, host, player, view } = setup();
    player.configure(view({ stageW: 0, stageH: 0 }));
    player.goTo(2);
    expect(host.onIndex).toHaveBeenCalledWith(2);
    expect(copies(canvas)).toBe(0);
    player.configure(view());
    await settle();
    expect(colorOf(canvas)).toBe(GREEN);
  });

  it("lets the newest move win: a page that was still loading is never shown", async () => {
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle();
    const before = copies(canvas);
    player.goTo(1);
    player.goTo(2);
    await settle();
    expect(copies(canvas)).toBe(before + 1);
    expect(colorOf(canvas)).toBe(GREEN);
  });

  it("redraws the page it is still loading when the stage is resized", async () => {
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle();
    player.goTo(1);
    player.configure(view({ stageW: 400, stageH: 300 }));
    await settle();
    expect(canvas.width).toBe(400);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("paints a neighbour page from the cache once it has been prepared in the background", async () => {
    const created = vi.spyOn(document, "createElement");
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle(400); // the page is up and the idle moment has passed: page 2 is rendered ahead
    const canvases = () => created.mock.calls.filter(([tag]) => tag === "canvas").length;
    const before = canvases();
    player.goTo(1);
    await settle();
    expect(canvases()).toBe(before);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("frees the pictures of pages the show has moved away from", async () => {
    const { canvas, player, view } = setup(coloredDesign(4));
    player.configure(view());
    await settle(400);
    const first = paints.fills.find((f) => f.style === RED && f.rect[2] === 400 && f.canvas !== canvas)!.canvas;
    expect(first.width).toBe(800);
    player.goTo(3);
    await settle(400);
    expect(first.width).toBe(0);
    expect(colorOf(canvas)).toBe("#f59e0b");
  });

  it("skips a damaged neighbour quietly while preparing ahead and reports it only when the show gets there", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = coloredDesign(3);
    damage(design.pages[1]);
    const { host, player, view } = setup(design);
    player.configure(view());
    await settle(400);
    expect(host.onFailed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    player.goTo(1);
    await settle();
    expect(host.onFailed).toHaveBeenCalledWith(design.pages[1].id);
  });

  it("does not report a damaged page the show had already moved away from", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = coloredDesign(3);
    damage(design.pages[1]);
    const { canvas, host, player, view } = setup(design);
    player.configure(view());
    await settle();
    player.goTo(1);
    player.goTo(2);
    await settle();
    expect(host.onFailed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(colorOf(canvas)).toBe(GREEN);
  });

  it("shares a page that is already being rendered ahead instead of rendering it twice", async () => {
    const { canvas, player, view } = setup();
    player.configure(view());
    await settle(100);
    const created = vi.spyOn(document, "createElement");
    vi.advanceTimersByTime(200); // the background preparation starts rendering page 2 ...
    player.goTo(1); // ... and the presenter asks for it before it is done
    await settle();
    expect(created.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(1);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("does not prepare pages ahead when the stage has gone away", async () => {
    const created = vi.spyOn(document, "createElement");
    const { player, view } = setup();
    player.configure(view());
    await settle(100);
    const before = created.mock.calls.filter(([tag]) => tag === "canvas").length;
    player.configure(view({ stageW: 0, stageH: 0 }));
    await settle(600);
    expect(created.mock.calls.filter(([tag]) => tag === "canvas").length).toBe(before);
  });

  it("uses the idle callback of the browser to prepare the neighbours when there is one", async () => {
    const idle = vi.fn((_cb: IdleRequestCallback, _options?: IdleRequestOptions) => 42);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const created = vi.spyOn(document, "createElement");
    const bitmaps = () => created.mock.calls.filter(([tag]) => tag === "canvas").length;
    const { player, view } = setup();
    player.configure(view());
    await settle(400); // no timer is used instead of the idle callback
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 1000 });
    const afterFirstPage = bitmaps();
    // the browser finds a quiet moment: the next page is rendered ahead
    idle.mock.calls[0][0]({ didTimeout: false, timeRemaining: () => 10 });
    await settle();
    expect(bitmaps()).toBeGreaterThan(afterFirstPage);
    // an idle callback that has not run yet is cancelled when the player goes away
    player.goTo(1);
    await settle();
    player.dispose();
    expect(cancel).toHaveBeenCalledWith(42);
  });
});

describe("PresentPlayer: transitions", () => {
  it("slides the next page in from the right over the old one and ends on the new page", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    const mark = paints.images.at(-1)!.n;
    player.goTo(1);
    expect(host.onIndex).toHaveBeenCalledWith(1);
    await settle();
    // first frame: the old page at rest underneath, the new one still off the right edge
    const first = paints.images.filter((i) => i.canvas === canvas && i.n > mark);
    expect(first).toHaveLength(2);
    expect(colorOf(first[0].source)).toBe(RED);
    expect(colorOf(first[1].source)).toBe(BLUE);
    expect(incomingOrigins(canvas)).toEqual([1200]);
    expect(paints.fills.some((f) => f.canvas === canvas && f.style === "#000")).toBe(true);
    await settle(500);
    const half = incomingOrigins(canvas);
    expect(half.at(-1)!).toBeGreaterThan(400);
    expect(half.at(-1)!).toBeLessThan(700);
    await settle(1500);
    const all = incomingOrigins(canvas);
    expect(all.at(-1)).toBe(400);
    expect([...all].sort((a, b) => b - a)).toEqual(all);
    expect(colorOf(canvas)).toBe(BLUE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("plays the same transition backwards when going back", async () => {
    const { canvas, player, view } = setup(slideDesign(), 1);
    player.configure(view());
    await settle();
    player.goTo(0);
    await settle(1500);
    const origins = incomingOrigins(canvas);
    // the old page leaves to the right, so the page we go back to comes in from the left edge
    expect(origins[0]).toBe(-400);
    expect(origins.at(-1)).toBe(400);
    expect(colorOf(canvas)).toBe(RED);
  });

  it("completes a running transition when another move comes in", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.goTo(1);
    await settle(300);
    player.goTo(2);
    expect(host.onIndex).toHaveBeenLastCalledWith(2);
    await settle(2000);
    expect(colorOf(canvas)).toBe(GREEN);
    // no frame of the first transition is drawn after the second move
    const frames = copies(canvas);
    await settle(1000);
    expect(copies(canvas)).toBe(frames);
  });

  it("ends a transition where it was heading when the stage is resized in the middle of it", async () => {
    const { canvas, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.goTo(1);
    await settle(300);
    player.configure(view({ stageW: 1000, stageH: 750 }));
    await settle(200);
    expect(canvas.width).toBe(1000);
    expect(colorOf(canvas)).toBe(BLUE);
    const frames = copies(canvas);
    await settle(1500);
    expect(copies(canvas)).toBe(frames);
  });

  it("reuses the blend canvases for the next transition", async () => {
    const { canvas, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.goTo(1);
    await settle(1200);
    const sources = new Set(paints.images.filter((i) => i.canvas === canvas).map((i) => i.source));
    const used = sources.size;
    player.goTo(0);
    await settle(1200);
    const after = new Set(paints.images.filter((i) => i.canvas === canvas).map((i) => i.source));
    expect(after.size).toBe(used);
    expect(colorOf(canvas)).toBe(RED);
  });

  it("cuts instead of transitioning with reduced motion", async () => {
    const { canvas, player, view } = setup(slideDesign());
    player.configure(view({ reducedMotion: true }));
    await settle();
    player.goTo(1);
    await settle(1500);
    expect(colorOf(canvas)).toBe(BLUE);
    expect(paints.fills.some((f) => f.canvas === canvas && f.style === "#000")).toBe(false);
    expect(incomingOrigins(canvas)).toEqual([]);
  });

  it("holds a page that has entrances at its first frame while the transition runs, then plays them", async () => {
    const design = slideDesign();
    design.pages[1].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: fadeIn }));
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle();
    player.goTo(1);
    await settle(1030); // the transition (1 s) is over, the shape has not started to appear
    expect(paints.shapes.filter((s) => s.canvas === canvas)).toHaveLength(0);
    await settle(500);
    const alphas = paints.shapes.filter((s) => s.canvas === canvas).map((s) => s.alpha);
    expect(alphas.length).toBeGreaterThan(5);
    expect(alphas.some((a) => a > 0 && a < 1)).toBe(true);
    await settle(1500);
    expect(paints.shapes.filter((s) => s.canvas === canvas).at(-1)!.alpha).toBe(1);
  });

  it("falls back to a cut when the transition cannot be painted, and says which page is damaged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = slideDesign();
    damage(design.pages[1]);
    const { canvas, host, player, view } = setup(design);
    player.configure(view());
    await settle();
    player.goTo(1);
    await settle(200);
    expect(warn).toHaveBeenCalledWith("Craftly: could not play the transition", expect.anything());
    expect(host.onFailed).toHaveBeenCalledWith(design.pages[1].id);
    // the damaged page is not on screen, the page before it is
    expect(colorOf(canvas)).toBe(RED);
  });

  it("cuts to the next page when the page it leaves was damaged", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = slideDesign();
    damage(design.pages[0]);
    const { canvas, host, player, view } = setup(design);
    player.configure(view());
    await settle();
    expect(host.onFailed).toHaveBeenLastCalledWith(design.pages[0].id);
    player.goTo(1);
    await settle(200);
    expect(host.onFailed).toHaveBeenLastCalledWith(null);
    expect(colorOf(canvas)).toBe(BLUE);
    expect(incomingOrigins(canvas)).toEqual([]);
  });
});

describe("PresentPlayer: a page that moves", () => {
  function fadeDesign() {
    const design = coloredDesign(2);
    design.pages[0].duration = 3;
    design.pages[0].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: fadeIn }));
    return design;
  }

  it("plays an entrance on the page it holds, then stops painting frames", async () => {
    const { canvas, player, view } = setup(fadeDesign());
    player.configure(view());
    await settle();
    // at its first moment the shape is not there yet
    expect(paints.shapes.filter((s) => s.canvas === canvas)).toHaveLength(0);
    await settle(500);
    const alphas = paints.shapes.filter((s) => s.canvas === canvas).map((s) => s.alpha);
    expect(alphas.length).toBeGreaterThan(10);
    expect(alphas.at(-1)!).toBeGreaterThan(0.3);
    expect(alphas.at(-1)!).toBeLessThan(0.7);
    expect([...alphas].sort((a, b) => a - b)).toEqual(alphas);
    await settle(1000);
    expect(paints.shapes.filter((s) => s.canvas === canvas).at(-1)!.alpha).toBe(1);
    // settled: no frame is left in the queue
    await settle(500);
    const frames = repaints(canvas);
    await settle(2000);
    expect(repaints(canvas)).toBe(frames);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not restart the entrance when the stage is resized", async () => {
    const { canvas, player, view } = setup(fadeDesign());
    player.configure(view());
    await settle(600);
    const before = paints.shapes.filter((s) => s.canvas === canvas).at(-1)!.alpha;
    expect(before).toBeGreaterThan(0.3);
    player.configure(view({ stageW: 1000, stageH: 750 }));
    await settle(100);
    const after = paints.shapes.filter((s) => s.canvas === canvas).at(-1)!.alpha;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("shows the finished page at once with reduced motion", async () => {
    const { canvas, player, view } = setup(fadeDesign());
    player.configure(view({ reducedMotion: true }));
    await settle();
    expect(paints.shapes.some((s) => s.alpha < 1)).toBe(false);
    expect(paints.shapes.some((s) => s.alpha === 1)).toBe(true);
    expect(copies(canvas)).toBe(1);
    await settle(500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a frame that fires while the next page is still loading", async () => {
    const design = coloredDesign(2);
    design.pages[0].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: { loop: { kind: "pulse", duration: 1, delay: 0 } } }));
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle(100);
    const frames = repaints(canvas);
    player.goTo(1);
    vi.advanceTimersByTime(16); // the frame that was already queued fires before the new page is ready
    expect(repaints(canvas)).toBe(frames);
    await settle();
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("keeps an emphasis going for as long as the page is shown", async () => {
    const design = coloredDesign(1);
    design.pages[0].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: { loop: { kind: "pulse", duration: 1, delay: 0 } } }));
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle(1000);
    const early = repaints(canvas);
    await settle(5000);
    expect(repaints(canvas)).toBeGreaterThan(early + 100);
    const alphas = new Set(paints.shapes.filter((s) => s.canvas === canvas).map((s) => s.alpha));
    expect(alphas.size).toBeGreaterThan(5);
    player.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never plays the exits of a page the presenter holds", async () => {
    const design = coloredDesign(1);
    design.pages[0].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: { out: { kind: "fade", duration: 1, delay: 0 } } }));
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle(5000);
    expect(paints.shapes.length).toBeGreaterThan(0);
    expect(paints.shapes.every((s) => s.alpha === 1)).toBe(true);
    expect(copies(canvas)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("switches an animated page to a still picture when reduced motion is turned on", async () => {
    const { canvas, player, view } = setup(fadeDesign());
    player.configure(view());
    await settle(300);
    player.configure(view({ reducedMotion: true }));
    await settle(100);
    const frames = repaints(canvas);
    await settle(3000);
    expect(repaints(canvas)).toBe(frames);
    expect(copies(canvas)).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repaints the page when the document changes underneath it", async () => {
    const design = coloredDesign(2);
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle();
    expect(colorOf(canvas)).toBe(RED);
    const edited: Design = { ...design, pages: [{ ...design.pages[0], background: { type: "solid", color: "#000001" } }, design.pages[1]] };
    player.configure(view({ design: edited, docVersion: 2 }));
    await settle();
    expect(colorOf(canvas)).toBe("#000001");
  });
});

describe("PresentPlayer: pictures that are not ready", () => {
  function brokenImageDesign() {
    const design = coloredDesign(1);
    design.pages[0].elements.push(
      createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: fadeIn }),
      createImage({ src: "https://example.test/broken.png", x: 0, y: 0, width: 80, height: 60 }),
    );
    return design;
  }

  it("looks again for a missing picture a limited number of times, then leaves the page alone", async () => {
    const { canvas, player, view } = setup(brokenImageDesign());
    player.configure(view());
    await settle(1200); // the entrance is over
    const atRest = repaints(canvas);
    await settle(8000);
    expect(repaints(canvas) - atRest).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("looks again as soon as some picture finishes loading", async () => {
    const { canvas, player, view } = setup(brokenImageDesign());
    player.configure(view());
    await settle(10_000);
    const exhausted = repaints(canvas);
    await loadImage("https://example.test/another-picture.png");
    await settle(300);
    expect(repaints(canvas)).toBeGreaterThan(exhausted);
  });
});

describe("PresentPlayer: auto-play", () => {
  it("plays the design on its own, transitions included, and stops on the last page", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    expect(host.onAutoplay).toHaveBeenLastCalledWith(true);

    await settle(1000);
    expect(colorOf(canvas)).toBe(RED);
    expect(lastProgress(host)).toBeGreaterThan(0.4);
    expect(lastProgress(host)).toBeLessThan(0.6);
    expect(host.onIndex).not.toHaveBeenCalled();

    // 2.5 s: halfway through the slide into page 2, which counts as the very start of that page
    await settle(1500);
    expect(host.onIndex).toHaveBeenCalledWith(1);
    expect(lastProgress(host)).toBe(0);
    expect(incomingOrigins(canvas).length).toBeGreaterThan(10);

    // 4 s: page 2 is up
    await settle(1500);
    expect(colorOf(canvas)).toBe(BLUE);

    // 5.5 s: page 3 arrived by a cut
    await settle(1500);
    expect(host.onIndex).toHaveBeenLastCalledWith(2);
    expect(colorOf(canvas)).toBe(GREEN);

    // 7.5 s: out of pages, the last frame stays
    await settle(2000);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    expect(lastProgress(host)).toBe(1);
    expect(colorOf(canvas)).toBe(GREEN);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("paints each page of a transition once and blends them frame after frame", async () => {
    const { canvas, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(2000); // up to the start of the transition
    const mark = paints.images.length;
    await settle(1000);
    const scratch = new Set(
      paints.images
        .slice(mark)
        .filter((i) => i.canvas === canvas)
        .map((i) => i.source),
    );
    expect(scratch.size).toBe(2);
    for (const c of scratch) {
      expect(paints.fills.filter((f) => f.canvas === c && f.rect[2] === 400)).toHaveLength(1);
    }
    expect(paints.images.slice(mark).filter((i) => i.canvas === canvas).length).toBeGreaterThan(40);
  });

  it("paints a page nothing moves on only once", async () => {
    const { canvas, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(1000);
    const once = repaints(canvas);
    await settle(900);
    expect(repaints(canvas)).toBe(once);
  });

  it("plays the exits of a page, which a held page never does", async () => {
    const design = coloredDesign(2);
    design.pages[0].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: { out: { kind: "fade", duration: 1, delay: 0 } } }));
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(1800);
    const alphas = paints.shapes.filter((s) => s.canvas === canvas).map((s) => s.alpha);
    expect(alphas.some((a) => a < 0.9)).toBe(true);
  });

  it("starts from the page being held", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.goTo(1);
    await settle(1500);
    host.onIndex.mockClear();
    player.toggleAutoplay();
    await settle(1000);
    expect(host.onIndex).not.toHaveBeenCalled();
    expect(colorOf(canvas)).toBe(BLUE);
    await settle(1500);
    expect(host.onIndex).toHaveBeenCalledWith(2);
    await settle(2000);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
  });

  it("hands the show back when the presenter moves", async () => {
    const { host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(500);
    player.step(1);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    expect(host.onIndex).toHaveBeenCalledTimes(1);
    await settle(5000);
    expect(host.onIndex).toHaveBeenCalledTimes(1);
  });

  it("stops where it is when turned off again", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(3600); // page 2 is up
    player.toggleAutoplay();
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    await settle(3000);
    expect(host.onIndex).toHaveBeenCalledTimes(1);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("plays pages one after another with no transitions under reduced motion", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view({ reducedMotion: true }));
    await settle();
    player.toggleAutoplay();
    await settle(2100); // without the one second slide, page 2 starts at 2 s
    expect(host.onIndex).toHaveBeenCalledWith(1);
    expect(colorOf(canvas)).toBe(BLUE);
    await settle(2000);
    expect(colorOf(canvas)).toBe(GREEN);
    await settle(2000);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    expect(paints.fills.some((f) => f.canvas === canvas && f.style === "#000")).toBe(false);
    // the last page stays up, and is redrawn at the new size when the stage changes
    player.configure(view({ reducedMotion: true, stageW: 400, stageH: 300 }));
    await settle(100);
    expect(canvas.width).toBe(400);
    expect(colorOf(canvas)).toBe(GREEN);
  });

  it("is ignored before the stage is measured", async () => {
    const { host, player, view } = setup();
    player.toggleAutoplay();
    player.configure(view({ stageW: 0, stageH: 0 }));
    player.toggleAutoplay();
    await settle(500);
    expect(host.onAutoplay).not.toHaveBeenCalled();
  });

  it("goes on playing after the document changed", async () => {
    const design = slideDesign();
    const { canvas, player, view } = setup(design);
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(500);
    const before = repaints(canvas);
    player.configure(view({ docVersion: 2 }));
    await settle(200);
    expect(repaints(canvas)).toBeGreaterThan(before);
  });

  it("repaints the last page after the stage is resized when the show has ended", async () => {
    const { canvas, host, player, view } = setup(coloredDesign(2));
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(6000);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    player.configure(view({ stageW: 400, stageH: 300 }));
    await settle(100);
    expect(canvas.width).toBe(400);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("draws nothing for a last page that no longer exists", async () => {
    const design = coloredDesign(3);
    const { canvas, host, player, view } = setup(design);
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(8000);
    expect(host.onIndex).toHaveBeenLastCalledWith(2);
    const painted = repaints(canvas);
    // the design loses its last page while the final frame is up
    player.configure(view({ design: { ...design, pages: design.pages.slice(0, 2) }, docVersion: 2 }));
    await settle(200);
    expect(host.onIndex).toHaveBeenLastCalledWith(1);
    expect(repaints(canvas)).toBe(painted);
  });

  it("moves on from the final frame when the presenter goes to another page, and can start again", async () => {
    const { canvas, host, player, view } = setup(coloredDesign(2));
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(6000);
    player.goTo(0);
    await settle(100);
    expect(colorOf(canvas)).toBe(RED);
    host.onAutoplay.mockClear();
    player.toggleAutoplay();
    expect(host.onAutoplay).toHaveBeenCalledWith(true);
    await settle(6000);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
  });

  it("starts auto-play again from the final frame", async () => {
    const { host, player, view } = setup(coloredDesign(2));
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(6000);
    host.onAutoplay.mockClear();
    player.toggleAutoplay();
    expect(host.onAutoplay).toHaveBeenCalledWith(true);
  });

  it("hands auto-play back to the presenter when reduced motion is turned on", async () => {
    const { host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle();
    player.toggleAutoplay();
    await settle(500);
    player.configure(view({ reducedMotion: true }));
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    await settle(5000);
    expect(host.onIndex).not.toHaveBeenCalled();
  });
});

describe("PresentPlayer: damaged pages", () => {
  it("reports the page it cannot draw and carries on with the next one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = coloredDesign(2);
    damage(design.pages[0]);
    const { canvas, host, player, view } = setup(design);
    player.configure(view());
    await settle();
    expect(host.onFailed).toHaveBeenCalledWith(design.pages[0].id);
    expect(warn).toHaveBeenCalledWith("Craftly: could not prepare page", design.pages[0].id, expect.anything());
    expect(copies(canvas)).toBe(0);
    player.goTo(1);
    await settle();
    expect(host.onFailed).toHaveBeenLastCalledWith(null);
    expect(colorOf(canvas)).toBe(BLUE);
  });

  it("reports a page whose picture cannot be put on the stage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { canvas, host, player, view } = setup(coloredDesign(2));
    contextOf(canvas)!.drawImage = () => {
      throw new Error("the canvas was lost");
    };
    player.configure(view());
    await settle();
    expect(warn).toHaveBeenCalledWith("Craftly: could not draw page", expect.any(String), expect.any(Error));
    expect(host.onFailed).toHaveBeenCalledWith(expect.any(String));
  });

  it("stops repainting a page whose frame fails and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = coloredDesign(2);
    design.pages[0].elements.push(createShape("rect", { x: 100, y: 100, width: 100, height: 100, animation: { loop: { kind: "pulse", duration: 1, delay: 0 } } }));
    const { canvas, host, player, view } = setup(design);
    player.configure(view());
    await settle(200);
    expect(host.onFailed).not.toHaveBeenCalled();
    // from now on every frame fails
    contextOf(canvas)!.clearRect = () => {
      throw new Error("out of memory");
    };
    player.configure(view({ docVersion: 2 }));
    await settle(500);
    expect(warn).toHaveBeenCalledWith("Craftly: could not draw page", expect.any(Error));
    expect(host.onFailed).toHaveBeenCalledWith(design.pages[0].id);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it("hands auto-play back when a frame of it fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { canvas, host, player, view } = setup(coloredDesign(2));
    player.configure(view());
    await settle();
    contextOf(canvas)!.clearRect = () => {
      throw new Error("out of memory");
    };
    player.toggleAutoplay();
    await settle(100);
    expect(host.onAutoplay).toHaveBeenLastCalledWith(false);
    expect(host.onFailed).toHaveBeenCalled();
  });
});

describe("PresentPlayer: leaving", () => {
  it("releases its canvases and timers and ignores everything afterwards", async () => {
    const { canvas, host, player, view } = setup(slideDesign());
    player.configure(view());
    await settle(400);
    player.goTo(1);
    await settle(300);
    player.dispose();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    host.onIndex.mockClear();
    player.goTo(2);
    player.step(-1);
    player.toggleAutoplay();
    player.configure(view({ docVersion: 5 }));
    player.dispose();
    await settle(2000);
    expect(host.onIndex).not.toHaveBeenCalled();
    expect(host.onAutoplay).not.toHaveBeenCalled();
    expect(canvas.width).toBe(0);
  });

  it("throws away a page that finishes rendering after the player left", async () => {
    const created = vi.spyOn(document, "createElement");
    const { canvas, player, view } = setup();
    player.configure(view());
    player.dispose(); // the first page is still being prepared
    await settle(500);
    expect(copies(canvas)).toBe(0);
    const bitmaps = created.mock.results.filter((r, i) => created.mock.calls[i][0] === "canvas").map((r) => r.value as HTMLCanvasElement);
    expect(bitmaps.length).toBeGreaterThan(0);
    expect(bitmaps.every((c) => c.width === 0)).toBe(true);
  });
});

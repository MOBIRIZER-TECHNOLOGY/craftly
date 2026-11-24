import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createPage, createVideo } from "@/core/factory";
import type { Design, DesignElement, Page, VideoElement } from "@/core/types";
import { buildTimeline } from "@/core/transition";
import { spyContext } from "@/test/logicPaint";

const frames = vi.hoisted(() => ({ playing: null as unknown, poster: null as unknown, posters: [] as Array<[string, number]> }));
vi.mock("./videos", async (original) => ({
  ...(await original<typeof import("./videos")>()),
  playingFrame: vi.fn(() => frames.playing),
  loadPoster: vi.fn(async (src: string, at: number) => {
    frames.posters.push([src, at]);
    return frames.poster;
  }),
}));

const { getImage, loadImage, videoPosterKey } = await import("./images");
const { collectResources, renderPage } = await import("./renderPage");
const { PlaybackRenderer } = await import("./playback");
const { playingFrame } = await import("./videos");

const DESIGN = { width: 400, height: 300 };
let n = 0;
/** A clip with an upload of its own: the poster cache lives as long as the module does. */
const clip = (over: Partial<VideoElement> = {}): VideoElement =>
  createVideo({ src: `asset:a_${++n}`, naturalWidth: 640, naturalHeight: 360, duration: 10, x: 0, y: 0, width: 200, height: 100, ...over });
const canvas = (w = 64, h = 36) => Object.assign(document.createElement("canvas"), { width: w, height: h });

function paint(elements: DesignElement[], opts: Parameters<typeof renderPage>[3] = { scale: 1 }) {
  const spy = spyContext({ width: 400, height: 300 });
  const complete = renderPage(spy.ctx, DESIGN, createPage({ elements }), opts);
  return { spy, complete };
}

beforeEach(() => {
  frames.playing = null;
  frames.poster = canvas();
  frames.posters = [];
  vi.mocked(playingFrame).mockClear();
});

describe("a clip at rest", () => {
  it("needs its first frame, under a key of its own that names the start of the part that plays", () => {
    const el = clip({ trimStart: 1.234 });
    expect(videoPosterKey(el)).toBe(`video:${el.src}@1.23`);
    expect(videoPosterKey({ src: "asset:x", trimStart: -2 })).toBe("video:asset:x@0");
    expect([...collectResources(createPage({ elements: [el, createGroup([clip({ id: "v_in" })])] })).images]).toHaveLength(2);
    expect(collectResources(createPage({ elements: [clip({ hidden: true })] })).images.size).toBe(0);
  });

  it("is a dark box with a play sign until that frame has come, and the page is painted again then", async () => {
    const el = clip();
    const first = paint([el]);
    expect(first.complete).toBe(false);
    expect(first.spy.to("drawImage")).toHaveLength(0);
    expect(first.spy.to("fillRect").map((c) => c.state.fillStyle)).toContain("#2a2f3a");
    expect(first.spy.to("fill").length).toBeGreaterThan(0);

    await loadImage(videoPosterKey(el));
    expect(frames.posters).toEqual([[el.src, 0]]);
    const second = paint([el]);
    expect(second.complete).toBe(true);
    const [source, x, y, w, h] = second.spy.to("drawImage")[0].args as [unknown, number, number, number, number];
    expect(source).toBe(frames.poster);
    // a 16:9 clip covers its 2:1 box, as a picture does
    expect([x, y, w, h]).toEqual([0, -6.25, 200, 112.5]);
  });

  it("is drawn in its frame: cropped, turned inside it, with its shadow and its outline", async () => {
    const el = clip({
      crop: { x: -0.1, y: 0, w: 1.2, h: 1, rotation: 10 },
      shadow: { color: "#000", blur: 4, x: 2, y: 2 },
      stroke: { color: "#ff0000", width: 3, style: "solid" },
    });
    await loadImage(videoPosterKey(el));
    const { spy } = paint([el]);
    expect(spy.to("drawImage")[0].args.slice(1)).toEqual([-20, 0, 240, 100]);
    expect(spy.to("rotate").length).toBeGreaterThan(0);
    expect(spy.names().indexOf("drawImage")).toBeLessThan(spy.names().lastIndexOf("stroke"));
  });

  it("stays a box with a play sign for a clip this browser cannot play", async () => {
    frames.poster = null;
    const el = clip();
    await loadImage(videoPosterKey(el));
    expect(getImage(videoPosterKey(el))).toBeNull();
    expect(paint([el]).spy.to("drawImage")).toHaveLength(0);
  });

  it("has no poster for a key that does not name an upload", async () => {
    expect(await loadImage("video:https://example.com/a.mp4@0")).toBeNull();
    expect(frames.posters).toEqual([]);
  });
});

describe("a clip that plays", () => {
  it("is the frame its player has at the time of the page, with its sound when asked for", () => {
    const el = clip();
    frames.playing = canvas(32, 18);
    const { spy, complete } = paint([createGroup([el])], { scale: 1, animation: { time: 2.5 }, playVideos: { sound: true } });
    expect(complete).toBe(true);
    expect(playingFrame).toHaveBeenCalledWith(el, 2.5, true);
    expect(spy.to("drawImage")[0].args[0]).toBe(frames.playing);
  });

  it("is its first frame until the player has one, and the page is not counted as unfinished for it", async () => {
    const el = clip();
    const waiting = paint([el], { scale: 1, animation: { time: 1 }, playVideos: {} });
    expect(playingFrame).toHaveBeenCalledWith(el, 1, false);
    expect(waiting.complete).toBe(true);
    await loadImage(videoPosterKey(el));
    expect(paint([el], { scale: 1, animation: { time: 1 }, playVideos: {} }).spy.to("drawImage")[0].args[0]).toBe(frames.poster);
  });

  it("does not play without the time of the page, nor when only animations are asked for", () => {
    paint([clip()], { scale: 1, playVideos: { sound: true } });
    paint([clip()], { scale: 1, animation: { time: 1 } });
    expect(playingFrame).not.toHaveBeenCalled();
  });
});

describe("a playback with clips", () => {
  const design = (pages: Page[]): Pick<Design, "width" | "height" | "pages"> => ({ ...DESIGN, pages });

  it("plays them on a page when it was made to, and holds them at their first frames through a transition", () => {
    const a = createPage({ elements: [clip()], duration: 2 });
    const b = createPage({ elements: [clip()], duration: 2, transition: { kind: "dissolve", duration: 1 } });
    const renderer = new PlaybackRenderer(design([a, b]), { sound: true });
    const target = document.createElement("canvas");
    target.width = 400;
    target.height = 300;
    const ctx = target.getContext("2d")!;
    renderer.renderPageAt(ctx, a, 1);
    expect(playingFrame).toHaveBeenCalledTimes(1);
    vi.mocked(playingFrame).mockClear();
    const timeline = buildTimeline([a, b]);
    renderer.renderAt(ctx, timeline, 2.5);
    expect(playingFrame).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it("holds every clip at its first frame when it was not made to play them (a GIF)", () => {
    const page = createPage({ elements: [clip()] });
    const target = document.createElement("canvas");
    new PlaybackRenderer(design([page])).renderPageAt(target.getContext("2d")!, page, 1);
    expect(playingFrame).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createPage, createVideo, defaultFilter } from "@/core/factory";
import type { Design, DesignElement, Page, VideoElement } from "@/core/types";
import { buildTimeline } from "@/core/transition";
import { contextOf } from "@/test/canvasMock";
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
    // a loop carried on from a split page starts part-way into its play, at its speed: its first frame is there
    expect(videoPosterKey(clip({ src: "asset:y", trimStart: 1, trimEnd: 5, speed: 2, loopFrom: 0.5 }))).toBe("video:asset:y@2");
    expect(videoPosterKey(clip({ src: "asset:y", trimStart: 1, trimEnd: 5, loopFrom: 0.5, once: true }))).toBe("video:asset:y@1");
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

describe("a filtered clip", () => {
  const vivid = { ...defaultFilter(), preset: "vivid" };

  it("is drawn through its filter at rest, as a picture is, filtered once for its first frame", async () => {
    const el = clip({ filter: vivid });
    await loadImage(videoPosterKey(el));
    const once = paint([el]).spy.to("drawImage")[0].args;
    const again = paint([el]).spy.to("drawImage")[0].args;
    // the filtered canvas fills the clip's box; the same one comes back from the cache
    expect(once[0]).toBeInstanceOf(HTMLCanvasElement);
    expect(once[0]).not.toBe(frames.poster);
    expect(once.slice(1)).toEqual([0, 0, 200, 100]);
    expect(again[0]).toBe(once[0]);
  });

  it("is filtered afresh at every frame while it plays, into a canvas that is kept for it", () => {
    const el = clip({ filter: vivid });
    frames.playing = canvas(32, 18);
    const a = paint([el], { scale: 1, animation: { time: 1 }, playVideos: {} }).spy.to("drawImage")[0].args[0] as HTMLCanvasElement;
    const before = contextOf(a)?.callsTo("drawImage").length ?? 0;
    const b = paint([el], { scale: 1, animation: { time: 1.1 }, playVideos: {} }).spy.to("drawImage")[0].args[0];
    expect(b).toBe(a);
    const draws = contextOf(a)?.callsTo("drawImage") ?? [];
    expect(draws.length).toBe(before + 1);
    expect(draws[draws.length - 1][0]).toBe(frames.playing);
  });

  it("without a filter, or with one that changes nothing, is the frame itself", async () => {
    const el = clip({ filter: defaultFilter() });
    await loadImage(videoPosterKey(el));
    expect(paint([el]).spy.to("drawImage")[0].args[0]).toBe(frames.poster);
    // a stored filter that is not an object is no filter
    const odd = clip({ filter: "vivid" as never });
    await loadImage(videoPosterKey(odd));
    expect(paint([odd]).spy.to("drawImage")[0].args[0]).toBe(frames.poster);
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

describe("a clip's captions", () => {
  const lines = [
    { start: 0, end: 1, text: "First words" },
    { start: 1, end: 2, text: "Second words" },
  ];
  const texts = (spy: ReturnType<typeof paint>["spy"]) => spy.to("fillText").map((c) => c.args[0]);

  it("follow a loop carried on from a split page: its first play begins part-way, at the line of that moment", () => {
    frames.playing = canvas();
    const at = (time: number) => texts(paint([clip({ captions: lines, trimEnd: 4, loopFrom: 1.5 })], { scale: 1, animation: { time }, playVideos: {} }).spy);
    expect(at(0)).toEqual(["Second words"]);
    expect(at(2.6)).toEqual(["First words"]);
  });

  it("show the line of the moment over a playing clip, white on a dark band", () => {
    frames.playing = canvas();
    const { spy } = paint([clip({ captions: lines, trimEnd: 4 })], { scale: 1, animation: { time: 1.5 }, playVideos: {} });
    expect(texts(spy)).toEqual(["Second words"]);
    const filled = spy.to("fillText")[0];
    expect(filled.state.fillStyle).toBe("#ffffff");
    expect(spy.to("fill").some((c) => c.state.fillStyle === "rgba(0, 0, 0, 0.66)")).toBe(true);
  });

  it("come again with every play of the clip", () => {
    frames.playing = canvas();
    // 4 s of clip: 4.5 s into the page is 0.5 s into its second play
    expect(texts(paint([clip({ captions: lines, trimEnd: 4 })], { scale: 1, animation: { time: 4.5 }, playVideos: {} }).spy)).toEqual(["First words"]);
  });

  it("are not shown at rest, before the clip starts, after a clip that plays once has played, or between lines", () => {
    frames.playing = canvas();
    expect(texts(paint([clip({ captions: lines })]).spy)).toEqual([]);
    expect(texts(paint([clip({ captions: lines, startAt: 2 })], { scale: 1, animation: { time: 1 }, playVideos: {} }).spy)).toEqual([]);
    expect(texts(paint([clip({ captions: lines, trimEnd: 2, once: true })], { scale: 1, animation: { time: 3 }, playVideos: {} }).spy)).toEqual([]);
    expect(texts(paint([clip({ captions: lines, trimEnd: 4 })], { scale: 1, animation: { time: 2.5 }, playVideos: {} }).spy)).toEqual([]);
  });

  it("wrap to the clip's width, three lines at most, the rest ending in an ellipsis", () => {
    frames.playing = canvas();
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const { spy } = paint([clip({ captions: [{ start: 0, end: 5, text: long }], trimEnd: 5 })], { scale: 1, animation: { time: 1 }, playVideos: {} });
    const drawn = texts(spy) as string[];
    expect(drawn).toHaveLength(3);
    expect(drawn[2].endsWith("…")).toBe(true);
    expect(drawn.join(" ").startsWith("word0 word1")).toBe(true);
  });

  it("follow their style: place, size, letters, colour, and a light band or an outline in place of the dark band", () => {
    frames.playing = canvas();
    const at = { scale: 1, animation: { time: 0.5 }, playVideos: {} };
    const plain = paint([clip({ captions: lines, trimEnd: 4 })], at).spy.to("fillText")[0];
    const top = paint([clip({ captions: lines, trimEnd: 4, captionStyle: { place: "top" } })], at).spy.to("fillText")[0];
    const middle = paint([clip({ captions: lines, trimEnd: 4, captionStyle: { place: "middle" } })], at).spy.to("fillText")[0];
    expect(top.args[2] as number).toBeLessThan(middle.args[2] as number);
    expect(middle.args[2] as number).toBeLessThan(plain.args[2] as number);
    const sizeOf = (f: unknown) => Number(/(\d+(\.\d+)?)px/.exec(String(f))![1]);
    const large = paint([clip({ captions: lines, trimEnd: 4, captionStyle: { size: "l", font: "serif" } })], at).spy.to("fillText")[0];
    expect(sizeOf(large.state.font)).toBeGreaterThan(sizeOf(plain.state.font));
    expect(String(large.state.font)).toContain("Georgia");
    const light = paint([clip({ captions: lines, trimEnd: 4, captionStyle: { band: "light", color: "#000000" } })], at).spy;
    expect(light.to("fill").some((c) => c.state.fillStyle === "rgba(255, 255, 255, 0.85)")).toBe(true);
    expect(light.to("fillText")[0].state.fillStyle).toBe("#000000");
    const outlined = paint([clip({ captions: lines, trimEnd: 4, captionStyle: { band: "none", color: "#facc15" } })], at).spy;
    expect(outlined.to("fill").some((c) => c.state.fillStyle === "rgba(0, 0, 0, 0.66)")).toBe(false);
    expect(outlined.to("strokeText")[0].state.strokeStyle).toBe("rgba(0, 0, 0, 0.85)");
    expect(outlined.to("fillText")[0].state.fillStyle).toBe("#facc15");
    const darkWords = paint([clip({ captions: lines, trimEnd: 4, captionStyle: { band: "none", color: "#000000" } })], at).spy;
    expect(darkWords.to("strokeText")[0].state.strokeStyle).toBe("rgba(255, 255, 255, 0.9)");
  });

  it("are drawn in a video download too, which hands the clip's frames over itself", () => {
    const { spy } = paint([clip({ captions: lines, trimEnd: 4 })], { scale: 1, animation: { time: 0.2 }, playVideos: { frame: () => canvas() } });
    expect(texts(spy)).toEqual(["First words"]);
  });
});

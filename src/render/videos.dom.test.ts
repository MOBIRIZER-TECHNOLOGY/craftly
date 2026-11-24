import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createVideo } from "@/core/factory";
import type { VideoElement } from "@/core/types";

vi.mock("@/core/assets", () => ({ getAssetUrl: vi.fn(async (id: string) => (id === "missing" ? null : `blob:${id}`)) }));

const { loadPoster, onVideosChange, pauseVideos, playingFrame, prepareClips, readFrame, releaseVideos } = await import("./videos");

/** Enough of a <video> for the players: it plays, pauses, seeks (telling `onseeked` when asked) and remembers what was done to it. */
class FakeVideo {
  /** the readyState a new one starts with */
  static startReady = 0;
  muted = false;
  volume = 1;
  preload = "";
  playsInline = false;
  playbackRate = 1;
  readyState = FakeVideo.startReady;
  paused = true;
  ended = false;
  seeking = false;
  videoWidth = 640;
  videoHeight = 360;
  duration = 10;
  src = "";
  seeks: number[] = [];
  plays = 0;
  /** what play() gives back: a promise, or it throws */
  playResult: () => Promise<void> | undefined = () => Promise.resolve();
  autoSeeked = true;
  onloadeddata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  private time = 0;
  get currentTime() {
    return this.time;
  }
  set currentTime(v: number) {
    this.time = v;
    this.seeks.push(v);
    if (this.autoSeeked) queueMicrotask(() => this.onseeked?.());
  }
  play() {
    this.plays++;
    this.paused = false;
    return this.playResult();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

let made: FakeVideo[] = [];
let clock = 1000;
const realCreate = document.createElement.bind(document);

beforeEach(() => {
  FakeVideo.startReady = 0;
  made = [];
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "video") return realCreate(tag);
    const v = new FakeVideo();
    made.push(v);
    return v as unknown as HTMLVideoElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  releaseVideos();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const clip = (over: Partial<VideoElement> = {}): VideoElement => ({
  ...createVideo({ src: "asset:a_clip", naturalWidth: 640, naturalHeight: 360, duration: 10 }),
  id: "v_1",
  ...over,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reading one frame of a clip (its poster)", () => {
  it("seeks to the time asked for and draws that frame on a canvas of the clip's size", async () => {
    const reading = readFrame("blob:x", 2.5);
    const video = made[0];
    expect(video.muted).toBe(true);
    expect(video.src).toBe("blob:x");
    video.onloadeddata?.();
    const canvas = await reading;
    expect(video.seeks).toEqual([2.5]);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect([canvas!.width, canvas!.height]).toEqual([640, 360]);
    expect(video.src).toBe("");
  });

  it("draws at once when the clip is there already, and keeps clear of the very end", async () => {
    const reading = readFrame("blob:x", 0);
    made[0].onloadeddata?.();
    expect(await reading).not.toBeNull();
    expect(made[0].seeks).toEqual([]);

    const late = readFrame("blob:y", 99);
    made[1].onloadeddata?.();
    await late;
    expect(made[1].seeks).toEqual([9.95]);
  });

  it("makes a large frame no larger than 1920 pixels on its longest side", async () => {
    const reading = readFrame("blob:x", 0);
    Object.assign(made[0], { videoWidth: 3840, videoHeight: 2160 });
    made[0].onloadeddata?.();
    const canvas = await reading;
    expect([canvas!.width, canvas!.height]).toEqual([1920, 1080]);
  });

  it("reads the time asked for as it is when the clip does not know its length", async () => {
    const reading = readFrame("blob:x", 3);
    made[0].duration = Number.POSITIVE_INFINITY;
    made[0].onloadeddata?.();
    await reading;
    expect(made[0].seeks).toEqual([2.95]);
  });

  it("gives nothing for a clip that has no picture, will not load, or has nowhere to be drawn", async () => {
    const empty = readFrame("blob:x", 0);
    Object.assign(made[0], { videoWidth: 0 });
    made[0].onloadeddata?.();
    expect(await empty).toBeNull();

    const broken = readFrame("blob:y", 0);
    made[1].onerror?.();
    expect(await broken).toBeNull();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const nowhere = readFrame("blob:z", 0);
    made[2].onloadeddata?.();
    expect(await nowhere).toBeNull();
  });

  it("gives up on a clip that has not given a frame in twenty seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const reading = readFrame("blob:x", 0);
    vi.advanceTimersByTime(20_000);
    expect(await reading).toBeNull();
  });

  it("reads only uploads that are there", async () => {
    expect(await loadPoster("https://example.com/a.mp4", 0)).toBeNull();
    expect(await loadPoster("asset:missing", 0)).toBeNull();
    const reading = loadPoster("asset:a_clip", 0);
    await settle();
    made[0].onloadeddata?.();
    expect(await reading).not.toBeNull();
  });
});

describe("a clip that plays", () => {
  it("has a silent player at the place the time stands for, once it has a frame", async () => {
    const el = clip({ trimStart: 2, trimEnd: 6, speed: 2 });
    expect(playingFrame(el, 0)).toBeNull();
    const video = made[0];
    await settle();
    expect(video.src).toBe("blob:a_clip");
    expect(video.playbackRate).toBe(2);
    expect(video.muted).toBe(true);

    video.readyState = 1;
    expect(playingFrame(el, 0)).toBeNull(); // sought to trimStart, no frame there yet
    expect(video.seeks).toEqual([2]);
    expect(video.plays).toBe(1);

    video.readyState = 2;
    expect(playingFrame(el, 0.05)).toBe(video);
    expect(made).toHaveLength(1);
  });

  it("seeks again when it has drifted, or gone round to the start", () => {
    const el = clip({ trimStart: 0, trimEnd: 4 });
    playingFrame(el, 0);
    const video = made[0];
    video.readyState = 4;
    video.currentTime = 1;
    video.seeks = [];
    expect(playingFrame(el, 1.1)).toBe(video);
    expect(playingFrame(el, 4.2)).toBeNull();
    expect(video.seeks).toEqual([expect.closeTo(0.2, 5)]);
    // while a seek is under way it is not asked for again
    video.seeking = true;
    video.seeks = [];
    playingFrame(el, 3);
    expect(video.seeks).toEqual([]);
  });

  it("plays its sound when asked, unless it is muted", () => {
    const el = clip();
    playingFrame(el, 0, true);
    expect(made[0].muted).toBe(false);
    playingFrame({ ...el, muted: true }, 0, true);
    expect(made[0].muted).toBe(true);
    playingFrame({ ...el, speed: 0 }, 0);
    expect(made[0].playbackRate).toBe(1);
  });

  it("plays at its volume, with its fades at the start and the end of every play", () => {
    // 4 s of clip: a fade in of 1 s and a fade out of 2 s, at half volume
    const el = clip({ trimStart: 0, trimEnd: 4, volume: 0.5, fadeIn: 1, fadeOut: 2 });
    playingFrame(el, 0, true);
    const video = made[0];
    expect(video.volume).toBe(0);
    playingFrame(el, 0.5, true);
    expect(video.volume).toBeCloseTo(0.25);
    playingFrame(el, 1.5, true);
    expect(video.volume).toBeCloseTo(0.5);
    playingFrame(el, 3, true);
    expect(video.volume).toBeCloseTo(0.25);
    // the second play fades in again
    playingFrame(el, 4.5, true);
    expect(video.volume).toBeCloseTo(0.25);
  });

  it("leaves the volume alone while it plays silently (in the editor)", () => {
    const el = clip({ volume: 0.3 });
    playingFrame(el, 1);
    expect(made[0].volume).toBe(1);
  });

  it("plays silently when the browser will not play its sound yet, and goes on when it cannot play at all", async () => {
    const el = clip();
    playingFrame(el, 0, true);
    const video = made[0];
    video.readyState = 2;
    video.paused = true;
    let calls = 0;
    video.playResult = () => (calls++ === 0 ? Promise.reject(new Error("not allowed")) : Promise.resolve());
    playingFrame(el, 0, true);
    await settle();
    expect(video.muted).toBe(true);
    expect(calls).toBe(2);

    // a silent one that is refused stays as it is
    video.paused = true;
    video.playResult = () => Promise.reject(new Error("no"));
    playingFrame(el, 0);
    await settle();
    expect(video.muted).toBe(true);

    video.paused = true;
    video.playResult = () => {
      throw new Error("no media");
    };
    expect(() => playingFrame(el, 0)).not.toThrow();
    video.playResult = () => undefined;
    video.ended = true;
    expect(() => playingFrame(el, 0)).not.toThrow();
  });

  it("starts a new player when the element shows another clip, and lets go of the old one", () => {
    playingFrame(clip(), 0);
    playingFrame(clip({ src: "asset:other" }), 0);
    expect(made).toHaveLength(2);
    expect(made[0].paused).toBe(true);
  });

  it("is a clip that cannot be played when it fails to load or is no longer stored, and says so", async () => {
    const told = vi.fn();
    const stop = onVideosChange(told);
    playingFrame(clip(), 0);
    made[0].onloadeddata?.();
    expect(told).toHaveBeenCalledTimes(1);
    made[0].onerror?.();
    expect(told).toHaveBeenCalledTimes(2);
    expect(playingFrame(clip(), 0)).toBeNull();

    playingFrame(clip({ id: "v_2", src: "asset:missing" }), 0);
    await settle();
    expect(told).toHaveBeenCalledTimes(3);
    stop();
    made[0].onloadeddata?.();
    expect(told).toHaveBeenCalledTimes(3);
  });

  it("forgets the address of a player that was let go of before it came", async () => {
    playingFrame(clip(), 0);
    releaseVideos();
    await settle();
    expect(made[0].src).toBe("");
  });

  it("is paused a moment after it was last asked for, and let go of after half a minute", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    FakeVideo.startReady = 2;
    playingFrame(clip(), 0);
    const video = made[0];
    expect(video.paused).toBe(false);
    clock += 500;
    vi.advanceTimersByTime(250);
    expect(video.paused).toBe(true);
    clock += 31_000;
    vi.advanceTimersByTime(250);
    // a new ask starts a new player: the old one was let go of
    playingFrame(clip(), 0);
    expect(made).toHaveLength(2);
    // and with none left the sweep stops
    releaseVideos();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the sweep by itself once every player was let go of", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    playingFrame(clip(), 0);
    expect(vi.getTimerCount()).toBe(1);
    clock += 31_000;
    vi.advanceTimersByTime(250);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can all be paused at once", () => {
    playingFrame(clip(), 0);
    playingFrame(clip({ id: "v_2" }), 0);
    pauseVideos();
    expect(made.every((v) => v.paused)).toBe(true);
  });
});

describe("getting the clips ready for a recording", () => {
  it("waits until every clip of the pages, in groups too, has a frame, and leaves them paused", async () => {
    const one = clip({ id: "v_a" });
    const two = clip({ id: "v_b" });
    const hidden = clip({ id: "v_c", hidden: true });
    FakeVideo.startReady = 2;
    await prepareClips([one, createGroup([two]), hidden]);
    expect(made).toHaveLength(2);
    expect(made.every((v) => v.paused)).toBe(true);
  });

  it("does not wait for a clip that cannot be played, nor for longer than it was given", async () => {
    const broken = prepareClips([clip({ id: "v_a" })], 5000);
    await settle();
    made[0].onerror?.();
    await broken;

    const slow = prepareClips([clip({ id: "v_b" })], 60);
    clock += 100;
    await slow;
    expect(made[1].paused).toBe(true);
  });
});

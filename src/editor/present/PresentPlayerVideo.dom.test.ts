import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShape, createVideo } from "@/core/factory";
import type { Design } from "@/core/types";
import { coloredDesign, recordPaints, type PaintRecord } from "@/test/chromeUtils";

const clips = vi.hoisted(() => ({ calls: [] as Array<{ time: number; sound: boolean | undefined; at: number }>, paused: 0 }));
vi.mock("@/render/videos", async (original) => ({
  ...(await original<typeof import("@/render/videos")>()),
  playingFrame: vi.fn((el: import("@/core/types").VideoElement, time: number, sound?: boolean) => {
    // `at`: where in the clip itself the frame is, which is what the viewer sees
    clips.calls.push({ time, sound, at: el.src === "asset:long" ? clipTimeOf(el, time) : time });
    return null;
  }),
  pauseVideos: vi.fn(() => {
    clips.paused++;
  }),
}));

const { clipTime } = await vi.importActual<typeof import("@/render/videos")>("@/render/videos");
const { PresentPlayer } = await import("./PresentPlayer");
type Player = InstanceType<typeof PresentPlayer>;

/* The presenter with a clip on its first page: does the clip play, at the page's time and with its sound, whatever the motion setting? */

let paints: PaintRecord;
const players: Player[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  paints = recordPaints();
  clips.calls = [];
  clips.paused = 0;
});

afterEach(() => {
  players.splice(0).forEach((p) => p.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// the real clipTime, once the module is loaded (the mock above runs before it)
let clipTimeOf = (_el: import("@/core/types").VideoElement, time: number) => time;

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function setup(reducedMotion: boolean, withClip = true): { canvas: HTMLCanvasElement; player: Player; design: Design } {
  const design = coloredDesign(2);
  if (withClip) design.pages[0].elements.push(createVideo({ src: "asset:clip", naturalWidth: 640, naturalHeight: 360, duration: 4, x: 50, y: 50, width: 200, height: 100 }));
  // an entrance that reduced motion must still leave out
  design.pages[0].elements.push(createShape("rect", { x: 300, y: 200, width: 50, height: 50, animation: { in: { kind: "fade", duration: 1, delay: 0 } } }));
  const canvas = document.createElement("canvas");
  const player = new PresentPlayer({ canvas, onIndex: vi.fn(), onAutoplay: vi.fn(), onFailed: vi.fn(), onProgress: vi.fn() }, 0);
  players.push(player);
  player.configure({ design, docVersion: 1, stageW: 800, stageH: 600, reducedMotion });
  return { canvas, player, design };
}

const times = () => clips.calls.map((c) => c.time);
clipTimeOf = clipTime;

/** Two pages of 5 seconds, a 60-second clip on the first that runs on under the second; the presenter starts on the first. */
function carrying(index = 0): Player {
  const design = coloredDesign(2);
  design.pages.forEach((p) => (p.duration = 5));
  design.pages[0].elements.push(
    createVideo({ src: "asset:long", naturalWidth: 640, naturalHeight: 360, duration: 60, once: true, runsOn: 1, x: 50, y: 50, width: 200, height: 100 }),
  );
  const player = new PresentPlayer({ canvas: document.createElement("canvas"), onIndex: vi.fn(), onAutoplay: vi.fn(), onFailed: vi.fn(), onProgress: vi.fn() }, index);
  players.push(player);
  player.configure({ design, docVersion: 1, stageW: 800, stageH: 600, reducedMotion: false });
  return player;
}

const lastAt = () => clips.calls[clips.calls.length - 1].at;

describe("a clip in Present", () => {
  it("plays with its sound, at the time the page has been shown", async () => {
    setup(false);
    await settle(1000);
    expect(clips.calls.length).toBeGreaterThan(20);
    expect(clips.calls.every((c) => c.sound === true)).toBe(true);
    expect(Math.max(...times())).toBeGreaterThan(0.9);
  });

  it("still plays with reduced motion, while the entrance of the page stays out", async () => {
    const { canvas } = setup(true);
    await settle(1500);
    expect(clips.calls.length).toBeGreaterThan(20);
    expect(clips.calls.every((c) => c.sound === true)).toBe(true);
    expect(Math.max(...times())).toBeGreaterThan(1.4);
    const alphas = paints.shapes.filter((s) => s.canvas === canvas).map((s) => s.alpha);
    expect(alphas.length).toBeGreaterThan(0);
    expect(alphas.every((a) => a === 1)).toBe(true);
  });

  it("keeps playing with reduced motion in auto-play", async () => {
    const { player } = setup(true);
    await settle(100);
    player.toggleAutoplay();
    clips.calls = [];
    await settle(1000);
    expect(clips.calls.length).toBeGreaterThan(20);
  });

  it("leaves a page without a clip still with reduced motion", async () => {
    setup(true, false);
    await settle(1000);
    expect(clips.calls).toEqual([]);
  });

  it("stops every clip when the show ends", async () => {
    const { player } = setup(true);
    await settle(200);
    player.dispose();
    expect(clips.paused).toBe(1);
  });

  it("plays a clip that runs on under the next page there too, from where it got to", async () => {
    const design = coloredDesign(2);
    design.pages[0].elements.push(
      createVideo({ src: "asset:clip", naturalWidth: 640, naturalHeight: 360, duration: 10, once: true, runsOn: 1, x: 50, y: 50, width: 200, height: 100 }),
    );
    const player = new PresentPlayer({ canvas: document.createElement("canvas"), onIndex: vi.fn(), onAutoplay: vi.fn(), onFailed: vi.fn(), onProgress: vi.fn() }, 1);
    players.push(player);
    player.configure({ design, docVersion: 1, stageW: 800, stageH: 600, reducedMotion: false });
    await settle(1000);
    // the second page has nothing of its own that moves, yet it is painted frame after frame for the clip, with its sound
    expect(clips.calls.length).toBeGreaterThan(20);
    expect(clips.calls.every((c) => c.sound === true)).toBe(true);
  });

  it("goes on under the next page from where it really got to when the presenter held the first page longer than its time", async () => {
    const player = carrying();
    await settle(8000);
    const before = lastAt();
    expect(before).toBeGreaterThan(7.8);
    player.step(1);
    await settle(500);
    // not back to 5 seconds and a bit, where the timeline would have it: on from where it was
    expect(lastAt()).toBeGreaterThan(before);
    expect(lastAt()).toBeGreaterThan(8.2);
    expect(lastAt()).toBeLessThan(9);
  });

  it("and from where it got to when the presenter moved on early", async () => {
    const player = carrying();
    await settle(2000);
    player.step(1);
    await settle(500);
    expect(lastAt()).toBeGreaterThan(2.2);
    expect(lastAt()).toBeLessThan(3);
  });

  it("starts again on its own page when the presenter goes back to it, and goes on from there under the next", async () => {
    const player = carrying();
    await settle(1000);
    player.step(1);
    await settle(1000);
    player.step(-1);
    await settle(200);
    expect(lastAt()).toBeLessThan(0.4);
    player.step(1);
    await settle(500);
    expect(lastAt()).toBeGreaterThan(0.5);
    expect(lastAt()).toBeLessThan(1);
  });

  it("is where the timeline has it on a page the show starts on", async () => {
    carrying(1);
    await settle(500);
    expect(lastAt()).toBeGreaterThan(5.2);
    expect(lastAt()).toBeLessThan(6);
  });
});

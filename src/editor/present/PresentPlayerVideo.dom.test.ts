import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShape, createVideo } from "@/core/factory";
import type { Design } from "@/core/types";
import { coloredDesign, recordPaints, type PaintRecord } from "@/test/chromeUtils";

const clips = vi.hoisted(() => ({ calls: [] as Array<{ time: number; sound: boolean | undefined }>, paused: 0 }));
vi.mock("@/render/videos", async (original) => ({
  ...(await original<typeof import("@/render/videos")>()),
  playingFrame: vi.fn((_el: unknown, time: number, sound?: boolean) => {
    clips.calls.push({ time, sound });
    return null;
  }),
  pauseVideos: vi.fn(() => {
    clips.paused++;
  }),
}));

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
});

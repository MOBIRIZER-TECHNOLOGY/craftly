/**
 * The sounds of the design in Present: they follow auto-play along the design's timeline; a presenter going on to the next page by
 * hand lets them play on, one going back or jumping puts them where that page starts; they stop with the show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioTrack, Design } from "@/core/types";
import { coloredDesign } from "@/test/chromeUtils";

const sounds = vi.hoisted(() => ({ playSoundsAt: vi.fn(), stopSounds: vi.fn(), releaseSounds: vi.fn() }));
vi.mock("@/render/soundTracks", () => sounds);

const { PresentPlayer } = await import("./PresentPlayer");
type Player = InstanceType<typeof PresentPlayer>;

const song: AudioTrack = { id: "au", src: "asset:song", duration: 30, trimStart: 0, trimEnd: 30, startAt: 0 };
const players: Player[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  sounds.playSoundsAt.mockClear();
  sounds.stopSounds.mockClear();
});

afterEach(() => {
  players.splice(0).forEach((p) => p.dispose());
  vi.useRealTimers();
});

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/** Four pages of 2 s each (they start at 0, 2, 4 and 6 s of the design), with a sound unless `audio` is false. */
function setup(index = 0, audio = true): { player: Player; design: Design } {
  const design: Design = { ...coloredDesign(4), ...(audio ? { audio: [song] } : {}) };
  const player = new PresentPlayer({ canvas: document.createElement("canvas"), onIndex: vi.fn(), onAutoplay: vi.fn(), onFailed: vi.fn(), onProgress: vi.fn() }, index);
  players.push(player);
  player.configure({ design, docVersion: 1, stageW: 800, stageH: 600, reducedMotion: false });
  return { player, design };
}

/** The moment of the design the sounds were last played at. */
const lastTime = () => sounds.playSoundsAt.mock.lastCall?.[1] as number;

describe("the sounds of the design in Present", () => {
  it("start at the time of the page the show starts on, and go on with the clock", async () => {
    setup(1);
    expect(lastTime()).toBeCloseTo(2);
    expect(sounds.playSoundsAt.mock.lastCall?.[0]).toEqual([song]);
    expect(sounds.playSoundsAt.mock.lastCall?.[2]).toBe(8);
    await settle(500);
    expect(lastTime()).toBeCloseTo(2.5, 1);
  });

  it("play on when the presenter goes on to the next page, and go to the page's start for a jump or a step back", async () => {
    const { player } = setup();
    await settle(500);
    player.goTo(1);
    await settle(100);
    expect(lastTime()).toBeCloseTo(0.6, 1);
    player.goTo(3);
    expect(lastTime()).toBeCloseTo(6);
    player.step(-1);
    expect(lastTime()).toBeCloseTo(4);
  });

  it("follow auto-play along the design's timeline, and carry on from there when the presenter takes over", async () => {
    const { player } = setup(2);
    await settle(300);
    player.toggleAutoplay();
    await settle(500);
    // auto-play starts at the page's time 0: 4 s into the design
    expect(lastTime()).toBeCloseTo(4.5, 1);
    player.toggleAutoplay();
    await settle(200);
    expect(lastTime()).toBeCloseTo(4.7, 1);
  });

  it("end with the design when auto-play runs out of pages", async () => {
    const { player } = setup(3);
    player.toggleAutoplay();
    await settle(2600);
    expect(lastTime()).toBe(Number.POSITIVE_INFINITY);
  });

  it("stop with the show, and are never asked for in a design without any", async () => {
    const { player } = setup();
    player.dispose();
    expect(sounds.stopSounds).toHaveBeenCalled();
    sounds.playSoundsAt.mockClear();
    await settle(500);
    expect(sounds.playSoundsAt).not.toHaveBeenCalled();
    setup(0, false);
    await settle(500);
    expect(sounds.playSoundsAt).not.toHaveBeenCalled();
  });
});

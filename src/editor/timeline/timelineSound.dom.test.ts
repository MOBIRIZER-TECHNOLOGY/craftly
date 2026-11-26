/** The timeline's Play plays the design's own sounds with the playhead, and stops them whenever it stops. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { AudioTrack } from "@/core/types";
import { stopPreview, usePreview } from "@/editor/canvas/preview";
import { resetEditor } from "@/test/helpers";

const sounds = vi.hoisted(() => ({ playSoundsAt: vi.fn(), stopSounds: vi.fn(), releaseSounds: vi.fn() }));
vi.mock("@/render/soundTracks", () => sounds);

const { pauseTimeline, playTimeline, resetTimeline, seekTimeline, setTimelineOpen } = await import("./timelineStore");

const song: AudioTrack = { id: "au", src: "asset:song", duration: 10, trimStart: 0, trimEnd: 10, startAt: 1 };

let frames: FrameRequestCallback[] = [];
let now = 1000;
const frame = () => {
  const due = frames;
  frames = [];
  for (const f of due) f(now);
};
const advance = (seconds: number) => {
  now += seconds * 1000;
  frame();
};

beforeEach(() => {
  resetEditor();
  resetTimeline();
  usePreview.setState({ preview: null });
  frames = [];
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  useEditor.getState().actions.openDesign({
    ...createDesign({ title: "Music", width: 400, height: 300, pages: [createPage({ id: "p1", duration: 2 }), createPage({ id: "p2", duration: 3 })] }),
    audio: [song],
  });
  sounds.playSoundsAt.mockClear();
  sounds.stopSounds.mockClear();
});

afterEach(() => {
  resetTimeline();
  stopPreview();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the timeline's Play and the sounds of the design", () => {
  it("plays them at the playhead's moment, across the pages, until the end", () => {
    seekTimeline(0.5);
    playTimeline();
    frame();
    expect(sounds.playSoundsAt).toHaveBeenLastCalledWith([song], 0.5, 5);
    advance(2);
    expect(sounds.playSoundsAt).toHaveBeenLastCalledWith([song], 2.5, 5);
    sounds.playSoundsAt.mockClear();
    advance(3);
    // the end: stopped, and nothing more is played
    expect(sounds.playSoundsAt).not.toHaveBeenCalled();
    expect(sounds.stopSounds).toHaveBeenCalled();
  });

  it("stops them when paused, when the timeline is closed, and when something else ends the playback", () => {
    playTimeline();
    frame();
    pauseTimeline();
    expect(sounds.stopSounds).toHaveBeenCalledTimes(1);
    playTimeline();
    frame();
    setTimelineOpen(false);
    expect(sounds.stopSounds).toHaveBeenCalledTimes(2);
    playTimeline();
    frame();
    // Esc on the page ends its preview: the timeline stops with it
    stopPreview();
    expect(sounds.stopSounds).toHaveBeenCalledTimes(3);
  });
});

/**
 * The timeline's state and clock: where `t` seconds of the whole design fall, how the playhead is shown on the page canvas
 * (held still, or playing with sound) and how playing moves from page to page and stops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDesign, createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import { buildTimeline } from "@/core/transition";
import { stopPreview, usePreview } from "@/editor/canvas/preview";
import { resetEditor } from "@/test/helpers";
import {
  AT_REST,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  pageStartAt,
  pauseTimeline,
  placeAt,
  playTimeline,
  pxPerSecond,
  resetTimeline,
  seekTimeline,
  setTimelineOpen,
  useTimeline,
} from "./timelineStore";

/** Three pages of 2, 3 and 4 seconds; a dissolve of 1 s into the third. */
const design = () =>
  createDesign({
    title: "Timeline",
    width: 400,
    height: 300,
    pages: [createPage({ id: "p1", duration: 2 }), createPage({ id: "p2", duration: 3 }), createPage({ id: "p3", duration: 4, transition: { kind: "dissolve", duration: 1 } })],
  });

/** requestAnimationFrame by hand and a clock that moves only when told */
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
const active = () => useEditor.getState().activePageId;
const preview = () => usePreview.getState().preview;

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
  useEditor.getState().actions.openDesign(design());
});

afterEach(() => {
  resetTimeline();
  stopPreview();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the maths of the timeline", () => {
  it("fits the seconds into the width, within bounds", () => {
    expect(pxPerSecond(10, 300)).toBe(30);
    expect(pxPerSecond(1, 1000)).toBe(MAX_PX_PER_SECOND);
    expect(pxPerSecond(1000, 300)).toBe(MIN_PX_PER_SECOND);
    expect(pxPerSecond(0, 300)).toBe(MAX_PX_PER_SECOND);
  });

  it("says which page and which moment of it a second of the whole design is, waiting while a transition runs", () => {
    const tl = buildTimeline(design().pages);
    expect(tl.total).toBe(10);
    expect(placeAt(tl, 0)).toEqual({ page: 0, time: 0, waiting: false });
    expect(placeAt(tl, 1.5)).toEqual({ page: 0, time: 1.5, waiting: false });
    expect(placeAt(tl, 2)).toEqual({ page: 1, time: 0, waiting: false });
    expect(placeAt(tl, 5.5)).toEqual({ page: 2, time: 0, waiting: true });
    expect(placeAt(tl, 7)).toEqual({ page: 2, time: 1, waiting: false });
    // the ends belong to the first and the last page
    expect(placeAt(tl, -3)).toEqual({ page: 0, time: 0, waiting: false });
    expect(placeAt(tl, 99)).toEqual({ page: 2, time: 4, waiting: false });
    expect(placeAt({ segments: [], total: 0 }, 3)).toEqual({ page: 0, time: 0, waiting: false });
    expect(pageStartAt(tl, 2)).toBe(6);
    expect(pageStartAt(tl, 9)).toBe(0);
  });
});

describe("a parked playhead", () => {
  it("turns to the page it is on and holds that moment still", () => {
    seekTimeline(3.5);
    expect(useTimeline.getState().time).toBe(3.5);
    expect(active()).toBe("p2");
    expect(preview()).toMatchObject({ from: 1.5, paused: true });
  });

  it("shows a page at rest at its very start, so it can be edited as it is", () => {
    seekTimeline(2 + AT_REST / 2);
    expect(active()).toBe("p2");
    expect(preview()).toBeNull();
  });

  it("stays inside the design", () => {
    seekTimeline(-4);
    expect(useTimeline.getState().time).toBe(0);
    seekTimeline(400);
    expect(useTimeline.getState().time).toBe(10);
  });

  it("moves to the start of a page chosen elsewhere, and stays where it is on a page it is already on", () => {
    useEditor.getState().actions.setActivePage("p3");
    expect(useTimeline.getState().time).toBe(6);
    seekTimeline(8);
    useEditor.getState().actions.setActivePage("p3");
    expect(useTimeline.getState().time).toBe(8);
  });
});

describe("playing", () => {
  it("plays from the playhead with sound, turns the pages as it goes, waits through a transition and stops at the end", () => {
    seekTimeline(1);
    playTimeline();
    expect(useTimeline.getState().playing).toBe(true);
    frame();
    expect(active()).toBe("p1");
    expect(preview()).toMatchObject({ from: 1, until: 2, sound: true });
    expect(preview()?.paused).toBeUndefined();

    advance(1.5); // 2.5 s: the second page, half a second in
    expect(useTimeline.getState().time).toBeCloseTo(2.5);
    expect(active()).toBe("p2");
    expect(preview()).toMatchObject({ until: 3, sound: true });
    expect(preview()?.from).toBeCloseTo(0.5);

    advance(3); // 5.5 s: the dissolve into the third page, which waits at its start
    expect(active()).toBe("p3");
    expect(preview()).toMatchObject({ from: 0, paused: true });

    advance(1); // 6.5 s: the third page runs
    expect(preview()?.paused).toBeUndefined();
    expect(preview()?.from).toBeCloseTo(0.5);

    advance(10);
    expect(useTimeline.getState()).toMatchObject({ playing: false, time: 10 });
    expect(preview()).toBeNull();
    expect(frames).toHaveLength(0);
  });

  it("leaves a page that runs close to the clock alone, and starts it again from the right moment when it has drifted", () => {
    playTimeline();
    frame();
    const started = preview();
    advance(0.1);
    expect(preview()).toBe(started);
    // something held the page back: it is a second behind
    usePreview.setState({ preview: { ...started!, startedAt: now + 1000 } });
    advance(0.1);
    expect(preview()?.from).toBeCloseTo(0.2);
  });

  it("starts from the beginning when the playhead is at the end", () => {
    seekTimeline(10);
    playTimeline();
    expect(useTimeline.getState().time).toBe(0);
  });

  it("does nothing for a design of no pages", () => {
    useEditor.setState({ design: { ...useEditor.getState().design!, pages: [] } });
    playTimeline();
    expect(useTimeline.getState().playing).toBe(false);
  });

  it("pauses where it is and holds that moment", () => {
    playTimeline();
    frame();
    advance(2.4);
    pauseTimeline();
    expect(useTimeline.getState()).toMatchObject({ playing: false });
    expect(useTimeline.getState().time).toBeCloseTo(2.4);
    expect(active()).toBe("p2");
    expect(preview()?.paused).toBe(true);
    expect(preview()?.from).toBeCloseTo(0.4);
    // a second pause changes nothing
    pauseTimeline();
    expect(useTimeline.getState().time).toBeCloseTo(2.4);
  });

  it("plays on from where the playhead is put while it plays", () => {
    playTimeline();
    frame();
    seekTimeline(7);
    expect(useTimeline.getState().playing).toBe(true);
    advance(0.5);
    expect(useTimeline.getState().time).toBeCloseTo(7.5);
    expect(active()).toBe("p3");
  });

  it("stops when something else ends the page's preview (Esc, another Play), but not when a page runs out by itself", () => {
    playTimeline();
    frame();
    // the page reached its end and stopped its own preview: the clock goes on to the next page
    usePreview.setState({ preview: { ...preview()!, startedAt: now - 2000 } });
    stopPreview();
    expect(useTimeline.getState().playing).toBe(true);
    advance(0.5);
    expect(preview()).not.toBeNull();
    // Esc
    stopPreview();
    expect(useTimeline.getState().playing).toBe(false);
  });

  it("stops and lets the page be edited again when the timeline is closed", () => {
    setTimelineOpen(true);
    playTimeline();
    frame();
    setTimelineOpen(false);
    expect(useTimeline.getState()).toMatchObject({ open: false, playing: false });
    expect(preview()).toBeNull();
    // a held moment goes too
    setTimelineOpen(true);
    seekTimeline(1);
    expect(preview()?.paused).toBe(true);
    setTimelineOpen(false);
    expect(preview()).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { MAX_TRANSITION_DURATION, TRANSITION_PRESETS, buildTimeline, defaultTransition, frameAt, getTransitionPreset, transitionFrame, transitionSeconds } from "./transition";

describe("presets", () => {
  it("looks a preset up by id", () => {
    expect(getTransitionPreset("push")?.label).toBe("Push");
    expect(getTransitionPreset("nope")).toBeUndefined();
    expect(TRANSITION_PRESETS.map((p) => p.id)).toEqual(["dissolve", "slide", "push", "wipe", "zoom", "fade-black"]);
  });

  it("starts a transition with the duration and direction its preset prefers", () => {
    expect(defaultTransition("slide")).toEqual({ kind: "slide", duration: 0.6, direction: "left" });
    expect(defaultTransition("dissolve")).toEqual({ kind: "dissolve", duration: 0.7 });
    expect(defaultTransition("fade-black")).toEqual({ kind: "fade-black", duration: 1 });
  });

  it("falls back to a short plain transition for a kind it does not know", () => {
    expect(defaultTransition("mystery")).toEqual({ kind: "mystery", duration: 0.7 });
  });
});

describe("transitionFrame", () => {
  const REST = { opacity: 1, dx: 0, dy: 0, scale: 1, clip: null };

  it("keeps the old page where it is and fades the new one in for a dissolve and for an unknown kind", () => {
    for (const kind of ["dissolve", "spiral"]) {
      const frame = transitionFrame(kind, 0.5);
      expect(frame.from).toEqual(REST);
      expect(frame.to.opacity).toBeCloseTo(0.5);
      expect(transitionFrame(kind, 0).to.opacity).toBe(0);
      expect(transitionFrame(kind, 1).to.opacity).toBe(1);
    }
  });

  it("clamps the progress to 0..1", () => {
    expect(transitionFrame("dissolve", -3).to.opacity).toBe(0);
    expect(transitionFrame("dissolve", 7).to.opacity).toBe(1);
  });

  it.each([
    ["left", { dx: 0.125, dy: -0 }],
    ["right", { dx: -0.125, dy: 0 }],
    ["up", { dx: -0, dy: 0.125 }],
    ["down", { dx: 0, dy: -0.125 }],
  ] as const)("slides the new page in from the %s side, the old one staying put", (direction, offset) => {
    const frame = transitionFrame("slide", 0.5, direction);
    expect(frame.from).toEqual(REST);
    expect(frame.to.dx).toBeCloseTo(offset.dx);
    expect(frame.to.dy).toBeCloseTo(offset.dy);
    expect(transitionFrame("slide", 1, direction).to.dx + transitionFrame("slide", 1, direction).to.dy).toBeCloseTo(0);
  });

  it.each([
    ["left", { from: [-0.5, 0], to: [0.5, 0] }],
    ["right", { from: [0.5, 0], to: [-0.5, 0] }],
    ["up", { from: [0, -0.5], to: [0, 0.5] }],
    ["down", { from: [0, 0.5], to: [0, -0.5] }],
  ] as const)("pushes both pages %s", (direction, expected) => {
    const frame = transitionFrame("push", 0.5, direction);
    expect([frame.from.dx, frame.from.dy].map((v) => v + 0)).toEqual(expected.from.map((v) => v + 0));
    expect([frame.to.dx, frame.to.dy].map((v) => v + 0)).toEqual(expected.to.map((v) => v + 0));
  });

  it.each([
    ["left", { x0: 0.5, y0: 0, x1: 1, y1: 1 }],
    ["right", { x0: 0, y0: 0, x1: 0.5, y1: 1 }],
    ["up", { x0: 0, y0: 0.5, x1: 1, y1: 1 }],
    ["down", { x0: 0, y0: 0, x1: 1, y1: 0.5 }],
  ] as const)("wipes the new page in from the %s with a window that grows", (direction, clip) => {
    const frame = transitionFrame("wipe", 0.5, direction);
    expect(frame.from).toEqual(REST);
    expect(frame.to.clip).toEqual(clip);
    expect(frame.to.opacity).toBe(1);
  });

  it("zooms the old page up while the new one grows into place", () => {
    const start = transitionFrame("zoom", 0);
    expect(start.from.scale).toBe(1);
    expect(start.to).toMatchObject({ opacity: 0, scale: 0.86 });
    const end = transitionFrame("zoom", 1);
    expect(end.from.scale).toBeCloseTo(1.18);
    expect(end.to).toMatchObject({ opacity: 1 });
    expect(end.to.scale).toBeCloseTo(1);
  });

  it("fades out to black and then in", () => {
    expect(transitionFrame("fade-black", 0).from.opacity).toBe(1);
    expect(transitionFrame("fade-black", 0.25)).toMatchObject({ from: { opacity: 0.5 }, to: { opacity: 0 } });
    expect(transitionFrame("fade-black", 0.5)).toMatchObject({ from: { opacity: 0 }, to: { opacity: 0 } });
    expect(transitionFrame("fade-black", 0.75)).toMatchObject({ from: { opacity: 0 }, to: { opacity: 0.5 } });
    expect(transitionFrame("fade-black", 1).to.opacity).toBe(1);
  });
});

describe("transitionSeconds", () => {
  it("is nothing for the first page, a missing transition and `none`", () => {
    expect(transitionSeconds({ transition: { kind: "dissolve", duration: 1 } }, false)).toBe(0);
    expect(transitionSeconds({}, true)).toBe(0);
    expect(transitionSeconds({ transition: null }, true)).toBe(0);
    expect(transitionSeconds({ transition: { kind: "none", duration: 2 } }, true)).toBe(0);
  });

  it("is the duration, between 0 and the maximum", () => {
    expect(transitionSeconds({ transition: { kind: "slide", duration: 1.5 } }, true)).toBe(1.5);
    expect(transitionSeconds({ transition: { kind: "slide", duration: -4 } }, true)).toBe(0);
    expect(transitionSeconds({ transition: { kind: "slide", duration: 10 } }, true)).toBe(MAX_TRANSITION_DURATION);
  });
});

describe("timeline", () => {
  const pages = [{ duration: 4 }, { duration: 3, transition: { kind: "dissolve", duration: 1 } }, { duration: 2 }];

  it("lays the pages end to end, each with the transition into it first", () => {
    const timeline = buildTimeline(pages);
    expect(timeline.segments).toEqual([
      { page: 0, start: 0, transition: 0, playStart: 0, end: 4 },
      { page: 1, start: 4, transition: 1, playStart: 5, end: 8 },
      { page: 2, start: 8, transition: 0, playStart: 8, end: 10 },
    ]);
    expect(timeline.total).toBe(10);
  });

  it("ignores a transition on the first page and uses the default page length", () => {
    const timeline = buildTimeline([{ transition: { kind: "wipe", duration: 2 } }, {}]);
    expect(timeline.segments[0].transition).toBe(0);
    expect(timeline.total).toBe(10);
  });

  it("has nothing to show for no pages", () => {
    expect(buildTimeline([])).toEqual({ segments: [], total: 0 });
    expect(frameAt({ segments: [], total: 0 }, 3)).toEqual({ kind: "page", page: 0, time: 0 });
  });

  it("says which page, and how far into it, is on screen", () => {
    const timeline = buildTimeline(pages);
    expect(frameAt(timeline, 0)).toEqual({ kind: "page", page: 0, time: 0 });
    expect(frameAt(timeline, 3.5)).toEqual({ kind: "page", page: 0, time: 3.5 });
    expect(frameAt(timeline, 5)).toEqual({ kind: "page", page: 1, time: 0 });
    expect(frameAt(timeline, 6.5)).toEqual({ kind: "page", page: 1, time: 1.5 });
    expect(frameAt(timeline, 9)).toEqual({ kind: "page", page: 2, time: 1 });
  });

  it("says how far through a transition it is", () => {
    const timeline = buildTimeline(pages);
    expect(frameAt(timeline, 4)).toEqual({ kind: "transition", from: 0, to: 1, progress: 0 });
    expect(frameAt(timeline, 4.25)).toEqual({ kind: "transition", from: 0, to: 1, progress: 0.25 });
  });

  it("stays within the ends of the playback", () => {
    const timeline = buildTimeline(pages);
    expect(frameAt(timeline, -5)).toEqual({ kind: "page", page: 0, time: 0 });
    expect(frameAt(timeline, 99)).toEqual({ kind: "page", page: 2, time: 2 });
  });
});

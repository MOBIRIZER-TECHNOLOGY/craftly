import { afterEach, describe, expect, it, vi } from "vitest";

const players = vi.hoisted(() => ({ paused: 0 }));
vi.mock("@/render/videos", () => ({
  pauseVideos: () => {
    players.paused++;
  },
}));
import { holdPreview, previewEntrances, previewRange, previewTime, startPreview, stopPreview, usePreview } from "./preview";

afterEach(() => {
  stopPreview();
  vi.restoreAllMocks();
});

describe("starting and stopping a preview", () => {
  it("remembers when the preview began and which seconds it plays", () => {
    vi.spyOn(performance, "now").mockReturnValue(5000);
    startPreview(1.5, 4);
    expect(usePreview.getState().preview).toEqual({ startedAt: 5000, from: 1.5, until: 4 });
  });

  it("holds a page still at a moment: its time does not move on, and nothing below 0 is held", () => {
    vi.spyOn(performance, "now").mockReturnValue(5000);
    holdPreview(2.5);
    const p = usePreview.getState().preview!;
    expect(p).toEqual({ startedAt: 5000, from: 2.5, until: 2.5, paused: true });
    expect(previewTime(p, 9000)).toBe(2.5);
    holdPreview(-1);
    expect(usePreview.getState().preview?.from).toBe(0);
  });

  it("plays the clips' sound only when asked to", () => {
    startPreview(0, 2);
    expect(usePreview.getState().preview).not.toHaveProperty("sound");
    startPreview(0, 2, { sound: true });
    expect(usePreview.getState().preview?.sound).toBe(true);
  });

  it("stops every clip when it stops, so that none is heard after it", () => {
    players.paused = 0;
    stopPreview();
    expect(players.paused).toBe(0);
    startPreview(0, 2, { sound: true });
    stopPreview();
    expect(players.paused).toBe(1);
  });

  it("never starts before the beginning of the page", () => {
    startPreview(-2, 3);
    expect(usePreview.getState().preview?.from).toBe(0);
  });

  it("stops by clearing the preview, and tells nobody when there is nothing to stop", () => {
    startPreview(0, 2);
    const listener = vi.fn();
    const unsubscribe = usePreview.subscribe(listener);
    stopPreview();
    expect(usePreview.getState().preview).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    stopPreview();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("reports the page second a running preview has reached", () => {
    const p = { startedAt: 1000, from: 2, until: 8 };
    expect(previewTime(p, 1000)).toBe(2);
    expect(previewTime(p, 3500)).toBe(4.5);
    vi.spyOn(performance, "now").mockReturnValue(2000);
    expect(previewTime(p)).toBe(3);
  });
});

describe("previewRange", () => {
  const page = { duration: 6 };
  const anim = (duration: number, delay = 0) => ({ kind: "fade", duration, delay });

  it("plays an entrance from the start to half a second after it ends", () => {
    expect(previewRange("in", anim(1, 0.5), page)).toEqual({ from: 0, until: 2 });
  });

  it("does not run past the end of the page", () => {
    expect(previewRange("in", anim(2, 5), page)).toEqual({ from: 0, until: 6 });
  });

  it("starts an exit a little before it begins and plays to the end of the page", () => {
    // an exit lasting 1s with 0.5s of delay occupies 4.5..5.5
    const r = previewRange("out", anim(1, 0.5), page);
    expect(r.from).toBeCloseTo(3.9);
    expect(r.until).toBe(6);
  });

  it("never starts an exit before the page does", () => {
    expect(previewRange("out", anim(5.5, 0), page).from).toBe(0);
  });

  it("shows two cycles of a loop, at least two seconds, at most the page", () => {
    expect(previewRange("loop", anim(0.5), page)).toEqual({ from: 0, until: 2 });
    expect(previewRange("loop", anim(1.5), page)).toEqual({ from: 0, until: 3 });
    expect(previewRange("loop", anim(5), page)).toEqual({ from: 0, until: 6 });
  });
});

describe("previewEntrances", () => {
  it("plays up to half a second after the last entrance finishes", () => {
    expect(previewEntrances(2.5, { duration: 6 })).toEqual({ from: 0, until: 3 });
  });

  it("stops at the end of the page", () => {
    expect(previewEntrances(9, { duration: 6 })).toEqual({ from: 0, until: 6 });
  });

  it("uses the default page length when the page has none", () => {
    expect(previewEntrances(10, {})).toEqual({ from: 0, until: 5 });
  });
});

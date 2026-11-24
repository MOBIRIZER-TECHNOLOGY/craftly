import { describe, expect, it } from "vitest";
import { MAX_CLIP_FADE, clipFades, clipGainAt, clipVolume } from "./animation";

/* A clip's volume and fades: one curve, followed by Present (the <video>'s volume) and by the video download (the mixed sound). */

const clip = (over: { volume?: number; fadeIn?: number; fadeOut?: number; trimStart?: number; trimEnd?: number; speed?: number } = {}) => ({
  trimStart: 0,
  trimEnd: 10,
  speed: 1,
  ...over,
});

describe("a clip's volume", () => {
  it("is 1 unless it is set, and stays between 0 and 1", () => {
    expect(clipVolume({})).toBe(1);
    expect(clipVolume({ volume: 0.4 })).toBe(0.4);
    expect(clipVolume({ volume: 3 })).toBe(1);
    expect(clipVolume({ volume: -1 })).toBe(0);
  });

  it("counts a value from outside that is not a number as 1", () => {
    expect(clipVolume({ volume: Number.NaN })).toBe(1);
    expect(clipVolume({ volume: "loud" as unknown as number })).toBe(1);
  });
});

describe("a clip's fades", () => {
  it("are none unless set, and at most five seconds each", () => {
    expect(clipFades(clip())).toEqual({ fadeIn: 0, fadeOut: 0 });
    expect(clipFades(clip({ fadeIn: 2, fadeOut: 9 }))).toEqual({ fadeIn: 2, fadeOut: MAX_CLIP_FADE });
    expect(clipFades(clip({ fadeIn: -1, fadeOut: Number.NaN }))).toEqual({ fadeIn: 0, fadeOut: 0 });
  });

  it("are shortened alike when together they are longer than one play of the clip", () => {
    // 4 s of clip at 2x is 2 s of page; fades of 2 s and 2 s meet in the middle at 1 s each
    expect(clipFades(clip({ trimEnd: 4, speed: 2, fadeIn: 2, fadeOut: 2 }))).toEqual({ fadeIn: 1, fadeOut: 1 });
    const { fadeIn, fadeOut } = clipFades(clip({ trimEnd: 3, fadeIn: 3, fadeOut: 1.5 }));
    expect(fadeIn + fadeOut).toBeCloseTo(3);
    expect(fadeIn / fadeOut).toBeCloseTo(2);
  });
});

describe("how loud a clip sounds during one play", () => {
  it("is its volume all through when it has no fades", () => {
    for (const t of [0, 3, 9.99, 10]) expect(clipGainAt(clip({ volume: 0.5 }), t)).toBe(0.5);
  });

  it("rises from silence over the fade in and falls to silence over the fade out", () => {
    const el = clip({ fadeIn: 2, fadeOut: 4 });
    expect(clipGainAt(el, 0)).toBe(0);
    expect(clipGainAt(el, 1)).toBe(0.5);
    expect(clipGainAt(el, 2)).toBe(1);
    expect(clipGainAt(el, 5)).toBe(1);
    expect(clipGainAt(el, 8)).toBe(0.5);
    expect(clipGainAt(el, 10)).toBe(0);
  });

  it("is the fade times the volume, and nothing at all at volume 0", () => {
    expect(clipGainAt(clip({ volume: 0.5, fadeIn: 2 }), 1)).toBe(0.25);
    expect(clipGainAt(clip({ volume: 0, fadeIn: 2 }), 5)).toBe(0);
  });

  it("follows the clip's speed: a fade out of 1 s on a 10 s clip at 2x starts 4 s into the page", () => {
    const el = clip({ speed: 2, fadeOut: 1 });
    expect(clipGainAt(el, 3.9)).toBe(1);
    expect(clipGainAt(el, 4.5)).toBe(0.5);
  });

  it("never goes below silence outside a play", () => {
    const el = clip({ fadeIn: 2, fadeOut: 2 });
    expect(clipGainAt(el, -1)).toBe(0);
    expect(clipGainAt(el, 11)).toBe(0);
  });
});

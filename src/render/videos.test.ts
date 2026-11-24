import { describe, expect, it } from "vitest";
import { createVideo } from "@/core/factory";
import { clampTrim, clipClock, clipFinished, clipTime, isVideoSource, LAST_FRAME_BEFORE_END, MIN_TRIM, playingFrame, playingLength, trimmedLength } from "./videos";

const clip = (over: Partial<Parameters<typeof createVideo>[0]> = {}) => createVideo({ src: "asset:a_clip", naturalWidth: 640, naturalHeight: 360, duration: 10, ...over });

describe("a clip that plays once", () => {
  it("goes from its trim at its speed, then stays on its last frame", () => {
    const el = { trimStart: 2, trimEnd: 6, speed: 2, once: true };
    expect(clipTime(el, 0)).toBe(2);
    expect(clipTime(el, 1)).toBe(4);
    expect(clipTime(el, 2)).toBeCloseTo(6 - LAST_FRAME_BEFORE_END);
    expect(clipTime(el, 30)).toBeCloseTo(6 - LAST_FRAME_BEFORE_END);
  });

  it("has played once its playing length has gone by, and a looping clip never has", () => {
    expect(clipFinished({ trimStart: 0, trimEnd: 4, speed: 2, once: true }, 1.9)).toBe(false);
    expect(clipFinished({ trimStart: 0, trimEnd: 4, speed: 2, once: true }, 2)).toBe(true);
    expect(clipFinished({ trimStart: 0, trimEnd: 4, speed: 2 }, 100)).toBe(false);
  });

  it("never holds before its trim, even for the shortest clip (which plays for 0.05 s)", () => {
    expect(clipTime({ trimStart: 1, trimEnd: 1.02, speed: 1, once: true }, 5)).toBeCloseTo(1.01);
  });
});

describe("the part of a clip that plays", () => {
  it("is the trimmed part, never shorter than a twentieth of a second", () => {
    expect(trimmedLength({ trimStart: 2, trimEnd: 7 })).toBe(5);
    expect(trimmedLength({ trimStart: 3, trimEnd: 3 })).toBe(0.05);
  });

  it("takes as long to play as its length over its speed, a speed of nothing being read as 1", () => {
    expect(playingLength({ trimStart: 0, trimEnd: 8, speed: 2 })).toBe(4);
    expect(playingLength({ trimStart: 0, trimEnd: 8, speed: 0 })).toBe(8);
  });

  it("starts at trimStart, goes at its speed and starts again at trimEnd", () => {
    const el = { trimStart: 2, trimEnd: 6, speed: 2 };
    expect(clipTime(el, 0)).toBe(2);
    expect(clipTime(el, 1)).toBe(4);
    expect(clipTime(el, 2.5)).toBe(3);
    expect(clipTime(el, -4)).toBe(2);
    expect(clipTime({ ...el, speed: 0 }, 1)).toBe(3);
  });
});

describe("trimming", () => {
  const el = { duration: 10, trimStart: 2, trimEnd: 8 };

  it("keeps a new start inside the clip, rounded to a hundredth", () => {
    expect(clampTrim(el, { start: 3.456 })).toEqual({ trimStart: 3.46, trimEnd: 8 });
    expect(clampTrim(el, { start: -1 })).toEqual({ trimStart: 0, trimEnd: 8 });
  });

  it("pushes the end out of the way of a start that would pass it", () => {
    expect(clampTrim(el, { start: 9 })).toEqual({ trimStart: 9, trimEnd: 9.1 });
    expect(clampTrim(el, { start: 20 })).toEqual({ trimStart: 10 - MIN_TRIM, trimEnd: 10 });
  });

  it("keeps a new end inside the clip and pulls the start back when they would cross", () => {
    expect(clampTrim(el, { end: 12 })).toEqual({ trimStart: 2, trimEnd: 10 });
    expect(clampTrim(el, { end: 1 })).toEqual({ trimStart: 0.9, trimEnd: 1 });
    expect(clampTrim(el, { end: 0 })).toEqual({ trimStart: 0, trimEnd: MIN_TRIM });
  });

  it("leaves the end where it is when neither is given, and reads a start past the end of the clip back into it", () => {
    expect(clampTrim({ duration: 5, trimStart: 7, trimEnd: 9 }, {})).toEqual({ trimStart: 4.9, trimEnd: 5 });
  });

  it("treats a clip of no length as one of the shortest part", () => {
    expect(clampTrim({ duration: 0, trimStart: 0, trimEnd: 0 }, { start: 1 })).toEqual({ trimStart: 0, trimEnd: MIN_TRIM });
  });
});

describe("clipClock", () => {
  it("says a length in minutes and seconds", () => {
    expect(clipClock(7)).toBe("0:07");
    expect(clipClock(90)).toBe("1:30");
    expect(clipClock(725.4)).toBe("12:05");
  });

  it("says tenths under ten seconds when asked, and whole seconds above", () => {
    expect(clipClock(2.46, true)).toBe("0:02.5");
    expect(clipClock(12.3, true)).toBe("0:12");
  });

  it("reads what is not a length as none", () => {
    expect(clipClock(Number.NaN)).toBe("0:00");
    expect(clipClock(-3)).toBe("0:00");
  });
});

describe("what a clip may be", () => {
  it("is an upload of this browser and nothing else", () => {
    expect(isVideoSource("asset:a_1-b")).toBe(true);
    expect(isVideoSource("https://example.com/clip.mp4")).toBe(false);
    expect(isVideoSource("asset:")).toBe(false);
    expect(isVideoSource(undefined)).toBe(false);
  });

  it("has no player where there is no document (the server, a worker)", () => {
    expect(playingFrame(clip(), 1)).toBeNull();
  });

  it("has no player for a source that is not an upload", () => {
    expect(playingFrame(clip({ src: "https://example.com/a.mp4" }), 1)).toBeNull();
  });
});

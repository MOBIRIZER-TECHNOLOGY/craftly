import { describe, expect, it } from "vitest";
import { MAX_CAPTIONS, MAX_CAPTION_LENGTH, captionAt, clipCaptions } from "./animation";

/* A clip's captions as they can be shown: whatever a file or a shared design brings is cleaned where it is read. */

describe("a clip's caption lines", () => {
  it("are none without a list", () => {
    expect(clipCaptions({})).toEqual([]);
    expect(clipCaptions({ captions: "hello" as never })).toEqual([]);
  });

  it("keep lines with words and a time that makes sense, in the order they start", () => {
    const captions = [
      { start: 3, end: 4, text: "third" },
      { start: 0, end: 1, text: "  first  " },
      { start: 1, end: 1, text: "no time" },
      { start: -1, end: 2, text: "before the clip" },
      { start: 2, end: 3, text: "   " },
      { start: 2, end: Number.NaN, text: "no end" },
      { start: 2, end: 3, text: 5 },
      null,
      "a line",
    ];
    expect(clipCaptions({ captions: captions as never })).toEqual([
      { start: 0, end: 1, text: "first" },
      { start: 3, end: 4, text: "third" },
    ]);
  });

  it("are at most 200, of at most 300 letters each", () => {
    const many = Array.from({ length: MAX_CAPTIONS + 5 }, (_, i) => ({ start: i, end: i + 1, text: "x".repeat(MAX_CAPTION_LENGTH + 20) }));
    const kept = clipCaptions({ captions: many });
    expect(kept).toHaveLength(MAX_CAPTIONS);
    expect(kept[0].text).toHaveLength(MAX_CAPTION_LENGTH);
  });
});

describe("the caption of a moment", () => {
  const lines = [
    { start: 0, end: 2, text: "a" },
    { start: 1.5, end: 3, text: "b" },
  ];

  it("is the line whose time it is, the later one where two overlap", () => {
    expect(captionAt(lines, 0)?.text).toBe("a");
    expect(captionAt(lines, 1.7)?.text).toBe("b");
    expect(captionAt(lines, 2.5)?.text).toBe("b");
  });

  it("is none at the end of a line or outside them", () => {
    expect(captionAt(lines, 3)).toBeNull();
    expect(captionAt([], 1)).toBeNull();
  });
});

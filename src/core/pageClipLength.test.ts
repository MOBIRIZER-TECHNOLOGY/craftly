import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_DURATION, MAX_CLIP_PAGE_DURATION, MAX_PAGE_DURATION, clipPlayingLength, pageClipLength, pageDuration } from "./animation";
import { createGroup, createPage, createShape, createVideo } from "./factory";
import { buildTimeline } from "./transition";
import type { VideoElement } from "./types";

/* A page with a clip and no length of its own lasts as long as its longest clip takes to play once, as Canva's pages do. */

const clip = (over: Partial<VideoElement> = {}) => createVideo({ src: "asset:c", duration: 12, naturalWidth: 64, naturalHeight: 36, ...over } as Parameters<typeof createVideo>[0]);

describe("how long a clip plays once", () => {
  it("is its trimmed part at its speed", () => {
    expect(clipPlayingLength({ trimStart: 0, trimEnd: 12, speed: 1 })).toBe(12);
    expect(clipPlayingLength({ trimStart: 2, trimEnd: 8, speed: 1 })).toBe(6);
    expect(clipPlayingLength({ trimStart: 2, trimEnd: 8, speed: 2 })).toBe(3);
    expect(clipPlayingLength({ trimStart: 0, trimEnd: 3, speed: 0.25 })).toBe(12);
  });

  it("is never nothing, and a speed that is not a number counts as 1x", () => {
    expect(clipPlayingLength({ trimStart: 4, trimEnd: 4, speed: 1 })).toBe(0.05);
    expect(clipPlayingLength({ trimStart: 0, trimEnd: 6, speed: 0 })).toBe(6);
  });
});

describe("the length of a page with a clip", () => {
  it("is the longest clip's, groups looked into and hidden clips left out", () => {
    expect(pageClipLength(createPage({ elements: [createShape("rect")] }))).toBeNull();
    expect(pageClipLength({})).toBeNull();
    const page = createPage({
      elements: [clip({ trimEnd: 4 }), createGroup([clip({ trimEnd: 9 }), createShape("rect")]), clip({ trimEnd: 11, hidden: true })],
    });
    expect(pageClipLength(page)).toBe(9);
    expect(pageDuration(page)).toBe(9);
  });

  it("follows the trim and the speed", () => {
    expect(pageDuration(createPage({ elements: [clip({ trimStart: 1, trimEnd: 7, speed: 2 })] }))).toBe(3);
  });

  it("gives way to a length set for the page, which keeps its own limit", () => {
    expect(pageDuration(createPage({ duration: 4, elements: [clip()] }))).toBe(4);
    expect(pageDuration(createPage({ duration: 900, elements: [clip()] }))).toBe(MAX_PAGE_DURATION);
  });

  it("is at least a second, and at most ten minutes (as long as a video download can be)", () => {
    expect(pageDuration(createPage({ elements: [clip({ trimEnd: 0.4 })] }))).toBe(1);
    expect(pageDuration(createPage({ elements: [clip({ duration: 1200, trimEnd: 1200 })] }))).toBe(MAX_CLIP_PAGE_DURATION);
    // past the minute a page timed by hand can have
    expect(pageDuration(createPage({ elements: [clip({ duration: 150, trimEnd: 150 })] }))).toBe(150);
  });

  it("is still 5 s for a page with no clip", () => {
    expect(pageDuration(createPage({ elements: [createShape("rect")] }))).toBe(DEFAULT_PAGE_DURATION);
  });

  it("is the length the timeline plays, so Present and the downloads use it too", () => {
    const pages = [createPage({ elements: [clip({ trimEnd: 11 })] }), createPage({ transition: { kind: "dissolve", duration: 1 } })];
    const timeline = buildTimeline(pages);
    expect(timeline.segments.map((s) => [s.playStart, s.end])).toEqual([
      [0, 11],
      [12, 17],
    ]);
    expect(timeline.total).toBe(17);
  });
});

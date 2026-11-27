import { describe, expect, it } from "vitest";
import { pageDuration } from "./animation";
import { MAX_RUNS_ON, carriedClips, carriedClipsOf, carriedClipsSince, clipRunsOn, runEnd } from "./carriedClips";
import { createGroup, createPage, createShape, createVideo } from "./factory";
import type { Page, VideoElement } from "./types";

const clip = (over: Partial<VideoElement> = {}): VideoElement => ({
  ...createVideo({ id: "v", src: "asset:a", naturalWidth: 320, naturalHeight: 180, duration: 10 }),
  ...over,
});
const page = (id: string, duration: number, elements: Page["elements"] = [], transition?: number): Page =>
  createPage({ id, duration, elements, transition: transition ? { kind: "dissolve", duration: transition } : undefined });

describe("a clip that runs on under the pages after its own", () => {
  it("runs on under 0 to MAX_RUNS_ON pages, a whole number", () => {
    expect(clipRunsOn({})).toBe(0);
    expect(clipRunsOn({ runsOn: 2.7 })).toBe(2);
    expect(clipRunsOn({ runsOn: -3 })).toBe(0);
    expect(clipRunsOn({ runsOn: 1e9 })).toBe(MAX_RUNS_ON);
    expect(clipRunsOn({ runsOn: Number.NaN })).toBe(0);
  });

  it("no longer holds its own page for its length", () => {
    expect(pageDuration({ elements: [clip({ trimEnd: 8 })] })).toBe(8);
    expect(pageDuration({ elements: [clip({ trimEnd: 8, runsOn: 1 })] })).toBe(5);
    expect(pageDuration({ elements: [clip({ trimEnd: 8, runsOn: 1 }), clip({ id: "w", trimEnd: 3 })] })).toBe(3);
  });

  it("is under each page it runs on, going on from where it got to, and not under the others", () => {
    const pages = [
      page("a", 2, [clip({ once: true, trimEnd: 5, runsOn: 2, animation: { in: { kind: "fade", duration: 1, delay: 0 } }, locked: true })]),
      page("b", 2),
      page("c", 2),
      page("d", 2),
    ];
    const [a, b, c, d] = carriedClipsOf(pages);
    expect(a).toEqual([]);
    expect(d).toEqual([]);
    // 2 s later: from 2 s into it; 4 s later: from 4 s in; the same id, no entrance, not locked, not running on again
    expect(b[0]).toMatchObject({ id: "v", trimStart: 2, trimEnd: 5 });
    expect(c[0]).toMatchObject({ id: "v", trimStart: 4, trimEnd: 5 });
    for (const copy of [b[0], c[0]]) {
      expect(copy.animation).toBeUndefined();
      expect(copy.locked).toBeUndefined();
      expect(copy.runsOn).toBeUndefined();
    }
    // the clip on its own page is left as it was
    expect((pages[0].elements[0] as VideoElement).trimStart).toBe(0);
  });

  it("holds its last frame, silent, once it has played; goes round on as a loop; waits when it starts later", () => {
    const pages = [
      page("a", 3, [
        clip({ id: "once", once: true, trimEnd: 2, runsOn: 1 }),
        clip({ id: "loop", trimEnd: 2, runsOn: 1 }),
        clip({ id: "late", startAt: 4.5, trimEnd: 2, runsOn: 1 }),
      ]),
      page("b", 3),
    ];
    const [once, loop, late] = carriedClipsOf(pages)[1];
    expect(once).toMatchObject({ trimStart: 1.9, volume: 0 });
    expect(loop.loopFrom).toBe(1);
    expect(late.startAt).toBe(1.5);
  });

  it("counts a transition between the pages, and stops at the last page", () => {
    const pages = [page("a", 2, [clip({ once: true, runsOn: 5 })]), page("b", 2, [], 1)];
    // page b's own time starts 3 s after page a's: 2 s of a and the 1 s transition
    expect(carriedClipsOf(pages)[1][0].trimStart).toBe(3);
    expect(carriedClipsOf(pages)).toHaveLength(2);
    expect(runEnd(pages, 0, { runsOn: 5 })).toBe(5);
    expect(runEnd(pages, 0, {})).toBe(2);
    expect(runEnd(pages, 7, { runsOn: 1 })).toBe(0);
  });

  it("looks into groups, leaves hidden clips out, and is kept per list of pages", () => {
    const pages = [
      page("a", 2, [createGroup([createShape("rect"), clip({ id: "g", runsOn: 1 })]), clip({ id: "h", hidden: true, runsOn: 1 })]),
      page("b", 2, [clip({ id: "own" })]),
    ];
    const carried = carriedClipsOf(pages);
    expect(carried[1].map((c) => c.id)).toEqual(["g"]);
    expect(carriedClipsOf(pages)).toBe(carried);
    // the same page, or a copy of it with its id; nothing for a page of another list, or without a list
    expect(carriedClips(pages, pages[1])).toBe(carried[1]);
    expect(carriedClips(pages, { ...pages[1] })).toBe(carried[1]);
    expect(carriedClips(pages, page("x", 2))).toEqual([]);
    expect(carriedClips(undefined, pages[1])).toEqual([]);
    expect(carriedClipsOf([page("a", 2, [clip()]), page("b", 2)])[1]).toEqual([]);
  });
});

describe("a clip carried at the pace the pages were really shown", () => {
  const pages = () => [page("a", 2, [clip({ once: true, trimEnd: 10, runsOn: 2 })]), page("b", 2), page("c", 2), page("d", 2)];

  it("goes on from the time that really passed since its own page started", () => {
    expect(carriedClipsSince(pages(), 1, () => 3.5)).toMatchObject([{ id: "v", trimStart: 3.5 }]);
    expect(carriedClipsSince(pages(), 2, (i) => (i === 0 ? 7 : undefined))).toMatchObject([{ trimStart: 7 }]);
  });

  it("goes by the timeline when that time is not known or makes no sense", () => {
    expect(carriedClipsSince(pages(), 2, () => undefined)).toMatchObject([{ trimStart: 4 }]);
    expect(carriedClipsSince(pages(), 1, () => -1)).toMatchObject([{ trimStart: 2 }]);
    expect(carriedClipsSince(pages(), 1, () => Number.NaN)).toMatchObject([{ trimStart: 2 }]);
  });

  it("is under the pages it runs on only, and under no page of its own", () => {
    expect(carriedClipsSince(pages(), 0, () => 1)).toEqual([]);
    expect(carriedClipsSince(pages(), 3, () => 1)).toEqual([]);
    expect(carriedClipsSince(pages(), 9, () => 1)).toEqual([]);
  });
});

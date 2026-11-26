import { describe, expect, it } from "vitest";
import { pageDuration } from "./animation";
import { createGroup, createPage, createShape, createVideo } from "./factory";
import { splitMoment, splitPageAt } from "./splitPage";
import type { Page, VideoElement } from "./types";

const clip = (over: Partial<VideoElement> = {}): VideoElement => ({
  ...createVideo({ src: "asset:a_clip", naturalWidth: 320, naturalHeight: 180, duration: 10 }),
  ...over,
});
const videos = (page: Page) => page.elements.filter((e): e is VideoElement => e.type === "video");

describe("where a page can be split", () => {
  it("only where both parts last a page's shortest length, to the tenth", () => {
    const page = createPage({ duration: 5 });
    expect(splitMoment(page, 2.34)).toBe(2.3);
    expect(splitMoment(page, 1)).toBe(1);
    expect(splitMoment(page, 4)).toBe(4);
    expect(splitMoment(page, 0.9)).toBeNull();
    expect(splitMoment(page, 4.2)).toBeNull();
    expect(splitMoment(page, Number.NaN)).toBeNull();
    expect(splitPageAt(page, 0.5)).toBeNull();
  });
});

describe("splitting a page", () => {
  it("cuts a page timed by hand in two lengths, keeps the transition on the first and leaves the page itself alone", () => {
    const page = createPage({ duration: 6, name: "Intro", notes: "say hello", transition: { kind: "dissolve", duration: 1 } });
    const { first, second } = splitPageAt(page, 2.5)!;
    expect(first).toMatchObject({ duration: 2.5, name: "Intro", notes: "say hello", transition: { kind: "dissolve" } });
    expect(second.duration).toBe(3.5);
    expect(second.transition).toBeNull();
    expect(second.name).toBeUndefined();
    expect(second.notes).toBeUndefined();
    expect(page.duration).toBe(6);
  });

  it("plays entrances on the first part only and exits on the second only, in groups too", () => {
    const anim = { kind: "fade", duration: 1, delay: 0 };
    const box = createShape("rect", { animation: { in: anim, out: anim, loop: anim } });
    const inner = createShape("rect", { animation: { in: anim, out: anim } });
    const page = createPage({ duration: 6, elements: [box, createGroup([inner])] });
    const { first, second } = splitPageAt(page, 3)!;
    expect(first.elements[0].animation).toEqual({ in: anim, loop: anim });
    expect(second.elements[0].animation).toEqual({ out: anim, loop: anim });
    const groupOf = (p: Page) => (p.elements[1].type === "group" ? p.elements[1].children[0] : null);
    expect(groupOf(first)?.animation).toEqual({ in: anim });
    expect(groupOf(second)?.animation).toEqual({ out: anim });
  });

  it("goes on with a clip that plays once from the place it had reached, its captions moved with it and no fade in at the cut", () => {
    const video = clip({
      trimStart: 2,
      trimEnd: 8,
      speed: 2,
      once: true,
      startAt: 1,
      fadeIn: 0.5,
      fadeOut: 0.5,
      captions: [
        { start: 0, end: 1, text: "gone" },
        { start: 1, end: 2, text: "cut" },
        { start: 2.5, end: 3, text: "later" },
      ],
    });
    // the clip plays 3 s on its page (6 s of it at twice the speed), from 1 s; the page follows it (4 s)
    const page = createPage({ elements: [video] });
    const { first, second } = splitPageAt(page, 2.5)!;
    expect(videos(first)[0]).toEqual(video);
    expect(first.duration).toBe(2.5);
    const after = videos(second)[0];
    // 1.5 s of the page had played: 3 s of the clip
    expect(after.trimStart).toBe(5);
    expect(after.trimEnd).toBe(8);
    expect(after.startAt).toBeUndefined();
    expect(after.fadeIn).toBeUndefined();
    expect(after.fadeOut).toBe(0.5);
    expect(after.captions).toEqual([
      { start: 0, end: 0.5, text: "cut" },
      { start: 1, end: 1.5, text: "later" },
    ]);
    // the second page still follows its clip, which now lasts the rest
    expect(second.duration).toBeUndefined();
  });

  it("starts a clip that had not started that much sooner, and at once when it was due at the cut", () => {
    const page = createPage({ duration: 8, elements: [clip({ startAt: 5 }), clip({ startAt: 3 })] });
    const [a, b] = videos(splitPageAt(page, 3)!.second);
    expect(a.startAt).toBe(2);
    expect(b.startAt).toBeUndefined();
    expect(a.trimStart).toBe(0);
  });

  it("holds the last frame of a clip that had played once and ended, silent and without captions", () => {
    const page = createPage({ duration: 8, elements: [clip({ trimEnd: 2, once: true, fadeIn: 1, captions: [{ start: 0, end: 1, text: "x" }] })] });
    const after = videos(splitPageAt(page, 5)!.second)[0];
    expect(after.trimStart).toBe(1.9);
    expect(after.trimEnd).toBe(2);
    expect(after.volume).toBe(0);
    expect(after.captions).toBeUndefined();
    expect(after.fadeIn).toBeUndefined();
  });

  it("leaves a captioned clip with no lines left without captions", () => {
    const page = createPage({ elements: [clip({ trimEnd: 6, once: true, captions: [{ start: 0, end: 1, text: "early" }] })] });
    expect(videos(splitPageAt(page, 3)!.second)[0].captions).toBeUndefined();
  });

  it("goes on with a clip that plays over and over part-way through the play it was in", () => {
    // 2 s a play at its own speed; 5 s in it is 1 s into its third play
    const loop = clip({ trimStart: 1, trimEnd: 3 });
    const page = createPage({ duration: 8, elements: [loop] });
    const after = videos(splitPageAt(page, 5)!.second)[0];
    expect(after).toMatchObject({ trimStart: 1, trimEnd: 3, loopFrom: 1 });
    expect(after.startAt).toBeUndefined();
    // split again 1.5 s into that page: it was 1 s in, and 0.5 s into the next play now
    const again = videos(splitPageAt({ ...splitPageAt(page, 5)!.second, duration: 3 }, 1.5)!.second)[0];
    expect(again.loopFrom).toBe(0.5);
    // at the very start of a play there is nothing to carry on
    expect(videos(splitPageAt(page, 4)!.second)[0].loopFrom).toBeUndefined();
    // a loop that had not started yet starts sooner, from its beginning
    const later = videos(splitPageAt(createPage({ duration: 8, elements: [clip({ trimEnd: 2, startAt: 3 })] }), 2)!.second)[0];
    expect(later).toMatchObject({ startAt: 1 });
    expect(later.loopFrom).toBeUndefined();
  });

  it("counts a loop's speed in where it goes on", () => {
    // 4 s of clip at twice the speed: 2 s a play; 3 s in it is 1 s into its second play
    const after = videos(splitPageAt(createPage({ duration: 8, elements: [clip({ trimEnd: 4, speed: 2 })] }), 3)!.second)[0];
    expect(after.loopFrom).toBe(1);
  });

  it("goes on following its clips when they still say how long it is", () => {
    // a looping clip (4 s) and a later one that plays once and ends the page at 5 s: both go on, and say 3 s are left
    const page = createPage({ elements: [clip({ trimEnd: 4 }), clip({ trimEnd: 2, once: true, startAt: 3 })] });
    const { second } = splitPageAt(page, 2)!;
    expect(second.duration).toBeUndefined();
    expect(pageDuration(second)).toBe(3);
    // a page that was 5 s by default keeps the rest of those
    expect(splitPageAt(createPage({}), 2)!.second.duration).toBe(3);
  });

  it("goes on with clips inside groups too", () => {
    const page = createPage({ elements: [createGroup([clip({ once: true, trimEnd: 6 }), createShape("rect")])] });
    const group = splitPageAt(page, 2)!.second.elements[0];
    expect(group.type === "group" && group.children[0].type === "video" ? group.children[0].trimStart : null).toBe(2);
  });
});

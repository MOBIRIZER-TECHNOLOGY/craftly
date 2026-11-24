import { describe, expect, it } from "vitest";
import { pageHasAnimation } from "@/core/animation";
import { createPage, createShape, createVideo } from "@/core/factory";
import type { AnimDirection, ElementAnimations, Page, PageTransition } from "@/core/types";
import { autoplayAt, isAnimating, pageProgress, planAutoplay, planTransition, reverseDirection, stripExits } from "./playbackPlan";

const tr = (kind: string, duration = 0.6, direction?: AnimDirection): PageTransition => ({ kind, duration, ...(direction ? { direction } : {}) });
const withAnim = (animation: ElementAnimations, init: Parameters<typeof createShape>[1] = {}) => createShape("rect", { x: 0, y: 0, width: 100, height: 100, animation, ...init });
const fade = (delay = 0, duration = 1) => ({ kind: "fade", duration, delay });

describe("auto-play with a clip", () => {
  it("gives a page with a clip the clip's length, with reduced motion too", () => {
    const clip = createVideo({ src: "asset:c", duration: 8, naturalWidth: 64, naturalHeight: 36 });
    const pages = [createPage({ elements: [clip] }), createPage({ transition: tr("slide", 1) })];
    expect(planAutoplay(pages, 1).offset).toBe(9);
    // the transition is left out, but the first page still lasts as long as its clip
    expect(planAutoplay(pages, 1, true).offset).toBe(8);
    expect(planAutoplay(pages, 0, true).timeline.total).toBe(13);
  });
});

describe("reverseDirection", () => {
  it("swaps left with right and up with down", () => {
    expect(reverseDirection("left")).toBe("right");
    expect(reverseDirection("right")).toBe("left");
    expect(reverseDirection("up")).toBe("down");
    expect(reverseDirection("down")).toBe("up");
  });
  it("undoes itself", () => {
    for (const d of ["left", "right", "up", "down"] as const) expect(reverseDirection(reverseDirection(d))).toBe(d);
  });
});

describe("planTransition", () => {
  // page 0 has no transition (nothing to arrive from); page 4 deliberately has none either
  const deck = [
    createPage(),
    createPage({ transition: tr("slide", 0.5, "left") }),
    createPage({ transition: tr("push", 1, "up") }),
    createPage({ transition: tr("dissolve", 0.7) }),
    createPage(),
  ];

  it("plays the incoming page's own transition one page forward", () => {
    expect(planTransition(deck, 0, 1)).toEqual({ kind: "slide", direction: "left", seconds: 0.5 });
    expect(planTransition(deck, 1, 2)).toEqual({ kind: "push", direction: "up", seconds: 1 });
    expect(planTransition(deck, 2, 3)).toEqual({ kind: "dissolve", direction: undefined, seconds: 0.7 });
  });

  it("cuts when the incoming page has no transition", () => {
    expect(planTransition(deck, 3, 4)).toBeNull();
  });

  it("plays the transition of the page being left, travelling the other way, one page back", () => {
    expect(planTransition(deck, 2, 1)).toEqual({ kind: "push", direction: "down", seconds: 1 });
    expect(planTransition(deck, 1, 0)).toEqual({ kind: "slide", direction: "right", seconds: 0.5 });
  });

  it("does not borrow the earlier page's transition when the page being left has none", () => {
    expect(planTransition(deck, 4, 3)).toBeNull(); // page 3 has a dissolve, but it leads INTO page 3
  });

  it("leaves non-directional kinds as they are in both directions", () => {
    const flat = [createPage(), createPage({ transition: tr("zoom", 0.7) }), createPage({ transition: tr("fade-black", 1) }), createPage({ transition: tr("dissolve", 0.4) })];
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [1, 0],
      [2, 1],
      [3, 2],
    ]) {
      const plan = planTransition(flat, a, b);
      expect(plan, `${a}->${b}`).not.toBeNull();
      expect(plan!.direction).toBeUndefined();
    }
    expect(planTransition(flat, 2, 1)!.kind).toBe("fade-black");
    expect(planTransition(flat, 2, 1)!.seconds).toBe(1);
  });

  it("ignores a stray direction on a kind that has none", () => {
    const pages = [createPage(), createPage({ transition: tr("dissolve", 0.5, "left") })];
    expect(planTransition(pages, 0, 1)!.direction).toBe("left"); // untouched forwards ...
    expect(planTransition(pages, 1, 0)!.direction).toBe("left"); // ... and backwards: nothing to flip
  });

  it("uses the preset's default direction when none is stored, and flips that one too", () => {
    const pages = [createPage(), createPage({ transition: tr("wipe", 0.7) })];
    expect(planTransition(pages, 0, 1)!.direction).toBe("left");
    expect(planTransition(pages, 1, 0)!.direction).toBe("right");
  });

  it("falls back to the default for a direction it does not know", () => {
    const pages = [createPage(), createPage({ transition: { kind: "slide", duration: 0.5, direction: "sideways" as AnimDirection } })];
    expect(planTransition(pages, 0, 1)!.direction).toBe("left");
  });

  it("plays the destination's transition for jumps, whichever way they go", () => {
    expect(planTransition(deck, 0, 2)).toEqual({ kind: "push", direction: "up", seconds: 1 }); // forward jump
    expect(planTransition(deck, 3, 1)).toEqual({ kind: "slide", direction: "left", seconds: 0.5 }); // backward jump: not reversed
    expect(planTransition(deck, 0, 3)).toEqual({ kind: "dissolve", direction: undefined, seconds: 0.7 }); // End
    expect(planTransition(deck, 0, 4)).toBeNull(); // End onto a page without one
  });

  it("never plays the first page's transition (it has nothing to arrive from)", () => {
    const pages = [createPage({ transition: tr("slide", 0.5, "left") }), createPage(), createPage()];
    expect(planTransition(pages, 2, 0)).toBeNull(); // Home
    expect(planTransition(pages, 1, 0)).toBeNull(); // Prev onto it: the page being left has none
  });

  it("is a cut for no move, an unknown page, 'none', and a missing, zero or broken duration", () => {
    expect(planTransition(deck, 1, 1)).toBeNull();
    expect(planTransition(deck, 0, 9)).toBeNull();
    expect(planTransition(deck, -1, 0)).toBeNull();
    const cuts = [
      createPage(),
      createPage({ transition: null }),
      createPage({ transition: tr("none", 1) }),
      createPage({ transition: tr("slide", 0) }),
      createPage({ transition: tr("slide", -1) }),
      createPage({ transition: tr("slide", Number.NaN) }),
    ];
    for (let i = 1; i < cuts.length; i++) expect(planTransition(cuts, i - 1, i), `page ${i}`).toBeNull();
  });

  it("clamps the duration like the timeline does", () => {
    const pages = [createPage(), createPage({ transition: tr("dissolve", 99) })];
    expect(planTransition(pages, 0, 1)!.seconds).toBe(3);
  });

  it("passes an unknown kind through (the renderer draws it as a dissolve)", () => {
    const pages = [createPage(), createPage({ transition: tr("swirl", 0.5) })];
    expect(planTransition(pages, 0, 1)).toEqual({ kind: "swirl", direction: undefined, seconds: 0.5 });
  });
});

describe("stripExits", () => {
  it("drops exits and keeps entrances and emphasis", () => {
    const el = withAnim({ in: fade(), out: fade(1, 0.5), loop: { kind: "breathe", duration: 2, delay: 0 } });
    const page = createPage({ elements: [el] });
    const held = stripExits(page);
    expect(held.elements[0].animation).toEqual({ in: fade(), loop: { kind: "breathe", duration: 2, delay: 0 } });
  });

  it("leaves the original page and elements alone", () => {
    const el = withAnim({ in: fade(), out: fade() });
    const page = createPage({ elements: [el] });
    const held = stripExits(page);
    expect(held).not.toBe(page);
    expect(page.elements[0]).toBe(el);
    expect(el.animation).toEqual({ in: fade(), out: fade() });
  });

  it("shares every element that has no exit, and the page itself when none has", () => {
    const calm = withAnim({ in: fade() });
    const plain = createShape("rect", { x: 0, y: 0, width: 10, height: 10 });
    const leaving = withAnim({ out: fade() });
    const mixed = createPage({ elements: [calm, plain, leaving] });
    const held = stripExits(mixed);
    expect(held.elements[0]).toBe(calm);
    expect(held.elements[1]).toBe(plain);
    expect(held.elements[2]).not.toBe(leaving);
    const untouched = createPage({ elements: [calm, plain] });
    expect(stripExits(untouched)).toBe(untouched);
  });

  it("removes the animation altogether from an element that only had an exit, so the page is a still picture", () => {
    const page = createPage({ elements: [withAnim({ out: fade() })] });
    expect(pageHasAnimation(page)).toBe(true);
    const held = stripExits(page);
    expect("animation" in held.elements[0]).toBe(false);
    expect(pageHasAnimation(held)).toBe(false);
  });

  it("makes the copy once per page object", () => {
    const page = createPage({ elements: [withAnim({ in: fade(), out: fade() })] });
    const first = stripExits(page);
    for (let i = 0; i < 50; i++) expect(stripExits(page)).toBe(first);
    expect(stripExits({ ...page })).not.toBe(first); // a new page object (an edit) is stripped afresh
  });

  it("tolerates null phases", () => {
    const page = createPage({ elements: [withAnim({ in: fade(), out: null, loop: null })] });
    expect(stripExits(page)).toBe(page);
  });
});

describe("isAnimating", () => {
  it("is false for a page nothing moves on", () => {
    const page = createPage({ elements: [createShape("rect", { x: 0, y: 0, width: 10, height: 10 })] });
    expect(isAnimating(page, 0)).toBe(false);
    expect(isAnimating(page, 30)).toBe(false);
  });

  it("covers an entrance from before it starts until it has finished", () => {
    const page = createPage({ elements: [withAnim({ in: fade(1, 1) })] });
    expect(isAnimating(page, 0)).toBe(true); // waiting, hidden
    expect(isAnimating(page, 1.5)).toBe(true);
    expect(isAnimating(page, 2)).toBe(false);
    expect(isAnimating(page, 9)).toBe(false);
  });

  it("stays true for an emphasis, however long the page is held", () => {
    const page = createPage({ elements: [withAnim({ loop: { kind: "pulse", duration: 1.6, delay: 0 } })] });
    expect(isAnimating(page, 0)).toBe(true);
    expect(isAnimating(page, 12345.6)).toBe(true);
  });

  it("starts again when an exit begins, which a held page never reaches", () => {
    const page = createPage({ duration: 5, elements: [withAnim({ out: fade(0, 1) })] });
    expect(isAnimating(page, 3.9)).toBe(false);
    expect(isAnimating(page, 4.5)).toBe(true);
    expect(isAnimating(page, 5)).toBe(true);
    expect(isAnimating(stripExits(page), 4.5)).toBe(false);
  });

  it("ignores hidden elements and unknown presets", () => {
    const hidden = withAnim({ loop: { kind: "spin", duration: 3, delay: 0 } }, { hidden: true });
    const unknown = withAnim({ in: { kind: "does-not-exist", duration: 1, delay: 0 } });
    expect(isAnimating(createPage({ elements: [hidden, unknown] }), 0)).toBe(false);
  });
});

describe("auto-play", () => {
  // timeline: page 0 [0,4]; transition [4,5] then page 1 [5,11]; page 2 follows with a cut [11,13]
  const pages: Array<Pick<Page, "duration" | "transition">> = [{ duration: 4 }, { duration: 6, transition: tr("dissolve", 1) }, { duration: 2, transition: tr("none", 1) }];

  it("starts at the page's own time 0, not at the transition into it", () => {
    expect(planAutoplay(pages, 0).offset).toBe(0);
    expect(planAutoplay(pages, 1).offset).toBe(5);
    expect(planAutoplay(pages, 2).offset).toBe(11);
    expect(planAutoplay(pages, 99).offset).toBe(11);
    expect(planAutoplay(pages, -3).offset).toBe(0);
  });

  it("drops the transitions from the timeline under reduced motion", () => {
    const plain = planAutoplay(pages, 0, true);
    expect(plain.timeline.total).toBe(12);
    expect(plain.timeline.segments.map((s) => s.transition)).toEqual([0, 0, 0]);
    expect(planAutoplay(pages, 1, true).offset).toBe(4);
    // so no moment of it is a transition
    for (let t = 0; t <= 12; t += 0.25) expect(autoplayAt(plain, t).frame.kind).toBe("page");
  });

  it("walks through pages and transitions in order", () => {
    const plan = planAutoplay(pages, 0);
    expect(autoplayAt(plan, 0)).toEqual({ frame: { kind: "page", page: 0, time: 0 }, done: false });
    expect(autoplayAt(plan, 3.5).frame).toEqual({ kind: "page", page: 0, time: 3.5 });
    expect(autoplayAt(plan, 4.5).frame).toEqual({ kind: "transition", from: 0, to: 1, progress: 0.5 });
    expect(autoplayAt(plan, 5).frame).toEqual({ kind: "page", page: 1, time: 0 });
    expect(autoplayAt(plan, 11).frame).toEqual({ kind: "page", page: 2, time: 0 }); // a cut
    expect(autoplayAt(plan, 12.5)).toEqual({ frame: { kind: "page", page: 2, time: 1.5 }, done: false });
  });

  it("is done once the last page has had its time, and stays on that frame", () => {
    const plan = planAutoplay(pages, 0);
    const end = autoplayAt(plan, 13);
    expect(end).toEqual({ frame: { kind: "page", page: 2, time: 2 }, done: true });
    expect(autoplayAt(plan, 500)).toEqual(end);
  });

  it("plays from the page it was started on", () => {
    const plan = planAutoplay(pages, 1);
    expect(autoplayAt(plan, 0).frame).toEqual({ kind: "page", page: 1, time: 0 });
    expect(autoplayAt(plan, 3).frame).toEqual({ kind: "page", page: 1, time: 3 });
    expect(autoplayAt(plan, 6).frame).toEqual({ kind: "page", page: 2, time: 0 });
    expect(autoplayAt(plan, 8).done).toBe(true);
    const last = planAutoplay(pages, 2);
    expect(autoplayAt(last, 1.9).done).toBe(false);
    expect(autoplayAt(last, 2).done).toBe(true);
  });

  it("treats a negative clock as the start", () => {
    expect(autoplayAt(planAutoplay(pages, 1), -4).frame).toEqual({ kind: "page", page: 1, time: 0 });
  });

  it("reports how far through its time the page on screen is", () => {
    expect(pageProgress({ kind: "page", page: 1, time: 3 }, pages)).toBe(0.5);
    expect(pageProgress({ kind: "page", page: 0, time: 0 }, pages)).toBe(0);
    expect(pageProgress({ kind: "page", page: 0, time: 9 }, pages)).toBe(1);
    expect(pageProgress({ kind: "page", page: 0, time: -1 }, pages)).toBe(0);
    expect(pageProgress({ kind: "page", page: 7, time: 1 }, pages)).toBe(0);
    expect(pageProgress({ kind: "transition", from: 0, to: 1, progress: 0.7 }, pages)).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  ANIMATION_PRESETS,
  DEFAULT_PAGE_DURATION,
  MAX_PAGE_DURATION,
  PAGE_ANIMATION_PRESETS,
  animatableElements,
  animationWindow,
  currentPageAnimation,
  defaultAnimation,
  easeOutBack,
  easeOutBounce,
  easeOutCubic,
  evaluateAnimation,
  getAnimationPreset,
  isBackdrop,
  isHidden,
  pageAnimationFor,
  pageDuration,
  pageHasAnimation,
  presetsFor,
} from "./animation";
import { createDesign, createPage, createShape } from "./factory";
import { useEditor } from "./store";
import { buildTimeline, frameAt, TRANSITION_PRESETS, transitionFrame, transitionSeconds } from "./transition";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const page = (i = 0) => s().design!.pages[i];

describe("easing", () => {
  it("starts at 0 and ends at 1", () => {
    for (const f of [easeOutCubic, easeOutBack, easeOutBounce]) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
  });
  it("overshoots for back and stays within 0..1 for bounce", () => {
    expect(Math.max(...Array.from({ length: 21 }, (_v, i) => easeOutBack(i / 20)))).toBeGreaterThan(1);
    for (let i = 0; i <= 20; i++) expect(easeOutBounce(i / 20)).toBeLessThanOrEqual(1.0001);
  });
});

describe("animation presets", () => {
  it("have unique ids, a label and a sane default duration", () => {
    const ids = ANIMATION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ANIMATION_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.defaultDuration).toBeGreaterThan(0);
      expect(p.defaultDuration).toBeLessThanOrEqual(5);
      expect(p.enter || p.loop, p.id).toBeTruthy();
    }
    expect(presetsFor("in").length).toBeGreaterThanOrEqual(8);
    expect(presetsFor("out").length).toBe(presetsFor("in").length);
    expect(presetsFor("loop").length).toBeGreaterThanOrEqual(4);
  });

  it("start (nearly) invisible and finish at rest", () => {
    for (const p of presetsFor("in")) {
      const start = evaluateAnimation({ in: defaultAnimation(p.id, "in") }, 0, 5);
      expect(start, `${p.id} at the start`).not.toBeNull();
      const faint = isHidden(start!) || start!.opacity <= 0.1 || start!.clip !== null;
      expect(faint, `${p.id} should hide the element at the start`).toBe(true);
      // after the entrance there is nothing left to apply
      expect(evaluateAnimation({ in: defaultAnimation(p.id, "in") }, 5, 5), `${p.id} at the end`).toBeNull();
    }
  });

  it("move in the direction they are told to", () => {
    const right = evaluateAnimation({ in: { kind: "pan", duration: 1, delay: 0, direction: "right" } }, 0.2, 5)!;
    const left = evaluateAnimation({ in: { kind: "pan", duration: 1, delay: 0, direction: "left" } }, 0.2, 5)!;
    const up = evaluateAnimation({ in: { kind: "rise", duration: 1, delay: 0, direction: "up" } }, 0.2, 5)!;
    expect(right.dx).toBeLessThan(0); // arrives from the left
    expect(left.dx).toBeGreaterThan(0);
    expect(up.dy).toBeGreaterThan(0); // arrives from below
  });

  it("fade in grows monotonically", () => {
    let last = -1;
    for (let i = 0; i <= 10; i++) {
      const st = evaluateAnimation({ in: { kind: "fade", duration: 1, delay: 0 } }, i / 10, 5);
      const o = st ? st.opacity : 1;
      expect(o).toBeGreaterThanOrEqual(last - 1e-9);
      last = o;
    }
  });
});

describe("evaluateAnimation", () => {
  it("is null for elements without animation", () => {
    expect(evaluateAnimation(undefined, 1, 5)).toBeNull();
    expect(evaluateAnimation({}, 1, 5)).toBeNull();
    expect(evaluateAnimation({ in: null, out: null, loop: null }, 1, 5)).toBeNull();
  });

  it("holds the first frame until the delay is over", () => {
    const anim = { in: { kind: "fade", duration: 1, delay: 2 } };
    expect(evaluateAnimation(anim, 0, 5)!.opacity).toBe(0);
    expect(evaluateAnimation(anim, 2, 5)!.opacity).toBe(0);
    expect(evaluateAnimation(anim, 2.5, 5)!.opacity).toBeGreaterThan(0.3);
    expect(evaluateAnimation(anim, 3, 5)).toBeNull();
  });

  it("plays an exit at the end of the page, counted back from the end", () => {
    const anim = { out: { kind: "fade", duration: 1, delay: 0 } };
    expect(animationWindow(anim.out, "out", 5)).toEqual({ start: 4, end: 5 });
    expect(evaluateAnimation(anim, 3.9, 5)).toBeNull();
    expect(evaluateAnimation(anim, 4.5, 5)!.opacity).toBeCloseTo(0.5, 1);
    expect(evaluateAnimation(anim, 5, 5)!.opacity).toBe(0);
    const late = { out: { kind: "fade", duration: 1, delay: 1 } };
    expect(animationWindow(late.out, "out", 5)).toEqual({ start: 3, end: 4 });
    expect(evaluateAnimation(late, 4.5, 5)!.opacity).toBe(0); // gone until the page ends
  });

  it("repeats an emphasis every cycle", () => {
    const anim = { loop: { kind: "breathe", duration: 2, delay: 0 } };
    const at = (t: number) => evaluateAnimation(anim, t, 10)!.scale;
    expect(at(0)).toBeCloseTo(1, 6);
    expect(at(0.5)).toBeGreaterThan(1.03);
    expect(at(1.5)).toBeLessThan(0.97);
    expect(at(2.5)).toBeCloseTo(at(0.5), 6);
  });

  it("combines an entrance, an exit and an emphasis", () => {
    const anim = { in: { kind: "fade", duration: 1, delay: 0 }, out: { kind: "fade", duration: 1, delay: 0 }, loop: { kind: "float", duration: 2, delay: 0 } };
    const mid = evaluateAnimation(anim, 2.5, 5)!; // only the emphasis is active
    expect(mid.opacity).toBe(1);
    expect(mid.dy).not.toBe(0);
    expect(evaluateAnimation(anim, 0.25, 5)!.opacity).toBeLessThan(0.5);
  });

  it("types text out in order and wipes everything else", () => {
    const st = evaluateAnimation({ in: { kind: "typewriter", duration: 2, delay: 0 } }, 1, 5)!;
    expect(st.reveal).toBeCloseTo(0.5, 6);
    expect(getAnimationPreset("typewriter")!.textFriendly).toBe(true);
  });

  it("ignores an unknown preset", () => {
    expect(evaluateAnimation({ in: { kind: "does-not-exist", duration: 1, delay: 0 } }, 0, 5)).toBeNull();
  });
});

describe("page timing", () => {
  it("defaults to five seconds and clamps", () => {
    expect(pageDuration({})).toBe(DEFAULT_PAGE_DURATION);
    expect(pageDuration({ duration: 0.2 })).toBe(1);
    expect(pageDuration({ duration: 900 })).toBe(MAX_PAGE_DURATION);
    expect(pageDuration({ duration: 12 })).toBe(12);
  });
});

describe("page animations", () => {
  const design = { width: 1000, height: 600 };
  const els = () => [
    createShape("rect", { id: "bg", x: 0, y: 0, width: 1000, height: 600 }),
    createShape("rect", { id: "a", x: 10, y: 10, width: 100, height: 100 }),
    createShape("rect", { id: "locked", x: 10, y: 10, width: 100, height: 100, locked: true }),
    createShape("rect", { id: "b", x: 200, y: 10, width: 100, height: 100 }),
  ];

  it("leaves the backdrop, locked and hidden elements alone", () => {
    expect(isBackdrop(els()[0], design)).toBe(true);
    expect(animatableElements({ elements: els() }, design).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("staggers the entrances from the bottom of the stack up", () => {
    const rise = PAGE_ANIMATION_PRESETS.find((p) => p.id === "rise")!;
    const first = pageAnimationFor(rise, 0).in!;
    const third = pageAnimationFor(rise, 2).in!;
    expect(first.delay).toBe(0);
    expect(third.delay).toBeCloseTo(rise.stagger * 2, 5);
    expect(pageAnimationFor(rise, 500).in!.delay).toBeLessThanOrEqual(2); // never makes the page wait forever
  });

  it("recognises the preset a page currently uses", () => {
    const pg = { elements: els() };
    expect(currentPageAnimation(pg, design)).toBeNull();
    const pop = PAGE_ANIMATION_PRESETS.find((p) => p.id === "pop")!;
    animatableElements(pg, design).forEach((el, i) => (el.animation = pageAnimationFor(pop, i)));
    expect(currentPageAnimation(pg, design)?.id).toBe("pop");
    expect(pageHasAnimation(pg)).toBe(true);
  });
});

describe("transitions", () => {
  it("have unique ids", () => {
    const ids = TRANSITION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("start on the old page and end on the new one", () => {
    for (const { id } of TRANSITION_PRESETS) {
      const start = transitionFrame(id, 0, "left");
      const end = transitionFrame(id, 1, "left");
      // at the end the new page is fully there: opaque, in place, not clipped
      expect(end.to.opacity, id).toBeCloseTo(1, 5);
      expect(end.to.dx, id).toBeCloseTo(0, 5);
      expect(end.to.dy, id).toBeCloseTo(0, 5);
      expect(end.to.scale, id).toBeCloseTo(1, 5);
      if (end.to.clip) expect(end.to.clip).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
      // at the start the new page cannot be seen
      const unseen =
        start.to.opacity <= 0.001 ||
        Math.abs(start.to.dx) >= 0.999 ||
        Math.abs(start.to.dy) >= 0.999 ||
        (!!start.to.clip && (start.to.clip.x1 - start.to.clip.x0 <= 0.001 || start.to.clip.y1 - start.to.clip.y0 <= 0.001));
      expect(unseen, `${id} at the start`).toBe(true);
    }
  });

  it("slides in from the side it is told to", () => {
    expect(transitionFrame("slide", 0.2, "left").to.dx).toBeGreaterThan(0); // arrives from the right
    expect(transitionFrame("slide", 0.2, "right").to.dx).toBeLessThan(0);
    expect(transitionFrame("slide", 0.2, "up").to.dy).toBeGreaterThan(0);
  });

  it("pushes the old page out while the new one comes in", () => {
    const mid = transitionFrame("push", 0.5, "left");
    expect(mid.from.dx).toBeLessThan(0);
    expect(mid.to.dx).toBeGreaterThan(0);
    expect(mid.to.dx - mid.from.dx).toBeCloseTo(1, 5); // they stay edge to edge
  });
});

describe("timeline", () => {
  const pages = [{ duration: 4 }, { duration: 6, transition: { kind: "dissolve", duration: 1 } }, { transition: { kind: "none", duration: 1 } }];

  it("puts the transition before the page it leads into", () => {
    const tl = buildTimeline(pages);
    expect(tl.segments.map((x) => [x.start, x.playStart, x.end])).toEqual([
      [0, 0, 4],
      [4, 5, 11],
      [11, 11, 16],
    ]);
    expect(tl.total).toBe(16);
  });

  it("finds the frame at any second", () => {
    const tl = buildTimeline(pages);
    expect(frameAt(tl, 0)).toEqual({ kind: "page", page: 0, time: 0 });
    expect(frameAt(tl, 3)).toEqual({ kind: "page", page: 0, time: 3 });
    expect(frameAt(tl, 4.5)).toEqual({ kind: "transition", from: 0, to: 1, progress: 0.5 });
    expect(frameAt(tl, 5)).toEqual({ kind: "page", page: 1, time: 0 });
    expect(frameAt(tl, 12)).toEqual({ kind: "page", page: 2, time: 1 });
    expect(frameAt(tl, 999)).toEqual({ kind: "page", page: 2, time: 5 });
    expect(frameAt(tl, -3)).toEqual({ kind: "page", page: 0, time: 0 });
  });

  it("ignores a transition on the first page and a cut", () => {
    expect(transitionSeconds({ transition: { kind: "dissolve", duration: 1 } }, false)).toBe(0);
    expect(transitionSeconds({ transition: { kind: "none", duration: 1 } }, true)).toBe(0);
    expect(transitionSeconds({ transition: { kind: "dissolve", duration: 99 } }, true)).toBe(3);
  });
});

describe("animation actions in the editor store", () => {
  beforeEach(() => {
    const p1 = createPage({
      elements: [
        createShape("rect", { id: "bg", x: 0, y: 0, width: 1000, height: 600 }),
        createShape("rect", { id: "r1", x: 100, y: 100, width: 100, height: 100 }),
        createShape("rect", { id: "r2", x: 400, y: 100, width: 100, height: 100 }),
      ],
    });
    a().openDesign(createDesign({ width: 1000, height: 600, pages: [p1, createPage({}), createPage({})] }));
  });

  it("sets, tweaks and clears one phase of an element's animation", () => {
    a().setAnimation(["r1"], "in", defaultAnimation("rise", "in"));
    a().setAnimation(["r1"], "loop", defaultAnimation("breathe", "loop"));
    expect(page().elements[1].animation?.in?.kind).toBe("rise");
    expect(page().elements[1].animation?.loop?.kind).toBe("breathe");
    a().patchAnimation(["r1"], "in", { duration: 1.5, direction: "left" });
    expect(page().elements[1].animation?.in).toMatchObject({ kind: "rise", duration: 1.5, direction: "left" });
    a().setAnimation(["r1"], "in", null);
    expect(page().elements[1].animation?.in).toBeUndefined();
    a().setAnimation(["r1"], "loop", null);
    expect(page().elements[1].animation).toBeUndefined();
  });

  it("merges slider scrubbing into one undo step and undoes cleanly", () => {
    a().setAnimation(["r1"], "in", defaultAnimation("fade", "in"));
    const before = s().past.length;
    for (const v of [0.8, 0.9, 1.1, 1.3]) a().patchAnimation(["r1"], "in", { duration: v });
    expect(s().past.length).toBe(before + 1);
    expect(page().elements[1].animation?.in?.duration).toBe(1.3);
    a().undo();
    expect(page().elements[1].animation?.in?.duration).toBe(defaultAnimation("fade", "in").duration);
  });

  it("will not animate a locked element", () => {
    a().setLocked(["r2"], true);
    a().setAnimation(["r2"], "in", defaultAnimation("pop", "in"));
    expect(page().elements[2].animation).toBeUndefined();
  });

  it("applies a page animation to everything but the backdrop, and removes it again", () => {
    a().setPageAnimation("rise");
    expect(page().elements[0].animation).toBeUndefined();
    expect(page().elements[1].animation?.in).toMatchObject({ kind: "rise", delay: 0 });
    expect(page().elements[2].animation?.in?.delay).toBeGreaterThan(0);
    expect(currentPageAnimation(page(), s().design!)?.id).toBe("rise");
    a().setPageAnimation(null);
    expect(page().elements.every((e) => !e.animation)).toBe(true);
  });

  it("keeps an exit when a page animation is cleared", () => {
    a().setAnimation(["r1"], "out", defaultAnimation("fade", "out"));
    a().setPageAnimation("pop");
    a().setPageAnimation(null);
    expect(page().elements[1].animation).toEqual({ out: defaultAnimation("fade", "out") });
  });

  it("sets a transition on one page or on every page but the first", () => {
    const pageId = page(1).id;
    a().setPageTransition({ kind: "push", duration: 0.5, direction: "up" }, "page", pageId);
    expect(page(1).transition).toEqual({ kind: "push", duration: 0.5, direction: "up" });
    expect(page(2).transition).toBeUndefined();
    a().setPageTransition({ kind: "dissolve", duration: 0.7 }, "all");
    expect(page(0).transition).toBeUndefined();
    expect(page(1).transition?.kind).toBe("dissolve");
    expect(page(2).transition?.kind).toBe("dissolve");
    a().setPageTransition(null, "all");
    expect(page(1).transition).toBeUndefined();
  });

  it("sets and clamps the page duration", () => {
    a().setPageDuration(8);
    expect(page(0).duration).toBe(8);
    a().setPageDuration(0.1);
    expect(page(0).duration).toBe(1);
    a().setPageDuration(7, "all");
    expect(s().design!.pages.map((p) => p.duration)).toEqual([7, 7, 7]);
  });

  it("copies animation, duration and transition with a duplicated element or page", () => {
    a().setAnimation(["r1"], "in", defaultAnimation("zoom", "in"));
    a().select(["r1"]);
    a().duplicateSelection();
    const copies = page().elements.filter((e) => e.animation?.in?.kind === "zoom");
    expect(copies).toHaveLength(2);
    a().setPageDuration(9);
    a().setPageTransition({ kind: "wipe", duration: 0.6, direction: "right" });
    a().duplicatePage(page(0).id);
    expect(page(1).duration).toBe(9);
    expect(page(1).elements.some((e) => e.animation?.in?.kind === "zoom")).toBe(true);
  });
});

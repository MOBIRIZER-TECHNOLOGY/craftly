import { describe, expect, it } from "vitest";
import {
  ANIMATION_PRESETS,
  PAGE_ANIMATION_PRESETS,
  animatableElements,
  animationWindow,
  currentPageAnimation,
  defaultAnimation,
  evaluateAnimation,
  getAnimationPreset,
  getPageAnimationPreset,
  identityState,
  isAnimated,
  isBackdrop,
  isHidden,
  pageAnimationFor,
  pageDuration,
  pageHasAnimation,
  presetsFor,
} from "./animation";
import { createPage, createShape } from "./factory";
import type { AnimDirection, ElementAnimations } from "./types";

const enter = (id: string, p: number, d: AnimDirection = "right") => getAnimationPreset(id)!.enter!(p, d);
const loop = (id: string, t: number, duration = 4) => evaluateAnimation({ loop: { kind: id, duration, delay: 0 } }, t, 10)!;

describe("page length", () => {
  it("defaults to five seconds and stays between one and sixty", () => {
    expect(pageDuration({})).toBe(5);
    expect(pageDuration({ duration: Number.NaN })).toBe(5);
    expect(pageDuration({ duration: 0 })).toBe(1);
    expect(pageDuration({ duration: 600 })).toBe(60);
    expect(pageDuration({ duration: 12.5 })).toBe(12.5);
  });
});

describe("hidden states", () => {
  it("is hidden when nothing of the element can be seen", () => {
    expect(isHidden(identityState())).toBe(false);
    expect(isHidden({ ...identityState(), opacity: 0.001 })).toBe(true);
    expect(isHidden({ ...identityState(), opacity: 0.5 })).toBe(false);
    expect(isHidden({ ...identityState(), scale: 0.001 })).toBe(true);
    expect(isHidden({ ...identityState(), reveal: 0 })).toBe(true);
    expect(isHidden({ ...identityState(), reveal: 0.1 })).toBe(false);
    expect(isHidden({ ...identityState(), clip: { x0: 0.5, y0: 0, x1: 0.5, y1: 1 } })).toBe(true);
    expect(isHidden({ ...identityState(), clip: { x0: 0, y0: 0.7, x1: 1, y1: 0.2 } })).toBe(true);
    expect(isHidden({ ...identityState(), clip: { x0: 0, y0: 0, x1: 1, y1: 1 } })).toBe(false);
  });
});

describe("entrance presets", () => {
  it.each<[AnimDirection, "dx" | "dy", number]>([
    ["up", "dy", 0.07],
    ["down", "dy", -0.07],
    ["left", "dx", 0.07],
    ["right", "dx", -0.07],
  ])("rises from the %s side", (direction, axis, start) => {
    const state = enter("rise", 0, direction);
    expect(state[axis]).toBeCloseTo(start);
    expect(enter("rise", 1, direction)[axis] ?? 0).toBeCloseTo(0);
  });

  it("wipes with a window that opens along the direction of travel", () => {
    const e = 0.875; // easeOutCubic at the half way point
    expect(enter("wipe", 0.5, "left").clip).toEqual({ x0: 1 - e, y0: -0.5, x1: 1.5, y1: 1.5 });
    expect(enter("wipe", 0.5, "right").clip).toEqual({ x0: -0.5, y0: -0.5, x1: e, y1: 1.5 });
    expect(enter("wipe", 0.5, "down").clip).toEqual({ x0: -0.5, y0: -0.5, x1: 1.5, y1: e });
    expect(enter("wipe", 0.5, "up").clip).toEqual({ x0: -0.5, y0: 1 - e, x1: 1.5, y1: 1.5 });
  });

  it("slides the content inside a fixed window", () => {
    const state = enter("slide", 0.5, "left");
    expect(state.clip).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(state.innerDx).toBeCloseTo(0.125);
    expect(enter("slide", 0.5, "down").innerDy).toBeCloseTo(-0.125);
  });

  it("flickers on and off, then settles on for the last part of the entrance", () => {
    const opacities = Array.from({ length: 80 }, (_, i) => enter("flicker", i / 100).opacity as number);
    expect(opacities).toContain(0.06);
    expect(opacities.some((o) => o > 0.06)).toBe(true);
    expect(enter("flicker", 0.86).opacity).toBeCloseTo(1);
    expect(enter("flicker", 1).opacity).toBe(1);
  });

  it("types text out letter by letter", () => {
    expect(enter("typewriter", 0.4)).toEqual({ reveal: 0.4 });
    expect(getAnimationPreset("typewriter")?.textFriendly).toBe(true);
  });
});

describe("emphasis presets", () => {
  it("breathes in and out", () => {
    expect(loop("breathe", 1).scale).toBeCloseTo(1.05);
    expect(loop("breathe", 3).scale).toBeCloseTo(0.95);
  });

  it("pulses between a faint and a full opacity", () => {
    expect(loop("pulse", 1).opacity).toBeCloseTo(1);
    expect(loop("pulse", 3).opacity).toBeCloseTo(0.7);
  });

  it("floats up and down", () => {
    expect(loop("float", 1).dy).toBeCloseTo(0.014);
    expect(loop("float", 3).dy).toBeCloseTo(-0.014);
  });

  it("wiggles from side to side", () => {
    expect(loop("wiggle", 0.5).rotate).toBeCloseTo(4);
    expect(loop("wiggle", 1.5).rotate).toBeCloseTo(-4);
  });

  it("spins once per cycle", () => {
    expect(loop("spin", 1).rotate).toBeCloseTo(90);
    expect(loop("spin", 2).rotate).toBeCloseTo(180);
    expect(loop("spin", 4).rotate).toBeCloseTo(0);
  });

  it("flashes between full and faint", () => {
    expect(loop("flash", 1).opacity).toBe(1);
    expect(loop("flash", 3).opacity).toBe(0.2);
  });

  it("repeats for as long as the page is shown, also before time zero", () => {
    expect(loop("spin", 5).rotate).toBeCloseTo(90);
    expect(loop("spin", -1).rotate).toBeCloseTo(270);
  });

  it("never cycles faster than ten times a second", () => {
    expect(loop("spin", 0.05, 0).rotate).toBeCloseTo(180);
  });
});

describe("evaluateAnimation", () => {
  it("answers null when there is no animation or nothing is animated at that moment", () => {
    expect(evaluateAnimation(null, 1, 5)).toBeNull();
    expect(evaluateAnimation(undefined, 1, 5)).toBeNull();
    expect(evaluateAnimation({}, 1, 5)).toBeNull();
    expect(evaluateAnimation({ in: { kind: "fade", duration: 1, delay: 0 } }, 2, 5)).toBeNull();
    expect(evaluateAnimation({ out: { kind: "fade", duration: 1, delay: 0 } }, 2, 5)).toBeNull();
  });

  it("ignores presets that do not exist or are for another phase", () => {
    expect(evaluateAnimation({ in: { kind: "bogus", duration: 1, delay: 0 } }, 0.5, 5)).toBeNull();
    expect(evaluateAnimation({ in: { kind: "spin", duration: 1, delay: 0 } }, 0.5, 5)).toBeNull();
    expect(evaluateAnimation({ loop: { kind: "fade", duration: 1, delay: 0 } }, 0.5, 5)).toBeNull();
    expect(evaluateAnimation({ out: null, in: null, loop: null }, 0.5, 5)).toBeNull();
  });

  it("falls back to the preset's own direction, or to the right, when none is set", () => {
    const rise = evaluateAnimation({ in: { kind: "rise", duration: 1, delay: 0 } }, 0, 5)!;
    expect(rise.dy).toBeGreaterThan(0);
    const wipe = evaluateAnimation({ in: { kind: "wipe", duration: 1, delay: 0 } }, 0.5, 5)!;
    expect(wipe.clip!.x0).toBe(-0.5);
    const fade = evaluateAnimation({ in: { kind: "fade", duration: 1, delay: 0 } }, 0.5, 5)!;
    expect(fade.opacity).toBeCloseTo(0.5);
  });

  it("treats a zero length animation as a switch", () => {
    const before = evaluateAnimation({ in: { kind: "fade", duration: 0, delay: 1 } }, 0.5, 5)!;
    expect(before.opacity).toBe(0);
    expect(evaluateAnimation({ in: { kind: "fade", duration: 0, delay: 1 } }, 1, 5)).toBeNull();
    const exit: ElementAnimations = { out: { kind: "fade", duration: 0, delay: 0 } };
    expect(evaluateAnimation(exit, 3.9, 4)).toBeNull();
    expect(evaluateAnimation(exit, 4, 4)!.opacity).toBe(0);
  });

  it("combines an entrance with an emphasis that is running at the same time", () => {
    const state = evaluateAnimation({ in: { kind: "fade", duration: 2, delay: 0 }, loop: { kind: "spin", duration: 4, delay: 0 } }, 1, 5)!;
    expect(state.opacity).toBeCloseTo(0.5);
    expect(state.rotate).toBeCloseTo(90);
  });

  it("combines windows and reveals of overlapping entrance and exit", () => {
    const state = evaluateAnimation({ in: { kind: "typewriter", duration: 4, delay: 0 }, out: { kind: "typewriter", duration: 4, delay: 0 } }, 2, 4)!;
    // both reveal the text: the one that has shown less wins
    expect(state.reveal).toBeCloseTo(0.5);
    const clipped = evaluateAnimation({ in: { kind: "wipe", duration: 4, delay: 0, direction: "right" }, out: { kind: "wipe", duration: 4, delay: 0, direction: "down" } }, 2, 4)!;
    expect(clipped.clip!.x1).toBeCloseTo(0.875);
    expect(clipped.clip!.y1).toBeCloseTo(0.875);
    expect(clipped.clip!.x0).toBe(-0.5);
  });

  it("keeps the window and the typed reveal of an entrance while an emphasis runs on top", () => {
    const wiping = evaluateAnimation({ in: { kind: "wipe", duration: 4, delay: 0, direction: "right" }, loop: { kind: "breathe", duration: 4, delay: 0 } }, 1, 10)!;
    expect(wiping.clip).toEqual({ x0: -0.5, y0: -0.5, x1: 1 - (1 - 0.25) ** 3, y1: 1.5 });
    expect(wiping.scale).toBeCloseTo(1.05);
    const typing = evaluateAnimation({ in: { kind: "typewriter", duration: 4, delay: 0 }, loop: { kind: "pulse", duration: 4, delay: 0 } }, 1, 10)!;
    expect(typing.reveal).toBeCloseTo(0.25);
    expect(typing.opacity).toBeCloseTo(1);
  });

  it("works out the window of an exit from the end of the page", () => {
    expect(animationWindow({ kind: "fade", duration: 1, delay: 0.5 }, "in", 10)).toEqual({ start: 0.5, end: 1.5 });
    expect(animationWindow({ kind: "fade", duration: 1, delay: 0.5 }, "out", 10)).toEqual({ start: 8.5, end: 9.5 });
  });
});

describe("presets and defaults", () => {
  it("lists the presets of each phase", () => {
    expect(presetsFor("loop").map((p) => p.id)).toEqual(["breathe", "pulse", "float", "wiggle", "spin", "flash"]);
    expect(presetsFor("in")).toHaveLength(11);
    expect(presetsFor("out")).toEqual(presetsFor("in"));
    expect(ANIMATION_PRESETS.every((p) => (p.phases.includes("loop") ? !!p.loop : !!p.enter))).toBe(true);
  });

  it("starts an animation with the preset's own duration and direction", () => {
    expect(defaultAnimation("rise", "in")).toEqual({ kind: "rise", duration: 0.8, delay: 0, direction: "up" });
    expect(defaultAnimation("fade", "out")).toEqual({ kind: "fade", duration: 0.7, delay: 0 });
    expect(defaultAnimation("spin", "loop")).toEqual({ kind: "spin", duration: 3, delay: 0 });
  });

  it("uses a sensible length for a preset it does not know", () => {
    expect(defaultAnimation("mystery", "in")).toEqual({ kind: "mystery", duration: 0.8, delay: 0 });
    expect(defaultAnimation("mystery", "loop")).toEqual({ kind: "mystery", duration: 2, delay: 0 });
  });

  it("knows whether an element or a page is animated", () => {
    expect(isAnimated({})).toBe(false);
    expect(isAnimated({ animation: {} })).toBe(false);
    expect(isAnimated({ animation: { in: null, out: null, loop: null } })).toBe(false);
    expect(isAnimated({ animation: { loop: { kind: "spin", duration: 1, delay: 0 } } })).toBe(true);
    expect(pageHasAnimation(createPage({ elements: [createShape("rect")] }))).toBe(false);
    expect(pageHasAnimation(createPage({ elements: [createShape("rect"), createShape("rect", { animation: { out: { kind: "fade", duration: 1, delay: 0 } } })] }))).toBe(true);
  });
});

describe("page animations", () => {
  const design = { width: 1000, height: 1000 };

  it("finds the preset by id", () => {
    expect(getPageAnimationPreset("cascade")).toMatchObject({ kind: "slide", direction: "up" });
    expect(getPageAnimationPreset("nope")).toBeUndefined();
    expect(PAGE_ANIMATION_PRESETS.map((p) => p.id)).toContain("rise");
  });

  it("staggers the entrances, capped at two seconds and rounded to hundredths", () => {
    const rise = getPageAnimationPreset("rise")!;
    expect(pageAnimationFor(rise, 0)).toEqual({ in: { kind: "rise", duration: 0.8, delay: 0, direction: "up" } });
    expect(pageAnimationFor(rise, 3).in?.delay).toBe(0.42);
    expect(pageAnimationFor(rise, 50).in?.delay).toBe(2);
    expect(pageAnimationFor(getPageAnimationPreset("fade")!, 1)).toEqual({ in: { kind: "fade", duration: 0.7, delay: 0.1 } });
  });

  it("calls a nearly page sized element a backdrop", () => {
    expect(isBackdrop({ width: 1000, height: 850 }, design)).toBe(true);
    expect(isBackdrop({ width: 1000, height: 849 }, design)).toBe(false);
  });

  it("animates the visible, unlocked elements that are not backdrops", () => {
    const page = createPage({
      elements: [
        createShape("rect", { id: "bg", width: 1000, height: 1000 }),
        createShape("rect", { id: "a", width: 100, height: 100 }),
        createShape("rect", { id: "hidden", width: 100, height: 100, hidden: true }),
        createShape("rect", { id: "locked", width: 100, height: 100, locked: true }),
        createShape("rect", { id: "b", width: 100, height: 100 }),
      ],
    });
    expect(animatableElements(page, design).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("recognises the page animation every element shares", () => {
    const page = createPage({
      elements: [
        createShape("rect", { width: 100, height: 100, animation: pageAnimationFor(getPageAnimationPreset("pop")!, 0) }),
        createShape("rect", { width: 100, height: 100, animation: pageAnimationFor(getPageAnimationPreset("pop")!, 1) }),
      ],
    });
    expect(currentPageAnimation(page, design)?.id).toBe("pop");
  });

  it("recognises no page animation for mixed or missing animations, or for an empty page", () => {
    const mixed = createPage({
      elements: [
        createShape("rect", { width: 100, height: 100, animation: pageAnimationFor(getPageAnimationPreset("pop")!, 0) }),
        createShape("rect", { width: 100, height: 100, animation: pageAnimationFor(getPageAnimationPreset("fade")!, 1) }),
      ],
    });
    expect(currentPageAnimation(mixed, design)).toBeNull();
    expect(currentPageAnimation(createPage({ elements: [createShape("rect", { width: 100, height: 100 })] }), design)).toBeNull();
    expect(currentPageAnimation(createPage(), design)).toBeNull();
    expect(currentPageAnimation(createPage({ elements: [createShape("rect", { width: 1000, height: 1000 })] }), design)).toBeNull();
  });

  it("tells presets apart by direction as well as kind", () => {
    const page = createPage({ elements: [createShape("rect", { width: 100, height: 100, animation: { in: { kind: "rise", duration: 0.8, delay: 0, direction: "down" } } })] });
    expect(currentPageAnimation(page, design)).toBeNull();
  });
});

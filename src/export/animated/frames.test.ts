import { describe, expect, it } from "vitest";
import { defaultAnimation } from "@/core/animation";
import { createDesign, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import type { Design, DesignElement, ElementAnimations, Fill, Page } from "@/core/types";
import { buildTimeline } from "@/core/transition";
import type { ExportOptions } from "../exporters";
import { estimateExportBytes, weighPage } from "../options";
import {
  ANIM_RESOLUTIONS,
  DEFAULT_GIF_FPS,
  GIF_MAX_FRAMES,
  MAX_OUTPUT_SIDE,
  VIDEO_FPS,
  VIDEO_MAX_SECONDS,
  animationProblem,
  estimateGifBytes,
  estimateWebmBytes,
  formatDuration,
  frameDelays,
  frameTime,
  isAnimatedFormat,
  normalizeFps,
  normalizeResolution,
  outputSize,
  pageMotion,
  paletteSampleFrames,
  planAnimation,
  planFrames,
  sampleFrameIndices,
  videoBitrate,
  type AnimResolution,
  type AnimationPlan,
} from "./frames";

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe("choices", () => {
  it("snaps a resolution to the nearest preset and falls back to 720p", () => {
    expect(normalizeResolution(480)).toBe(480);
    expect(normalizeResolution(1080)).toBe(1080);
    expect(normalizeResolution(1000)).toBe(1080);
    expect(normalizeResolution(2160)).toBe(1080);
    expect(normalizeResolution(10)).toBe(480);
    for (const bad of [undefined, null, "720", Number.NaN, Infinity, {}]) expect(normalizeResolution(bad), String(bad)).toBe(720);
  });

  it("fixes a video at 30 fps and keeps a GIF between 1 and 30", () => {
    expect(normalizeFps("webm", 5)).toBe(VIDEO_FPS);
    expect(normalizeFps("webm", undefined)).toBe(30);
    expect(normalizeFps("gif", 10)).toBe(10);
    expect(normalizeFps("gif", 14.6)).toBe(15);
    expect(normalizeFps("gif", 999)).toBe(30);
    expect(normalizeFps("gif", 0)).toBe(1);
    expect(normalizeFps("gif", "20")).toBe(DEFAULT_GIF_FPS);
    expect(normalizeFps("gif", Number.NaN)).toBe(DEFAULT_GIF_FPS);
  });

  it("recognises the animated formats", () => {
    expect(isAnimatedFormat("gif")).toBe(true);
    expect(isAnimatedFormat("webm")).toBe(true);
    expect(isAnimatedFormat("png")).toBe(false);
    expect(isAnimatedFormat("mp4")).toBe(false);
  });
});

describe("outputSize", () => {
  it("gives the shorter side the preset's length", () => {
    expect(outputSize(1920, 1080, 480)).toMatchObject({ width: 854, height: 480 });
    expect(outputSize(1920, 1080, 720)).toMatchObject({ width: 1280, height: 720 });
    expect(outputSize(1920, 1080, 1080)).toMatchObject({ width: 1920, height: 1080 });
    expect(outputSize(1080, 1080, 480)).toMatchObject({ width: 480, height: 480 });
    expect(outputSize(1080, 1920, 720)).toMatchObject({ width: 720, height: 1280 });
    expect(outputSize(1080, 1920, 1080)).toMatchObject({ width: 1080, height: 1920 });
  });

  it("scales small designs up (the renderer is vector) and large ones down", () => {
    expect(outputSize(400, 300, 720)).toMatchObject({ width: 960, height: 720 });
    expect(outputSize(5000, 2812, 720)).toMatchObject({ width: 1280, height: 720 });
  });

  it("caps the longer side at 1920 and keeps the aspect ratio", () => {
    const banner = outputSize(4000, 500, 1080);
    expect(banner).toMatchObject({ width: 1920, height: 240 });
    const tall = outputSize(500, 4000, 1080);
    expect(tall.height).toBe(1920);
    expect(tall.width).toBe(240);
  });

  it("reports the scale the renderer will derive from the width", () => {
    const s = outputSize(1920, 1080, 720);
    expect(s.scale).toBeCloseTo(1280 / 1920, 10);
  });

  it("always yields even sides of at most 1920, whatever the design", () => {
    const sizes = [1, 7, 11, 100, 333, 640, 1080, 1280, 1920, 4000, 10000];
    for (const w of sizes) {
      for (const h of sizes) {
        for (const r of ANIM_RESOLUTIONS) {
          const o = outputSize(w, h, r);
          const label = `${w}x${h} @${r}`;
          expect(o.width % 2, label).toBe(0);
          expect(o.height % 2, label).toBe(0);
          expect(o.width, label).toBeLessThanOrEqual(MAX_OUTPUT_SIDE);
          expect(o.height, label).toBeLessThanOrEqual(MAX_OUTPUT_SIDE);
          expect(o.width, label).toBeGreaterThanOrEqual(2);
          expect(o.height, label).toBeGreaterThanOrEqual(2);
          // the picture is within a pixel of the design's shape (the renderer paints the page at width / designWidth);
          // a sliver more than 900 times longer than wide cannot keep it, a side stops at 2 px
          if (o.width > 2 && o.height > 2) expect(Math.abs(o.height - (o.width * h) / w), label).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe("planFrames and frameDelays", () => {
  it("makes round(seconds x fps) frames", () => {
    expect(planFrames(12, 15)).toEqual({ fps: 15, total: 12, count: 180 });
    expect(planFrames(5, 10).count).toBe(50);
    expect(planFrames(5.3, 15).count).toBe(80);
    expect(planFrames(0.01, 10).count).toBe(1);
  });

  it("makes no frames for an empty timeline and survives junk", () => {
    expect(planFrames(0, 15).count).toBe(0);
    expect(planFrames(-3, 15).count).toBe(0);
    expect(planFrames(Number.NaN, 15).count).toBe(0);
    expect(planFrames(4, Number.NaN).fps).toBe(DEFAULT_GIF_FPS);
    expect(frameDelays(planFrames(0, 15))).toEqual([]);
  });

  it("shows frame i at i / fps and never past the end", () => {
    const plan = planFrames(12, 15);
    expect(frameTime(plan, 0)).toBe(0);
    expect(frameTime(plan, 15)).toBe(1);
    expect(frameTime(plan, plan.count - 1)).toBeCloseTo(179 / 15, 10);
    expect(frameTime(plan, 10_000)).toBe(12);
    expect(frameTime(plan, -4)).toBe(0);
  });

  it("accumulates the rounding so the delays always add up to the true duration", () => {
    const delays = frameDelays(planFrames(12, 15));
    expect(delays).toHaveLength(180);
    expect(sum(delays)).toBe(1200); // 12 s, not 12.6 s (180 x 7 cs)
    expect(delays.slice(0, 6)).toEqual([7, 6, 7, 7, 6, 7]);
    expect(frameDelays(planFrames(1, 10))).toEqual(Array(10).fill(10));
    expect(frameDelays(planFrames(1, 20))).toEqual(Array(20).fill(5));
  });

  it("keeps the sum exact for odd durations and gives the last frame the remainder", () => {
    for (const fps of [10, 15, 20, 24, 25, 30]) {
      for (const total of [1, 1.7, 2.35, 5, 5.01, 5.3, 7.77, 12, 33.33, 59.99, 61.2, 125.4]) {
        const plan = planFrames(total, fps);
        const delays = frameDelays(plan);
        const label = `${total}s @ ${fps}`;
        expect(delays, label).toHaveLength(plan.count);
        expect(sum(delays), label).toBe(Math.round(total * 100));
        expect(Math.min(...delays), label).toBeGreaterThanOrEqual(fps > 20 ? 1 : 2); // browsers play 0 and 1 cs as 10 cs
        expect(Math.max(...delays), label).toBeLessThanOrEqual(Math.ceil(150 / fps) + 1);
      }
    }
  });

  it("spreads sample frames evenly, including the first and the last", () => {
    expect(sampleFrameIndices(100, 5)).toEqual([0, 25, 50, 74, 99]);
    expect(sampleFrameIndices(10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sampleFrameIndices(3, 12)).toEqual([0, 1, 2]);
    expect(sampleFrameIndices(50, 1)).toEqual([0]);
    expect(sampleFrameIndices(0, 4)).toEqual([]);
    const many = sampleFrameIndices(180, 14);
    expect(many[0]).toBe(0);
    expect(many[many.length - 1]).toBe(179);
    expect(new Set(many).size).toBe(14);
  });
});

describe("paletteSampleFrames", () => {
  const timelineOf = (...pages: Array<Parameters<typeof buildTimeline>[0][number]>) => buildTimeline(pages);

  it("spreads frames over the timeline and adds three inside every transition", () => {
    const timeline = timelineOf({ duration: 4 }, { duration: 4, transition: { kind: "dissolve", duration: 1 } }, { duration: 4, transition: { kind: "push", duration: 0.6 } });
    const plan = planFrames(timeline.total, 15); // 12.6 s -> 189 frames
    const base = new Set(sampleFrameIndices(plan.count, 12));
    const picked = paletteSampleFrames(timeline, plan);
    for (const i of base) expect(picked).toContain(i);
    // the dissolve runs 4 s .. 5 s: a quarter, half and three quarters of the way in
    for (const share of [0.25, 0.5, 0.75]) expect(picked).toContain(Math.round((4 + share) * 15));
    expect(picked).toContain(Math.round((9 + 0.15) * 15)); // the push starts at 9 s and lasts 0.6 s
    expect(picked.length).toBeLessThanOrEqual(12 + 6);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("adds nothing for cuts and stays inside the frame range", () => {
    const cuts = timelineOf({ duration: 3 }, { duration: 3, transition: { kind: "none", duration: 1 } });
    const plan = planFrames(cuts.total, 10);
    expect(paletteSampleFrames(cuts, plan, 5)).toEqual(sampleFrameIndices(plan.count, 5));
    const short = timelineOf({ duration: 1 }, { duration: 1, transition: { kind: "dissolve", duration: 3 } });
    for (const i of paletteSampleFrames(short, planFrames(short.total, 20))) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(planFrames(short.total, 20).count);
    }
    expect(paletteSampleFrames(timelineOf(), planFrames(0, 15))).toEqual([]);
  });

  it("caps the number of samples", () => {
    const pages = Array.from({ length: 30 }, () => ({ duration: 2, transition: { kind: "dissolve", duration: 1 } }));
    const timeline = timelineOf(...pages);
    const picked = paletteSampleFrames(timeline, planFrames(timeline.total, 15));
    expect(picked.length).toBeLessThanOrEqual(36);
    expect(picked[0]).toBe(0);
  });
});

/* ---- a design with three pages: an animated one, a plain one with a transition, an animated one with a transition ---- */

function threePages(): Design {
  const intro = createPage({ duration: 4, background: solid("#ffffff") });
  intro.elements.push(
    createShape("rect", { x: 0, y: 0, width: 1920, height: 1080, fill: solid("#eee") }),
    createText({ text: "Hello", x: 100, y: 100, animation: { in: defaultAnimation("rise", "in") } }),
    createShape("rect", { x: 100, y: 400, width: 400, height: 300, animation: { in: { kind: "pop", duration: 1, delay: 1 }, out: { kind: "fade", duration: 0.5, delay: 0 } } }),
  );
  const middle = createPage({ duration: 6, transition: { kind: "push", duration: 0.6, direction: "left" } });
  middle.elements.push(createShape("rect", { x: 10, y: 10, width: 100, height: 100 }));
  const last = createPage({ duration: 5, transition: { kind: "dissolve", duration: 1 } });
  last.elements.push(createText({ text: "Bye", animation: { loop: defaultAnimation("breathe", "loop") } }));
  return createDesign({ title: "Three", width: 1920, height: 1080, pages: [intro, middle, last] });
}

describe("planAnimation", () => {
  const design = threePages();

  it("plays every page with the transitions between them", () => {
    const plan = planAnimation(design, [0, 1, 2], { format: "gif", resolution: 720, fps: 15 });
    expect(plan.pages).toEqual([0, 1, 2]);
    expect(plan.timeline.segments.map((s) => [s.page, s.start, s.playStart, s.end])).toEqual([
      [0, 0, 0, 4],
      [1, 4, 4.6, 10.6],
      [2, 10.6, 11.6, 16.6],
    ]);
    expect(plan.total).toBeCloseTo(16.6, 10);
    expect(plan.fps).toBe(15);
    expect(plan.frames).toBe(249); // round(16.6 x 15)
    expect(plan).toMatchObject({ width: 1280, height: 720, resolution: 720, animated: true, format: "gif" });
  });

  it("current page: just that page, with its own animations and no transition into it", () => {
    const plan = planAnimation(design, [1], { format: "gif", resolution: 480, fps: 10 });
    expect(plan.pages).toEqual([1]);
    expect(plan.timeline.segments).toHaveLength(1);
    expect(plan.timeline.segments[0]).toMatchObject({ page: 0, transition: 0, start: 0, playStart: 0, end: 6 });
    expect(plan.total).toBe(6);
    expect(plan.frames).toBe(60);
    // page 1 has a transition but nothing animated: a plain page and no motion at all
    expect(plan.animated).toBe(false);
  });

  it("custom: the chosen pages in order with their own transitions, the first without one", () => {
    const plan = planAnimation(design, [1, 2], { format: "webm" });
    expect(plan.fps).toBe(30);
    expect(plan.timeline.segments.map((s) => [s.start, s.transition, s.end])).toEqual([
      [0, 0, 6], // page 1 has a transition in the design, but nothing precedes it here
      [6, 1, 12],
    ]);
    // and a gap in the selection still joins the neighbours that were chosen
    const skip = planAnimation(design, [0, 2], { format: "gif" });
    expect(skip.timeline.segments.map((s) => [s.page, s.transition])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(skip.total).toBe(10);
  });

  it("flags a design with no animation and no transition as not animated", () => {
    const plain = createDesign({ width: 800, height: 600, pages: [createPage(), createPage()] });
    expect(planAnimation(plain, [0, 1], { format: "gif" }).animated).toBe(false);
    const cut = createDesign({ width: 800, height: 600, pages: [createPage(), createPage({ transition: { kind: "none", duration: 1 } })] });
    expect(planAnimation(cut, [0, 1], { format: "gif" }).animated).toBe(false);
    const faded = createDesign({ width: 800, height: 600, pages: [createPage(), createPage({ transition: { kind: "dissolve", duration: 0.7 } })] });
    expect(planAnimation(faded, [0, 1], { format: "gif" }).animated).toBe(true);
    expect(planAnimation(faded, [1], { format: "gif" }).animated).toBe(false); // the transition needs a page before it
  });

  it("ignores page indices that do not exist and survives an empty selection", () => {
    const plan = planAnimation(design, [2, 7, -1, 0.5], { format: "gif" });
    expect(plan.pages).toEqual([2]);
    const none = planAnimation(design, [], { format: "gif" });
    expect(none).toMatchObject({ pages: [], total: 0, frames: 0, animated: false });
  });

  it("sizes the picture from the preset", () => {
    for (const r of ANIM_RESOLUTIONS) {
      const plan = planAnimation(design, [0], { format: "gif", resolution: r });
      expect(Math.min(plan.width, plan.height)).toBeLessThanOrEqual(r + 1);
      expect(plan.width / plan.height).toBeCloseTo(16 / 9, 1);
    }
  });
});

describe("limits", () => {
  const big = (over: Partial<AnimationPlan>): AnimationPlan => ({ ...planAnimation(threePages(), [0], { format: "gif", resolution: 480, fps: 10 }), ...over });

  it("accepts ordinary animations", () => {
    expect(animationProblem(planAnimation(threePages(), [0, 1, 2], { format: "gif", resolution: 720, fps: 15 }))).toBeNull();
    expect(animationProblem(planAnimation(threePages(), [0, 1, 2], { format: "webm", resolution: 1080 }))).toBeNull();
  });

  it("refuses a GIF with too many frames or too many pixels, with a way out", () => {
    expect(animationProblem(big({ frames: GIF_MAX_FRAMES + 1 }))).toMatch(/too long.*GIF.*fewer pages or a lower frame rate/i);
    expect(animationProblem(big({ frames: 3000, width: 1920, height: 1080 }))).toMatch(/too large.*lower resolution/i);
    expect(animationProblem(big({ frames: GIF_MAX_FRAMES, width: 640, height: 360 }))).toBeNull();
  });

  it("refuses a video that would take longer than ten minutes to record", () => {
    expect(animationProblem(big({ format: "webm", total: VIDEO_MAX_SECONDS + 1 }))).toMatch(/at most 10 minutes/);
    expect(animationProblem(big({ format: "webm", total: VIDEO_MAX_SECONDS, frames: 99999 }))).toBeNull();
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(12)).toBe("12 s");
    expect(formatDuration(5.3)).toBe("5.3 s");
    expect(formatDuration(5)).toBe("5 s");
    expect(formatDuration(16.6)).toBe("17 s");
    expect(formatDuration(59.4)).toBe("59 s");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(75)).toBe("1 min 15 s");
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(Number.NaN)).toBe("0 s");
  });
});

describe("pageMotion", () => {
  const design = { width: 1000, height: 1000 };
  interface Spec {
    animation?: ElementAnimations;
    hidden?: boolean;
    width?: number;
    height?: number;
    /** a photograph instead of a shape */
    photo?: boolean;
  }
  const pageOf = (duration: number, ...specs: Spec[]): Page =>
    createPage({
      duration,
      elements: specs.map((s, i) =>
        s.photo
          ? createImage({ id: `e${i}`, src: "builtin:sunset-hills", x: 0, y: 0, width: s.width ?? 100, height: s.height ?? 100, hidden: s.hidden, animation: s.animation })
          : createShape("rect", { id: `e${i}`, x: 0, y: 0, width: s.width ?? 100, height: s.height ?? 100, hidden: s.hidden, animation: s.animation }),
      ),
    });

  it("is zero for a page where nothing moves", () => {
    expect(pageMotion(design, pageOf(5, {}))).toMatchObject({ activeSeconds: 0, flatSeconds: 0, photoSeconds: 0 });
  });

  it("counts an entrance from its delay to its end, and an exit counted back from the end of the page", () => {
    const m = pageMotion(design, pageOf(5, { animation: { in: { kind: "fade", duration: 1, delay: 1 }, out: { kind: "fade", duration: 1, delay: 0 } } }));
    expect(m.activeSeconds).toBe(2);
    // the element covers 1% of the page, so only 2% of a second of "whole picture" changes
    expect(m.flatSeconds).toBeCloseTo(0.02, 10);
    expect(m.photoSeconds).toBe(0);
  });

  it("counts an emphasis for the whole page", () => {
    const loop = pageMotion(design, pageOf(7, { animation: { loop: { kind: "float", duration: 3, delay: 0 } } }));
    expect(loop.activeSeconds).toBe(7);
  });

  it("counts overlapping windows once", () => {
    const m = pageOf(5, { animation: { in: { kind: "fade", duration: 2, delay: 0 } } }, { animation: { in: { kind: "fade", duration: 2, delay: 1 } } });
    expect(pageMotion(design, m).activeSeconds).toBe(3); // [0,2] and [1,3] cover 3 s, not 4
  });

  it("never claims more change than the whole picture changing the whole time", () => {
    const full = { width: 1000, height: 1000, animation: { in: { kind: "fade", duration: 2, delay: 0 } } };
    const m = pageMotion(design, pageOf(5, full, full));
    expect(m.activeSeconds).toBe(2);
    expect(m.flatSeconds).toBe(2);
  });

  it("keeps moving photographs apart, and a fade changes fewer of their pixels than a move", () => {
    const whole = { width: 1000, height: 1000, photo: true };
    const fade = pageMotion(design, pageOf(5, { ...whole, animation: { in: { kind: "fade", duration: 2, delay: 0 } } }));
    const move = pageMotion(design, pageOf(5, { ...whole, animation: { in: { kind: "rise", duration: 2, delay: 0 } } }));
    expect(fade.flatSeconds).toBe(0);
    expect(move.flatSeconds).toBe(0);
    expect(move.photoSeconds).toBe(2);
    expect(fade.photoSeconds).toBeCloseTo(0.8, 10);
    // a shape with an image fill is a photograph too
    const filled = createPage({
      duration: 5,
      elements: [
        createShape("rect", {
          id: "f",
          x: 0,
          y: 0,
          width: 1000,
          height: 1000,
          fill: { type: "image", src: "builtin:nebula", fit: "cover" },
          animation: { in: { kind: "pop", duration: 1, delay: 0 } },
        }),
      ],
    });
    expect(pageMotion(design, filled)).toMatchObject({ flatSeconds: 0, photoSeconds: 1 });
  });

  it("remembers the kind of transition into the page and what its background is", () => {
    expect(pageMotion(design, createPage({ transition: { kind: "dissolve", duration: 1 } })).transitionKind).toBe("dissolve");
    expect(pageMotion(design, createPage({ transition: { kind: "push", duration: 1, direction: "left" } })).transitionKind).toBe("push");
    expect(pageMotion(design, createPage()).transitionKind).toBe("");
    const a = pageMotion(design, createPage({ background: solid("#112233") }));
    const b = pageMotion(design, createPage({ background: solid("#112233") }));
    const c = pageMotion(design, createPage({ background: solid("#112234") }));
    expect(a.background).toBe(b.background);
    expect(a.background).not.toBe(c.background);
  });

  it("clips windows to the page and skips hidden elements", () => {
    const m = pageMotion(
      design,
      pageOf(5, { hidden: true, animation: { loop: { kind: "spin", duration: 1, delay: 0 } } }, { animation: { in: { kind: "fade", duration: 5, delay: 3 } } }),
    );
    expect(m.activeSeconds).toBe(2); // 3..8 is cut at the end of a 5 s page, and the hidden spinner does not count
  });
});

describe("size estimates", () => {
  const motionless = createDesign({ width: 1920, height: 1080, pages: [createPage({ duration: 5 })] });
  const planOf = (design: Design, pages: number[], format: "gif" | "webm", resolution: AnimResolution = 720, fps = 15) => planAnimation(design, pages, { format, resolution, fps });
  const gif = (design: Design, plan: AnimationPlan) =>
    estimateGifBytes(
      plan,
      plan.pages.map((i) => weighPage(design, design.pages[i])),
      plan.pages.map((i) => pageMotion(design, design.pages[i])),
    );
  const webm = (design: Design, plan: AnimationPlan) =>
    estimateWebmBytes(
      plan,
      plan.pages.map((i) => weighPage(design, design.pages[i])),
      plan.pages.map((i) => pageMotion(design, design.pages[i])),
    );

  it("is zero for an empty selection and never NaN", () => {
    const none = planOf(motionless, [], "gif");
    expect(gif(motionless, none)).toBe(0);
    expect(webm(motionless, planOf(motionless, [], "webm"))).toBe(0);
  });

  it("predicts a tiny file for a page that sits still, far more for one that moves", () => {
    const still = gif(motionless, planOf(motionless, [0], "gif"));
    expect(still).toBeGreaterThan(800);
    expect(still).toBeLessThan(120_000);
    const moving = threePages();
    const all = gif(moving, planOf(moving, [0, 1, 2], "gif"));
    expect(all).toBeGreaterThan(still * 3);
    expect(Number.isFinite(all)).toBe(true);
  });

  it("grows with the resolution and the frame rate", () => {
    const d = threePages();
    const bytes = (r: AnimResolution, fps: number) => gif(d, planOf(d, [0, 1, 2], "gif", r, fps));
    expect(bytes(480, 15)).toBeLessThan(bytes(720, 15));
    expect(bytes(720, 15)).toBeLessThan(bytes(1080, 15));
    expect(bytes(720, 10)).toBeLessThan(bytes(720, 15));
    expect(bytes(720, 15)).toBeLessThan(bytes(720, 20));
  });

  it("charges photographs and gradients more than flat colour", () => {
    const flat = createDesign({ width: 1280, height: 720, pages: [createPage({ background: solid("#ffffff") })] });
    const photo = createDesign({
      width: 1280,
      height: 720,
      pages: [createPage({ background: solid("#ffffff"), elements: [createImage({ src: "builtin:sunset-hills", x: 0, y: 0, width: 1280, height: 720 })] })],
    });
    expect(gif(photo, planOf(photo, [0], "gif"))).toBeGreaterThan(gif(flat, planOf(flat, [0], "gif")) * 5);
  });

  it("charges every frame of a transition and nothing for a static page", () => {
    const base = (transition: boolean) =>
      createDesign({
        width: 1280,
        height: 720,
        pages: [createPage({ duration: 5 }), createPage({ duration: 5, ...(transition ? { transition: { kind: "dissolve", duration: 1 } } : {}) })],
      });
    const cut = gif(base(false), planOf(base(false), [0, 1], "gif"));
    const dissolve = gif(base(true), planOf(base(true), [0, 1], "gif"));
    expect(dissolve).toBeGreaterThan(cut * 2);
    // ten extra seconds of stillness change nothing
    const long = createDesign({ width: 1280, height: 720, pages: [createPage({ duration: 15 }), createPage({ duration: 15 })] });
    expect(gif(long, planOf(long, [0, 1], "gif"))).toBe(cut);
  });

  it("asks the recorder for a bitrate that suits the size", () => {
    expect(videoBitrate(854, 480)).toBeGreaterThanOrEqual(1_000_000);
    expect(videoBitrate(1280, 720)).toBeGreaterThan(videoBitrate(854, 480));
    expect(videoBitrate(1920, 1080)).toBeGreaterThan(videoBitrate(1280, 720));
    expect(videoBitrate(1920, 1080)).toBeLessThanOrEqual(10_000_000);
    expect(videoBitrate(10, 10)).toBe(1_000_000);
  });

  it("predicts a video from its length and how much of it moves", () => {
    const d = threePages();
    const moving = webm(d, planOf(d, [0, 1, 2], "webm"));
    const still = webm(motionless, planOf(motionless, [0], "webm"));
    expect(moving).toBeGreaterThan(0);
    const bytesPerSecond = (bytes: number, seconds: number) => bytes / seconds;
    expect(bytesPerSecond(moving, 16.6)).toBeGreaterThan(bytesPerSecond(still, 5));
    expect(webm(d, planOf(d, [0, 1, 2], "webm", 1080))).toBeGreaterThan(moving);
    expect(webm(d, planOf(d, [0, 1, 2], "webm", 480))).toBeLessThan(moving);
  });
});

/*
 * The size estimates against real files. Every row is a design that was exported for real in Chrome (a GIF at 720p and
 * 15 fps, a WebM at 720p) with the size that came out; the estimate has to stay close to it. If a change to the
 * encoder or to the estimate pushes a row out of range, the model needs refitting - see the fitting notes in frames.ts.
 *
 * Designs are 1280 x 720 and every page lasts 4 s.
 */

const W = 1280;
const H = 720;

const grad = (a: string, b: string, angle = 135): Fill => ({
  type: "linear",
  angle,
  stops: [
    { offset: 0, color: a },
    { offset: 1, color: b },
  ],
});
const txt = (text: string, x: number, y: number, size = 60, extra: Record<string, unknown> = {}) =>
  createText({ text, x, y, fontSize: size, fontWeight: 700, fontFamily: "Inter", color: "#111827", ...extra });
const photo = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) =>
  createImage({ src: `builtin:${id}`, naturalWidth: 1600, naturalHeight: 1067, x, y, width: w, height: h, ...extra });
const many = (n: number): DesignElement[] =>
  Array.from({ length: n }, (_v, i) =>
    i % 3 === 0
      ? txt(`Item ${i}`, 40 + (i % 8) * 150, 40 + Math.floor(i / 8) * 90, 36)
      : createShape(i % 3 === 1 ? "ellipse" : "rect", {
          x: 40 + (i % 8) * 150,
          y: 40 + Math.floor(i / 8) * 90,
          width: 100,
          height: 60,
          fill: solid(["#7c3aed", "#12c2b9", "#f59e0b", "#ef4444"][i % 4]),
        }),
  );
const page = (background: Fill, elements: DesignElement[], extra: Partial<Page> = {}): Page => createPage({ background, duration: 4, elements, ...extra });
const animated = <T extends DesignElement>(el: T, animation: ElementAnimations): T => ({ ...el, animation });
const fade = (duration = 1, delay = 0): ElementAnimations => ({ in: { kind: "fade", duration, delay } });
const cream = solid("#fef3c7");
const sharedPage = (i: number, extra: Partial<Page> = {}) => page(grad("#4c1d95", "#0e7490"), [txt(`Slide ${i + 1}`, 100, 250 + i * 40, 90, { color: "#fff" })], extra);

interface Row {
  name: string;
  pages: () => Page[];
  /** real size of the GIF (720p, 15 fps) and of the WebM (720p) */
  gif: number;
  webm: number;
}

const ROWS: Row[] = [
  { name: "flat page, nothing on it", pages: () => [page(cream, [])], gif: 1685, webm: 34868 },
  { name: "flat + one big text", pages: () => [page(cream, [txt("Hello world", 100, 250, 90)])], gif: 6807, webm: 34494 },
  { name: "flat + 12 elements", pages: () => [page(cream, many(12))], gif: 9847, webm: 53006 },
  { name: "flat + 40 elements", pages: () => [page(cream, many(40))], gif: 26711, webm: 174665 },
  { name: "gradient background + text", pages: () => [page(grad("#4c1d95", "#0e7490"), [txt("Gradient", 100, 250, 90, { color: "#fff" })])], gif: 66237, webm: 1221628 },
  { name: "subtle gradient background", pages: () => [page(grad("#f8fafc", "#e2e8f0", 180), [txt("Subtle", 100, 250, 90)])], gif: 25385, webm: 1135060 },
  {
    name: "radial gradient + text",
    pages: () => [
      page(
        {
          type: "radial",
          cx: 0.3,
          cy: 0.3,
          stops: [
            { offset: 0, color: "#fef3c7" },
            { offset: 1, color: "#fb7185" },
          ],
        },
        [txt("Radial", 100, 250, 90)],
      ),
    ],
    gif: 96042,
    webm: 1210931,
  },
  {
    name: "pattern background + text",
    pages: () => [page({ type: "pattern", pattern: "waves", color: "#7c3aed", background: "#ede9fe", scale: 1 }, [txt("Pattern", 100, 250, 90)])],
    gif: 64393,
    webm: 1153897,
  },
  { name: "photograph over the whole page", pages: () => [page(solid("#fff"), [photo("sunset-hills", 0, 0, W, H)])], gif: 366009, webm: 1277460 },
  {
    name: "photograph over 30% of the page",
    pages: () => [page(solid("#fff"), [photo("mountain-lake", 700, 80, 500, 560, { radius: 30 }), txt("Photo", 80, 250, 90)])],
    gif: 133864,
    webm: 761628,
  },
  {
    name: "three flat pages, cuts",
    pages: () => [page(solid("#fef3c7"), [txt("One", 100, 250, 90)]), page(solid("#bfdbfe"), [txt("Two", 100, 250, 90)]), page(solid("#bbf7d0"), [txt("Three", 100, 250, 90)])],
    gif: 12282,
    webm: 65790,
  },
  { name: "three pages sharing one gradient, cuts", pages: () => [0, 1, 2].map((i) => sharedPage(i)), gif: 73759, webm: 3477518 },
  {
    name: "three pages sharing one gradient, dissolves",
    pages: () => [0, 1, 2].map((i) => sharedPage(i, i ? { transition: { kind: "dissolve", duration: 1 } } : {})),
    gif: 167032,
    webm: 4051647,
  },
  {
    name: "two flat pages, 1 s dissolve",
    pages: () => [page(solid("#fef3c7"), [txt("One", 100, 250, 90)]), page(solid("#bfdbfe"), [txt("Two", 100, 250, 90)], { transition: { kind: "dissolve", duration: 1 } })],
    gif: 162986,
    webm: 264396,
  },
  {
    name: "two flat pages, 1 s push",
    pages: () => [
      page(solid("#fef3c7"), [txt("One", 100, 250, 90)]),
      page(solid("#bfdbfe"), [txt("Two", 100, 250, 90)], { transition: { kind: "push", duration: 1, direction: "left" } }),
    ],
    gif: 85569,
    webm: 369284,
  },
  {
    name: "two photo pages, 1 s dissolve",
    pages: () => [
      page(solid("#fff"), [photo("sunset-hills", 0, 0, W, H)]),
      page(solid("#fff"), [photo("ocean-waves", 0, 0, W, H)], { transition: { kind: "dissolve", duration: 1 } }),
    ],
    gif: 3792123,
    webm: 2194254,
  },
  { name: "a text fading in for 1 s", pages: () => [page(cream, [animated(txt("Hello world", 100, 250, 90), fade(1))])], gif: 40217, webm: 535983 },
  {
    name: "six elements fading in one after another",
    pages: () => [
      page(
        cream,
        many(6).map((el, i) => animated(el, fade(0.7, i * 0.3))),
      ),
    ],
    gif: 31382,
    webm: 462623,
  },
  {
    name: "a big title rising over a gradient",
    pages: () => [page(grad("#4c1d95", "#0e7490"), [animated(txt("Rise up", 100, 250, 120, { color: "#fff" }), { in: { kind: "rise", duration: 0.8, delay: 0 } })])],
    gif: 118690,
    webm: 1186899,
  },
  { name: "a photograph over the whole page fading in", pages: () => [page(solid("#fff"), [animated(photo("sunset-hills", 0, 0, W, H), fade(1))])], gif: 2586670, webm: 1215269 },
  {
    name: "a 300 x 300 shape breathing for 4 s",
    pages: () => [
      page(cream, [animated(createShape("ellipse", { x: 500, y: 200, width: 300, height: 300, fill: solid("#7c3aed") }), { loop: { kind: "breathe", duration: 2.4, delay: 0 } })]),
    ],
    gif: 147153,
    webm: 760050,
  },
  {
    name: "a photograph over the whole page breathing for 4 s",
    pages: () => [page(solid("#fff"), [animated(photo("sunset-hills", -60, -30, W + 120, H + 60), { loop: { kind: "breathe", duration: 2.4, delay: 0 } })])],
    gif: 23103069,
    webm: 1245549,
  },
];

const options = (format: "gif" | "webm", pages: number[]): ExportOptions => ({
  format,
  pages,
  scale: 1,
  quality: 0.9,
  transparent: false,
  pdfMode: "standard",
  embedFonts: true,
  resolution: 720,
  fps: 15,
});

const geometricMean = (values: number[]) => Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);

function ratios(format: "gif" | "webm"): Array<{ name: string; ratio: number }> {
  return ROWS.map((row) => {
    const pages = row.pages();
    const design = createDesign({ title: row.name, width: W, height: H, pages });
    const estimate = estimateExportBytes(
      design,
      options(
        format,
        pages.map((_p, i) => i),
      ),
    );
    return { name: row.name, ratio: estimate / row[format] };
  });
}

describe("the GIF size estimate against real GIFs", () => {
  const all = ratios("gif");

  it("is within a factor of two of every measured file", () => {
    for (const { name, ratio } of all) {
      expect(ratio, name).toBeGreaterThan(0.5);
      expect(ratio, name).toBeLessThan(2);
    }
  });

  it("is unbiased: the typical error is small", () => {
    const g = geometricMean(all.map((r) => r.ratio));
    expect(g).toBeGreaterThan(0.85);
    expect(g).toBeLessThan(1.2);
    expect(geometricMean(all.map((r) => Math.max(r.ratio, 1 / r.ratio)))).toBeLessThan(1.35); // the typical miss
  });
});

describe("the video size estimate against real recordings", () => {
  const all = ratios("webm");

  it("is within a factor of three of every measured file (the recorder's own output varies by about that much)", () => {
    for (const { name, ratio } of all) {
      expect(ratio, name).toBeGreaterThan(1 / 3);
      expect(ratio, name).toBeLessThan(3);
    }
  });

  it("is unbiased: the typical error is small", () => {
    const g = geometricMean(all.map((r) => r.ratio));
    expect(g).toBeGreaterThan(0.8);
    expect(g).toBeLessThan(1.4);
  });
});

describe("estimates scale with the picture", () => {
  const design = () => createDesign({ width: W, height: H, pages: ROWS[4].pages() });
  const at = (format: "gif" | "webm", resolution: 480 | 720 | 1080, fps = 15) => estimateExportBytes(design(), { ...options(format, [0]), resolution, fps });

  it("a gradient page costs about the same per pixel at every resolution (GIF)", () => {
    const small = at("gif", 480);
    const big = at("gif", 1080);
    // 1080p has 5.06x the pixels of 480p: the estimate follows the pixels, not the edges, for a gradient
    expect(big / small).toBeGreaterThan(3.5);
    expect(big / small).toBeLessThan(6);
  });

  it("a video follows its bitrate target, which follows the pixel count up to 10 Mbit/s", () => {
    expect(at("webm", 1080)).toBeGreaterThan(at("webm", 720) * 1.8);
    expect(at("webm", 720)).toBeGreaterThan(at("webm", 480) * 1.5);
  });
});

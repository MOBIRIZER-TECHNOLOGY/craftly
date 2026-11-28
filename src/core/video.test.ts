/** The video element in the document model: how one is made, what counts as moving, what may come in, and the format step it came with. */
import { describe, expect, it } from "vitest";
import v1 from "@/test/fixtures/schema/design-v1-full.json";
import { isAnimating } from "@/editor/present/playbackPlan";
import { pageHasAnimation, playsClip } from "./animation";
import { createGroup, createPage, createShape, createVideo, VIDEO_SPEED_MAX, VIDEO_SPEED_MIN } from "./factory";
import { DESIGN_MIGRATIONS, migrateDesign } from "./schema/design";
import { elementProblem } from "./usableElement";

describe("making a video element", () => {
  it("is the clip at its own size, playing whole at its own speed, with sound", () => {
    const el = createVideo({ src: "asset:a_1", naturalWidth: 1920, naturalHeight: 1080, duration: 12 });
    expect(el).toMatchObject({ type: "video", src: "asset:a_1", width: 1920, height: 1080, trimStart: 0, trimEnd: 12, speed: 1, mask: "rect", radius: 0, stroke: null });
    expect(el.muted).toBeUndefined();
    expect(el.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(el.id).toMatch(/^v/);
  });

  it("keeps the clip's proportions at a width that is given, and covers a box that is given whole", () => {
    expect(createVideo({ src: "asset:a", naturalWidth: 1600, naturalHeight: 900, duration: 3, width: 800 }).height).toBe(450);
    const covered = createVideo({ src: "asset:a", naturalWidth: 1600, naturalHeight: 900, duration: 3, width: 400, height: 400 });
    expect(covered.crop.w).toBeCloseTo(16 / 9);
    expect(covered.crop.x).toBeCloseTo((1 - 16 / 9) / 2);
    const given = { x: 0.1, y: 0, w: 1, h: 1 };
    expect(createVideo({ src: "asset:a", duration: 3, width: 10, height: 10, crop: given }).crop).toBe(given);
  });

  it("reads a size or a length that is not there as a 1280 by 720 clip of one second", () => {
    const el = createVideo({ src: "asset:a", naturalWidth: 0, duration: Number.NaN });
    expect([el.naturalWidth, el.naturalHeight, el.duration, el.trimEnd]).toEqual([1280, 720, 1, 1]);
    expect(createVideo({ src: "asset:a", duration: -2 }).duration).toBe(1);
  });

  it("plays between a quarter of its speed and four times it", () => {
    expect([VIDEO_SPEED_MIN, VIDEO_SPEED_MAX]).toEqual([0.25, 4]);
  });
});

describe("a clip moves", () => {
  const clip = (over = {}) => createVideo({ src: "asset:a", duration: 4, ...over });

  it("for as long as its page is shown, inside a group too, unless it is hidden", () => {
    expect(playsClip(clip())).toBe(true);
    expect(playsClip(createGroup([createShape("rect"), clip()]))).toBe(true);
    expect(playsClip(clip({ hidden: true }))).toBe(false);
    expect(playsClip(createShape("rect"))).toBe(false);
  });

  it("so a page with one is animated, at any time, and one without is still", () => {
    const page = createPage({ elements: [createShape("rect"), clip()], duration: 5 });
    expect(pageHasAnimation(page)).toBe(true);
    expect(isAnimating(page, 0)).toBe(true);
    expect(isAnimating(page, 60)).toBe(true);
    const still = createPage({ elements: [createShape("rect"), clip({ hidden: true })] });
    expect(pageHasAnimation(still)).toBe(false);
    expect(isAnimating(still, 1)).toBe(false);
  });
});

describe("a video element that comes in from outside", () => {
  const whole = () => JSON.parse(JSON.stringify(createVideo({ src: "asset:a", duration: 4 }))) as Record<string, unknown>;

  it("is let in whole", () => {
    expect(elementProblem(whole())).toBeNull();
  });

  it("is refused without what the painter needs, named", () => {
    for (const name of ["src", "crop", "mask", "duration", "trimStart", "trimEnd", "speed"]) {
      const el = whole();
      delete el[name];
      expect(elementProblem(el), name).toContain(`${name} of a video`);
    }
  });
});

describe("version 2 of the design format", () => {
  it("came with the video element, in one step that changes nothing but the number", () => {
    expect(DESIGN_MIGRATIONS[0]).toMatchObject({ from: 1, about: "video elements" });
    const doc = structuredClone(v1);
    expect(DESIGN_MIGRATIONS[0].up(doc)).toEqual(v1);
    // and from there on to the current version, with nothing changed but the number (version 3 changes nothing either)
    const { design, from, migrated } = migrateDesign(v1);
    expect([from, migrated, design.version]).toEqual([1, true, 3]);
    expect({ ...design, version: 1 }).toEqual(v1);
  });
});

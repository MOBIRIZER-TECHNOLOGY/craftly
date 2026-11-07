import { describe, expect, it } from "vitest";
import { createPage } from "@/core/factory";
import { planAutoplay } from "./playbackPlan";

/* The edges of the auto-play plan: playbackPlan.test.ts has the main behaviour. */

describe("planAutoplay: edges", () => {
  it("starts at the very beginning for a design with no pages at all", () => {
    const plan = planAutoplay([], 3);
    expect(plan.offset).toBe(0);
    expect(plan.timeline.segments).toEqual([]);
    expect(plan.timeline.total).toBe(0);
  });

  it("starts from the last page when asked for a page beyond the end, and from the first for a negative one", () => {
    const pages = [createPage({ duration: 2 }), createPage({ duration: 3 }), createPage({ duration: 4 })];
    expect(planAutoplay(pages, 99).offset).toBe(5); // the last page begins after 2 + 3 seconds
    expect(planAutoplay(pages, -4).offset).toBe(0);
  });
});

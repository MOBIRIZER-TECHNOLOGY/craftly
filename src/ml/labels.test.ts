import { describe, expect, it } from "vitest";
import { INSTALL_TEXT, remainingText, STAGE_TEXT } from "./labels";
import type { JobKind } from "./state";
import type { MlStage } from "./types";

const KINDS: JobKind[] = ["remove-background", "blur-background", "colour-pop", "upscale"];
const STAGES: MlStage[] = ["preparing", "runtime", "model", "inference", "finishing"];

describe("STAGE_TEXT", () => {
  it.each(KINDS)("has a sentence for every step of the %s job", (kind) => {
    for (const stage of STAGES) expect(STAGE_TEXT[kind][stage], `${kind} / ${stage}`).toMatch(/\S/);
  });

  it("words the steps that depend on the job in the job's own terms", () => {
    expect(STAGE_TEXT["remove-background"].inference).toBe("Finding the subject…");
    expect(STAGE_TEXT["remove-background"].finishing).toBe("Cutting it out…");
    expect(STAGE_TEXT["blur-background"].inference).toBe("Finding the subject…");
    expect(STAGE_TEXT["blur-background"].finishing).toBe("Blurring the background…");
    expect(STAGE_TEXT["colour-pop"].inference).toBe("Finding the subject…");
    expect(STAGE_TEXT["colour-pop"].finishing).toBe("Taking the colour out of the background…");
    expect(STAGE_TEXT.upscale.inference).toBe("Making it larger…");
    expect(STAGE_TEXT.upscale.finishing).toBe("Saving the picture…");
  });

  it("words the steps that are the same for every job the same", () => {
    for (const stage of ["preparing", "runtime", "model"] as const) {
      expect(STAGE_TEXT.upscale[stage]).toBe(STAGE_TEXT["remove-background"][stage]);
      expect(STAGE_TEXT["blur-background"][stage]).toBe(STAGE_TEXT["remove-background"][stage]);
      expect(STAGE_TEXT["colour-pop"][stage]).toBe(STAGE_TEXT["remove-background"][stage]);
    }
  });
});

describe("INSTALL_TEXT", () => {
  it("has a sentence for every phase of an install", () => {
    expect(Object.keys(INSTALL_TEXT).sort()).toEqual(["downloading", "preparing", "saving"]);
  });
});

describe("remainingText", () => {
  it("says nothing when it cannot tell, or when what is left is too short to matter", () => {
    expect(remainingText(undefined)).toBeNull();
    expect(remainingText(Number.NaN)).toBeNull();
    expect(remainingText(-5)).toBeNull();
    expect(remainingText(0)).toBeNull();
    expect(remainingText(9_999)).toBeNull();
  });

  it("counts seconds in steps of five up to a minute and a quarter", () => {
    expect(remainingText(10_000)).toBe("about 10 seconds left");
    expect(remainingText(12_400)).toBe("about 10 seconds left");
    expect(remainingText(13_000)).toBe("about 15 seconds left");
    expect(remainingText(42_000)).toBe("about 40 seconds left");
    expect(remainingText(74_000)).toBe("about 75 seconds left");
  });

  it("counts minutes from there on", () => {
    expect(remainingText(75_000)).toBe("about 1 minute left");
    expect(remainingText(110_000)).toBe("about 2 minutes left");
    expect(remainingText(5 * 60_000)).toBe("about 5 minutes left");
  });
});

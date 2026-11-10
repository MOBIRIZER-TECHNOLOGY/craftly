import { describe, expect, it } from "vitest";
import { createShape } from "./factory";
import { BLEND_MODES, blendLabel, blendOf, isBlendMode } from "./blend";

/** The names a canvas (`globalCompositeOperation`) and a style sheet (`mix-blend-mode`) both know, in the order of a photo editor's list. */
const IN_ORDER = [
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

describe("the blend modes", () => {
  it("are the fifteen that a canvas and a style sheet share, darkening ones first, colour ones last", () => {
    expect([...BLEND_MODES]).toEqual(IN_ORDER);
  });

  it("have a name a person reads, one each", () => {
    const labels = BLEND_MODES.map((mode) => blendLabel(mode));
    expect(labels).toEqual([
      "Darken",
      "Multiply",
      "Color burn",
      "Lighten",
      "Screen",
      "Color dodge",
      "Overlay",
      "Soft light",
      "Hard light",
      "Difference",
      "Exclusion",
      "Hue",
      "Saturation",
      "Color",
      "Luminosity",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("call no blend at all Normal", () => {
    expect(blendLabel(undefined)).toBe("Normal");
  });
});

describe("isBlendMode", () => {
  it.each(IN_ORDER)("accepts %s", (mode) => {
    expect(isBlendMode(mode)).toBe(true);
  });

  it.each([
    ["normal, which is the absence of a mode and is never stored", "normal"],
    ["what a canvas calls no blending", "source-over"],
    ["a canvas operation that is not a blend mode", "xor"],
    ["a mode in capitals", "MULTIPLY"],
    ["a mode with a space after it", "multiply "],
    ["a mode with a style after it", "multiply;background:url(https://evil.test/x)"],
    ["nothing", ""],
    ["a name that every object has", "constructor"],
    ["a name that would change an object", "__proto__"],
    ["a method of every object", "toString"],
    ["a number", 1],
    ["no value", undefined],
    ["null", null],
    ["a list that holds a mode", ["multiply"]],
    ["an object", { mode: "multiply" }],
  ])("refuses %s", (_what, value) => {
    expect(isBlendMode(value)).toBe(false);
  });
});

describe("blendOf", () => {
  it("gives the mode of an element that has one", () => {
    expect(blendOf(createShape("rect", { blend: "overlay" }))).toBe("overlay");
  });

  it("gives nothing for an element that has none", () => {
    expect(blendOf(createShape("rect"))).toBeUndefined();
  });

  it("gives nothing for what is not a mode, whatever a file or another person put there", () => {
    for (const blend of ["normal", "source-over", "multiply;x", 5, null, {}, []]) {
      expect(blendOf({ blend } as never), JSON.stringify(blend)).toBeUndefined();
    }
  });
});

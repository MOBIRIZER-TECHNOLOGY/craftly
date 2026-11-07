import { describe, expect, it } from "vitest";
import { DEFAULT_FONT, textPresetSizes } from "@/core/factory";
import { TEXT_STYLE_PRESETS } from "./textStyles";

describe("the default text styles", () => {
  it("offers a heading, a subheading and a little body text, biggest first", () => {
    expect(TEXT_STYLE_PRESETS.map((p) => p.id)).toEqual(["heading", "subheading", "body"]);
    expect(TEXT_STYLE_PRESETS.map((p) => p.label)).toEqual(["Add a heading", "Add a subheading", "Add a little bit of body text"]);
    const factors = TEXT_STYLE_PRESETS.map((p) => p.sizeFactor);
    expect([...factors].sort((a, b) => b - a)).toEqual(factors);
  });

  it("sizes them like the editor does when it adds text", () => {
    const sizes = textPresetSizes(1000, 1000);
    for (const preset of TEXT_STYLE_PRESETS) expect(preset.sizeFactor * 1000).toBeCloseTo(sizes[preset.id], 5);
    // a factor of the shorter side, so it follows textPresetSizes for any design
    const wide = textPresetSizes(3000, 2000);
    for (const preset of TEXT_STYLE_PRESETS) expect(Math.round(preset.sizeFactor * 2000)).toBe(wide[preset.id]);
  });

  it("makes the heading bolder than the body, all in the default typeface", () => {
    const weights = TEXT_STYLE_PRESETS.map((p) => p.fontWeight);
    expect(weights).toEqual([700, 600, 400]);
    for (const preset of TEXT_STYLE_PRESETS) expect(preset.fontFamily).toBe(DEFAULT_FONT);
  });
});

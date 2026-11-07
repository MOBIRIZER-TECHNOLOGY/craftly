import { describe, expect, it } from "vitest";
import { getFontDef } from "@/render/fonts";
import { TEXT_COMBOS } from "./textCombos";

const square = { width: 1000, height: 1000 };

describe("font combinations", () => {
  it("has a name and a distinct id for each of them", () => {
    expect(TEXT_COMBOS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TEXT_COMBOS.map((c) => c.id)).size).toBe(TEXT_COMBOS.length);
    expect(new Set(TEXT_COMBOS.map((c) => c.name)).size).toBe(TEXT_COMBOS.length);
    for (const combo of TEXT_COMBOS) {
      expect(combo.id, combo.name).toMatch(/^[a-z0-9-]+$/);
      expect(combo.name.trim(), combo.id).not.toBe("");
    }
  });

  it("only uses typefaces the editor can load", () => {
    for (const combo of TEXT_COMBOS) {
      expect(combo.fonts.length, combo.id).toBeGreaterThan(0);
      for (const family of combo.fonts) expect(getFontDef(family), `${combo.id}: ${family}`).toBeDefined();
      for (const element of combo.build(square)) expect(getFontDef(element.fontFamily), `${combo.id}: ${element.fontFamily}`).toBeDefined();
    }
  });

  it("names the typefaces it uses once each, the display face first", () => {
    for (const combo of TEXT_COMBOS) {
      const elements = combo.build(square);
      expect(new Set(combo.fonts).size, combo.id).toBe(combo.fonts.length);
      expect([...combo.fonts].sort(), combo.id).toEqual([...new Set(elements.map((e) => e.fontFamily))].sort());
      const biggest = elements.reduce((a, b) => (b.fontSize > a.fontSize ? b : a));
      expect(combo.fonts[0], combo.id).toBe(biggest.fontFamily);
    }
  });

  it("builds a few text boxes, each of them its own fixed-width block of copy", () => {
    for (const combo of TEXT_COMBOS) {
      const elements = combo.build(square);
      expect(elements.length, combo.id).toBeGreaterThanOrEqual(2);
      expect(elements.length, combo.id).toBeLessThanOrEqual(4);
      expect(new Set(elements.map((e) => e.id)).size, combo.id).toBe(elements.length);
      for (const element of elements) {
        expect(element.type).toBe("text");
        expect(element.autoWidth, `${combo.id} wraps its lines by itself`).toBe(false);
        expect(element.width, combo.id).toBeGreaterThan(0);
        expect(element.paragraphs.flatMap((p) => p.runs).map((r) => r.text).join("").trim(), combo.id).not.toBe("");
        expect(element.color, combo.id).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("stacks the parts from the top, each below the one before it unless it is meant to overlap", () => {
    for (const combo of TEXT_COMBOS) {
      const elements = combo.build(square);
      for (const element of elements) {
        expect(element.x, combo.id).toBeGreaterThanOrEqual(0);
        expect(element.x + element.width, `${combo.id} stays inside its box`).toBeLessThanOrEqual(1000);
      }
      // the lowest part reaches furthest down, and nothing starts above the top of the box
      expect(Math.min(...elements.map((e) => e.y)), combo.id).toBeGreaterThanOrEqual(0);
      expect(Math.max(...elements.map((e) => e.y + e.height)), combo.id).toBeGreaterThan(Math.max(...elements.map((e) => e.y)));
    }
  });

  it("scales everything with the shorter side of the design", () => {
    for (const combo of TEXT_COMBOS) {
      const small = combo.build({ width: 1000, height: 1000 });
      const big = combo.build({ width: 4000, height: 2000 });
      const huge = combo.build({ width: 6000, height: 2000 });
      expect(big.map((e) => e.fontSize), combo.id).toEqual(small.map((e) => e.fontSize * 2));
      // only the shorter side counts: a wider design with the same height gives the same boxes
      expect(huge.map((e) => [e.fontSize, e.x, e.y, e.width]), combo.id).toEqual(big.map((e) => [e.fontSize, e.x, e.y, e.width]));
    }
  });

  it("builds a fresh set of boxes each time", () => {
    const [first] = TEXT_COMBOS;
    const a = first.build(square);
    const b = first.build(square);
    expect(a.map((e) => e.id)).not.toEqual(b.map((e) => e.id));
    a[0].fontSize = 1;
    expect(first.build(square)[0].fontSize).not.toBe(1);
  });

  it("puts a part that must stay on top after the others, and tilts the ones that are tilted", () => {
    const summer = TEXT_COMBOS.find((c) => c.id === "summer-sale")!;
    const elements = summer.build(square);
    expect(elements.at(-1)!.rotation).toBe(-8);
    expect(elements.at(-1)!.paragraphs[0].runs[0].text).toBe("Summer");
    // it is the first part of the stack, so it sits at the top although it is painted last
    expect(Math.min(...elements.map((e) => e.y))).toBe(elements.at(-1)!.y);
    expect(TEXT_COMBOS.some((c) => c.build(square).some((e) => e.rotation !== 0 && e !== elements.at(-1))), "another tilted part").toBe(true);
  });

  it("lets a part overlap the one before it with a negative gap", () => {
    const summer = TEXT_COMBOS.find((c) => c.id === "summer-sale")!.build(square);
    const [sale, , summerPart] = [summer[0], summer[1], summer[2]];
    expect(sale.paragraphs[0].runs[0].text).toBe("Sale");
    expect(sale.y).toBeLessThan(summerPart.y + summerPart.height);
  });

  it("carries the effect, case and spacing a part asks for", () => {
    const effects = TEXT_COMBOS.flatMap((c) => c.build(square)).filter((e) => e.effect.kind !== "none");
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.some((e) => e.effect.kind === "background" && e.effect.color === "#ddd6fe")).toBe(true);
    const all = TEXT_COMBOS.flatMap((c) => c.build(square));
    expect(all.some((e) => e.textCase === "upper")).toBe(true);
    expect(all.some((e) => e.letterSpacing < 0)).toBe(true);
    expect(all.some((e) => e.letterSpacing > 0)).toBe(true);
    expect(all.some((e) => e.italic)).toBe(true);
    expect(all.some((e) => e.fontWeight === 900)).toBe(true);
  });

  it("keeps each part's own line height, and the default of 1.2 for those with none", () => {
    const luxury = TEXT_COMBOS.find((c) => c.id === "luxury-caps")!.build(square);
    expect(luxury[0].lineHeight).toBe(1);
    expect(luxury[1].lineHeight).toBe(1.2);
  });
});

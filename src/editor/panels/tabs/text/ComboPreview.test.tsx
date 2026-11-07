import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createLine, createShape } from "@/core/factory";
import { boundsOfElements } from "@/core/geometry";
import type { DesignElement } from "@/core/types";
import { TEXT_COMBOS, type TextCombo } from "@/data/textCombos";
import { contextOf } from "@/test/canvasMock";
import { flush } from "@/test/helpers";
import { ComboPreview, PREVIEW_DESIGN, buildComboPage } from "./ComboPreview";

/** A combination of any elements (the real ones are all text, but the preview only measures and moves them). */
const fake = (build: () => DesignElement[]): TextCombo => ({ ...TEXT_COMBOS[0], id: "fake", name: "Fake", build: build as unknown as TextCombo["build"] });

describe("buildComboPage", () => {
  it.each(TEXT_COMBOS.map((c) => [c.name, c] as const))("fits and centres the '%s' combination in the preview card", (_name, combo) => {
    const page = buildComboPage(combo);
    const b = boundsOfElements(page.elements)!;
    expect(page.elements.length).toBeGreaterThan(0);
    // it fills most of the card but never touches the edges
    expect(b.x).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
    expect(b.x + b.w).toBeLessThan(PREVIEW_DESIGN.width);
    expect(b.y + b.h).toBeLessThan(PREVIEW_DESIGN.height);
    expect(b.x + b.w / 2).toBeCloseTo(PREVIEW_DESIGN.width / 2, 0);
    expect(b.y + b.h / 2).toBeCloseTo(PREVIEW_DESIGN.height / 2, 0);
  });

  it("paints on a near white page and uses the real elements of the combination", () => {
    const page = buildComboPage(TEXT_COMBOS[0]);
    expect(page.background).toEqual({ type: "solid", color: "#fbfbfd" });
    const original = TEXT_COMBOS[0].build({ width: 1000, height: 1000 });
    expect(page.elements.map((e) => e.type)).toEqual(original.map((e) => e.type));
  });

  it("scales a small combination up, but by no more than 1.4 times", () => {
    const small = buildComboPage(fake(() => [createShape("rect", { x: 0, y: 0, width: 40, height: 20 })]));
    const el = small.elements[0];
    expect(el.width).toBeCloseTo(40 * 1.4);
    expect(el.height).toBeCloseTo(20 * 1.4);
  });

  it("scales a large combination down to the card", () => {
    const big = buildComboPage(fake(() => [createShape("rect", { x: 0, y: 0, width: 4000, height: 100 })]));
    expect(big.elements[0].width).toBeCloseTo(PREVIEW_DESIGN.width * 0.86);
  });

  it("leaves an empty combination, or one with no extent, as it is", () => {
    expect(buildComboPage(fake(() => [])).elements).toEqual([]);
    const flat = buildComboPage(fake(() => [createLine({ x: 10, y: 10, width: 300, height: 0 })]));
    expect(flat.elements[0].x).toBe(10);
    expect(flat.elements[0].width).toBe(300);
  });
});

describe("<ComboPreview>", () => {
  it("draws the combination through the real renderer into a card of the given width", async () => {
    const { container } = render(<ComboPreview combo={TEXT_COMBOS[0]} width={150} />);
    await flush(5);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.width).toBe("150px");
    expect(host.style.height).toBe(`${Math.round((150 * PREVIEW_DESIGN.height) / PREVIEW_DESIGN.width)}px`);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(contextOf(canvas)?.callsTo("drawImage")).toHaveLength(1);
  });
});

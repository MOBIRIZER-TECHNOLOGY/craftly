import { describe, expect, it } from "vitest";
import { createChart, createGroup, createImage, createPage, createShape, createTable, createText } from "@/core/factory";
import type { Fill, Page } from "@/core/types";
import { jpegQualityFactor, weighPage } from "./options";

const SIZE = { width: 1000, height: 500 };
const pageWith = (elements: Page["elements"], background?: Fill) => createPage({ elements, ...(background ? { background } : {}) });
const gradient = (...colors: string[]): Fill => ({ type: "linear", angle: 0, stops: colors.map((color, i) => ({ offset: i / Math.max(1, colors.length - 1), color })) });

describe("weighPage", () => {
  it("counts every element that is shown, however deep in a group", () => {
    const page = pageWith([createShape("rect"), createGroup([createShape("rect"), createGroup([createShape("rect")])]), createShape("rect", { hidden: true })]);
    // the group counts as one too, its children as many
    expect(weighPage(SIZE, page).elements).toBe(5);
  });

  it("does not count the children of a hidden group", () => {
    expect(weighPage(SIZE, pageWith([createGroup([createShape("rect")], { hidden: true })])).elements).toBe(0);
  });

  it("counts a picture, and the part of the page it covers", () => {
    const weight = weighPage(SIZE, pageWith([createImage({ src: "asset:a", width: 500, height: 250 }), createImage({ src: null, width: 100, height: 100 })]));
    expect(weight.images).toBe(1);
    expect(weight.photo).toBeCloseTo(0.25);
  });

  it("never counts more of a page than there is", () => {
    const weight = weighPage(SIZE, pageWith([createImage({ src: "asset:a", width: 5000, height: 5000 }), createImage({ src: "asset:b", width: 5000, height: 5000 })]));
    expect(weight.photo).toBe(1);
  });

  it("counts a picture used as the fill of a shape as a picture, but not as a photo", () => {
    const weight = weighPage(SIZE, pageWith([createShape("rect", { fill: { type: "image", src: "asset:a", fit: "cover" } })]));
    expect(weight.images).toBe(1);
    expect(weight.photo).toBe(0);
  });

  it("counts a picture used as the background as one covering the whole page, unless the background is left out", () => {
    const background: Fill = { type: "image", src: "asset:a", fit: "cover" };
    const page = pageWith([], background);
    expect(weighPage(SIZE, page)).toMatchObject({ images: 1, photo: 1, busyBackground: true });
    expect(weighPage(SIZE, page, { background: false })).toMatchObject({ images: 0, photo: 0, busyBackground: false });
  });

  it("lists the fonts of text, of the runs within it, of tables and of charts", () => {
    const page = pageWith([
      createText({ text: "a", fontFamily: "Lora" }),
      createText({ fontFamily: "Lora", paragraphs: [{ runs: [{ text: "x" }, { text: "y", font: "Anton" }] }] }),
      createTable({ fontFamily: "Inter" }),
      createChart({ fontFamily: "Poppins" }),
    ]);
    expect(weighPage(SIZE, page).families).toBe(4);
    expect(weighPage(SIZE, pageWith([createTable({ fontFamily: "Inter" }), createChart({ fontFamily: "Inter" })])).families).toBe(1);
  });

  it("says how far apart the ends of a gradient are, and that a pattern is a pattern", () => {
    expect(weighPage(SIZE, pageWith([], gradient("#000000", "#ffffff"))).gradientSpan).toBe(1);
    expect(weighPage(SIZE, pageWith([], gradient("#000000", "#808080"))).gradientSpan).toBeCloseTo(0.502, 2);
    expect(weighPage(SIZE, pageWith([], gradient("#336699"))).gradientSpan).toBe(0);
    const pattern: Fill = { type: "pattern", pattern: "dots", color: "#000000", background: "#ffffff", scale: 1 };
    expect(weighPage(SIZE, pageWith([], pattern))).toMatchObject({ patterned: true, busyBackground: true, gradientSpan: 0 });
  });

  it("assumes a middling span for a gradient whose colours it cannot read", () => {
    expect(weighPage(SIZE, pageWith([], gradient("not a colour", "#ffffff"))).gradientSpan).toBe(0.5);
  });

  it("weighs a flat page as nothing special", () => {
    expect(weighPage(SIZE, pageWith([]))).toEqual({ photo: 0, busyBackground: false, images: 0, elements: 0, families: 0, gradientSpan: 0, patterned: false });
  });
});

describe("jpegQualityFactor", () => {
  it("grows with the quality, steeply at the top", () => {
    const factors = [0.1, 0.3, 0.6, 0.92, 1].map(jpegQualityFactor);
    expect(factors).toEqual([...factors].sort((a, b) => a - b));
    expect(factors[3]).toBe(1);
    expect(factors[4]).toBeGreaterThan(3);
  });

  it("makes sense of qualities outside the range", () => {
    expect(jpegQualityFactor(0)).toBe(jpegQualityFactor(0.1));
    expect(jpegQualityFactor(5)).toBe(jpegQualityFactor(1));
    expect(jpegQualityFactor(Number.NaN)).toBe(1);
  });
});

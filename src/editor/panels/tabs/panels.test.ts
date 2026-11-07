import { describe, expect, it } from "vitest";
import { createImage, createPage, createShape, createText, solid } from "@/core/factory";
import { extractSvgColors } from "@/core/svg";
import { generateLorem } from "./apps/lorem";
import { EMOJI_CATEGORIES } from "./apps/emojiData";
import { medianCut, paletteFromPixels } from "./apps/quantize";
import { qrSvg } from "./apps/qrSvg";
import { fitTemplatePage, isFullBleed } from "./templates/fitTemplate";

describe("lorem ipsum generator", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(generateLorem("paragraphs", 2, 3, true)).toBe(generateLorem("paragraphs", 2, 3, true));
    expect(generateLorem("sentences", 4, 1, false)).not.toBe(generateLorem("sentences", 4, 2, false));
  });

  it("produces the requested amount", () => {
    expect(generateLorem("paragraphs", 3, 1, true).split("\n\n")).toHaveLength(3);
    expect(generateLorem("words", 25, 1, true).split(" ")).toHaveLength(25);
    expect(generateLorem("sentences", 5, 9, false).match(/\./g)).toHaveLength(5);
  });

  it("starts with the classic line when asked to", () => {
    expect(generateLorem("sentences", 2, 5, true).startsWith("Lorem ipsum dolor sit amet, consectetur adipiscing elit.")).toBe(true);
    expect(generateLorem("sentences", 2, 5, false).startsWith("Lorem ipsum dolor sit amet, consectetur")).toBe(false);
  });
});

describe("palette quantiser", () => {
  const rgba = (colors: Array<[number, number, number]>, each: number) => {
    const data = new Uint8ClampedArray(colors.length * each * 4);
    let i = 0;
    for (const [r, g, b] of colors) for (let k = 0; k < each; k++, i += 4) data.set([r, g, b, 255], i);
    return data;
  };

  it("finds the flat colours of a simple picture and orders them by coverage", () => {
    const data = rgba(
      [
        [220, 40, 60],
        [30, 120, 220],
        [250, 200, 20],
      ],
      400,
    );
    const palette = paletteFromPixels(data, 6);
    expect(palette).toHaveLength(3);
    expect(palette.map((c) => c.toLowerCase()).sort()).toEqual(["#1e78dc", "#dc283c", "#fac814"]);
  });

  it("ignores transparent pixels and never returns near-duplicates", () => {
    const data = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) data.set(i % 2 ? [10, 10, 10, 0] : [200, 30, 30, 255], i * 4);
    expect(paletteFromPixels(data, 6)).toEqual(["#c81e1e"]);
    const close = rgba(
      [
        [100, 100, 100],
        [104, 102, 100],
      ],
      200,
    );
    expect(paletteFromPixels(close, 6)).toHaveLength(1);
  });

  it("splits the busiest, most varied box first", () => {
    const boxes = medianCut(
      [
        { r: 0, g: 0, b: 0, n: 100 },
        { r: 255, g: 255, b: 255, n: 50 },
        { r: 250, g: 250, b: 250, n: 50 },
      ],
      2,
    );
    expect(boxes).toHaveLength(2);
    expect(boxes[0].n).toBe(100);
  });
});

describe("QR svg", () => {
  it("draws two recolourable colours and a quiet zone", () => {
    const svg = qrSvg("https://example.com", "M", "#112233", "#ffeedd");
    expect(extractSvgColors(svg).sort()).toEqual(["#112233", "#ffeedd"]);
    const size = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]);
    expect((size - 6) % 4).toBe(1); // a QR code has 17 + 4 * version modules per side
  });

  it("refuses data that does not fit", () => {
    expect(() => qrSvg("x".repeat(5000), "H", "#000000", "#ffffff")).toThrow();
  });
});

describe("emoji catalogue", () => {
  it("has names, no duplicates inside a category and every category is filled", () => {
    for (const cat of EMOJI_CATEGORIES) {
      expect(cat.items.length).toBeGreaterThan(20);
      const chars = cat.items.map((e) => e.char);
      expect(new Set(chars).size).toBe(chars.length);
      for (const e of cat.items) {
        expect(e.char.length).toBeGreaterThan(0);
        expect(e.name.length).toBeGreaterThan(1);
      }
    }
  });
});

describe("fitting a template page to another design size", () => {
  const template = { width: 1000, height: 500 };
  const page = createPage({
    background: solid("#ffffff"),
    elements: [
      createShape("rect", { x: 0, y: 0, width: 1000, height: 500, fill: solid("#101010") }),
      createText({ text: "Hello", x: 100, y: 100, width: 400, autoWidth: false, fontSize: 60 }),
      createImage({ src: "builtin:sunset-hills", naturalWidth: 1600, naturalHeight: 1067, x: 600, y: 50, width: 300, height: 200 }),
    ],
  });

  it("keeps the page untouched when the size already matches", () => {
    const same = fitTemplatePage(template, page, { width: 1000, height: 500 });
    expect(same).toEqual(page);
    expect(same).not.toBe(page);
  });

  it("scales content uniformly and centres it", () => {
    const fitted = fitTemplatePage(template, page, { width: 500, height: 500 });
    const [, text, image] = fitted.elements;
    // scale = 0.5, the 250px tall result is centred vertically in the 500px page
    expect(text.x).toBeCloseTo(50);
    expect(text.y).toBeCloseTo(50 + 125);
    expect(text.type === "text" && text.fontSize).toBeCloseTo(30);
    expect(image.width).toBeCloseTo(150);
    expect(image.x).toBeCloseTo(300);
  });

  it("stretches a full-bleed background over the whole design", () => {
    const fitted = fitTemplatePage(template, page, { width: 500, height: 500 });
    const bg = fitted.elements[0];
    expect([bg.x, bg.y, bg.width, bg.height]).toEqual([0, 0, 500, 500]);
    expect(isFullBleed(page.elements[0], template)).toBe(true);
    expect(isFullBleed(page.elements[2], template)).toBe(false);
  });

  it("never mutates the template", () => {
    const before = JSON.stringify(page);
    fitTemplatePage(template, page, { width: 300, height: 900 });
    expect(JSON.stringify(page)).toBe(before);
  });
});

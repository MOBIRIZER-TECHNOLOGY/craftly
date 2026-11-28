import { beforeAll, describe, expect, it } from "vitest";
import { createText } from "@/core/factory";
import { setTextMeasurer } from "@/core/textMetrics";
import { alignAnchor, fontString, layoutText, measureTextElement, resolveRunStyle } from "./textLayout";

// Deterministic metrics: every character is 0.5 em wide, ascent 0.8 em, descent 0.2 em.
beforeAll(() => {
  const size = (font: string) => parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
  setTextMeasurer({
    width: (font, text) => text.length * size(font) * 0.5,
    metrics: (font) => ({ ascent: size(font) * 0.8, descent: size(font) * 0.2 }),
  });
});

const box = (text: string, over: Parameters<typeof createText>[0] = {}) => createText({ text, fontSize: 20, width: 300, autoWidth: false, lineHeight: 1.5, ...over });
const lineTexts = (el: ReturnType<typeof createText>) => layoutText(el).lines.map((l) => l.segments.map((s) => s.text).join(""));

describe("resolveRunStyle", () => {
  it("takes everything from the element when the run says nothing", () => {
    const el = box("x", { fontFamily: "Lora", fontWeight: 500, italic: true, color: "#123456", underline: true, strike: true, letterSpacing: 100 });
    expect(resolveRunStyle(el, { text: "x" })).toEqual({ family: "Lora", weight: 500, italic: true, size: 20, color: "#123456", underline: true, strike: true, spacing: 2 });
    expect(resolveRunStyle(el, null)).toEqual(resolveRunStyle(el, { text: "" }));
  });

  it("lets a run override each property", () => {
    const el = box("x");
    const style = resolveRunStyle(el, { text: "x", font: "Anton", italic: true, size: 40, color: "#ff0000", underline: true, strike: true, spacing: 500 });
    expect(style).toEqual({ family: "Anton", weight: 400, italic: true, size: 40, color: "#ff0000", underline: true, strike: true, spacing: 20 });
  });

  it("uses a numeric run weight instead of reducing it to bold", () => {
    expect(resolveRunStyle(box("x", { fontWeight: 400 }), { text: "x", weight: 300 }).weight).toBe(300);
    expect(resolveRunStyle(box("x", { fontWeight: 400 }), { text: "x", weight: 600 }).weight).toBe(600);
    expect(resolveRunStyle(box("x", { fontWeight: 800 }), { text: "x", weight: 500, bold: true }).weight).toBe(500);
  });

  it("makes a bold run at least bold and an un-bold run at most regular", () => {
    expect(resolveRunStyle(box("x", { fontWeight: 400 }), { text: "x", bold: true }).weight).toBe(700);
    expect(resolveRunStyle(box("x", { fontWeight: 900 }), { text: "x", bold: true }).weight).toBe(900);
    expect(resolveRunStyle(box("x", { fontWeight: 800 }), { text: "x", bold: false }).weight).toBe(400);
    expect(resolveRunStyle(box("x", { fontWeight: 300 }), { text: "x", bold: false }).weight).toBe(300);
    expect(resolveRunStyle(box("x", { fontWeight: 600 }), { text: "x" }).weight).toBe(600);
  });
});

describe("fontString", () => {
  it("writes weight, size and the font list, with italic first", () => {
    expect(fontString({ family: "Poppins", weight: 700, italic: false, size: 18 })).toBe('700 18px "Poppins", sans-serif');
    expect(fontString({ family: "Poppins", weight: 400, italic: true, size: 18.5 })).toBe('italic 400 18.5px "Poppins", sans-serif');
  });
});

describe("text case", () => {
  it("turns text lower case", () => {
    expect(lineTexts(box("Hello WORLD", { textCase: "lower" }))).toEqual(["hello world"]);
  });

  it("capitalises every word and lowers the rest, keeping apostrophes and accents inside the word", () => {
    expect(lineTexts(box("hELLO wORLD o'neil élan", { textCase: "title", width: 600 }))).toEqual(["Hello World O'neil Élan"]);
  });

  it("capitalises after a hyphen or a quote, and leaves words that start with a digit alone", () => {
    expect(lineTexts(box("well-known '90s 3rd", { textCase: "title", width: 600 }))).toEqual(["Well-Known '90s 3rd"]);
  });

  it("capitalises a word that is the first thing in the text", () => {
    expect(lineTexts(box("ñandú", { textCase: "title" }))).toEqual(["Ñandú"]);
  });

  it("leaves case alone by default", () => {
    expect(lineTexts(box("MiXeD", { textCase: "none" }))).toEqual(["MiXeD"]);
  });
});

describe("line breaks inside a paragraph", () => {
  it("starts a new line at a newline in a run without starting a new paragraph", () => {
    const el = createText({ paragraphs: [{ runs: [{ text: "one\ntwo" }, { text: " three" }] }], fontSize: 20, width: 300, autoWidth: false, lineHeight: 1.5 });
    const layout = layoutText(el);
    expect(lineTexts(el)).toEqual(["one", "two three"]);
    expect(layout.lines.map((l) => l.paragraph)).toEqual([0, 0]);
    expect(layout.lines[1].y).toBe(30);
  });

  it("keeps an empty line for two newlines in a row", () => {
    const el = createText({ paragraphs: [{ runs: [{ text: "a\n\nb" }] }], fontSize: 20, width: 300, autoWidth: false, lineHeight: 1.5 });
    expect(lineTexts(el)).toEqual(["a", "", "b"]);
  });
});

describe("alignAnchor", () => {
  it("is the fraction of an auto-width box that stays put when the text grows", () => {
    expect(alignAnchor("left")).toBe(0);
    expect(alignAnchor("justify")).toBe(0);
    expect(alignAnchor("center")).toBe(0.5);
    expect(alignAnchor("right")).toBe(1);
  });
});

describe("measureTextElement", () => {
  it("keeps the width of a fixed box and measures the height of the wrapped text", () => {
    const el = box("one two three four five six seven eight nine ten", { width: 100 });
    const size = measureTextElement(el);
    expect(size.width).toBe(100);
    expect(size.height).toBe(Math.ceil(layoutText(el).height));
    expect(size.height).toBeGreaterThan(60);
  });

  it("makes an auto-width box as wide as its widest line", () => {
    const el = createText({ text: "short\nmuch longer line", fontSize: 20, autoWidth: true, lineHeight: 1 });
    expect(measureTextElement(el).width).toBe(160);
    expect(measureTextElement(el).height).toBe(40);
  });
});

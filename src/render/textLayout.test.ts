import { beforeAll, describe, expect, it } from "vitest";
import { createText } from "@/core/factory";
import { setTextMeasurer } from "@/core/textMetrics";
import { curveGeometry, layoutText, measureTextElement } from "./textLayout";

// Deterministic metrics: every character is 0.5 em wide, ascent 0.8 em, descent 0.2 em.
beforeAll(() => {
  const size = (font: string) => parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
  setTextMeasurer({
    width: (font, text) => text.length * size(font) * 0.5,
    metrics: (font) => ({ ascent: size(font) * 0.8, descent: size(font) * 0.2 }),
  });
});

const box = (text: string, over: Parameters<typeof createText>[0] = {}) => createText({ text, fontSize: 20, width: 200, autoWidth: false, lineHeight: 1.5, ...over });
const lineText = (l: ReturnType<typeof layoutText>["lines"][number]) => l.segments.map((s) => s.text).join("");

describe("layoutText", () => {
  it("keeps short text on one line and measures it", () => {
    const l = layoutText(box("Hello"));
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0].width).toBe(50); // 5 chars * 10px
    expect(l.height).toBe(30); // 20px * 1.5
  });

  it("wraps at word boundaries inside the box width", () => {
    const l = layoutText(box("one two three four five six seven")); // 10px per char, 20 chars per line
    expect(l.lines.length).toBeGreaterThan(1);
    for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(200);
    expect(l.lines.map(lineText).join(" ")).toBe("one two three four five six seven");
  });

  it("drops the spaces at a soft wrap and trailing spaces", () => {
    const l = layoutText(box("aaaaaaaaaaaaaaaaaa bbbb ")); // first word is 18 chars = 180px
    expect(lineText(l.lines[0])).toBe("aaaaaaaaaaaaaaaaaa");
    expect(lineText(l.lines[1])).toBe("bbbb");
  });

  it("splits a word wider than the box into pieces", () => {
    const l = layoutText(box("x".repeat(45)));
    expect(l.lines.length).toBe(3);
    expect(l.lines.every((ln) => ln.width <= 200)).toBe(true);
  });

  it("starts a new paragraph on newlines and keeps empty lines", () => {
    const l = layoutText(box("a\n\nb"));
    expect(l.lines).toHaveLength(3);
    expect(l.lines[1].segments).toHaveLength(0);
    expect(l.height).toBe(90);
  });

  it("auto-width text never wraps and is as wide as its longest line", () => {
    const el = createText({ text: "Hello wide world\nhi", fontSize: 20, lineHeight: 1.2, autoWidth: true });
    const l = layoutText(el);
    expect(l.lines).toHaveLength(2);
    expect(l.width).toBe(160); // 16 chars
  });

  it("aligns lines inside the box", () => {
    const center = layoutText(box("Hello", { align: "center" }));
    expect(center.lines[0].x).toBe(75);
    const right = layoutText(box("Hello", { align: "right" }));
    expect(right.lines[0].x).toBe(150);
  });

  it("justifies all but the last line of a paragraph", () => {
    const l = layoutText(box("aaaa bbbb cccc dddd eeee ffff", { align: "justify" }));
    expect(l.lines.length).toBeGreaterThan(1);
    expect(Math.round(l.lines[0].width)).toBe(200);
    expect(l.lines[l.lines.length - 1].width).toBeLessThan(200);
  });

  it("indents list items and numbers them", () => {
    const l = layoutText(box("first\nsecond", { list: "number" }));
    expect(l.lines[0].marker?.text).toBe("1.");
    expect(l.lines[1].marker?.text).toBe("2.");
    expect(l.lines[0].x).toBeGreaterThan(0);
    const b = layoutText(box("x", { list: "bullet" }));
    expect(b.lines[0].marker?.text).toBe("•");
  });

  it("applies text case before measuring and line height per largest run", () => {
    const l = layoutText(box("abc", { textCase: "upper" }));
    expect(lineText(l.lines[0])).toBe("ABC");
    const mixed = layoutText(createText({ paragraphs: [{ runs: [{ text: "small " }, { text: "BIG", size: 60 }] }], fontSize: 20, width: 400, autoWidth: false, lineHeight: 1 }));
    expect(mixed.lines[0].size).toBe(60);
    expect(mixed.lines[0].height).toBe(60);
  });

  it("does not count trailing letter spacing in the painted width", () => {
    const l = layoutText(box("abcd", { letterSpacing: 500 })); // 0.5em = 10px per char
    expect(l.lines[0].width).toBe(4 * 10 + 4 * 10 - 10);
  });

  it("caches layouts per element object", () => {
    const el = box("cache me");
    expect(layoutText(el)).toBe(layoutText(el));
  });
});

describe("curved text", () => {
  it("has no geometry when straight", () => {
    const el = box("abc");
    expect(curveGeometry(el, layoutText(el))).toBeNull();
  });
  it("adds the sag of the arc to the box height", () => {
    const flat = box("A curved line of text");
    const curved = box("A curved line of text", { curve: 60 });
    const g = curveGeometry(curved, layoutText(curved))!;
    expect(g.sag).toBeGreaterThan(0);
    expect(g.dir).toBe(1);
    expect(measureTextElement(curved).height).toBeGreaterThan(measureTextElement(flat).height);
    expect(curveGeometry(box("x", { curve: -40 }), layoutText(box("x")))?.dir).toBe(-1);
  });
});

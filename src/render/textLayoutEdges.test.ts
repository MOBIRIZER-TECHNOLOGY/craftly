import { beforeAll, describe, expect, it } from "vitest";
import { createText } from "@/core/factory";
import { setTextMeasurer } from "@/core/textMetrics";
import { layoutText } from "./textLayout";

// Every character is 10 px wide at 20 px, ascent 0.8 em, descent 0.2 em.
beforeAll(() => {
  const size = (font: string) => parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
  setTextMeasurer({
    width: (font, text) => text.length * size(font) * 0.5,
    metrics: (font) => ({ ascent: size(font) * 0.8, descent: size(font) * 0.2 }),
  });
});

type TextInit = NonNullable<Parameters<typeof createText>[0]>;
const make = (paragraphs: TextInit["paragraphs"], over: TextInit = {}) => createText({ paragraphs, fontSize: 20, width: 100, autoWidth: false, lineHeight: 1.5, ...over });
const texts = (el: ReturnType<typeof createText>) => layoutText(el).lines.map((l) => l.segments.map((s) => s.text).join(""));

describe("spaces at the start of a line", () => {
  it("keeps the spaces that start a paragraph", () => {
    expect(texts(make([{ runs: [{ text: "  indented" }] }], { width: 300 }))).toEqual(["  indented"]);
  });

  it("drops the spaces that begin a line after a line break inside a paragraph", () => {
    expect(texts(make([{ runs: [{ text: "one\n   two" }] }], { width: 300 }))).toEqual(["one", "two"]);
  });

  it("keeps a lone space as an empty-looking line of no width", () => {
    const layout = layoutText(make([{ runs: [{ text: " " }] }], { width: 300 }));
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].width).toBe(0);
  });
});

describe("words that do not fit", () => {
  it("keeps a word that fits on its own after leading spaces, even though the spaces make the line too long", () => {
    // two spaces (20 px) and a 10 letter word (100 px) in a 100 px box
    expect(texts(make([{ runs: [{ text: "  abcdefghij" }] }]))).toEqual(["  abcdefghij"]);
  });

  it("lets a single letter wider than the box overflow rather than loop", () => {
    const layout = layoutText(make([{ runs: [{ text: "W" }] }], { width: 8 }));
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].width).toBe(10);
  });

  it("breaks a long word into pieces that fit and carries on with the next word", () => {
    expect(texts(make([{ runs: [{ text: "abcdefghijklmno pq" }] }]))).toEqual(["abcdefghij", "klmno pq"]);
  });
});

describe("runs", () => {
  it("joins neighbouring runs that look the same into one segment", () => {
    const layout = layoutText(make([{ runs: [{ text: "foo" }, { text: "bar" }] }], { width: 300 }));
    expect(layout.lines[0].segments).toHaveLength(1);
    expect(layout.lines[0].segments[0].text).toBe("foobar");
    expect(layout.lines[0].segments[0].width).toBe(60);
  });

  it("keeps runs that differ apart", () => {
    const layout = layoutText(make([{ runs: [{ text: "foo" }, { text: "bar", color: "#ff0000" }] }], { width: 300 }));
    expect(layout.lines[0].segments.map((s) => s.text)).toEqual(["foo", "bar"]);
    expect(layout.lines[0].segments[1].x).toBe(30);
  });

  it("sizes the line after its biggest run wherever it stands", () => {
    const big = layoutText(make([{ runs: [{ text: "BIG", size: 60 }, { text: " small" }] }], { width: 600 }));
    expect(big.lines[0].size).toBe(60);
    expect(big.lines[0].height).toBe(90);
    const late = layoutText(make([{ runs: [{ text: "small " }, { text: "BIG", size: 60 }] }], { width: 600 }));
    expect(late.lines[0].size).toBe(60);
  });

  it("gives a paragraph without runs one empty line in the element's own size", () => {
    const layout = layoutText(make([{ runs: [] }], { width: 300 }));
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].segments).toHaveLength(0);
    expect(layout.lines[0].height).toBe(30);
    expect(layout.height).toBe(30);
  });
});

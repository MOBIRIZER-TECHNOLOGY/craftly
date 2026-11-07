import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createText, plainParagraphs } from "@/core/factory";
import type { TextParagraph } from "@/core/types";
import { findMatches, replaceInParagraphs, replaceRange } from "./findReplace";

/* The edges of the find and replace logic: findReplace.test.ts has the main behaviour. */

const text = (p: TextParagraph) => p.runs.map((r) => r.text).join("");

describe("findMatches: unusual searches", () => {
  const designOf = (...boxes: string[]) => createDesign({ width: 800, height: 600, pages: [createPage({ elements: boxes.map((t) => createText({ text: t })) })] });

  it("does not count overlapping occurrences twice", () => {
    const matches = findMatches(designOf("aaaa"), "aa", false);
    expect(matches.map((m) => [m.start, m.end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("finds a query that is longer than the text nowhere", () => {
    expect(findMatches(designOf("hi"), "hello", false)).toEqual([]);
  });

  it("matches spaces and punctuation literally, not as a pattern", () => {
    const matches = findMatches(designOf("a.b (a+b) a b"), "a.b", false);
    expect(matches).toHaveLength(1);
    expect(findMatches(designOf("a+b and a+b"), "a+b", false)).toHaveLength(2);
  });

  it("skips text in a hidden group and keeps the reading order across pages", () => {
    const hidden = createGroup([createText({ text: "needle hidden" })], { hidden: true });
    const shown = createGroup([createText({ text: "needle shown" })]);
    const design = createDesign({
      width: 800,
      height: 600,
      pages: [createPage({ elements: [hidden, shown] }), createPage({ elements: [createText({ text: "needle on page two" })] })],
    });
    const matches = findMatches(design, "needle", false);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.pageIndex)).toEqual([0, 1]);
    expect(matches[0].topId).toBe(shown.id);
  });

  it("finds a match in every paragraph of a text box", () => {
    const box = createText({ text: "one needle\ntwo\nthree needle" });
    const design = createDesign({ width: 800, height: 600, pages: [createPage({ elements: [box] })] });
    expect(findMatches(design, "needle", false).map((m) => m.para)).toEqual([0, 2]);
  });
});

describe("replaceRange: edges", () => {
  it("adds the replacement to the last run when the range is past the end of the text", () => {
    const paragraph: TextParagraph = { runs: [{ text: "abc", bold: true }] };
    const out = replaceRange(paragraph, 3, 3, "!");
    expect(out.runs).toEqual([{ text: "abc!", bold: true }]);
  });

  it("starts a run for a paragraph that has none", () => {
    expect(replaceRange({ runs: [] }, 0, 0, "new")).toEqual({ runs: [{ text: "new" }] });
  });

  it("keeps the paragraph's own settings", () => {
    const paragraph: TextParagraph = { runs: [{ text: "abc" }], align: "center" };
    const out = replaceRange(paragraph, 0, 1, "X");
    expect(out.align).toBe("center");
    expect(text(out)).toBe("Xbc");
  });
});

describe("replaceInParagraphs: edges", () => {
  it("ignores a range that points at a paragraph that is not there", () => {
    const paragraphs = plainParagraphs("one\ntwo");
    const out = replaceInParagraphs(paragraphs, [{ para: 5, start: 0, end: 1 }], "x");
    expect(out.map(text)).toEqual(["one", "two"]);
  });

  it("replaces nothing for an empty list of ranges and returns copies", () => {
    const paragraphs = plainParagraphs("same");
    const out = replaceInParagraphs(paragraphs, [], "x");
    expect(out.map(text)).toEqual(["same"]);
    expect(out[0]).not.toBe(paragraphs[0]);
  });

  it("can delete several matches at once", () => {
    const out = replaceInParagraphs(
      plainParagraphs("a-b-c"),
      [
        { para: 0, start: 1, end: 2 },
        { para: 0, start: 3, end: 4 },
      ],
      "",
    );
    expect(out.map(text)).toEqual(["abc"]);
  });
});

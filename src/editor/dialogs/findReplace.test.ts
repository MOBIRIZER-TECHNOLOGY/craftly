import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createShape, createText, plainParagraphs } from "@/core/factory";
import type { TextParagraph } from "@/core/types";
import { findMatches, isAfter, replaceInParagraphs, replaceRange } from "./findReplace";

const text = (p: TextParagraph) => p.runs.map((r) => r.text).join("");

describe("findMatches", () => {
  const first = createPage();
  const second = createPage();
  const hello = createText({ text: "Hello world, hello again" });
  const lines = createText({ text: "no match here\nsay HELLO twice: hello" });
  const hidden = createText({ text: "hello hidden", hidden: true });
  const inGroup = createText({ text: "hello from a group" });
  const group = createGroup([inGroup], { locked: true });
  first.elements.push(hello, createShape("rect"), lines, hidden);
  second.elements.push(group);
  const design = createDesign({ width: 1000, height: 1000, pages: [first, second] });

  it("finds every occurrence, ignoring case by default", () => {
    const m = findMatches(design, "hello", false);
    // 2 in the first box, 2 in the second box, 1 in the group; the hidden box is skipped
    expect(m).toHaveLength(5);
    expect(m.map((x) => x.pageIndex)).toEqual([0, 0, 0, 0, 1]);
  });

  it("can be case sensitive", () => {
    expect(findMatches(design, "hello", true)).toHaveLength(3);
    expect(findMatches(design, "HELLO", true)).toHaveLength(1);
  });

  it("reports offsets inside the paragraph they belong to", () => {
    const m = findMatches(design, "hello", false).filter((x) => x.elementId === lines.id);
    expect(m.map((x) => [x.para, x.start, x.end])).toEqual([
      [1, 4, 9],
      [1, 17, 22],
    ]);
  });

  it("selects the group around a match inside it and remembers that it is locked", () => {
    const m = findMatches(design, "group", false);
    expect(m).toHaveLength(1);
    expect(m[0].elementId).toBe(inGroup.id);
    expect(m[0].topId).toBe(group.id);
    expect(m[0].locked).toBe(true);
  });

  it("keeps the reading order of text boxes", () => {
    const orders = findMatches(design, "hello", false).map((x) => x.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches(design, "", false)).toEqual([]);
  });
});

describe("replaceRange", () => {
  const styled: TextParagraph = { runs: [{ text: "Hello " }, { text: "bold", bold: true }, { text: " world" }] };

  it("replaces inside one run and keeps its style", () => {
    const out = replaceRange(styled, 6, 10, "strong");
    expect(out.runs.map((r) => r.text)).toEqual(["Hello ", "strong", " world"]);
    expect(out.runs[1].bold).toBe(true);
  });

  it("replaces across runs: the replacement takes the style of the first run it touches", () => {
    const out = replaceRange(styled, 3, 8, "XY");
    expect(text(out)).toBe("HelXYld world");
    expect(out.runs[0].text).toBe("HelXY");
    expect(out.runs[0].bold).toBeUndefined();
    expect(out.runs[1].text).toBe("ld");
    expect(out.runs[1].bold).toBe(true);
  });

  it("can delete a match", () => {
    expect(text(replaceRange(styled, 5, 10, ""))).toBe("Hello world");
  });

  it("works at the start and the end of the paragraph", () => {
    expect(text(replaceRange(styled, 0, 5, "Bye"))).toBe("Bye bold world");
    expect(text(replaceRange(styled, 15, 16, "!"))).toBe("Hello bold worl!");
  });
});

describe("replaceInParagraphs", () => {
  it("replaces several matches in several paragraphs without disturbing offsets", () => {
    const paragraphs = plainParagraphs("aa bb aa\ncc aa");
    const out = replaceInParagraphs(
      paragraphs,
      [
        { para: 0, start: 0, end: 2 },
        { para: 0, start: 6, end: 8 },
        { para: 1, start: 3, end: 5 },
      ],
      "LONGER",
    );
    expect(out.map(text)).toEqual(["LONGER bb LONGER", "cc LONGER"]);
  });

  it("does not mutate its input", () => {
    const paragraphs = plainParagraphs("one two");
    replaceInParagraphs(paragraphs, [{ para: 0, start: 0, end: 3 }], "1");
    expect(text(paragraphs[0])).toBe("one two");
  });
});

describe("isAfter", () => {
  const base = { pageId: "p", pageIndex: 0, elementId: "e", topId: "e", locked: false, end: 0 };
  it("orders by text box, paragraph and offset (after the replaced text)", () => {
    const m = { ...base, order: 1, para: 0, start: 4 };
    expect(isAfter({ ...base, order: 2, para: 0, start: 0, end: 1 }, m, 3)).toBe(true);
    expect(isAfter({ ...base, order: 1, para: 1, start: 0, end: 1 }, m, 3)).toBe(true);
    expect(isAfter({ ...base, order: 1, para: 0, start: 6, end: 7 }, m, 3)).toBe(false);
    expect(isAfter({ ...base, order: 1, para: 0, start: 7, end: 8 }, m, 3)).toBe(true);
    expect(isAfter({ ...base, order: 0, para: 5, start: 0, end: 1 }, m, 3)).toBe(false);
  });
});

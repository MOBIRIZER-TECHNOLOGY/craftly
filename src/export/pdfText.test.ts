import { describe, expect, it } from "vitest";
import { createGroup, createPage, createShape, createTable, createText } from "@/core/factory";
import type { DesignElement } from "@/core/types";
import { layoutText } from "@/render/textLayout";
import type { PdfTextLine } from "./pdf";
import { collectPageText } from "./pdfText";

// In node the text measurer is the estimate of core/textMetrics: a character is 0.55 of the font size wide, the
// ascent 0.95 and the descent 0.25. A line of size 40 with line height 1.25 is 50 high with its baseline at 39.

const DESIGN = { width: 800, height: 600 };
const collect = (...elements: DesignElement[]) => collectPageText(DESIGN, createPage({ elements }));
const texts = (lines: PdfTextLine[]) => lines.map((l) => l.pieces.map((p) => p.text).join(""));
// (+ 0 turns the -0 that rounding a tiny negative number gives into 0)
const rounded = (line: PdfTextLine) => line.matrix.map((n) => Math.round(n * 1000) / 1000 + 0);

describe("collectPageText", () => {
  it("gives a line its place in points from the top-left and every word its x and width", () => {
    const lines = collect(createText({ text: "Hello world", x: 40, y: 50, fontSize: 40 }));
    expect(lines).toHaveLength(1);
    // baseline at 50 + 39 design pixels; a design pixel is 0.75 pt
    expect(rounded(lines[0])).toEqual([0.75, 0, 0, 0.75, 30, 66.75]);
    expect(lines[0].pieces.map((p) => ({ ...p, x: Math.round(p.x * 100) / 100, width: Math.round(p.width * 100) / 100 }))).toEqual([
      { text: "Hello", x: 0, width: 110, size: 40 },
      { text: " ", x: 110, width: 22, size: 40 },
      { text: "world", x: 132, width: 110, size: 40 },
    ]);
  });

  it("breaks the lines where the renderer breaks them and keeps them in order", () => {
    const el = createText({ text: "one two three four five six\nseven", x: 0, y: 0, fontSize: 20, width: 100 });
    const layout = layoutText(el);
    expect(layout.lines.length).toBeGreaterThan(3);
    const lines = collect(el);
    expect(texts(lines)).toEqual(layout.lines.map((l) => l.segments.map((s) => s.text).join("")));
    expect(texts(lines).join(" ").replace(/\s+/g, " ")).toBe("one two three four five six seven");
    // each line one line box (25) lower than the one before
    expect(lines.map((l) => Math.round((l.matrix[5] - lines[0].matrix[5]) / 0.75))).toEqual(lines.map((_l, i) => i * 25));
  });

  it("starts a centred or right aligned line where it is painted", () => {
    const lines = collect(
      createText({ text: "ab", x: 100, y: 0, fontSize: 20, width: 200, align: "right" }),
      createText({ text: "ab", x: 100, y: 0, fontSize: 20, width: 200, align: "center" }),
    );
    // the two letters are 22 wide: the right aligned line starts at 178, the centred one at 89
    expect(lines.map((l) => Math.round(l.pieces[0].x))).toEqual([178, 89]);
  });

  it("writes the text in the case it is shown in, each run in its own size, and the marker of a list", () => {
    const upper = collect(createText({ text: "Shout", textCase: "upper", fontSize: 20 }));
    expect(texts(upper)).toEqual(["SHOUT"]);
    const mixed = collect(createText({ paragraphs: [{ runs: [{ text: "big ", size: 60 }, { text: "small" }] }], fontSize: 20 }));
    expect(mixed[0].pieces.map((p) => [p.text, p.size])).toEqual([
      ["big", 60],
      [" ", 60],
      ["small", 20],
    ]);
    const list = collect(createText({ text: "first\nsecond", list: "number", fontSize: 20, width: 300 }));
    expect(list.map((l) => l.pieces.map((p) => p.text))).toEqual([
      ["1.", "first"],
      ["2.", "second"],
    ]);
    // the marker stands at the left edge, the item after the indent of 1.25 em
    expect(list[0].pieces.map((p) => p.x)).toEqual([0, 25]);
    expect(list[0].pieces[0].width).toBeCloseTo(22);
  });

  it("turns with a rotated element, around the element's centre", () => {
    const el = createText({ text: "Hello", x: 100, y: 100, fontSize: 40, rotation: 90 });
    const [line] = collect(el);
    const [a, b, c, d, e, f] = rounded(line);
    expect([a, b, c, d]).toEqual([0, 0.75, -0.75, 0]);
    // the baseline's start: (0, 39) in the element, turned a quarter around the centre (w / 2, h / 2)
    const cx = 100 + el.width / 2;
    const cy = 100 + el.height / 2;
    expect(e).toBeCloseTo((cx - (39 - el.height / 2)) * 0.75, 2);
    expect(f).toBeCloseTo((cy - el.width / 2) * 0.75, 2);
  });

  it("follows a text into a group, a turned one included", () => {
    const inner = createText({ text: "Inside", x: 10, y: 20, fontSize: 40 });
    const [plain] = collect(createGroup([inner], { x: 300, y: 200, width: 400, height: 200 }));
    expect(rounded(plain)).toEqual([0.75, 0, 0, 0.75, 310 * 0.75, (220 + 39) * 0.75]);
    const [turned] = collect(createGroup([inner], { x: 300, y: 200, width: 400, height: 200, rotation: 180 }));
    // half a turn around the group's centre (500, 300): the point (310, 259) lands at (690, 341)
    expect(rounded(turned)).toEqual([-0.75, 0, 0, -0.75, 690 * 0.75, 341 * 0.75]);
  });

  it("mirrors with a flipped element", () => {
    const el = createText({ text: "Hello", x: 100, y: 100, fontSize: 40, flipH: true });
    const [line] = collect(el);
    expect(rounded(line)).toEqual([-0.75, 0, 0, 0.75, (100 + el.width) * 0.75, 139 * 0.75]);
  });

  it("leaves out what is not seen: hidden, fully transparent, inside such a group, or empty", () => {
    const shown = createText({ text: "seen", fontSize: 20 });
    const lines = collect(
      createText({ text: "hidden", hidden: true }),
      createText({ text: "clear", opacity: 0 }),
      createGroup([createText({ text: "in a hidden group" })], { hidden: true }),
      createGroup([createText({ text: "in a clear group" })], { opacity: 0 }),
      createText({ text: "" }),
      createText({ text: "   " }),
      createShape("rect", {}),
      createGroup([shown], { opacity: 0.4 }),
    );
    expect(texts(lines)).toEqual(["seen"]);
  });

  it("leaves out a line that lies wholly off the page and keeps one that is partly on it", () => {
    const lines = collect(
      createText({ text: "far left", x: -500, y: 100, fontSize: 20 }),
      createText({ text: "below", x: 10, y: 700, fontSize: 20 }),
      createText({ text: "above", x: 10, y: -100, fontSize: 20 }),
      createText({ text: "far right", x: 900, y: 10, fontSize: 20 }),
      createText({ text: "half on the page", x: 760, y: 10, fontSize: 20 }),
      // of this text only the lower lines are on the page
      createText({ text: "a\nb\nc\nd", x: 10, y: -60, fontSize: 20 }),
    );
    expect(texts(lines)).toEqual(["half on the page", "c", "d"]);
  });

  it("places the words of curved text one by one along the arc", () => {
    const el = createText({ text: "round and round", x: 100, y: 100, fontSize: 40, curve: 60 });
    const lines = collect(el);
    expect(texts(lines)).toEqual(["round", "and", "round"]);
    // an arch: the first word climbs (turned against the clock), the last one falls
    const angle = (l: PdfTextLine) => (Math.atan2(l.matrix[1], l.matrix[0]) * 180) / Math.PI;
    expect(angle(lines[0])).toBeLessThan(-10);
    expect(Math.abs(angle(lines[1]))).toBeLessThan(8);
    expect(angle(lines[2])).toBeGreaterThan(10);
    // the middle word sits higher on the page than the outer ones
    expect(lines[1].matrix[5]).toBeLessThan(lines[0].matrix[5]);
    // a bow turns the other way
    const bow = collect({ ...el, curve: -60 });
    expect(angle(bow[0])).toBeGreaterThan(10);
    expect(bow[1].matrix[5]).toBeGreaterThan(bow[0].matrix[5]);
    // a curve too slight to bend the text is written as straight text
    expect(texts(collect({ ...el, curve: 0.2 }))).toEqual(["round and round"]);
  });

  it("writes the cells of a table row by row, wrapped and aligned as they are painted", () => {
    const table = createTable({
      x: 100,
      y: 50,
      width: 400,
      height: 200,
      colWidths: [100, 100],
      rowHeights: [50, 50],
      fontSize: 20,
      cells: [
        ["Name", "A long heading that wraps"],
        ["", "x"],
      ],
    });
    const lines = collect(table);
    expect(texts(lines)).toEqual(["Name", "A long heading", "that wraps", "x"]);
    // the columns are scaled to the element (200 each), the padding is half the font size, the row 100 high:
    // one line is centred on the middle of its row, its baseline (0.95 - 0.25) / 2 of the size below the middle
    expect(lines[0].matrix[4]).toBeCloseTo((100 + 10) * 0.75);
    expect(lines[0].matrix[5]).toBeCloseTo((50 + 50 + 7) * 0.75);
    expect(lines[0].pieces[0]).toMatchObject({ x: 0, size: 20 });
    expect(lines[0].pieces[0].width).toBeCloseTo(44);
    // two lines share the middle: 12.5 above and below it
    expect(lines[1].matrix[5]).toBeCloseTo((50 + 50 - 12.5 + 7) * 0.75);
    expect(lines[2].matrix[5]).toBeCloseTo((50 + 50 + 12.5 + 7) * 0.75);
    expect(lines[3].matrix[4]).toBeCloseTo((100 + 200 + 10) * 0.75);

    const right = collect({ ...table, align: "right" });
    // "Name" is 44 wide and ends at the padding of its cell
    expect(right[0].matrix[4]).toBeCloseTo((100 + 200 - 10 - 44) * 0.75);
    const centred = collect({ ...table, align: "center" });
    expect(centred[0].matrix[4]).toBeCloseTo((100 + 100 - 22) * 0.75);
  });

  it("leaves out the lines of a cell that its row is too low to show", () => {
    // five lines of 25 in a row of 40: the cell clips all but the middle one
    const table = createTable({
      x: 0,
      y: 200,
      width: 200,
      height: 40,
      colWidths: [200],
      rowHeights: [40],
      fontSize: 20,
      cells: [["one two three four five six seven eight nine ten eleven twelve"]],
    });
    expect(texts(collect(table))).toEqual(["seven eight nine"]);
  });

  it("copes with a table whose cells or sizes are missing, as the painter does", () => {
    // a row with fewer cells than columns: the missing ones are empty
    expect(texts(collect(createTable({ x: 0, y: 0, cells: [["Only"]] })))).toEqual(["Only"]);
    // sizes that add up to nothing: the painter falls back to the size of the element
    expect(texts(collect(createTable({ x: 0, y: 100, width: 300, height: 100, colWidths: [0], rowHeights: [0], cells: [["Zero"]] })))).toEqual(["Zero"]);
  });

  it("writes nothing for a page without text", () => {
    expect(collect(createShape("rect", {}))).toEqual([]);
    expect(collectPageText(DESIGN, createPage())).toEqual([]);
  });
});

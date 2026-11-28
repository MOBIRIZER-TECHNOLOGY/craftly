import { describe, expect, it } from "vitest";
import { createChart, createFrame, createGraphic, createGroup, createImage, createLine, createPage, createShape, createTable, createText } from "@/core/factory";
import type { Fill, TextEffect } from "@/core/types";
import {
  addChartRow,
  addChartSeries,
  addTableColumn,
  addTableRow,
  chartColor,
  normalizeTable,
  removeChartRow,
  removeChartSeries,
  removeTableColumn,
  removeTableRow,
  setChartPaletteColor,
  tableSize,
} from "./dataEdit";
import { resizeSingle } from "./boxEdit";
import { sameColor } from "./colorTargets";
import { collectDocumentColors } from "./docColors";
import { alphaOf, fromShadow, getEffectDef, withAlpha } from "./effectModels";
import { layerKind, layerName } from "./layerInfo";
import { firstColor, paintCss } from "./paintCss";
import { collectTexts, forEachText, isImage, supportsShadow, supportsStroke } from "./selectionKinds";

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

describe("table grid repair", () => {
  it("makes row heights and column widths match the cells and add up to the element's box", () => {
    const t = createTable({
      cells: [
        ["a", "b", "c"],
        ["d", "e", "f"],
        ["g", "h", "i"],
      ],
      width: 600,
      height: 300,
    });
    t.rowHeights = [100];
    t.colWidths = [10, 10, 10, 10, 10];
    normalizeTable(t);
    expect(t.rowHeights).toHaveLength(3);
    expect(t.colWidths).toHaveLength(3);
    expect(sum(t.rowHeights)).toBeCloseTo(300);
    expect(sum(t.colWidths)).toBeCloseTo(600);
    // new rows start at the average of the existing ones
    expect(t.rowHeights[1]).toBeCloseTo(t.rowHeights[0]);
  });

  it("copes with a table without cells and with sizes that are all zero", () => {
    const empty = createTable({ cells: [], width: 600, height: 300 });
    normalizeTable(empty);
    expect(empty.rowHeights).toEqual([]);
    expect(empty.colWidths).toEqual([]);
    const flat = createTable({ cells: [["a"], ["b"]], width: 600, height: 300 });
    flat.rowHeights = [0, 0];
    normalizeTable(flat);
    expect(flat.rowHeights).toEqual([0, 0]);
  });

  it("starts the first size from an even share when there are no sizes yet", () => {
    const t = createTable({ cells: [["a", "b"]], width: 400, height: 100 });
    t.colWidths = [];
    normalizeTable(t);
    expect(t.colWidths).toEqual([200, 200]);
  });

  it("inserts rows and columns inside the grid, clamping the position", () => {
    const t = createTable({
      cells: [
        ["a", "b"],
        ["c", "d"],
      ],
      colWidths: [100, 100],
      rowHeights: [50, 50],
      width: 200,
      height: 100,
    });
    addTableRow(t, -5);
    expect(t.cells[0]).toEqual(["", ""]);
    addTableRow(t, 99);
    expect(t.cells[t.cells.length - 1]).toEqual(["", ""]);
    addTableColumn(t, -3);
    expect(t.cells.every((r) => r.length === 3)).toBe(true);
    // the header row names new columns after their position
    expect(t.cells[0][0]).toBe("Heading 1");
    t.headerRow = false;
    addTableColumn(t, 99);
    expect(t.cells[0][3]).toBe("");
  });

  it("ignores removals of rows and columns that do not exist", () => {
    const t = createTable({
      cells: [
        ["a", "b"],
        ["c", "d"],
      ],
      colWidths: [100, 100],
      rowHeights: [50, 50],
      width: 200,
      height: 100,
    });
    removeTableRow(t, -1);
    removeTableRow(t, 2);
    removeTableColumn(t, -1);
    removeTableColumn(t, 2);
    expect(t.cells).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("counts no rows and no columns in a table without cells", () => {
    expect(tableSize({ cells: [] })).toEqual({ rows: 0, cols: 0 });
    expect(tableSize({ cells: [["a", "b", "c"]] })).toEqual({ rows: 1, cols: 3 });
  });
});

describe("merged cells and cell styles follow row and column edits", () => {
  /** A 3 by 3 table, 300 by 300, with nothing merged or styled yet. */
  const grid = () =>
    createTable({
      cells: [
        ["a", "b", "c"],
        ["d", "e", "f"],
        ["g", "h", "i"],
      ],
      colWidths: [100, 100, 100],
      rowHeights: [100, 100, 100],
      width: 300,
      height: 300,
    });

  it("moves the merges and styles at or under an inserted row down, and leaves those above it", () => {
    const t = grid();
    t.merges = [
      { row: 0, col: 1, rowSpan: 1, colSpan: 2 },
      { row: 1, col: 0, rowSpan: 2, colSpan: 2 },
    ];
    t.cellStyles = { "0:0": { bold: true }, "1:0": { fill: "#ff0000" }, "2:2": { align: "right" } };
    addTableRow(t, 1);
    expect(t.cells.map((row) => row[0])).toEqual(["a", "", "d", "g"]);
    expect(t.merges).toEqual([
      { row: 0, col: 1, rowSpan: 1, colSpan: 2 },
      { row: 2, col: 0, rowSpan: 2, colSpan: 2 },
    ]);
    expect(t.cellStyles).toEqual({ "0:0": { bold: true }, "2:0": { fill: "#ff0000" }, "3:2": { align: "right" } });
  });

  it("moves the merges and styles at or right of an inserted column along, and leaves those left of it", () => {
    const t = grid();
    t.merges = [
      { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
    ];
    t.cellStyles = { "2:0": { bold: true }, "0:1": { color: "#00ff00" } };
    addTableColumn(t, 1);
    expect(t.cells[1]).toEqual(["d", "", "e", "f"]);
    expect(t.merges).toEqual([
      { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { row: 1, col: 2, rowSpan: 1, colSpan: 2 },
    ]);
    expect(t.cellStyles).toEqual({ "2:0": { bold: true }, "0:2": { color: "#00ff00" } });
  });

  it("drops the styles of a removed row, moves those under it up, and shrinks a merge that reached the last row", () => {
    const t = grid();
    t.merges = [
      { row: 0, col: 0, rowSpan: 3, colSpan: 1 },
      { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
    ];
    t.cellStyles = { "0:0": { bold: true }, "1:1": { fill: "#ff0000" }, "2:2": { align: "center" } };
    removeTableRow(t, 2);
    expect(t.cells).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    // the tall merge ran to the end of the table, so it ends where the table now ends
    expect(t.merges).toEqual([
      { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
    ]);
    expect(t.cellStyles).toEqual({ "0:0": { bold: true }, "1:1": { fill: "#ff0000" } });

    const u = grid();
    u.cellStyles = { "0:0": { bold: true }, "1:1": { fill: "#ff0000" }, "2:2": { align: "center" } };
    removeTableRow(u, 0);
    expect(u.cellStyles).toEqual({ "0:1": { fill: "#ff0000" }, "1:2": { align: "center" } });
    expect(u.merges).toBeUndefined();
  });

  it("drops the styles of a removed column, moves those right of it back, and narrows a merge that reached the last column", () => {
    const t = grid();
    t.merges = [{ row: 2, col: 0, rowSpan: 1, colSpan: 3 }];
    t.cellStyles = { "0:0": { bold: true }, "0:1": { fill: "#ff0000" }, "1:2": { align: "right" } };
    removeTableColumn(t, 1);
    expect(t.cells).toEqual([
      ["a", "c"],
      ["d", "f"],
      ["g", "i"],
    ]);
    expect(t.merges).toEqual([{ row: 2, col: 0, rowSpan: 1, colSpan: 2 }]);
    expect(t.cellStyles).toEqual({ "0:0": { bold: true }, "1:1": { align: "right" } });
  });

  it("throws away merges and style keys that point outside the grid, and the list of merges once it is empty", () => {
    const t = grid();
    t.merges = [
      { row: -1, col: 0, rowSpan: 1, colSpan: 2 },
      { row: 0, col: -1, rowSpan: 1, colSpan: 2 },
      { row: 9, col: 0, rowSpan: 1, colSpan: 2 },
      { row: 0, col: 9, rowSpan: 1, colSpan: 2 },
      { row: 0, col: 0, rowSpan: 5, colSpan: 0 },
    ];
    t.cellStyles = { "-1:0": { bold: true }, "1:1": { bold: true } };
    addTableRow(t);
    // the one merge inside the grid is kept, its spans brought inside the grid too
    expect(t.merges).toEqual([{ row: 0, col: 0, rowSpan: 4, colSpan: 1 }]);
    expect(t.cellStyles).toEqual({ "1:1": { bold: true } });

    const u = grid();
    u.merges = [{ row: 7, col: 7, rowSpan: 1, colSpan: 1 }];
    addTableColumn(u);
    expect(u).not.toHaveProperty("merges");
    // an empty list is not kept either
    const v = grid();
    v.merges = [];
    addTableRow(v);
    expect(v).not.toHaveProperty("merges");
  });

  it("keeps no merges when a column is added to a table without cells", () => {
    const t = createTable({ cells: [], width: 300, height: 300 });
    t.merges = [{ row: 0, col: 0, rowSpan: 1, colSpan: 1 }];
    addTableColumn(t);
    expect(t.cells).toEqual([]);
    expect(t).not.toHaveProperty("merges");
  });
});

describe("chart data", () => {
  it("starts a new row from the average of each series, or 10 when it has no values", () => {
    const c = createChart({
      labels: ["A"],
      series: [
        { name: "x", values: [10, 21] },
        { name: "y", values: [] },
      ],
    });
    addChartRow(c);
    expect(c.series[0].values).toEqual([10, 21, 16]);
    expect(c.series[1].values).toEqual([10]);
    expect(c.labels).toEqual(["A", "Item 2"]);
  });

  it("starts a new series from the average of the others, counting missing values as 0", () => {
    const c = createChart({
      labels: ["A", "B"],
      series: [
        { name: "x", values: [10] },
        { name: "y", values: [20, 30] },
      ],
    });
    addChartSeries(c);
    expect(c.series[2].values).toEqual([15, 15]);
  });

  it("ignores removals that do not exist", () => {
    const c = createChart({
      labels: ["A", "B"],
      series: [
        { name: "x", values: [1, 2] },
        { name: "y", values: [3, 4] },
      ],
    });
    removeChartRow(c, -1);
    removeChartRow(c, 2);
    removeChartSeries(c, -1);
    removeChartSeries(c, 2);
    expect(c.labels).toHaveLength(2);
    expect(c.series).toHaveLength(2);
  });

  it("finds the colour a slice or series is drawn with", () => {
    const c = createChart({
      chart: "line",
      palette: ["#111111", "#222222"],
      series: [
        { name: "x", values: [1], color: "#abcdef" },
        { name: "y", values: [2] },
        { name: "z", values: [3] },
      ],
    });
    expect(chartColor(c, 0)).toBe("#abcdef");
    expect(chartColor(c, 1)).toBe("#222222");
    // more series than palette colours: the palette repeats
    expect(chartColor(c, 2)).toBe("#111111");
    c.chart = "donut";
    expect(chartColor(c, 0)).toBe("#111111");
    expect(chartColor(c, 3)).toBe("#222222");
  });

  it("does nothing to a chart without a palette", () => {
    const c = createChart({ palette: [] });
    setChartPaletteColor(c, 0, "#ff0000");
    expect(c.palette).toEqual([]);
    const d = createChart({ palette: ["#111111", "#222222"] });
    setChartPaletteColor(d, 3, "#ff0000");
    expect(d.palette).toEqual(["#111111", "#ff0000"]);
  });
});

describe("effect models for odd input", () => {
  it("falls back to 'none' for an effect that does not exist", () => {
    expect(getEffectDef("sparkle" as TextEffect["kind"]).kind).toBe("none");
  });

  it("keeps a colour it cannot read as it is", () => {
    expect(withAlpha("not a colour", 0.5)).toBe("not a colour");
    expect(alphaOf("not a colour")).toBe(1);
  });

  it("treats a shadow with an unreadable colour as opaque black", () => {
    expect(fromShadow({ color: "nope", blur: 0, x: 0, y: 0 }, 1)).toMatchObject({ color: "#000000", transparency: 0 });
  });
});

describe("document colours", () => {
  it("skips missing fills and reads photo borders, pie slices and graphics without overrides", () => {
    const shape = createShape("rect", { fill: null as unknown as Fill });
    const photo = createImage({ src: "x", stroke: { color: "#123456", width: 2, style: "solid" } });
    const pie = createChart({ chart: "pie", labels: ["A", "B"], series: [{ name: "s", values: [1, 2] }], palette: ["#aa0000", "#00aa00", "#0000aa"] });
    const icon = createGraphic({ svg: '<svg viewBox="0 0 10 10" fill="currentColor"><path fill="#ff0000" d="M0 0h10v10z"/></svg>' });
    const colors = collectDocumentColors({ pages: [createPage({ elements: [shape, photo, pie, icon] })] });
    expect(colors).toContain("#123456");
    // a pie shows one colour per label, the third palette slot is unused
    expect(colors).toContain("#aa0000");
    expect(colors).toContain("#00aa00");
    expect(colors).not.toContain("#0000aa");
    expect(colors).toContain("#ff0000");
    expect(colors).not.toContain("currentColor");
    expect(colors).toContain("#0e1318");
  });
});

describe("layer names and kinds", () => {
  it("labels every kind of element", () => {
    const kinds = [
      layerKind(createText({ text: "x" })),
      layerKind(createShape("rect")),
      layerKind(createLine()),
      layerKind(createImage({ src: "x" })),
      layerKind(createFrame("rect")),
      layerKind(createGraphic({ svg: '<svg viewBox="0 0 1 1"></svg>' })),
      layerKind(createGroup([])),
      layerKind(createTable()),
      layerKind(createChart()),
    ];
    expect(kinds).toEqual(["Text", "Shape", "Line", "Image", "Frame", "Graphic", "Group", "Table", "Chart"]);
    const labelled = (kind: "icon" | "illustration" | "sticker" | "qr" | "emoji" | "other") =>
      layerKind(createGraphic({ svg: '<svg viewBox="0 0 1 1"></svg>', source: { kind } as never }));
    expect(["icon", "illustration", "sticker", "qr", "emoji", "other"].map((k) => labelled(k as never))).toEqual([
      "Icon",
      "Illustration",
      "Sticker",
      "QR code",
      "Emoji",
      "Graphic",
    ]);
  });

  it("names shapes that are not in the catalogue, photos from elsewhere and graphics", () => {
    expect(layerName(createShape("nope" as never))).toBe("Shape");
    expect(layerName(createImage({ src: "builtin:does-not-exist" }))).toBe("Image");
    expect(layerName(createImage({ src: "asset:abc" }))).toBe("Image");
    expect(layerName(createImage({ src: null }))).toBe("Image");
    expect(layerName(createGraphic({ svg: '<svg viewBox="0 0 1 1"></svg>' }))).toBe("Graphic");
    expect(layerName(createShape("rect", { width: 100, height: 40, radius: 0 }))).toBe("Rectangle");
    expect(layerName(createShape("rect", { width: 100, height: 100, radius: 8 }))).toBe("Rounded square");
  });
});

describe("paint CSS", () => {
  it("writes a CSS background for every kind of fill", () => {
    const stops = [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ];
    expect(paintCss({ type: "solid", color: "#123456" })).toBe("#123456");
    expect(paintCss({ type: "linear", angle: 30, stops })).toBe("linear-gradient(30deg, #ff0000 0%, #0000ff 100%)");
    expect(paintCss({ type: "radial", stops })).toBe("radial-gradient(circle at 50% 50%, #ff0000 0%, #0000ff 100%)");
    expect(paintCss({ type: "radial", cx: 0.2, cy: 0.8, stops })).toBe("radial-gradient(circle at 20% 80%, #ff0000 0%, #0000ff 100%)");
    expect(paintCss({ type: "pattern", pattern: "dots", color: "#000000", background: "#fafafa", scale: 1 })).toBe("#fafafa");
    expect(paintCss({ type: "image", src: "builtin:x", fit: "cover" })).toBe("#e9ebf0");
  });

  it("names the single colour a fill can be summed up with", () => {
    const stops = [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ];
    expect(firstColor({ type: "solid", color: "#123456" })).toBe("#123456");
    expect(firstColor({ type: "linear", angle: 0, stops })).toBe("#ff0000");
    expect(firstColor({ type: "radial", stops })).toBe("#ff0000");
    expect(firstColor({ type: "linear", angle: 0, stops: [] })).toBe("#000000");
    expect(firstColor({ type: "pattern", pattern: "dots", color: "#000000", background: "#fafafa", scale: 1 })).toBe("#fafafa");
    expect(firstColor({ type: "image", src: "builtin:x", fit: "cover" })).toBe("#e9ebf0");
  });
});

describe("selection kinds", () => {
  it("recognises photos, and what can carry a shadow or a border", () => {
    const photo = createImage({ src: "x" });
    expect(isImage(photo)).toBe(true);
    expect(isImage(createShape("rect"))).toBe(false);
    expect(supportsShadow(createGraphic({ svg: '<svg viewBox="0 0 1 1"></svg>' }))).toBe(true);
    expect(supportsShadow(createText({ text: "x" }))).toBe(false);
    expect(supportsStroke(createLine())).toBe(true);
    expect(supportsStroke(createGraphic({ svg: '<svg viewBox="0 0 1 1"></svg>' }))).toBe(false);
  });

  it("finds the texts inside nested groups", () => {
    const deep = createText({ text: "deep" });
    const g = createGroup([createGroup([deep])]);
    expect(collectTexts([g, createShape("rect")])).toEqual([deep]);
    const seen: string[] = [];
    forEachText(g, (t) => void seen.push(t.id));
    expect(seen).toEqual([deep.id]);
    forEachText(createShape("rect"), () => seen.push("never"));
    expect(seen).toHaveLength(1);
  });
});

describe("resizing text that has sized runs", () => {
  it("scales the size of every run with the box when the ratio is locked", () => {
    const t = createText({ text: "ab", fontSize: 40, width: 200, autoWidth: false });
    t.paragraphs = [{ runs: [{ text: "a", size: 20 }, { text: "b" }] }];
    resizeSingle(t, 400, 0, true);
    expect(t.fontSize).toBe(80);
    expect(t.paragraphs[0].runs[0].size).toBe(40);
    expect(t.paragraphs[0].runs[1].size).toBeUndefined();
  });
});

describe("comparing colours that cannot be parsed", () => {
  it("compares them as text, ignoring case and spaces", () => {
    expect(sameColor(" Tomato ", "tomato")).toBe(true);
    expect(sameColor("tomato", "#ff6347")).toBe(false);
    expect(sameColor("not a colour", "#fff")).toBe(false);
  });
});

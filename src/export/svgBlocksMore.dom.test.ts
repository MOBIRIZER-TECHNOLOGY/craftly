import { afterEach, describe, expect, it, vi } from "vitest";
import { createChart, createTable } from "@/core/factory";
import type { ChartElement, TableElement } from "@/core/types";
import { drawChart } from "@/render/drawBlocks";
import { captureContexts, spyContext, type SpyContext } from "@/test/logicPaint";
import { chartSvg, tableSvg } from "./svgBlocks";
import { SvgDoc } from "./svgUtil";

afterEach(() => {
  vi.restoreAllMocks();
});

const count = (text: string, part: string) => text.split(part).length - 1;
const labels = (svg: string) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const rects = (svg: string) =>
  [...svg.matchAll(/<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" fill="([^"]*)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] }));

/* ------------------------------------------------------------------ */

describe("middleShift", () => {
  /** A fresh copy of the module: it remembers the scratch canvas and every offset it measured. */
  async function fresh() {
    vi.resetModules();
    return import("./svgBlocks");
  }

  it("is how far the browser says the alphabetic baseline lies below the middle line", async () => {
    const spies = captureContexts({ returns: { measureText: { width: 8, alphabeticBaseline: -6 } } });
    const { middleShift } = await fresh();
    expect(middleShift("400 20px Test", 20)).toBe(6);
    const [measure] = spies[0].to("measureText");
    expect(measure.state.font).toBe("400 20px Test");
    expect(measure.state.textBaseline).toBe("middle");
  });

  it("asks again with the alphabetic baseline when the middle one gives no offset, and takes the middle of the em box", async () => {
    const spies = captureContexts({ returns: { measureText: { width: 8, alphabeticBaseline: 0, emHeightAscent: 12, emHeightDescent: 4 } } });
    const { middleShift } = await fresh();
    expect(middleShift("400 20px Test", 20)).toBe(4);
    expect(spies[0].to("measureText").map((call) => call.state.textBaseline)).toEqual(["middle", "alphabetic"]);
  });

  it("keeps the estimate of 35% of the size when the browser tells nothing useful", async () => {
    captureContexts({ returns: { measureText: { width: 8, alphabeticBaseline: Number.NaN, emHeightAscent: 0, emHeightDescent: 0 } } });
    const { middleShift } = await fresh();
    expect(middleShift("400 20px A", 20)).toBeCloseTo(7);
    expect(middleShift("400 40px B", 40)).toBeCloseTo(14);
  });

  it("keeps the estimate when the browser has no metrics for the em box at all", async () => {
    captureContexts({ returns: { measureText: { width: 8 } } });
    const { middleShift } = await fresh();
    expect(middleShift("400 10px A", 10)).toBeCloseTo(3.5);
  });

  it("keeps the estimate when there is no 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { middleShift } = await fresh();
    expect(middleShift("400 20px A", 20)).toBeCloseTo(7);
  });

  it("keeps the estimate when measuring fails", async () => {
    captureContexts({ failOn: { measureText: new Error("no fonts here") } });
    const { middleShift } = await fresh();
    expect(middleShift("400 20px A", 20)).toBeCloseTo(7);
  });

  it("measures each font once", async () => {
    const spies = captureContexts({ returns: { measureText: { width: 8, alphabeticBaseline: -2 } } });
    const { middleShift } = await fresh();
    expect(middleShift("400 20px A", 20)).toBe(2);
    expect(middleShift("400 20px A", 20)).toBe(2);
    expect(spies[0].to("measureText")).toHaveLength(1);
    middleShift("700 20px A", 20);
    expect(spies[0].to("measureText")).toHaveLength(2);
  });

  it("forgets what it measured after five hundred fonts, to stay small", async () => {
    const spies = captureContexts({ returns: { measureText: { width: 8, alphabeticBaseline: -2 } } });
    const { middleShift } = await fresh();
    for (let i = 0; i < 502; i++) middleShift(`400 ${i + 1}px Many`, 20);
    const measured = spies[0].to("measureText").length;
    expect(measured).toBe(502);
    middleShift("400 502px Many", 20);
    expect(spies[0].to("measureText")).toHaveLength(measured);
    middleShift("400 1px Many", 20);
    expect(spies[0].to("measureText")).toHaveLength(measured + 1);
  });
});

/* ------------------------------------------------------------------ */

const table = (init: Partial<TableElement> = {}): TableElement =>
  createTable({
    width: 300,
    height: 120,
    colWidths: [100, 100, 100],
    rowHeights: [40, 40, 40],
    fontSize: 16,
    cells: [
      ["Name", "Qty", "Price"],
      ["Apple", "3", "1.20"],
      ["", "", ""],
    ],
    ...init,
  });
const tableOf = (init: Partial<TableElement> = {}, alpha = 1) => tableSvg(table(init), { doc: new SvgDoc(), alpha });

describe("tables", () => {
  it("fills the header row, stripes every second row and leaves the others white", () => {
    const fills = rects(tableOf()).map((r) => r.fill);
    expect(fills).toEqual([...Array(3).fill("#7c3aed"), ...Array(3).fill("#ffffff"), ...Array(3).fill("#f3f0ff")]);
  });

  it("makes the first row an ordinary row when the table has no header", () => {
    const fills = rects(tableOf({ headerRow: false })).map((r) => r.fill);
    expect(fills.slice(0, 3)).toEqual(Array(3).fill("#f3f0ff"));
  });

  it("does not stripe when there is no stripe colour", () => {
    const fills = rects(tableOf({ stripeFill: "" })).map((r) => r.fill);
    expect(fills.slice(3)).toEqual(Array(6).fill("#ffffff"));
  });

  it("lays the cells out on the grid scaled to the size of the table", () => {
    const grid = rects(tableOf({ width: 600, height: 240 }));
    expect(grid[0]).toMatchObject({ x: 0, y: 0, w: 200, h: 80 });
    expect(grid[4]).toMatchObject({ x: 200, y: 80, w: 200, h: 80 });
    expect(grid[8]).toMatchObject({ x: 400, y: 160, w: 200, h: 80 });
  });

  it("writes only the cells that have words, the header bold in its own colour", () => {
    const svg = tableOf({ headerColor: "#fefefe", color: "#010203" });
    expect(labels(svg)).toEqual(["Name", "Qty", "Price", "Apple", "3", "1.20"]);
    const [header, body] = [svg.match(/<text [^>]*>Name<\/text>/)![0], svg.match(/<text [^>]*>Apple<\/text>/)![0]];
    expect(header).toContain('font-weight="700"');
    expect(header).toContain('fill="#fefefe"');
    expect(body).toContain('font-weight="400"');
    expect(body).toContain('fill="#010203"');
  });

  it("copes with a table that has fewer cells than rows and columns", () => {
    const svg = tableOf({ cells: [["Only"]] });
    expect(labels(svg)).toEqual(["Only"]);
    expect(count(svg, "<rect ")).toBe(9);
  });

  it("aligns text to the left, the middle or the right of each cell", () => {
    const left = tableOf({ align: "left" }).match(/<text x="([^"]*)"[^>]*>Apple/)!;
    const middle = tableOf({ align: "center" }).match(/<text x="([^"]*)"[^>]*text-anchor="middle"[^>]*>Apple/)!;
    const right = tableOf({ align: "right" }).match(/<text x="([^"]*)"[^>]*text-anchor="end"[^>]*>Apple/)!;
    expect(+left[1]).toBe(8);
    expect(+middle[1]).toBe(50);
    expect(+right[1]).toBe(92);
    expect(tableOf({ align: "left" })).not.toContain("text-anchor");
  });

  it("breaks long cell text into lines at spaces and at line breaks", () => {
    const svg = tableOf({
      cells: [
        ["Name", "Qty", "Price"],
        ["one two three four\nfive", "", ""],
        ["", "", ""],
      ],
    });
    const lines = labels(svg).filter((text) => text !== "Name" && text !== "Qty" && text !== "Price");
    expect(lines.join(" ")).toBe("one two three four five");
    expect(lines.length).toBeGreaterThan(2);
  });

  it("clips the text of a cell that does not fit in it, and only then", () => {
    const fits = new SvgDoc();
    tableSvg(table(), { doc: fits, alpha: 1 });
    expect(fits.defs.join("")).not.toContain("<clipPath");
    const spills = new SvgDoc();
    const svg = tableSvg(
      table({
        cells: [
          ["Name", "Qty", "Price"],
          ["Unbreakableword-that-is-far-too-long", "", ""],
          ["", "", ""],
        ],
      }),
      { doc: spills, alpha: 1 },
    );
    expect(spills.defs.join("")).toContain("<clipPath");
    expect(svg).toMatch(/<g clip-path="url\(#cf-cp\d+\)"><text [^>]*>Unbreakableword/);
  });

  it("clips text that is too many lines for the height of the cell", () => {
    const doc = new SvgDoc();
    tableSvg(
      table({
        rowHeights: [40, 20, 40],
        cells: [
          ["Name", "Qty", "Price"],
          ["a\nb\nc\nd", "", ""],
          ["", "", ""],
        ],
      }),
      { doc, alpha: 1 },
    );
    expect(doc.defs.join("")).toContain("<clipPath");
  });

  it("draws the grid and the outer border in one path, when there is a border", () => {
    const svg = tableOf({ borderWidth: 3, borderColor: "#445566" });
    const border = svg.match(/<path d="([^"]*)" fill="none" stroke="#445566" stroke-width="3"\/>/)!;
    expect(border).not.toBeNull();
    expect(border[1]).toContain("M0 0H300");
    expect(border[1]).toContain("M0 40H300");
    expect(border[1]).toContain("M100 0V120");
    expect(border[1].endsWith("M0 0H300V120H0Z")).toBe(true);
    expect(tableOf({ borderWidth: 0 })).not.toContain("<path");
  });

  it("outlines each cell on its own instead of drawing the grid when cells are merged", () => {
    const svg = tableOf({ borderWidth: 2, borderColor: "#445566", merges: [{ row: 1, col: 0, rowSpan: 1, colSpan: 2 }] });
    // a grid would run through the merged cell, so there is none: every cell box carries the border itself
    expect(svg).not.toContain("<path");
    const boxes = [...svg.matchAll(/<rect [^>]*\/>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(8);
    for (const box of boxes) expect(box).toContain('stroke="#445566" stroke-width="2"');
    expect(rects(svg).find((r) => r.y === 40 && r.x === 0)).toMatchObject({ w: 200, h: 40 });
    // without a border the merged cells have no outline
    expect(tableOf({ borderWidth: 0, merges: [{ row: 1, col: 0, rowSpan: 1, colSpan: 2 }] })).not.toContain("stroke=");
  });

  it("still draws something sensible when the columns have no width at all", () => {
    const svg = tableOf({ colWidths: [0, 0], rowHeights: [0, 0] });
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("makes every colour as see-through as the table is", () => {
    const svg = tableOf({}, 0.5);
    expect(svg).toContain('fill="#7c3aed" fill-opacity="0.5"');
    expect(svg).toContain('fill-opacity="0.5"');
  });
});

/* ------------------------------------------------------------------ */

const chart = (init: Partial<ChartElement> = {}): ChartElement =>
  createChart({ width: 640, height: 400, labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Revenue", values: [32, 48, 41, 66] }], ...init });
const chartOf = (init: Partial<ChartElement> = {}, alpha = 1) => chartSvg(chart(init), { doc: new SvgDoc(), alpha });
const bars = (svg: string) => count(svg, '<path d="M') - count(svg, 'fill="none"');
const axis = (svg: string) => labels(svg).slice(0, 5);

describe("column and bar charts", () => {
  it("draws one rounded bar per value, with the value above it", () => {
    const svg = chartOf();
    expect(bars(svg)).toBe(4);
    expect(labels(svg)).toEqual(["0", "25", "50", "75", "100", "Q1", "Q2", "Q3", "Q4", "32", "48", "41", "66"]);
  });

  it("rounds the top of the scale up to 1, 2, 5 or 10 times a power of ten", () => {
    const top = (values: number[]) => axis(chartOf({ series: [{ name: "S", values }] })).at(-1);
    expect(top([1])).toBe("1");
    expect(top([1.5])).toBe("2");
    expect(top([3])).toBe("5");
    expect(top([40])).toBe("50");
    expect(top([7])).toBe("10");
    expect(top([700])).toBe("1000");
    // a chart of nothing still has a scale
    expect(top([0, 0])).toBe("1");
  });

  it("leaves out the values when they are not wanted, and the grid when it is not wanted", () => {
    const quiet = chartOf({ showValues: false, showGrid: false });
    expect(labels(quiet)).toHaveLength(9);
    expect(count(quiet, 'stroke-width="1"')).toBe(0);
    expect(count(chartOf(), 'stroke-width="1"')).toBe(5);
  });

  it("puts bars side by side, one colour per series, or the colour the series chose", () => {
    const svg = chartOf({
      series: [
        { name: "A", values: [10, 20, 30, 40] },
        { name: "B", values: [5, 15, 25, 35], color: "#00aa00" },
      ],
      palette: ["#aa0000", "#0000aa"],
    });
    expect(count(svg, 'fill="#aa0000"')).toBe(4);
    expect(count(svg, 'fill="#00aa00"')).toBe(4);
  });

  it("lays bars out sideways, with the labels to the left, for a bar chart", () => {
    const svg = chartOf({ chart: "bar" });
    expect(bars(svg)).toBe(4);
    expect(svg).toMatch(/text-anchor="end"[^>]*>Q1</);
    // the scale runs along the bottom
    expect(svg).toMatch(/text-anchor="middle"[^>]*>50</);
    expect(chartOf({ chart: "bar", showGrid: false })).not.toContain('stroke-width="1"');
  });

  it("scales every label and bar by the opacity of the chart", () => {
    expect(chartOf({}, 0.5)).toContain('fill-opacity="0.5"');
  });

  it("draws a legend of series names above the plot, in their colours", () => {
    const svg = chartOf({
      showLegend: true,
      series: [
        { name: "North", values: [1, 2, 3, 4] },
        { name: "South", values: [4, 3, 2, 1], color: "#00aa00" },
      ],
    });
    expect(labels(svg).slice(0, 2)).toEqual(["North", "South"]);
    // a dot and a name per series, each item starting after the width of the one before it
    expect(svg).toContain('<circle cx="6.4" cy="14.4" r="6.4" fill="#7c3aed"/>');
    expect(svg).toContain('<circle cx="85.6" cy="14.4" r="6.4" fill="#00aa00"/>');
    // the legend dot plus the four bars of the second series
    expect(count(svg, 'fill="#00aa00"')).toBe(5);
    // a chart with a legend names its only series
    expect(labels(chartOf({ showLegend: true }))).toContain("Revenue");
  });

  it("copes with a chart that has no labels and no series", () => {
    const svg = chartOf({ labels: [], series: [] });
    expect(svg).not.toContain("NaN");
    expect(labels(svg)).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
  });
});

describe("chart text that would not fit, written as the painter draws it", () => {
  const long = "A category with a name that goes on for much longer than the chart has room for";
  const ys = (svg: string) => [...svg.matchAll(/<text [^>]*\by="([^"]*)"/g)].map((m) => Number(m[1]));

  it("takes a second line for a legend that is wider than the chart", () => {
    const series = ["North America", "South America", "Europe and Africa", "Asia and the Pacific", "Everything else"].map((name) => ({ name, values: [1, 2, 3, 4] }));
    const svg = chartOf({ showLegend: true, series });
    expect(labels(svg).slice(0, 5)).toEqual(series.map((x) => x.name));
    expect(new Set(ys(svg).slice(0, 5)).size).toBe(2);
    expect(new Set([...svg.matchAll(/<circle [^>]*cy="([^"]*)"/g)].slice(0, 5).map((m) => m[1])).size).toBe(2);
  });

  it("cuts long names with an ellipsis: in the legend, beside a bar chart and under a column", () => {
    expect(labels(chartOf({ showLegend: true, series: [{ name: long + long, values: [1] }] }))[0].endsWith("…")).toBe(true);
    const bar = labels(chartOf({ chart: "bar", labels: ["Marketing and events", long, "IT", "HR"] })).slice(5, 9);
    expect(bar[0]).toBe("Marketing and events");
    expect(bar[1].endsWith("…")).toBe(true);
    const column = labels(chartOf({ labels: ["Q1", long, "Q3", "Q4"] })).slice(5, 9);
    expect(column[0]).toBe("Q1");
    expect(column[1].endsWith("…")).toBe(true);
  });

  it("names every third of forty categories, and writes large numbers short", () => {
    const names = Array.from({ length: 40 }, (_, i) => `C${i + 1}`);
    const many = labels(chartOf({ labels: names, showValues: false, series: [{ name: "S", values: Array(40).fill(5) }] })).slice(5);
    expect(many).toEqual(names.filter((_, i) => i % 3 === 0));
    const lying = labels(chartOf({ chart: "bar", labels: names, showValues: false, series: [{ name: "S", values: Array(40).fill(5) }] })).slice(5);
    expect(lying).toEqual(names.filter((_, i) => i % 2 === 0));
    const big = labels(chartOf({ series: [{ name: "S", values: [2500000, 48000000, 1200, 66] }] }));
    expect(big.slice(0, 5)).toEqual(["0", "12.5M", "25M", "37.5M", "50M"]);
    expect(big.slice(9)).toEqual(["2.5M", "48M", "1200", "66"]);
  });

  it("leaves the values off bars and points that are too close together for them", () => {
    const values = Array.from({ length: 40 }, (_, i) => 1001 + i);
    const names = values.map((_, i) => `C${i + 1}`);
    for (const kind of ["column", "bar", "line", "area"] as const) expect(labels(chartOf({ chart: kind, labels: names, series: [{ name: "S", values }] }))).not.toContain("1001");
    expect(labels(chartOf({ chart: "column" }))).toContain("32");
  });
});

describe("line and area charts", () => {
  it("draws a line with a ringed dot and a value for each point", () => {
    const svg = chartOf({ chart: "line" });
    expect(count(svg, "<circle")).toBe(4);
    expect(count(svg, 'stroke-linejoin="round"')).toBe(1);
    expect(labels(svg).slice(-4)).toEqual(["32", "48", "41", "66"]);
    expect(count(chartOf({ chart: "line", showValues: false }), "<circle")).toBe(4);
    expect(labels(chartOf({ chart: "line", showValues: false }))).toHaveLength(9);
  });

  it("fills the area under the line with a faint copy of its colour", () => {
    const area = chartOf({ chart: "area", palette: ["#ff0000"] });
    expect(area).toMatch(/<path d="M[^"]*Z" fill="#ff0000" fill-opacity="0.28"\/>/);
    expect(chartOf({ chart: "line", palette: ["#ff0000"] })).not.toContain('fill-opacity="0.28"');
  });

  it("draws one line per series and skips a series with no points", () => {
    const svg = chartOf({
      chart: "line",
      series: [
        { name: "A", values: [1, 2, 3, 4] },
        { name: "B", values: [] },
        { name: "C", values: [4, 3, 2, 1] },
      ],
    });
    expect(count(svg, 'stroke-linejoin="round"')).toBe(2);
    expect(count(svg, "<circle")).toBe(8);
  });
});

describe("pie and donut charts", () => {
  const slices = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)" stroke="#ffffff"/g)].map((m) => ({ d: m[1], fill: m[2] }));

  it("cuts the pie into one slice per value, in the palette colours", () => {
    const svg = chartOf({ chart: "pie", series: [{ name: "S", values: [50, 30, 20] }], palette: ["#aa0000", "#00aa00", "#0000aa"] });
    expect(slices(svg).map((s) => s.fill)).toEqual(["#aa0000", "#00aa00", "#0000aa"]);
    // each slice runs to the centre
    expect(slices(svg).every((s) => /^M320 /.test(s.d) && s.d.includes("L"))).toBe(true);
    expect(labels(svg)).toEqual(["50", "30", "20"]);
  });

  it("leaves a hole in the middle of a donut", () => {
    const svg = chartOf({ chart: "donut", series: [{ name: "S", values: [50, 50] }] });
    expect(slices(svg)).toHaveLength(2);
    expect(slices(svg)[0].d).not.toMatch(/^M320 \d+L/);
  });

  it("takes the long way round the circle for a slice of more than half", () => {
    const [big, small] = slices(chartOf({ chart: "pie", series: [{ name: "S", values: [75, 25] }] }));
    expect(big.d).toMatch(/ 0 1 1 /);
    expect(small.d).toMatch(/ 0 0 1 /);
  });

  it("draws a single value as a whole circle (a hole too, for a donut)", () => {
    const pie = slices(chartOf({ chart: "pie", series: [{ name: "S", values: [10] }] }));
    const donut = slices(chartOf({ chart: "donut", series: [{ name: "S", values: [10] }] }));
    expect(count(pie[0].d, "A")).toBe(2);
    expect(count(donut[0].d, "A")).toBe(4);
  });

  it("writes a value only on slices big enough to hold it", () => {
    const svg = chartOf({ chart: "pie", series: [{ name: "S", values: [97, 3] }] });
    expect(labels(svg)).toEqual(["97"]);
    expect(labels(chartOf({ chart: "pie", showValues: false, series: [{ name: "S", values: [60, 40] }] }))).toEqual([]);
  });

  it("makes the slice outlines as see-through as the chart", () => {
    expect(chartOf({ chart: "pie" }, 0.5)).toContain('stroke-opacity="0.5"');
    expect(chartOf({ chart: "pie" })).not.toContain("stroke-opacity");
  });

  it("names the slices, not the series, in the legend", () => {
    const svg = chartOf({ chart: "pie", showLegend: true, series: [{ name: "S", values: [60, 40] }], labels: ["Cats", "Dogs"], palette: ["#aa0000", "#00aa00"] });
    expect(labels(svg).slice(0, 2)).toEqual(["Cats", "Dogs"]);
    expect(count(svg, "<circle")).toBe(2);
  });

  it("draws nothing for a pie without data, and no slice for a value of zero", () => {
    expect(chartOf({ chart: "pie", series: [] })).toBe("");
    const zero = chartOf({ chart: "pie", series: [{ name: "S", values: [0, 0] }] });
    expect(zero).not.toContain("NaN");
    expect(slices(zero)).toHaveLength(2);
  });
});

describe("stacked charts and axis titles, written as the painter draws them", () => {
  const SERIES = [
    { name: "A", values: [10, 20, 30, 40], color: "#aa0000" },
    { name: "B", values: [15, 25, 35, 45], color: "#0000aa" },
  ];
  /** the x, y, width and height of every bar of one colour, read from the points its path visits */
  const boxes = (svg: string, fill: string) =>
    [...svg.matchAll(new RegExp(`<path d="([^"]*)" fill="${fill}"/>`, "g"))].map((m) => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [, command, rest] of m[1].matchAll(/([MHVA])([^MHVAZ]*)/g)) {
        const n = rest.trim().split(/[ ,]+/).map(Number);
        if (command === "H") xs.push(n[0]);
        else if (command === "V") ys.push(n[0]);
        else {
          // M x y, and an arc ends at its last two numbers
          xs.push(n[n.length - 2]);
          ys.push(n[n.length - 1]);
        }
      }
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    });

  it("draws one column of pieces for each category, the second series on the first, and the sum above", () => {
    const svg = chartOf({ series: SERIES, stacked: true });
    expect(bars(svg)).toBe(8);
    const first = boxes(svg, "#aa0000");
    const second = boxes(svg, "#0000aa");
    expect(first).toHaveLength(4);
    expect(second).toHaveLength(4);
    // 584 px of plot in four categories; a column takes 72 % of its category; the axis ends at 100 over 352 px
    expect(first[0].x).toBeCloseTo(48 + 146 * 0.14, 1);
    expect(first[0].w).toBeCloseTo(146 * 0.72, 1);
    expect(first[0].h).toBeCloseTo(35.2, 1);
    expect(second[0].x).toBeCloseTo(first[0].x, 1);
    expect(second[0].h).toBeCloseTo(52.8, 1);
    expect(second[0].y + second[0].h).toBeCloseTo(first[0].y, 1);
    expect(labels(svg)).toEqual(["0", "25", "50", "75", "100", "Q1", "Q2", "Q3", "Q4", "25", "45", "65", "85"]);
    expect(labels(chartOf({ series: SERIES, stacked: true, showValues: false }))).toHaveLength(9);
  });

  it("lays the pieces of a stacked bar chart end to end", () => {
    const svg = chartOf({ chart: "bar", series: SERIES, stacked: true });
    const first = boxes(svg, "#aa0000");
    const second = boxes(svg, "#0000aa");
    expect(first[0].x).toBeCloseTo(48, 1);
    expect(first[0].w).toBeCloseTo(58.4, 1);
    expect(second[0].x).toBeCloseTo(48 + 58.4, 1);
    expect(second[0].w).toBeCloseTo(87.6, 1);
    expect(second[0].y).toBeCloseTo(first[0].y, 1);
    expect(labels(svg).slice(-4)).toEqual(["25", "45", "65", "85"]);
  });

  it("leaves out pieces of no size and sums of nothing, and stacks nothing for a single series", () => {
    const svg = chartOf({ stacked: true, labels: ["a", "b"], series: [{ name: "A", values: [10, 0] }, { name: "B", values: [0, -2] }] }); // prettier-ignore
    expect(bars(svg)).toBe(1);
    expect(labels(svg).slice(-1)).toEqual(["10"]);
    expect(chartOf({ stacked: true })).toBe(chartOf());
  });

  it("writes the titles of the axes: one under the plot, one turned a quarter on its left", () => {
    const svg = chartOf({ valueAxisTitle: "Units <sold>", categoryAxisTitle: "Quarter" });
    expect(labels(svg)).toContain("Quarter");
    expect(labels(svg)).toContain("Units &lt;sold&gt;");
    // the title on the left is half its room from the edge, at the middle of a plot that is one room shorter
    const turned = svg.match(/<g transform="rotate\(-90 ([\d.]+) ([\d.]+)\)"><text [^>]*>Units &lt;sold&gt;<\/text><\/g>/)!;
    expect(turned).not.toBeNull();
    expect(+turned[1]).toBeCloseTo(12.8, 1);
    expect(+turned[2]).toBeCloseTo(12.8 + (352 - 25.6) / 2, 1);
    // the plot has moved: the first bar begins one room further right
    expect(boxes(svg, "#7c3aed")[0].x).toBeCloseTo(48 + 25.6 + ((584 - 25.6) / 4) * 0.14, 1);
    // a bar chart writes them the other way round
    expect(chartOf({ chart: "bar", valueAxisTitle: "Units", categoryAxisTitle: "Quarter" })).toMatch(/rotate\(-90 [^)]*\)"><text [^>]*>Quarter</);
  });

  it("writes no title that is empty, and none on a pie", () => {
    expect(chartOf({ valueAxisTitle: " ", categoryAxisTitle: "" })).toBe(chartOf());
    expect(chartOf({ chart: "pie", valueAxisTitle: "Units", categoryAxisTitle: "Quarter" })).toBe(chartOf({ chart: "pie" }));
    expect(chartOf({ categoryAxisTitle: "Quarter" })).not.toContain("rotate(");
  });

  it("writes only the turned title when the chart names its values but not its categories", () => {
    const svg = chartOf({ valueAxisTitle: "Units" });
    expect(count(svg, "rotate(-90")).toBe(1);
    expect(labels(svg).filter((text) => text === "Units")).toHaveLength(1);
    // nothing is written under the plot beyond the category names
    expect(svg).toMatch(/rotate\(-90 [^)]*\)"><text [^>]*>Units</);
    expect(labels(svg).filter((text) => !/^\d+$|^Q\d$/.test(text))).toEqual(["Units"]);
  });
});

/* ------------------------------------------------------------------ */

/**
 * The exporter is a port of the canvas painter (src/render/drawBlocks.ts): for the newer kinds of chart, the
 * dots, bars and words it writes are compared with what the painter draws for the same chart.
 */
describe("scatter, combined, stacked-area and 100% charts, written as the painter draws them", () => {
  const circles = (svg: string) => [...svg.matchAll(/<circle cx="([^"]*)" cy="([^"]*)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const painted = (el: ChartElement) => {
    const spy = spyContext({ width: 800, height: 600 });
    drawChart(spy.ctx, el);
    return spy;
  };
  /** what the painter wrote, leaving out the empty strings the exporter does not write */
  const paintedWords = (spy: SpyContext) =>
    spy
      .to("fillText")
      .map((call) => call.args[0] as string)
      .filter(Boolean);
  const expectSamePoints = (svg: string, spy: SpyContext) => {
    const dots = circles(svg);
    const arcs = spy.to("arc").map((call) => ({ x: call.args[0] as number, y: call.args[1] as number }));
    expect(dots).toHaveLength(arcs.length);
    dots.forEach((dot, i) => {
      expect(dot.x).toBeCloseTo(arcs[i].x, 2);
      expect(dot.y).toBeCloseTo(arcs[i].y, 2);
    });
  };

  describe("scatter charts", () => {
    const scatter = (init: Partial<ChartElement> = {}) => chart({ chart: "scatter", ...init });

    it.each<[string, Partial<ChartElement>]>([
      ["numbers as labels", { labels: ["1", "3", "5"], series: [{ name: "A", values: [10, 20, 50] }] }],
      ["words as labels", { labels: ["North", "South", "East"], series: [{ name: "A", values: [1, 2, 3] }] }],
      ["two series", { labels: ["1", "2"], series: [{ name: "A", values: [1, 2] }, { name: "B", values: [3, 4], color: "#00aa00" }] }], // prettier-ignore
      ["a single label", { labels: ["7"], series: [{ name: "A", values: [4] }] }],
      ["labels that are all the same number", { labels: ["2", "2"], series: [{ name: "A", values: [4, 8] }] }],
      ["no grid and no values", { labels: ["1", "2"], series: [{ name: "A", values: [10, 30] }], showGrid: false, showValues: false }],
    ])("puts the dots and the words where the painter does, for %s", (_name, init) => {
      const el = scatter(init);
      const svg = chartSvg(el, { doc: new SvgDoc(), alpha: 1 });
      const spy = painted(el);
      expectSamePoints(svg, spy);
      expect(labels(svg)).toEqual(paintedWords(spy));
    });

    it("places the dots along the axis by the numbers of their labels and colours them by series", () => {
      const svg = chartOf({ chart: "scatter", labels: ["1", "3", "5"], series: [{ name: "A", values: [10, 20, 50], color: "#00aa00" }] });
      // a 640 x 400 chart writes at 16 px: the plot runs from 64 to 624 across and from 352 up to 24
      expect(circles(svg)).toEqual([
        { x: 64, y: 286.4 },
        { x: 344, y: 220.8 },
        { x: 624, y: 24 },
      ]);
      expect(count(svg, 'fill="#00aa00"')).toBe(3);
      expect(labels(svg)).toEqual(["0", "12.5", "25", "37.5", "50", "10", "20", "50", "1", "3", "5"]);
    });

    it("draws the five grid lines only when the grid is wanted, and the values only when they are wanted", () => {
      const full = chartOf({ chart: "scatter" });
      expect(count(full, 'fill="none"')).toBe(5);
      expect(full).toMatch(/<path d="M64 [^"]*" fill="none" stroke="#[0-9a-f]{6}" stroke-opacity="0.12" stroke-width="1"\/>/);
      const bare = chartOf({ chart: "scatter", showGrid: false, showValues: false });
      expect(count(bare, 'fill="none"')).toBe(0);
      expect(count(bare, "<circle")).toBe(4);
      expect(labels(bare)).toHaveLength(5 + 4);
    });

    it("names only every few of many categories, as the painter does", () => {
      const names = Array.from({ length: 40 }, (_, i) => String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26));
      const el = scatter({ labels: names, series: [{ name: "A", values: names.map(() => 5) }], showValues: false });
      const svg = chartSvg(el, { doc: new SvgDoc(), alpha: 1 });
      const written = labels(svg).slice(5);
      expect(written.length).toBeLessThan(40);
      expect(written[0]).toBe("A");
      expect(written).toEqual(paintedWords(painted(el)).slice(5));
    });

    it("still writes its scale for a scatter chart without labels or values", () => {
      const svg = chartOf({ chart: "scatter", labels: [], series: [] });
      expect(svg).not.toContain("NaN");
      expect(count(svg, "<circle")).toBe(0);
      expect(labels(svg)).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
    });
  });

  describe("combined charts", () => {
    const SERIES = [
      { name: "Bars", values: [10, 20, 30, 40] },
      { name: "Line", values: [15, 25, 35, 45], color: "#00aa00" },
    ];

    it("writes the first series as bars and the others as lines with dots, where the painter draws them", () => {
      const el = chart({ chart: "combo", series: SERIES });
      const svg = chartSvg(el, { doc: new SvgDoc(), alpha: 1 });
      const spy = painted(el);
      const bars = rects(svg);
      const fills = spy.to("fillRect");
      expect(bars).toHaveLength(4);
      bars.forEach((bar, i) => {
        expect([bar.x, bar.y, bar.w, bar.h].map((v) => Math.round(v * 100) / 100)).toEqual((fills[i].args as number[]).map((v) => Math.round(v * 100) / 100));
        expect(bar.fill).toBe("#7c3aed");
      });
      expect(count(svg, 'stroke-linejoin="round"')).toBe(1);
      expect(svg).toMatch(/<path d="M[^"]*" fill="none" stroke="#00aa00"[^>]*stroke-linejoin="round"\/>/);
      expectSamePoints(svg, spy);
      expect(labels(svg)).toEqual(paintedWords(spy));
      expect(labels(svg).slice(-8)).toEqual(["10", "20", "30", "40", "15", "25", "35", "45"]);
    });

    it("leaves the values off its bars and dots when they are not wanted", () => {
      const svg = chartOf({ chart: "combo", series: SERIES, showValues: false });
      expect(rects(svg)).toHaveLength(4);
      expect(labels(svg)).toEqual(["0", "12.5", "25", "37.5", "50", "Q1", "Q2", "Q3", "Q4"]);
    });

    it("draws only its scale and its names when it has no series", () => {
      const svg = chartOf({ chart: "combo", series: [] });
      expect(svg).not.toContain("<rect");
      expect(svg).not.toContain("<circle");
      expect(svg).not.toContain("NaN");
      expect(labels(svg)).toEqual(["0", "0.25", "0.5", "0.75", "1", "Q1", "Q2", "Q3", "Q4"]);
    });
  });

  describe("stacked area charts", () => {
    const SERIES = [
      { name: "A", values: [10, 20], color: "#aa0000" },
      { name: "B", values: [15, 25], color: "#0000aa" },
    ];

    it("lays each area on top of the one before and writes the running totals", () => {
      const el = chart({ chart: "area", stacked: true, labels: ["a", "b"], series: SERIES });
      const svg = chartSvg(el, { doc: new SvgDoc(), alpha: 1 });
      const spy = painted(el);
      expectSamePoints(svg, spy);
      expect(labels(svg)).toEqual(paintedWords(spy));
      // the scale runs to 50; the second series stands on the first, so its dots show 25 and 45
      expect(labels(svg)).toEqual(["0", "12.5", "25", "37.5", "50", "a", "b", "10", "20", "25", "45"]);
      const [a1, a2, b1, b2] = circles(svg);
      expect(b1.x).toBe(a1.x);
      expect(b1.y).toBeLessThan(a1.y);
      expect(b2.y).toBeLessThan(a2.y);
    });

    it("closes the lowest area along the axis at the bottom of the plot", () => {
      const svg = chartOf({ chart: "area", stacked: true, labels: ["a", "b"], series: SERIES });
      const [a1, a2] = circles(svg);
      const lower = svg.match(/<path d="([^"]*)Z" fill="#aa0000" fill-opacity="0.28"\/>/)!;
      expect(lower).not.toBeNull();
      // 400 px high, 16 px text: the plot ends 2.2 font sizes above the bottom, at 364.8
      expect(lower[1].endsWith(`L${a2.x} 364.8L${a1.x} 364.8`)).toBe(true);
    });

    // Known bug in svgBlocks.ts (chartSvg, area branch): the way back along the lower series pairs each dot with the
    // baseline of the mirror category (`baselines[pts.length - 1 - i]` and then `.reverse()`), so with two categories
    // the upper area's bottom edge runs from (b, top of a) to (a, top of b) and crosses itself. The painter pairs them
    // correctly. Marked as failing until the exporter is fixed; it then starts to pass and `fails` must come off.
    it.fails("closes the upper area along the top of the lower one, as the painter does", () => {
      const svg = chartOf({ chart: "area", stacked: true, labels: ["a", "b"], series: SERIES });
      const [a1, a2] = circles(svg);
      const upper = svg.match(/<path d="([^"]*)Z" fill="#0000aa" fill-opacity="0.28"\/>/)!;
      expect(upper).not.toBeNull();
      // the way back runs through the dots of the first series, the last category first
      expect(upper[1]).toContain(`L${a2.x} ${a2.y}L${a1.x} ${a1.y}`);
    });

    it("does not stack the areas of a chart that is not stacked", () => {
      const svg = chartOf({ chart: "area", labels: ["a", "b"], series: SERIES });
      expect(labels(svg).slice(-4)).toEqual(["10", "20", "15", "25"]);
    });
  });

  it("turns the values of a 100% chart into shares of each category's total", () => {
    const el = chart({
      percent: true,
      labels: ["a", "b"],
      series: [
        { name: "A", values: [10, 20] },
        { name: "B", values: [30, 20] },
      ],
    });
    const svg = chartSvg(el, { doc: new SvgDoc(), alpha: 1 });
    expect(labels(svg)).toEqual(["0", "25", "50", "75", "100", "a", "b", "25", "50", "75", "50"]);
    expect(labels(svg)).toEqual(paintedWords(painted(el)));
    // the chart it was given keeps its own numbers
    expect(el.series[0].values).toEqual([10, 20]);
  });
});

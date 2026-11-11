import { afterEach, describe, expect, it, vi } from "vitest";
import { createChart, createTable } from "@/core/factory";
import type { ChartElement, TableElement } from "@/core/types";
import { captureContexts } from "@/test/logicPaint";
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

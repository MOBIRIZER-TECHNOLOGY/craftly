import { describe, expect, it } from "vitest";
import { createChart, createTable } from "@/core/factory";
import type { ChartElement, TableElement } from "@/core/types";
import { measureWidth } from "@/core/textMetrics";
import { spyContext, type PaintCall, type SpyOptions } from "@/test/logicPaint";
import { drawChart, drawTable } from "./drawBlocks";

function table(el: TableElement, opts: SpyOptions = {}) {
  const spy = spyContext(opts);
  drawTable(spy.ctx, el);
  return spy;
}

function chart(el: ChartElement, opts: SpyOptions = {}) {
  const spy = spyContext(opts);
  drawChart(spy.ctx, el);
  return spy;
}

const numbers = (call: PaintCall) => call.args as number[];

/** Compare numbers with a tolerance: chart geometry is floating point. */
function expectNumbers(actual: unknown[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i] as number).toBeCloseTo(value, 6));
}

describe("tables", () => {
  const plain = (init: Partial<TableElement> = {}) => createTable({ width: 600, height: 240, ...init });

  it("paints a header row, a plain row and a striped row", () => {
    const spy = table(plain());
    const cells = spy.to("fillRect");
    expect(cells).toHaveLength(9);
    expect(cells.map((c) => c.state.fillStyle)).toEqual([...Array(3).fill("#7c3aed"), ...Array(3).fill("#ffffff"), ...Array(3).fill("#f3f0ff")]);
    expect(numbers(cells[0])).toEqual([0, 0, 200, 80]);
    expect(numbers(cells[4])).toEqual([200, 80, 200, 80]);
    expect(numbers(cells[8])).toEqual([400, 160, 200, 80]);
  });

  it("stripes the even rows only when there is a stripe colour, and counts every row as plain without a header", () => {
    const noStripe = table(plain({ stripeFill: null }));
    expect(noStripe.to("fillRect").map((c) => c.state.fillStyle)).toEqual([...Array(3).fill("#7c3aed"), ...Array(6).fill("#ffffff")]);
    const noHeader = table(plain({ headerRow: false }));
    expect(
      noHeader
        .to("fillRect")
        .map((c) => c.state.fillStyle)
        .slice(0, 3),
    ).toEqual(Array(3).fill("#f3f0ff"));
    expect(noHeader.to("fillText")[0].state.font).toMatch(/^400 24px/);
  });

  it("writes header cells in bold in the header colour and body cells in the text colour", () => {
    const spy = table(
      plain({
        cells: [
          ["A", "B", "C"],
          ["d", "e", "f"],
          ["g", "h", "i"],
        ],
        headerColor: "#fefefe",
        color: "#010203",
      }),
    );
    const [header, body] = [spy.to("fillText")[0], spy.to("fillText")[3]];
    expect(header.state.font).toMatch(/^700 24px "Plus Jakarta Sans Variable"/);
    expect(header.state.fillStyle).toBe("#fefefe");
    expect(body.state.font).toMatch(/^400 24px/);
    expect(body.state.fillStyle).toBe("#010203");
  });

  it("indents the text from the left edge of its cell and centres it vertically", () => {
    const spy = table(plain());
    const call = spy.to("fillText")[0];
    expect(call.args).toEqual(["Heading 1", 12, 40]);
    expect(call.state.textAlign).toBe("left");
    expect(call.state.textBaseline).toBe("middle");
  });

  it.each([
    ["center", "center", 100],
    ["right", "right", 188],
    ["left", "left", 12],
    ["justify", "left", 12],
  ] as const)("aligns text %s inside the cell", (align, canvasAlign, x) => {
    const spy = table(plain({ align }));
    const call = spy.to("fillText")[0];
    expect(call.state.textAlign).toBe(canvasAlign);
    expect(call.args[1]).toBe(x);
  });

  it("wraps long text inside the cell and centres the block of lines vertically", () => {
    const el = plain({ width: 300, height: 100, cells: [["alpha beta gamma", "x"]], colWidths: [100, 200], rowHeights: [100], headerRow: false });
    const lines = table(el).to("fillText").slice(0, 3);
    expect(lines.map((c) => c.args[0])).toEqual(["alpha", "beta", "gamma"]);
    // three lines of 30 px (1.25 x 24) around the middle of a 100 px row
    expect(lines.map((c) => c.args[2])).toEqual([20, 50, 80]);
    expect(lines.every((c) => c.args[1] === 12)).toBe(true);
  });

  it("breaks the text of a cell at its newlines", () => {
    const el = plain({ width: 400, height: 100, cells: [["one\ntwo"]], colWidths: [400], rowHeights: [100], headerRow: false });
    expect(
      table(el)
        .to("fillText")
        .map((c) => c.args[0]),
    ).toEqual(["one", "two"]);
  });

  it("keeps a single long word whole on its own line", () => {
    const el = plain({ width: 100, height: 60, cells: [["extraordinarily"]], colWidths: [100], rowHeights: [60], headerRow: false });
    expect(
      table(el)
        .to("fillText")
        .map((c) => c.args[0]),
    ).toEqual(["extraordinarily"]);
  });

  it("clips each cell's text to the cell", () => {
    const spy = table(plain());
    expect(spy.to("rect")[0].args).toEqual([0, 0, 200, 80]);
    expect(spy.to("clip")).toHaveLength(9);
    expect(spy.names().filter((n) => n === "save")).toHaveLength(spy.names().filter((n) => n === "restore").length);
  });

  it("scales the columns and rows to the size of the element", () => {
    const spy = table(plain({ width: 600, height: 100, cells: [["a", "b"]], colWidths: [100, 200], rowHeights: [50], headerRow: false }));
    const [first, second] = spy.to("fillRect");
    expect(numbers(first)).toEqual([0, 0, 200, 100]);
    expect(numbers(second)).toEqual([200, 0, 400, 100]);
  });

  it("paints empty cells for a grid with more cells than text", () => {
    const spy = table(plain({ cells: [["only"]], headerRow: false }));
    expect(spy.to("fillRect")).toHaveLength(9);
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["only", "", "", "", "", "", "", "", ""]);
  });

  it("draws the grid lines and the outer border in the border colour", () => {
    const spy = table(plain({ borderColor: "#123456", borderWidth: 3 }));
    const stroke = spy.to("stroke")[0];
    expect(stroke.state.strokeStyle).toBe("#123456");
    expect(stroke.state.lineWidth).toBe(3);
    // 4 horizontal and 4 vertical lines
    expect(spy.to("moveTo")).toHaveLength(8);
    expect(spy.to("lineTo").map(numbers)).toEqual([
      [600, 0],
      [600, 80],
      [600, 160],
      [600, 240],
      [0, 240],
      [200, 240],
      [400, 240],
      [600, 240],
    ]);
    expect(spy.to("strokeRect")[0].args).toEqual([0, 0, 600, 240]);
  });

  it("draws no border when the border width is zero", () => {
    const spy = table(plain({ borderWidth: 0 }));
    expect(spy.to("stroke")).toHaveLength(0);
    expect(spy.to("strokeRect")).toHaveLength(0);
  });

  it("falls back to the element's own size for a grid without columns", () => {
    const spy = table(plain({ cells: [], colWidths: [], rowHeights: [], borderWidth: 2 }));
    expect(spy.to("fillRect")).toHaveLength(0);
    expect(spy.to("strokeRect")[0].args).toEqual([0, 0, 600, 240]);
  });
});

describe("charts", () => {
  const base = (init: Partial<ChartElement> = {}) => createChart({ width: 640, height: 400, ...init });
  /** font size, plot box and the nice axis maximum of the default 640 x 400 chart without a legend */
  const FS = 16;
  const PX = 48;
  const PY = 12.8;
  const PW = 584;
  const PH = 352;

  it("paints the values and the axis of a column chart", () => {
    const spy = chart(base());
    const texts = spy.to("fillText");
    // five axis labels up to the nice maximum (100), then the category names, then the value on each bar
    expect(texts.slice(0, 5).map((c) => c.args[0])).toEqual(["0", "25", "50", "75", "100"]);
    expect(texts.slice(5, 9).map((c) => c.args[0])).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(texts.slice(9).map((c) => c.args[0])).toEqual(["32", "48", "41", "66"]);
    expect(texts[0].state.textAlign).toBe("right");
    expect(texts[0].args[1]).toBeCloseTo(PX - FS * 0.5);
    expect(texts[5].state.textAlign).toBe("center");
    expect(texts[5].args[1]).toBeCloseTo(PX + (PW / 4) * 0.5);
    expect(texts[5].args[2]).toBeCloseTo(PY + PH + FS * 1.1);
  });

  it("draws one rounded bar per value, as tall as its share of the axis maximum", () => {
    const spy = chart(base());
    const bars = spy.to("roundRect");
    expect(bars).toHaveLength(4);
    const groupW = PW / 4;
    const barW = groupW * 0.72;
    const [x, y, w, h, radii] = bars[0].args as [number, number, number, number, number[]];
    expect(x).toBeCloseTo(PX + groupW * 0.14);
    expect(w).toBeCloseTo(barW);
    expect(h).toBeCloseTo((PH * 32) / 100);
    expect(y).toBeCloseTo(PY + PH - h);
    expect(radii).toEqual([6.4, 6.4, 0, 0]);
    expect(bars[0].state.fillStyle).toBe("#7c3aed");
    expect((bars[3].args[3] as number) / (bars[0].args[3] as number)).toBeCloseTo(66 / 32);
  });

  it("draws the grid lines only when asked to", () => {
    const withGrid = chart(base());
    const grid = withGrid.to("stroke");
    expect(grid).toHaveLength(5);
    expect(grid[0].state.strokeStyle).toBe("rgba(14,19,24,0.12)");
    expectNumbers(withGrid.to("moveTo")[0].args, [PX, PY + PH]);
    expect(chart(base({ showGrid: false })).to("stroke")).toHaveLength(0);
  });

  it("leaves out the values on the bars when asked to", () => {
    const texts = chart(base({ showValues: false }))
      .to("fillText")
      .map((c) => c.args[0]);
    expect(texts).toEqual(["0", "25", "50", "75", "100", "Q1", "Q2", "Q3", "Q4"]);
  });

  it("puts the value above each bar", () => {
    const spy = chart(base());
    const label = spy.to("fillText")[9];
    const bar = spy.to("roundRect")[0].args as number[];
    expect(label.state.textAlign).toBe("center");
    expect(label.args[1]).toBeCloseTo(bar[0] + bar[2] / 2);
    expect(label.args[2]).toBeCloseTo(bar[1] - FS * 0.7);
  });

  it("squares the bars on a canvas that has no roundRect", () => {
    const spy = chart(base(), { omit: ["roundRect"] });
    expect(spy.to("roundRect")).toHaveLength(0);
    expect(spy.to("rect")).toHaveLength(4);
  });

  it("groups several series side by side in their own colours", () => {
    const spy = chart(
      base({
        series: [
          { name: "A", values: [10, 20, 30, 40], color: "#ff0000" },
          { name: "B", values: [15, 25, 35, 45] },
        ],
      }),
    );
    const bars = spy.to("roundRect");
    expect(bars).toHaveLength(8);
    expect(bars[0].state.fillStyle).toBe("#ff0000");
    expect(bars[4].state.fillStyle).toBe("#14b8a6");
    // two bars share 72 % of the width of each category; the second series starts where the first one ends
    const barW = ((PW / 4) * 0.72) / 2;
    expect(bars[0].args[2]).toBeCloseTo(barW);
    expect((bars[4].args[0] as number) - (bars[0].args[0] as number)).toBeCloseTo(barW);
  });

  it("lays a bar chart on its side with the names down the left", () => {
    const spy = chart(base({ chart: "bar" }));
    const bars = spy.to("roundRect");
    expect(bars).toHaveLength(4);
    const [x, y, w, h, radii] = bars[0].args as [number, number, number, number, number[]];
    expect(x).toBe(PX);
    expect(w).toBeCloseTo((PW * 32) / 100);
    expect(h).toBeCloseTo((PH / 4) * 0.72);
    expect(y).toBeCloseTo(PY + (PH / 4) * 0.14);
    expect(radii).toEqual([0, 6.4, 6.4, 0]);
    const names = spy.to("fillText").filter((c) => ["Q1", "Q2", "Q3", "Q4"].includes(String(c.args[0])));
    expect(names).toHaveLength(4);
    expect(names[0].state.textAlign).toBe("right");
    expect(names[0].args[1]).toBeCloseTo(PX - FS * 0.5);
    expect(names[0].args[2]).toBeCloseTo(PY + (PH / 4) * 0.5);
    // the value axis runs along the bottom, and the values sit past the end of each bar
    const axis = spy.to("fillText").slice(0, 5);
    expect(axis.map((c) => c.args[0])).toEqual(["0", "25", "50", "75", "100"]);
    expect(axis[0].state.textAlign).toBe("center");
    expect(axis[4].args[1]).toBeCloseTo(PX + PW);
    const value = spy.to("fillText").find((c) => c.args[0] === "32")!;
    expect(value.state.textAlign).toBe("left");
    expect(value.args[1]).toBeCloseTo(PX + (PW * 32) / 100 + FS * 0.4);
  });

  it("squares the bars of a bar chart on a canvas that has no roundRect", () => {
    const spy = chart(base({ chart: "bar" }), { omit: ["roundRect"] });
    expect(spy.to("rect")).toHaveLength(4);
  });

  it("draws no grid lines for a bar chart when the grid is off", () => {
    expect(chart(base({ chart: "bar", showGrid: false })).to("stroke")).toHaveLength(0);
  });

  it("draws vertical grid lines for a bar chart", () => {
    const spy = chart(base({ chart: "bar" }));
    expectNumbers(spy.to("moveTo")[0].args, [PX, PY]);
    expectNumbers(spy.to("lineTo")[0].args, [PX, PY + PH]);
  });

  it("shows a legend of series names with their colours and moves the plot down", () => {
    const spy = chart(
      base({
        showLegend: true,
        series: [
          { name: "Revenue", values: [1, 2, 3, 4] },
          { name: "Cost", values: [4, 3, 2, 1], color: "#00ff00" },
        ],
      }),
    );
    const dots = spy.to("arc");
    expect(dots[0].args.slice(0, 3)).toEqual([FS * 0.4, FS * 0.9, FS * 0.4]);
    expect(spy.to("fill")[0].state.fillStyle).toBe("#7c3aed");
    expect(spy.to("fill")[1].state.fillStyle).toBe("#00ff00");
    const names = spy.to("fillText").slice(0, 2);
    expect(names.map((c) => c.args[0])).toEqual(["Revenue", "Cost"]);
    expect(names[0].args[1]).toBeCloseTo(FS * 1.1);
    expect(names[1].args[1]).toBeGreaterThan(names[0].args[1] as number);
    // the plot starts below the legend: its top grid line is 2.4 lines down instead of 0.8
    expect(spy.to("moveTo")[4].args[1]).toBeCloseTo(FS * 2.4);
    expect(chart(base()).to("moveTo")[4].args[1]).toBeCloseTo(FS * 0.8);
  });

  describe("line and area charts", () => {
    it("joins the points with a line in the series colour and rings each point", () => {
      const spy = chart(base({ chart: "line", showValues: false }));
      const line = spy.to("stroke").find((c) => c.state.strokeStyle === "#7c3aed" && c.state.lineWidth > 3)!;
      expect(line.state.lineWidth).toBeCloseTo(Math.max(2, FS * 0.22));
      expect(line.state.lineJoin).toBe("round");
      const px = (i: number) => PX + (PW / 4) * (i + 0.5);
      const py = (v: number) => PY + PH - (PH * v) / 100;
      expect(
        spy
          .to("lineTo")
          .slice(5, 8)
          .map(numbers)
          .map(([x, y]) => [Math.round(x), Math.round(y)]),
      ).toEqual([1, 2, 3].map((i) => [Math.round(px(i)), Math.round(py([32, 48, 41, 66][i]))]));
      const rings = spy.to("arc").filter((c) => c.args[2] === FS * 0.34);
      expect(rings).toHaveLength(4);
      expect(spy.to("fill")).toHaveLength(4);
      expect(spy.to("fill")[0].state.fillStyle).toBe("#ffffff");
    });

    it("prints the values above the points", () => {
      const spy = chart(base({ chart: "line" }));
      const values = spy.to("fillText").filter((c) => ["32", "48", "41", "66"].includes(String(c.args[0])));
      expect(values).toHaveLength(4);
      expect(values[0].state.font).toMatch(/^600 /);
      expect(values[0].args[2]).toBeCloseTo(PY + PH - (PH * 32) / 100 - FS * 0.9);
    });

    it("fills under an area chart with a faint copy of the series colour", () => {
      const spy = chart(base({ chart: "area", showValues: false }));
      const area = spy.to("fill")[0];
      expect(area.state.fillStyle).toBe("rgba(124,58,237,0.28)");
      expect(spy.to("moveTo").some((c) => Math.abs((c.args[1] as number) - (PY + PH)) < 1e-9)).toBe(true);
    });

    it("skips a series that has no values", () => {
      const spy = chart(
        base({
          chart: "area",
          series: [
            { name: "Empty", values: [] },
            { name: "Full", values: [5, 6, 7, 8] },
          ],
        }),
      );
      expect(spy.to("fill").filter((c) => String(c.state.fillStyle).startsWith("rgba(20,184,166"))).toHaveLength(1);
      expect(spy.to("fill").filter((c) => String(c.state.fillStyle).startsWith("rgba(124,58,237"))).toHaveLength(0);
    });
  });

  describe("pie and donut charts", () => {
    const pie = (kind: "pie" | "donut", init: Partial<ChartElement> = {}) =>
      base({ chart: kind, labels: ["A", "B", "C"], series: [{ name: "Share", values: [50, 30, 20] }], ...init });

    it("cuts a pie into slices in proportion to the values, starting at twelve o'clock", () => {
      const spy = chart(pie("pie"));
      const slices = spy.to("arc");
      expect(slices).toHaveLength(3);
      const [cx, cy, r, a0, a1] = numbers(slices[0]);
      expect(a0).toBeCloseTo(-Math.PI / 2);
      expect(a1 - a0).toBeCloseTo(Math.PI);
      expect(cx).toBe(320);
      expect(cy).toBeCloseTo(12.8 + (400 - 12.8) / 2);
      expect(r).toBeCloseTo(Math.min(640, 400 - 12.8) / 2 - FS * 1.2);
      expect(numbers(slices[1])[3]).toBeCloseTo(numbers(slices[0])[4]);
      expect(spy.to("fill").map((c) => c.state.fillStyle)).toEqual(["#7c3aed", "#14b8a6", "#f59e0b"]);
      expect(spy.to("moveTo")).toHaveLength(3);
    });

    it("separates the slices with a white line", () => {
      const stroke = chart(pie("pie")).to("stroke")[0];
      expect(stroke.state.strokeStyle).toBe("#ffffff");
      expect(stroke.state.lineWidth).toBeCloseTo(Math.max(2, FS * 0.15));
    });

    it("prints the value of each slice that is wide enough, white and centred", () => {
      const spy = chart(pie("pie", { series: [{ name: "Share", values: [97, 2, 1] }] }));
      const labels = spy.to("fillText");
      expect(labels.map((c) => c.args[0])).toEqual(["97"]);
      expect(labels[0].state.fillStyle).toBe("#ffffff");
      expect(labels[0].state.textAlign).toBe("center");
      expect(labels[0].state.font).toMatch(/^700 /);
    });

    it("leaves the values off when asked to", () => {
      expect(chart(pie("pie", { showValues: false })).to("fillText")).toHaveLength(0);
    });

    it("cuts the middle out of a donut with a second, reversed arc", () => {
      const spy = chart(pie("donut"));
      const arcs = spy.to("arc");
      expect(arcs).toHaveLength(6);
      const outer = numbers(arcs[0]);
      const inner = numbers(arcs[1]);
      expect(inner[2]).toBeCloseTo(outer[2] * 0.55);
      expect(inner[3]).toBeCloseTo(outer[4]);
      expect(inner[4]).toBeCloseTo(outer[3]);
      expect(inner[5]).toBe(true);
      expect(spy.to("moveTo")).toHaveLength(0);
    });

    it("lists the categories in the legend with the palette colours", () => {
      const spy = chart(pie("pie", { showLegend: true }));
      const legend = spy.to("fillText").slice(0, 3);
      expect(legend.map((c) => c.args[0])).toEqual(["A", "B", "C"]);
      expect(
        spy
          .to("fill")
          .slice(0, 3)
          .map((c) => c.state.fillStyle),
      ).toEqual(["#7c3aed", "#14b8a6", "#f59e0b"]);
    });

    it("does not divide by zero when every value is zero or negative", () => {
      const spy = chart(pie("pie", { series: [{ name: "Share", values: [0, -4, 0] }] }));
      expect(spy.to("arc")).toHaveLength(3);
      expect(numbers(spy.to("arc")[0])[4]).toBeCloseTo(numbers(spy.to("arc")[0])[3]);
      expect(spy.to("fillText")).toHaveLength(0);
    });

    it("draws nothing for a pie without a series", () => {
      expect(chart(pie("pie", { series: [] })).to("arc")).toHaveLength(0);
    });
  });

  describe("axis scale", () => {
    const top = (values: number[]) => chart(base({ series: [{ name: "S", values }], labels: values.map((_, i) => `L${i}`), showValues: false })).to("fillText")[4].args[0];

    it.each([
      [[1], "1"],
      [[1.5], "2"],
      [[3], "5"],
      [[7], "10"],
      [[45], "50"],
      [[66], "100"],
      [[200, 100], "200"],
      [[0.2], "1"],
      [[-5, -2], "1"],
    ])("rounds the top of the axis for %j up to %s", (values, expected) => {
      expect(top(values)).toBe(expected);
    });

    it("gives the intermediate labels as fractions of the top", () => {
      const labels = chart(base({ series: [{ name: "S", values: [1] }], labels: ["x"], showValues: false }))
        .to("fillText")
        .slice(0, 5);
      expect(labels.map((c) => c.args[0])).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
    });

    it("draws an empty plot for a chart with no series", () => {
      const spy = chart(base({ series: [], labels: [] }));
      expect(spy.to("roundRect")).toHaveLength(0);
      expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
    });
  });

  describe("text that would not fit", () => {
    /** left and right end of a piece of text, from where it was drawn, how it was aligned and how wide its font makes it */
    const span = (c: PaintCall): [number, number] => {
      const w = measureWidth(String(c.state.font), String(c.args[0]));
      const x = c.args[1] as number;
      return c.state.textAlign === "right" ? [x - w, x] : c.state.textAlign === "center" ? [x - w / 2, x + w / 2] : [x, x + w];
    };
    const long = "A category with a name that goes on for much longer than the chart has room for";

    it("takes a second line for a legend that is wider than the chart, and moves the plot down by that line", () => {
      const series = ["North America", "South America", "Europe and Africa", "Asia and the Pacific", "Everything else"].map((name) => ({ name, values: [1, 2, 3, 4] }));
      const spy = chart(base({ showLegend: true, series }));
      const names = spy.to("fillText").slice(0, 5);
      expect(names.map((c) => c.args[0])).toEqual(series.map((x) => x.name));
      const lines = [...new Set(names.map((c) => c.args[2] as number))];
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBeCloseTo(FS * 0.9);
      expect(lines[1]).toBeCloseTo(FS * 0.9 + FS * 1.5);
      for (const c of names) expect(span(c)[1]).toBeLessThanOrEqual(640);
      // the dot of the first name of the second line is back at the left edge
      const second = names.findIndex((c) => c.args[2] === lines[1]);
      expect(spy.to("arc")[second].args.slice(0, 2)).toEqual([FS * 0.4, lines[1]]);
      expect(spy.to("moveTo")[4].args[1]).toBeCloseTo(FS * 2.4 + FS * 1.5);
    });

    it("cuts a legend name that is wider than the whole chart, and leaves out what does not fit in three lines", () => {
      const one = chart(base({ showLegend: true, series: [{ name: long + long, values: [1] }] }));
      const name = one.to("fillText")[0];
      expect(String(name.args[0]).endsWith("…")).toBe(true);
      expect(span(name)[1]).toBeLessThanOrEqual(640);

      const many = chart(
        base({
          chart: "pie",
          showLegend: true,
          showValues: false,
          labels: Array.from({ length: 60 }, (_, i) => `Category ${i + 1}`),
          series: [{ name: "S", values: Array(60).fill(1) }],
        }),
      );
      const drawn = many.to("fillText");
      expect(drawn.length).toBeLessThan(60);
      expect(new Set(drawn.map((c) => c.args[2])).size).toBe(3);
      for (const c of drawn) expect(span(c)[1]).toBeLessThanOrEqual(640);
    });

    it("gives the names of a bar chart more room on the left, and cuts what still does not fit", () => {
      const spy = chart(base({ chart: "bar", labels: ["Marketing and events", long, "IT", "HR"] }));
      const names = spy.to("fillText").slice(5, 9);
      expect(names[0].args[0]).toBe("Marketing and events");
      expect(String(names[1].args[0]).endsWith("…")).toBe(true);
      expect(names[2].args[0]).toBe("IT");
      // the plot starts two fifths into the chart, and no name starts left of the chart
      const plotX = (spy.to("roundRect")[0].args as number[])[0];
      expect(plotX).toBeCloseTo(640 * 0.4);
      for (const c of names) {
        expect(c.args[1]).toBeCloseTo(plotX - FS * 0.5);
        expect(span(c)[0]).toBeGreaterThanOrEqual(0);
      }
    });

    it("cuts a name under a column to the room of its column", () => {
      const spy = chart(base({ labels: ["Q1", long, "Q3", "Q4"] }));
      const names = spy.to("fillText").slice(5, 9);
      expect(names[0].args[0]).toBe("Q1");
      expect(String(names[1].args[0]).endsWith("…")).toBe(true);
      const [from, to] = span(names[1]);
      expect(to - from).toBeLessThanOrEqual(PW / 4);
    });

    it("names only every few categories when there are too many to name each", () => {
      const labels = Array.from({ length: 40 }, (_, i) => `C${i + 1}`);
      const spy = chart(base({ labels, showValues: false, series: [{ name: "S", values: Array(40).fill(5) }] }));
      const names = spy
        .to("fillText")
        .slice(5)
        .map((c) => String(c.args[0]));
      // 584 px for 40 categories is 14.6 px each, and the widest name ("C10", 23.76 px) wants 33.36: every third is named
      expect(names).toEqual(labels.filter((_, i) => i % 3 === 0));
      expect(spy.to("roundRect")).toHaveLength(40);
    });

    it("names only every few rows of a bar chart with too many rows to name each", () => {
      const labels = Array.from({ length: 40 }, (_, i) => `C${i + 1}`);
      const spy = chart(base({ chart: "bar", labels, showValues: false, series: [{ name: "S", values: Array(40).fill(5) }] }));
      const names = spy
        .to("fillText")
        .slice(5)
        .map((c) => String(c.args[0]));
      // 352 px for 40 rows is 8.8 px each, and a name wants 17.6: every second is named
      expect(names).toEqual(labels.filter((_, i) => i % 2 === 0));
      expect(spy.to("roundRect")).toHaveLength(40);
    });

    it("leaves the values off bars and points that are too close together for them, and keeps them where they have room", () => {
      const values = Array.from({ length: 40 }, (_, i) => 1001 + i);
      const labels = values.map((_, i) => `C${i + 1}`);
      const texts = (init: Partial<ChartElement>) =>
        chart(base({ labels, series: [{ name: "S", values }], ...init }))
          .to("fillText")
          .map((c) => String(c.args[0]));
      for (const kind of ["column", "line", "area"] as const) expect(texts({ chart: kind })).not.toContain("1001");
      // forty lying bars of one series are 8.8 px apart, and a value is 13.6 px high
      expect(texts({ chart: "bar" })).not.toContain("1001");
      // eight series beside each other: each bar is 13 px wide, a value of two digits 14.96 px, which the quarter of overlap allows
      const eight = chart(base({ series: Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, values: [32, 48, 41, 66] })) }));
      expect(eight.to("fillText").filter((c) => c.args[0] === "32")).toHaveLength(8);
      // and with values of five digits they are left off
      const wide = chart(base({ series: Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, values: [32000, 48000, 41000, 66000] })) }));
      expect(wide.to("fillText").map((c) => c.args[0])).not.toContain("32000");
      expect(wide.to("roundRect")).toHaveLength(32);
    });

    it("writes large numbers short, on the axis and on the bars, and widens the margin for the axis when it has to", () => {
      const spy = chart(base({ series: [{ name: "S", values: [2500000, 48000000, 1200, 66] }] }));
      const texts = spy.to("fillText").map((c) => String(c.args[0]));
      expect(texts.slice(0, 5)).toEqual(["0", "12.5M", "25M", "37.5M", "50M"]);
      expect(texts.slice(9)).toEqual(["2.5M", "48M", "1200", "66"]);
      for (const c of spy.to("fillText").slice(0, 5)) expect(span(c)[0]).toBeGreaterThanOrEqual(0);

      const huge = chart(base({ series: [{ name: "S", values: [1.23456789e20, 1, 2, 3] }] }));
      const axis = huge.to("fillText").slice(0, 5);
      expect(axis.map((c) => c.args[0])).toEqual(["0", "5e19", "1e20", "1.5e20", "2e20"]);
      for (const c of axis) expect(span(c)[0]).toBeGreaterThanOrEqual(0);
    });

    it("leaves a chart whose text fits exactly as it was", () => {
      const spy = chart(base({ chart: "bar" }));
      expect((spy.to("roundRect")[0].args as number[])[0]).toBe(PX);
      expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["0", "25", "50", "75", "100", "Q1", "Q2", "Q3", "Q4", "32", "48", "41", "66"]);
    });
  });

  it("scales the text with the smaller side of the chart but never below 11 px", () => {
    // axis labels are 0.9 of the chart text size
    expect(chart(base({ width: 200, height: 100 })).to("fillText")[0].state.font).toMatch(/^400 9\.9\d*px/);
    expect(chart(base({ width: 1000, height: 1000 })).to("fillText")[0].state.font).toMatch(/^400 36px/);
  });
});

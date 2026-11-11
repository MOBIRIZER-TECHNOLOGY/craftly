import { describe, expect, it } from "vitest";
import { measureWidth } from "@/core/textMetrics";
import { categoryStep, chartNumber, fitText, legendLayout, legendTop, plotLeft, valuesFit } from "./chartText";

// without a browser a character is 0.55 of the font size wide: 5.5 px at 10 px
const FONT = "500 10px Inter";

describe("a chart's text cut to the room it has", () => {
  it("leaves text alone that fits", () => {
    expect(fitText(FONT, "Revenue", 100)).toBe("Revenue");
    expect(fitText(FONT, "", 0)).toBe("");
  });

  it("cuts text that does not fit and ends it with an ellipsis, no wider than the room", () => {
    const whole = "A very long name of a category";
    const cut = fitText(FONT, whole, 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThan(whole.length);
    expect(measureWidth(FONT, cut)).toBeLessThanOrEqual(60);
    // and it is the longest start that fits: one more character would not
    expect(measureWidth(FONT, whole.slice(0, cut.length) + "…")).toBeGreaterThan(60);
  });

  it("does not leave a space in front of the ellipsis, and does not cut a character made of two code units in half", () => {
    expect(fitText(FONT, "ab cdefghijklmnop", 5.5 * 4)).toBe("ab…");
    expect(fitText(FONT, "😀😀😀😀😀😀😀😀", 5.5 * 2 * 2 + 6)).toBe("😀😀…");
  });

  it("gives the ellipsis alone, or nothing, when there is no room for a character", () => {
    expect(fitText(FONT, "Revenue", 6)).toBe("…");
    expect(fitText(FONT, "Revenue", 2)).toBe("");
  });
});

describe("a number on a chart", () => {
  it("is written as it is below a million", () => {
    expect([0, 32, 12.5, -50, 999999, 0.25].map(chartNumber)).toEqual(["0", "32", "12.5", "-50", "999999", "0.25"]);
  });

  it("is shortened to millions, billions and trillions", () => {
    expect([1e6, 2500000, 25000000, 1.234e9, 7.5e12, -3e6].map(chartNumber)).toEqual(["1M", "2.5M", "25M", "1.23B", "7.5T", "-3M"]);
  });

  it("is written with an exponent beyond that, and as it is when it is no number", () => {
    expect(chartNumber(1e20)).toBe("1e20");
    expect(chartNumber(2.5e19)).toBe("2.5e19");
    expect(chartNumber(-4e15)).toBe("-4e15");
    expect(chartNumber(Infinity)).toBe("Infinity");
    expect(chartNumber(NaN)).toBe("NaN");
  });
});

describe("the legend of a chart", () => {
  const FS = 10;

  it("puts the names side by side on one line when they fit, as before", () => {
    const { items, rows } = legendLayout(["Revenue", "Cost"], FONT, FS, 400);
    expect(rows).toBe(1);
    expect(items).toEqual([
      { index: 0, text: "Revenue", x: 0, row: 0 },
      { index: 1, text: "Cost", x: 7 * 5.5 + FS * 2.2, row: 0 },
    ]);
    expect(legendTop(FS, rows)).toBeCloseTo(FS * 2.4);
  });

  it("starts a new line when the next name would pass the right edge of the chart", () => {
    const { items, rows } = legendLayout(["Alpha", "Bravo", "Charlie", "Delta"], FONT, FS, 110);
    expect(items.map((i) => [i.text, i.row, i.x])).toEqual([
      ["Alpha", 0, 0],
      ["Bravo", 0, 5 * 5.5 + 22],
      ["Charlie", 1, 0],
      ["Delta", 1, 7 * 5.5 + 22],
    ]);
    expect(rows).toBe(2);
    expect(legendTop(FS, rows)).toBeCloseTo(FS * 2.4 + FS * 1.5);
    for (const i of items) expect(i.x + FS * 1.1 + measureWidth(FONT, i.text)).toBeLessThanOrEqual(110);
  });

  it("cuts a name that is wider than the chart", () => {
    const { items } = legendLayout(["A name that goes on and on and on"], FONT, FS, 100);
    expect(items[0].text.endsWith("…")).toBe(true);
    expect(FS * 1.1 + measureWidth(FONT, items[0].text)).toBeLessThanOrEqual(100);
  });

  it("stops after three lines and says how many names are left out", () => {
    const names = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
    const { items, rows, hidden } = legendLayout(names, FONT, FS, 120);
    expect(rows).toBe(3);
    expect(Math.max(...items.map((i) => i.row))).toBe(2);
    expect(hidden).toBe(30 - items.length);
    expect(hidden).toBeGreaterThan(0);
  });

  it("is one line high with nothing in it", () => {
    expect(legendLayout([], FONT, FS, 100)).toEqual({ items: [], rows: 1, hidden: 0 });
  });
});

describe("the room beside and under the plot", () => {
  it("keeps the usual margin on the left for short labels", () => {
    expect(plotLeft(16, 640, 24)).toBe(48);
  });

  it("widens the margin for longer labels, up to two fifths of the chart", () => {
    expect(plotLeft(16, 640, 100)).toBe(116);
    expect(plotLeft(16, 640, 900)).toBe(256);
    // a chart so narrow that two fifths is less than the usual margin keeps the usual margin
    expect(plotLeft(16, 100, 900)).toBe(48);
  });

  it("names every category while each has room for the widest name, and every few when they get crowded", () => {
    // a name of 20 px wants 20 + 9.6 px
    expect(categoryStep(16, 146, 20)).toBe(1);
    expect(categoryStep(16, 29.6, 20)).toBe(1);
    expect(categoryStep(16, 20, 20)).toBe(2);
    expect(categoryStep(16, 10, 20)).toBe(3);
    expect(categoryStep(16, 0, 20)).toBe(1);
  });

  it("counts a very long name as six font sizes, because it is cut anyway", () => {
    expect(categoryStep(16, 110, 5000)).toBe(1);
    expect(categoryStep(16, 60, 5000)).toBe(2);
  });

  it("says whether the values have room on their marks", () => {
    expect(valuesFit(15, 52)).toBe(true);
    expect(valuesFit(50, 40)).toBe(true);
    expect(valuesFit(51, 40)).toBe(false);
    expect(valuesFit(14, 2)).toBe(false);
  });
});

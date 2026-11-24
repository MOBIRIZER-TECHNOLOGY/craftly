/**
 * Where the text of a chart goes and how much of it is written, so that it stays inside the chart: names that are cut to their
 * room, a legend that takes more than one line, long numbers written short, and a margin that grows with the labels beside the
 * plot. The painter (drawBlocks.ts) and the SVG writer (src/export/svgBlocks.ts) both ask here, so the two draw the same chart.
 */
import { measureWidth } from "@/core/textMetrics";
import type { ChartElement, ChartSeries } from "@/core/types";

export const ELLIPSIS = "…";

/** `text`, or as much of its start as fits in `maxWidth` followed by an ellipsis (the ellipsis alone, or nothing, without room for a character). */
export function fitText(font: string, text: string, maxWidth: number): string {
  if (measureWidth(font, text) <= maxWidth) return text;
  // by code point, so that a character made of two code units is not cut in half
  const chars = Array.from(text);
  const cut = (count: number) => chars.slice(0, count).join("").trimEnd() + ELLIPSIS;
  let fits = 0;
  let over = chars.length;
  while (over - fits > 1) {
    const middle = (fits + over) >> 1;
    if (measureWidth(font, cut(middle)) <= maxWidth) fits = middle;
    else over = middle;
  }
  if (fits > 0) return cut(fits);
  return measureWidth(font, ELLIPSIS) <= maxWidth ? ELLIPSIS : "";
}

const UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];

/** A value as a chart writes it: as it is below a million, then in millions, billions and trillions, then with an exponent. */
export function chartNumber(value: number): string {
  const size = Math.abs(value);
  if (!Number.isFinite(value) || size < 1e6) return String(value);
  if (size >= 1e15) {
    const [digits, exponent] = value.toExponential(2).split("e");
    return `${Number(digits)}e${Number(exponent)}`;
  }
  const [unit, letter] = UNITS.find(([u]) => size >= u)!;
  return String(Number((value / unit).toPrecision(3))) + letter;
}

export interface LegendItem {
  /** which name (and so which colour) this is */
  index: number;
  text: string;
  /** left edge of the item's dot */
  x: number;
  row: number;
}

export const LEGEND_ROWS = 3;

/**
 * The names of a legend laid out in lines no wider than the chart: an item is a dot (0.8 of the font size) and its name 1.1 font
 * sizes from the item's left edge, and the next item starts 2.2 font sizes after the name, as it always did on one line. After
 * `LEGEND_ROWS` lines the rest is left out and counted in `hidden`.
 */
export function legendLayout(names: readonly string[], font: string, fs: number, width: number): { items: LegendItem[]; rows: number; hidden: number } {
  const items: LegendItem[] = [];
  let x = 0;
  let row = 0;
  for (let index = 0; index < names.length; index++) {
    const text = fitText(font, names[index], width - fs * 1.1);
    const textWidth = measureWidth(font, text);
    if (x > 0 && x + fs * 1.1 + textWidth > width) {
      row++;
      x = 0;
    }
    if (row >= LEGEND_ROWS) return { items, rows: LEGEND_ROWS, hidden: names.length - index };
    items.push({ index, text, x, row });
    x += textWidth + fs * 2.2;
  }
  return { items, rows: row + 1, hidden: 0 };
}

/** The distance between two lines of a legend, in font sizes. */
export const LEGEND_LINE = 1.5;

/** Where the plot starts under a legend of this many lines (2.4 font sizes under one line, as it always was). */
export const legendTop = (fs: number, rows: number): number => fs * 2.4 + (rows - 1) * fs * LEGEND_LINE;

/**
 * The margin on the left of the plot, which holds the numbers of the axis (or the names of the categories of a bar chart): three
 * font sizes as it always was, more when the widest of them needs it, and never more than two fifths of the chart.
 */
export function plotLeft(fs: number, width: number, widestLabel: number): number {
  const usual = fs * 3;
  return Math.max(usual, Math.min(widestLabel + fs, width * 0.4));
}

/**
 * Under a plot with many categories not every one can be named: every how-many-th is, given the room each category has and the
 * width of the widest name. A name counts for six font sizes at most (a longer one is cut), and wants a little air beside it.
 */
export function categoryStep(fs: number, slot: number, widestLabel: number): number {
  const needed = Math.min(widestLabel, fs * 6) + fs * 0.6;
  return slot > 0 && slot < needed ? Math.ceil(needed / slot) : 1;
}

/**
 * Is there room to write the values on the marks of a plot? `size` is what the largest value takes along the direction in which
 * the marks follow each other (its width over upright bars and over points, its height beside lying bars) and `gap` the distance
 * from one mark to the next. Values that would run into each other are left off: a row of numbers that cannot be read says less
 * than none. A quarter of overlap is allowed, because the widest value is seldom beside one as wide.
 */
export const valuesFit = (size: number, gap: number): boolean => size <= gap * 1.25;

/* ------------------------------------------------------------------ */
/* stacked bars and columns                                            */
/* ------------------------------------------------------------------ */

/** True for a chart that puts its series on top of each other: a bar or column chart that was asked to and has more than one series. */
export const isStacked = (el: Pick<ChartElement, "chart" | "series" | "stacked">): boolean =>
  !!el.stacked && (el.chart === "bar" || el.chart === "column" || el.chart === "area") && el.series.length > 1;

export function percentSeries(series: ChartSeries[]): ChartSeries[] {
  const count = Math.max(1, ...series.map((series) => series.values.length));
  const totals = Array.from({ length: count }, (_unused, i) => series.reduce((sum, series) => sum + Math.max(0, series.values[i] ?? 0), 0));
  return series.map((series) => ({
    ...series,
    values: series.values.map((value, i) => (totals[i] ? (Math.max(0, value) / totals[i]) * 100 : 0)),
  }));
}

/** What a value adds to its stack: nothing when it is negative, missing or no number. */
const stackValue = (value: number | undefined): number => (typeof value === "number" && value > 0 && Number.isFinite(value) ? value : 0);

/** The height of every stack: the sum of what its series add, for as many categories as the longest series has values. */
export function stackTotals(series: readonly ChartSeries[]): number[] {
  const count = Math.max(0, ...series.map((s) => s.values.length));
  return Array.from({ length: count }, (_v, i) => series.reduce((sum, s) => sum + stackValue(s.values[i]), 0));
}

export interface StackPiece {
  /** index of the series (its colour) and of the category (its stack) */
  series: number;
  category: number;
  /** where the piece begins, in the unit of the values, and how much it adds */
  from: number;
  value: number;
  /** the last piece of its stack: the one whose far end is rounded */
  last: boolean;
}

/** The pieces of every stack, in the order they are painted: stack after stack, each from the axis outwards. Pieces of no size are left out. */
export function stackPieces(series: readonly ChartSeries[]): StackPiece[] {
  const pieces: StackPiece[] = [];
  stackTotals(series).forEach((_total, category) => {
    let from = 0;
    const first = pieces.length;
    series.forEach((s, index) => {
      const value = stackValue(s.values[category]);
      if (!value) return;
      pieces.push({ series: index, category, from, value, last: false });
      from += value;
    });
    if (pieces.length > first) pieces[pieces.length - 1].last = true;
  });
  return pieces;
}

/* ------------------------------------------------------------------ */
/* axis titles                                                         */
/* ------------------------------------------------------------------ */

/** The room a title along an axis takes beside or under the plot, in font sizes. */
export const AXIS_TITLE_ROOM = 1.6;

const titleText = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * The titles of the two axes by where they are written: under the plot and, turned a quarter, on its left. A bar chart lies on
 * its side, so its values run along the bottom; every other chart has its categories there. Empty strings where there is none.
 */
export function axisTitles(el: Pick<ChartElement, "chart" | "valueAxisTitle" | "categoryAxisTitle">): { bottom: string; left: string } {
  const value = titleText(el.valueAxisTitle);
  const category = titleText(el.categoryAxisTitle);
  return el.chart === "bar" ? { bottom: value, left: category } : { bottom: category, left: value };
}

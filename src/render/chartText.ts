/**
 * Where the text of a chart goes and how much of it is written, so that it stays inside the chart: names that are cut to their
 * room, a legend that takes more than one line, long numbers written short, and a margin that grows with the labels beside the
 * plot. The painter (drawBlocks.ts) and the SVG writer (src/export/svgBlocks.ts) both ask here, so the two draw the same chart.
 */
import { measureWidth } from "@/core/textMetrics";

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

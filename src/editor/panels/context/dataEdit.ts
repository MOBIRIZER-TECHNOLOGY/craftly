/**
 * Pure edits behind the Data panel (tables and charts). Every function MUTATES the element it is given (the store
 * hands them immer drafts, tests hand them clones). A table keeps its width and height: adding or removing rows and
 * columns redistributes the row heights / column widths instead.
 */
import { TABLE_LIMITS, oneLine, type ChartData, type DataLimits } from "@/core/delimited";
import type { ChartElement, TableElement } from "@/core/types";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Resize `sizes` to `count` entries (new ones get the average) and scale them so they add up to `total`. */
function fitSizes(sizes: number[], count: number, total: number): number[] {
  const out = sizes.slice(0, count);
  while (out.length < count) out.push(out.length ? sum(out) / out.length : total / Math.max(1, count));
  const s = sum(out) || 1;
  return out.map((v) => (v * total) / s);
}

/** cells, colWidths and rowHeights agree on the grid size; sizes add up to the element's box. */
export function normalizeTable(t: TableElement): void {
  const rows = t.cells.length;
  const cols = t.cells[0]?.length ?? 0;
  t.rowHeights = fitSizes(t.rowHeights, rows, t.height);
  t.colWidths = fitSizes(t.colWidths, cols, t.width);
}

export const tableSize = (t: Pick<TableElement, "cells">) => ({ rows: t.cells.length, cols: t.cells[0]?.length ?? 0 });

function shiftTableMeta(t: TableElement, axis: "row" | "col", at: number, delta: number): void {
  if (t.merges) {
    for (const merge of t.merges) if (merge[axis] >= at) merge[axis] += delta;
    t.merges = t.merges.filter((merge) => merge.row >= 0 && merge.col >= 0 && merge.row < t.cells.length && merge.col < (t.cells[0]?.length ?? 0));
    for (const merge of t.merges) {
      merge.rowSpan = Math.max(1, Math.min(merge.rowSpan, t.cells.length - merge.row));
      merge.colSpan = Math.max(1, Math.min(merge.colSpan, (t.cells[0]?.length ?? 0) - merge.col));
    }
    if (!t.merges.length) delete t.merges;
  }
  if (!t.cellStyles) return;
  const styles: typeof t.cellStyles = {};
  for (const [key, style] of Object.entries(t.cellStyles)) {
    const cell = key.split(":").map(Number);
    const index = axis === "row" ? cell[0] : cell[1];
    if (index === at && delta < 0) continue;
    const shifted = index >= at ? index + delta : index;
    if (shifted >= 0) styles[axis === "row" ? `${shifted}:${cell[1]}` : `${cell[0]}:${shifted}`] = style;
  }
  t.cellStyles = styles;
}

export function addTableRow(t: TableElement, at = t.cells.length): void {
  const { cols } = tableSize(t);
  const index = Math.max(0, Math.min(t.cells.length, at));
  t.cells.splice(
    index,
    0,
    Array.from({ length: cols }, () => ""),
  );
  t.rowHeights.splice(index, 0, sum(t.rowHeights) / Math.max(1, t.rowHeights.length));
  shiftTableMeta(t, "row", index, 1);
  normalizeTable(t);
}

export function removeTableRow(t: TableElement, at: number): void {
  if (t.cells.length <= 1 || at < 0 || at >= t.cells.length) return;
  t.cells.splice(at, 1);
  t.rowHeights.splice(at, 1);
  shiftTableMeta(t, "row", at, -1);
  normalizeTable(t);
}

export function addTableColumn(t: TableElement, at = tableSize(t).cols): void {
  const { cols } = tableSize(t);
  const index = Math.max(0, Math.min(cols, at));
  t.cells.forEach((row, r) => row.splice(index, 0, r === 0 && t.headerRow ? `Heading ${index + 1}` : ""));
  t.colWidths.splice(index, 0, sum(t.colWidths) / Math.max(1, t.colWidths.length));
  shiftTableMeta(t, "col", index, 1);
  normalizeTable(t);
}

export function removeTableColumn(t: TableElement, at: number): void {
  if (tableSize(t).cols <= 1 || at < 0 || at >= tableSize(t).cols) return;
  t.cells.forEach((row) => row.splice(at, 1));
  t.colWidths.splice(at, 1);
  shiftTableMeta(t, "col", at, -1);
  normalizeTable(t);
}

/**
 * Rows of data bring more rows than a person adds by hand, and a row lower than its text shows nothing. So after data came
 * in the table is made as tall as its rows need (one and a half times the font size each), and never lower than it was.
 */
function fitTableToRows(t: TableElement): void {
  t.height = Math.max(t.height, Math.ceil(t.fontSize * 1.5) * t.cells.length);
  normalizeTable(t);
}

/**
 * The cells of the table become `rows` (rectangular, as the parser gives them). The look of the table and its width stay;
 * columns that are still there keep their share of the width, new ones get the average.
 */
export function replaceTableCells(t: TableElement, rows: string[][]): void {
  if (!rows.length || !rows[0].length) return;
  t.cells = rows.map((row) => row.map(oneLine));
  delete t.merges;
  delete t.cellStyles;
  fitTableToRows(t);
}

/**
 * Writes `rows` into the table from the cell `at` on, as a spreadsheet does with a paste, adding the rows and columns that
 * are missing up to `limits`. True when something did not fit.
 */
export function spreadTableCells(t: TableElement, at: { row: number; col: number }, rows: string[][], limits: DataLimits = TABLE_LIMITS): boolean {
  const wanted = { rows: at.row + rows.length, cols: at.col + Math.max(0, ...rows.map((r) => r.length)) };
  const size = { rows: Math.max(t.cells.length, Math.min(wanted.rows, limits.rows)), cols: Math.max(tableSize(t).cols, Math.min(wanted.cols, limits.cols)) };
  for (const row of t.cells) while (row.length < size.cols) row.push("");
  while (t.cells.length < size.rows) t.cells.push(Array.from({ length: size.cols }, () => ""));
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (at.row + r < size.rows && at.col + c < size.cols) t.cells[at.row + r][at.col + c] = oneLine(cell);
    }),
  );
  fitTableToRows(t);
  return wanted.rows > size.rows || wanted.cols > size.cols;
}

/* ------------------------------------------------------------------ */
/* charts                                                              */
/* ------------------------------------------------------------------ */

/** Labels and series of the chart become those of the data. Its kind and colours stay, and so does the colour a series had. */
export function replaceChartData(c: ChartElement, data: ChartData): void {
  const colors = c.series.map((s) => s.color);
  c.labels = [...data.labels];
  c.series = data.series.map((s, i) => (colors[i] ? { name: s.name, values: [...s.values], color: colors[i] } : { name: s.name, values: [...s.values] }));
}

const average = (values: number[], fallback = 10) => (values.length ? Math.round(sum(values) / values.length) : fallback);

/** Parses a number typed into a data cell; null when it is not a plain number. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export function addChartRow(c: ChartElement): void {
  c.labels.push(`Item ${c.labels.length + 1}`);
  for (const s of c.series) s.values.push(average(s.values));
}

export function removeChartRow(c: ChartElement, at: number): void {
  if (c.labels.length <= 1 || at < 0 || at >= c.labels.length) return;
  c.labels.splice(at, 1);
  for (const s of c.series) s.values.splice(at, 1);
}

export function addChartSeries(c: ChartElement): void {
  const values = c.labels.map((_, i) => average(c.series.map((s) => s.values[i] ?? 0)));
  c.series.push({ name: `Series ${c.series.length + 1}`, values });
}

export function removeChartSeries(c: ChartElement, at: number): void {
  if (c.series.length <= 1 || at < 0 || at >= c.series.length) return;
  c.series.splice(at, 1);
}

/** Colour of the series / slice `i` as the renderer resolves it. */
export function chartColor(c: ChartElement, i: number): string {
  return c.chart === "pie" || c.chart === "donut" ? c.palette[i % c.palette.length] : (c.series[i]?.color ?? c.palette[i % c.palette.length]);
}

/** Sets palette colour `i`; a series that had its own colour follows, so the swatch always does something visible. */
export function setChartPaletteColor(c: ChartElement, i: number, color: string): void {
  if (!c.palette.length) return;
  const at = i % c.palette.length;
  c.palette = c.palette.map((p, j) => (j === at ? color : p));
  const own = c.series[at];
  if (own?.color) own.color = color;
}

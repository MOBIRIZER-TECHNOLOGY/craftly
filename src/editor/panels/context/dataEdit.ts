/**
 * Pure edits behind the Data panel (tables and charts). Every function MUTATES the element it is given (the store
 * hands them immer drafts, tests hand them clones). A table keeps its width and height: adding or removing rows and
 * columns redistributes the row heights / column widths instead.
 */
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

export function addTableRow(t: TableElement, at = t.cells.length): void {
  const { cols } = tableSize(t);
  const index = Math.max(0, Math.min(t.cells.length, at));
  t.cells.splice(
    index,
    0,
    Array.from({ length: cols }, () => ""),
  );
  t.rowHeights.splice(index, 0, sum(t.rowHeights) / Math.max(1, t.rowHeights.length));
  normalizeTable(t);
}

export function removeTableRow(t: TableElement, at: number): void {
  if (t.cells.length <= 1 || at < 0 || at >= t.cells.length) return;
  t.cells.splice(at, 1);
  t.rowHeights.splice(at, 1);
  normalizeTable(t);
}

export function addTableColumn(t: TableElement, at = tableSize(t).cols): void {
  const { cols } = tableSize(t);
  const index = Math.max(0, Math.min(cols, at));
  t.cells.forEach((row, r) => row.splice(index, 0, r === 0 && t.headerRow ? `Heading ${index + 1}` : ""));
  t.colWidths.splice(index, 0, sum(t.colWidths) / Math.max(1, t.colWidths.length));
  normalizeTable(t);
}

export function removeTableColumn(t: TableElement, at: number): void {
  if (tableSize(t).cols <= 1 || at < 0 || at >= tableSize(t).cols) return;
  t.cells.forEach((row) => row.splice(at, 1));
  t.colWidths.splice(at, 1);
  normalizeTable(t);
}

/* ------------------------------------------------------------------ */
/* charts                                                              */
/* ------------------------------------------------------------------ */

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

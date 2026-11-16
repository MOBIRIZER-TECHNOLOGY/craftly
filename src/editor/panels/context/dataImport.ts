/**
 * Data from outside into a table or a chart: the text of a paste or of a chosen file is read by `@/core/delimited` and put
 * into the element as one undo step. Every function answers with a report whose message says what came in and what was left
 * out; the caller shows it. The text is data only: it becomes the strings of cells and the numbers of series, nothing else.
 */
import { CHART_LIMITS, MAX_CELL_CHARS, TABLE_LIMITS, chartData, parseDelimited, tabularText, type DelimitedData } from "@/core/delimited";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { ChartElement, DesignElement, ID, TableElement } from "@/core/types";
import { m } from "@/i18n";
import { toast } from "@/ui";
import { replaceChartData, replaceTableCells, spreadTableCells } from "./dataEdit";

/** A file larger than this is not read. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ImportReport {
  /** the element was changed */
  ok: boolean;
  /** everything came in as it was: nothing cut, nothing that was no number */
  clean: boolean;
  message: string;
}

const refused = (message: string): ImportReport => ({ ok: false, clean: false, message });

const TABLE_FULL = m.panelsContext.dataImport.tableFull(TABLE_LIMITS.rows, TABLE_LIMITS.cols);
const CHART_FULL = m.panelsContext.dataImport.chartFull(CHART_LIMITS.rows - 1, CHART_LIMITS.cols - 1);

/** The sentences about what did not come in. `full` is said when rows or columns were over the limit. */
function cutNotes(cut: DelimitedData["cut"], overLimit: boolean, full: string): string[] {
  const notes: string[] = [];
  if (overLimit) notes.push(full);
  if (cut.cells) notes.push(m.panelsContext.dataImport.cellsShortened(cut.cells, MAX_CELL_CHARS));
  if (cut.input) notes.push(m.panelsContext.dataImport.tooLong);
  return notes;
}

const report = (first: string, notes: string[]): ImportReport => ({ ok: true, clean: notes.length === 0, message: [first, ...notes].join(" ") });

/** The element of the open page with this id when it is of this type and may be changed, or the reason why not. */
function target<T extends "table" | "chart">(id: ID, type: T): Extract<DesignElement, { type: T }> | ImportReport {
  const page = getActivePage(useEditor.getState());
  const el = page ? findElement(page, id) : null;
  if (!el || el.type !== type) return refused(m.panelsContext.dataImport.gone[type]);
  if (el.locked) return refused(m.panelsContext.dataImport.locked[type]);
  return el as Extract<DesignElement, { type: T }>;
}

/** Replaces the cells of a table with the rows of `text`. */
export function importTableData(id: ID, text: string, parsed?: DelimitedData): ImportReport {
  const el = target(id, "table");
  if ("ok" in el) return el;
  const data = parsed ?? parseDelimited(text, TABLE_LIMITS);
  if (!data.rows.length) return refused(m.panelsContext.dataImport.noData);
  getActions().updateElements([id], (t) => replaceTableCells(t as TableElement, data.rows));
  const first = m.panelsContext.dataImport.importedTable(data.rows.length, data.rows[0].length);
  return report(first, cutNotes(data.cut, data.cut.rows || data.cut.cols, TABLE_FULL));
}

/** Replaces labels and series of a chart with those of `text`. */
export function importChartData(id: ID, text: string): ImportReport {
  const el = target(id, "chart");
  if ("ok" in el) return el;
  const parsed = parseDelimited(text, CHART_LIMITS);
  const data = chartData(parsed);
  if (!data) return refused(m.panelsContext.dataImport.noNumbers);
  getActions().updateElements([id], (c) => replaceChartData(c as ChartElement, data));
  const notes: string[] = [];
  if (data.notNumbers) notes.push(m.panelsContext.dataImport.notNumbers(data.notNumbers));
  if ((el.chart === "pie" || el.chart === "donut") && data.series.length > 1) notes.push(m.panelsContext.dataImport.pieFirstSeries);
  notes.push(...cutNotes(parsed.cut, parsed.cut.rows || parsed.cut.cols, CHART_FULL));
  return report(m.panelsContext.dataImport.importedChart(data.labels.length, data.series.length), notes);
}

/**
 * A paste into one cell of a table. Cells divided by tabs (what a spreadsheet copies, one row of them too) and a clear CSV
 * are written from that cell on; null for any other text, which is then the browser's to put into the field.
 */
export function pasteIntoTableCell(id: ID, at: { row: number; col: number }, text: string): ImportReport | null {
  const data = text.includes("\t") ? parseDelimited(text, { ...TABLE_LIMITS, delimiter: "\t" }) : tabularText(text);
  // one cell, or nothing but tabs, is not a block of cells
  if (!data || data.rows.length * (data.rows[0]?.length ?? 0) < 2 || data.rows.every((row) => row.every((cell) => cell === ""))) return null;
  const el = target(id, "table");
  if ("ok" in el) return el;
  const fit = { overflow: false };
  getActions().updateElements([id], (t) => void (fit.overflow = spreadTableCells(t as TableElement, at, data.rows)));
  const first = m.panelsContext.dataImport.pasted(data.rows.length, data.rows[0].length);
  return report(first, cutNotes(data.cut, fit.overflow || data.cut.rows || data.cut.cols, TABLE_FULL));
}

/** Shows a report as a toast: a success when everything came in, a notice when something was left out, an error when refused. */
export function tellImport(result: ImportReport): void {
  if (!result.ok) toast.error(result.message);
  else if (result.clean) toast.success(result.message);
  else toast.info(result.message);
}

/**
 * A paste on the canvas while exactly one table or chart is selected: text that is plainly a table (see `tabularText`) fills
 * it. False for anything else, and the paste goes on to become a text box as before.
 */
export function pasteDataIntoSelection(text: string): boolean {
  const s = useEditor.getState();
  const page = getActivePage(s);
  const el = page && s.selection.length === 1 ? findElement(page, s.selection[0]) : null;
  if (!el || el.locked || (el.type !== "table" && el.type !== "chart")) return false;
  const data = tabularText(text);
  if (!data) return false;
  const result = el.type === "table" ? importTableData(el.id, text, data) : importChartData(el.id, text);
  // a block of words is nothing a chart can show: it stays a paste of text
  if (!result.ok) return false;
  tellImport(result);
  return true;
}

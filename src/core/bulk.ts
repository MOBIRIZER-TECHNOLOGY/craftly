/**
 * Bulk create: a page for every row of a sheet of data. The first row of the sheet names its columns, and a page says where a
 * column goes with the name between double braces, `{{Name}}`, in a text box or in a cell of a table. Pure: no DOM, no store.
 *
 * The data comes from a paste or a file, so it is text and nothing else: a value is put where the braces were as the string it
 * is, in the style of the run the braces began in, and what a value holds is never read as braces again.
 */
import { oneLine, type DataLimits, type DelimitedData } from "./delimited";
import { walk } from "./ops";
import type { DesignElement, ID, Page, TextParagraph } from "./types";

/** A sheet for bulk create takes 1000 rows under its row of names, created in batches. */
export const BULK_LIMITS: DataLimits = { rows: 1001, cols: 50 };

export interface BulkField {
  /** the name as the first row wrote it, on one line */
  name: string;
  /** how the name is compared: capitals and the spaces around and inside it do not count */
  key: string;
  /** the column of the sheet */
  col: number;
}

export interface BulkData {
  /** the columns that have a name; of two columns with one name, the first */
  fields: BulkField[];
  /** the rows under the first one, as the sheet has them */
  records: string[][];
}

/** A name between double braces. A name has no brace and no line break in it. */
const BRACES = /\{\{([^{}\r\n]{1,200})\}\}/g;

/** How a name is compared with another. */
export const fieldKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** What to write on a page for a column. */
export const placeholderFor = (name: string): string => `{{${name}}}`;

/** The columns and the records of a sheet, or null when it has no row under the first one or no column with a name. */
export function bulkData(data: DelimitedData): BulkData | null {
  if (data.rows.length < 2) return null;
  const fields: BulkField[] = [];
  const seen = new Set<string>();
  data.rows[0].forEach((cell, col) => {
    const name = oneLine(cell).replace(/[{}]/g, "");
    const key = fieldKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    fields.push({ name: name.trim().replace(/\s+/g, " "), key, col });
  });
  return fields.length ? { fields, records: data.rows.slice(1) } : null;
}

/** The values of one record by the keys of their columns. Line ends are those of a text box. */
export function recordValues(data: BulkData, record: readonly string[]): Map<string, string> {
  return new Map(data.fields.map((f) => [f.key, (record[f.col] ?? "").replace(/\r\n?/g, "\n")]));
}

const paragraphText = (p: TextParagraph): string => p.runs.map((r) => r.text).join("");

/** The texts of an element in which braces count: the paragraphs of a text box, the cells of a table. */
function textsOf(el: DesignElement): string[] {
  if (el.type === "text") return el.paragraphs.map(paragraphText);
  if (el.type === "table") return el.cells.flat();
  return [];
}

/** The keys of every name in braces on a page, in the order they come: in text boxes (inside groups too) and in tables. */
export function pagePlaceholders(page: Page): string[] {
  const keys = new Set<string>();
  walk(page.elements, (el) => {
    for (const text of textsOf(el)) for (const hit of text.matchAll(BRACES)) keys.add(fieldKey(hit[1]));
  });
  return [...keys];
}

/** `text` with every name in braces that has a value replaced by it. Braces around another name stay as they are. */
export function fillText(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(BRACES, (whole, name: string) => values.get(fieldKey(name)) ?? whole);
}

/**
 * A paragraph with its braces filled, or null when it has none with a value. Braces that were typed in one go lie in one run;
 * braces of which a part was made bold lie in several, and then the value takes the style of the run they begin in.
 */
export function fillParagraph(paragraph: TextParagraph, values: ReadonlyMap<string, string>): TextParagraph | null {
  const hits = [...paragraphText(paragraph).matchAll(BRACES)].filter((hit) => values.has(fieldKey(hit[1])));
  if (!hits.length) return null;
  const runs = paragraph.runs.map((run) => ({ ...run }));
  const starts: number[] = [];
  let at = 0;
  for (const run of runs) {
    starts.push(at);
    at += run.text.length;
  }
  /** the run that holds the character at `pos`: the last one that begins at or before it */
  const runAt = (pos: number): number => {
    let i = runs.length - 1;
    while (i > 0 && starts[i] > pos) i--;
    return i;
  };
  // from the last to the first, so that the places of the earlier ones stay what they were
  for (const hit of hits.reverse()) {
    const value = values.get(fieldKey(hit[1])) as string;
    const first = hit.index;
    const last = first + hit[0].length - 1;
    const a = runAt(first);
    const b = runAt(last);
    const head = runs[a].text.slice(0, first - starts[a]);
    const tail = runs[b].text.slice(last - starts[b] + 1);
    if (a === b) runs[a].text = head + value + tail;
    else {
      runs[a].text = head + value;
      for (let k = a + 1; k < b; k++) runs[k].text = "";
      runs[b].text = tail;
    }
  }
  const kept = runs.filter((run) => run.text !== "");
  return { ...paragraph, runs: kept.length ? kept : [{ ...runs[0], text: "" }] };
}

export interface BulkFill {
  id: ID;
  /** the element is locked: it is filled all the same, a new page is nobody's work yet */
  locked: boolean;
  /** the new paragraphs of a text box */
  paragraphs?: TextParagraph[];
  /** the new cells of a table */
  cells?: string[][];
}

/** What changes on a page when its braces are filled with these values: one entry for each text box and table that has some. */
export function pageFills(page: Page, values: ReadonlyMap<string, string>): BulkFill[] {
  const fills: BulkFill[] = [];
  walk(page.elements, (el) => {
    if (el.type === "text") {
      let changed = false;
      const paragraphs = el.paragraphs.map((p) => {
        const filled = fillParagraph(p, values);
        if (filled) changed = true;
        return filled ?? p;
      });
      if (changed) fills.push({ id: el.id, locked: !!el.locked, paragraphs });
    } else if (el.type === "table") {
      const cells = el.cells.map((row) => row.map((cell) => fillText(cell, values)));
      if (cells.some((row, r) => row.some((cell, c) => cell !== el.cells[r][c]))) fills.push({ id: el.id, locked: !!el.locked, cells });
    }
  });
  return fills;
}

/** Puts a fill into its element. For an immer draft or a copy: the element is changed in place. */
export function applyFill(el: DesignElement, fill: BulkFill): void {
  if (el.type === "text" && fill.paragraphs) el.paragraphs = fill.paragraphs;
  else if (el.type === "table" && fill.cells) el.cells = fill.cells;
}

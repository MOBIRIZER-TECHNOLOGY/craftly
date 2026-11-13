/**
 * Reads delimited text (CSV, or the block a spreadsheet puts on the clipboard) into rows of plain strings, and reads the
 * numbers of such rows for a chart. Pure: no DOM, no store. The text comes from a file or the clipboard, so it is data and
 * nothing else: it is never run, never fetched, and every cell stays the string it was.
 *
 * The limits are hard. A paste of any size is read only up to MAX_INPUT_CHARS, and reading stops at the last row that fits,
 * so the editor cannot be frozen by what somebody pastes. Whatever was left out is named in `cut`, for the message.
 */

export type Delimiter = "," | ";" | "\t";

/** Longer text is read only up to here. */
export const MAX_INPUT_CHARS = 2_000_000;
/** A longer cell is shortened to this. */
export const MAX_CELL_CHARS = 1_000;

export interface DataLimits {
  rows: number;
  cols: number;
}

/** A table takes this much. */
export const TABLE_LIMITS: DataLimits = { rows: 200, cols: 50 };
/** A chart takes 100 rows under a row of headings, and 12 series beside the column of labels. */
export const CHART_LIMITS: DataLimits = { rows: 101, cols: 13 };

export interface DelimitedData {
  /** every row has the same number of cells: short rows are padded with empty cells */
  rows: string[][];
  delimiter: Delimiter;
  /** the rows of the text did not all have the same number of cells */
  ragged: boolean;
  /** what did not fit: rows or columns beyond the limits, the number of cells that were shortened, text beyond the cap */
  cut: { rows: boolean; cols: boolean; cells: number; input: boolean };
}

const CANDIDATES: Delimiter[] = ["\t", ";", ","];

/**
 * The delimiter of the text, from its first lines. One that divides every line into the same number of cells wins, a tab
 * before a semicolon before a comma: a spreadsheet copies with tabs whatever the cells hold, and a file divided by semicolons
 * has commas in its numbers. Without such a one, the most frequent; without any, a comma (the text is one column).
 */
function detectDelimiter(src: string, from: number): Delimiter {
  const lines: Array<Record<Delimiter, number>> = [];
  let line: Record<Delimiter, number> | null = null;
  let quoted = false;
  const end = Math.min(src.length, from + 100_000);
  for (let i = from; i < end && lines.length < 20; i++) {
    const ch = src[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (line) lines.push(line);
      line = null;
      continue;
    }
    line ??= { "\t": 0, ";": 0, ",": 0 };
    if (!quoted && (ch === "\t" || ch === ";" || ch === ",")) line[ch]++;
  }
  if (line && lines.length < 20) lines.push(line);
  const steady = CANDIDATES.find((d) => lines.length > 0 && lines[0][d] > 0 && lines.every((l) => l[d] === lines[0][d]));
  if (steady) return steady;
  let best: Delimiter = ",";
  let most = 0;
  for (const d of CANDIDATES) {
    const total = lines.reduce((n, l) => n + l[d], 0);
    if (total > most) {
      most = total;
      best = d;
    }
  }
  return best;
}

/**
 * Rows of cells from delimited text. A cell in double quotes may hold the delimiter, line breaks and doubled quotes; a quote
 * elsewhere is an ordinary character. Empty lines are skipped, a byte order mark at the start is dropped.
 */
export function parseDelimited(text: string, opts: Partial<DataLimits> & { delimiter?: Delimiter } = {}): DelimitedData {
  const maxRows = opts.rows ?? TABLE_LIMITS.rows;
  const maxCols = opts.cols ?? TABLE_LIMITS.cols;
  const cut = { rows: false, cols: false, cells: 0, input: false };
  let src = text;
  if (src.length > MAX_INPUT_CHARS) {
    src = src.slice(0, MAX_INPUT_CHARS);
    cut.input = true;
  }
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const delimiter = opts.delimiter ?? detectDelimiter(src, i);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  /** the field in hand is longer than a cell may be */
  let long = false;
  let quoted = false;
  /** the line in hand holds something, if only a delimiter or a pair of quotes */
  let started = false;
  let atFieldStart = true;
  /** cells of the row in hand, counted before the column limit */
  let count = 0;
  let narrowest = Infinity;
  let widest = 0;

  const add = (ch: string) => {
    atFieldStart = false;
    if (field.length < MAX_CELL_CHARS) field += ch;
    else long = true;
  };
  const endField = () => {
    if (row.length < maxCols) {
      row.push(field);
      if (long) cut.cells++;
    } else cut.cols = true;
    count++;
    field = "";
    long = false;
    atFieldStart = true;
  };
  const endRow = () => {
    if (!started) return;
    endField();
    rows.push(row);
    narrowest = Math.min(narrowest, count);
    widest = Math.max(widest, count);
    row = [];
    count = 0;
    started = false;
  };

  for (; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') add(ch);
      else if (src[i + 1] === '"') {
        add('"');
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (!started) {
      // a row begins: the place to stop when the rows are full, before anything of it is read
      if (rows.length >= maxRows) {
        cut.rows = true;
        break;
      }
      started = true;
    }
    if (ch === delimiter) endField();
    else if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else add(ch);
  }
  endRow();

  const cols = Math.min(widest, maxCols);
  for (const r of rows) while (r.length < cols) r.push("");
  return { rows, delimiter, ragged: rows.length > 0 && narrowest !== widest, cut };
}

/**
 * The rows of a paste that is plainly a table: at least two rows and two columns, every row with the same number of cells.
 * Null for anything else, so that ordinary text stays text. Sentences with a comma each would pass as two columns, so with a
 * comma or a semicolon no cell may begin with a space, as the words after a comma in a sentence do.
 */
export function tabularText(text: string, limits: DataLimits = TABLE_LIMITS): DelimitedData | null {
  const data = parseDelimited(text, limits);
  if (data.rows.length < 2 || data.rows[0].length < 2 || data.ragged) return null;
  if (data.delimiter !== "\t" && data.rows.some((r) => r.some((cell, c) => c > 0 && cell.startsWith(" ")))) return null;
  return data;
}

/** A cell of several lines on one line: the fields that show cells are single-line. */
export const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/* ------------------------------------------------------------------ */
/* numbers                                                             */
/* ------------------------------------------------------------------ */

export type DecimalMark = "." | ",";

const other = (mark: DecimalMark): DecimalMark => (mark === "." ? "," : ".");

/** Digits in groups of three ("1,234,567"), or with a comma the Indian way ("12,34,567"). */
function isGrouped(digits: string, group: string): boolean {
  const parts = digits.split(group);
  if (parts.length < 2) return false;
  if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))) return true;
  return group === "," && /^\d{1,2}(,\d{2})+,\d{3}$/.test(digits);
}

/**
 * The digits of a number with their marks. `mark` is the decimal mark the text proves, or null when it proves none ("12",
 * and "1,234", which is a thousand and more in one country and one and a bit in another).
 */
function readDigits(text: string, decimal: DecimalMark): { value: number; mark: DecimalMark | null } | null {
  let body = text;
  // spaces and apostrophes between groups of three; whatever mark follows them is the decimal mark
  if (/^\d{1,3}(?:[ \u00a0\u202f']\d{3})+(?:[.,]\d+)?$/.test(body)) body = body.replace(/[ \u00a0\u202f']/g, "");
  else if (/[ \u00a0\u202f']/.test(body)) return null;
  const dots = body.split(".").length - 1;
  const commas = body.split(",").length - 1;
  let whole = body;
  let fraction = "";
  let mark: DecimalMark | null = null;
  if (dots && commas) {
    // both marks: the last one is the decimal mark, the other one groups
    mark = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    const at = body.lastIndexOf(mark);
    whole = body.slice(0, at);
    fraction = body.slice(at + 1);
    if (!isGrouped(whole, other(mark)) || !/^\d+$/.test(fraction)) return null;
  } else if (dots || commas) {
    const c: DecimalMark = dots ? "." : ",";
    if (dots + commas > 1) {
      if (!isGrouped(body, c)) return null;
      mark = other(c);
    } else {
      const eitherWay = /^\d{1,3}[.,]\d{3}$/.test(body);
      if (!eitherWay || c === decimal) {
        if (!/^(\d+[.,]\d*|[.,]\d+)$/.test(body)) return null;
        [whole, fraction] = body.split(c);
        mark = eitherWay ? null : c;
      }
    }
  } else if (!/^\d+$/.test(body)) return null;
  return { value: Number(`${whole.replace(/[.,]/g, "") || "0"}.${fraction || "0"}`), mark };
}

function readNumber(text: string, decimal: DecimalMark): { value: number; mark: DecimalMark | null } | null {
  let t = text.trim();
  // accountants write a negative number in brackets
  const bracketed = t.startsWith("(") && t.endsWith(")");
  if (bracketed) t = t.slice(1, -1).trim();
  const m = /^([+\-\u2212])?\s*(\p{Sc})?\s*([+\-\u2212])?\s*([\d.,'\u00a0\u202f ]*?)\s*(%|\p{Sc})?$/u.exec(t);
  if (!m) return null;
  const [, signBefore, currency, signAfter, body, suffix] = m;
  const sign = signBefore ?? signAfter;
  if ((signBefore && signAfter) || (sign && bracketed) || (currency && suffix && suffix !== "%")) return null;
  const digits = readDigits(body, decimal);
  if (!digits) return null;
  const negative = bracketed || (sign !== undefined && sign !== "+");
  return { value: negative ? -digits.value : digits.value, mark: digits.mark };
}

/**
 * A number as people write it in a spreadsheet: "1,234.5", "1.234,5", "12%" (which is 12), "$5", "5 \u20ac", "(123)" for -123.
 * `decimal` settles only what the text leaves open: one mark before three digits. Null for anything that is not a number.
 */
export function parseDataNumber(text: string, decimal: DecimalMark = "."): number | null {
  return readNumber(text, decimal)?.value ?? null;
}

/**
 * The decimal mark of a block of cells. A comma when some number can only be read with a comma ("1,5", "1.234,5") and none
 * only with a point; a comma too when no number says anything and the file is divided by semicolons, as files from countries
 * with a decimal comma are. A point in every other case.
 */
export function decimalMark(cells: string[], delimiter: Delimiter): DecimalMark {
  let comma = false;
  for (const cell of cells) {
    const mark = readNumber(cell, ".")?.mark;
    if (mark === ".") return ".";
    if (mark === ",") comma = true;
  }
  return comma || (delimiter === ";" && cells.length > 0) ? "," : ".";
}

/* ------------------------------------------------------------------ */
/* a chart from rows                                                   */
/* ------------------------------------------------------------------ */

export interface ChartData {
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  /** cells that were empty or not a number; each of them is 0 in `series` */
  notNumbers: number;
}

/**
 * Labels and series from rows: the first column holds the labels, the other columns one series each. The first row holds the
 * names of the series when it has no number in it, or when its first cell is empty (a row of years over a column of labels).
 * A single column is one series. Null when there is no row under the headings, or no number anywhere.
 */
export function chartData(data: DelimitedData): ChartData | null {
  const { rows } = data;
  if (!rows.length) return null;
  const first = rows[0].length > 1 ? 1 : 0;
  const mark = decimalMark(
    rows.flatMap((r) => r.slice(first)),
    data.delimiter,
  );
  const isNumber = (cell: string) => parseDataNumber(cell, mark) !== null;
  const heads = rows[0].slice(first);
  const headed = (first === 1 && rows[0][0].trim() === "" && rows.length > 1) || (heads.some((h) => h.trim() !== "") && !heads.some(isNumber));
  const body = headed ? rows.slice(1) : rows;
  let notNumbers = 0;
  const series = heads.map((head, j) => ({
    name: (headed && oneLine(head)) || `Series ${j + 1}`,
    values: body.map((r) => {
      const n = parseDataNumber(r[first + j], mark);
      if (n === null) notNumbers++;
      return n ?? 0;
    }),
  }));
  if (notNumbers === body.length * heads.length) return null;
  return { labels: body.map((r, i) => (first ? oneLine(r[0]) : `Item ${i + 1}`)), series, notNumbers };
}

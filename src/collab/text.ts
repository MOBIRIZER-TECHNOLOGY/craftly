/**
 * Text typed into one text box by two people at once, merged letter by letter (docs/COLLABORATION.md, "Two people typing in one
 * text box"). Pure code with no DOM, so the server and every browser run the same and end with the same text.
 *
 * A text is read as one line of positions: each paragraph is a mark (one position, carrying the paragraph's alignment and list)
 * followed by its characters, in UTF-16 units. A change is one splice of that line: from `at`, take `del` positions away and put
 * `ins` there, a list of pieces (paragraph marks and runs of styled characters). The browser that made the change sends it with
 * the text it was made on (`base`, the line as plain characters); whoever applies it to a text that has changed since (someone
 * else's letters arrived first) finds where `at` and `at + del` are now by comparing the two (`mapThrough`), and splices there.
 * The server applies changes in one order and passes on the text as it is after each, so every copy ends the same.
 *
 * Where both put letters in the same place, the one the server applied first comes first. What one person deletes goes, also
 * when the other typed inside it at the same moment.
 */
import type { TextParagraph, TextRun } from "@/core/types";

/** The paragraph mark in the plain line of a text (`flatText`): one position before each paragraph. */
export const MARK = " ";

/** A paragraph mark with what belongs to the paragraph and not to its characters. */
export interface ParaPiece {
  para: Omit<TextParagraph, "runs">;
}
/** A piece of a change to a text: a paragraph mark, or characters in one style. */
export type TextPiece = ParaPiece | TextRun;

export interface Splice {
  at: number;
  del: number;
  ins: TextPiece[];
}

const isPara = (p: TextPiece): p is ParaPiece => "para" in p;
const lengthOf = (p: TextPiece): number => (isPara(p) ? 1 : p.text.length);

/** Counts work (characters compared or copied) the way ops.ts counts elements, so that a huge text cannot hold the server. */
export type Charge = (n: number) => void;
const free: Charge = () => {};

/** Equal as JSON is, for the small flat objects of styles and paragraphs. */
function sameFlat(a: Record<string, unknown>, b: Record<string, unknown>, skip?: string): boolean {
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => k !== skip && o[k] !== undefined);
  const ka = keys(a);
  if (ka.length !== keys(b).length) return false;
  return ka.every((k) => {
    const x = a[k];
    const y = b[k];
    if (Object.is(x, y)) return true;
    // (a gradient or a colour object: compared as JSON, they are small)
    return typeof x === "object" && typeof y === "object" && JSON.stringify(x) === JSON.stringify(y);
  });
}
const sameStyle = (a: TextRun, b: TextRun) => sameFlat(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, "text");
const sameAttrs = (a: ParaPiece["para"], b: ParaPiece["para"]) => sameFlat(a as Record<string, unknown>, b as Record<string, unknown>);

const attrsOf = (p: TextParagraph): ParaPiece["para"] => {
  const { runs: _runs, ...rest } = p;
  return rest;
};

/** The plain line of a text: a mark before each paragraph, then its characters. */
export function flatText(paragraphs: readonly TextParagraph[]): string {
  let out = "";
  for (const p of paragraphs) {
    out += MARK;
    for (const r of p.runs) out += r.text;
  }
  return out;
}

function toPieces(paragraphs: readonly TextParagraph[]): TextPiece[] {
  const out: TextPiece[] = [];
  for (const p of paragraphs) {
    out.push({ para: attrsOf(p) });
    for (const r of p.runs) out.push(r);
  }
  return out;
}

/**
 * The pieces in [from, to) of the line, a run cut where an end falls inside it. A run with no characters belongs to the position
 * it is at, and is taken when that position is in the range (or `to` is the end of everything).
 */
function slicePieces(pieces: readonly TextPiece[], from: number, to: number): TextPiece[] {
  const out: TextPiece[] = [];
  let pos = 0;
  for (const p of pieces) {
    const len = lengthOf(p);
    const start = pos;
    const end = pos + len;
    pos = end;
    if (len === 0) {
      if (start >= from && (start < to || to === Infinity)) out.push(p);
      continue;
    }
    if (end <= from || start >= to) continue;
    if (isPara(p)) out.push(p);
    else {
      const a = Math.max(from, start) - start;
      const b = Math.min(to, end) - start;
      out.push(a === 0 && b === len ? p : { ...p, text: p.text.slice(a, b) });
    }
  }
  return out;
}

/** Paragraphs again from a line of pieces: what has no mark before it joins the first paragraph; empty runs go where others are. */
function fromPieces(pieces: readonly TextPiece[], first: ParaPiece["para"]): TextParagraph[] {
  const out: TextParagraph[] = [];
  let cur: TextParagraph | null = null;
  for (const p of pieces) {
    if (isPara(p)) {
      cur = { ...p.para, runs: [] };
      out.push(cur);
      continue;
    }
    if (!cur) out.push((cur = { ...first, runs: [] }));
    const last: TextRun | undefined = cur.runs[cur.runs.length - 1];
    if (last && sameStyle(last, p)) cur.runs[cur.runs.length - 1] = { ...last, text: last.text + p.text };
    else cur.runs.push(p);
  }
  if (!out.length) out.push({ ...first, runs: [] });
  for (const para of out) {
    const filled = para.runs.filter((r) => r.text);
    para.runs = filled.length ? filled : [para.runs[0] ?? { text: "" }];
  }
  return out;
}

/** `paragraphs` with the splice made: positions out of the line are held at its ends. */
export function applySplice(paragraphs: readonly TextParagraph[], splice: Splice, charge: Charge = free): TextParagraph[] {
  const pieces = toPieces(paragraphs);
  const total = pieces.reduce((n, p) => n + lengthOf(p), 0);
  charge(total);
  const at = Math.max(0, Math.min(total, Math.trunc(splice.at)));
  const end = Math.max(at, Math.min(total, at + Math.max(0, Math.trunc(splice.del))));
  const first = paragraphs[0] ? attrsOf(paragraphs[0]) : {};
  return fromPieces([...slicePieces(pieces, 0, at), ...splice.ins, ...slicePieces(pieces, end, Infinity)], first);
}

interface Unit {
  c: string;
  run: TextRun | null;
  para: ParaPiece["para"] | null;
}

function unitsOf(paragraphs: readonly TextParagraph[]): Unit[] {
  const out: Unit[] = [];
  for (const p of paragraphs) {
    out.push({ c: MARK, run: null, para: attrsOf(p) });
    for (const r of p.runs) for (let i = 0; i < r.text.length; i++) out.push({ c: r.text[i], run: r, para: null });
  }
  return out;
}

const sameUnit = (a: Unit, b: Unit): boolean =>
  a.c === b.c && (a.para ? !!b.para && sameAttrs(a.para, b.para) : !b.para && (a.run === b.run || sameStyle(a.run as TextRun, b.run as TextRun)));

const paraEqual = (a: TextParagraph, b: TextParagraph): boolean =>
  a === b || (sameAttrs(attrsOf(a), attrsOf(b)) && a.runs.length === b.runs.length && a.runs.every((r, i) => r.text === b.runs[i].text && sameStyle(r, b.runs[i])));

const isHigh = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff;
};
const isLow = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
};

/**
 * The one splice that takes `before` to `after`: what is the same at the start and at the end is kept, the rest between is
 * replaced. Null when they are the same. A change made in one place (a key, a paste, a style on a selection) is one splice.
 */
export function textSplice(before: readonly TextParagraph[], after: readonly TextParagraph[]): Splice | null {
  const nb = before.length;
  const na = after.length;
  let head = 0;
  while (head < nb && head < na && paraEqual(before[head], after[head])) head++;
  let tail = 0;
  while (tail < nb - head && tail < na - head && paraEqual(before[nb - 1 - tail], after[na - 1 - tail])) tail++;
  if (head === nb && head === na) return null;
  const offset = flatText(before.slice(0, head)).length;
  const midB = before.slice(head, nb - tail);
  const midA = after.slice(head, na - tail);
  const ub = unitsOf(midB);
  const ua = unitsOf(midA);
  let k = 0;
  while (k < ub.length && k < ua.length && sameUnit(ub[k], ua[k])) k++;
  let m = 0;
  while (m < ub.length - k && m < ua.length - k && sameUnit(ub[ub.length - 1 - m], ua[ua.length - 1 - m])) m++;
  // never between the two halves of a character outside the basic plane
  const sb = ub.map((u) => u.c).join("");
  const sa = ua.map((u) => u.c).join("");
  while (k > 0 && isHigh(sb, k - 1)) k--;
  while (m > 0 && isLow(sb, sb.length - m)) m--;
  if (k === ub.length && k === ua.length) {
    // the same characters in the same styles, and yet the paragraphs differ: an empty run's style. The paragraphs are replaced whole.
    return { at: offset, del: sb.length, ins: toPieces(midA) };
  }
  // (`sa` is only needed for its length, and to keep a pair together at the end of what is put in)
  while (m > 0 && isLow(sa, sa.length - m)) m--;
  return { at: offset + k, del: ub.length - k - m, ins: slicePieces(toPieces(midA), k, ua.length - m) };
}

/** A stretch of an edit script from one plain line to another: the same in both, only in the first, only in the second. */
type Seg = { eq: number } | { del: number } | { ins: number };

/** The most differences the comparison of two lines looks for before it settles for one replaced stretch between their common ends. */
const MAX_DIFFERENCES = 1_000;
/** And the most work it does, in characters looked at: two copies of a text of a million characters must not hold a server for long. */
const MAX_COMPARE = 4_000_000;

/**
 * How `a` became `b`, as stretches kept, taken out and put in (Myers' algorithm on what lies between their common start and end).
 * When the two differ in more than MAX_DIFFERENCES places, or comparing them would take more than MAX_COMPARE, everything between
 * the common start and end counts as replaced: what lands there then goes after what the other put in.
 */
export function editScript(a: string, b: string, charge: Charge = free): Seg[] {
  let pre = 0;
  const min = Math.min(a.length, b.length);
  while (pre < min && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  let suf = 0;
  while (suf < min - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)) suf++;
  charge(pre + suf);
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  const middle = myers(x, y, charge) ?? [...(x.length ? [{ del: x.length }] : []), ...(y.length ? [{ ins: y.length }] : [])];
  const out: Seg[] = [];
  const push = (s: Seg) => {
    const last = out[out.length - 1];
    if (last && "eq" in s && "eq" in last) last.eq += s.eq;
    else if (last && "del" in s && "del" in last) last.del += s.del;
    else if (last && "ins" in s && "ins" in last) last.ins += s.ins;
    else out.push({ ...s });
  };
  if (pre) push({ eq: pre });
  for (const s of middle) push(s);
  if (suf) push({ eq: suf });
  return out;
}

function myers(a: string, b: string, charge: Charge): Seg[] | null {
  const n = a.length;
  const m = b.length;
  if (!n && !m) return [];
  if (!n) return [{ ins: m }];
  if (!m) return [{ del: n }];
  const maxD = Math.min(n + m, MAX_DIFFERENCES, Math.floor(MAX_COMPARE / (n + m)));
  const off = maxD + 1;
  let v = new Int32Array(2 * maxD + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      while (x < n && y < m && a.charCodeAt(x) === b.charCodeAt(y)) {
        x++;
        y++;
      }
      charge(x - x0 + 1);
      next[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, off, n, m, d);
    }
    v = next;
  }
  return null;
}

/** The edit script from the comparison's trace: `trace[d]` is how far each diagonal had come before step d. */
function backtrack(trace: Int32Array[], off: number, n: number, m: number, dEnd: number): Seg[] {
  const segs: Seg[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[off + prevK];
    const prevY = prevX - prevK;
    // after the one difference of this step, the same characters as far as (x, y)
    const startX = down ? prevX : prevX + 1;
    if (x > startX) segs.push({ eq: x - startX });
    segs.push(down ? { ins: 1 } : { del: 1 });
    x = prevX;
    y = prevY;
  }
  if (x > 0) segs.push({ eq: x });
  return segs.reverse();
}

/**
 * Where a position of the line `a` is in `b`, by the edit script between them. Text put in exactly there comes before the
 * position when `after` (the position goes after it), else after it. A position inside what was taken out is where that was.
 */
export function mapPosition(script: readonly Seg[], pos: number, after: boolean): number {
  let ai = 0;
  let bi = 0;
  let p = pos;
  for (const s of script) {
    if ("ins" in s) {
      if (p === ai && !after) return bi;
      bi += s.ins;
    } else if ("del" in s) {
      if (p >= ai && p < ai + s.del) p = ai + s.del;
      ai += s.del;
    } else {
      if (p < ai + s.eq) return bi + Math.max(0, p - ai);
      ai += s.eq;
      bi += s.eq;
    }
  }
  return bi;
}

/**
 * A splice made on the text `base` (a plain line), moved onto the text as it is now (`current`, also a plain line): its start goes
 * after what others put in at the same place, its end before it, so that it takes away nothing they added around it.
 */
export function rebase(base: string, current: string, splice: Splice, charge: Charge = free): Splice {
  if (base === current) return splice;
  const script = editScript(base, current, charge);
  const at = mapPosition(script, splice.at, true);
  if (splice.del <= 0) return { ...splice, at };
  const end = Math.max(at, mapPosition(script, splice.at + splice.del, false));
  return { ...splice, at, del: end - at };
}

/**
 * What a text becomes when a change from `base` to `mine` is made to `theirs`, a text that has changed from `base` meanwhile:
 * what the text editor does with the letters of others that arrive while its person types (TextEditorOverlay.tsx).
 */
export function mergeText(base: readonly TextParagraph[], mine: readonly TextParagraph[], theirs: readonly TextParagraph[]): TextParagraph[] {
  const splice = textSplice(base, mine);
  if (!splice) return theirs as TextParagraph[];
  return applySplice(theirs, rebase(flatText(base), flatText(theirs), splice));
}

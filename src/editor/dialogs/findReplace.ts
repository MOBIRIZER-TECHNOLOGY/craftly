/**
 * Pure helpers for Find and replace: locating every occurrence of a string in the text boxes of a design
 * and rewriting paragraphs while keeping the styles of the runs around the match.
 */
import type { Design, DesignElement, TextParagraph, TextRun } from "@/core/types";

export interface TextMatch {
  pageId: string;
  pageIndex: number;
  /** the text element that contains the match (may sit inside a group) */
  elementId: string;
  /** the element to select on the page: the text box itself, or the top-level group around it */
  topId: string;
  /** reading order of the text element across the whole design (stable while text is edited) */
  order: number;
  para: number;
  /** character offsets inside the paragraph's plain text */
  start: number;
  end: number;
  /** the text box (or a group around it) is locked */
  locked: boolean;
}

export function findMatches(design: Design, query: string, caseSensitive: boolean): TextMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: TextMatch[] = [];
  let order = 0;

  design.pages.forEach((page, pageIndex) => {
    const visit = (elements: DesignElement[], top: string | null, locked: boolean) => {
      for (const el of elements) {
        if (el.hidden) continue;
        const topId = top ?? el.id;
        const isLocked = locked || !!el.locked;
        if (el.type === "group") {
          visit(el.children, topId, isLocked);
        } else if (el.type === "text") {
          const at = order++;
          el.paragraphs.forEach((p, para) => {
            const text = p.runs.map((r) => r.text).join("");
            const hay = caseSensitive ? text : text.toLowerCase();
            let from = 0;
            for (;;) {
              const found = hay.indexOf(needle, from);
              if (found < 0) break;
              out.push({ pageId: page.id, pageIndex, elementId: el.id, topId, order: at, para, start: found, end: found + needle.length, locked: isLocked });
              from = found + Math.max(1, needle.length);
            }
          });
        }
      }
    };
    visit(page.elements, null, false);
  });
  return out;
}

/** Replaces [start, end) of one paragraph. The replacement takes the style of the run where the match starts. */
export function replaceRange(paragraph: TextParagraph, start: number, end: number, replacement: string): TextParagraph {
  const runs: TextRun[] = [];
  let pos = 0;
  let inserted = false;
  for (const run of paragraph.runs) {
    const from = pos;
    const to = pos + run.text.length;
    pos = to;
    if (to <= start || from >= end) {
      runs.push(run);
      continue;
    }
    const before = run.text.slice(0, Math.max(0, start - from));
    const after = run.text.slice(Math.max(0, end - from));
    runs.push({ ...run, text: before + (inserted ? "" : replacement) + after });
    inserted = true;
  }
  if (!inserted) {
    // the match sits at the very end of an empty / exhausted paragraph: append to the last run
    const last = runs[runs.length - 1];
    if (last) last.text += replacement;
    else runs.push({ text: replacement });
  }
  return { ...paragraph, runs };
}

/** Applies several replacements (any order) to a text element's paragraphs. */
export function replaceInParagraphs(paragraphs: TextParagraph[], ranges: Array<Pick<TextMatch, "para" | "start" | "end">>, replacement: string): TextParagraph[] {
  const next = paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) }));
  // right to left, so earlier offsets stay valid
  const sorted = [...ranges].sort((a, b) => (b.para !== a.para ? b.para - a.para : b.start - a.start));
  for (const r of sorted) {
    if (next[r.para]) next[r.para] = replaceRange(next[r.para], r.start, r.end, replacement);
  }
  return next;
}

/** True when match `x` lies after `m` once `m` has been replaced by `replacementLength` characters. */
export function isAfter(x: TextMatch, m: TextMatch, replacementLength: number): boolean {
  if (x.order !== m.order) return x.order > m.order;
  if (x.para !== m.para) return x.para > m.para;
  return x.start >= m.start + replacementLength;
}

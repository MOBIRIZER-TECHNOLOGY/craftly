/**
 * Pure helpers shared by the toolbars: "uniform or mixed" value reading over a selection,
 * text run analysis, paint previews and selection bounds. No React in here.
 */
import { normalizeHex } from "@/core/color";
import { boxBounds, unionRects } from "@/core/geometry";
import { getActions } from "@/core/store";
import type { DesignElement, ElementOf, ElementType, Fill, GradientStop, ID, Page, Rect, TextElement, TextParagraph, TextRun } from "@/core/types";
import { worldBox } from "@/editor/canvas/frame";

/* ------------------------------------------------------------------ */
/* uniform / mixed values                                              */
/* ------------------------------------------------------------------ */

export interface Uniform<T> {
  /** the first element's value (undefined for an empty list) */
  value: T | undefined;
  /** the selection disagrees about this value */
  mixed: boolean;
}

export function uniform<E, T>(items: readonly E[], get: (item: E) => T, same: (a: T, b: T) => boolean = Object.is): Uniform<T> {
  if (!items.length) return { value: undefined, mixed: false };
  const first = get(items[0]);
  for (let i = 1; i < items.length; i++) if (!same(first, get(items[i]))) return { value: first, mixed: true };
  return { value: first, mixed: false };
}

/** Runs that carry text; an empty box counts as one run that inherits the element style. */
export function textRuns(el: TextElement): TextRun[] {
  const runs: TextRun[] = [];
  for (const p of el.paragraphs) for (const r of p.runs) if (r.text.length > 0) runs.push(r);
  return runs.length ? runs : [{ text: "" }];
}

/** Like `uniform`, but looks at every run of every text element (so a half-bold box reads as mixed). */
export function runsUniform<T>(els: readonly TextElement[], get: (el: TextElement, run: TextRun) => T): Uniform<T> {
  let first: T | undefined;
  let seen = false;
  let mixed = false;
  for (const el of els) {
    for (const run of textRuns(el)) {
      const v = get(el, run);
      if (!seen) {
        first = v;
        seen = true;
      } else if (!Object.is(first, v)) mixed = true;
    }
  }
  return { value: first, mixed };
}

/** Like `runsUniform`, for paragraph level properties (alignment, list). */
export function parasUniform<T>(els: readonly TextElement[], get: (el: TextElement, para: TextParagraph) => T): Uniform<T> {
  let first: T | undefined;
  let seen = false;
  let mixed = false;
  for (const el of els) {
    for (const p of el.paragraphs) {
      const v = get(el, p);
      if (!seen) {
        first = v;
        seen = true;
      } else if (!Object.is(first, v)) mixed = true;
    }
  }
  return { value: first, mixed };
}

/* ------------------------------------------------------------------ */
/* paint previews                                                      */
/* ------------------------------------------------------------------ */

const stops = (list: GradientStop[]) => list.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");

/** CSS `background` value that previews a document fill (swatch buttons). */
export function fillCss(fill: Fill | null | undefined): string {
  if (!fill) return NO_FILL_CSS;
  switch (fill.type) {
    case "solid":
      return fill.color;
    case "linear":
      return `linear-gradient(${fill.angle}deg, ${stops(fill.stops)})`;
    case "radial":
      return `radial-gradient(circle at ${(fill.cx ?? 0.5) * 100}% ${(fill.cy ?? 0.5) * 100}%, ${stops(fill.stops)})`;
    case "pattern":
      return `repeating-linear-gradient(45deg, ${fill.color} 0 2px, ${fill.background} 2px 5px)`;
    default:
      return "linear-gradient(135deg, var(--c-line-strong), var(--c-hover))";
  }
}

/** White swatch crossed by a red stroke: "no fill". */
export const NO_FILL_CSS = "linear-gradient(135deg, var(--c-bg) 44%, var(--c-danger) 44% 56%, var(--c-bg) 56%)";
/** Round swatches that stand for several different colours. */
export const MIXED_SWATCH_CSS = "conic-gradient(var(--c-danger), var(--c-warning), var(--c-success), var(--c-teal), var(--c-blue), var(--c-primary), var(--c-danger))";
/** The colour bar under the "A" of the text colour button when colours differ. */
export const MIXED_BAR_CSS = "linear-gradient(90deg, var(--c-danger), var(--c-warning), var(--c-success), var(--c-teal), var(--c-blue), var(--c-primary))";

export type TextPaint = { kind: "solid"; color: string } | { kind: "gradient"; css: string } | { kind: "mixed" };

/** The colour (or gradient) the selected text is painted with, or "mixed". */
export function textPaint(els: readonly TextElement[]): TextPaint {
  const paints = new Map<string, TextPaint>();
  for (const el of els) {
    if (el.gradient) {
      const css = fillCss(el.gradient);
      paints.set(`g|${css}`, { kind: "gradient", css });
      continue;
    }
    for (const run of textRuns(el)) {
      const color = normalizeHex(run.color ?? el.color);
      paints.set(`c|${color}`, { kind: "solid", color });
    }
  }
  if (paints.size === 1) return [...paints.values()][0];
  return { kind: "mixed" };
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

/** Axis-aligned page-space bounds of the given elements (also for elements nested in groups). */
export function worldBounds(page: Page, ids: readonly ID[]): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const box = worldBox(page, id);
    if (box) rects.push(boxBounds(box));
  }
  return unionRects(rects);
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

/** Runs `fn` on the elements as ONE undo step; `coalesce` merges rapid repeats (sliders, steppers). */
export function editElements(ids: readonly ID[], fn: (el: DesignElement) => void, coalesce?: string): void {
  if (!ids.length) return;
  getActions().updateElements([...ids], fn, coalesce ? { coalesce: `${coalesce}:${ids.join(",")}` } : undefined);
}

/** Wraps a type specific patch so it only touches elements of that type. */
export function only<T extends ElementType>(type: T, fn: (el: ElementOf<T>) => void): (el: DesignElement) => void {
  return (el) => {
    if (el.type === type) fn(el as ElementOf<T>);
  };
}

export const clampNumber = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const sameIds = (a: readonly ID[], b: readonly ID[]) => a.length === b.length && a.every((id, i) => id === b[i]);

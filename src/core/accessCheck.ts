/**
 * A check of a design for two things that keep people from reading it: text that does not stand out enough from what is
 * behind it, and pictures without alternative text. Pure: no DOM, no painting.
 *
 * Contrast is judged where it can be: a text in plain colours over a plain colour, the fill of the shape that lies under
 * the middle of the text or else the page's own. A text over a picture, a gradient, a pattern, a chart or a see-through
 * shape is not judged, because no single colour is behind it; neither is a text painted with a gradient. So the check finds
 * mistakes, it does not prove their absence, and the dialog that shows the result says so.
 *
 * The limits are those of WCAG 2: 4.5 to 1, and 3 to 1 for large text (24 px and more, or 18.66 px and more in bold).
 */
import { contrastRatio, parseColor, toHex } from "./color";
import { fromLocalPoint, hitTestElement, toLocalPoint } from "./geometry";
import type { Design, DesignElement, Fill, GroupElement, ID, Point, TextElement } from "./types";

export interface AccessIssue {
  kind: "contrast" | "alt";
  pageId: ID;
  /** zero based */
  pageIndex: number;
  elementId: ID;
  /** the element at the top level of the page that holds it (itself, or the group it is in): what can be selected */
  topId: ID;
  /** the words of the text, or the name of the picture, cut short */
  label: string;
  /** contrast: what was found (rounded to two places), what is needed, and the two colours as #rrggbb */
  ratio?: number;
  needed?: number;
  color?: string;
  background?: string;
}

export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3;
const LABEL_LENGTH = 60;

/** The contrast a text of this size and weight needs. */
export const neededContrast = (fontSize: number, fontWeight: number): number => (fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? CONTRAST_LARGE : CONTRAST_NORMAL);

/** A fill as one opaque colour, or null when it is none: a gradient, a pattern, a picture, a see-through colour, no fill. */
function plainColor(fill: Fill | null | undefined): string | null {
  if (!fill || fill.type !== "solid") return null;
  const c = parseColor(fill.color);
  return c && c.a >= 0.999 ? toHex(c) : null;
}

/** `fg` at `alpha` over `bg`, as #rrggbb. */
function over(fg: string, bg: string, alpha: number): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return fg;
  const a = Math.min(1, Math.max(0, f.a * alpha));
  const ch = (x: number, y: number) => Math.round(y + (x - y) * a);
  return toHex({ r: ch(f.r, b.r), g: ch(f.g, b.g), b: ch(f.b, b.b), a: 1 });
}

const cut = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > LABEL_LENGTH ? `${one.slice(0, LABEL_LENGTH - 1).trimEnd()}…` : one;
};

const textOf = (el: TextElement): string => el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ");

/** The colours a text is written in: its own, and those of the runs that have one and some words. */
function textColors(el: TextElement): string[] {
  const colors = new Set<string>();
  let inherits = false;
  for (const p of el.paragraphs)
    for (const run of p.runs) {
      if (!run.text.trim()) continue;
      if (run.color) colors.add(run.color);
      else inherits = true;
    }
  if (inherits) colors.add(el.color);
  return [...colors];
}

/** Something that was painted before a text: whether it lies under a point of the page, and its colour when it has one. */
interface Painted {
  contains(page: Point): boolean;
  color: string | null;
}

/** Where a list of elements lies: its own space into the page's, and back. */
interface Space {
  toPage(p: Point): Point;
  fromPage(p: Point): Point;
  /** the opacity of the groups around it, multiplied */
  opacity: number;
  /** the element of the page's top level that holds the list, when it is inside a group */
  topId: ID | null;
}

const PAGE: Space = { toPage: (p) => p, fromPage: (p) => p, opacity: 1, topId: null };

const inside = (space: Space, group: GroupElement): Space => ({
  toPage: (p) => space.toPage(fromLocalPoint(group, p)),
  fromPage: (p) => toLocalPoint(group, space.fromPage(p)),
  opacity: space.opacity * (group.opacity ?? 1),
  topId: space.topId ?? group.id,
});

/** Everything the check found in a design, page after page, in the order the elements are painted. */
export function checkAccessibility(design: Pick<Design, "pages">): AccessIssue[] {
  const issues: AccessIssue[] = [];
  design.pages.forEach((page, pageIndex) => {
    const painted: Painted[] = [];
    const pageColor = plainColor(page.background);

    const visit = (elements: readonly DesignElement[], space: Space) => {
      for (const el of elements) {
        if (el.hidden) continue;
        const topId = space.topId ?? el.id;
        if (el.type === "group") {
          visit(el.children, inside(space, el));
          continue;
        }
        if (el.type === "text") {
          const words = textOf(el);
          // a text painted with a gradient has no one colour, and an empty one has nothing to read
          if (!words.trim() || el.gradient) continue;
          const centre = space.toPage({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
          const under = [...painted].reverse().find((p) => p.contains(centre));
          const background = under ? under.color : pageColor;
          if (!background) continue;
          const alpha = space.opacity * (el.opacity ?? 1);
          const needed = neededContrast(el.fontSize, el.fontWeight);
          let worst: { ratio: number; color: string } | null = null;
          for (const raw of textColors(el)) {
            if (!parseColor(raw)) continue;
            const color = over(raw, background, alpha);
            const ratio = contrastRatio(color, background);
            if (!worst || ratio < worst.ratio) worst = { ratio, color };
          }
          if (worst && worst.ratio < needed) {
            issues.push({
              kind: "contrast",
              pageId: page.id,
              pageIndex,
              elementId: el.id,
              topId,
              label: cut(words),
              ratio: Math.round(worst.ratio * 100) / 100,
              needed,
              color: worst.color,
              background,
            });
          }
          continue;
        }
        if (el.type === "image" && el.src && !el.alt?.trim()) {
          issues.push({ kind: "alt", pageId: page.id, pageIndex, elementId: el.id, topId, label: cut(el.name ?? "") });
        }
        // what a later text may lie on. A line and a shape without a fill hide nothing; everything else does, and only an
        // opaque shape in one colour, mixed in the ordinary way, has a colour that can be named
        if (el.type === "line" || (el.type === "shape" && !el.fill)) continue;
        const opaque = el.type === "shape" && space.opacity * (el.opacity ?? 1) >= 0.999 && !el.blend;
        painted.push({ contains: (p) => hitTestElement(el, space.fromPage(p)), color: opaque ? plainColor(el.fill) : null });
      }
    };
    visit(page.elements, PAGE);
  });
  return issues;
}

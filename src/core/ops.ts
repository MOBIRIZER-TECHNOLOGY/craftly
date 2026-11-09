/**
 * Pure document operations. They MUTATE the page/design they are given, so the
 * store runs them inside an immer draft (and tests run them on a clone).
 */
import { cloneDeep } from "./clone";
import { rebindClones, retargetLines } from "./connectors";
import { cloneElement, createGroup } from "./factory";
import { boundsOfElements, boxBounds, boxCenter, rotatePoint } from "./geometry";
import { uid } from "./ids";
import type { Design, DesignElement, GroupElement, ID, Page, Rect, TextElement, TextParagraph, TextRun } from "./types";

/* ------------------------------------------------------------------ */
/* lookup                                                              */
/* ------------------------------------------------------------------ */

export interface Located {
  list: DesignElement[];
  index: number;
  el: DesignElement;
  parent: GroupElement | null;
}

export function locate(elements: DesignElement[], id: ID, parent: GroupElement | null = null): Located | null {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.id === id) return { list: elements, index: i, el, parent };
    if (el.type === "group") {
      const hit = locate(el.children, id, el);
      if (hit) return hit;
    }
  }
  return null;
}

export const findElement = (page: Page, id: ID): DesignElement | null => locate(page.elements, id)?.el ?? null;

export function walk(elements: DesignElement[], fn: (el: DesignElement, parent: GroupElement | null) => void, parent: GroupElement | null = null): void {
  for (const el of elements) {
    fn(el, parent);
    if (el.type === "group") walk(el.children, fn, el);
  }
}

export function flatten(elements: DesignElement[]): DesignElement[] {
  const out: DesignElement[] = [];
  walk(elements, (e) => out.push(e));
  return out;
}

/** Removes the ids that are descendants of another id in the list (so a group and its child are not both moved). */
export function topLevelIds(page: Page, ids: ID[]): ID[] {
  const set = new Set(ids);
  const out: ID[] = [];
  const visit = (els: DesignElement[], covered: boolean) => {
    for (const el of els) {
      const selected = set.has(el.id);
      if (selected && !covered) out.push(el.id);
      if (el.type === "group") visit(el.children, covered || selected);
    }
  };
  visit(page.elements, false);
  return out;
}

/* ------------------------------------------------------------------ */
/* basic edits                                                         */
/* ------------------------------------------------------------------ */

export function removeElements(page: Page, ids: ID[]): DesignElement[] {
  const removed: DesignElement[] = [];
  for (const id of ids) {
    const hit = locate(page.elements, id);
    if (hit) removed.push(...hit.list.splice(hit.index, 1));
  }
  return removed;
}

/** Properties that may still change on a locked element (locking itself, visibility, naming). */
const LOCK_EXEMPT = new Set(["locked", "hidden", "name"]);

/**
 * Applies a patch to elements. Locked elements are protected: they only accept
 * lock / visibility / name changes, so no panel or shortcut can edit them by accident.
 */
export function patchElements(page: Page, ids: ID[], patch: Partial<DesignElement> | ((el: DesignElement) => void)): void {
  for (const id of ids) {
    const el = findElement(page, id);
    if (!el) continue;
    if (el.locked && (typeof patch === "function" || !Object.keys(patch).every((k) => LOCK_EXEMPT.has(k)))) continue;
    if (typeof patch === "function") patch(el);
    else Object.assign(el, patch);
  }
}

export function moveBy(page: Page, ids: ID[], dx: number, dy: number): void {
  for (const id of topLevelIds(page, ids)) {
    const el = findElement(page, id);
    if (el && !el.locked) {
      el.x += dx;
      el.y += dy;
    }
  }
}

/* ------------------------------------------------------------------ */
/* z-order                                                             */
/* ------------------------------------------------------------------ */

export type ArrangeMode = "forward" | "backward" | "front" | "back";

export function reorder(page: Page, ids: ID[], mode: ArrangeMode): void {
  const lists = new Map<DesignElement[], Set<ID>>();
  for (const id of ids) {
    const hit = locate(page.elements, id);
    if (!hit) continue;
    if (!lists.has(hit.list)) lists.set(hit.list, new Set());
    lists.get(hit.list)!.add(id);
  }
  for (const [list, sel] of lists) {
    if (mode === "front" || mode === "back") {
      const picked = list.filter((e) => sel.has(e.id));
      const rest = list.filter((e) => !sel.has(e.id));
      list.splice(0, list.length, ...(mode === "front" ? [...rest, ...picked] : [...picked, ...rest]));
    } else if (mode === "forward") {
      for (let i = list.length - 2; i >= 0; i--) {
        if (sel.has(list[i].id) && !sel.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        if (sel.has(list[i].id) && !sel.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
  }
}

/** Can the selection move in this direction? (used to disable toolbar buttons) */
export function canArrange(page: Page, ids: ID[], mode: ArrangeMode): boolean {
  for (const id of ids) {
    const hit = locate(page.elements, id);
    if (!hit) continue;
    const { list, index } = hit;
    if ((mode === "forward" || mode === "front") && index < list.length - 1) return true;
    if ((mode === "backward" || mode === "back") && index > 0) return true;
  }
  return false;
}

/** Moves one element to an absolute index inside its own list (drag-reorder in the Layers panel). */
export function moveToIndex(page: Page, id: ID, toIndex: number): void {
  const hit = locate(page.elements, id);
  if (!hit) return;
  const [el] = hit.list.splice(hit.index, 1);
  hit.list.splice(Math.max(0, Math.min(hit.list.length, toIndex)), 0, el);
}

/* ------------------------------------------------------------------ */
/* grouping                                                            */
/* ------------------------------------------------------------------ */

/** Groups elements that share one parent list. Returns the new group, or null. */
export function groupElements(page: Page, ids: ID[]): GroupElement | null {
  const hits = ids.map((id) => locate(page.elements, id)).filter((h): h is Located => !!h);
  if (hits.length < 2) return null;
  const list = hits[0].list;
  if (!hits.every((h) => h.list === list)) return null;
  const sorted = [...hits].sort((a, b) => a.index - b.index);
  const members = sorted.map((h) => h.el);
  const bounds = boundsOfElements(members)!;
  const top = sorted[sorted.length - 1].index;
  const removedBefore = sorted.filter((h) => h.index < top).length;
  const children = members.map((m) => {
    const c = cloneDeep(m) as DesignElement;
    c.x -= bounds.x;
    c.y -= bounds.y;
    return c;
  });
  for (const h of [...sorted].reverse()) list.splice(h.index, 1);
  const group = createGroup(children, { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h });
  list.splice(top - removedBefore, 0, group);
  return group;
}

/** Dissolves a group; children get absolute (parent-space) coordinates. Returns the child ids. */
export function ungroup(page: Page, groupId: ID): ID[] {
  const hit = locate(page.elements, groupId);
  if (!hit || hit.el.type !== "group") return [];
  const g = hit.el;
  const gc = boxCenter(g);
  const out: DesignElement[] = g.children.map((child) => {
    const c = cloneDeep(child) as DesignElement;
    let cx = g.x + c.x + c.width / 2;
    let cy = g.y + c.y + c.height / 2;
    if (g.flipH) cx = gc.x - (cx - gc.x);
    if (g.flipV) cy = gc.y - (cy - gc.y);
    const p = rotatePoint({ x: cx, y: cy }, gc, g.rotation);
    c.x = p.x - c.width / 2;
    c.y = p.y - c.height / 2;
    c.rotation = (c.rotation + g.rotation) % 360;
    if (g.flipH) c.flipH = !c.flipH;
    if (g.flipV) c.flipV = !c.flipV;
    c.opacity *= g.opacity;
    if (g.locked) c.locked = true;
    return c;
  });
  hit.list.splice(hit.index, 1, ...out);
  return out.map((c) => c.id);
}

/**
 * Replaces the elements `ids` by `el`, which takes the paint position of the top-most of them, so that what was above them
 * stays above, and takes over the lines that were attached to them. Only elements at the top level of the page are replaced.
 * Returns false, and changes nothing, when there is no id, an id is not on the page or one of the elements is inside a group.
 */
export function replaceElements(page: Page, ids: ID[], el: DesignElement): boolean {
  const unique = [...new Set(ids)];
  const hits = unique.map((id) => locate(page.elements, id));
  if (!hits.length || hits.some((h) => !h || h.parent)) return false;
  const found = (hits as Located[]).sort((a, b) => a.index - b.index);
  const top = found[found.length - 1].index;
  const removedBefore = found.filter((h) => h.index < top).length;
  for (const h of [...found].reverse()) page.elements.splice(h.index, 1);
  page.elements.splice(top - removedBefore, 0, el);
  retargetLines(page.elements, unique, el.id);
  return true;
}

/* ------------------------------------------------------------------ */
/* align / distribute                                                  */
/* ------------------------------------------------------------------ */

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Aligns elements to `ref` (the page rect, or null to align to the selection's own bounds).
 */
export function alignElements(page: Page, ids: ID[], mode: AlignMode, ref: Rect | null): void {
  const top = topLevelIds(page, ids)
    .map((id) => findElement(page, id))
    .filter((e): e is DesignElement => !!e && !e.locked);
  if (!top.length) return;
  const target = ref ?? boundsOfElements(top)!;
  for (const el of top) {
    const b = boxBounds(el);
    if (mode === "left") el.x += target.x - b.x;
    else if (mode === "center") el.x += target.x + target.w / 2 - (b.x + b.w / 2);
    else if (mode === "right") el.x += target.x + target.w - (b.x + b.w);
    else if (mode === "top") el.y += target.y - b.y;
    else if (mode === "middle") el.y += target.y + target.h / 2 - (b.y + b.h / 2);
    else el.y += target.y + target.h - (b.y + b.h);
  }
}

/** Evenly spaces three or more elements along an axis. */
export function distributeElements(page: Page, ids: ID[], axis: "horizontal" | "vertical"): void {
  const els = topLevelIds(page, ids)
    .map((id) => findElement(page, id))
    .filter((e): e is DesignElement => !!e && !e.locked);
  if (els.length < 3) return;
  const h = axis === "horizontal";
  const items = els.map((el) => ({ el, b: boxBounds(el) })).sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = items.reduce((n, i) => n + (h ? i.b.w : i.b.h), 0);
  const span = h ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (items.length - 1);
  let cursor = h ? first.x + first.w : first.y + first.h;
  for (let i = 1; i < items.length - 1; i++) {
    const { el, b } = items[i];
    const next = cursor + gap;
    if (h) el.x += next - b.x;
    else el.y += next - b.y;
    cursor = next + (h ? b.w : b.h);
  }
}

/* ------------------------------------------------------------------ */
/* duplicate / flip                                                    */
/* ------------------------------------------------------------------ */

/** Clones the elements just above their originals, offset by (dx, dy). Returns the new ids. */
export function duplicateElements(page: Page, ids: ID[], dx = 24, dy = 24): ID[] {
  const out: ID[] = [];
  const originals: DesignElement[] = [];
  const copies: DesignElement[] = [];
  const tops = topLevelIds(page, ids);
  const groups = new Map<DesignElement[], Array<{ index: number; el: DesignElement }>>();
  for (const id of tops) {
    const hit = locate(page.elements, id);
    if (!hit) continue;
    if (!groups.has(hit.list)) groups.set(hit.list, []);
    groups.get(hit.list)!.push({ index: hit.index, el: hit.el });
  }
  for (const [list, items] of groups) {
    items.sort((a, b) => a.index - b.index);
    const clones = items.map(({ el }) => {
      const c = cloneElement(el);
      c.x += dx;
      c.y += dy;
      c.locked = false;
      out.push(c.id);
      originals.push(el);
      copies.push(c);
      return c;
    });
    const insertAt = items[items.length - 1].index + 1;
    list.splice(insertAt, 0, ...clones);
  }
  rebindClones(originals, copies);
  return out;
}

export function flipElements(page: Page, ids: ID[], axis: "horizontal" | "vertical"): void {
  const els = topLevelIds(page, ids)
    .map((id) => findElement(page, id))
    .filter((e): e is DesignElement => !!e && !e.locked);
  if (!els.length) return;
  const b = boundsOfElements(els)!;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  for (const el of els) {
    if (axis === "horizontal") {
      el.flipH = !el.flipH;
      const c = boxCenter(el);
      el.x = 2 * cx - c.x - el.width / 2;
      el.rotation = -el.rotation;
    } else {
      el.flipV = !el.flipV;
      const c = boxCenter(el);
      el.y = 2 * cy - c.y - el.height / 2;
      el.rotation = -el.rotation;
    }
  }
}

/* ------------------------------------------------------------------ */
/* scaling (resize design, group resize)                               */
/* ------------------------------------------------------------------ */

/**
 * Scales an element's geometry and its size-dependent properties (font size,
 * strokes, radii, shadows) about the origin of its parent space. Recurses into groups.
 */
export function scaleElement(el: DesignElement, sx: number, sy: number): void {
  const s = (sx + sy) / 2;
  el.x *= sx;
  el.y *= sy;
  el.width *= sx;
  el.height *= sy;
  if (el.shadow) {
    el.shadow.blur *= s;
    el.shadow.x *= sx;
    el.shadow.y *= sy;
  }
  if (el.blur) el.blur *= s;
  switch (el.type) {
    case "text":
      el.fontSize *= s;
      for (const p of el.paragraphs) for (const r of p.runs) if (r.size) r.size *= s;
      break;
    case "shape":
      el.radius *= s;
      if (el.stroke) el.stroke.width *= s;
      break;
    case "line":
      el.stroke.width *= s;
      break;
    case "image":
      el.radius *= s;
      if (el.stroke) el.stroke.width *= s;
      break;
    case "group":
      for (const c of el.children) scaleElement(c, sx, sy);
      break;
    case "table":
      el.fontSize *= s;
      el.colWidths = el.colWidths.map((w) => w * sx);
      el.rowHeights = el.rowHeights.map((h) => h * sy);
      el.borderWidth *= s;
      break;
    default:
      break;
  }
}

/**
 * Changes the design canvas size. With `scaleContent` all content is scaled
 * uniformly to fit and centred on every page.
 */
export function resizeDesign(design: Design, width: number, height: number, scaleContent: boolean): void {
  const ow = design.width;
  const oh = design.height;
  if (scaleContent) {
    const s = Math.min(width / ow, height / oh);
    const ox = (width - ow * s) / 2;
    const oy = (height - oh * s) / 2;
    for (const page of design.pages) {
      for (const el of page.elements) {
        scaleElement(el, s, s);
        el.x += ox;
        el.y += oy;
      }
    }
  }
  design.width = width;
  design.height = height;
  design.updatedAt = Date.now();
}

/* ------------------------------------------------------------------ */
/* pages                                                               */
/* ------------------------------------------------------------------ */

export function insertPage(design: Design, page: Page, index: number): void {
  design.pages.splice(Math.max(0, Math.min(design.pages.length, index)), 0, page);
}

export function removePage(design: Design, pageId: ID): void {
  if (design.pages.length <= 1) return;
  const i = design.pages.findIndex((p) => p.id === pageId);
  if (i >= 0) design.pages.splice(i, 1);
}

export function movePage(design: Design, pageId: ID, toIndex: number): void {
  const from = design.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return;
  const [p] = design.pages.splice(from, 1);
  design.pages.splice(Math.max(0, Math.min(design.pages.length, toIndex)), 0, p);
}

/* ------------------------------------------------------------------ */
/* text helpers                                                        */
/* ------------------------------------------------------------------ */

type RunKey = keyof TextRun;
const PROP_TO_RUN: Partial<Record<keyof TextElement, RunKey>> = {
  fontFamily: "font",
  fontSize: "size",
  fontWeight: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  color: "color",
  letterSpacing: "spacing",
};

/**
 * Applies element-level text style changes and clears the run-level overrides
 * they supersede (so "make everything bold" really does).
 */
export function applyTextProps(el: TextElement, patch: Partial<TextElement>): void {
  Object.assign(el, patch);
  for (const key of Object.keys(patch) as Array<keyof TextElement>) {
    const runKey = PROP_TO_RUN[key];
    if (!runKey) continue;
    for (const p of el.paragraphs) for (const r of p.runs) delete r[runKey];
  }
}

const sameStyle = (a: TextRun, b: TextRun) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.color === b.color &&
  a.size === b.size &&
  a.font === b.font &&
  a.spacing === b.spacing;

/** Merges neighbouring runs with identical style and drops empty runs (keeping one per paragraph). */
export function normalizeParagraphs(paragraphs: TextParagraph[]): TextParagraph[] {
  return paragraphs.map((p) => {
    const runs: TextRun[] = [];
    for (const r of p.runs) {
      if (!r.text && p.runs.length > 1) continue;
      const last = runs[runs.length - 1];
      if (last && sameStyle(last, r)) last.text += r.text;
      else runs.push({ ...r });
    }
    if (!runs.length) runs.push({ text: "" });
    return { ...p, runs };
  });
}

/** Stable duplicate of a page with fresh ids. */
export function clonePageWithIds(page: Page): Page {
  const copy = cloneDeep(page);
  copy.id = uid("p");
  const refresh = (e: DesignElement) => {
    e.id = uid(e.type[0]);
    if (e.type === "group") e.children.forEach(refresh);
  };
  copy.elements.forEach(refresh);
  rebindClones(page.elements, copy.elements);
  return copy;
}

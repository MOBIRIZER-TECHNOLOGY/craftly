/**
 * What people editing one design together send each other: operations, not designs. An operation names what it changes by id
 * (an element of a page, a page, the design) and carries the new value of every property it changes, so two people who change
 * different properties of the same element both keep their change, and when they change the same one, the one that is applied
 * last wins. The server decides the order, so every copy ends up the same.
 *
 * `diffDesign(prev, next)` turns two versions of a design into operations (cheap: it follows the objects that did not change by
 * reference, the way the store's structural sharing leaves them), and `applyOps(design, ops)` replays them on any copy, also on
 * one that has changed since: an operation that cannot be placed (the element is gone, the id is already there) is ignored, and
 * an index that is out of range is clamped. Pure code with no DOM and no store, so the server runs it too.
 *
 * Only what the people share is sent: the title, size and unit of the design, its guides, its pages and their elements. The
 * id, the dates, the folder, the star and the trash of a design belong to each person's own library.
 */
import type { Design, DesignElement, GroupElement, ID, Page } from "@/core/types";

export type Props = Record<string, unknown>;

/** The properties of a design that are shared; `guides` is the only one that may be absent. */
export const DESIGN_KEYS = ["title", "typeId", "width", "height", "unit", "guides"] as const;
const DESIGN_SET: ReadonlySet<string> = new Set(DESIGN_KEYS);

export type Op =
  | { k: "design"; set?: Props; unset?: string[] }
  | { k: "page.add"; page: Page; index: number }
  | { k: "page.del"; id: ID }
  | { k: "page.move"; id: ID; index: number }
  | { k: "page.set"; id: ID; set?: Props; unset?: string[] }
  | { k: "el.add"; page: ID; parent: ID | null; index: number; el: DesignElement }
  | { k: "el.del"; page: ID; id: ID }
  | { k: "el.move"; page: ID; id: ID; parent: ID | null; index: number }
  | { k: "el.set"; page: ID; id: ID; set?: Props; unset?: string[] };

/** What an element or a page is, which no operation changes. */
const ELEMENT_FIXED: ReadonlySet<string> = new Set(["id", "type", "children"]);
const PAGE_FIXED: ReadonlySet<string> = new Set(["id", "elements"]);
/** Keys that would change what an object is, not what it holds, when set from outside. */
const FORBIDDEN: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/* ---------------- comparing ---------------- */

/** Equal as JSON is: the same values, an undefined property is a missing one. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    return a.every((v, i) => jsonEqual(v, other[i]));
  }
  const left = a as Props;
  const right = b as Props;
  const keys = Object.keys(left).filter((k) => left[k] !== undefined);
  if (keys.length !== Object.keys(right).filter((k) => right[k] !== undefined).length) return false;
  return keys.every((k) => jsonEqual(left[k], right[k]));
}

/** The shared part of a design, as one value. */
export function syncedView(d: Design): Props {
  const view: Props = { title: d.title, typeId: d.typeId, width: d.width, height: d.height, unit: d.unit, pages: d.pages };
  if (d.guides !== undefined) view.guides = d.guides;
  return view;
}

/** Whether two designs are the same in everything that people editing together share. */
export const designsEqual = (a: Design, b: Design): boolean => jsonEqual(syncedView(a), syncedView(b));

/* ---------------- from two designs to operations ---------------- */

/** What changed between two versions of an object, over `keys`: the new values, and the names of what was removed. */
function diffProps(a: Props, b: Props, keys: Iterable<string>): { set?: Props; unset?: string[] } | null {
  let set: Props | undefined;
  let unset: string[] | undefined;
  for (const k of keys) {
    const was = a[k];
    const now = b[k];
    if (was === now) continue;
    if (now === undefined) (unset ??= []).push(k);
    else if (was === undefined || !jsonEqual(was, now)) (set ??= {})[k] = now;
  }
  if (!set && !unset) return null;
  return { ...(set ? { set } : {}), ...(unset ? { unset: unset.sort() } : {}) };
}

function keysOf(a: object, b: object, fixed: ReadonlySet<string>): Set<string> {
  const keys = new Set<string>();
  for (const o of [a, b]) for (const k of Object.keys(o)) if (!fixed.has(k)) keys.add(k);
  return keys;
}

interface Pieces {
  del: Op[];
  set: Op[];
  move: Op[];
  add: Op[];
}

interface ListHandlers<T> {
  del(item: T): void;
  move(id: ID, index: number): void;
  add(item: T, index: number): void;
  both(before: T, after: T): void;
}

/**
 * The difference between two lists of things with ids. What is in both and still the same kind is `both`; the rest is deleted
 * and added (so an id that changes its kind is a deletion and an addition). The moves come out as few as it takes to bring the
 * ones that stay into their new order, and are indexes into a list that has had its deletions but not yet its additions; the
 * additions come in the order of their new index, so each lands where it will be at the end.
 */
function diffList<T extends { id: ID }>(prev: readonly T[], next: readonly T[], h: ListHandlers<T>, sameKind: (a: T, b: T) => boolean): void {
  const before = new Map(prev.map((x) => [x.id, x]));
  const after = new Map(next.map((x) => [x.id, x]));
  const stays = (id: ID) => {
    const was = before.get(id);
    const now = after.get(id);
    return !!was && !!now && sameKind(was, now);
  };
  for (const p of prev) if (!stays(p.id)) h.del(p);
  const work = prev.filter((p) => stays(p.id)).map((p) => p.id);
  const target = next.filter((n) => stays(n.id)).map((n) => n.id);
  for (let i = 0; i < target.length; i++) {
    if (work[i] === target[i]) continue;
    work.splice(work.indexOf(target[i], i + 1), 1);
    work.splice(i, 0, target[i]);
    h.move(target[i], i);
  }
  for (const n of next) if (stays(n.id)) h.both(before.get(n.id) as T, n);
  next.forEach((n, i) => {
    if (!stays(n.id)) h.add(n, i);
  });
}

function diffElements(out: Pieces, page: ID, parent: ID | null, prev: readonly DesignElement[], next: readonly DesignElement[]): void {
  if (prev === next) return;
  diffList(
    prev,
    next,
    {
      del: (e) => out.del.push({ k: "el.del", page, id: e.id }),
      move: (id, index) => out.move.push({ k: "el.move", page, id, parent, index }),
      add: (el, index) => out.add.push({ k: "el.add", page, parent, index, el }),
      both: (a, b) => {
        if (a === b) return;
        const props = diffProps(a as unknown as Props, b as unknown as Props, keysOf(a, b, ELEMENT_FIXED));
        if (props) out.set.push({ k: "el.set", page, id: b.id, ...props });
        if (a.type === "group" && b.type === "group") diffElements(out, page, b.id, a.children, b.children);
      },
    },
    (a, b) => a.type === b.type,
  );
}

/** The operations that take a copy of `prev` to `next`: deletions first, then changes, then moves, then additions. */
export function diffDesign(prev: Design, next: Design): Op[] {
  if (prev === next) return [];
  const out: Pieces = { del: [], set: [], move: [], add: [] };
  const design = diffProps(prev as unknown as Props, next as unknown as Props, DESIGN_KEYS);
  if (design) out.set.push({ k: "design", ...design });
  if (prev.pages !== next.pages) {
    diffList(
      prev.pages,
      next.pages,
      {
        del: (p) => out.del.push({ k: "page.del", id: p.id }),
        move: (id, index) => out.move.push({ k: "page.move", id, index }),
        add: (page, index) => out.add.push({ k: "page.add", page, index }),
        both: (a, b) => {
          if (a === b) return;
          const props = diffProps(a as unknown as Props, b as unknown as Props, keysOf(a, b, PAGE_FIXED));
          if (props) out.set.push({ k: "page.set", id: b.id, ...props });
          diffElements(out, b.id, null, a.elements, b.elements);
        },
      },
      () => true,
    );
  }
  return [...out.del, ...out.set, ...out.move, ...out.add];
}

/* ---------------- replaying operations ---------------- */

const clamp = (index: number, length: number) => (Number.isFinite(index) ? Math.max(0, Math.min(length, Math.trunc(index))) : length);

function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const out = list.slice();
  out.splice(clamp(index, out.length), 0, item);
  return out;
}

/** An object with some properties set and some removed; the same object when that changes nothing. */
function withProps<T extends object>(obj: T, set: Props | undefined, unset: readonly string[] | undefined, fixed: ReadonlySet<string>): T {
  let out: Props | null = null;
  const cur = obj as Props;
  const skip = (k: string) => fixed.has(k) || FORBIDDEN.has(k);
  for (const [k, v] of Object.entries(set ?? {})) {
    if (skip(k) || v === undefined || jsonEqual(cur[k], v)) continue;
    (out ??= { ...cur })[k] = v;
  }
  for (const k of unset ?? []) {
    if (skip(k) || (out ?? cur)[k] === undefined) continue;
    out ??= { ...cur };
    delete out[k];
  }
  return (out ?? obj) as T;
}

/** Looks for an element at any depth, the way `edit` does. */
function findElement(list: readonly DesignElement[], id: ID): DesignElement | null {
  for (const el of list) {
    if (el.id === id) return el;
    if (el.type === "group") {
      const inner = findElement(el.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/** The list with the element `id`, wherever it is, replaced by what `fn` makes of it (null takes it out); the same list when there is none. */
function edit(list: readonly DesignElement[], id: ID, fn: (el: DesignElement) => DesignElement | null): readonly DesignElement[] {
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.id === id) {
      const made = fn(el);
      if (made === el) return list;
      const out = list.slice();
      if (made === null) out.splice(i, 1);
      else out[i] = made;
      return out;
    }
    if (el.type === "group") {
      const inner = edit(el.children, id, fn);
      if (inner !== el.children) {
        const out = list.slice();
        out[i] = { ...el, children: inner as DesignElement[] } as GroupElement;
        return out;
      }
    }
  }
  return list;
}

/** Puts `el` in the group `parent` (or at the top when `parent` is null); the same list when the group is not there. */
function insertElement(list: readonly DesignElement[], parent: ID | null, index: number, el: DesignElement): readonly DesignElement[] {
  if (parent === null) return insertAt(list, index, el);
  return edit(list, parent, (g) => (g.type === "group" ? ({ ...g, children: insertAt(g.children, index, el) } as GroupElement) : g));
}

/** The id of every one of these elements, the children of groups included, in order. */
const idList = (list: readonly DesignElement[], into: ID[] = []): ID[] => {
  for (const el of list) {
    into.push(el.id);
    if (el.type === "group") idList(el.children, into);
  }
  return into;
};

/** Whether all of these ids are new to the design: different from each other and from every page and element in it. */
function allNew(d: Design, ids: readonly ID[]): boolean {
  const used = new Set<ID>();
  for (const p of d.pages) {
    used.add(p.id);
    for (const id of idList(p.elements)) used.add(id);
  }
  return ids.every((id) => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  });
}

function inPage(d: Design, pageId: ID, fn: (page: Page) => Page): Design {
  const i = d.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return d;
  const made = fn(d.pages[i]);
  if (made === d.pages[i]) return d;
  const pages = d.pages.slice();
  pages[i] = made;
  return { ...d, pages };
}

const inElements = (d: Design, pageId: ID, fn: (list: readonly DesignElement[]) => readonly DesignElement[]): Design =>
  inPage(d, pageId, (p) => {
    const made = fn(p.elements);
    return made === p.elements ? p : { ...p, elements: made as DesignElement[] };
  });

/** One operation applied to a design: the new design, or the very same one when the operation changes nothing or cannot be placed. */
export function applyOp(d: Design, op: Op): Design {
  switch (op.k) {
    case "design": {
      let out = d;
      for (const [k, v] of Object.entries(op.set ?? {})) {
        if (DESIGN_SET.has(k) && v !== undefined && !jsonEqual((out as unknown as Props)[k], v)) out = { ...out, [k]: v };
      }
      if (op.unset?.includes("guides") && out.guides !== undefined) {
        const { guides: _guides, ...rest } = out;
        out = rest;
      }
      return out;
    }
    case "page.add": {
      if (!allNew(d, [op.page.id, ...idList(op.page.elements)])) return d;
      return { ...d, pages: insertAt(d.pages, op.index, op.page) };
    }
    case "page.del": {
      if (d.pages.length < 2 || !d.pages.some((p) => p.id === op.id)) return d;
      return { ...d, pages: d.pages.filter((p) => p.id !== op.id) };
    }
    case "page.move": {
      const from = d.pages.findIndex((p) => p.id === op.id);
      if (from < 0) return d;
      const rest = d.pages.filter((_, i) => i !== from);
      return { ...d, pages: insertAt(rest, op.index, d.pages[from]) };
    }
    case "page.set":
      return inPage(d, op.id, (p) => withProps(p, op.set, op.unset, PAGE_FIXED));
    case "el.add": {
      if (!allNew(d, idList([op.el]))) return d;
      return inElements(d, op.page, (list) => insertElement(list, op.parent, op.index, op.el));
    }
    case "el.del":
      return inElements(d, op.page, (list) => edit(list, op.id, () => null));
    case "el.move":
      return inElements(d, op.page, (list) => {
        const el = findElement(list, op.id);
        if (!el) return list;
        // an element cannot go into itself or into what it holds
        if (op.parent !== null && (op.parent === op.id || (el.type === "group" && findElement(el.children, op.parent)))) return list;
        // nor into what is not there or is not a group: it would be taken out of its place and put nowhere
        if (op.parent !== null && findElement(list, op.parent)?.type !== "group") return list;
        return insertElement(
          edit(list, op.id, () => null),
          op.parent,
          op.index,
          el,
        );
      });
    case "el.set":
      return inElements(d, op.page, (list) => edit(list, op.id, (el) => withProps(el, op.set, op.unset, ELEMENT_FIXED)));
  }
}

/** Operations applied one after the other; the same design when none of them changes anything. */
export function applyOps(design: Design, ops: readonly Op[]): Design {
  let out = design;
  for (const op of ops) out = applyOp(out, op);
  return out;
}

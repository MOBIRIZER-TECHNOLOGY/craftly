/**
 * The operations that live editing sends instead of whole designs: what a change between two designs is, property by property
 * and element by element, and what replaying it does to another copy of the design (also when that copy has changed in the
 * meantime). No network and no store here; the property tests that run real editor actions through this are in ops.store.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createLine, createPage, createShape, createText, solid } from "@/core/factory";
import type { Design, DesignElement, GroupElement, Page } from "@/core/types";
import { applyOp, applyOps, diffDesign, designsEqual, syncedView, type Op } from "./ops";

const rect = (id: string, x = 0, y = 0, extra: Partial<DesignElement> = {}) => createShape("rect", { id, x, y, width: 100, height: 50, ...extra });
const page = (id: string, elements: DesignElement[] = [], extra: Partial<Page> = {}) => createPage({ id, elements, ...extra });
const designOf = (...pages: Page[]): Design => createDesign({ title: "T", width: 1000, height: 600, pages });
const withPage = (d: Design, id: string, fn: (p: Page) => Page): Design => ({ ...d, pages: d.pages.map((p) => (p.id === id ? fn(p) : p)) });
const ids = (list: DesignElement[]) => list.map((e) => e.id);
const first = (d: Design) => d.pages[0].elements;

describe("diffDesign", () => {
  it("has nothing to say about a design that is the same, or only another object with the same content", () => {
    const d = designOf(page("p", [rect("a")]));
    expect(diffDesign(d, d)).toEqual([]);
    expect(diffDesign(d, { ...d, pages: d.pages.map((p) => ({ ...p, elements: p.elements.map((e) => ({ ...e })) })) })).toEqual([]);
  });

  it("sends the properties of the design that are shared, and leaves the ones that belong to each person's own library", () => {
    const d = designOf(page("p"));
    const next = { ...d, title: "New", width: 800, updatedAt: d.updatedAt + 5, folderId: "f", starred: true, trashedAt: 99 };
    expect(diffDesign(d, next)).toEqual([{ k: "design", set: { title: "New", width: 800 } }]);
    const noGuides = { ...d, guides: { vertical: [10], horizontal: [] } };
    expect(diffDesign(d, noGuides)).toEqual([{ k: "design", set: { guides: { vertical: [10], horizontal: [] } } }]);
    expect(diffDesign(noGuides, d)).toEqual([{ k: "design", unset: ["guides"] }]);
  });

  it("describes pages: added whole, deleted, moved, and their own properties without their elements", () => {
    const a = page("a", [rect("r1")]);
    const b = page("b");
    const c = page("c", [], { name: "Third" });
    const d = designOf(a, b);
    expect(diffDesign(d, designOf(a, b, c))).toEqual([{ k: "page.add", page: c, index: 2 }]);
    expect(diffDesign(d, designOf(b))).toEqual([{ k: "page.del", id: "a" }]);
    expect(diffDesign(d, designOf(b, a))).toEqual([{ k: "page.move", id: "b", index: 0 }]);
    const renamed = designOf({ ...a, name: "First", notes: "n" }, b);
    expect(diffDesign(d, renamed)).toEqual([{ k: "page.set", id: "a", set: { name: "First", notes: "n" } }]);
    const unnamed = designOf(a, b);
    expect(diffDesign(renamed, unnamed)).toEqual([{ k: "page.set", id: "a", unset: ["name", "notes"] }]);
  });

  it("describes elements: changed properties only, with what was removed", () => {
    const d = designOf(page("p", [rect("a", 0, 0, { fill: solid("#ff0000") }), rect("b", 300, 0)]));
    const moved = withPage(d, "p", (p) => ({ ...p, elements: p.elements.map((e) => (e.id === "a" ? { ...e, x: 40, fill: solid("#00ff00") } : e)) }));
    expect(diffDesign(d, moved)).toEqual([{ k: "el.set", page: "p", id: "a", set: { x: 40, fill: solid("#00ff00") } }]);
    const unblurred = withPage(moved, "p", (p) => ({ ...p, elements: p.elements.map((e) => (e.id === "a" ? { ...e, blur: 4 } : e)) }));
    const clean = withPage(unblurred, "p", (p) => ({ ...p, elements: p.elements.map((e) => (e.id === "a" ? (({ blur: _blur, ...rest }) => rest as DesignElement)(e) : e)) }));
    expect(diffDesign(unblurred, clean)).toEqual([{ k: "el.set", page: "p", id: "a", unset: ["blur"] }]);
  });

  it("describes a blend mode that is set and one that is taken away, and replaying either gives the design back", () => {
    const plain = designOf(page("p", [rect("a")]));
    const blended = withPage(plain, "p", (p) => ({ ...p, elements: p.elements.map((e) => ({ ...e, blend: "multiply" as const })) }));
    expect(diffDesign(plain, blended)).toEqual([{ k: "el.set", page: "p", id: "a", set: { blend: "multiply" } }]);
    expect(diffDesign(blended, plain)).toEqual([{ k: "el.set", page: "p", id: "a", unset: ["blend"] }]);
    expect(applyOps(plain, diffDesign(plain, blended))).toEqual(blended);
    expect(applyOps(blended, diffDesign(blended, plain))).toEqual(plain);
  });

  it("does not send a property again that has the same content in a new object", () => {
    const d = designOf(page("p", [rect("a", 0, 0, { fill: solid("#ff0000") })]));
    const same = withPage(d, "p", (p) => ({ ...p, elements: p.elements.map((e) => ({ ...e, fill: solid("#ff0000") })) }));
    expect(diffDesign(d, same)).toEqual([]);
  });

  it("describes elements that come and go, and the order of the others, in an order that never shows an id twice", () => {
    const d = designOf(page("p", [rect("a"), rect("b"), rect("c"), rect("d")]));
    const next = withPage(d, "p", (p) => ({ ...p, elements: [rect("n1"), p.elements[3], p.elements[0], rect("n2"), p.elements[2]] }));
    const ops = diffDesign(d, next);
    expect(ops.map((o) => o.k)).toEqual(["el.del", "el.move", "el.add", "el.add"]); // one move is enough to put d first
    expect(ops[0]).toEqual({ k: "el.del", page: "p", id: "b" });
    // replaying them one by one: no id is ever twice on the page, and the end is exactly the new design
    let at = d;
    for (const op of ops) {
      at = applyOp(at, op);
      const all = ids(first(at));
      expect(new Set(all).size).toBe(all.length);
    }
    expect(ids(first(at))).toEqual(["n1", "d", "a", "n2", "c"]);
  });

  it("puts every deletion before every addition across the whole design, so that an element that moves between lists is never twice there", () => {
    const grouped = createGroup([rect("a"), rect("b")], { id: "g", x: 0, y: 0, width: 100, height: 50 }) as GroupElement;
    const d = designOf(page("p", [rect("a"), rect("b"), rect("c")]));
    const next = withPage(d, "p", (p) => ({ ...p, elements: [grouped, p.elements[2]] }));
    const ops = diffDesign(d, next);
    const kinds = ops.map((o) => o.k);
    expect(kinds.lastIndexOf("el.del")).toBeLessThan(kinds.indexOf("el.add"));
    expect(ids(first(applyOps(d, ops)))).toEqual(["g", "c"]);
    const back = diffDesign(next, d);
    expect(ids(first(applyOps(next, back)))).toEqual(["a", "b", "c"]);
  });

  it("describes what happens inside a group by the group's own id", () => {
    const g = createGroup([rect("a"), rect("b")], { id: "g", x: 0, y: 0, width: 400, height: 50 }) as GroupElement;
    const d = designOf(page("p", [g]));
    const next = withPage(d, "p", (p) => ({
      ...p,
      elements: [{ ...g, children: [{ ...g.children[0], x: 9 }, rect("n", 5, 5)] } as GroupElement],
    }));
    expect(diffDesign(d, next)).toEqual([
      { k: "el.del", page: "p", id: "b" },
      { k: "el.set", page: "p", id: "a", set: { x: 9 } },
      { k: "el.add", page: "p", parent: "g", index: 1, el: next.pages[0].elements[0] && (next.pages[0].elements[0] as GroupElement).children[1] },
    ]);
  });

  it("treats an element that changed its kind under the same id as a new one", () => {
    const d = designOf(page("p", [rect("a")]));
    const next = withPage(d, "p", (p) => ({ ...p, elements: [createText({ id: "a", text: "Hi" })] }));
    expect(diffDesign(d, next).map((o) => o.k)).toEqual(["el.del", "el.add"]);
    expect(designsEqual(applyOps(d, diffDesign(d, next)), next)).toBe(true);
  });

  it("carries the geometry of attached lines like any other property, so a copy that replays it sees the same drawing", () => {
    const line = createLine({ id: "l", start: { elementId: "a", anchor: "auto" }, end: { elementId: "b", anchor: "left" } });
    const d = designOf(page("p", [rect("a"), rect("b", 300, 0), line]));
    const next = withPage(d, "p", (p) => ({ ...p, elements: p.elements.map((e) => (e.id === "l" ? { ...e, x: 111, width: 222, rotation: 3 } : e)) }));
    expect(diffDesign(d, next)).toEqual([{ k: "el.set", page: "p", id: "l", set: { x: 111, width: 222, rotation: 3 } }]);
  });
});

describe("applyOps", () => {
  const base = () => designOf(page("p", [rect("a", 0, 0), rect("b", 300, 0)]), page("q", [rect("c")]));

  it("gives back a design that is the new one, in the parts that are shared", () => {
    const d = base();
    const next = { ...withPage(d, "p", (p) => ({ ...p, elements: [...p.elements, rect("n", 5, 5)], name: "Renamed" })), title: "Other" };
    expect(designsEqual(applyOps(d, diffDesign(d, next)), next)).toBe(true);
  });

  it("keeps what it did not change: the same objects", () => {
    const d = base();
    const out = applyOp(d, { k: "el.set", page: "p", id: "a", set: { x: 5 } });
    expect(out.pages[1]).toBe(d.pages[1]);
    expect(out.pages[0].elements[1]).toBe(d.pages[0].elements[1]);
    expect(out.pages[0].elements[0]).not.toBe(d.pages[0].elements[0]);
    expect(applyOps(d, [])).toBe(d);
  });

  it("does not change the design it is given, even a frozen one", () => {
    const d = base();
    const frozen = JSON.parse(JSON.stringify(d)) as Design;
    Object.freeze(frozen);
    for (const p of frozen.pages) {
      Object.freeze(p);
      Object.freeze(p.elements);
      for (const e of p.elements) Object.freeze(e);
    }
    const out = applyOps(frozen, [
      { k: "el.set", page: "p", id: "a", set: { x: 77 } },
      { k: "el.del", page: "p", id: "b" },
      { k: "el.add", page: "p", parent: null, index: 0, el: rect("z") },
      { k: "page.set", id: "q", set: { name: "Q" } },
    ]);
    expect(ids(out.pages[0].elements)).toEqual(["z", "a"]);
    expect(ids(frozen.pages[0].elements)).toEqual(["a", "b"]);
  });

  it("ignores what it cannot place, so that an operation that arrives late cannot do harm", () => {
    const d = base();
    const noise: Op[] = [
      { k: "el.set", page: "p", id: "gone", set: { x: 1 } },
      { k: "el.set", page: "nope", id: "a", set: { x: 1 } },
      { k: "el.del", page: "p", id: "gone" },
      { k: "el.move", page: "p", id: "gone", parent: null, index: 0 },
      { k: "el.add", page: "p", parent: "no-such-group", index: 0, el: rect("x") },
      { k: "el.add", page: "nope", parent: null, index: 0, el: rect("y") },
      { k: "page.set", id: "nope", set: { name: "x" } },
      { k: "page.del", id: "nope" },
      { k: "page.move", id: "nope", index: 0 },
    ];
    expect(applyOps(d, noise)).toBe(d);
  });

  it("is harmless to apply twice what adds: an element or a page that is there is not added again", () => {
    const d = base();
    const add: Op = { k: "el.add", page: "p", parent: null, index: 2, el: rect("n") };
    const once = applyOp(d, add);
    expect(applyOp(once, add)).toBe(once);
    // not even on another page: an id is one element
    expect(applyOp(once, { k: "el.add", page: "q", parent: null, index: 0, el: rect("n") })).toBe(once);
    const pg: Op = { k: "page.add", page: page("r"), index: 1 };
    const twice = applyOp(applyOp(d, pg), pg);
    expect(twice.pages.map((p) => p.id)).toEqual(["p", "r", "q"]);
  });

  it("does not let a page or a group bring an element whose id is already in use: an id is one thing", () => {
    const d = base();
    expect(applyOp(d, { k: "page.add", page: page("r", [rect("c")]), index: 0 })).toBe(d); // c is on another page
    const group = (id: string, child: string) => createGroup([rect(child)], { id, x: 0, y: 0, width: 100, height: 50 });
    expect(applyOp(d, { k: "el.add", page: "p", parent: null, index: 0, el: group("g2", "a") })).toBe(d);
    expect(applyOp(d, { k: "page.add", page: page("s", [group("g3", "b")]), index: 0 })).toBe(d); // b is inside a group on the new page
    // and not the same id twice in what it brings
    expect(applyOp(d, { k: "el.add", page: "q", parent: null, index: 0, el: group("g4", "g4") })).toBe(d);
    const twins = createGroup([rect("x"), rect("x")], { id: "g5", x: 0, y: 0, width: 100, height: 50 });
    expect(applyOp(d, { k: "el.add", page: "q", parent: null, index: 0, el: twins })).toBe(d);
    expect(applyOp(d, { k: "page.add", page: page("t", [rect("y"), rect("y")]), index: 0 })).toBe(d);
    expect(applyOp(d, { k: "page.add", page: page("t", [rect("t")]), index: 0 })).toBe(d);
  });

  it("deletes an element that is inside a group, and does not move one into a group that is not there", () => {
    const g = createGroup([rect("in1"), rect("in2")], { id: "g", x: 0, y: 0, width: 100, height: 50 }) as GroupElement;
    const d = designOf(page("p", [g, rect("out")]));
    expect(ids((first(applyOp(d, { k: "el.del", page: "p", id: "in1" }))[0] as GroupElement).children)).toEqual(["in2"]);
    expect(applyOp(d, { k: "el.move", page: "p", id: "out", parent: "no-such-group", index: 0 })).toBe(d); // the element is not lost
  });

  it("returns the very same design when a property is set to what it is, or removed when it is not there", () => {
    const d = designOf(page("p", [rect("a", 5)]));
    expect(applyOp(d, { k: "el.set", page: "p", id: "a", set: { x: 5 } })).toBe(d);
    expect(applyOp(d, { k: "el.set", page: "p", id: "a", set: { fill: solid("#00ff00") }, unset: ["blur"] }).pages[0].elements[0]).toMatchObject({ fill: solid("#00ff00") });
    expect(applyOp(d, { k: "el.set", page: "p", id: "a", unset: ["blur"] })).toBe(d);
    expect(applyOp(d, { k: "page.set", id: "p", unset: ["notes"] })).toBe(d);
  });

  it("does not let an operation touch what makes an element itself: its id, its kind and its children", () => {
    const g = createGroup([rect("in")], { id: "g", x: 0, y: 0, width: 100, height: 50 }) as GroupElement;
    const d = designOf(page("p", [g]));
    const out = applyOp(d, { k: "el.set", page: "p", id: "g", set: { id: "other", type: "text", children: [], x: 9 }, unset: ["id", "type", "children"] });
    const el = first(out)[0] as GroupElement;
    expect(el).toMatchObject({ id: "g", type: "group", x: 9 });
    expect(ids(el.children)).toEqual(["in"]);
    const pageOut = applyOp(d, { k: "page.set", id: "p", set: { id: "x", elements: [], name: "N" }, unset: ["id", "elements"] });
    expect(pageOut.pages[0]).toMatchObject({ id: "p", name: "N" });
    expect(pageOut.pages[0].elements).toHaveLength(1);
  });

  it("clamps an index that is out of range, so a list that others changed still takes an insertion or a move", () => {
    const d = base();
    expect(ids(first(applyOp(d, { k: "el.add", page: "p", parent: null, index: 99, el: rect("n") })))).toEqual(["a", "b", "n"]);
    expect(ids(first(applyOp(d, { k: "el.add", page: "p", parent: null, index: -4, el: rect("n") })))).toEqual(["n", "a", "b"]);
    expect(ids(first(applyOp(d, { k: "el.move", page: "p", id: "a", parent: null, index: 99 })))).toEqual(["b", "a"]);
    expect(applyOp(d, { k: "page.move", id: "p", index: 99 }).pages.map((p) => p.id)).toEqual(["q", "p"]);
  });

  it("moves an element into a group and out of one, where it is asked to", () => {
    const g = createGroup([rect("in")], { id: "g", x: 0, y: 0, width: 100, height: 50 }) as GroupElement;
    const d = designOf(page("p", [g, rect("out")]));
    const into = applyOp(d, { k: "el.move", page: "p", id: "out", parent: "g", index: 0 });
    expect(ids((first(into)[0] as GroupElement).children)).toEqual(["out", "in"]);
    expect(ids(first(into))).toEqual(["g"]);
    const outOf = applyOp(into, { k: "el.move", page: "p", id: "in", parent: null, index: 0 });
    expect(ids(first(outOf))).toEqual(["in", "g"]);
    // a group cannot go into itself or into what it holds
    expect(applyOp(d, { k: "el.move", page: "p", id: "g", parent: "g", index: 0 })).toBe(d);
  });

  it("puts at the end what it is told to put at a place that is not a number", () => {
    const d = base();
    expect(ids(first(applyOp(d, { k: "el.add", page: "p", parent: null, index: Number.NaN, el: rect("n") })))).toEqual(["a", "b", "n"]);
    expect(applyOp(d, { k: "page.move", id: "p", index: Number.NaN }).pages.map((p) => p.id)).toEqual(["q", "p"]);
  });

  it("does not let a property from outside change what an object is: no __proto__, no constructor", () => {
    const d = base();
    const hostile = JSON.parse('{"k":"el.set","page":"p","id":"a","set":{"__proto__":{"polluted":true},"constructor":"x","x":5},"unset":["constructor"]}') as Op;
    const out = applyOp(d, hostile);
    const el = first(out)[0] as unknown as Record<string, unknown>;
    expect(el.x).toBe(5);
    expect(el.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(el)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(el, "constructor")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("removes a page, and the elements on it, in one operation", () => {
    const d = base();
    const out = applyOp(d, { k: "page.del", id: "p" });
    expect(out.pages.map((p) => p.id)).toEqual(["q"]);
  });

  it("keeps the last page: a design is never left without one", () => {
    const d = designOf(page("only"));
    expect(applyOp(d, { k: "page.del", id: "only" })).toBe(d);
  });

  it("applies the properties of the design that are shared, and nothing of the person's library", () => {
    const d = base();
    const out = applyOp(d, {
      k: "design",
      set: { title: "Shared", folderId: "elsewhere", id: "new-id", updatedAt: 1, trashedAt: 5 } as never,
      unset: ["unit", "starred", "guides"] as never,
    });
    expect(out.title).toBe("Shared");
    expect(out.folderId).toBe(d.folderId);
    expect(out.id).toBe(d.id);
    expect(out.updatedAt).toBe(d.updatedAt);
    expect(out.trashedAt).toBe(d.trashedAt);
    expect(out.starred).toBe(d.starred);
    expect(out.unit).toBe(d.unit); // what every design has stays
    expect(applyOp({ ...d, guides: { vertical: [1], horizontal: [] } }, { k: "design", unset: ["guides"] }).guides).toBeUndefined();
  });

  it("two people changing different properties of the same element both keep their change, whichever is applied last", () => {
    const d = designOf(page("p", [rect("a", 0, 0, { fill: solid("#ff0000") })]));
    const mine: Op = { k: "el.set", page: "p", id: "a", set: { x: 50 } };
    const theirs: Op = { k: "el.set", page: "p", id: "a", set: { fill: solid("#0000ff") } };
    const one = applyOps(d, [mine, theirs]);
    const two = applyOps(d, [theirs, mine]);
    expect(designsEqual(one, two)).toBe(true);
    expect(first(one)[0]).toMatchObject({ x: 50, fill: solid("#0000ff") });
  });

  it("when two people change the same property the one applied last wins", () => {
    const d = designOf(page("p", [rect("a")]));
    const out = applyOps(d, [
      { k: "el.set", page: "p", id: "a", set: { x: 1 } },
      { k: "el.set", page: "p", id: "a", set: { x: 2 } },
    ]);
    expect(first(out)[0].x).toBe(2);
  });

  it("an element that someone deleted stays deleted when another change to it arrives later", () => {
    const d = designOf(page("p", [rect("a"), rect("b")]));
    const out = applyOps(d, [
      { k: "el.del", page: "p", id: "a" },
      { k: "el.set", page: "p", id: "a", set: { x: 9 } },
    ]);
    expect(ids(first(out))).toEqual(["b"]);
  });
});

describe("designsEqual and syncedView", () => {
  it("compare the shared parts only", () => {
    const d = designOf(page("p", [rect("a")]));
    expect(designsEqual(d, { ...d, updatedAt: 0, folderId: "x", starred: true, trashedAt: 3, createdAt: 1, id: "other", version: 99 })).toBe(true);
    expect(designsEqual(d, { ...d, title: "Different" })).toBe(false);
    expect(
      designsEqual(
        d,
        withPage(d, "p", (p) => ({ ...p, elements: [rect("a", 1)] })),
      ),
    ).toBe(false);
    expect(Object.keys(syncedView(d)).sort()).toEqual(["height", "pages", "title", "typeId", "unit", "width"]);
  });

  it("tell a property that is missing from one that is undefined: they are the same", () => {
    const d = designOf(page("p", [rect("a")]));
    expect(
      designsEqual(
        d,
        withPage(d, "p", (p) => ({ ...p, elements: [{ ...p.elements[0], blur: undefined }] })),
      ),
    ).toBe(true);
  });
});

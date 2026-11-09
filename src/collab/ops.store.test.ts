/**
 * The property that makes live editing possible, checked on what the editor really does: for every step of a long, random series
 * of editor actions (the real store: add, move, resize, delete, duplicate, group, ungroup, reorder, align, connect, copy, paste,
 * pages, undo, redo ...), the operations that `diffDesign` makes from the design before and after, sent through JSON as they would
 * be over a network and replayed on a copy of the design before, give the design after, and the operations the other way give the
 * design before. Seeded, so a failure names the seed and the step that reproduce it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createLine, createPage, createShape, createText, solid } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { DesignElement } from "@/core/types";
import { random, type Random } from "@/test/random";
import { applyOps, designsEqual, diffDesign, type Op } from "./ops";

const actions = () => useEditor.getState().actions;
const state = () => useEditor.getState();

const COLORS = ["#ff0000", "#00aa00", "#0000ff", "#f5a623", "#222222"];

function start() {
  useEditor.setState(useEditor.getInitialState(), true);
  const shapes = (n: number) => Array.from({ length: n }, (_, i) => createShape(i % 2 ? "ellipse" : "rect", { x: 40 + i * 120, y: 60 + (i % 3) * 90, width: 100, height: 60 }));
  const a = shapes(3);
  const line = createLine({ x: 0, y: 400, start: { elementId: a[0].id, anchor: "auto" }, end: { elementId: a[1].id, anchor: "auto" } });
  actions().openDesign(
    createDesign({
      title: "Random",
      width: 1000,
      height: 600,
      pages: [createPage({ elements: [...a, line, createText({ text: "Hello", x: 500, y: 300 })] }), createPage({ elements: shapes(2) })],
    }),
  );
}

/** Every kind of step; each returns false when it had nothing to work on. */
const STEPS: Record<string, (r: Random) => boolean> = {
  add: (r) => {
    actions().addElement(createShape(r.pick(["rect", "ellipse", "triangle", "star"]), { x: r.int(800), y: r.int(500), width: 40 + r.int(200), height: 40 + r.int(150) }), {
      center: false,
    });
    return true;
  },
  addText: (r) => {
    actions().addElement(createText({ text: r.pick(["Hi", "Craftly", "Two\nlines"]), x: r.int(800), y: r.int(500) }), { center: false });
    return true;
  },
  move: (r) => {
    const el = top(r);
    if (!el) return false;
    actions().updateElements([el.id], { x: r.int(900), y: r.int(500) });
    return true;
  },
  resize: (r) => {
    const el = top(r);
    if (!el || el.type === "line" || el.type === "text") return false;
    actions().updateElements([el.id], { width: 30 + r.int(300), height: 30 + r.int(200), rotation: r.pick([0, 15, 90, 200]) });
    return true;
  },
  paint: (r) => {
    const el = top(r);
    if (!el || el.type !== "shape") return false;
    actions().updateElements([el.id], { fill: solid(r.pick(COLORS)) });
    return true;
  },
  restyle: (r) => {
    const el = top(r);
    if (!el) return false;
    actions().updateElements([el.id], r.pick([{ opacity: 0.5 }, { blur: 3 }, { locked: false }, { shadow: { color: "#000000", blur: 4, x: 2, y: 2 } }, { shadow: null }]));
    return true;
  },
  fontSize: (r) => {
    const el = elements().find((e) => e.type === "text");
    if (!el) return false;
    actions().updateElements([el.id], { fontSize: 20 + r.int(80) } as Partial<DesignElement>);
    return true;
  },
  delete: (r) => {
    const els = r.some(elements(), 2);
    if (!els.length) return false;
    actions().deleteElements(els.map((e) => e.id));
    return true;
  },
  duplicate: (r) => {
    const els = r.some(elements(), 3);
    if (!els.length) return false;
    actions().select(els.map((e) => e.id));
    actions().duplicateSelection();
    return true;
  },
  group: (r) => {
    const els = r.some(elements(), 4);
    if (els.length < 2) return false;
    actions().select(els.map((e) => e.id));
    actions().groupSelection();
    return true;
  },
  ungroup: (r) => {
    const g = r.pick(
      elements()
        .filter((e) => e.type === "group")
        .concat([undefined as never]),
    );
    if (!g) return false;
    actions().select([g.id]);
    actions().ungroupSelection();
    return true;
  },
  arrange: (r) => {
    const el = top(r);
    if (!el) return false;
    actions().arrange(r.pick(["forward", "backward", "front", "back"] as const), [el.id]);
    return true;
  },
  align: (r) => {
    const els = r.some(elements(), 4);
    if (!els.length) return false;
    actions().select(els.map((e) => e.id));
    actions().align(r.pick(["left", "center", "right", "top", "middle", "bottom"] as const), "selection");
    return true;
  },
  flip: (r) => {
    const el = top(r);
    if (!el) return false;
    actions().select([el.id]);
    actions().flip(r.pick(["horizontal", "vertical"] as const));
    return true;
  },
  connect: (r) => {
    const els = r.some(
      elements().filter((e) => e.type !== "line"),
      2,
    );
    if (els.length !== 2) return false;
    return actions().connect(els[0].id, els[1].id) !== "";
  },
  copyPaste: (r) => {
    const els = r.some(elements(), 3);
    if (!els.length) return false;
    actions().select(els.map((e) => e.id));
    actions().copy();
    actions().paste();
    return true;
  },
  cutPaste: (r) => {
    const els = r.some(elements(), 2);
    if (!els.length) return false;
    actions().select(els.map((e) => e.id));
    actions().cut();
    actions().paste();
    return true;
  },
  addPage: () => {
    actions().addPage();
    return true;
  },
  duplicatePage: () => {
    actions().duplicatePage();
    return true;
  },
  deletePage: (r) => {
    const pages = state().design!.pages;
    if (pages.length < 2) return false;
    actions().deletePage(r.pick(pages).id);
    return true;
  },
  movePage: (r) => {
    const pages = state().design!.pages;
    if (pages.length < 2) return false;
    actions().movePage(r.pick(pages).id, r.int(pages.length));
    return true;
  },
  switchPage: (r) => {
    actions().setActivePage(r.pick(state().design!.pages).id);
    return true;
  },
  pageProps: (r) => {
    actions().setPageName(state().activePageId, r.pick(["One", "Two", ""]));
    actions().setPageBackground(solid(r.pick(COLORS)));
    return true;
  },
  title: (r) => {
    actions().setTitle(r.pick(["A", "B", "Untitled"]));
    return true;
  },
  resizeDesign: (r) => {
    actions().resizeDesign(600 + r.int(800), 400 + r.int(500), r.next() < 0.5);
    return true;
  },
  undo: () => {
    actions().undo();
    return true;
  },
  redo: () => {
    actions().redo();
    return true;
  },
};

const elements = () => getActivePage(state())?.elements ?? [];
const top = (r: Random) => (elements().length ? r.pick(elements()) : undefined);

describe("operations from real editor actions", () => {
  beforeEach(start);

  it("replay the change of every step, in both directions, and cover every kind of step", () => {
    const names = Object.keys(STEPS);
    const done: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
    let compared = 0;
    for (let seed = 1; seed <= 40; seed++) {
      start();
      const r = random(seed);
      for (let step = 1; step <= 60; step++) {
        const name = r.pick(names);
        const before = state().design!;
        const worked = STEPS[name](r);
        const after = state().design!;
        if (worked) done[name]++;
        if (after === before) continue;
        compared++;
        const there = JSON.parse(JSON.stringify(diffDesign(before, after))) as Op[];
        const back = JSON.parse(JSON.stringify(diffDesign(after, before))) as Op[];
        const forwards = applyOps(before, there);
        const backwards = applyOps(after, back);
        if (!designsEqual(forwards, after)) expect.fail(`seed ${seed}, step ${step} (${name}): replaying the change does not give the new design`);
        if (!designsEqual(backwards, before)) expect.fail(`seed ${seed}, step ${step} (${name}): replaying the change backwards does not give the old design`);
        // and an operation list is never longer than it has to be: nothing changed means nothing is sent
        if (designsEqual(before, after)) expect(there).toEqual([]);
      }
    }
    expect(compared).toBeGreaterThan(1500);
    for (const name of names) expect(done[name], `the step "${name}" never ran`).toBeGreaterThan(5);
  });

  it("send a small change as a small message: moving one element is one operation about that element", () => {
    const el = elements().find((e) => e.type === "text")!;
    const before = state().design!;
    actions().updateElements([el.id], { x: 123 });
    const ops = diffDesign(before, state().design!);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ k: "el.set", id: el.id, set: { x: 123 } });
    expect(JSON.stringify(ops).length).toBeLessThan(300);
  });

  it("send the lines that follow a shape along with it, so every copy draws the same", () => {
    const [shape, , , line] = elements();
    const before = state().design!;
    actions().updateElements([shape.id], { x: 500, y: 400 });
    const ops = diffDesign(before, state().design!);
    expect(ops.map((o) => (o as { id?: string }).id).sort()).toEqual([line.id, shape.id].sort());
  });
});

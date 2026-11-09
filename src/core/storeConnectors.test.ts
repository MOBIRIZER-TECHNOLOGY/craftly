/**
 * Lines that are attached to shapes, as the editor keeps them: a shape that moves takes its lines with it in the same step of
 * undo, a shape that goes takes them along, and copies (duplicate, paste, a copied page) keep to each other. The geometry is in
 * connectors.test.ts; this is the store putting it to work.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { lineEndpoints } from "./connectors";
import { createDesign, createGroup, createLine, createPage, createShape, createText } from "./factory";
import { pageOf, useEditor } from "./store";
import type { DesignElement, GroupElement, LineElement, Point } from "./types";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const page = () => pageOf(s().design, s().activePageId)!;
const ids = () => page().elements.map((e) => e.id);
const el = (id: string) => page().elements.find((e) => e.id === id)!;
const line = (id: string) => el(id) as LineElement;
const rect = (id: string, x = 0, y = 0, w = 100, h = 50, over: Partial<DesignElement> = {}) => createShape("rect", { id, x, y, width: w, height: h, ...over });

function open(elements: DesignElement[] = [rect("A", 0, 0), rect("B", 300, 0)]) {
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements })] }));
}

const near = (p: Point, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

beforeEach(() => open());

describe("connect", () => {
  it("joins two shapes with an arrow that is aimed at both, on top of the page, and selects it", () => {
    const id = a().connect("A", "B");
    expect(id).not.toBe("");
    expect(ids()).toEqual(["A", "B", id]);
    const l = line(id);
    expect(l.start).toEqual({ elementId: "A", anchor: "auto" });
    expect(l.end).toEqual({ elementId: "B", anchor: "auto" });
    expect(l.startArrow).toBe("none");
    expect(l.endArrow).toBe("arrow");
    near(lineEndpoints(l).start, 100, 25);
    near(lineEndpoints(l).end, 300, 25);
    expect(s().selection).toEqual([id]);
  });

  it("draws it with the weight of the arrows of the Elements panel, which grows with the page", () => {
    expect(line(a().connect("A", "B")).stroke).toEqual({ color: "#0e1318", width: 4, style: "solid", cap: "round" });
    useEditor.setState(useEditor.getInitialState(), true);
    a().openDesign(createDesign({ width: 3000, height: 2000, pages: [createPage({ id: "p1", elements: [rect("A", 0, 0), rect("B", 300, 0)] })] }));
    expect(line(a().connect("A", "B")).stroke.width).toBe(12);
  });

  it("uses the sides that were asked for", () => {
    const id = a().connect("A", "B", { fromAnchor: "bottom", toAnchor: "top" });
    expect(line(id).start).toEqual({ elementId: "A", anchor: "bottom" });
    expect(line(id).end).toEqual({ elementId: "B", anchor: "top" });
    near(lineEndpoints(line(id)).start, 50, 50);
    near(lineEndpoints(line(id)).end, 350, 0);
  });

  it("is one step of history", () => {
    const id = a().connect("A", "B");
    expect(s().past).toHaveLength(1);
    a().undo();
    expect(ids()).toEqual(["A", "B"]);
    a().redo();
    expect(ids()).toEqual(["A", "B", id]);
  });

  it("joins a text to a shape just the same", () => {
    open([createText({ id: "T", x: 0, y: 0 }), rect("B", 400, 300)]);
    const id = a().connect("T", "B");
    expect(line(id).start?.elementId).toBe("T");
  });

  it("does nothing for what cannot be joined: the same shape twice, a shape that is not there, a line, a shape inside a group", () => {
    open([rect("A", 0, 0), rect("B", 300, 0), createLine({ id: "L" }), createGroup([rect("in", 0, 300)], { id: "G", x: 0, y: 300, width: 100, height: 50 })]);
    const before = s().design;
    for (const [from, to] of [
      ["A", "A"],
      ["A", "NOPE"],
      ["NOPE", "B"],
      ["A", "L"],
      ["L", "B"],
      ["A", "in"],
    ]) {
      expect(a().connect(from, to)).toBe("");
    }
    expect(s().design).toBe(before);
    expect(s().past).toEqual([]);
  });

  it("can join a group as a whole", () => {
    open([rect("A", 0, 0), createGroup([rect("in", 0, 0)], { id: "G", x: 300, y: 0, width: 100, height: 50 })]);
    expect(a().connect("A", "G")).not.toBe("");
  });

  it("does nothing while the document is only being viewed", () => {
    a().setMode("view");
    expect(a().connect("A", "B")).toBe("");
    expect(ids()).toEqual(["A", "B"]);
  });

  it("only joins shapes of the open page", () => {
    const other = a().addPage({ page: createPage({ elements: [rect("X", 0, 0)] }) });
    a().setActivePage(other);
    const [x] = page().elements.map((e) => e.id);
    expect(a().connect(x, "A")).toBe("");
  });
});

describe("a line that is attached", () => {
  let lineId = "";
  beforeEach(() => {
    lineId = a().connect("A", "B");
    a().select([]);
  });

  it("follows a shape that moves, in the same step of undo", () => {
    const steps = s().past.length;
    a().updateElements(["B"], { x: 300, y: 200 });
    expect(s().past).toHaveLength(steps + 1);
    near(lineEndpoints(line(lineId)).start, 50, 50);
    near(lineEndpoints(line(lineId)).end, 350, 200);
    a().undo();
    near(lineEndpoints(line(lineId)).start, 100, 25);
    near(lineEndpoints(line(lineId)).end, 300, 25);
    expect(el("B")).toMatchObject({ x: 300, y: 0 });
  });

  it("follows a shape that is nudged, resized or turned", () => {
    a().select(["B"]);
    a().nudge(0, 100);
    near(lineEndpoints(line(lineId)).end, 300, 125); // the left side of B, which is now 100 lower
    a().updateElements(["B"], { width: 200, y: 0 });
    near(lineEndpoints(line(lineId)).end, 300, 25);
    a().updateElements(["B"], { rotation: 90 });
    near(lineEndpoints(line(lineId)).end, 375, 25); // 200 wide and 50 tall about (400, 25), turned: its left edge is at 375
  });

  it("stays attached when it is moved together with its shapes", () => {
    a().select(["A", "B", lineId]);
    a().nudge(50, 80);
    expect(line(lineId).start).toEqual({ elementId: "A", anchor: "auto" });
    expect(line(lineId).end).toEqual({ elementId: "B", anchor: "auto" });
    near(lineEndpoints(line(lineId)).start, 150, 105);
    near(lineEndpoints(line(lineId)).end, 350, 105);
  });

  it("stays attached, and stretches, when it is moved with only one of its shapes", () => {
    a().select(["A", lineId]);
    a().nudge(0, 200);
    expect(line(lineId).start).not.toBeNull();
    expect(line(lineId).end).not.toBeNull();
    near(lineEndpoints(line(lineId)).start, 50, 200); // A is now lower than B, so the line leaves from the top of A
    near(lineEndpoints(line(lineId)).end, 350, 50); // and arrives at the bottom of B
  });

  it("follows a text that grows", () => {
    open([createText({ id: "T", x: 0, y: 0, fontSize: 20 }), rect("B", 700, 0)]);
    const id = a().connect("T", "B");
    const small = lineEndpoints(line(id)).start;
    a().updateElements(["T"], { fontSize: 120 });
    const t = el("T");
    expect(t.width).toBeGreaterThan(0);
    // the line starts at the right-hand side of the text, wherever that is now
    near(lineEndpoints(line(id)).start, t.x + t.width, t.y + t.height / 2);
    expect(lineEndpoints(line(id)).start.x).toBeGreaterThan(small.x);
  });

  it("leaves a shape that is dragged a little at a time (one transaction) attached at the end", () => {
    a().beginTransaction();
    for (let i = 1; i <= 5; i++) a().updateElements(["B"], { y: i * 40 });
    a().endTransaction();
    expect(s().past).toHaveLength(2); // the connect and the drag
    near(lineEndpoints(line(lineId)).end, 350, 200);
    a().undo();
    near(lineEndpoints(line(lineId)).end, 300, 25);
  });

  it("goes with a shape that is deleted, and comes back with it on undo, in one step", () => {
    const steps = s().past.length;
    a().deleteElements(["B"]);
    expect(ids()).toEqual(["A"]);
    expect(s().past).toHaveLength(steps + 1);
    a().undo();
    expect(ids()).toEqual(["A", "B", lineId]);
    near(lineEndpoints(line(lineId)).end, 300, 25);
    a().redo();
    expect(ids()).toEqual(["A"]);
  });

  it("does not take the shapes along when it is deleted itself", () => {
    a().deleteElements([lineId]);
    expect(ids()).toEqual(["A", "B"]);
  });

  it("is let go of by a person who moves it by hand, and then stays where it was put", () => {
    const l = line(lineId);
    a().updateElements([lineId], { x: l.x + 40, y: l.y + 40 });
    expect(line(lineId).start).toBeNull();
    expect(line(lineId).end).toBeNull();
    const placed = { x: line(lineId).x, y: line(lineId).y };
    a().updateElements(["B"], { y: 300 });
    expect(line(lineId)).toMatchObject(placed);
  });

  it("keeps its attachment while a locked shape stays where it is", () => {
    a().setLocked(["B"], true);
    a().updateElements(["B"], { x: 600 }); // refused: it is locked
    near(lineEndpoints(line(lineId)).end, 300, 25);
    expect(line(lineId).end).not.toBeNull();
  });

  it("lets go of a shape that is put in a group, instead of vanishing, and keeps the other end", () => {
    open([rect("A", 0, 0), rect("B", 300, 0), rect("C", 600, 300)]);
    const id = a().connect("A", "B");
    a().select(["B", "C"]);
    a().groupSelection();
    expect(ids()).toContain(id);
    expect(line(id).end).toBeNull();
    expect(line(id).start).toEqual({ elementId: "A", anchor: "auto" });
  });

  it("is still there when a shape is made into another with Combine: the line goes to the new shape", () => {
    open([rect("A", 0, 0), rect("B", 300, 0), rect("C", 300, 300)]);
    const id = a().connect("A", "B");
    const made = a().replaceElements(["B", "C"], rect("made", 280, 0, 120, 380));
    expect(ids()).toEqual(["A", made, id]);
    expect(line(id).end).toEqual({ elementId: made, anchor: "auto" });
    near(lineEndpoints(line(id)).start, 50, 50); // A now looks down at the new shape
    near(lineEndpoints(line(id)).end, 280, 190); // the middle of the left side of the new shape
  });

  it("is removed when both of its shapes are made into one", () => {
    open([rect("A", 0, 0), rect("B", 300, 0)]);
    const id = a().connect("A", "B");
    a().replaceElements(["A", "B"], rect("made", 0, 0, 400, 50));
    expect(ids()).not.toContain(id);
  });
});

describe("opening a design", () => {
  it("aims the lines at their shapes again, without calling the design changed", () => {
    const stale = createLine({ id: "L", x: 500, y: 500, width: 10, start: { elementId: "A", anchor: "auto" }, end: { elementId: "B", anchor: "auto" } });
    open([rect("A", 0, 0), rect("B", 300, 0), stale]);
    near(lineEndpoints(line("L")).start, 100, 25);
    near(lineEndpoints(line("L")).end, 300, 25);
    expect(s().saveState).toBe("saved");
    expect(s().past).toEqual([]);
  });

  it("lets go of an end whose shape is not on the page", () => {
    open([rect("A", 0, 0), createLine({ id: "L", start: { elementId: "A", anchor: "auto" }, end: { elementId: "GONE", anchor: "auto" } })]);
    expect(line("L").end).toBeNull();
    expect(line("L").start).toEqual({ elementId: "A", anchor: "auto" });
  });
});

describe("copies", () => {
  let lineId = "";
  beforeEach(() => {
    lineId = a().connect("A", "B");
  });

  it("duplicating a line with its shapes attaches the copy to the copied shapes", () => {
    a().select(["A", "B", lineId]);
    a().duplicateSelection();
    const created = s().selection;
    expect(created).toHaveLength(3);
    const [copyA, copyB, copyLine] = created.map((id) => el(id));
    expect((copyLine as LineElement).start).toEqual({ elementId: copyA.id, anchor: "auto" });
    expect((copyLine as LineElement).end).toEqual({ elementId: copyB.id, anchor: "auto" });
    // and the original is still attached to the original shapes
    expect(line(lineId).start?.elementId).toBe("A");
    expect(line(lineId).end?.elementId).toBe("B");
    near(lineEndpoints(copyLine as LineElement).start, 100 + 24, 25 + 24);
  });

  it("duplicating a line on its own gives a free line", () => {
    a().select([lineId]);
    a().duplicateSelection();
    const copy = el(s().selection[0]) as LineElement;
    expect(copy.start).toBeNull();
    expect(copy.end).toBeNull();
    expect(line(lineId).start).not.toBeNull();
  });

  it("duplicating one shape of a pair leaves the original line with the original", () => {
    a().select(["A"]);
    a().duplicateSelection();
    expect(page().elements.filter((e) => e.type === "line")).toHaveLength(1);
    expect(line(lineId).start?.elementId).toBe("A");
  });

  it("duplicating a group takes the lines inside it to the copy of what they joined", () => {
    open([rect("A", 0, 0), rect("B", 300, 0)]);
    const id = a().connect("A", "B");
    a().select(["A", "B", id]);
    a().groupSelection();
    const group = page().elements.find((e) => e.type === "group") as GroupElement;
    a().select([group.id]);
    a().duplicateSelection();
    const copy = el(s().selection[0]) as GroupElement;
    const inner = copy.children.filter((c) => c.type === "line") as LineElement[];
    const shapeIds = copy.children.filter((c) => c.type !== "line").map((c) => c.id);
    expect(inner).toHaveLength(1);
    expect(shapeIds).not.toContain("A");
    expect([inner[0].start?.elementId, inner[0].end?.elementId].sort()).toEqual([...shapeIds].sort());
  });

  it("copy and paste keeps the pasted line with the pasted shapes, and every paste is a new set", () => {
    a().select(["A", "B", lineId]);
    a().copy();
    a().paste();
    const first = s().selection;
    a().paste();
    const second = s().selection;
    for (const set of [first, second]) {
      const [pa, pb, pl] = set.map((id) => el(id));
      expect((pl as LineElement).start?.elementId).toBe(pa.id);
      expect((pl as LineElement).end?.elementId).toBe(pb.id);
    }
    expect(new Set([...first, ...second]).size).toBe(6);
    expect(line(lineId).start?.elementId).toBe("A");
  });

  it("pasting a line on its own gives a free line", () => {
    a().select([lineId]);
    a().copy();
    a().paste();
    const pasted = el(s().selection[0]) as LineElement;
    expect(pasted.start).toBeNull();
    expect(pasted.end).toBeNull();
  });

  it("cutting shapes and a line and pasting them back gives back an attached line", () => {
    a().select(["A", "B", lineId]);
    a().cut();
    expect(ids()).toEqual([]);
    a().paste();
    const [pa, pb, pl] = s().selection.map((id) => el(id));
    expect((pl as LineElement).start?.elementId).toBe(pa.id);
    expect((pl as LineElement).end?.elementId).toBe(pb.id);
  });

  it("a copied page has its lines attached to its own shapes", () => {
    a().duplicatePage();
    const [first, second] = s().design!.pages;
    const ownIds = new Set(second.elements.map((e) => e.id));
    const copied = second.elements.find((e) => e.type === "line") as LineElement;
    expect(ownIds.has(copied.start!.elementId)).toBe(true);
    expect(ownIds.has(copied.end!.elementId)).toBe(true);
    expect(first.elements.some((e) => e.id === copied.start!.elementId)).toBe(false);
  });

  it("a page added from a template has its lines attached to its own shapes", () => {
    const template = createPage({
      id: "tp",
      elements: [rect("ta", 0, 0), rect("tb", 300, 0), createLine({ id: "tl", start: { elementId: "ta", anchor: "auto" }, end: { elementId: "tb", anchor: "auto" } })],
    });
    const added = a().addPage({ page: template });
    const added2 = pageOf(s().design, added)!;
    const own = new Set(added2.elements.map((e) => e.id));
    const l = added2.elements.find((e) => e.type === "line") as LineElement;
    expect(own.has(l.start!.elementId)).toBe(true);
    expect(own.has(l.end!.elementId)).toBe(true);
    expect(own.has("ta")).toBe(false);
  });

  it("inserting elements keeps their lines with each other", () => {
    const set = [rect("X", 0, 0), rect("Y", 300, 0), createLine({ id: "XY", start: { elementId: "X", anchor: "auto" }, end: { elementId: "Y", anchor: "auto" } })];
    const added = a().addElements(set);
    const [ax, ay, al] = added.map((id) => el(id));
    expect((al as LineElement).start?.elementId).toBe(ax.id);
    expect((al as LineElement).end?.elementId).toBe(ay.id);
  });
});

describe("restoring an earlier version", () => {
  it("brings back the lines as they were", () => {
    const id = a().connect("A", "B");
    const saved = s().design!;
    a().updateElements(["B"], { y: 300 });
    a().replaceDesign(saved);
    near(lineEndpoints(line(id)).end, 300, 25);
    expect(line(id).end?.elementId).toBe("B");
  });
});

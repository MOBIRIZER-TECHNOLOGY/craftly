/**
 * Lines that are attached to shapes: where an attachment point is on a box (turned or not), how a straight line is described by its
 * two ends, and what has to happen to the lines when shapes move, go away or are copied.
 */
import { describe, expect, it } from "vitest";
import { anchorPoint, bestSide, connectable, connectedEnds, lineEndpoints, lineFromPoints, rebindClones, reflowLines, retargetLines } from "./connectors";
import { createDesign, createGroup, createLine, createPage, createShape, createText } from "./factory";
import { flipElements } from "./ops";
import type { Design, DesignElement, GroupElement, LineElement, Point } from "./types";

const near = (p: Point, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

const box = (x = 10, y = 20, width = 100, height = 50, rotation = 0) => ({ x, y, width, height, rotation });

describe("anchorPoint", () => {
  it("is the middle of the side of the box", () => {
    const b = box();
    near(anchorPoint(b, "top"), 60, 20);
    near(anchorPoint(b, "right"), 110, 45);
    near(anchorPoint(b, "bottom"), 60, 70);
    near(anchorPoint(b, "left"), 10, 45);
  });

  it("turns with the box, about its centre", () => {
    const b = box(10, 20, 100, 50, 90); // centre (60, 45)
    near(anchorPoint(b, "top"), 85, 45);
    near(anchorPoint(b, "right"), 60, 95);
    near(anchorPoint(b, "left"), 60, -5);
  });
});

describe("bestSide", () => {
  it("faces the point: the side that the point is furthest along, in proportion to the size of the box", () => {
    const wide = box(0, 0, 200, 50); // centre (100, 25)
    expect(bestSide(wide, { x: 400, y: 30 })).toBe("right");
    expect(bestSide(wide, { x: -300, y: 30 })).toBe("left");
    expect(bestSide(wide, { x: 100, y: -200 })).toBe("top");
    expect(bestSide(wide, { x: 100, y: 300 })).toBe("bottom");
    // 50 across but 35 down is far in terms of a box that is only 50 tall
    expect(bestSide(wide, { x: 150, y: 60 })).toBe("bottom");
  });

  it("looks at the point from the box's own turn", () => {
    const turned = box(0, 0, 200, 50, 90); // centre (100, 25): what was its right side now faces down
    expect(bestSide(turned, { x: 100, y: 400 })).toBe("right");
    expect(bestSide(turned, { x: 400, y: 25 })).toBe("top"); // a quarter turn takes the top side round to the right
  });

  it("takes the top when the point is the centre", () => {
    expect(bestSide(box(), { x: 60, y: 45 })).toBe("top");
  });
});

describe("a straight line and its two ends", () => {
  it("runs from (x, y) to (x + width, y) before it is turned about its middle", () => {
    expect(lineFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 0, rotation: 0 });
    const down = lineFromPoints({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(down).toMatchObject({ x: -50, y: 50, width: 100, height: 0 });
    expect(down.rotation).toBeCloseTo(90, 9);
  });

  it("gives the same two ends back, in every direction", () => {
    for (const [a, b] of [
      [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
      ],
      [
        { x: 10, y: 20 },
        { x: 10, y: 220 },
      ],
      [
        { x: 300, y: 300 },
        { x: 100, y: 100 },
      ],
      [
        { x: -50, y: 40 },
        { x: 30, y: -70 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
    ] as Array<[Point, Point]>) {
      const line = createLine({ ...lineFromPoints(a, b) }) as LineElement;
      const ends = lineEndpoints(line);
      near(ends.start, a.x, a.y);
      near(ends.end, b.x, b.y);
    }
  });
});

describe("connectedEnds", () => {
  const left = box(0, 0, 100, 50);
  const right = box(300, 0, 100, 50);

  it("joins the sides that face each other when both ends choose for themselves", () => {
    const { start, end } = connectedEnds({ start: { frame: left, anchor: "auto" }, end: { frame: right, anchor: "auto" } });
    near(start, 100, 25);
    near(end, 300, 25);
  });

  it("uses the side that was asked for", () => {
    const { start, end } = connectedEnds({ start: { frame: left, anchor: "bottom" }, end: { frame: right, anchor: "top" } });
    near(start, 50, 50);
    near(end, 350, 0);
  });

  it("faces the middle of the other box, not its corner", () => {
    const above = box(0, 0, 100, 50); // middle (50, 25)
    const wide = box(-300, 60, 700, 50); // its corner is far to the left, its middle is right below the box above
    const { start, end } = connectedEnds({ start: { frame: above, anchor: "auto" }, end: { frame: wide, anchor: "auto" } });
    near(start, 50, 50);
    near(end, 50, 60);
  });

  it("leaves a free end where it is, and faces the box towards it", () => {
    const { start, end } = connectedEnds({ start: { frame: left, anchor: "auto" }, end: { point: { x: 100, y: 400 } } });
    near(start, 50, 50); // bottom
    near(end, 100, 400);
  });
});

const designOf = (...elements: DesignElement[]): Design => {
  const base = createDesign({ title: "t", width: 1000, height: 600, pages: [createPage({ id: "p", elements })] });
  return base;
};
const rect = (id: string, x: number, y: number, w = 100, h = 50, extra: Partial<ReturnType<typeof createShape>> = {}) =>
  createShape("rect", { id, x, y, width: w, height: h, ...extra });
const bound = (id: string, from: string, to: string, extra: Partial<LineElement> = {}): LineElement =>
  createLine({ id, start: { elementId: from, anchor: "auto" }, end: { elementId: to, anchor: "auto" }, ...extra }) as LineElement;
const withElements = (design: Design, elements: Design["pages"][number]["elements"]): Design => ({ ...design, pages: [{ ...design.pages[0], elements }] });
const lineIn = (design: Design, id = "L") => design.pages[0].elements.find((e) => e.id === id) as LineElement | undefined;

/** a design whose line has been aimed at its two shapes, the way the editor leaves it */
function connectedDesign() {
  const a = rect("A", 0, 0);
  const b = rect("B", 300, 0);
  const draft = designOf(a, b, bound("L", "A", "B"));
  return reflowLines(draft, null);
}

describe("reflowLines", () => {
  it("aims a new line at the shapes it is attached to", () => {
    const design = connectedDesign();
    const ends = lineEndpoints(lineIn(design)!);
    near(ends.start, 100, 25);
    near(ends.end, 300, 25);
  });

  it("moves the line with a shape that moves", () => {
    const before = connectedDesign();
    const moved = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "B" ? { ...e, x: 300, y: 200 } : e)),
    );
    const after = reflowLines(moved, before);
    const ends = lineEndpoints(lineIn(after)!);
    near(ends.start, 50, 50); // the box A now looks down at B
    near(ends.end, 350, 200);
    expect(lineIn(after)!.start).toEqual({ elementId: "A", anchor: "auto" });
  });

  it("follows a shape that is turned or made bigger", () => {
    const before = connectedDesign();
    const bigger = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "B" ? { ...e, width: 200, rotation: 0 } : e)),
    );
    near(lineEndpoints(lineIn(reflowLines(bigger, before))!).end, 300, 25);
    const turned = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "B" ? { ...e, rotation: 90 } : e)),
    );
    // the box is now 50 wide and 100 tall about the same centre (350, 25): the side that faces A is at x 325
    near(lineEndpoints(lineIn(reflowLines(turned, before))!).end, 325, 25);
  });

  it("changes nothing when nothing that the line is attached to changed", () => {
    const before = connectedDesign();
    const other = withElements(before, [...before.pages[0].elements, rect("Z", 500, 500)]);
    expect(reflowLines(other, before)).toBe(other);
    const textChanged = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "A" && e.type === "shape" ? { ...e } : e)),
    );
    // A is a new object with the same box: the line is aimed again at the same place, and the design is the same one
    const same = reflowLines(textChanged, before);
    expect(lineIn(same)).toBe(lineIn(textChanged));
  });

  it("removes a line when the shape that it was attached to is gone", () => {
    const before = connectedDesign();
    const gone = withElements(
      before,
      before.pages[0].elements.filter((e) => e.id !== "B"),
    );
    const after = reflowLines(gone, before);
    expect(after.pages[0].elements.map((e) => e.id)).toEqual(["A"]);
  });

  it("keeps a line whose shape is not here and was not here before, as a free line", () => {
    const design = designOf(rect("A", 0, 0), bound("L", "A", "NOPE"));
    const after = reflowLines(design, null);
    expect(lineIn(after)!.start).toEqual({ elementId: "A", anchor: "auto" });
    expect(lineIn(after)!.end).toBeNull();
    expect(after.pages[0].elements).toHaveLength(2);
  });

  it("keeps the arrow running from its first shape to its second when both are flipped with it", () => {
    const before = connectedDesign();
    const flipped = structuredClone(before);
    flipElements(flipped.pages[0], ["A", "B", "L"], "horizontal");
    const after = reflowLines(flipped, before);
    const line = lineIn(after)!;
    expect([line.start?.elementId, line.end?.elementId]).toEqual(["A", "B"]);
    // A is now on the right (300..400) and B on the left (0..100): the arrow starts at A's left side and ends at B's right side
    const ends = lineEndpoints(line);
    near(ends.start, 300, 25);
    near(ends.end, 100, 25);
  });

  it("aims a mirrored line again without its mirror, so that its start is drawn where it was aimed", () => {
    const before = connectedDesign();
    const flipped = structuredClone(before);
    flipElements(flipped.pages[0], ["A", "B", "L"], "horizontal");
    const moved = withElements(
      flipped,
      flipped.pages[0].elements.map((e) => (e.id === "B" ? { ...e, y: e.y + 200 } : e)),
    );
    const line = lineIn(reflowLines(moved, flipped))!;
    expect(line.flipH).toBe(false);
    near(lineEndpoints(line).start, 350, 50); // A's bottom, facing B below it
    near(lineEndpoints(line).end, 50, 200); // B's top
  });

  it("finds the ends of a line mirrored left to right where they are drawn", () => {
    const ends = lineEndpoints({ x: 0, y: 10, width: 100, height: 0, rotation: 0, flipH: true });
    near(ends.start, 100, 10);
    near(ends.end, 0, 10);
  });

  it("detaches a line that the person moved by hand, and leaves it where they put it", () => {
    const before = connectedDesign();
    const dragged = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "L" ? { ...e, x: e.x + 40, y: e.y + 40 } : e)),
    );
    const after = reflowLines(dragged, before);
    expect(lineIn(after)!.start).toBeNull();
    expect(lineIn(after)!.end).toBeNull();
    expect(lineIn(after)!.x).toBe(lineIn(dragged)!.x);
  });

  it("keeps a line attached that was changed together with a shape that it is attached to, and aims it at the shape", () => {
    const before = connectedDesign();
    const together = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "B" || e.id === "L" ? { ...e, y: e.y + 200 } : e)),
    );
    const after = reflowLines(together, before);
    expect(lineIn(after)!.end).toEqual({ elementId: "B", anchor: "auto" });
    near(lineEndpoints(lineIn(after)!).end, 350, 200); // the top of B, which has moved
  });

  it("aims a line again when its attachments were changed, instead of taking that for a move by hand", () => {
    const before = connectedDesign();
    const rebound = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "L" && e.type === "line" ? { ...e, start: { elementId: "A", anchor: "top" as const } } : e)),
    );
    const after = reflowLines(rebound, before);
    expect(lineIn(after)!.start).toEqual({ elementId: "A", anchor: "top" });
    near(lineEndpoints(lineIn(after)!).start, 50, 0);
  });

  it("leaves the free end of a line where it was while the attached end follows", () => {
    const a = rect("A", 0, 0);
    const line = createLine({ id: "L", ...lineFromPoints({ x: 100, y: 25 }, { x: 500, y: 25 }), start: { elementId: "A", anchor: "auto" }, end: null }) as LineElement;
    const before = designOf(a, line);
    const moved = withElements(
      before,
      before.pages[0].elements.map((e) => (e.id === "A" ? { ...e, y: 100 } : e)),
    );
    const ends = lineEndpoints(lineIn(reflowLines(moved, before))!);
    near(ends.end, 500, 25);
    expect(ends.start.y).toBeGreaterThan(100); // the start now faces the free end from the shape's new place
  });

  it("does not attach a line to another line or to nothing of this page", () => {
    const design = designOf(rect("A", 0, 0), createLine({ id: "M" }), bound("L", "A", "M"));
    const after = reflowLines(design, null);
    expect(lineIn(after)!.end).toBeNull();
  });

  it("takes no notice of designs without attached lines", () => {
    const design = designOf(rect("A", 0, 0), createLine({ id: "L" }));
    expect(reflowLines(design, design)).toBe(design);
    expect(reflowLines(design, null)).toBe(design);
  });

  it("works page by page", () => {
    const base = connectedDesign();
    const second = { ...base.pages[0], id: "q", elements: [rect("A", 0, 0)] };
    const two = { ...base, pages: [base.pages[0], second] };
    expect(reflowLines(two, two)).toBe(two);
  });

  it("leaves a page as it is when it is the page it was, and works out the pages that are not", () => {
    const stale = designOf(rect("A", 0, 0), rect("B", 300, 0), bound("L", "A", "B", { x: 900, y: 500 }));
    expect(reflowLines(stale, stale)).toBe(stale);
    // the same page in a design that is another object: nothing changed on it either
    expect(reflowLines({ ...stale }, stale).pages[0]).toBe(stale.pages[0]);
    // but a page that is not in the design as it was is looked at
    expect(lineEndpoints(lineIn(reflowLines(stale, null))!).start.x).toBeCloseTo(100, 6);
  });

  it("aims a line again that is not where its shapes are, even when nothing about it changed", () => {
    const stale = designOf(rect("A", 0, 0), rect("B", 300, 0), bound("L", "A", "B", { x: 900, y: 500 }));
    const elsewhere = withElements(stale, [...stale.pages[0].elements, rect("Z", 500, 500)]);
    near(lineEndpoints(lineIn(reflowLines(elsewhere, stale))!).start, 100, 25);
  });

  it("keeps a line that was attached to another line (which is not a thing) when that line goes", () => {
    const before = designOf(rect("A", 0, 0), createLine({ id: "M" }), bound("L", "A", "M")); // as a file could hold it: no reflow has seen it
    const after = reflowLines(withElements(before, [before.pages[0].elements[0], before.pages[0].elements[2]]), before);
    expect(after.pages[0].elements.map((e) => e.id)).toEqual(["A", "L"]);
    expect(lineIn(after)!.end).toBeNull();
  });

  it("lets go of a shape that has been put in a group, instead of taking the line with it", () => {
    const before = connectedDesign();
    const b = before.pages[0].elements.find((e) => e.id === "B")!;
    const grouped = withElements(before, [
      before.pages[0].elements[0],
      createGroup([{ ...b, x: 0, y: 0 }], { id: "G", x: 300, y: 0, width: 100, height: 50 }),
      before.pages[0].elements[2],
    ]);
    const after = reflowLines(grouped, before);
    expect(after.pages[0].elements.map((e) => e.id)).toEqual(["A", "G", "L"]);
    expect(lineIn(after)!.end).toBeNull();
    expect(lineIn(after)!.start).toEqual({ elementId: "A", anchor: "auto" });
    // the free end stays where the line had it: the middle of the side that B was at
    near(lineEndpoints(lineIn(after)!).end, 300, 25);
  });

  it("leaves the lines inside a group alone, they move with the group", () => {
    const inner = bound("L", "A", "B", { x: 900, y: 500 });
    const design = designOf(createGroup([rect("A", 0, 0), rect("B", 300, 0), inner], { id: "G", x: 0, y: 0, width: 400, height: 50 }));
    expect(reflowLines(design, null)).toBe(design);
  });

  it("aims a line again that comes out of a group, at the shapes that are on the page", () => {
    const group = createGroup([rect("A", 0, 0), rect("B", 300, 0), bound("L", "A", "B", { x: 900, y: 500 })], { id: "G", x: 0, y: 0, width: 400, height: 50 });
    const before = designOf(group);
    const out = withElements(before, group.children);
    near(lineEndpoints(lineIn(reflowLines(out, before))!).start, 100, 25);
  });
});

describe("rebindClones", () => {
  it("attaches the copy of a line to the copies of its shapes, and cuts it loose from shapes that were not copied", () => {
    const a = rect("A", 0, 0);
    const b = rect("B", 300, 0);
    const line = bound("L", "A", "B", { start: { elementId: "A", anchor: "bottom" }, end: { elementId: "B", anchor: "left" } });
    const copies = [
      { ...a, id: "A2" },
      { ...b, id: "B2" },
      { ...line, id: "L2" },
    ];
    rebindClones([a, b, line], copies);
    const l2 = copies[2] as LineElement;
    expect(l2.start).toEqual({ elementId: "A2", anchor: "bottom" }); // the sides that were chosen stay
    expect(l2.end).toEqual({ elementId: "B2", anchor: "left" });

    const lone = [{ ...line, id: "L3" }];
    rebindClones([line], lone);
    expect((lone[0] as LineElement).start).toBeNull();
    expect((lone[0] as LineElement).end).toBeNull();
  });

  it("copes with lines that are not attached to anything, and with elements that are not lines", () => {
    const plain = createLine({ id: "P" });
    const copies = [
      { ...plain, id: "P2" },
      { ...createText({ id: "T" }), id: "T2" },
    ];
    rebindClones([plain, createText({ id: "T" })], copies);
    expect((copies[0] as LineElement).start ?? null).toBeNull();
  });

  it("reaches into groups: a line inside a copied group goes to the copies inside it, and one outside to the copy of what it joined", () => {
    const a = rect("A", 0, 0);
    const b = rect("B", 300, 0);
    const inside = bound("L", "A", "B");
    const group = createGroup([a, b, inside], { id: "G" }) as GroupElement;
    const outside = rect("O", 0, 300);
    const toGroupMember = bound("M", "O", "A"); // joins something outside the group to something inside it
    const copy = createGroup(
      [
        { ...a, id: "A2" },
        { ...b, id: "B2" },
        { ...inside, id: "L2" },
      ],
      { id: "G2" },
    ) as GroupElement;
    const copies = [copy, { ...outside, id: "O2" }, { ...toGroupMember, id: "M2" }] as DesignElement[];
    rebindClones([group, outside, toGroupMember], copies);
    const l2 = copy.children[2] as LineElement;
    expect(l2.start).toEqual({ elementId: "A2", anchor: "auto" });
    expect(l2.end).toEqual({ elementId: "B2", anchor: "auto" });
    const m2 = copies[2] as LineElement;
    expect(m2.start).toEqual({ elementId: "O2", anchor: "auto" });
    expect(m2.end).toEqual({ elementId: "A2", anchor: "auto" });
  });

  it("cuts a line loose from a shape that was not copied along with it", () => {
    const a = rect("A", 0, 0);
    const line = bound("L", "A", "ELSEWHERE");
    const copies = [
      { ...a, id: "A2" },
      { ...line, id: "L2" },
    ] as DesignElement[];
    rebindClones([a, line], copies);
    expect((copies[1] as LineElement).start).toEqual({ elementId: "A2", anchor: "auto" });
    expect((copies[1] as LineElement).end).toBeNull();
  });
});

describe("connectable", () => {
  const page = designOf(rect("A", 0, 0), rect("B", 300, 0), createLine({ id: "L" }), createGroup([rect("in", 0, 300)], { id: "G", x: 0, y: 300, width: 100, height: 50 })).pages[0];

  it("gives the two elements back, in the order that was asked for", () => {
    expect(connectable(page, ["B", "A"])?.map((e) => e.id)).toEqual(["B", "A"]);
    expect(connectable(page, ["A", "G"])?.map((e) => e.id)).toEqual(["A", "G"]); // a group as a whole can be joined
  });

  it("is null unless there are exactly two different elements of the page itself that are not lines", () => {
    expect(connectable(page, [])).toBeNull();
    expect(connectable(page, ["A"])).toBeNull();
    expect(connectable(page, ["A", "B", "G"])).toBeNull();
    expect(connectable(page, ["A", "A"])).toBeNull();
    expect(connectable(page, ["A", "NOPE"])).toBeNull();
    expect(connectable(page, ["A", "L"])).toBeNull();
    expect(connectable(page, ["L", "A"])).toBeNull();
    expect(connectable(page, ["A", "in"])).toBeNull(); // inside a group
    expect(connectable(null, ["A", "B"])).toBeNull();
  });
});

describe("retargetLines", () => {
  it("attaches the lines of replaced elements to the element that takes their place, keeping the sides that were chosen", () => {
    const elements: DesignElement[] = [rect("A", 0, 0), rect("made", 300, 0), bound("L", "A", "B", { end: { elementId: "B", anchor: "left" } }), bound("K", "C", "A")];
    retargetLines(elements, ["B", "C"], "made");
    expect((elements[2] as LineElement).end).toEqual({ elementId: "made", anchor: "left" });
    expect((elements[2] as LineElement).start).toEqual({ elementId: "A", anchor: "auto" });
    expect((elements[3] as LineElement).start).toEqual({ elementId: "made", anchor: "auto" });
  });

  it("removes a line that is left joining the new element to itself", () => {
    const elements: DesignElement[] = [rect("made", 0, 0), bound("L", "B", "C"), bound("K", "made", "B"), bound("J", "A", "made")];
    retargetLines(elements, ["B", "C"], "made");
    expect(elements.map((e) => e.id)).toEqual(["made", "J"]);
  });

  it("reaches lines inside groups and leaves unrelated lines alone", () => {
    const inner = bound("L", "B", "A");
    const unrelated = bound("U", "A", "Z");
    const group = createGroup([rect("A", 0, 0), inner, bound("S", "B", "C")], { id: "G" }) as GroupElement;
    const elements: DesignElement[] = [group, unrelated];
    retargetLines(elements, ["B", "C"], "made");
    expect(group.children.map((c) => c.id)).toEqual(["A", "L"]);
    expect(inner.start).toEqual({ elementId: "made", anchor: "auto" });
    expect(unrelated.start).toEqual({ elementId: "A", anchor: "auto" });
    expect(unrelated.end).toEqual({ elementId: "Z", anchor: "auto" });
  });

  it("does nothing when nothing was replaced", () => {
    const line = bound("L", "A", "B");
    const elements: DesignElement[] = [rect("A", 0, 0), line];
    retargetLines(elements, [], "made");
    expect(line.start).toEqual({ elementId: "A", anchor: "auto" });
    expect(elements).toHaveLength(2);
  });
});

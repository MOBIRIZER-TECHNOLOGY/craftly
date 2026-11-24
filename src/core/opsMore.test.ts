import { describe, expect, it } from "vitest";
import { createChart, createDesign, createGroup, createImage, createLine, createPage, createShape, createTable, createText } from "./factory";
import {
  alignElements,
  applyTextProps,
  canArrange,
  clonePageWithIds,
  distributeElements,
  duplicateElements,
  findElement,
  flatten,
  flipElements,
  groupElements,
  insertPage,
  locate,
  movePage,
  moveBy,
  moveToIndex,
  normalizeParagraphs,
  patchElements,
  removeElements,
  removePage,
  reorder,
  resizeDesign,
  scaleElement,
  topLevelIds,
  ungroup,
  walk,
} from "./ops";
import type { DesignElement, GroupElement, ImageElement, LineElement, Page, ShapeElement, TableElement, TextElement } from "./types";

const rect = (id: string, x: number, y: number, w = 40, h = 40, over: Partial<ShapeElement> = {}) => createShape("rect", { id, x, y, width: w, height: h, ...over });
const pageOf = (...elements: DesignElement[]): Page => createPage({ elements });
const ids = (p: Page) => p.elements.map((e) => e.id);

describe("lookup", () => {
  it("finds an element at any depth with its list, index and parent", () => {
    const inner = rect("inner", 0, 0);
    const group = createGroup([rect("a", 0, 0), inner], { id: "g" });
    const page = pageOf(rect("top", 0, 0), group);
    const hit = locate(page.elements, "inner")!;
    expect(hit.el).toBe(inner);
    expect(hit.index).toBe(1);
    expect(hit.list).toBe(group.children);
    expect(hit.parent).toBe(group);
    expect(locate(page.elements, "top")!.parent).toBeNull();
    expect(locate(page.elements, "missing")).toBeNull();
    expect(findElement(page, "missing")).toBeNull();
  });

  it("walks and flattens groups depth first", () => {
    const page = pageOf(createGroup([rect("a", 0, 0), createGroup([rect("b", 0, 0)], { id: "g2" })], { id: "g1" }), rect("c", 0, 0));
    expect(flatten(page.elements).map((e) => e.id)).toEqual(["g1", "a", "g2", "b", "c"]);
    const parents: Array<string | null> = [];
    walk(page.elements, (_el, parent) => parents.push(parent?.id ?? null));
    expect(parents).toEqual([null, "g1", "g1", "g2", null]);
  });

  it("drops ids that sit inside another selected id", () => {
    const page = pageOf(createGroup([rect("a", 0, 0), rect("b", 0, 0)], { id: "g" }), rect("c", 0, 0));
    expect(topLevelIds(page, ["g", "a", "c"])).toEqual(["g", "c"]);
    expect(topLevelIds(page, ["a", "b"])).toEqual(["a", "b"]);
    expect(topLevelIds(page, [])).toEqual([]);
  });
});

describe("removing and patching", () => {
  it("removes elements from any list and ignores unknown ids", () => {
    const page = pageOf(rect("a", 0, 0), createGroup([rect("b", 0, 0)], { id: "g" }));
    const removed = removeElements(page, ["a", "b", "nope"]);
    expect(removed.map((e) => e.id)).toEqual(["a", "b"]);
    expect(ids(page)).toEqual(["g"]);
  });

  it("applies a patch object or a function and skips unknown ids", () => {
    const page = pageOf(rect("a", 0, 0));
    patchElements(page, ["a", "nope"], { x: 9 });
    patchElements(page, ["a"], (el) => {
      el.y = 7;
    });
    expect([page.elements[0].x, page.elements[0].y]).toEqual([9, 7]);
  });

  it("lets a locked element change only its lock, visibility and name", () => {
    const page = pageOf(rect("a", 0, 0, 40, 40, { locked: true }));
    patchElements(page, ["a"], { x: 50 });
    patchElements(page, ["a"], (el) => {
      el.x = 60;
    });
    expect(page.elements[0].x).toBe(0);
    patchElements(page, ["a"], { hidden: true, name: "kept" });
    expect([page.elements[0].hidden, page.elements[0].name]).toEqual([true, "kept"]);
    // a patch that mixes allowed and forbidden changes is refused as a whole
    patchElements(page, ["a"], { locked: false, x: 5 });
    expect(page.elements[0].locked).toBe(true);
    expect(page.elements[0].x).toBe(0);
    patchElements(page, ["a"], { locked: false });
    patchElements(page, ["a"], { x: 5 });
    expect(page.elements[0].locked).toBe(false);
    expect(page.elements[0].x).toBe(5);
  });

  it("moves the top-level selection and leaves locked elements where they are", () => {
    const group = createGroup([rect("in", 0, 0)], { id: "g", x: 10, y: 10 });
    const page = pageOf(group, rect("free", 100, 0), rect("pinned", 200, 0, 40, 40, { locked: true }));
    moveBy(page, ["g", "in", "free", "pinned", "nope"], 5, 6);
    expect([group.x, group.y]).toEqual([15, 16]);
    expect(group.children[0].x).toBe(0);
    expect(page.elements[1].x).toBe(105);
    expect(page.elements[2].x).toBe(200);
  });
});

describe("z-order with unknown or edge ids", () => {
  it("ignores unknown ids when reordering", () => {
    const page = pageOf(rect("a", 0, 0), rect("b", 100, 0));
    reorder(page, ["nope"], "front");
    expect(ids(page)).toEqual(["a", "b"]);
  });

  it("reorders inside each group separately", () => {
    const group = createGroup([rect("x", 0, 0), rect("y", 50, 0), rect("z", 100, 0)], { id: "g" });
    const page = pageOf(rect("a", 0, 0), group);
    reorder(page, ["x", "a"], "front");
    expect(ids(page)).toEqual(["g", "a"]);
    expect(group.children.map((c) => c.id)).toEqual(["y", "z", "x"]);
  });

  it("knows which way an element can still move", () => {
    const page = pageOf(rect("a", 0, 0), rect("b", 50, 0), rect("c", 100, 0));
    expect(canArrange(page, ["a"], "forward")).toBe(true);
    expect(canArrange(page, ["a"], "front")).toBe(true);
    expect(canArrange(page, ["a"], "backward")).toBe(false);
    expect(canArrange(page, ["c"], "back")).toBe(true);
    expect(canArrange(page, ["c"], "front")).toBe(false);
    expect(canArrange(page, ["nope"], "front")).toBe(false);
    expect(canArrange(page, [], "front")).toBe(false);
  });

  it("clamps an index when moving and ignores unknown ids", () => {
    const page = pageOf(rect("a", 0, 0), rect("b", 50, 0), rect("c", 100, 0));
    moveToIndex(page, "a", 99);
    expect(ids(page)).toEqual(["b", "c", "a"]);
    moveToIndex(page, "a", -5);
    expect(ids(page)).toEqual(["a", "b", "c"]);
    moveToIndex(page, "nope", 1);
    expect(ids(page)).toEqual(["a", "b", "c"]);
  });
});

describe("grouping", () => {
  it("makes no group of fewer than two elements, or of elements from different lists", () => {
    const group = createGroup([rect("in", 0, 0), rect("in2", 50, 0)], { id: "g" });
    const page = pageOf(rect("a", 0, 0), group);
    expect(groupElements(page, ["a"])).toBeNull();
    expect(groupElements(page, ["a", "nope"])).toBeNull();
    expect(groupElements(page, ["a", "in"])).toBeNull();
    expect(ids(page)).toEqual(["a", "g"]);
  });

  it("puts a new group where its topmost member was and gives the children group-local coordinates", () => {
    const page = pageOf(rect("a", 100, 50), rect("b", 10, 10), rect("c", 300, 300), rect("d", 200, 100));
    const group = groupElements(page, ["a", "d"])!;
    expect(ids(page)).toEqual(["b", "c", group.id]);
    expect([group.x, group.y, group.width, group.height]).toEqual([100, 50, 140, 90]);
    expect(group.children.map((c) => [c.id, c.x, c.y])).toEqual([
      ["a", 0, 0],
      ["d", 100, 50],
    ]);
  });
});

describe("ungrouping", () => {
  const grouped = (over: Partial<GroupElement> = {}) => {
    const group = createGroup([rect("c1", 10, 20, 20, 20, { rotation: 10, opacity: 0.5 })], { id: "g", x: 100, y: 100, width: 100, height: 100, ...over });
    return { group, page: pageOf(group) };
  };

  it("does nothing for an element that is not a group, or does not exist", () => {
    const page = pageOf(rect("a", 0, 0));
    expect(ungroup(page, "a")).toEqual([]);
    expect(ungroup(page, "nope")).toEqual([]);
    expect(ids(page)).toEqual(["a"]);
  });

  it("gives the children page coordinates in the place of the group", () => {
    const { page } = grouped();
    const out = ungroup(page, "g");
    expect(out).toHaveLength(1);
    expect(ids(page)).toEqual(out);
    expect([page.elements[0].x, page.elements[0].y]).toEqual([110, 120]);
  });

  it("carries the rotation, opacity and lock of the group to the children", () => {
    const { page } = grouped({ rotation: 90, opacity: 0.5, locked: true });
    ungroup(page, "g");
    const child = page.elements[0];
    expect(child.rotation).toBe(100);
    expect(child.opacity).toBeCloseTo(0.25);
    expect(child.locked).toBe(true);
    // the child centre (120, 130) turned a quarter turn about the group centre (150, 150)
    expect(child.x + child.width / 2).toBeCloseTo(170);
    expect(child.y + child.height / 2).toBeCloseTo(120);
  });

  it("mirrors the children of a flipped group", () => {
    const { page } = grouped({ flipH: true, flipV: true });
    ungroup(page, "g");
    const child = page.elements[0];
    expect(child.flipH).toBe(true);
    expect(child.flipV).toBe(true);
    expect(child.x + child.width / 2).toBeCloseTo(180);
    expect(child.y + child.height / 2).toBeCloseTo(170);
  });
});

describe("align and distribute", () => {
  const set = () => pageOf(rect("a", 10, 10, 20, 20), rect("b", 100, 60, 40, 40), rect("c", 60, 200, 30, 30));
  const box = { x: 0, y: 0, w: 400, h: 300 };

  it.each([
    ["left", "x", [0, 0, 0]],
    ["center", "x", [190, 180, 185]],
    ["right", "x", [380, 360, 370]],
    ["top", "y", [0, 0, 0]],
    ["middle", "y", [140, 130, 135]],
    ["bottom", "y", [280, 260, 270]],
  ] as const)("aligns %s to the page", (mode, axis, expected) => {
    const page = set();
    alignElements(page, ["a", "b", "c"], mode, box);
    expect(page.elements.map((e) => e[axis])).toEqual(expected);
  });

  it("aligns to the bounds of the selection itself when there is no reference", () => {
    const page = set();
    alignElements(page, ["a", "b"], "left", null);
    expect(page.elements.map((e) => e.x)).toEqual([10, 10, 60]);
    alignElements(page, ["a", "b"], "bottom", null);
    expect(page.elements.slice(0, 2).map((e) => e.y + e.height)).toEqual([100, 100]);
  });

  it("leaves locked elements alone and does nothing when nothing is left", () => {
    const page = pageOf(rect("a", 10, 10, 20, 20, { locked: true }), rect("b", 50, 50));
    alignElements(page, ["a", "b"], "left", box);
    expect(page.elements.map((e) => e.x)).toEqual([10, 0]);
    const pinned = pageOf(rect("a", 10, 10, 20, 20, { locked: true }));
    alignElements(pinned, ["a", "nope"], "left", box);
    expect(pinned.elements[0].x).toBe(10);
  });

  it("spaces three elements evenly between the outer two", () => {
    const page = pageOf(rect("a", 0, 0, 20, 20), rect("b", 30, 0, 20, 20), rect("c", 200, 0, 20, 20));
    distributeElements(page, ["a", "b", "c"], "horizontal");
    expect(page.elements.map((e) => e.x)).toEqual([0, 100, 200]);
  });

  it("spaces elements down the page too, whatever order they were given in", () => {
    const page = pageOf(rect("c", 0, 300, 20, 20), rect("a", 0, 0, 20, 20), rect("b", 0, 50, 20, 40));
    distributeElements(page, ["a", "b", "c"], "vertical");
    expect(page.elements.map((e) => e.y)).toEqual([300, 0, 140]);
  });

  it("needs three movable elements", () => {
    const two = pageOf(rect("a", 0, 0), rect("b", 100, 0));
    distributeElements(two, ["a", "b"], "horizontal");
    expect(two.elements.map((e) => e.x)).toEqual([0, 100]);
    const locked = pageOf(rect("a", 0, 0), rect("b", 30, 0, 40, 40, { locked: true }), rect("c", 100, 0));
    distributeElements(locked, ["a", "b", "c"], "horizontal");
    expect(locked.elements.map((e) => e.x)).toEqual([0, 30, 100]);
  });
});

describe("duplicating and flipping", () => {
  it("clones above the originals, offset, unlocked and with new ids, per list", () => {
    const group = createGroup([rect("in", 0, 0)], { id: "g" });
    const page = pageOf(rect("a", 0, 0, 40, 40, { locked: true }), rect("b", 100, 0), group);
    const created = duplicateElements(page, ["a", "in", "nope", "b"], 10, 20);
    expect(created).toHaveLength(3);
    expect(page.elements).toHaveLength(5);
    // [a, b, copy of a, copy of b, group]: the copies stand above the last original of their list
    expect(page.elements[2].x).toBe(10);
    expect(page.elements[2].y).toBe(20);
    expect(page.elements[2].locked).toBe(false);
    expect(page.elements[3].x).toBe(110);
    expect(group.children).toHaveLength(2);
    expect(new Set(flatten(page.elements).map((e) => e.id)).size).toBe(flatten(page.elements).length);
  });

  it("clones a group with fresh ids for the children too", () => {
    const group = createGroup([rect("in", 0, 0)], { id: "g" });
    const page = pageOf(group);
    duplicateElements(page, ["g"]);
    const [original, copy] = page.elements as GroupElement[];
    expect(copy.id).not.toBe(original.id);
    expect(copy.children[0].id).not.toBe("in");
    expect([copy.x, copy.y]).toEqual([24, 24]);
  });

  it("mirrors the selection about its own middle, vertical flips too", () => {
    const page = pageOf(rect("a", 0, 0, 20, 20), rect("b", 80, 80, 20, 20));
    flipElements(page, ["a", "b"], "horizontal");
    expect(page.elements.map((e) => [e.x, e.flipH])).toEqual([
      [80, true],
      [0, true],
    ]);
    flipElements(page, ["a", "b"], "vertical");
    expect(page.elements.map((e) => [e.y, e.flipV])).toEqual([
      [80, true],
      [0, true],
    ]);
  });

  it("turns the rotation round when it mirrors an element", () => {
    const page = pageOf(rect("a", 0, 0, 20, 20, { rotation: 30 }));
    flipElements(page, ["a"], "horizontal");
    expect(page.elements[0].rotation).toBe(-30);
    flipElements(page, ["a"], "vertical");
    expect(page.elements[0].rotation).toBe(30);
  });

  it("flips nothing when everything selected is locked or missing", () => {
    const page = pageOf(rect("a", 5, 5, 20, 20, { locked: true }));
    flipElements(page, ["a", "nope"], "horizontal");
    expect(page.elements[0].flipH).toBeUndefined();
  });
});

describe("scaling", () => {
  it("scales position, size, shadow and blur", () => {
    const el = rect("a", 10, 20, 100, 50, { shadow: { color: "#000000", blur: 8, x: 4, y: 6 }, blur: 10 });
    scaleElement(el, 2, 4);
    expect([el.x, el.y, el.width, el.height]).toEqual([20, 80, 200, 200]);
    expect(el.shadow).toEqual({ color: "#000000", blur: 24, x: 8, y: 24 });
    expect(el.blur).toBe(30);
  });

  it("scales text sizes, including sizes set on a run", () => {
    const el = createText({ paragraphs: [{ runs: [{ text: "a", size: 10 }, { text: "b" }] }], fontSize: 20 });
    scaleElement(el, 2, 2);
    expect(el.fontSize).toBe(40);
    expect(el.paragraphs[0].runs.map((r) => r.size)).toEqual([20, undefined]);
  });

  it("scales the corner radius and the stroke of shapes, lines and images", () => {
    const shape = rect("s", 0, 0, 10, 10, { radius: 4, stroke: { color: "#000000", width: 2, style: "solid" } });
    scaleElement(shape, 3, 3);
    expect([shape.radius, shape.stroke!.width]).toEqual([12, 6]);
    const bare = rect("s2", 0, 0, 10, 10, { radius: 4, stroke: null });
    scaleElement(bare, 2, 2);
    expect(bare.radius).toBe(8);
    const line = createLine({ stroke: { color: "#000000", width: 4, style: "solid" } }) as LineElement;
    scaleElement(line, 2, 2);
    expect(line.stroke.width).toBe(8);
    const image = createImage({ src: "x.png", radius: 5, stroke: { color: "#000000", width: 1, style: "solid" } }) as ImageElement;
    scaleElement(image, 2, 2);
    expect([image.radius, image.stroke!.width]).toEqual([10, 2]);
    const plain = createImage({ src: "x.png", radius: 5, stroke: null }) as ImageElement;
    scaleElement(plain, 2, 2);
    expect(plain.radius).toBe(10);
  });

  it("scales the cells and the grid of a table and its text and border", () => {
    const table = createTable({ width: 300, height: 90, colWidths: [100, 200], rowHeights: [30, 60], fontSize: 20, borderWidth: 2 }) as TableElement;
    scaleElement(table, 2, 3);
    expect(table.colWidths).toEqual([200, 400]);
    expect(table.rowHeights).toEqual([90, 180]);
    expect(table.fontSize).toBe(50);
    expect(table.borderWidth).toBe(5);
  });

  it("scales the children of a group and leaves charts to the generic scaling", () => {
    const group = createGroup([rect("in", 10, 10, 20, 20)], { x: 0, y: 0, width: 100, height: 100 });
    scaleElement(group, 2, 2);
    expect([group.children[0].x, group.children[0].width]).toEqual([20, 40]);
    const chart = createChart({ x: 5, y: 5, width: 100, height: 50 });
    scaleElement(chart, 2, 2);
    expect([chart.x, chart.width, chart.height]).toEqual([10, 200, 100]);
  });

  it("resizes a design with or without scaling its content", () => {
    const withContent = createDesign({ width: 200, height: 100, pages: [pageOf(rect("a", 20, 10, 40, 20))] });
    resizeDesign(withContent, 400, 400, true);
    // the content grows by 2 and is centred on the taller page
    expect(withContent.pages[0].elements[0]).toMatchObject({ x: 40, y: 120, width: 80, height: 40 });
    expect([withContent.width, withContent.height]).toEqual([400, 400]);
    const without = createDesign({ width: 200, height: 100, pages: [pageOf(rect("a", 20, 10, 40, 20))] });
    resizeDesign(without, 400, 400, false);
    expect(without.pages[0].elements[0]).toMatchObject({ x: 20, y: 10, width: 40, height: 20 });
    expect([without.width, without.height]).toEqual([400, 400]);
  });
});

describe("pages", () => {
  const design = () => createDesign({ width: 100, height: 100, pages: [createPage({ id: "p1" }), createPage({ id: "p2" }), createPage({ id: "p3" })] });
  const order = (d: ReturnType<typeof design>) => d.pages.map((p) => p.id);

  it("inserts a page at a clamped index", () => {
    const d = design();
    insertPage(d, createPage({ id: "new" }), 1);
    expect(order(d)).toEqual(["p1", "new", "p2", "p3"]);
    insertPage(d, createPage({ id: "first" }), -3);
    insertPage(d, createPage({ id: "last" }), 99);
    expect(order(d)).toEqual(["first", "p1", "new", "p2", "p3", "last"]);
  });

  it("removes a page but never the last one, and ignores an unknown id", () => {
    const d = design();
    removePage(d, "p2");
    removePage(d, "nope");
    expect(order(d)).toEqual(["p1", "p3"]);
    removePage(d, "p1");
    removePage(d, "p3");
    expect(order(d)).toEqual(["p3"]);
  });

  it("moves a page to a clamped index and ignores an unknown id", () => {
    const d = design();
    movePage(d, "p1", 99);
    expect(order(d)).toEqual(["p2", "p3", "p1"]);
    movePage(d, "p1", -1);
    expect(order(d)).toEqual(["p1", "p2", "p3"]);
    movePage(d, "nope", 1);
    expect(order(d)).toEqual(["p1", "p2", "p3"]);
  });

  it("copies a page with new ids all the way down", () => {
    const group = createGroup([rect("deep", 0, 0)], { id: "g" });
    const page = createPage({ id: "orig", elements: [rect("a", 0, 0), group] });
    const copy = clonePageWithIds(page);
    expect(copy.id).not.toBe("orig");
    const before = flatten(page.elements).map((e) => e.id);
    const after = flatten(copy.elements).map((e) => e.id);
    expect(after).toHaveLength(before.length);
    expect(after.some((id) => before.includes(id))).toBe(false);
    expect(copy.elements[0]).not.toBe(page.elements[0]);
  });
});

describe("text properties", () => {
  const text = () =>
    createText({
      paragraphs: [{ runs: [{ text: "a", bold: true, italic: true, color: "#ff0000", size: 10, font: "Lora", spacing: 50, underline: true, strike: true }, { text: "b" }] }],
    }) as TextElement;

  it("clears the run overrides that an element-wide change replaces", () => {
    const el = text();
    applyTextProps(el, { color: "#00ff00", fontSize: 40 });
    expect(el.color).toBe("#00ff00");
    expect(el.paragraphs[0].runs[0]).toEqual({ text: "a", bold: true, italic: true, font: "Lora", spacing: 50, underline: true, strike: true });
  });

  it("maps every style property to its run override", () => {
    const el = text();
    applyTextProps(el, { fontFamily: "Inter", fontWeight: 800, italic: false, underline: false, strike: false, letterSpacing: 10 });
    expect(el.paragraphs[0].runs[0]).toEqual({ text: "a", color: "#ff0000", size: 10 });
  });

  it("keeps the run overrides of properties that have none", () => {
    const el = text();
    applyTextProps(el, { align: "center", lineHeight: 2 });
    expect(el.paragraphs[0].runs[0].bold).toBe(true);
    expect([el.align, el.lineHeight]).toEqual(["center", 2]);
  });
});

describe("normalizeParagraphs", () => {
  it("merges neighbouring runs with the same style", () => {
    const out = normalizeParagraphs([{ runs: [{ text: "a" }, { text: "b" }, { text: "c", bold: true }, { text: "d", bold: true }] }]);
    expect(out[0].runs).toEqual([{ text: "ab" }, { text: "cd", bold: true }]);
  });

  it("tells runs apart by every style property", () => {
    const differ = [
      { bold: true },
      { weight: 300 },
      { italic: true },
      { underline: true },
      { strike: true },
      { color: "#ff0000" },
      { size: 20 },
      { font: "Lora" },
      { spacing: 10 },
    ];
    for (const style of differ) {
      expect(normalizeParagraphs([{ runs: [{ text: "a" }, { text: "b", ...style }] }])[0].runs, JSON.stringify(style)).toHaveLength(2);
    }
  });

  it("drops empty runs but keeps one for a paragraph that would be left with none", () => {
    expect(normalizeParagraphs([{ runs: [{ text: "" }, { text: "x" }, { text: "" }] }])[0].runs).toEqual([{ text: "x" }]);
    expect(normalizeParagraphs([{ runs: [{ text: "" }] }])[0].runs).toEqual([{ text: "" }]);
    expect(normalizeParagraphs([{ runs: [] }])[0].runs).toEqual([{ text: "" }]);
  });

  it("keeps the other settings of a paragraph and does not change its input", () => {
    const input = [{ runs: [{ text: "a" }, { text: "b" }], align: "center" as const, list: "bullet" as const }];
    const out = normalizeParagraphs(input);
    expect(out[0]).toMatchObject({ align: "center", list: "bullet" });
    expect(input[0].runs).toHaveLength(2);
  });
});

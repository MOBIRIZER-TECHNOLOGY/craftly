import { describe, expect, it } from "vitest";
import { createPage, createShape } from "./factory";
import { boundsOfElements, boxBounds, hitTestElement, rotatePoint, snapAngle, toLocalPoint } from "./geometry";
import {
  alignElements,
  canArrange,
  distributeElements,
  duplicateElements,
  findElement,
  flipElements,
  groupElements,
  moveBy,
  moveToIndex,
  removeElements,
  reorder,
  resizeDesign,
  topLevelIds,
  ungroup,
} from "./ops";
import { createDesign } from "./factory";
import type { Page } from "./types";

function pageWith(n: number): Page {
  const page = createPage();
  for (let i = 0; i < n; i++) page.elements.push(createShape("rect", { id: `e${i}`, x: i * 100, y: 50, width: 40, height: 40 }));
  return page;
}
const ids = (p: Page) => p.elements.map((e) => e.id);

describe("geometry", () => {
  it("rotates points about a centre", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
  it("computes the bounds of a rotated box", () => {
    const b = boxBounds({ x: 0, y: 0, width: 100, height: 20, rotation: 90 });
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(100);
    expect(b.x).toBeCloseTo(40);
    expect(b.y).toBeCloseTo(-40);
  });
  it("hit-tests rotated elements in local space", () => {
    const el = createShape("rect", { x: 0, y: 0, width: 100, height: 20, rotation: 90 });
    expect(hitTestElement(el, { x: 50, y: 45 })).toBe(true);
    expect(hitTestElement(el, { x: 90, y: 10 })).toBe(false);
    const l = toLocalPoint(el, { x: 50, y: 45 });
    expect(l.x).toBeCloseTo(85);
    expect(l.y).toBeCloseTo(10);
  });
  it("snaps angles", () => {
    expect(snapAngle(88, 90, 5)).toBe(90);
    expect(snapAngle(60, 90, 5)).toBe(60);
  });
});

describe("z-order", () => {
  it("brings to front and sends to back preserving relative order", () => {
    const p = pageWith(4);
    reorder(p, ["e0", "e1"], "front");
    expect(ids(p)).toEqual(["e2", "e3", "e0", "e1"]);
    reorder(p, ["e3"], "back");
    expect(ids(p)).toEqual(["e3", "e2", "e0", "e1"]);
  });
  it("moves forward/backward one step", () => {
    const p = pageWith(3);
    reorder(p, ["e0"], "forward");
    expect(ids(p)).toEqual(["e1", "e0", "e2"]);
    reorder(p, ["e2"], "backward");
    expect(ids(p)).toEqual(["e1", "e2", "e0"]);
  });
  it("knows when an arrange is impossible", () => {
    const p = pageWith(2);
    expect(canArrange(p, ["e1"], "forward")).toBe(false);
    expect(canArrange(p, ["e1"], "backward")).toBe(true);
  });
  it("moves to an absolute index", () => {
    const p = pageWith(4);
    moveToIndex(p, "e3", 0);
    expect(ids(p)).toEqual(["e3", "e0", "e1", "e2"]);
  });
});

describe("grouping", () => {
  it("groups with local coordinates and ungroups back", () => {
    const p = pageWith(3);
    const before = p.elements.map((e) => ({ x: e.x, y: e.y }));
    const g = groupElements(p, ["e0", "e2"])!;
    expect(g.children).toHaveLength(2);
    expect(g.x).toBe(0);
    expect(g.width).toBe(240);
    expect(g.children[0].x).toBe(0);
    expect(ids(p)).toEqual(["e1", g.id]);
    const childIds = ungroup(p, g.id);
    expect(childIds).toEqual(["e0", "e2"]);
    const restored = ["e0", "e1", "e2"].map((id) => findElement(p, id)!);
    expect(restored.map((e) => ({ x: e.x, y: e.y }))).toEqual(before);
  });
  it("ungroup applies group rotation to children", () => {
    const p = pageWith(2);
    const g = groupElements(p, ["e0", "e1"])!;
    g.rotation = 90;
    const [a] = ungroup(p, g.id);
    expect(findElement(p, a)!.rotation).toBe(90);
  });
  it("refuses to group a single element", () => {
    expect(groupElements(pageWith(2), ["e0"])).toBeNull();
  });
  it("finds top level ids so groups and children are not both moved", () => {
    const p = pageWith(3);
    const g = groupElements(p, ["e0", "e1"])!;
    expect(topLevelIds(p, [g.id, "e0", "e2"])).toEqual([g.id, "e2"]);
  });
});

describe("align / distribute / move", () => {
  it("aligns to the page and to the selection", () => {
    const p = pageWith(3);
    alignElements(p, ["e0", "e1", "e2"], "left", { x: 10, y: 0, w: 500, h: 500 });
    expect(p.elements.map((e) => e.x)).toEqual([10, 10, 10]);
    alignElements(p, ["e0", "e1"], "bottom", null);
    expect(p.elements[0].y).toBe(p.elements[1].y);
    alignElements(p, ["e0"], "center", { x: 0, y: 0, w: 200, h: 200 });
    expect(p.elements[0].x).toBe(80);
  });
  it("distributes evenly", () => {
    const p = pageWith(4);
    p.elements[1].x = 30;
    distributeElements(p, ["e0", "e1", "e2", "e3"], "horizontal");
    const xs = p.elements.map((e) => e.x);
    const gaps = [xs[1] - (xs[0] + 40), xs[2] - (xs[1] + 40), xs[3] - (xs[2] + 40)];
    expect(gaps[0]).toBeCloseTo(gaps[1]);
    expect(gaps[1]).toBeCloseTo(gaps[2]);
  });
  it("moves and skips locked elements", () => {
    const p = pageWith(2);
    p.elements[1].locked = true;
    moveBy(p, ["e0", "e1"], 5, 7);
    expect([p.elements[0].x, p.elements[0].y]).toEqual([5, 57]);
    expect(p.elements[1].x).toBe(100);
  });
  it("flips a selection about its centre", () => {
    const p = pageWith(2);
    flipElements(p, ["e0", "e1"], "horizontal");
    expect(p.elements[0].flipH).toBe(true);
    expect(p.elements[0].x).toBe(100);
    expect(p.elements[1].x).toBe(0);
  });
});

describe("duplicate / remove", () => {
  it("clones above the original with new ids and offset", () => {
    const p = pageWith(2);
    const [id] = duplicateElements(p, ["e0"], 10, 10);
    expect(id).not.toBe("e0");
    expect(p.elements).toHaveLength(3);
    expect(p.elements[1].id).toBe(id);
    expect(p.elements[1].x).toBe(10);
  });
  it("duplicates groups with fresh child ids", () => {
    const p = pageWith(2);
    const g = groupElements(p, ["e0", "e1"])!;
    const [copyId] = duplicateElements(p, [g.id]);
    const copy = findElement(p, copyId)!;
    expect(copy.type).toBe("group");
    if (copy.type === "group") expect(copy.children.map((c) => c.id)).not.toContain("e0");
  });
  it("removes nested elements", () => {
    const p = pageWith(3);
    const g = groupElements(p, ["e0", "e1"])!;
    removeElements(p, ["e0"]);
    expect(g.children.length).toBe(1);
  });
});

describe("design resize", () => {
  it("scales content uniformly and centres it", () => {
    const d = createDesign({ width: 1000, height: 500, pages: [pageWith(1)] });
    d.pages[0].elements[0].x = 100;
    resizeDesign(d, 2000, 2000, true);
    const e = d.pages[0].elements[0];
    expect(e.x).toBe(200);
    expect(e.width).toBe(80);
    expect(e.y).toBe(500 + 100);
    expect(d.width).toBe(2000);
  });
  it("only changes the canvas when scaling is off", () => {
    const d = createDesign({ width: 1000, height: 500, pages: [pageWith(1)] });
    resizeDesign(d, 800, 800, false);
    expect(d.pages[0].elements[0].width).toBe(40);
    expect(boundsOfElements(d.pages[0].elements)!.w).toBe(40);
  });
});

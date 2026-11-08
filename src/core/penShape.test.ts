import { describe, expect, it } from "vitest";
import { shapePathData } from "@/render/shapePaths";
import { moveNodes, parsePath, type PenNode, type PenPath } from "./pen";
import { designToLocal, elementPath, localToDesign, newPathShape, patchForPath } from "./penShape";
import type { Point } from "./types";

const node = (x: number, y: number, handleIn: Point | null = null, handleOut: Point | null = null): PenNode => ({ x, y, handleIn, handleOut });
const near = (a: Point, b: Point, digits = 2) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const box = (over: Partial<{ x: number; y: number; width: number; height: number; rotation: number; flipH: boolean; flipV: boolean }> = {}) => ({
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  ...over,
});

describe("localToDesign and designToLocal", () => {
  it("turn a point of the element's own box into a point of the page", () => {
    near(localToDesign(box(), { x: 0, y: 0 }), { x: 100, y: 100 });
    near(localToDesign(box(), { x: 200, y: 100 }), { x: 300, y: 200 });
  });

  it("turn with the element, about the centre of its box", () => {
    // the top-left corner (-100, -50 from the centre (200, 150)) turned a quarter clockwise lands at the top-right
    near(localToDesign(box({ rotation: 90 }), { x: 0, y: 0 }), { x: 250, y: 50 });
  });

  it("mirror with the element", () => {
    near(localToDesign(box({ flipH: true }), { x: 0, y: 0 }), { x: 300, y: 100 });
    near(localToDesign(box({ flipV: true }), { x: 0, y: 0 }), { x: 100, y: 200 });
    near(localToDesign(box({ flipH: true, flipV: true }), { x: 0, y: 0 }), { x: 300, y: 200 });
  });

  it("are each other's inverse", () => {
    for (const rotation of [0, 30, 90, 200, -45]) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          const el = box({ rotation, flipH, flipV });
          const p = { x: 37.5, y: 81 };
          near(designToLocal(el, localToDesign(el, p)), p);
        }
      }
    }
  });
});

describe("elementPath", () => {
  it("gives the path of a shape in the pixels of its box", () => {
    const path = elementPath({ shape: "path", path: "M0 0 L100 100", width: 200, height: 50 })!;
    expect(path.nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [200, 50],
    ]);
  });

  it("gives nothing for a shape that is not a path, has no path or has one that cannot be edited point by point", () => {
    expect(elementPath({ shape: "star", path: "M0 0 L100 100", width: 10, height: 10 })).toBeNull();
    expect(elementPath({ shape: "path", width: 10, height: 10 })).toBeNull();
    expect(elementPath({ shape: "path", path: "M0 0 A5 5 0 0 1 10 10", width: 10, height: 10 })).toBeNull();
  });
});

describe("patchForPath", () => {
  const path: PenPath = { closed: false, nodes: [node(20, 10, null, { x: 30, y: 0 }), node(120, 60, { x: -30, y: 0 }, null), node(180, 20)] };

  it.each([0, 30, 90, 200, -45])("keeps every point where it is on the page, whatever the turn (%i degrees) or mirror", (rotation) => {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        const el = { ...box({ rotation, flipH, flipV }), path: "", shape: "path" as const };
        const before = path.nodes.map((n) => localToDesign(el, n));
        // the same path, moved at its second node by (40, -30) in the box's own pixels
        const edited = moveNodes(path, [1], 40, -30);
        const patch = patchForPath(el, edited);
        const after = { ...el, ...patch };
        const nodes = elementPath(after)!.nodes;
        near(localToDesign(after, nodes[0]), before[0]);
        near(localToDesign(after, nodes[2]), before[2]);
        near(localToDesign(after, nodes[1]), localToDesign(el, { x: 160, y: 30 }));
      }
    }
  });

  it("gives the box the curve fills, and the path data to go with it", () => {
    const el = { ...box({ x: 0, y: 0, width: 100, height: 100 }), path: "", shape: "path" as const };
    const patch = patchForPath(el, { closed: false, nodes: [node(10, 20), node(60, 20), node(60, 90)] });
    expect(patch).toEqual({ x: 10, y: 20, width: 50, height: 70, path: "M0 0 L100 0 L100 100" });
  });
});

describe("the path the renderer draws", () => {
  // the renderer and the editor read the same path data: what is drawn is what the points are
  const drawn = (el: { path: string; width: number; height: number }) => parsePath(shapePathData("path", el.width, el.height, { path: el.path }))!;

  it.each([
    ["an open curve", "M0 100 C25 0 75 0 100 100 L50 60", 240, 90],
    ["a closed shape", "M0 0 L100 0 C120 50 80 80 50 100 L0 60 Z", 160, 320],
    ["a path that is far from square", "M0 0 L100 100", 1000, 10],
  ])("is made of the points the editor shows, in the pixels of the box: %s", (_name, path, width, height) => {
    const el = { shape: "path" as const, path, width, height };
    const editing = elementPath(el)!;
    const rendered = drawn(el);
    expect(rendered.closed).toBe(editing.closed);
    expect(rendered.nodes).toHaveLength(editing.nodes.length);
    rendered.nodes.forEach((n, i) => {
      const e = editing.nodes[i];
      near(n, e);
      expect(n.handleIn === null).toBe(e.handleIn === null);
      expect(n.handleOut === null).toBe(e.handleOut === null);
      if (n.handleIn && e.handleIn) near(n.handleIn, e.handleIn);
      if (n.handleOut && e.handleOut) near(n.handleOut, e.handleOut);
    });
  });

  it("is the path the Pen made, once it is placed", () => {
    const path: PenPath = {
      closed: true,
      nodes: [node(40, 30, null, { x: 50, y: 0 }), node(240, 130, { x: -20, y: -40 }, { x: 20, y: 40 }), node(90, 200, { x: 40, y: 0 }, null)],
    };
    const made = newPathShape(path, { color: "#000000", strokeWidth: 4 });
    const el = { shape: "path" as const, path: made.path, width: made.width, height: made.height };
    // the points of the element on the page are the points that were clicked
    const nodes = drawn(el).nodes;
    path.nodes.forEach((n, i) => near({ x: made.x + nodes[i].x, y: made.y + nodes[i].y }, n));
  });
});

describe("newPathShape", () => {
  const style = { color: "#ff0066", strokeWidth: 6 };
  const nodes = [node(100, 50), node(300, 50), node(300, 250)];

  it("draws an open path as a stroke with nothing inside", () => {
    expect(newPathShape({ closed: false, nodes }, style)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 200,
      path: "M0 0 L100 0 L100 100",
      fill: null,
      stroke: { color: "#ff0066", width: 6, style: "solid", cap: "round", join: "round" },
    });
  });

  it("fills a closed path and gives it no outline", () => {
    const shape = newPathShape({ closed: true, nodes }, style);
    expect(shape.fill).toEqual({ type: "solid", color: "#ff0066" });
    expect(shape.stroke).toBeNull();
    expect(shape.path).toBe("M0 0 L100 0 L100 100 L0 0 Z");
  });
});

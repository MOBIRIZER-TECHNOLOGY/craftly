/**
 * Combining shapes (union, subtract, intersect, exclude) and turning a shape into a path. Results are checked on the page, in
 * the pixels a person sees, whatever the turn and mirror of the shapes that went in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { combineShapes, combinedShape, makePath, paperScope, shapeAsPath, shapesToCombine, type PathGeometry } from "./combine";
import { createGroup, createPage, createShape, createText, solid } from "./factory";
import { nodeKindOf, parsePath } from "./pen";
import type { DesignElement, ShapeElement } from "./types";

const rect = (x: number, y: number, width: number, height: number, extra: Partial<ShapeElement> = {}) => createShape("rect", { x, y, width, height, ...extra });
// path data keeps three decimals of the 0..100 space of its box, which is a few thousandths of a pixel on the page
const round = (n: number) => Math.round(n * 100) / 100;
const byPlace = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
/** points, left to right and top to bottom, so that a test does not depend on where a path starts */
const pts = (...list: Array<[number, number]>) => [...list].sort(byPlace);
/** the corners of a result of one piece, as points of the page */
const corners = (g: PathGeometry) => pts(...parsePath(g.path)!.nodes.map((n): [number, number] => [round(g.x + (n.x * g.width) / 100), round(g.y + (n.y * g.height) / 100)]));
const box = (g: PathGeometry) => ({ x: round(g.x), y: round(g.y), width: round(g.width), height: round(g.height) });
const pieces = (d: string) => (d.match(/M/g) ?? []).length;

/** two squares of 100 that overlap in a square of 50: A is behind B */
const A = () => rect(0, 0, 100, 100);
const B = () => rect(50, 50, 100, 100);

describe("combineShapes", () => {
  it("unites two shapes into one outline", async () => {
    const g = (await combineShapes([A(), B()], "union"))!;
    expect(box(g)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    expect(corners(g)).toEqual(pts([0, 0], [100, 0], [100, 50], [150, 50], [150, 150], [50, 150], [50, 100], [0, 100]));
  });

  it("subtracts the shapes in front from the one behind", async () => {
    const g = (await combineShapes([A(), B()], "subtract"))!;
    expect(box(g)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(corners(g)).toEqual(pts([0, 0], [100, 0], [100, 50], [50, 50], [50, 100], [0, 100]));
  });

  it("keeps what the shapes have in common", async () => {
    const g = (await combineShapes([A(), B()], "intersect"))!;
    expect(box(g)).toEqual({ x: 50, y: 50, width: 50, height: 50 });
    expect(corners(g)).toEqual(pts([50, 50], [100, 50], [100, 100], [50, 100]));
  });

  it("takes away what the shapes have in common, which leaves two pieces", async () => {
    const g = (await combineShapes([A(), B()], "exclude"))!;
    expect(box(g)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    expect(pieces(g.path)).toBe(2);
    expect(parsePath(g.path)).toBeNull(); // a path of several pieces is not edited point by point
  });

  it("takes the shape that is first (the one behind) as the one to subtract from", async () => {
    const g = (await combineShapes([B(), A()], "subtract"))!;
    expect(box(g)).toEqual({ x: 50, y: 50, width: 100, height: 100 });
    expect(corners(g)).toEqual(pts([100, 50], [150, 50], [150, 150], [50, 150], [50, 100], [100, 100]));
  });

  it("combines more than two shapes: the one behind minus all the others", async () => {
    const g = (await combineShapes([A(), B(), rect(0, 0, 50, 25)], "subtract"))!;
    expect(corners(g)).toEqual(pts([50, 0], [100, 0], [100, 50], [50, 50], [50, 100], [0, 100], [0, 25], [50, 25]));
    const all = (await combineShapes([A(), B(), rect(120, 120, 50, 50)], "union"))!;
    expect(box(all)).toEqual({ x: 0, y: 0, width: 170, height: 170 });
  });

  it("leaves a hole when a shape is cut out of the middle of another", async () => {
    const scope = await paperScope();
    const g = (await combineShapes([rect(0, 0, 100, 100), rect(25, 25, 50, 50)], "subtract"))!;
    expect(pieces(g.path)).toBe(2);
    // the stored path is drawn with the non-zero rule: the middle is empty, the edge is filled
    const drawn = new scope.CompoundPath({ pathData: g.path, fillRule: "nonzero", insert: false });
    expect(box(g)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(drawn.contains(new scope.Point(50, 50))).toBe(false);
    expect(drawn.contains(new scope.Point(10, 10))).toBe(true);
  });

  it("keeps the hole of a ring when it is combined with another shape", async () => {
    const scope = await paperScope();
    const ring = createShape("ring", { x: 0, y: 0, width: 100, height: 100 });
    const g = (await combineShapes([ring, rect(90, 40, 60, 20)], "union"))!;
    const drawn = new scope.CompoundPath({ pathData: g.path, fillRule: "nonzero", insert: false });
    drawn.scale(g.width / 100, g.height / 100, new scope.Point(0, 0)); // the path is in the 0..100 space of its box
    drawn.translate(new scope.Point(g.x, g.y));
    expect(drawn.contains(new scope.Point(50, 50))).toBe(false);
    expect(drawn.contains(new scope.Point(50, 5))).toBe(true);
    expect(drawn.contains(new scope.Point(130, 50))).toBe(true);
  });

  it("works on the page whatever the turn of a shape", async () => {
    // 200 x 100 turned a quarter about its centre (200, 150) covers x 150..250 and y 50..250
    const g = (await combineShapes([rect(100, 100, 200, 100, { rotation: 90 }), rect(180, 100, 10, 10)], "union"))!;
    expect(box(g)).toEqual({ x: 150, y: 50, width: 100, height: 200 });
    expect(corners(g)).toEqual(pts([150, 50], [250, 50], [150, 250], [250, 250]));
  });

  it("turns a shape about the centre of its box, not about the centre of its outline", async () => {
    // the outline fills the left half of a 200 x 100 box at (100, 100); a quarter turn about the centre of the box (200, 150) stands it up
    const half = createShape("path", { x: 100, y: 100, width: 200, height: 100, rotation: 90, path: "M0 0 L50 0 L50 100 L0 100 Z" });
    const g = (await combineShapes([half, rect(0, 0, 1000, 1000)], "intersect"))!;
    expect(box(g)).toEqual({ x: 150, y: 50, width: 100, height: 100 });
  });

  it("writes straight sides as lines, not as curves with no bend", async () => {
    expect((await combineShapes([rect(0, 0, 100, 100, { rotation: 33 }), B()], "union"))!.path).not.toMatch(/C/);
    expect((await combineShapes([A(), B()], "exclude"))!.path).not.toMatch(/C/);
  });

  it("works on the page whatever the mirror of a shape", async () => {
    // the right angle of the triangle is at the top left; mirrored it is at the top right
    const triangle = createShape("path", { x: 0, y: 0, width: 100, height: 100, path: "M0 0 L100 0 L0 100 Z", flipH: true });
    const g = (await combineShapes([triangle, rect(60, 10, 10, 10)], "union"))!;
    expect(corners(g)).toEqual(pts([0, 0], [100, 0], [100, 100]));
    const down = createShape("path", { x: 0, y: 0, width: 100, height: 100, path: "M0 0 L100 0 L0 100 Z", flipV: true });
    expect(corners((await combineShapes([down, rect(10, 60, 10, 10)], "union"))!)).toEqual(pts([0, 100], [100, 100], [0, 0]));
  });

  it("keeps the curves of shapes that have them", async () => {
    const g = (await combineShapes([createShape("ellipse", { x: 0, y: 0, width: 100, height: 100 }), rect(50, 0, 100, 100)], "union"))!;
    expect(box(g)).toEqual({ x: 0, y: 0, width: 150, height: 100 });
    const path = parsePath(g.path)!;
    expect(path.closed).toBe(true);
    expect(path.nodes.some((n) => n.handleIn || n.handleOut)).toBe(true);
  });

  it("writes at most three decimals", async () => {
    const g = (await combineShapes([createShape("ellipse", { x: 0, y: 0, width: 100, height: 100 }), createShape("ellipse", { x: 33, y: 17, width: 77, height: 61 })], "union"))!;
    expect(g.path).not.toMatch(/\d\.\d{4}/);
  });

  it("gives nothing when no shape is left", async () => {
    expect(await combineShapes([rect(0, 0, 10, 10), rect(100, 100, 10, 10)], "intersect")).toBeNull();
    expect(await combineShapes([A(), A()], "subtract")).toBeNull();
  });

  it("leaves out a path whose data draws nothing, so that the others are fewer than two", async () => {
    expect(await combineShapes([A(), createShape("path", { x: 0, y: 0, width: 50, height: 50, path: "M" })], "union")).toBeNull();
  });

  it("combines a path that has no data as the rectangle it is drawn as", async () => {
    const g = (await combineShapes([A(), createShape("path", { x: 0, y: 0, width: 50, height: 50 })], "intersect"))!;
    expect(box(g)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it("gives nothing for fewer than two shapes that have an outline", async () => {
    expect(await combineShapes([], "union")).toBeNull();
    expect(await combineShapes([A()], "union")).toBeNull();
    expect(await combineShapes([A(), rect(5, 5, 0, 10)], "union")).toBeNull();
  });
});

describe("shapeAsPath", () => {
  it("writes a rectangle as its four corners, in the 0..100 space of its own box", async () => {
    const path = parsePath((await shapeAsPath(rect(10, 20, 200, 100)))!)!;
    expect(path.closed).toBe(true);
    expect(pts(...path.nodes.map((n): [number, number] => [round(n.x), round(n.y)]))).toEqual(pts([0, 0], [100, 0], [100, 100], [0, 100]));
    expect(path.nodes.every((n) => !n.handleIn && !n.handleOut)).toBe(true);
    expect((await shapeAsPath(rect(10, 20, 200, 100)))!).not.toMatch(/C/);
  });

  it("writes an ellipse as four smooth points", async () => {
    const path = parsePath((await shapeAsPath(createShape("ellipse", { x: 0, y: 0, width: 300, height: 100 })))!)!;
    expect(path.nodes).toHaveLength(4);
    expect(pts(...path.nodes.map((n): [number, number] => [round(n.x), round(n.y)]))).toEqual(pts([50, 0], [100, 50], [50, 100], [0, 50]));
    expect(path.nodes.every((_n, i) => nodeKindOf(path, i) === "smooth")).toBe(true);
  });

  it("keeps the rounded corners of a rectangle", async () => {
    const path = parsePath((await shapeAsPath(rect(0, 0, 200, 100, { radius: 20 })))!)!;
    expect(path.nodes.length).toBeGreaterThanOrEqual(8);
    expect(path.nodes.some((n) => n.handleIn || n.handleOut)).toBe(true);
  });

  it("does not depend on the turn or mirror of the shape: the path is in the shape's own box", async () => {
    const plain = await shapeAsPath(createShape("star", { x: 0, y: 0, width: 120, height: 100 }));
    const turned = await shapeAsPath(createShape("star", { x: 40, y: 70, width: 120, height: 100, rotation: 33, flipH: true }));
    expect(turned).toBe(plain);
  });

  it("leaves a path as it is", async () => {
    const d = "M0 0 C10 0 90 100 100 100";
    expect(await shapeAsPath(createShape("path", { x: 0, y: 0, width: 50, height: 50, path: d }))).toBe(d);
  });

  it("keeps the hole of a shape that is drawn with the even-odd rule, in the path that is drawn with the non-zero one", async () => {
    const scope = await paperScope();
    const d = (await shapeAsPath(createShape("ring", { x: 0, y: 0, width: 100, height: 100 })))!;
    expect(pieces(d)).toBe(2);
    const drawn = new scope.CompoundPath({ pathData: d, fillRule: "nonzero", insert: false });
    expect(drawn.contains(new scope.Point(50, 50))).toBe(false);
    expect(drawn.contains(new scope.Point(50, 2))).toBe(true);
  });

  it("gives nothing for a shape with no size, or one so thin that it has no area", async () => {
    expect(await shapeAsPath(rect(0, 0, 0, 10))).toBeNull();
    expect(await shapeAsPath(rect(0, 0, 1e-9, 10))).toBeNull();
  });

  it("gives nothing for a path that has no data", async () => {
    expect(await shapeAsPath(createShape("path", { x: 0, y: 0, width: 50, height: 50 }))).toBeNull();
  });

  it("writes at most three decimals", async () => {
    expect(await shapeAsPath(createShape("ellipse", { x: 0, y: 0, width: 77, height: 61 }))).not.toMatch(/\d\.\d{4}/);
  });
});

describe("shapesToCombine", () => {
  const onPage = (...elements: DesignElement[]) => createPage({ elements });
  const idsOf = (list: ShapeElement[] | null) => list?.map((s) => s.id);

  it("gives the shapes from the back to the front of the page, whatever the order of the selection", () => {
    const page = onPage(rect(0, 0, 10, 10, { id: "a" }), createText({ id: "t" }), rect(0, 0, 10, 10, { id: "b" }), rect(0, 0, 10, 10, { id: "c" }));
    expect(idsOf(shapesToCombine(page, ["c", "a", "b"]))).toEqual(["a", "b", "c"]);
  });

  it("needs two shapes, and counts a shape that is named twice once", () => {
    const page = onPage(rect(0, 0, 10, 10, { id: "a" }), rect(0, 0, 10, 10, { id: "b" }));
    expect(shapesToCombine(page, [])).toBeNull();
    expect(shapesToCombine(page, ["a"])).toBeNull();
    expect(shapesToCombine(page, ["a", "a"])).toBeNull();
    expect(idsOf(shapesToCombine(page, ["a", "b", "a"]))).toEqual(["a", "b"]);
  });

  it("gives nothing when one of them is not a shape, is locked, is hidden, is in a group or is not on the page", () => {
    const page = onPage(
      rect(0, 0, 10, 10, { id: "a" }),
      rect(0, 0, 10, 10, { id: "b" }),
      createText({ id: "t" }),
      rect(0, 0, 10, 10, { id: "locked", locked: true }),
      rect(0, 0, 10, 10, { id: "hidden", hidden: true }),
      createGroup([rect(0, 0, 10, 10, { id: "inside" })], { id: "g" }),
    );
    expect(idsOf(shapesToCombine(page, ["a", "b"]))).toEqual(["a", "b"]);
    for (const other of ["t", "locked", "hidden", "inside", "g", "nope"]) expect(shapesToCombine(page, ["a", "b", other])).toBeNull();
  });
});

describe("combinedShape", () => {
  const behind = () =>
    rect(40, 30, 200, 100, {
      id: "behind",
      name: "Logo",
      rotation: 30,
      flipH: true,
      radius: 12,
      params: { sides: 5 },
      opacity: 0.5,
      shadow: { x: 2, y: 3, blur: 4, color: "#000000" },
      alt: "A logo",
      link: "https://example.test",
      fill: solid("#ff0000"),
    });

  it("is a path with the box and the outline of the result, turned and mirrored no more", () => {
    const made = combinedShape(behind(), { x: 10, y: 20, width: 300, height: 150, path: "M0 0 L100 0 L100 100 Z" });
    expect(made).toMatchObject({ type: "shape", shape: "path", path: "M0 0 L100 0 L100 100 Z", x: 10, y: 20, width: 300, height: 150, rotation: 0, radius: 0 });
    expect(made).not.toHaveProperty("flipH");
    expect(made).not.toHaveProperty("flipV");
    expect(made).not.toHaveProperty("params");
  });

  it("keeps the look of the shape at the back, but not its name, because it is a new shape", () => {
    const made = combinedShape(behind(), { x: 0, y: 0, width: 10, height: 10, path: "M0 0 L100 0 L100 100 Z" });
    expect(made).toMatchObject({ opacity: 0.5, alt: "A logo", link: "https://example.test", fill: solid("#ff0000"), shadow: { blur: 4 } });
    expect(made).not.toHaveProperty("name");
  });

  it("does not change the shape it is made from", () => {
    const source = behind();
    const copy = JSON.stringify(source);
    combinedShape(source, { x: 0, y: 0, width: 10, height: 10, path: "M0 0 L100 0 L100 100 Z" });
    expect(JSON.stringify(source)).toBe(copy);
  });
});

describe("makePath", () => {
  it("turns a shape into a path in place: box, turn, mirror and look stay, the outline is the path", () => {
    const shape = createShape("star", {
      id: "st",
      x: 40,
      y: 50,
      width: 120,
      height: 100,
      rotation: 33,
      flipH: true,
      radius: 8,
      params: { points: 5 },
      name: "Star",
      fill: solid("#00ff00"),
    });
    makePath(shape, "M50 0 L100 100 L0 100 Z");
    expect(shape).toMatchObject({
      id: "st",
      name: "Star",
      shape: "path",
      path: "M50 0 L100 100 L0 100 Z",
      x: 40,
      y: 50,
      width: 120,
      height: 100,
      rotation: 33,
      flipH: true,
      radius: 0,
      fill: solid("#00ff00"),
    });
    expect(shape).not.toHaveProperty("params");
  });
});

describe("loading the geometry library", () => {
  afterEach(() => {
    vi.doUnmock("paper/dist/paper-core");
    vi.resetModules();
  });

  it("tries again after a failure, such as a chunk that could not be fetched, instead of failing until the page is reloaded", async () => {
    vi.resetModules();
    vi.doMock("paper/dist/paper-core", () => {
      throw new Error("chunk failed");
    });
    const fresh = await import("./combine");
    await expect(fresh.paperScope()).rejects.toThrow();
    vi.doUnmock("paper/dist/paper-core");
    vi.resetModules();
    await expect(fresh.paperScope()).resolves.toBeDefined();
  });
});

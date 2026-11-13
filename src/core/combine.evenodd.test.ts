/**
 * A shape that is drawn with the even-odd rule and whose pieces run the same way round. The ring of the shape list happens to
 * have a hole that runs the other way, so it does not show what is needed here: drawn with the non-zero rule, which a stored
 * path uses, the hole of this one would be filled. Combining has to turn the pieces so that the hole stays a hole.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { combineShapes, paperScope, shapeAsPath } from "./combine";
import { createShape } from "./factory";
import type { ShapeKind } from "./types";

vi.mock("@/render/shapePaths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/render/shapePaths")>();
  return {
    ...actual,
    // two squares, one inside the other, both run clockwise
    shapePathData: (kind: string, w: number, h: number, opts?: Parameters<typeof actual.shapePathData>[3]) =>
      kind === "double" || kind === "nested" ? `M0 0 H${w} V${h} H0 Z M${w / 4} ${h / 4} H${(w * 3) / 4} V${(h * 3) / 4} H${w / 4} Z` : actual.shapePathData(kind, w, h, opts),
    shapeFillRule: (kind: string) => (kind === "double" ? "evenodd" : kind === "nested" ? "nonzero" : actual.shapeFillRule(kind)),
  };
});

// the geometry library loads on first use, which under a busy coverage run has taken longer than one test may: loaded here, with room
beforeAll(async () => void (await paperScope()), 180_000);

const double = () => createShape("double" as ShapeKind, { x: 0, y: 0, width: 100, height: 100 });
/** the same two squares, but drawn with the non-zero rule, which fills the inner one too */
const nested = () => createShape("nested" as ShapeKind, { x: 0, y: 0, width: 100, height: 100 });

describe("a shape whose even-odd hole runs the same way as its outline", () => {
  it("is written as a path that has the hole when it is drawn with the non-zero rule", async () => {
    const scope = await paperScope();
    const drawn = new scope.CompoundPath({ pathData: (await shapeAsPath(double()))!, fillRule: "nonzero", insert: false });
    expect(drawn.contains(new scope.Point(50, 50))).toBe(false);
    expect(drawn.contains(new scope.Point(10, 10))).toBe(true);
  });

  it("keeps the hole when it is combined with another shape", async () => {
    const scope = await paperScope();
    const g = (await combineShapes([double(), createShape("rect", { x: 90, y: 0, width: 60, height: 100 })], "union"))!;
    const drawn = new scope.CompoundPath({ pathData: g.path, fillRule: "nonzero", insert: false });
    drawn.scale(g.width / 100, g.height / 100, new scope.Point(0, 0)); // the path is in the 0..100 space of its box
    drawn.translate(new scope.Point(g.x, g.y));
    expect(drawn.contains(new scope.Point(50, 50))).toBe(false);
    expect(drawn.contains(new scope.Point(10, 10))).toBe(true);
    expect(drawn.contains(new scope.Point(120, 50))).toBe(true);
  });
});

describe("a shape that is drawn with the non-zero rule", () => {
  it("keeps what it fills when it is written as a path, a piece inside a piece that runs the same way included", async () => {
    const scope = await paperScope();
    const drawn = new scope.CompoundPath({ pathData: (await shapeAsPath(nested()))!, fillRule: "nonzero", insert: false });
    expect(drawn.contains(new scope.Point(50, 50))).toBe(true);
    expect(drawn.contains(new scope.Point(10, 10))).toBe(true);
  });
});

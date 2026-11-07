import { describe, expect, it } from "vitest";
import { getPath2D, shapePathData } from "./shapePaths";

const dataOf = (path: Path2D) => (path as unknown as { data: string }).data;

describe("getPath2D", () => {
  it("builds a canvas path from the outline of the shape", () => {
    const path = getPath2D("rect", 100, 50, { radius: 8 });
    expect(path).toBeInstanceOf(Path2D);
    expect(dataOf(path)).toBe(shapePathData("rect", 100, 50, { radius: 8 }));
  });

  it("hands out the same path for the same shape and size", () => {
    expect(getPath2D("ellipse", 80, 40)).toBe(getPath2D("ellipse", 80, 40));
    expect(getPath2D("star", 80, 80, { params: { points: 6 } })).toBe(getPath2D("star", 80, 80, { params: { points: 6 } }));
  });

  it("makes a new path when anything about the outline differs", () => {
    const base = getPath2D("polygon", 80, 80, { radius: 0, params: { sides: 5 } });
    expect(getPath2D("polygon", 81, 80, { radius: 0, params: { sides: 5 } })).not.toBe(base);
    expect(getPath2D("polygon", 80, 81, { radius: 0, params: { sides: 5 } })).not.toBe(base);
    expect(getPath2D("polygon", 80, 80, { radius: 3, params: { sides: 5 } })).not.toBe(base);
    expect(getPath2D("polygon", 80, 80, { radius: 0, params: { sides: 6 } })).not.toBe(base);
    expect(getPath2D("hexagon", 80, 80)).not.toBe(base);
    expect(getPath2D("path", 80, 80, { path: "M0 0L10 10" })).not.toBe(getPath2D("path", 80, 80, { path: "M0 0L10 20" }));
  });

  it("paints an empty outline for an empty box rather than failing", () => {
    expect(dataOf(getPath2D("rect", 0, 10))).toBe("");
  });

  it("forgets its paths once it holds too many", () => {
    const first = getPath2D("rect", 999, 11);
    for (let i = 0; i < 620; i++) getPath2D("rect", 100 + i, 12);
    expect(getPath2D("rect", 999, 11)).not.toBe(first);
    // the answer is still the right outline
    expect(dataOf(getPath2D("rect", 999, 11))).toBe("M0 0H999V11H0Z");
  });
});

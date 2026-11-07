import { describe, expect, it } from "vitest";
import { getShape, shapePathData } from "./shapePaths";

describe("shape parameters", () => {
  // Each parametrised shape carries its defaults; `path()` may also be called with no parameters at all.
  it.each(["ring", "polygon", "star", "star-4", "star-6", "burst", "scallop", "flower"])("%s: draws the same with no parameters as with its defaults", (id) => {
    const shape = getShape(id)!;
    expect(shape.params, id).toBeDefined();
    expect(shape.path(120, 80, {}, 0)).toBe(shapePathData(id, 120, 80));
  });
});

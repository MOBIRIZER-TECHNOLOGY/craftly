import { describe, expect, it } from "vitest";
import { SHAPES, getShape, scalePathData, shapeFillRule, shapePathData, shapePathOf, type ShapeGroup } from "./shapePaths";

/** The numbers of a path made only of M, L and Z commands, as [x, y] pairs. */
function polygonPoints(d: string): Array<[number, number]> | null {
  if (/[^MLZ\d\s.\-e]/.test(d)) return null;
  const pairs = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) out.push([pairs[i], pairs[i + 1]]);
  return out;
}

describe("scalePathData", () => {
  it("scales absolute commands by the horizontal and vertical factor", () => {
    expect(scalePathData("M10 20L30 40Z", 2, 3)).toBe("M20 60L60 120Z");
  });

  it("scales relative commands the same way", () => {
    expect(scalePathData("m1 2l3 4z", 2, 3)).toBe("m2 6l6 12Z");
  });

  it("scales a horizontal line by x and a vertical line by y", () => {
    expect(scalePathData("H10V20", 2, 3)).toBe("H20V60");
  });

  it("scales the radii and the end point of an arc but not its angle and flags", () => {
    expect(scalePathData("A5 5 30 1 0 10 10", 2, 3)).toBe("A10 15 30 1 0 20 30");
  });

  it("scales every control point of a curve", () => {
    expect(scalePathData("C1 2 3 4 5 6", 2, 3)).toBe("C2 6 6 12 10 18");
    expect(scalePathData("Q1 2 3 4", 2, 3)).toBe("Q2 6 6 12");
    expect(scalePathData("S1 2 3 4", 2, 3)).toBe("S2 6 6 12");
    expect(scalePathData("T1 2", 2, 3)).toBe("T2 6");
  });

  it("scales the repeated coordinate pairs of a single command", () => {
    expect(scalePathData("L1 2 3 4 5 6", 2, 2)).toBe("L2 4 6 8 10 12");
  });

  it("reads negative, decimal and exponent numbers", () => {
    expect(scalePathData("M-1.5 2e1", 2, 3)).toBe("M-3 60");
    expect(scalePathData("M.5 .25", 4, 4)).toBe("M2 1");
  });

  it("rounds to two decimals", () => {
    expect(scalePathData("L1 1", 1 / 3, 2 / 3)).toBe("L0.33 0.67");
  });

  it("leaves nothing for an empty path and drops a command with too few numbers", () => {
    expect(scalePathData("", 2, 2)).toBe("");
    expect(scalePathData("M1 2L3", 2, 2)).toBe("M2 4L");
  });
});

describe("shapePathData", () => {
  it("draws a plain rectangle", () => {
    expect(shapePathData("rect", 100, 50)).toBe("M0 0H100V50H0Z");
  });

  it("rounds the corners of a rectangle, but never beyond half of the shorter side", () => {
    expect(shapePathData("rect", 100, 50, { radius: 10 })).toContain("A10 10 0 0 1");
    expect(shapePathData("rect", 100, 50, { radius: 1000 })).toContain("A25 25 0 0 1");
    expect(shapePathData("rect", 100, 50, { radius: 0.005 })).toBe("M0 0H100V50H0Z");
    expect(shapePathData("rect", 100, 50, { radius: -5 })).toBe("M0 0H100V50H0Z");
  });

  it("draws an ellipse as two arcs", () => {
    expect(shapePathData("ellipse", 100, 60)).toBe("M0 30A50 30 0 1 0 100 30A50 30 0 1 0 0 30Z");
  });

  it("stretches a custom path from its 100 x 100 box to the element", () => {
    expect(shapePathData("path", 200, 50, { path: "M0 0L100 100" })).toBe("M0 0L200 50");
  });

  it("falls back to a rectangle for a custom path with no data and for unknown shapes", () => {
    expect(shapePathData("path", 100, 50)).toBe("M0 0H100V50H0Z");
    expect(shapePathData("no-such-shape", 100, 50)).toBe("M0 0H100V50H0Z");
  });

  it("has no outline for an empty box", () => {
    expect(shapePathData("rect", 0, 50)).toBe("");
    expect(shapePathData("ellipse", 50, -1)).toBe("");
    expect(shapePathData("path", 0, 0, { path: "M0 0" })).toBe("");
  });

  it("takes the number of sides of a polygon from its parameters, at least three", () => {
    const vertices = (sides?: number) => polygonPoints(shapePathData("polygon", 100, 100, sides === undefined ? {} : { params: { sides } }))!.length;
    expect(vertices()).toBe(7);
    expect(vertices(5)).toBe(5);
    expect(vertices(2)).toBe(3);
    expect(vertices(4.6)).toBe(5);
  });

  it("takes the points and the depth of a star from its parameters", () => {
    expect(polygonPoints(shapePathData("star", 100, 100))!).toHaveLength(10);
    expect(polygonPoints(shapePathData("star", 100, 100, { params: { points: 8, inner: 0.6 } }))!).toHaveLength(16);
    expect(polygonPoints(shapePathData("star", 100, 100, { params: { points: 1 } }))!).toHaveLength(6);
    const deep = polygonPoints(shapePathData("star", 100, 100, { params: { inner: 0.1 } }))!;
    const shallow = polygonPoints(shapePathData("star", 100, 100, { params: { inner: 0.9 } }))!;
    // the second point of a star is an inner one: closer to the centre when the star is deeper
    const radius = (p: [number, number]) => Math.hypot(p[0] - 50, p[1] - 50);
    expect(radius(deep[1])).toBeLessThan(radius(shallow[1]));
  });

  it("cuts a hole out of a ring", () => {
    const ring = shapePathData("ring", 100, 100);
    expect(ring.match(/M/g)).toHaveLength(2);
    const thin = shapePathData("ring", 100, 100, { params: { inner: 0.9 } });
    expect(thin).toContain("A45 45");
  });

  it("makes scalloped edges from many points", () => {
    expect(polygonPoints(shapePathData("scallop", 100, 100))!).toHaveLength(240);
    expect(shapePathData("flower", 100, 100, { params: { lobes: 5, amp: 0.3 } })).not.toBe(shapePathData("flower", 100, 100));
  });

  it("scales a viewBox shape to any box", () => {
    const small = shapePathData("heart", 55, 50);
    const large = shapePathData("heart", 110, 100);
    expect(small).toMatch(/^M27\.5 50C/);
    expect(large).toMatch(/^M55 100C/);
  });

  it("brings the tip of the speech bubble's tail down to the bottom edge", () => {
    expect(shapePathData("speech", 135, 100)).toContain("L27 100");
  });
});

describe("the shape catalogue", () => {
  const GROUPS: ShapeGroup[] = ["basic", "polygons", "stars", "arrows", "symbols", "bubbles", "blobs"];

  it("has unique ids, readable names and a known group for every shape", () => {
    const ids = SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shape of SHAPES) {
      expect(shape.name.length, shape.id).toBeGreaterThan(1);
      expect(GROUPS, shape.id).toContain(shape.group);
      expect(getShape(shape.id)).toBe(shape);
    }
    expect(getShape("nope")).toBeUndefined();
  });

  it.each(SHAPES.map((s) => [s.id]))("%s: one closed outline made of finite numbers", (id) => {
    for (const [w, h] of [
      [120, 80],
      [10, 300],
      [1, 1],
    ]) {
      const d = shapePathData(id, w, h, { radius: 6 });
      expect(d.startsWith("M"), `${id} ${w}x${h}`).toBe(true);
      expect(d.endsWith("Z"), `${id} ${w}x${h}`).toBe(true);
      expect(d).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it("keeps every straight-edged shape inside its box", () => {
    let checked = 0;
    for (const shape of SHAPES) {
      const pts = polygonPoints(shapePathData(shape.id, 120, 80));
      if (!pts) continue;
      checked++;
      for (const [x, y] of pts) {
        expect(x, shape.id).toBeGreaterThanOrEqual(-0.01);
        expect(x, shape.id).toBeLessThanOrEqual(120.01);
        expect(y, shape.id).toBeGreaterThanOrEqual(-0.01);
        expect(y, shape.id).toBeLessThanOrEqual(80.01);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("gives regular polygons the right number of corners", () => {
    expect(polygonPoints(shapePathData("pentagon", 100, 100))!).toHaveLength(5);
    expect(polygonPoints(shapePathData("hexagon", 100, 100))!).toHaveLength(6);
    expect(polygonPoints(shapePathData("octagon", 100, 100))!).toHaveLength(8);
    expect(polygonPoints(shapePathData("triangle", 100, 100))!).toHaveLength(3);
    expect(polygonPoints(shapePathData("star-6", 100, 100))!).toHaveLength(12);
  });

  it("lets only the rectangle take a corner radius", () => {
    expect(SHAPES.filter((s) => s.hasRadius).map((s) => s.id)).toEqual(["rect"]);
  });

  it("fills the ring with the even-odd rule and everything else with the non-zero rule", () => {
    expect(shapeFillRule("ring")).toBe("evenodd");
    expect(shapeFillRule("rect")).toBe("nonzero");
    expect(shapeFillRule("path")).toBe("nonzero");
    expect(shapeFillRule("unknown")).toBe("nonzero");
    expect(SHAPES.filter((s) => s.fillRule).map((s) => s.id)).toEqual(["ring"]);
  });

  it("describes the outline of a shape element from its own properties", () => {
    const element = { shape: "rect", width: 100, height: 50, radius: 10, params: undefined, path: undefined };
    expect(shapePathOf(element)).toBe(shapePathData("rect", 100, 50, { radius: 10 }));
    expect(shapePathOf({ ...element, shape: "path", path: "M0 0L100 0" })).toBe("M0 0L100 0");
    expect(shapePathOf({ ...element, shape: "polygon", params: { sides: 3 } })).toBe(shapePathData("polygon", 100, 50, { params: { sides: 3 } }));
  });
});

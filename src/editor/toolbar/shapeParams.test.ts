import { describe, expect, it } from "vitest";
import { createShape } from "@/core/factory";
import { getShape, shapePathOf } from "@/render/shapePaths";
import { SHAPE_PARAM_CONTROLS, paramControlsFor, setShapeParam, shapeParam } from "./shapeParams";

describe("the numbers of a shape", () => {
  it("offers controls only for shapes that are in the catalogue and are drawn from the number they set", () => {
    for (const [id, controls] of Object.entries(SHAPE_PARAM_CONTROLS)) {
      const def = getShape(id);
      expect(def, id).toBeDefined();
      for (const control of controls) {
        expect(def?.params?.[control.key], `${id}.${control.key}`).toBeTypeOf("number");
        expect(control.min).toBeLessThan(control.max);
        // the number the shape starts with lies within the limits of its control
        const start = shapeParam(createShape(id), control);
        expect(start, `${id}.${control.key}`).toBeGreaterThanOrEqual(control.min);
        expect(start, `${id}.${control.key}`).toBeLessThanOrEqual(control.max);
      }
    }
  });

  it("has controls for a selection of one kind, and none for mixed kinds, a plain shape or nothing", () => {
    expect(paramControlsFor([createShape("polygon"), createShape("polygon")]).map((c) => c.key)).toEqual(["sides"]);
    expect(paramControlsFor([createShape("star")]).map((c) => c.key)).toEqual(["points", "inner"]);
    expect(paramControlsFor([createShape("ring")]).map((c) => c.label)).toEqual(["Size of the hole"]);
    expect(paramControlsFor([createShape("polygon"), createShape("star")])).toEqual([]);
    expect(paramControlsFor([createShape("rect")])).toEqual([]);
    expect(paramControlsFor([])).toEqual([]);
  });

  it("reads the number a shape has, or the one its kind starts with, a share as a percentage", () => {
    const [points, inner] = SHAPE_PARAM_CONTROLS.star;
    const star = createShape("star");
    expect(shapeParam(star, points)).toBe(5);
    expect(shapeParam(star, inner)).toBe(42);
    expect(shapeParam(createShape("star", { params: { points: 8, inner: 0.305 } }), points)).toBe(8);
    expect(shapeParam(createShape("star", { params: { points: 8, inner: 0.305 } }), inner)).toBe(31);
    // a control of a shape that is not in the catalogue reads nothing
    expect(shapeParam(createShape("nowhere"), points)).toBe(0);
  });

  it("sets a number within the limits of its control, keeps the others, and the shape is drawn from it", () => {
    const [sides] = SHAPE_PARAM_CONTROLS.polygon;
    const polygon = createShape("polygon", { width: 100, height: 100 });
    const before = shapePathOf(polygon);
    setShapeParam(polygon, sides, 5);
    expect(polygon.params).toEqual({ sides: 5 });
    expect(shapePathOf(polygon)).not.toBe(before);
    setShapeParam(polygon, sides, 99);
    expect(polygon.params?.sides).toBe(12);
    setShapeParam(polygon, sides, -4);
    expect(polygon.params?.sides).toBe(3);
    setShapeParam(polygon, sides, 6.6);
    expect(polygon.params?.sides).toBe(7);

    const [points, inner] = SHAPE_PARAM_CONTROLS.star;
    const star = createShape("star", { params: { points: 9 } });
    setShapeParam(star, inner, 25);
    expect(star.params).toEqual({ points: 9, inner: 0.25 });
    setShapeParam(star, points, 12);
    expect(star.params).toEqual({ points: 12, inner: 0.25 });
  });
});

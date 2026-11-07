import { describe, expect, it } from "vitest";
import { IDENTITY, inverseLinear, multiply } from "./links";

describe("inverseLinear", () => {
  it("leaves an offset alone where nothing is rotated or flipped", () => {
    expect(inverseLinear(IDENTITY, 3, -4)).toEqual({ x: 3, y: -4 });
  });

  it("turns an offset on the page back into the offset in the element's own space", () => {
    // an element turned a quarter turn: a push to the right on the page is a push down inside the element
    const quarter = [0, 1, -1, 0, 0, 0] as const;
    const local = inverseLinear(quarter, 5, 0);
    expect(local.x).toBeCloseTo(0);
    expect(local.y).toBeCloseTo(-5);
    // and back again
    const [a, b, c, d] = quarter;
    expect(a * local.x + c * local.y).toBeCloseTo(5);
    expect(b * local.x + d * local.y).toBeCloseTo(0);
  });

  it("follows a flip", () => {
    expect(inverseLinear([-1, 0, 0, 1, 0, 0], 4, 2)).toEqual({ x: -4, y: 2 });
  });

  it("ignores where an element is, and only looks at how it is turned and scaled", () => {
    expect(inverseLinear([2, 0, 0, 2, 100, 200], 8, 4)).toEqual({ x: 4, y: 2 });
  });

  it("gives the offset back unchanged for a matrix that squashes the element flat", () => {
    expect(inverseLinear([0, 0, 0, 0, 10, 10], 7, 9)).toEqual({ x: 7, y: 9 });
    expect(inverseLinear([1, 2, 2, 4, 0, 0], 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it("agrees with multiplying by the matrix", () => {
    const m = multiply([1, 0, 0, 1, 5, 5], [Math.cos(0.7), Math.sin(0.7), -Math.sin(0.7), Math.cos(0.7), 0, 0]);
    const local = inverseLinear(m, 3, 4);
    expect(m[0] * local.x + m[2] * local.y).toBeCloseTo(3);
    expect(m[1] * local.x + m[3] * local.y).toBeCloseTo(4);
  });
});

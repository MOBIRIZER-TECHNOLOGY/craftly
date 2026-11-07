import { describe, expect, it } from "vitest";
import { createLine, createShape } from "./factory";
import {
  boundsOfElements,
  boxBounds,
  boxCenter,
  boxCorners,
  clamp,
  coverBox,
  distance,
  elementBounds,
  fitInside,
  fromLocalPoint,
  hitTestElement,
  lerp,
  normalizeDeg,
  pointInRect,
  rectCenter,
  rectContains,
  rectFromPoints,
  rectsIntersect,
  rotatePoint,
  round,
  snapAngle,
  toLocalPoint,
  unionRects,
} from "./geometry";

describe("number helpers", () => {
  it("clamps, interpolates and rounds", () => {
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]);
    expect([lerp(10, 20, 0), lerp(10, 20, 1), lerp(10, 20, 0.25), lerp(10, 20, 2)]).toEqual([10, 20, 12.5, 30]);
    expect(round(1.23456)).toBe(1.23);
    expect(round(1.23456, 4)).toBe(1.2346);
    expect(round(1234.5, 0)).toBe(1235);
    expect(round(-1.005, 1)).toBe(-1);
  });

  it("measures the distance between two points", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });

  it("wraps any angle into the range above -180 up to 180", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(360)).toBe(0);
    expect(Math.abs(normalizeDeg(-720))).toBe(0);
  });

  it("snaps an angle to the nearest step, and with a threshold only when it is close enough", () => {
    expect(snapAngle(14)).toBe(15);
    expect(snapAngle(22)).toBe(15);
    expect(snapAngle(23)).toBe(30);
    expect(snapAngle(40, 45)).toBe(45);
    expect(snapAngle(100, 90, 5)).toBe(100);
    expect(snapAngle(88, 90, 5)).toBe(90);
  });
});

describe("rotation", () => {
  it("turns a point about a centre, clockwise on the page", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it("returns a copy of the point for no rotation", () => {
    const p = { x: 3, y: 4 };
    const q = rotatePoint(p, { x: 0, y: 0 }, 0);
    expect(q).toEqual(p);
    expect(q).not.toBe(p);
  });

  it("finds the corners of a box in order, before and after rotation", () => {
    const box = { x: 0, y: 0, width: 20, height: 10, rotation: 0 };
    expect(boxCorners(box)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(boxCenter(box)).toEqual({ x: 10, y: 5 });
    const turned = boxCorners({ ...box, rotation: 90 });
    expect(turned[0].x).toBeCloseTo(15);
    expect(turned[0].y).toBeCloseTo(-5);
    expect(turned[2].x).toBeCloseTo(5);
    expect(turned[2].y).toBeCloseTo(15);
  });

  it("converts between page and element coordinates both ways", () => {
    const box = { x: 40, y: 30, width: 100, height: 20, rotation: 33 };
    const page = fromLocalPoint(box, { x: 12, y: 7 });
    const local = toLocalPoint(box, page);
    expect(local.x).toBeCloseTo(12);
    expect(local.y).toBeCloseTo(7);
    expect(fromLocalPoint({ ...box, rotation: 0 }, { x: 0, y: 0 })).toEqual({ x: 40, y: 30 });
  });
});

describe("rectangles", () => {
  it("takes the bounds of a box, rotated or not", () => {
    expect(boxBounds({ x: 5, y: 6, width: 10, height: 20, rotation: 0 })).toEqual({ x: 5, y: 6, w: 10, h: 20 });
    const turned = boxBounds({ x: 0, y: 0, width: 100, height: 20, rotation: 90 });
    expect([turned.x, turned.y, turned.w, turned.h].map(Math.round)).toEqual([40, -40, 20, 100]);
    expect(elementBounds(createShape("rect", { x: 1, y: 2, width: 3, height: 4 }))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("joins rectangles, and nothing is nothing", () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: -5, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 0, y: -5, w: 30, h: 15 });
    expect(boundsOfElements([])).toBeNull();
    expect(boundsOfElements([createShape("rect", { x: 0, y: 0, width: 10, height: 10 }), createShape("rect", { x: 50, y: 50, width: 10, height: 10 })])).toEqual({
      x: 0,
      y: 0,
      w: 60,
      h: 60,
    });
  });

  it("finds the centre of a rectangle", () => {
    expect(rectCenter({ x: 10, y: 20, w: 30, h: 40 })).toEqual({ x: 25, y: 40 });
  });

  it("tells whether two rectangles overlap, touching edges do not count", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 10, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(a, { x: -20, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: -20, w: 10, h: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 2, y: 2, w: 1, h: 1 })).toBe(true);
  });

  it("tells whether one rectangle holds another, edges included", () => {
    const outer = { x: 0, y: 0, w: 100, h: 100 };
    expect(rectContains(outer, { x: 10, y: 10, w: 20, h: 20 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
    expect(rectContains(outer, { x: -1, y: 10, w: 20, h: 20 })).toBe(false);
    expect(rectContains(outer, { x: 10, y: -1, w: 20, h: 20 })).toBe(false);
    expect(rectContains(outer, { x: 90, y: 10, w: 20, h: 20 })).toBe(false);
    expect(rectContains(outer, { x: 10, y: 90, w: 20, h: 20 })).toBe(false);
  });

  it("tells whether a point is inside a rectangle, edges included", () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(pointInRect({ x: 10, y: 10 }, r)).toBe(true);
    expect(pointInRect({ x: 30, y: 30 }, r)).toBe(true);
    expect(pointInRect({ x: 9.9, y: 20 }, r)).toBe(false);
    expect(pointInRect({ x: 20, y: 30.1 }, r)).toBe(false);
    expect(pointInRect({ x: 30.1, y: 20 }, r)).toBe(false);
    expect(pointInRect({ x: 20, y: 9.9 }, r)).toBe(false);
  });

  it("makes a rectangle of a drag in any direction", () => {
    expect(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 80 })).toEqual({ x: 10, y: 40, w: 40, h: 40 });
    expect(rectFromPoints({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1, w: 0, h: 0 });
  });
});

describe("hit testing", () => {
  it("hits inside a box and not outside, with extra reach from the slop", () => {
    const el = createShape("rect", { x: 10, y: 10, width: 100, height: 50 });
    expect(hitTestElement(el, { x: 50, y: 30 })).toBe(true);
    expect(hitTestElement(el, { x: 5, y: 30 })).toBe(false);
    expect(hitTestElement(el, { x: 5, y: 30 }, 6)).toBe(true);
    expect(hitTestElement(el, { x: 50, y: 65 }, 4)).toBe(false);
    expect(hitTestElement(el, { x: 50, y: 5 })).toBe(false);
    expect(hitTestElement(el, { x: 115, y: 30 })).toBe(false);
  });

  it("hits a line near its stroke, widened by the slop and a little more", () => {
    const line = createLine({ x: 0, y: 100, width: 200, stroke: { color: "#000000", width: 4, style: "solid" } });
    expect(hitTestElement(line, { x: 100, y: 100 })).toBe(true);
    expect(hitTestElement(line, { x: 100, y: 104 })).toBe(true);
    expect(hitTestElement(line, { x: 100, y: 110 })).toBe(false);
    expect(hitTestElement(line, { x: 100, y: 110 }, 5)).toBe(true);
    // beyond the end the distance is to the end point
    expect(hitTestElement(line, { x: 204, y: 100 })).toBe(true);
    expect(hitTestElement(line, { x: 215, y: 100 })).toBe(false);
  });

  it("hits a line of no length around its point", () => {
    const dot = createLine({ x: 50, y: 50, width: 0, stroke: { color: "#000000", width: 2, style: "solid" } });
    expect(hitTestElement(dot, { x: 51, y: 50 })).toBe(true);
    expect(hitTestElement(dot, { x: 80, y: 50 })).toBe(false);
  });

  it("hits a turned element in its own frame", () => {
    const el = createShape("rect", { x: 0, y: 0, width: 100, height: 20, rotation: 90 });
    expect(hitTestElement(el, { x: 50, y: 45 })).toBe(true);
    expect(hitTestElement(el, { x: 90, y: 10 })).toBe(false);
  });
});

describe("fitting boxes", () => {
  it("fits a box inside another keeping its shape", () => {
    expect(fitInside(200, 100, 100, 100)).toEqual({ w: 100, h: 50 });
    expect(fitInside(100, 200, 100, 100)).toEqual({ w: 50, h: 100 });
    expect(fitInside(50, 50, 100, 200)).toEqual({ w: 100, h: 100 });
  });

  it("covers a box with another keeping its shape", () => {
    expect(coverBox(200, 100, 100, 100)).toEqual({ w: 200, h: 100 });
    expect(coverBox(100, 200, 100, 100)).toEqual({ w: 100, h: 200 });
    expect(coverBox(50, 50, 100, 200)).toEqual({ w: 200, h: 200 });
  });
});

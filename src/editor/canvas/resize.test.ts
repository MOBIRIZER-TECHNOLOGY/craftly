import { describe, expect, it } from "vitest";
import { angleToPointer, handleFraction, HANDLE_VEC, isCorner, resizeBox, scaleOf, type Handle } from "./resize";

const box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

describe("resizeBox with the proportions kept", () => {
  it("grows the height with the width from a side handle and stays centred on the other axis", () => {
    const r = resizeBox(box, "e", { x: 400, y: 0 }, { keepAspect: true });
    expect(r).toMatchObject({ x: 100, y: 75, width: 300, height: 150 });
  });

  it("grows the width with the height from the top or bottom handle", () => {
    expect(resizeBox(box, "s", { x: 0, y: 250 }, { keepAspect: true })).toMatchObject({ x: 50, y: 100, width: 300, height: 150 });
    expect(resizeBox(box, "n", { x: 0, y: 50 }, { keepAspect: true })).toMatchObject({ x: 50, y: 50, width: 300, height: 150 });
  });

  it("works from the west handle too", () => {
    const r = resizeBox(box, "w", { x: 0, y: 999 }, { keepAspect: true });
    expect(r).toMatchObject({ x: 0, y: 75, width: 300, height: 150 });
  });

  it("follows the larger of the two movements on a corner", () => {
    const wide = resizeBox(box, "se", { x: 500, y: 150 }, { keepAspect: true });
    expect([wide.width, wide.height]).toEqual([400, 200]);
    const tall = resizeBox(box, "se", { x: 320, y: 400 }, { keepAspect: true });
    expect([tall.width, tall.height]).toEqual([600, 300]);
  });

  it("keeps the proportions around the centre too", () => {
    const r = resizeBox(box, "se", { x: 400, y: 200 }, { keepAspect: true, fromCenter: true });
    expect(r).toMatchObject({ x: 0, y: 50, width: 400, height: 200 });
  });

  it("does not stretch the height of a width-only box", () => {
    const r = resizeBox(box, "e", { x: 500, y: 900 }, { keepAspect: true, widthOnly: true });
    expect([r.width, r.height]).toEqual([400, 100]);
  });

  it("never goes below the minimum size on either side", () => {
    const r = resizeBox(box, "se", { x: 0, y: 0 }, { keepAspect: true, minSize: 20 });
    expect(r.width).toBeGreaterThanOrEqual(20);
    expect(r.height).toBeGreaterThanOrEqual(20);
  });
});

describe("resizeBox on a turned box", () => {
  it("keeps the rotation and the opposite corner in place", () => {
    const turned = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
    const r = resizeBox(turned, "se", { x: 100, y: 350 });
    expect(r.rotation).toBe(90);
    // the corner opposite the dragged one (the box's top left, which turned by 90 degrees sits at the top right: (250, 50))
    const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    expect(centre.x + r.height / 2).toBeCloseTo(250);
    expect(centre.y - r.width / 2).toBeCloseTo(50);
  });
});

describe("handle helpers", () => {
  it("knows which handles are corners", () => {
    const corners = (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).filter(isCorner);
    expect(corners).toEqual(["nw", "ne", "se", "sw"]);
  });

  it("describes each handle as a direction", () => {
    expect(HANDLE_VEC.nw).toEqual([-1, -1]);
    expect(HANDLE_VEC.e).toEqual([1, 0]);
    expect(HANDLE_VEC.s).toEqual([0, 1]);
  });

  it("places each handle on the box as a fraction of its size", () => {
    expect(handleFraction("nw")).toEqual([0, 0]);
    expect(handleFraction("n")).toEqual([0.5, 0]);
    expect(handleFraction("e")).toEqual([1, 0.5]);
    expect(handleFraction("se")).toEqual([1, 1]);
    expect(handleFraction("w")).toEqual([0, 0.5]);
  });

  it("gives real numbers for a box with no height or no width (lines side by side), whatever the handle", () => {
    const flat = { x: 100, y: 100, width: 200, height: 0, rotation: 0 };
    const thin = { x: 100, y: 100, width: 0, height: 200, rotation: 0 };
    for (const b of [flat, thin]) {
      for (const handle of Object.keys(HANDLE_VEC) as Handle[]) {
        for (const opts of [{}, { keepAspect: true }, { keepAspect: true, fromCenter: true }]) {
          const r = resizeBox(b, handle, { x: 340, y: 260 }, opts);
          expect([r.x, r.y, r.width, r.height].every(Number.isFinite), `${handle} ${JSON.stringify(opts)}`).toBe(true);
        }
      }
    }
  });

  it("scales by the change of a side, and not at all where there was no side to begin with", () => {
    expect(scaleOf(300, 200)).toBe(1.5);
    expect(scaleOf(6, 0)).toBe(1);
    expect(scaleOf(0, 0)).toBe(1);
    expect(scaleOf(Number.NaN, 10)).toBe(1);
  });

  it("measures the rotation that points the rotate handle at the pointer", () => {
    expect(angleToPointer({ x: 10, y: 10 }, { x: 10, y: 60 })).toBeCloseTo(0);
    expect(angleToPointer({ x: 10, y: 10 }, { x: 60, y: 10 })).toBeCloseTo(-90);
    expect(angleToPointer({ x: 10, y: 10 }, { x: 10, y: -40 })).toBeCloseTo(-180);
  });
});

import { describe, expect, it } from "vitest";
import { createPage, createShape } from "@/core/factory";
import { resizeBox, angleToPointer } from "./resize";
import { computeTargets, snapEdges, snapMove } from "./snapping";
import { layoutFor, designToScreen, screenToDesign, initialMetrics } from "./viewStore";

const box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

describe("resizeBox", () => {
  it("drags the east handle, anchoring the west edge", () => {
    const r = resizeBox(box, "e", { x: 400, y: 150 });
    expect(r).toMatchObject({ x: 100, y: 100, width: 300, height: 100 });
  });
  it("drags the north-west corner, anchoring the south-east corner", () => {
    const r = resizeBox(box, "nw", { x: 50, y: 0 });
    expect(r).toMatchObject({ x: 50, y: 0, width: 250, height: 200 });
  });
  it("keeps aspect ratio on corner drags", () => {
    const r = resizeBox(box, "se", { x: 500, y: 200 }, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
  });
  it("resizes from the centre", () => {
    const r = resizeBox(box, "e", { x: 400, y: 150 }, { fromCenter: true });
    expect(r.width).toBe(400);
    expect(r.x).toBe(0);
  });
  it("works in the rotated frame and keeps the opposite edge fixed", () => {
    const rot = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
    // rotated 90deg: the local "east" edge now faces down. Dragging it further down grows the width.
    const before = resizeBox(rot, "e", { x: 200, y: 300 });
    // west edge midpoint in world space before: centre(200,150) + R(-100,0) = (200,50)
    // after: new centre = west + R(w/2, 0) with w = 250 -> (200, 50 + 125)
    expect(before.width).toBeCloseTo(250);
    const cx = before.x + before.width / 2;
    const cy = before.y + before.height / 2;
    expect(cx).toBeCloseTo(200);
    expect(cy).toBeCloseTo(175);
  });
  it("never goes below the minimum size", () => {
    const r = resizeBox(box, "e", { x: 0, y: 150 }, { minSize: 10 });
    expect(r.width).toBe(10);
  });
  it("width-only mode ignores vertical drags", () => {
    const r = resizeBox(box, "se", { x: 500, y: 900 }, { widthOnly: true });
    expect(r.height).toBe(100);
  });
  it("computes rotation from a pointer below / right of the centre", () => {
    expect(angleToPointer({ x: 0, y: 0 }, { x: 0, y: 50 })).toBeCloseTo(0);
    expect(angleToPointer({ x: 0, y: 0 }, { x: -50, y: 0 })).toBeCloseTo(90);
  });
});

describe("snapping", () => {
  const page = createPage();
  page.elements.push(createShape("rect", { id: "a", x: 700, y: 100, width: 100, height: 100 }));
  const targets = computeTargets(page, 1000, 600, new Set(["moving"]));

  it("snaps a moving box to the page centre and reports a guide", () => {
    const r = snapMove({ x: 448, y: 10, w: 100, h: 50 }, targets, 6);
    expect(r.dx).toBe(2); // centre 498 -> 500
    expect(r.guides.some((g) => g.axis === "v" && g.pos === 500)).toBe(true);
  });
  it("snaps to another element's edge", () => {
    const r = snapMove({ x: 703, y: 300, w: 80, h: 80 }, targets, 6);
    expect(r.dx).toBe(-3); // left edge 703 -> element left edge 700
  });
  it("does nothing beyond the threshold", () => {
    const r = snapMove({ x: 520, y: 330, w: 100, h: 50 }, targets, 6);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides).toHaveLength(0);
  });
  it("excludes the moving elements from the targets", () => {
    const t = computeTargets(page, 1000, 600, new Set(["a"]));
    expect(t.xs).toHaveLength(3);
  });
  it("snaps only the dragged edges when resizing", () => {
    const r = snapEdges({ x: 100, y: 100, w: 397, h: 50 }, { right: true }, targets, 6);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
  });
});

describe("view geometry", () => {
  it("centres a small page and round-trips coordinates", () => {
    const l = layoutFor(1000, 500, 0.5, 1200, 800);
    expect(l.pageW).toBe(500);
    expect(l.pageLeft).toBe(350);
    const m = { ...initialMetrics, ...l, zoom: 0.5, scrollLeft: 0, scrollTop: 0 };
    const s = designToScreen(m, 100, 100);
    const d = screenToDesign(m, s.x, s.y);
    expect(d.x).toBeCloseTo(100);
    expect(d.y).toBeCloseTo(100);
  });
  it("grows the scrollable area when zoomed in", () => {
    const l = layoutFor(1000, 500, 2, 1200, 800);
    expect(l.contentW).toBeGreaterThan(2000);
    expect(l.pageLeft).toBeGreaterThan(0);
  });
});

describe("guides as snap targets", () => {
  it("snaps to user guides on both axes", () => {
    const p = createPage();
    const t = computeTargets(p, 1920, 1080, new Set(), { vertical: [700], horizontal: [400] });
    const r = snapMove({ x: 703, y: 396, w: 120, h: 90 }, t, 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(4);
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });
});

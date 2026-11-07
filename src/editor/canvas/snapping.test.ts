import { describe, expect, it } from "vitest";
import { createPage, createShape } from "@/core/factory";
import { computeTargets, snapEdges, snapMove } from "./snapping";

const page = createPage({
  elements: [createShape("rect", { id: "a", x: 700, y: 100, width: 100, height: 100 }), createShape("rect", { id: "hidden", x: 300, y: 300, width: 50, height: 50, hidden: true })],
});
const targets = computeTargets(page, 1000, 600, new Set());

describe("computeTargets", () => {
  it("offers the page edges and centre plus the edges and centre of every visible element", () => {
    expect(targets.xs.map((l) => l.pos).sort((p, q) => p - q)).toEqual([0, 500, 700, 750, 800, 1000]);
    expect(targets.ys.map((l) => l.pos).sort((p, q) => p - q)).toEqual([0, 100, 150, 200, 300, 600]);
    expect(targets.xs.filter((l) => l.kind === "page")).toHaveLength(3);
    expect(targets.xs.find((l) => l.pos === 750)?.kind).toBe("center");
    expect(targets.xs.find((l) => l.pos === 700)?.kind).toBe("edge");
  });

  it("uses the outline of a turned element", () => {
    const turned = createPage({ elements: [createShape("rect", { id: "t", x: 100, y: 100, width: 200, height: 100, rotation: 90 })] });
    const t = computeTargets(turned, 1000, 600, new Set());
    // turned by 90 degrees about (200, 150), the box covers x 150..250 and y 50..250
    expect(t.xs.map((l) => l.pos)).toEqual(expect.arrayContaining([150, 200, 250]));
    expect(t.ys.map((l) => l.pos)).toEqual(expect.arrayContaining([50, 150, 250]));
  });

  it("adds ruler guides as page-wide lines", () => {
    const t = computeTargets(createPage(), 1000, 600, new Set(), { vertical: [123], horizontal: [456] });
    expect(t.xs.find((l) => l.pos === 123)).toMatchObject({ from: 0, to: 600, kind: "page" });
    expect(t.ys.find((l) => l.pos === 456)).toMatchObject({ from: 0, to: 1000, kind: "page" });
  });
});

describe("snapMove", () => {
  it("draws the guide from the element it snapped to across the moving box", () => {
    const r = snapMove({ x: 703, y: 300, w: 80, h: 80 }, targets, 6);
    expect(r.guides).toContainEqual({ axis: "v", pos: 700, from: 100, to: 380, kind: "edge" });
  });

  it("prefers the nearest line when several are in range", () => {
    const near = computeTargets(createPage(), 1000, 600, new Set(), { vertical: [102, 105], horizontal: [] });
    expect(snapMove({ x: 100, y: 10, w: 40, h: 40 }, near, 6).dx).toBe(2);
  });

  it("snaps both axes at once and reports a guide for each", () => {
    const r = snapMove({ x: 498, y: 298, w: 4, h: 4 }, targets, 6);
    expect([r.dx, r.dy]).toEqual([0, 0]);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(["h", "v"]);
  });
});

describe("snapEdges", () => {
  it("snaps the left edge only when the left handle is dragged", () => {
    const r = snapEdges({ x: 696, y: 10, w: 200, h: 50 }, { left: true }, targets, 6);
    expect(r.dx).toBe(4);
    expect(r.guides.some((g) => g.axis === "v" && g.pos === 700)).toBe(true);
  });

  it("snaps the top and bottom edges", () => {
    expect(snapEdges({ x: 10, y: 97, w: 50, h: 50 }, { top: true }, targets, 6).dy).toBe(3);
    expect(snapEdges({ x: 10, y: 10, w: 50, h: 190 }, { bottom: true }, targets, 6).dy).toBe(0);
    expect(snapEdges({ x: 10, y: 10, w: 50, h: 194 }, { bottom: true }, targets, 6).dy).toBe(-4);
  });

  it("does nothing for edges that are not being dragged", () => {
    const r = snapEdges({ x: 696, y: 97, w: 200, h: 50 }, {}, targets, 6);
    expect([r.dx, r.dy, r.guides.length]).toEqual([0, 0, 0]);
  });

  it("does nothing beyond the threshold", () => {
    const r = snapEdges({ x: 650, y: 10, w: 20, h: 20 }, { left: true, right: true }, targets, 6);
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([]);
  });

  it("snaps at exactly the threshold and not a pixel further", () => {
    // the line at x = 700 is 6 px (the threshold) from the first box and 7 px from the second; the one at y = 100 likewise
    expect(snapEdges({ x: 694, y: 10, w: 20, h: 20 }, { left: true }, targets, 6).dx).toBe(6);
    expect(snapEdges({ x: 693, y: 10, w: 20, h: 20 }, { left: true }, targets, 6).dx).toBe(0);
    expect(snapEdges({ x: 10, y: 94, w: 20, h: 20 }, { top: true }, targets, 6).dy).toBe(6);
    expect(snapEdges({ x: 10, y: 93, w: 20, h: 20 }, { top: true }, targets, 6).dy).toBe(0);
  });

  it("moves a whole box by whichever of its left edge, centre and right edge is nearest to the line at x = 700", () => {
    // the box is 20 wide, so those three points are x, x + 10 and x + 20
    expect(snapMove({ x: 694, y: 10, w: 20, h: 20 }, targets, 6).dx).toBe(-4); // the centre (704) is 4 past it, the left edge 6 short
    expect(snapMove({ x: 690, y: 10, w: 20, h: 20 }, targets, 6).dx).toBe(0); // the centre is already on it
    expect(snapMove({ x: 686, y: 10, w: 20, h: 20 }, targets, 6).dx).toBe(4); // the centre (696) is 4 short, the right edge 6 past
    expect(snapMove({ x: 650, y: 10, w: 20, h: 20 }, targets, 6).dx).toBe(0); // none of the three is within 6 px
  });
});

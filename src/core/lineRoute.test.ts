import { describe, expect, it } from "vitest";
import { createDesign, createLine, createPage, createShape } from "./factory";
import { fromLocalPoint, hitTestElement } from "./geometry";
import { lineLabelPoint, lineSegments } from "./lineRoute";
import { lineEndpoints, lineFromRoute, reflowLines } from "./connectors";
import { scaleElement } from "./ops";
import type { DesignElement, LineRouting } from "./types";

const start = { x: 0, y: 0 };
const end = { x: 300, y: 100 };

describe("line routes", () => {
  it.each(["straight", "elbow", "curved"] as LineRouting[])("keeps both endpoints of a %s route in page space", (routing) => {
    const line = createLine({ ...lineFromRoute(start, end, routing), routing });
    const ends = lineEndpoints(line);
    expect(ends.start.x).toBeCloseTo(start.x);
    expect(ends.start.y).toBeCloseTo(start.y);
    expect(ends.end.x).toBeCloseTo(end.x);
    expect(ends.end.y).toBeCloseTo(end.y);
    if (routing === "straight") expect(line.route).toBeUndefined();
    else expect(line.route).toHaveLength(4);
  });

  it("hit-tests the curved stroke and places its label at the curve's midpoint", () => {
    const line = createLine({ ...lineFromRoute(start, end, "curved"), routing: "curved" });
    expect(lineSegments(line)).toHaveLength(25);
    const label = fromLocalPoint(line, lineLabelPoint(line));
    expect(label.x).toBeGreaterThan(150);
    expect(label.y).toBeCloseTo(50);
    expect(hitTestElement(line, label)).toBe(true);
    expect(hitTestElement(line, { x: 50, y: 80 })).toBe(false);
  });

  it("follows a curve whose two pulls differ, down as well as across", () => {
    // a quarter of the way along: 0.421875 a + 0.421875 b + 0.140625 c + 0.015625 d, the same weights for x and for y
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 90 },
      { x: 100, y: 10 },
      { x: 100, y: 100 },
    ];
    const quarter = lineSegments({ width: 100, height: 100, routing: "curved", route })[6];
    expect(quarter.x).toBeCloseTo(15.625);
    expect(quarter.y).toBeCloseTo(40.9375);
  });

  it("scales every route point with the element", () => {
    const line = createLine({ ...lineFromRoute(start, end, "elbow"), routing: "elbow" });
    const before = structuredClone(line.route!);
    scaleElement(line, 2, 3);
    expect(line.route!.map((point) => [point.x, point.y])).toEqual(before.map((point) => [point.x * 2, point.y * 3]));
  });

  it("recomputes an attached line when its route or a connected shape changes", () => {
    const a = createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 100 });
    const b = createShape("rect", { id: "b", x: 400, y: 200, width: 100, height: 100 });
    const line = createLine({ id: "line", routing: "straight", start: { elementId: "a", anchor: "auto" }, end: { elementId: "b", anchor: "auto" } });
    const design = createDesign({ width: 800, height: 600, pages: [createPage({ elements: [a, b, line] })] });
    const before = reflowLines(design, null);
    const changed = {
      ...before,
      pages: before.pages.map((page) => ({
        ...page,
        elements: page.elements.map((el): DesignElement => (el.id === "line" && el.type === "line" ? { ...el, routing: "elbow", label: "Next" } : el)),
      })),
    };
    const routed = reflowLines(changed, before);
    const attached = routed.pages[0].elements.find((el) => el.id === "line") as Extract<DesignElement, { type: "line" }>;
    expect(attached.routing).toBe("elbow");
    expect(attached.label).toBe("Next");
    expect(attached.route).toHaveLength(4);
    const firstRoute = attached.route;
    const moved = {
      ...routed,
      pages: routed.pages.map((page) => ({ ...page, elements: page.elements.map((el) => (el.id === "b" ? { ...el, x: 500 } : el)) })),
    };
    const after = reflowLines(moved, routed);
    const movedLine = after.pages[0].elements.find((el) => el.id === "line") as Extract<DesignElement, { type: "line" }>;
    expect(movedLine.route).not.toEqual(firstRoute);
    expect(movedLine.end).toEqual({ elementId: "b", anchor: "auto" });
  });
});

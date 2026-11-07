import { describe, expect, it } from "vitest";
import { createGroup, createLine, createPage, createShape, createText } from "@/core/factory";
import { handlesFor, selectionFrame, worldBox } from "./frame";

describe("worldBox", () => {
  it("is the element's own box for a top level element", () => {
    const page = createPage({ elements: [createShape("rect", { id: "a", x: 10, y: 20, width: 30, height: 40, rotation: 15 })] });
    expect(worldBox(page, "a")).toEqual({ x: 10, y: 20, width: 30, height: 40, rotation: 15 });
  });

  it("composes the position and rotation of the groups around an element", () => {
    const child = createShape("rect", { id: "kid", x: 10, y: 20, width: 50, height: 30, rotation: 10 });
    const group = createGroup([child], { id: "g", x: 100, y: 100, width: 200, height: 200, rotation: 90 });
    const page = createPage({ elements: [group] });
    const box = worldBox(page, "kid")!;
    // the child's centre (35, 35) inside the group turns 90 degrees about the group's centre (200, 200)
    expect(box.x).toBeCloseTo(240);
    expect(box.y).toBeCloseTo(120);
    expect([box.width, box.height]).toEqual([50, 30]);
    expect(box.rotation).toBe(100);
  });

  it("looks through nested groups", () => {
    const inner = createGroup([createShape("rect", { id: "deep", x: 5, y: 5, width: 10, height: 10 })], { id: "inner", x: 20, y: 20, width: 50, height: 50 });
    const outer = createGroup([inner], { id: "outer", x: 100, y: 200, width: 100, height: 100 });
    const box = worldBox(createPage({ elements: [outer] }), "deep")!;
    expect([box.x, box.y, box.rotation]).toEqual([125, 225, 0]);
  });

  it("is null for an element that is not on the page", () => {
    const page = createPage({ elements: [createGroup([createShape("rect", { id: "kid" })], { id: "g" }), createShape("rect", { id: "a" })] });
    expect(worldBox(page, "nope")).toBeNull();
  });
});

describe("selectionFrame", () => {
  it("is null for an empty selection", () => {
    expect(selectionFrame([])).toBeNull();
  });

  it("follows the single selected element, rotation included", () => {
    const el = createShape("rect", { x: 10, y: 20, width: 30, height: 40, rotation: 25 });
    expect(selectionFrame([el])).toEqual({ x: 10, y: 20, width: 30, height: 40, rotation: 25, multi: false });
  });

  it("is the upright union of several elements", () => {
    const a = createShape("rect", { x: 10, y: 20, width: 30, height: 40 });
    const b = createShape("rect", { x: 100, y: 5, width: 50, height: 10 });
    expect(selectionFrame([a, b])).toEqual({ x: 10, y: 5, width: 140, height: 55, rotation: 0, multi: true });
  });
});

describe("handlesFor", () => {
  const eight = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  it("offers all eight handles for shapes and for several elements", () => {
    expect(handlesFor([createShape("rect")])).toEqual(eight);
    expect(handlesFor([createShape("rect"), createShape("ellipse")])).toEqual(eight);
  });

  it("offers a text box only the corners and the sides that change its width", () => {
    expect(handlesFor([createText({ text: "Hi" })])).toEqual(["nw", "ne", "se", "sw", "e", "w"]);
  });

  it("offers none for a line (it has its own end handles) or a locked element", () => {
    expect(handlesFor([createLine()])).toEqual([]);
    expect(handlesFor([createShape("rect", { locked: true })])).toEqual([]);
  });
});

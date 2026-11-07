import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createShape, createText } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { DesignElement, ShapeElement } from "@/core/types";
import { clampNumber, editElements, fillCss, only, sameIds, textRuns, worldBounds } from "./selection";

beforeEach(() => useEditor.setState(useEditor.getInitialState(), true));

function open(elements: DesignElement[]) {
  const page = createPage({ elements });
  useEditor.getState().actions.openDesign(createDesign({ width: 1000, height: 600, pages: [page] }));
  return getActivePage(useEditor.getState())!;
}

describe("fillCss previews", () => {
  it("previews radial gradients, patterns and photos as a CSS background", () => {
    expect(
      fillCss({
        type: "radial",
        stops: [
          { offset: 0, color: "#ffffff" },
          { offset: 1, color: "#000000" },
        ],
      }),
    ).toBe("radial-gradient(circle at 50% 50%, #ffffff 0%, #000000 100%)");
    expect(fillCss({ type: "radial", cx: 0.25, cy: 0.75, stops: [{ offset: 0.5, color: "#ff0000" }] })).toBe("radial-gradient(circle at 25% 75%, #ff0000 50%)");
    expect(fillCss({ type: "pattern", pattern: "dots", color: "#112233", background: "#ffffff", scale: 1 })).toBe(
      "repeating-linear-gradient(45deg, #112233 0 2px, #ffffff 2px 5px)",
    );
    expect(fillCss({ type: "image", src: "builtin:x", fit: "cover" })).toContain("var(--c-line-strong)");
  });
});

describe("text runs", () => {
  it("lists the runs that carry text and counts an empty box as one run that inherits the element", () => {
    const t = createText({ text: "" });
    expect(textRuns(t)).toEqual([{ text: "" }]);
    const two = createText({ text: "ab" });
    two.paragraphs = [{ runs: [{ text: "a" }, { text: "" }, { text: "b", bold: true }] }];
    expect(textRuns(two).map((r) => r.text)).toEqual(["a", "b"]);
  });
});

describe("worldBounds", () => {
  it("is the union of the boxes of the selected elements", () => {
    const [a, b] = [createShape("rect", { x: 10, y: 20, width: 100, height: 50 }), createShape("rect", { x: 200, y: 100, width: 40, height: 40 })];
    const page = open([a, b]);
    expect(worldBounds(page, [a.id])).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(worldBounds(page, [a.id, b.id])).toEqual({ x: 10, y: 20, w: 230, h: 120 });
  });

  it("places an element of a group by the group's position", () => {
    const inner = createShape("rect", { x: 5, y: 5, width: 20, height: 20 });
    const g = createGroup([inner], { x: 100, y: 200, width: 50, height: 50 });
    const page = open([g]);
    expect(worldBounds(page, [inner.id])).toEqual({ x: 105, y: 205, w: 20, h: 20 });
  });

  it("is the outline of a rotated element, and null for nothing or unknown ids", () => {
    const r = createShape("rect", { x: 100, y: 100, width: 100, height: 100, rotation: 45 });
    const page = open([r]);
    const b = worldBounds(page, [r.id])!;
    expect(b.w).toBeCloseTo(Math.SQRT2 * 100, 3);
    expect(worldBounds(page, [])).toBeNull();
    expect(worldBounds(page, ["missing"])).toBeNull();
  });
});

describe("editElements and only", () => {
  it("writes to the elements as one undo step", () => {
    const [a, b] = [createShape("rect"), createShape("rect")];
    open([a, b]);
    const before = useEditor.getState().past.length;
    editElements([a.id, b.id], (el) => {
      el.opacity = 0.5;
    });
    const page = getActivePage(useEditor.getState())!;
    expect(page.elements.map((e) => e.opacity)).toEqual([0.5, 0.5]);
    expect(useEditor.getState().past.length).toBe(before + 1);
  });

  it("merges repeated edits with the same key and ids into one step", () => {
    const a = createShape("rect");
    open([a]);
    const before = useEditor.getState().past.length;
    for (const v of [0.9, 0.8, 0.7]) editElements([a.id], (el) => void (el.opacity = v), "opacity");
    expect(getActivePage(useEditor.getState())!.elements[0].opacity).toBe(0.7);
    expect(useEditor.getState().past.length).toBe(before + 1);
  });

  it("does nothing for an empty list of ids", () => {
    const a = createShape("rect");
    open([a]);
    const before = useEditor.getState().past.length;
    editElements([], (el) => void (el.opacity = 0));
    expect(useEditor.getState().past.length).toBe(before);
  });

  it("restricts a patch to one type of element", () => {
    const [shape, text] = [createShape("rect"), createText({ text: "x" })];
    open([shape, text]);
    editElements(
      [shape.id, text.id],
      only("shape", (s) => {
        s.radius = 12;
      }),
    );
    const [s, t] = getActivePage(useEditor.getState())!.elements;
    expect((s as ShapeElement).radius).toBe(12);
    expect(t).not.toHaveProperty("radius");
  });
});

describe("small helpers", () => {
  it("clamps numbers", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-5, 0, 10)).toBe(0);
    expect(clampNumber(50, 0, 10)).toBe(10);
  });

  it("compares id lists by content and order", () => {
    expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
    expect(sameIds([], [])).toBe(true);
  });
});

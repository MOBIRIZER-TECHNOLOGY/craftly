/**
 * The Pen tool through the pointer controller: clicks place points, a drag pulls a curve out of a point, the path ends with a
 * click on its last point (or on its first, to close it), and the result is an ordinary path shape on the page.
 */
import { act, configure } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createPage } from "@/core/factory";
import { elementPath } from "@/core/penShape";
import { getActions, useEditor } from "@/core/store";
import type { ShapeElement } from "@/core/types";
import { setDrawSettings } from "@/editor/panels/shared/drawSettings";
import { canvasDesign, currentPage, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { useGesture } from "./gestureStore";
import { backspacePen, cancelPen, finishPen, hasPenDraft } from "./penTool";

configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const pen = () => useGesture.getState().pen;
const paths = () => currentPage().elements.filter((e): e is ShapeElement => e.type === "shape" && e.shape === "path");
const pickUpPen = () => act(() => getActions().setTool("pen"));
const click = (rig: CanvasRig, x: number, y: number, opts?: Parameters<CanvasRig["down"]>[2]) => {
  rig.down(x, y, opts);
  rig.up(x, y, opts);
};

afterEach(() => {
  act(() => cancelPen());
  setDrawSettings({ color: "#0e1318", width: null });
});

describe("placing points", () => {
  it("shows the tool on the canvas", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    expect(rig.host.className).toContain("cf-workspace--tool-pen");
  });

  it("adds a corner point for each click and shows the path so far", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    expect(pen()!.path.nodes.map((n) => [n.x, n.y])).toEqual([
      [100, 100],
      [300, 100],
    ]);
    expect(pen()!.path.nodes.every((n) => !n.handleIn && !n.handleOut)).toBe(true);
    expect(hasPenDraft()).toBe(true);
    expect(paths()).toHaveLength(0);
    expect(rig.container.querySelector(".cf-penpreview")).toBeTruthy();
  });

  it("shows the side that the next click would make, following the pointer", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    rig.move(250, 250);
    expect(pen()!.hover).toEqual({ x: 250, y: 250 });
    expect(rig.container.querySelector(".cf-penpreview__rubber")).toBeTruthy();
  });

  it("has nothing to follow the pointer with until a point is placed", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    rig.move(250, 250);
    expect(pen()).toBeNull();
    expect(rig.container.querySelector(".cf-penpreview")).toBeNull();
  });

  it("keeps the side that follows the pointer at a multiple of 45 degrees with Shift held", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    rig.move(300, 130, { shift: true });
    expect(pen()!.hover!.x).toBeCloseTo(300, 0);
    expect(pen()!.hover!.y).toBeCloseTo(100, 6);
    rig.move(300, 130);
    expect(pen()!.hover).toEqual({ x: 300, y: 130 });
  });

  it("does not take a click on an element for a selection: the pen starts a path there", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 300, 300);
    expect(state().selection).toEqual([]);
    expect(pen()!.path.nodes).toHaveLength(1);
  });

  it("keeps a side at a multiple of 45 degrees with Shift held", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 130, { shift: true }); // about 8.5 degrees: flat
    click(rig, 330, 340, { shift: true }); // nearly straight down
    const [a, b, c] = pen()!.path.nodes;
    expect([a.x, a.y]).toEqual([100, 100]);
    expect(b.y).toBeCloseTo(100, 6);
    expect(b.x).toBeCloseTo(300, 0);
    expect(c.x).toBeCloseTo(b.x, 6);
    expect(c.y).toBeGreaterThan(300);
  });
});

describe("curves", () => {
  it("pulls handles out of a point that is pressed and dragged, one on each side", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 200);
    rig.down(300, 200);
    rig.move(360, 200);
    expect(pen()!.path.nodes[1].handleOut).toEqual({ x: 60, y: 0 });
    expect(pen()!.path.nodes[1].handleIn).toEqual({ x: -60, y: 0 });
    rig.move(360, 260);
    expect(pen()!.path.nodes[1].handleOut).toEqual({ x: 60, y: 60 });
    rig.up(360, 260);
    expect(pen()!.path.nodes[1].handleIn).toEqual({ x: -60, y: -60 });
  });

  it("leaves a point a corner when the pointer hardly moves", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 200);
    rig.down(300, 200);
    rig.move(301, 201);
    rig.up(301, 201);
    expect(pen()!.path.nodes[1].handleOut).toBeNull();
  });

  it("takes the handles away again when the pointer comes back to the point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 200);
    rig.down(300, 200);
    rig.move(360, 200);
    rig.move(300, 200);
    rig.up(300, 200);
    expect(pen()!.path.nodes[1].handleOut).toBeNull();
    expect(pen()!.path.nodes[1].handleIn).toBeNull();
  });

  it("draws a curve between points that have handles", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    rig.down(100, 300);
    rig.move(100, 200);
    rig.up(100, 200);
    click(rig, 300, 300);
    finishPen();
    const [shape] = paths();
    expect(shape.path).toMatch(/^M0 [\d.]+ C/);
  });

  it("lets the pointer go on after the path was finished in the middle of a drag", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 200);
    rig.down(300, 200);
    act(() => finishPen());
    rig.move(360, 200);
    rig.up(360, 200);
    expect(pen()).toBeNull();
    expect(paths()).toHaveLength(1);
    expect(elementPath(paths()[0])!.nodes[1].handleOut).toBeNull();
  });
});

describe("the hint that a click would close the path", () => {
  const rubber = (rig: CanvasRig) => rig.container.querySelector(".cf-penpreview__rubber")?.getAttribute("d");
  const closing = (rig: CanvasRig) => rig.container.querySelector(".cf-penpreview__node.is-closing");

  it("marks the first point, and runs the side that follows the pointer to it, once the pointer is close", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    click(rig, 300, 300);
    rig.move(150, 150);
    expect(closing(rig)).toBeNull();
    expect(rubber(rig)).toBe("M300 300 L150 150");
    rig.move(104, 103);
    expect(closing(rig)).toBeTruthy();
    expect(rubber(rig)).toBe("M300 300 L100 100");
  });

  it("does not offer it to a path of two points, which a click on its first point only adds to", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    rig.move(104, 103);
    expect(closing(rig)).toBeNull();
    expect(rubber(rig)).toBe("M300 100 L104 103");
  });
});

describe("finishing", () => {
  it("ends the path with a click on its last point, and makes a stroke with nothing inside", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    click(rig, 300, 300);
    click(rig, 300, 300);
    const [shape] = paths();
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([100, 100, 200, 200]);
    expect(shape.path).toBe("M0 0 L100 0 L100 100");
    expect(shape.fill).toBeNull();
    expect(shape.stroke).toMatchObject({ color: "#0e1318", style: "solid", cap: "round", join: "round" });
    expect(shape.stroke!.width).toBeGreaterThan(0);
    expect(pen()).toBeNull();
    expect(state().tool).toBe("select");
    expect(state().selection).toEqual([shape.id]);
  });

  it("closes the path with a click on its first point, and fills it", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    click(rig, 300, 300);
    click(rig, 104, 103); // within a few pixels of the first point
    const [shape] = paths();
    expect(shape.path).toBe("M0 0 L100 0 L100 100 L0 0 Z");
    expect(shape.fill).toEqual({ type: "solid", color: "#0e1318" });
    expect(shape.stroke).toBeNull();
  });

  it("adds a point instead of closing when a click lands near the first point of a path of two points", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    click(rig, 104, 103);
    expect(pen()!.path.nodes).toHaveLength(3);
    expect(paths()).toHaveLength(0);
  });

  it("uses the colour and width chosen for drawing", async () => {
    setDrawSettings({ color: "#ff0066", width: 9 });
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 300);
    finishPen();
    expect(paths()[0].stroke).toMatchObject({ color: "#ff0066", width: 9 });
  });

  it("is one step to undo, and one to redo", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 200, 100);
    click(rig, 300, 300);
    finishPen();
    expect(paths()).toHaveLength(1);
    act(() => getActions().undo());
    expect(paths()).toHaveLength(0);
    act(() => getActions().redo());
    expect(paths()).toHaveLength(1);
  });

  it("makes nothing from a single point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    finishPen();
    expect(paths()).toHaveLength(0);
    expect(pen()).toBeNull();
  });

  it("keeps the path that was drawn when the tool is put down", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 300);
    act(() => getActions().setTool("select"));
    expect(paths()).toHaveLength(1);
    expect(pen()).toBeNull();
  });

  it("leaves the tool that was chosen in place when the path is finished by choosing it", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 300);
    act(() => getActions().setTool("shape"));
    expect(paths()).toHaveLength(1);
    expect(state().tool).toBe("shape");
    expect(pen()).toBeNull();
  });

  it("throws the path away when asked to cancel", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 300);
    cancelPen();
    expect(paths()).toHaveLength(0);
    expect(pen()).toBeNull();
  });

  it("takes the last point back", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 100);
    click(rig, 300, 300);
    backspacePen();
    expect(pen()!.path.nodes.map((n) => [n.x, n.y])).toEqual([
      [100, 100],
      [300, 100],
    ]);
    backspacePen();
    backspacePen();
    expect(pen()).toBeNull();
    expect(hasPenDraft()).toBe(false);
  });

  it("has nothing to take back when no path is being placed", () => {
    backspacePen();
    expect(pen()).toBeNull();
  });

  it("starts again with a new path after one is finished and the tool is picked up again", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    click(rig, 100, 100);
    click(rig, 300, 300);
    finishPen();
    pickUpPen();
    click(rig, 500, 100);
    click(rig, 600, 300);
    finishPen();
    expect(paths()).toHaveLength(2);
  });
});

describe("when the page or the design changes while a path is being placed", () => {
  const twoPages = () => canvasDesign([], { pages: [createPage({ elements: [] }), createPage({ elements: [] })] });
  const pageElements = (index: number) => state().design!.pages[index].elements;
  const place = (rig: CanvasRig, ...points: Array<[number, number]>) => {
    pickUpPen();
    for (const [x, y] of points) click(rig, x, y);
  };

  it("keeps the path on the page it was drawn on, and leaves the new page, the pen and the selection as they are", async () => {
    const rig = await mountWorkspace(twoPages());
    const second = state().design!.pages[1];
    place(rig, [100, 100], [300, 300]);
    act(() => getActions().setActivePage(second.id));
    expect(pageElements(0)).toHaveLength(1);
    expect(pageElements(1)).toHaveLength(0);
    expect(state().activePageId).toBe(second.id);
    expect(state().tool).toBe("pen");
    expect(state().selection).toEqual([]);
    expect(pen()).toBeNull();
  });

  it("starts a new path on the new page with the next click", async () => {
    const rig = await mountWorkspace(twoPages());
    const second = state().design!.pages[1];
    place(rig, [100, 100], [300, 300]);
    act(() => getActions().setActivePage(second.id));
    click(rig, 500, 100);
    click(rig, 600, 300);
    finishPen();
    expect(pageElements(0)).toHaveLength(1);
    expect(pageElements(1)).toHaveLength(1);
  });

  it("makes nothing from a single point", async () => {
    const rig = await mountWorkspace(twoPages());
    place(rig, [100, 100]);
    act(() => getActions().setActivePage(state().design!.pages[1].id));
    expect(pageElements(0)).toHaveLength(0);
    expect(pen()).toBeNull();
  });

  it("throws the path away when the page it was drawn on is deleted", async () => {
    const rig = await mountWorkspace(twoPages());
    const second = state().design!.pages[1];
    act(() => getActions().setActivePage(second.id));
    place(rig, [100, 100], [300, 300]);
    act(() => getActions().deletePage(second.id));
    expect(state().design!.pages).toHaveLength(1);
    expect(pageElements(0)).toHaveLength(0);
    expect(pen()).toBeNull();
  });

  it("throws the path away when the design is closed", async () => {
    const rig = await mountWorkspace(twoPages());
    place(rig, [100, 100], [300, 300]);
    act(() => getActions().closeDesign());
    expect(pen()).toBeNull();
  });

  it("does not put the path into another design that is opened meanwhile", async () => {
    const rig = await mountWorkspace(twoPages());
    place(rig, [100, 100], [300, 300]);
    act(() => getActions().openDesign(canvasDesign()));
    expect(pen()).toBeNull();
    expect(pageElements(0)).toHaveLength(0);
  });
});

/**
 * Point editing of a path: the points and handles drawn over the path, selecting and dragging them, adding a point by
 * clicking the path, turning a point into a corner or a smooth point, and everything the keys and the toolbar do to the
 * selected points. Paths are checked in page coordinates, because that is what a person sees, whatever the element's turn.
 */
import { act, configure, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createShape } from "@/core/factory";
import { nodeKindOf } from "@/core/pen";
import { elementPath, localToDesign } from "@/core/penShape";
import { getActions, useEditor } from "@/core/store";
import type { ShapeElement } from "@/core/types";
import { canvasDesign, elementOf, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { closeEditedPath, deleteSelectedNodes, nudgeSelectedNodes, selectNodes, setSelectedKind, cycleSelectedNode } from "./pathEditActions";
import { startPathEdit, stopPathEdit, usePathEdit } from "./pathEditStore";

configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const shape = () => elementOf<ShapeElement>("p");
const nodes = () => elementPath(shape())!.nodes;
/** where a point of the path is on the page */
const onPage = (i: number) => localToDesign(shape(), nodes()[i]);
const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 1) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

/** An open path of three corners: (100, 100), (300, 100), (300, 200) on the page. */
const pathElement = (over: Partial<ShapeElement> = {}) =>
  createShape("path", {
    id: "p",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    fill: null,
    stroke: { color: "#112233", width: 4, style: "solid" },
    path: "M0 0 L100 0 L100 100",
    ...over,
  });

async function edit(over: Partial<ShapeElement> = {}) {
  const rig = await mountWorkspace(canvasDesign([pathElement(over), createShape("rect", { id: "other", x: 500, y: 400, width: 100, height: 100 })]));
  act(() => startPathEdit("p"));
  await waitFor(() => expect(rig.container.querySelector("[data-cf-pathedit]")).toBeTruthy());
  return rig;
}
const anchors = (rig: CanvasRig) => Array.from(rig.container.querySelectorAll<SVGElement>(".cf-pathedit__anchor"));
const handles = (rig: CanvasRig) => Array.from(rig.container.querySelectorAll<SVGElement>(".cf-pathedit__handle"));
const segments = (rig: CanvasRig) => Array.from(rig.container.querySelectorAll<SVGElement>(".cf-pathedit__segment"));

/** press on `target` where it is on the page, move to `to` (page px) in two steps and release */
function dragOn(rig: CanvasRig, target: Element, from: { x: number; y: number }, to: { x: number; y: number }, opts: { shift?: boolean; alt?: boolean } = {}) {
  const at = (p: { x: number; y: number }) => rig.client(p.x, p.y);
  const press = (type: "pointerDown" | "pointerMove" | "pointerUp", p: { x: number; y: number }) =>
    rig.pointerAt(type, at(p).clientX, at(p).clientY, { target, shift: opts.shift, alt: opts.alt });
  press("pointerDown", from);
  press("pointerMove", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  press("pointerMove", to);
  press("pointerUp", to);
}

afterEach(() => {
  act(() => stopPathEdit());
});

describe("opening the editor", () => {
  it("draws a point for each node and a path to click on for each side, over the path", async () => {
    const rig = await edit();
    expect(anchors(rig)).toHaveLength(3);
    expect(segments(rig)).toHaveLength(2);
    expect(rig.container.querySelector(".cf-pathedit__outline")).toBeTruthy();
    expect(usePathEdit.getState().id).toBe("p");
    expect(state().selection).toEqual(["p"]);
  });

  it("draws the closing side of a closed path as well", async () => {
    const rig = await edit({ path: "M0 0 L100 0 L100 100 L0 0 Z" });
    expect(anchors(rig)).toHaveLength(3);
    expect(segments(rig)).toHaveLength(3);
  });

  it("is turned and mirrored with the element", async () => {
    const rig = await edit({ rotation: 30, flipH: true });
    const overlay = rig.container.querySelector<HTMLElement>("[data-cf-pathedit]")!;
    expect(overlay.style.transform).toContain("rotate(30deg)");
    expect(rig.container.querySelector<SVGElement>(".cf-pathedit__svg")!.style.transform).toContain("scale(-1, 1)");
  });

  it("is left out of what assistive technology reads: the points are for the pointer, the keys and the toolbar do the same", async () => {
    const rig = await edit();
    expect(rig.container.querySelector(".cf-pathedit__svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("is not there for a shape that is not a path, and gives the page back", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "p", x: 100, y: 100, width: 100, height: 100 })]));
    act(() => startPathEdit("p"));
    await waitFor(() => expect(usePathEdit.getState().id).toBeNull());
    expect(rig.container.querySelector("[data-cf-pathedit]")).toBeNull();
  });

  it("hides the frame and handles of the selection while the points are edited", async () => {
    const rig = await edit();
    expect(rig.container.querySelector(".cf-sel")).toBeNull();
    act(() => stopPathEdit());
    await waitFor(() => expect(rig.container.querySelector(".cf-sel")).toBeTruthy());
  });
});

describe("leaving", () => {
  it("ends when something else is clicked on the page", async () => {
    const rig = await edit();
    rig.down(520, 420);
    rig.up(520, 420);
    expect(usePathEdit.getState().id).toBeNull();
    expect(state().selection).toEqual(["other"]);
  });

  it("ends when the path itself is pressed away from its points, and the path stays selected", async () => {
    const rig = await edit({ path: "M0 0 L100 0 L100 100 L0 100 Z", fill: { type: "solid", color: "#0e1318" }, stroke: null });
    rig.down(200, 150);
    rig.up(200, 150);
    expect(usePathEdit.getState().id).toBeNull();
    expect(state().selection).toEqual(["p"]);
  });

  it("ends when the selection is changed from outside", async () => {
    await edit();
    act(() => getActions().select(["other"]));
    await waitFor(() => expect(usePathEdit.getState().id).toBeNull());
  });

  it("ends when the path is deleted or its creation undone", async () => {
    await edit();
    act(() => getActions().deleteElements(["p"]));
    await waitFor(() => expect(usePathEdit.getState().id).toBeNull());
  });

  it("ends when a tool is picked up", async () => {
    await edit();
    act(() => getActions().setTool("pen"));
    await waitFor(() => expect(usePathEdit.getState().id).toBeNull());
  });
});

describe("selecting points", () => {
  it("selects the point that is pressed, and shows its handles", async () => {
    const rig = await edit({ path: "M0 0 C0 50 50 100 100 100 L100 0" });
    expect(handles(rig)).toHaveLength(0);
    const from = onPage(0);
    rig.pointerAt("pointerDown", rig.client(from.x, from.y).clientX, rig.client(from.x, from.y).clientY, { target: anchors(rig)[0] });
    rig.pointerAt("pointerUp", rig.client(from.x, from.y).clientX, rig.client(from.x, from.y).clientY, { target: anchors(rig)[0] });
    expect(usePathEdit.getState().selected).toEqual([0]);
    expect(anchors(rig)[0].getAttribute("class")).toContain("is-selected");
    expect(handles(rig)).toHaveLength(1); // the first point has one handle, towards the second
  });

  it("adds a point to the selection with Shift, and takes it out again", async () => {
    const rig = await edit();
    const tap = (i: number, shift: boolean) => {
      const p = onPage(i);
      const c = rig.client(p.x, p.y);
      rig.pointerAt("pointerDown", c.clientX, c.clientY, { target: anchors(rig)[i], shift });
      rig.pointerAt("pointerUp", c.clientX, c.clientY, { target: anchors(rig)[i], shift });
    };
    tap(0, false);
    tap(2, true);
    expect(usePathEdit.getState().selected).toEqual([0, 2]);
    tap(0, true);
    expect(usePathEdit.getState().selected).toEqual([2]);
  });

  it("walks through the points with the keyboard", async () => {
    await edit();
    act(() => cycleSelectedNode(1));
    expect(usePathEdit.getState().selected).toEqual([0]);
    act(() => cycleSelectedNode(1));
    act(() => cycleSelectedNode(1));
    expect(usePathEdit.getState().selected).toEqual([2]);
    act(() => cycleSelectedNode(1));
    expect(usePathEdit.getState().selected).toEqual([0]);
    act(() => cycleSelectedNode(-1));
    expect(usePathEdit.getState().selected).toEqual([2]);
  });
});

describe("dragging points", () => {
  it("moves the point to where it is dropped and keeps the others where they are", async () => {
    const rig = await edit();
    const [a, b, c] = [onPage(0), onPage(1), onPage(2)];
    dragOn(rig, anchors(rig)[1], b, { x: b.x + 40, y: b.y + 30 });
    close(onPage(0), a);
    close(onPage(1), { x: b.x + 40, y: b.y + 30 });
    close(onPage(2), c);
    expect(usePathEdit.getState().selected).toEqual([1]);
  });

  it("makes the box of the element fit the new path", async () => {
    const rig = await edit();
    const b = onPage(1);
    dragOn(rig, anchors(rig)[1], b, { x: b.x + 100, y: b.y - 50 });
    const el = shape();
    expect([Math.round(el.x), Math.round(el.y), Math.round(el.width), Math.round(el.height)]).toEqual([100, 50, 300, 150]);
  });

  it("moves a point the way it was dragged on the page, whatever the element's turn and mirror", async () => {
    for (const over of [{ rotation: 90 }, { rotation: 37, flipH: true }, { rotation: 200, flipV: true }]) {
      const rig = await edit(over);
      const b = onPage(1);
      const a = onPage(0);
      dragOn(rig, anchors(rig)[1], b, { x: b.x + 40, y: b.y + 10 });
      close(onPage(1), { x: b.x + 40, y: b.y + 10 });
      close(onPage(0), a);
      rig.unmount();
      act(() => stopPathEdit());
    }
  });

  it("moves every selected point together", async () => {
    const rig = await edit();
    act(() => selectNodes([1, 2]));
    const [a, b, c] = [onPage(0), onPage(1), onPage(2)];
    dragOn(rig, anchors(rig)[2], c, { x: c.x - 50, y: c.y + 20 });
    close(onPage(0), a);
    close(onPage(1), { x: b.x - 50, y: b.y + 20 });
    close(onPage(2), { x: c.x - 50, y: c.y + 20 });
  });

  it("is one step to undo, and one to redo", async () => {
    const rig = await edit();
    const b = onPage(1);
    dragOn(rig, anchors(rig)[1], b, { x: b.x + 40, y: b.y + 30 });
    act(() => getActions().undo());
    close(onPage(1), b);
    act(() => getActions().redo());
    close(onPage(1), { x: b.x + 40, y: b.y + 30 });
  });
});

describe("dragging handles", () => {
  const curve = "M0 0 C0 50 50 100 100 100 L100 0";

  it("reshapes the side by pulling the handle", async () => {
    const rig = await edit({ path: curve });
    act(() => selectNodes([0]));
    await waitFor(() => expect(handles(rig)).toHaveLength(1));
    const el = shape();
    const before = elementPath(el)!.nodes[0].handleOut!;
    const tip = localToDesign(el, { x: nodes()[0].x + before.x, y: nodes()[0].y + before.y });
    dragOn(rig, handles(rig)[0], tip, { x: tip.x + 30, y: tip.y });
    const after = nodes()[0].handleOut!;
    expect(after.x - before.x).toBeCloseTo(30, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("turns the other handle of a smooth point with it, unless Alt is held", async () => {
    const rig = await edit({ path: "M0 50 C20 0 60 0 80 50 C100 100 100 100 100 100" });
    // the second point has handles on both sides along one line
    act(() => selectNodes([1]));
    await waitFor(() => expect(handles(rig)).toHaveLength(2));
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("smooth");
    const out = () => elementPath(shape())!.nodes[1].handleOut!;
    const inn = () => elementPath(shape())!.nodes[1].handleIn!;
    const tip = (h: { x: number; y: number }) => localToDesign(shape(), { x: nodes()[1].x + h.x, y: nodes()[1].y + h.y });
    const outTip = tip(out());
    dragOn(rig, handles(rig)[1], outTip, { x: outTip.x, y: outTip.y + 25 });
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("smooth");
    // Alt: only this handle moves
    const before = inn();
    const next = tip(out());
    dragOn(rig, handles(rig)[1], next, { x: next.x + 20, y: next.y }, { alt: true });
    expect(inn().x).toBeCloseTo(before.x, 1);
    expect(inn().y).toBeCloseTo(before.y, 1);
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("corner");
  });
});

describe("adding and removing points", () => {
  it("adds a point where a side is pressed, selects it and goes on dragging it", async () => {
    const rig = await edit();
    const before = nodes().length;
    const on = { x: 200, y: 100 }; // the middle of the first side
    dragOn(rig, segments(rig)[0], on, { x: 200, y: 60 });
    expect(nodes()).toHaveLength(before + 1);
    expect(usePathEdit.getState().selected).toEqual([1]);
    close(onPage(1), { x: 200, y: 60 });
    close(onPage(0), { x: 100, y: 100 });
  });

  it("finds the side that is pressed when the workspace is not at the corner of the screen", async () => {
    const rig = await edit();
    const real = rig.host.getBoundingClientRect.bind(rig.host);
    rig.host.getBoundingClientRect = () => ({ ...real(), left: 30, top: 20, x: 30, y: 20 }) as DOMRect;
    const c = rig.client(200, 100); // the middle of the first side, for a workspace at the corner
    rig.pointerAt("pointerDown", c.clientX + 30, c.clientY + 20, { target: segments(rig)[0] });
    rig.pointerAt("pointerUp", c.clientX + 30, c.clientY + 20, { target: segments(rig)[0] });
    expect(nodes()).toHaveLength(4);
    close(onPage(1), { x: 200, y: 100 });
  });

  it("does not change the shape of the path when a point is added without dragging", async () => {
    const rig = await edit({ path: "M0 0 C0 100 100 100 100 0" });
    const on = localToDesign(shape(), { x: 100, y: 75 }); // the middle of the arch
    const c = rig.client(on.x, on.y);
    rig.pointerAt("pointerDown", c.clientX, c.clientY, { target: segments(rig)[0] });
    rig.pointerAt("pointerUp", c.clientX, c.clientY, { target: segments(rig)[0] });
    expect(nodes()).toHaveLength(3);
    close(onPage(1), on, 0);
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("smooth");
  });

  it("deletes the selected points and joins their neighbours", async () => {
    await edit();
    act(() => selectNodes([1]));
    act(() => deleteSelectedNodes());
    expect(nodes()).toHaveLength(2);
    expect(usePathEdit.getState().selected).toEqual([]);
    act(() => getActions().undo());
    expect(nodes()).toHaveLength(3);
  });

  it("deletes the whole path when fewer than two points would be left, and leaves point editing", async () => {
    await edit();
    act(() => selectNodes([0, 1]));
    act(() => deleteSelectedNodes());
    expect(state().design!.pages[0].elements.find((e) => e.id === "p")).toBeUndefined();
    expect(usePathEdit.getState().id).toBeNull();
  });

  it("does nothing when no point is selected", async () => {
    await edit();
    act(() => deleteSelectedNodes());
    expect(nodes()).toHaveLength(3);
  });
});

describe("corners and smooth points", () => {
  it("turns the selected points smooth or into corners", async () => {
    await edit();
    act(() => selectNodes([1]));
    act(() => setSelectedKind("smooth"));
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("smooth");
    act(() => setSelectedKind("corner"));
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("corner");
    expect(nodes()[1].handleIn).toBeNull();
  });

  it("toggles a point with a double click", async () => {
    const rig = await edit();
    const p = onPage(1);
    const c = rig.client(p.x, p.y);
    rig.pointerAt("pointerDown", c.clientX, c.clientY, { target: anchors(rig)[1] });
    rig.pointerAt("pointerUp", c.clientX, c.clientY, { target: anchors(rig)[1] });
    rig.dblclick(p.x, p.y, { target: anchors(rig)[1] });
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("smooth");
    rig.dblclick(p.x, p.y, { target: anchors(rig)[1] });
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("corner");
  });

  it("closes an open path", async () => {
    await edit();
    act(() => closeEditedPath());
    expect(shape().path).toMatch(/Z$/);
    expect(elementPath(shape())!.closed).toBe(true);
  });
});

describe("moving points with the keys", () => {
  it("moves the selected points a pixel at a time on the page, and ten with Shift", async () => {
    await edit({ rotation: 90 });
    act(() => selectNodes([1]));
    const b = onPage(1);
    act(() => nudgeSelectedNodes(1, 0));
    close(onPage(1), { x: b.x + 1, y: b.y }, 2);
    act(() => nudgeSelectedNodes(0, -10));
    close(onPage(1), { x: b.x + 1, y: b.y - 10 }, 2);
  });

  it("joins a run of nudges into one step to undo", async () => {
    await edit();
    act(() => selectNodes([1]));
    const b = onPage(1);
    act(() => nudgeSelectedNodes(1, 0));
    act(() => nudgeSelectedNodes(1, 0));
    act(() => nudgeSelectedNodes(1, 0));
    close(onPage(1), { x: b.x + 3, y: b.y }, 2);
    act(() => getActions().undo());
    close(onPage(1), b, 2);
  });
});

describe("the pointer, in the cases that are easy to forget", () => {
  const curve = "M0 0 C0 50 50 100 100 100 L100 0";
  /** a press and release on `target` at `at` (page px), `move` px away in the middle */
  const press = (rig: CanvasRig, target: Element, at: { x: number; y: number }, opts: { button?: number; shift?: boolean; move?: number } = {}) => {
    const c = rig.client(at.x, at.y);
    const o = { target, button: opts.button, shift: opts.shift };
    rig.pointerAt("pointerDown", c.clientX, c.clientY, o);
    if (opts.move) rig.pointerAt("pointerMove", c.clientX + opts.move, c.clientY, o);
    rig.pointerAt("pointerUp", c.clientX + (opts.move ?? 0), c.clientY, o);
  };

  it("finds the side that is pressed from the screen's own corner when the workspace cannot be found", async () => {
    const rig = await edit();
    rig.host.removeAttribute("data-cf-workspace");
    press(rig, segments(rig)[0], { x: 200, y: 100 });
    expect(nodes()).toHaveLength(4);
    close(onPage(1), { x: 200, y: 100 });
  });

  it("does not move a point that is pressed and moved by less than two pixels", async () => {
    const rig = await edit();
    const before = state().past.length;
    const b = onPage(1);
    press(rig, anchors(rig)[1], b, { move: 1 });
    close(onPage(1), b, 6);
    expect(state().past).toHaveLength(before);
    expect(usePathEdit.getState().selected).toEqual([1]);
  });

  it("leaves one point selected when one of several selected points is clicked, but drags all of them", async () => {
    const rig = await edit();
    act(() => selectNodes([0, 1]));
    press(rig, anchors(rig)[1], onPage(1));
    expect(usePathEdit.getState().selected).toEqual([1]);
    act(() => selectNodes([0, 1]));
    const [a, b] = [onPage(0), onPage(1)];
    dragOn(rig, anchors(rig)[1], b, { x: b.x + 10, y: b.y + 5 });
    expect(usePathEdit.getState().selected).toEqual([0, 1]);
    close(onPage(0), { x: a.x + 10, y: a.y + 5 });
  });

  it("does nothing for a press with another button of the mouse", async () => {
    const rig = await edit({ path: curve });
    act(() => selectNodes([0]));
    await waitFor(() => expect(handles(rig)).toHaveLength(1));
    const before = state().design!.pages[0].elements;
    press(rig, anchors(rig)[2], onPage(2), { button: 2 });
    expect(usePathEdit.getState().selected).toEqual([0]);
    const tip = localToDesign(shape(), { x: nodes()[0].x + nodes()[0].handleOut!.x, y: nodes()[0].y + nodes()[0].handleOut!.y });
    press(rig, handles(rig)[0], tip, { button: 2, move: 30 });
    press(rig, segments(rig)[1], { x: 300, y: 150 }, { button: 2 });
    expect(state().design!.pages[0].elements).toBe(before);
    expect(nodes()).toHaveLength(3);
  });

  it("does nothing for a press on a side that turns out not to be near the path", async () => {
    const rig = await edit();
    const far = rig.client(200, 100);
    rig.pointerAt("pointerDown", far.clientX, far.clientY + 80, { target: segments(rig)[0] });
    rig.pointerAt("pointerUp", far.clientX, far.clientY + 80, { target: segments(rig)[0] });
    expect(nodes()).toHaveLength(3);
    expect(state().past).toHaveLength(0);
  });

  it("pulls the incoming handle too, and the outgoing one follows it round a smooth point", async () => {
    const rig = await edit({ path: "M0 50 C20 0 60 0 80 50 C100 100 100 100 100 100" });
    act(() => selectNodes([1]));
    await waitFor(() => expect(handles(rig)).toHaveLength(2));
    const inHandle = () => nodes()[1].handleIn!;
    const outHandle = () => nodes()[1].handleOut!;
    const tip = localToDesign(shape(), { x: nodes()[1].x + inHandle().x, y: nodes()[1].y + inHandle().y });
    const outBefore = Math.hypot(outHandle().x, outHandle().y);
    dragOn(rig, handles(rig)[0], tip, { x: tip.x, y: tip.y - 20 });
    expect(nodeKindOf(elementPath(shape())!, 1)).toBe("smooth");
    expect(Math.hypot(outHandle().x, outHandle().y)).toBeCloseTo(outBefore, 3);
    // the two handles are still opposite each other: the sine of the angle between their lines is nothing
    const sine = (inHandle().x * outHandle().y - inHandle().y * outHandle().x) / (Math.hypot(inHandle().x, inHandle().y) * Math.hypot(outHandle().x, outHandle().y));
    expect(sine).toBeCloseTo(0, 3);
  });
});

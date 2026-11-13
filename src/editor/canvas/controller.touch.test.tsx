/**
 * Pointer controller: two fingers on a touch screen. Their distance zooms, their midpoint moves the view, and the
 * document, its undo history and the selection are left alone. One finger, the mouse and the pen work as before.
 *
 * The workspace of the rig is 1000 x 700 with the page at (72, 48) and 100 % zoom, so a point of the design is on
 * screen 72 px further right and 48 px further down. The fingers are given in screen px, because a pinch changes the
 * zoom under them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createShape, createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { boxOf, canvasDesign, currentPage, mountWorkspace, selectIds, type CanvasRig } from "@/test/canvasUtils";
import { useGesture } from "./gestureStore";
import { screenToDesign, useView } from "./viewStore";

const state = () => useEditor.getState();
const noSnap = () => act(() => getActions().toggle("snapEnabled"));

/** "a" is on screen from (172, 148) to (372, 248), "b" from (472, 148) to (672, 248); the rest of the page is empty. */
const shapes = () => [createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 }), createShape("ellipse", { id: "b", x: 400, y: 100, width: 200, height: 100 })];
const ON_A: [number, number] = [272, 198];
const ON_B: [number, number] = [572, 198];

type Kind = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel" | "lostPointerCapture";

/** One event of one finger at a place on the screen. The first finger that comes down is the primary one, as in a browser. */
function finger(rig: CanvasRig, type: Kind, id: number, [clientX, clientY]: [number, number], extra: { target?: Element; primary?: boolean } = {}): boolean {
  const held = type === "pointerDown" || type === "pointerMove";
  return fireEvent[type](extra.target ?? rig.host, { clientX, clientY, pointerId: id, pointerType: "touch", isPrimary: !!extra.primary, button: 0, buttons: held ? 1 : 0 });
}

/** Two fingers come down one after the other. */
function twoDown(rig: CanvasRig, first: [number, number], second: [number, number]): void {
  finger(rig, "pointerDown", 1, first, { primary: true });
  finger(rig, "pointerDown", 2, second);
}

function bothUp(rig: CanvasRig): void {
  finger(rig, "pointerUp", 1, [0, 0]);
  finger(rig, "pointerUp", 2, [0, 0]);
}

const scroll = (rig: CanvasRig) => [rig.scroller.scrollLeft, rig.scroller.scrollTop];
/** the point of the design that is drawn at this place of the screen right now */
const designUnder = (rig: CanvasRig, [x, y]: [number, number]) =>
  screenToDesign({ ...useView.getState(), scrollLeft: rig.scroller.scrollLeft, scrollTop: rig.scroller.scrollTop }, x, y);

function expectSamePoint(got: { x: number; y: number }, want: { x: number; y: number }): void {
  expect(got.x).toBeCloseTo(want.x, 6);
  expect(got.y).toBeCloseTo(want.y, 6);
}

describe("pinching with two fingers", () => {
  it("zooms in when the fingers move apart and keeps the point between them where it is", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = designUnder(rig, [500, 300]);
    twoDown(rig, [400, 300], [600, 300]);
    expect(state().zoom).toBe(1);
    finger(rig, "pointerMove", 1, [300, 300]);
    finger(rig, "pointerMove", 2, [700, 300]);
    expect(state().zoom).toBeCloseTo(2, 6);
    expect(state().zoomMode).toBe("custom");
    expectSamePoint(designUnder(rig, [500, 300]), before);
  });

  it("zooms out when the fingers come together", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = designUnder(rig, [500, 300]);
    twoDown(rig, [400, 300], [600, 300]);
    finger(rig, "pointerMove", 1, [450, 300]);
    finger(rig, "pointerMove", 2, [550, 300]);
    expect(state().zoom).toBeCloseTo(0.5, 6);
    expectSamePoint(designUnder(rig, [500, 300]), before);
  });

  it("moves the view with the fingers when both go the same way, without changing the zoom", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = designUnder(rig, [500, 300]);
    twoDown(rig, [400, 300], [600, 300]);
    finger(rig, "pointerMove", 1, [350, 270]);
    finger(rig, "pointerMove", 2, [550, 270]);
    expect(state().zoom).toBe(1);
    expect(scroll(rig)).toEqual([50, 30]);
    expectSamePoint(designUnder(rig, [450, 270]), before);
  });

  it("only moves the view, and keeps a zoom that fits the page as it is, when the fingers stay as far apart as they were", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = designUnder(rig, [500, 300]);
    twoDown(rig, [400, 300], [600, 300]);
    // the second finger goes a quarter of the way round the first
    finger(rig, "pointerMove", 2, [400, 500]);
    expect(state().zoom).toBe(1);
    expect(state().zoomMode).toBe("fit");
    expect(scroll(rig)).toEqual([100, -100]);
    expectSamePoint(designUnder(rig, [400, 400]), before);
  });

  it("zooms and moves at once when one finger stays and the other goes away from it", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = designUnder(rig, [500, 300]);
    twoDown(rig, [400, 300], [600, 300]);
    finger(rig, "pointerMove", 2, [800, 300]);
    expect(state().zoom).toBeCloseTo(2, 6);
    expectSamePoint(designUnder(rig, [600, 300]), before);
  });

  it("follows the fingers when two of their moves arrive before the canvas is laid out again", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = designUnder(rig, [500, 300]);
    twoDown(rig, [400, 300], [600, 300]);
    act(() => {
      finger(rig, "pointerMove", 2, [800, 300]);
      // as far from the first finger as before, but somewhere else: the zoom is the same, the midpoint is not
      finger(rig, "pointerMove", 2, [400, 700]);
    });
    expect(state().zoom).toBeCloseTo(2, 6);
    expectSamePoint(designUnder(rig, [400, 500]), before);
  });

  it("stops at 400 % and at 5 %", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    twoDown(rig, [495, 300], [505, 300]);
    finger(rig, "pointerMove", 2, [900, 300]);
    expect(state().zoom).toBe(4);
    // further apart at the limit still moves the view with the midpoint
    const before = designUnder(rig, [697.5, 300]);
    finger(rig, "pointerMove", 2, [950, 300]);
    expect(state().zoom).toBe(4);
    expectSamePoint(designUnder(rig, [722.5, 300]), before);
    bothUp(rig);
    twoDown(rig, [50, 300], [950, 300]);
    finger(rig, "pointerMove", 2, [55, 300]);
    expect(state().zoom).toBe(0.05);
  });

  it("leaves the document, the undo history and the selection alone", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    const design = state().design;
    twoDown(rig, [772, 548], [872, 548]);
    finger(rig, "pointerMove", 2, [972, 600]);
    finger(rig, "pointerMove", 1, [700, 500]);
    bothUp(rig);
    expect(state().zoom).not.toBe(1);
    expect(state().design).toBe(design);
    expect(state().past).toHaveLength(0);
    expect(state().canUndo).toBe(false);
    expect(state().selection).toEqual(["a"]);
  });

  it("works in a design that is only looked at", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setMode("view"));
    twoDown(rig, ON_A, ON_B);
    finger(rig, "pointerMove", 2, [872, 198]);
    expect(state().zoom).toBeCloseTo(2, 6);
    expect(state().selection).toEqual([]);
  });
});

describe("the end of a pinch", () => {
  it.each(["pointerUp", "pointerCancel", "lostPointerCapture"] as const)("comes with %s of either finger, and the finger that stays moves nothing", async (ending) => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    twoDown(rig, ON_A, ON_B);
    finger(rig, "pointerMove", 2, [872, 198]);
    finger(rig, ending, 2, [872, 198]);
    const view = [state().zoom, ...scroll(rig)];
    finger(rig, "pointerMove", 1, [400, 300]);
    finger(rig, "pointerMove", 1, [500, 400]);
    finger(rig, "pointerUp", 1, [500, 400]);
    expect([state().zoom, ...scroll(rig)]).toEqual(view);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(state().selection).toEqual([]);
    expect(state().past).toHaveLength(0);
    expect(useGesture.getState().active).toBe(false);
  });

  it("comes with the first finger lifting too", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    twoDown(rig, [400, 300], [600, 300]);
    finger(rig, "pointerUp", 1, [400, 300]);
    finger(rig, "pointerMove", 2, [900, 300]);
    expect(state().zoom).toBe(1);
    expect(scroll(rig)).toEqual([0, 0]);
  });

  it("lets a new finger work as one finger while the one left over from the pinch still rests on the screen", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    twoDown(rig, ON_A, [772, 548]);
    finger(rig, "pointerUp", 2, [772, 548]);
    finger(rig, "pointerDown", 3, ON_B);
    expect(state().selection).toEqual(["b"]);
    finger(rig, "pointerMove", 1, [300, 300]);
    finger(rig, "pointerMove", 3, [632, 198]);
    finger(rig, "pointerUp", 1, [300, 300]);
    finger(rig, "pointerMove", 3, [652, 198]);
    finger(rig, "pointerUp", 3, [652, 198]);
    expect(state().zoom).toBe(1);
    expect(boxOf("b")).toEqual([480, 100, 200, 100]);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(state().past).toHaveLength(1);
  });

  it("is taken for granted when a first finger comes down though the last two were never seen to lift", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    twoDown(rig, [772, 548], [872, 548]);
    finger(rig, "pointerDown", 7, ON_B, { primary: true });
    expect(state().selection).toEqual(["b"]);
    finger(rig, "pointerMove", 7, [872, 198]);
    expect(state().zoom).toBe(1);
    finger(rig, "pointerUp", 7, [872, 198]);
  });
});

describe("other pointers during a pinch", () => {
  it("ignores a third finger and goes on with the first two", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    twoDown(rig, [400, 400], [600, 400]);
    finger(rig, "pointerDown", 3, ON_A);
    expect(state().selection).toEqual([]);
    finger(rig, "pointerMove", 3, [600, 600]);
    expect(state().zoom).toBe(1);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    finger(rig, "pointerUp", 3, [600, 600]);
    finger(rig, "pointerMove", 2, [800, 400]);
    expect(state().zoom).toBeCloseTo(2, 6);
  });

  it("ignores a press of the mouse", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    twoDown(rig, [400, 400], [600, 400]);
    rig.pointerAt("pointerDown", ...ON_A, { pointerId: 9 });
    rig.pointerAt("pointerMove", 400, 300, { pointerId: 9 });
    rig.pointerAt("pointerUp", 400, 300, { pointerId: 9 });
    expect(state().selection).toEqual([]);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(state().zoom).toBe(1);
  });
});

describe("a second finger while the first one has begun something", () => {
  it("drops a press on an element that has not moved it: the element stays where it is and the selection is as before", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    finger(rig, "pointerDown", 1, ON_A, { primary: true });
    expect(state().selection).toEqual(["a"]);
    finger(rig, "pointerDown", 2, ON_B);
    expect(state().selection).toEqual([]);
    finger(rig, "pointerMove", 1, [172, 198]);
    expect(state().zoom).toBeCloseTo(4 / 3, 6);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    bothUp(rig);
    expect(state().past).toHaveLength(0);
    expect(state().selection).toEqual([]);
  });

  it("keeps a selection of several elements when the press was on one of them", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a", "b");
    twoDown(rig, ON_A, [772, 548]);
    bothUp(rig);
    expect(state().selection).toEqual(["a", "b"]);
  });

  it("drops a marquee that is still empty", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    finger(rig, "pointerDown", 1, [772, 548], { primary: true });
    finger(rig, "pointerMove", 1, [773, 549]);
    finger(rig, "pointerDown", 2, [872, 548]);
    finger(rig, "pointerMove", 1, [472, 248]);
    expect(useGesture.getState().marquee).toBeNull();
    expect(state().selection).toEqual([]);
    expect(state().zoom).not.toBe(1);
  });

  it("drops a pressed handle that has not been dragged", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds("a");
    finger(rig, "pointerDown", 1, [372, 248], { primary: true, target: rig.handle("resize:se") });
    expect(useGesture.getState().active).toBe(true);
    finger(rig, "pointerDown", 2, [572, 448]);
    expect(useGesture.getState().active).toBe(false);
    finger(rig, "pointerMove", 1, [272, 148]);
    expect(state().zoom).not.toBe(1);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    bothUp(rig);
    expect(state().past).toHaveLength(0);
    expect(state().selection).toEqual(["a"]);
  });

  it("takes over from one finger that moves the view with the hand tool", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setTool("hand"));
    finger(rig, "pointerDown", 1, [400, 300], { primary: true });
    expect(rig.host.style.cursor).toBe("grabbing");
    finger(rig, "pointerDown", 2, [600, 300]);
    expect(rig.host.style.cursor).toBe("");
    finger(rig, "pointerMove", 2, [800, 300]);
    expect(state().zoom).toBeCloseTo(2, 6);
  });

  it("goes on with a move that is under way, ignores the second finger and leaves one undo step", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    finger(rig, "pointerDown", 1, ON_A, { primary: true });
    finger(rig, "pointerMove", 1, [332, 198]);
    finger(rig, "pointerDown", 2, ON_B);
    finger(rig, "pointerMove", 2, [872, 398]);
    expect(state().zoom).toBe(1);
    expect(scroll(rig)).toEqual([0, 0]);
    expect(state().selection).toEqual(["a"]);
    finger(rig, "pointerMove", 1, [352, 198]);
    expect(boxOf("a")).toEqual([180, 100, 200, 100]);
    finger(rig, "pointerUp", 1, [352, 198]);
    expect(state().past).toHaveLength(1);
    // the second finger is still down: it stays ignored
    finger(rig, "pointerMove", 2, [600, 300]);
    finger(rig, "pointerUp", 2, [600, 300]);
    expect(boxOf("b")).toEqual([400, 100, 200, 100]);
    expect(state().zoom).toBe(1);
    act(() => getActions().undo());
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
  });

  it("goes on with a resize that is under way", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds("a");
    finger(rig, "pointerDown", 1, [372, 248], { primary: true, target: rig.handle("resize:se") });
    finger(rig, "pointerMove", 1, [422, 268]);
    finger(rig, "pointerDown", 2, [572, 448]);
    finger(rig, "pointerMove", 2, [872, 548]);
    expect(state().zoom).toBe(1);
    finger(rig, "pointerMove", 1, [432, 278]);
    expect(boxOf("a")).toEqual([100, 100, 260, 130]);
    finger(rig, "pointerUp", 1, [432, 278]);
    expect(state().past).toHaveLength(1);
    expect(useGesture.getState().active).toBe(false);
  });

  it("goes on with a marquee that has begun to select", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    finger(rig, "pointerDown", 1, [122, 98], { primary: true });
    finger(rig, "pointerMove", 1, [222, 198]);
    expect(state().selection).toEqual(["a"]);
    finger(rig, "pointerDown", 2, [772, 548]);
    finger(rig, "pointerMove", 2, [872, 648]);
    expect(state().zoom).toBe(1);
    expect(useGesture.getState().marquee).not.toBeNull();
    finger(rig, "pointerMove", 1, [722, 298]);
    finger(rig, "pointerUp", 1, [722, 298]);
    expect(state().selection).toEqual(["a", "b"]);
  });

  it("goes on with a line that is being drawn", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().setTool("draw"));
    finger(rig, "pointerDown", 1, [200, 200], { primary: true });
    finger(rig, "pointerMove", 1, [240, 260]);
    finger(rig, "pointerDown", 2, [600, 400]);
    finger(rig, "pointerMove", 2, [900, 600]);
    expect(state().zoom).toBe(1);
    finger(rig, "pointerMove", 1, [300, 220]);
    finger(rig, "pointerMove", 1, [360, 300]);
    finger(rig, "pointerUp", 1, [360, 300]);
    expect(currentPage().elements).toHaveLength(1);
  });

  it("goes on with a path of the Pen", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().setTool("pen"));
    finger(rig, "pointerDown", 1, [200, 200], { primary: true });
    finger(rig, "pointerDown", 2, [600, 400]);
    finger(rig, "pointerMove", 2, [900, 600]);
    expect(state().zoom).toBe(1);
    expect(useGesture.getState().pen).not.toBeNull();
    finger(rig, "pointerUp", 1, [200, 200]);
  });
});

describe("what is not a pinch", () => {
  it("lets one finger select and drag as before", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    finger(rig, "pointerDown", 1, ON_A, { primary: true });
    finger(rig, "pointerMove", 1, [332, 238]);
    finger(rig, "pointerUp", 1, [332, 238]);
    expect(state().selection).toEqual(["a"]);
    expect(boxOf("a")).toEqual([160, 140, 200, 100]);
    expect(state().past).toHaveLength(1);
    expect(state().zoom).toBe(1);
    expect(scroll(rig)).toEqual([0, 0]);
  });

  it("does not take two taps of one finger, one after the other, for two fingers", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    finger(rig, "pointerDown", 1, ON_A, { primary: true });
    finger(rig, "pointerUp", 1, ON_A);
    finger(rig, "pointerDown", 2, ON_B, { primary: true });
    expect(state().selection).toEqual(["b"]);
    finger(rig, "pointerUp", 2, ON_B);
  });

  it.each(["mouse", "pen"])("never pinches with a %s and a second pointer of its kind", async (pointerType) => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const fire = (type: "pointerDown" | "pointerMove", pointerId: number, [clientX, clientY]: [number, number]) =>
      fireEvent[type](rig.host, { clientX, clientY, pointerId, pointerType, isPrimary: pointerId === 1, button: 0, buttons: 1 });
    fire("pointerDown", 1, [772, 548]);
    fire("pointerDown", 2, [872, 548]);
    fire("pointerMove", 2, [972, 648]);
    expect(state().zoom).toBe(1);
    expect(scroll(rig)).toEqual([0, 0]);
    fire("pointerMove", 1, [272, 148]);
    expect(useGesture.getState().marquee).not.toBeNull();
  });

  it("leaves two fingers on the text that is being edited to the text", async () => {
    const rig = await mountWorkspace(canvasDesign([createText({ id: "t", text: "Hello", x: 100, y: 400, width: 300, fontSize: 40 })]));
    act(() => getActions().startTextEdit("t"));
    const editor = rig.container.querySelector<HTMLElement>("[data-cf-text-editor]")!;
    finger(rig, "pointerDown", 1, [200, 460], { primary: true, target: editor });
    finger(rig, "pointerDown", 2, [300, 460], { target: editor });
    finger(rig, "pointerMove", 2, [500, 460], { target: editor });
    expect(state().zoom).toBe(1);
    expect(state().editingTextId).toBe("t");
  });
});

describe("the browser's own touch gestures on the canvas", () => {
  const css = readFileSync(resolve(__dirname, "canvas.css"), "utf8");
  const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")}(?:,[^{]*)? \\{([^}]*)\\}`))?.[1] ?? "";

  it("are switched off for the workspace and for its scroller, so a pinch is not also answered by the page", () => {
    expect(rule(".cf-workspace")).toMatch(/touch-action:\s*none/);
    expect(rule(".cf-workspace__scroll")).toMatch(/touch-action:\s*none/);
  });
});

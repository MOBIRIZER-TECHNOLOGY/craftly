/**
 * The Pen from the keyboard: the arrows move a point over the page, Enter places a point there (and closes or ends the path
 * as a click on its first or last point does), Shift+Enter places a smooth one, Alt and the arrows pull the curve of the last
 * point, Home goes to the first point. The workspace and the editor's keys are both real here; only the layout is stubbed.
 */
import { act, configure, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage, createShape } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import type { ShapeElement } from "@/core/types";
import { installHotkeys } from "@/editor/hotkeys";
import { setDrawSettings } from "@/editor/panels/shared/drawSettings";
import { canvasDesign, currentPage, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { useGesture } from "./gestureStore";
import { cancelPen, forgetPenCursor, penKey, visibleMiddle } from "./penTool";
import { initialMetrics } from "./viewStore";

configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const pen = () => useGesture.getState().pen;
const cursor = () => useGesture.getState().penCursor;
const points = () => pen()!.path.nodes.map((n) => [n.x, n.y]);
const paths = () => currentPage().elements.filter((e): e is ShapeElement => e.type === "shape" && e.shape === "path");
const pickUpPen = () => act(() => getActions().setTool("pen"));
/** true when the key was used (preventDefault was called) */
const press = (rig: CanvasRig, key: string, init: KeyboardEventInit = {}): boolean => !fireEvent.keyDown(rig.host, { key, ...init });
const mark = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>(".cf-pencursor");
const said = (rig: CanvasRig) => rig.container.querySelector('[role="status"]')!.textContent;

/** Walks the keyboard point to a place of the page, in steps of ten and of one as a person would. */
function walkTo(rig: CanvasRig, x: number, y: number) {
  if (!cursor()?.shown) press(rig, "ArrowRight");
  const from = cursor()!;
  const walk = (delta: number, back: string, forward: string) => {
    const key = delta < 0 ? back : forward;
    const steps = Math.abs(delta);
    for (let i = 0; i < Math.floor(steps / 10); i++) press(rig, key, { shiftKey: true });
    for (let i = 0; i < steps % 10; i++) press(rig, key);
  };
  walk(x - from.x, "ArrowLeft", "ArrowRight");
  walk(y - from.y, "ArrowUp", "ArrowDown");
}
const place = (rig: CanvasRig, x: number, y: number, init: KeyboardEventInit = {}) => {
  walkTo(rig, x, y);
  press(rig, "Enter", init);
};

let uninstall: () => void;
beforeEach(() => {
  uninstall = installHotkeys();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  act(() => {
    cancelPen();
    forgetPenCursor();
  });
  setDrawSettings({ color: "#0e1318", width: null });
});

describe("the keyboard point of the Pen", () => {
  it("is not there until an arrow key asks for it, and then stands in the middle of the page without having moved", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    expect(mark(rig)).toBeNull();
    expect(press(rig, "ArrowRight")).toBe(true);
    expect(cursor()).toMatchObject({ x: 428, y: 302, shown: true });
    expect(mark(rig)!.style.left).toBe("428px");
    expect(mark(rig)!.style.top).toBe("302px");
    expect(mark(rig)!.textContent).toBe("428, 302");
  });

  it("moves by one pixel with an arrow and by ten with Shift", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    press(rig, "ArrowRight");
    press(rig, "ArrowRight");
    press(rig, "ArrowDown");
    expect(cursor()).toMatchObject({ x: 429, y: 303 });
    press(rig, "ArrowLeft", { shiftKey: true });
    press(rig, "ArrowUp", { shiftKey: true });
    expect(cursor()).toMatchObject({ x: 419, y: 293 });
    press(rig, "ArrowLeft");
    press(rig, "ArrowUp");
    expect(cursor()).toMatchObject({ x: 418, y: 292 });
    expect(mark(rig)!.textContent).toBe("418, 292");
  });

  it("stops at the edges of the page", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    walkTo(rig, 5, 600);
    press(rig, "ArrowLeft", { shiftKey: true });
    press(rig, "ArrowDown", { shiftKey: true });
    expect(cursor()).toMatchObject({ x: 0, y: 604 });
    walkTo(rig, 850, 3);
    press(rig, "ArrowRight", { shiftKey: true });
    press(rig, "ArrowUp", { shiftKey: true });
    expect(cursor()).toMatchObject({ x: 856, y: 0 });
  });

  it("is brought into view when it moves", async () => {
    const seen = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: seen });
    try {
      const rig = await mountWorkspace(canvasDesign());
      pickUpPen();
      press(rig, "ArrowRight");
      expect(seen).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
      const calls = seen.mock.calls.length;
      press(rig, "ArrowRight");
      expect(seen.mock.calls.length).toBe(calls + 1);
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("is left alone by the arrows of another tool, which move the selection as before", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "r", x: 400, y: 50, width: 100, height: 100 })]));
    act(() => getActions().select(["r"]));
    press(rig, "ArrowRight");
    expect(cursor()).toBeNull();
    expect(currentPage().elements[0].x).toBe(401);
    expect(press(rig, "Home")).toBe(false);
  });

  it("does nothing for somebody who can only view the design", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    act(() => getActions().setMode("view"));
    expect(press(rig, "ArrowRight")).toBe(false);
    expect(cursor()).toBeNull();
  });

  it("leaves the keys with Ctrl to the editor", async () => {
    await mountWorkspace(canvasDesign());
    expect(penKey(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }), { width: 856, height: 604 })).toBe(false);
    expect(penKey(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }), { width: 856, height: 604 })).toBe(false);
    expect(cursor()).toBeNull();
  });

  it("goes when another tool is chosen, and starts in the middle again with the pen picked up anew", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    walkTo(rig, 100, 100);
    act(() => getActions().setTool("select"));
    expect(cursor()).toBeNull();
    expect(mark(rig)).toBeNull();
    pickUpPen();
    press(rig, "ArrowRight");
    expect(cursor()).toMatchObject({ x: 428, y: 302 });
  });

  it("goes when another page is chosen, and when the design is closed", async () => {
    const rig = await mountWorkspace(canvasDesign([], { pages: [createPage({ elements: [] }), createPage({ elements: [] })] }));
    pickUpPen();
    walkTo(rig, 100, 100);
    act(() => getActions().setActivePage(state().design!.pages[1].id));
    expect(cursor()).toBeNull();
    press(rig, "ArrowRight");
    expect(cursor()).not.toBeNull();
    act(() => getActions().closeDesign());
    expect(cursor()).toBeNull();
  });
});

describe("where the keyboard point starts", () => {
  it("is the middle of the page when all of it is in view", () => {
    expect(visibleMiddle({ ...initialMetrics, zoom: 1, width: 1000, height: 700, pageLeft: 72, pageTop: 48, pageW: 856, pageH: 604 }, { width: 856, height: 604 })).toEqual({
      x: 428,
      y: 302,
    });
  });

  it("is the middle of the part that is in view when the page is larger than the window", () => {
    // at 200 % the window shows 500 x 350 design px, here from (100, 50) on
    const m = { ...initialMetrics, zoom: 2, width: 1000, height: 700, pageLeft: 72, pageTop: 48, pageW: 4000, pageH: 3000, scrollLeft: 272, scrollTop: 148 };
    expect(visibleMiddle(m, { width: 2000, height: 1500 })).toEqual({ x: 350, y: 225 });
  });

  it("is the middle of the page when none of it is in view", () => {
    const m = { ...initialMetrics, zoom: 1, width: 300, height: 200, pageLeft: 72, pageTop: 48, pageW: 856, pageH: 604, scrollLeft: 5000, scrollTop: 5000 };
    expect(visibleMiddle(m, { width: 856, height: 604 })).toEqual({ x: 428, y: 302 });
  });
});

describe("placing points with Enter", () => {
  it("puts a corner point where the keyboard point is, and the next side follows the keyboard point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    walkTo(rig, 100, 100);
    expect(press(rig, "Enter")).toBe(true);
    expect(points()).toEqual([[100, 100]]);
    walkTo(rig, 300, 100);
    expect(pen()!.hover).toEqual({ x: 300, y: 100 });
    expect(rig.container.querySelector(".cf-penpreview__rubber")!.getAttribute("d")).toBe("M100 100 L300 100");
    press(rig, "Enter");
    expect(points()).toEqual([
      [100, 100],
      [300, 100],
    ]);
    expect(pen()!.path.nodes.every((n) => !n.handleIn && !n.handleOut)).toBe(true);
    expect(paths()).toHaveLength(0);
  });

  it("ends the path when it is pressed again on the point just placed, as a click on the last point does", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    place(rig, 300, 300);
    press(rig, "Enter");
    const [shape] = paths();
    expect(shape.path).toBe("M0 0 L100 0 L100 100");
    expect(shape.fill).toBeNull();
    expect(pen()).toBeNull();
    expect(cursor()).toBeNull();
    expect(state().tool).toBe("select");
    expect(state().selection).toEqual([shape.id]);
  });

  it("closes the path on its first point, where Home takes the keyboard point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    place(rig, 300, 300);
    expect(press(rig, "Home")).toBe(true);
    expect(cursor()).toMatchObject({ x: 100, y: 100, shown: true });
    expect(rig.container.querySelector(".cf-penpreview__node.is-closing")).toBeTruthy();
    press(rig, "Enter");
    const [shape] = paths();
    expect(shape.path).toBe("M0 0 L100 0 L100 100 L0 0 Z");
    expect(shape.fill).toEqual({ type: "solid", color: "#0e1318" });
    expect(cursor()).toBeNull();
  });

  it("closes it as well when the keyboard point was walked to within a few pixels of the first point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    place(rig, 300, 300);
    walkTo(rig, 104, 103);
    press(rig, "Enter");
    expect(paths()[0].path).toMatch(/Z$/);
  });

  it("leaves Home to the browser while no path is being placed", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    expect(press(rig, "Home")).toBe(false);
    expect(cursor()).toBeNull();
  });

  it("makes nothing from a single point when Enter is pressed on it again, keeps the pen and says so", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    press(rig, "Enter");
    expect(pen()).toBeNull();
    expect(paths()).toHaveLength(0);
    expect(state().tool).toBe("pen");
    expect(cursor()).toMatchObject({ x: 100, y: 100, shown: true, say: "A single point makes no path." });
  });

  it("takes the last point back with Backspace and leaves the keyboard point where it is", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    walkTo(rig, 300, 200);
    expect(press(rig, "Backspace")).toBe(true);
    expect(points()).toEqual([[100, 100]]);
    expect(cursor()).toMatchObject({ x: 300, y: 200, shown: true });
    expect(rig.container.querySelector(".cf-penpreview__rubber")!.getAttribute("d")).toBe("M100 100 L300 200");
  });

  it("is one step to undo once the path is made", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    press(rig, "Enter");
    expect(paths()).toHaveLength(1);
    press(rig, "z", { ctrlKey: true });
    expect(paths()).toHaveLength(0);
  });
});

describe("curves from the keyboard", () => {
  it("places a smooth point with Shift+Enter: the path leaves it in the direction it came in, a third as far", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 400, 160, { shiftKey: true });
    const node = pen()!.path.nodes[1];
    expect([node.x, node.y]).toEqual([400, 160]);
    expect(node.handleOut).toEqual({ x: 100, y: 20 });
    expect(node.handleIn).toEqual({ x: -100, y: -20 });
    expect(cursor()!.say).toBe("Smooth point 2 placed at 400, 160");
  });

  it("makes the first point a corner also with Shift, since nothing leads up to it", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100, { shiftKey: true });
    expect(pen()!.path.nodes[0]).toMatchObject({ handleIn: null, handleOut: null });
    expect(cursor()!.say).toBe("Point 1 placed at 100, 100");
  });

  it("pulls the curve of the last point with Alt and the arrows, a pixel at a time or ten with Shift", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    expect(press(rig, "ArrowRight", { altKey: true, shiftKey: true })).toBe(true);
    expect(press(rig, "ArrowDown", { altKey: true })).toBe(true);
    expect(pen()!.path.nodes[1].handleOut).toEqual({ x: 10, y: 1 });
    expect(pen()!.path.nodes[1].handleIn).toEqual({ x: -10, y: -1 });
    expect(cursor()).toMatchObject({ x: 300, y: 100, say: "Curve handle 10, 1" });
    press(rig, "ArrowLeft", { altKey: true });
    press(rig, "ArrowUp", { altKey: true, shiftKey: true });
    expect(pen()!.path.nodes[1].handleOut).toEqual({ x: 9, y: -9 });
    expect(pen()!.path.nodes[0]).toMatchObject({ handleIn: null, handleOut: null });
  });

  it("makes the point a corner again when its curve is pushed all the way back", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    press(rig, "ArrowRight", { altKey: true });
    expect(pen()!.path.nodes[0].handleOut).toEqual({ x: 1, y: 0 });
    press(rig, "ArrowLeft", { altKey: true });
    expect(pen()!.path.nodes[0]).toMatchObject({ handleIn: null, handleOut: null });
    expect(cursor()!.say).toBe("No curve handle");
  });

  it("draws the curve that was made from the keyboard", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 300);
    for (let i = 0; i < 10; i++) press(rig, "ArrowUp", { altKey: true, shiftKey: true });
    place(rig, 300, 300);
    press(rig, "Enter");
    expect(paths()[0].path).toMatch(/^M0 [\d.]+ C/);
  });

  it("keeps Alt and an arrow from the browser while the keyboard point is shown, also with no path to curve", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    press(rig, "ArrowRight");
    expect(press(rig, "ArrowLeft", { altKey: true })).toBe(true);
    expect(pen()).toBeNull();
    expect(cursor()).toMatchObject({ x: 428, y: 302 });
  });

  it("leaves Alt and an arrow, and Alt+Enter, alone while the keyboard point is not shown", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    expect(press(rig, "ArrowLeft", { altKey: true })).toBe(false);
    expect(cursor()).toBeNull();
    press(rig, "ArrowRight");
    expect(press(rig, "Enter", { altKey: true })).toBe(false);
    expect(pen()).toBeNull();
  });
});

describe("the keyboard point and the pointer", () => {
  it("hides when the pointer moves, and Enter then finishes the path as it always did", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    place(rig, 300, 100);
    walkTo(rig, 300, 300);
    rig.move(500, 400);
    expect(cursor()).toMatchObject({ shown: false });
    expect(mark(rig)).toBeNull();
    expect(pen()!.hover).toEqual({ x: 500, y: 400 });
    expect(press(rig, "Enter")).toBe(true);
    expect(paths()).toHaveLength(1);
    expect([paths()[0].x, paths()[0].width]).toEqual([100, 200]);
    expect(state().tool).toBe("select");
  });

  it("comes back where it was with the next arrow key, without moving, and takes the next side with it", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    place(rig, 100, 100);
    walkTo(rig, 300, 300);
    rig.move(500, 400);
    press(rig, "ArrowLeft");
    expect(cursor()).toMatchObject({ x: 300, y: 300, shown: true });
    expect(pen()!.hover).toEqual({ x: 300, y: 300 });
    press(rig, "ArrowLeft");
    expect(cursor()).toMatchObject({ x: 299, y: 300 });
  });

  it("comes back on the last point after the pointer has placed one", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    walkTo(rig, 100, 100);
    rig.down(600, 200);
    rig.up(600, 200);
    expect(cursor()).toBeNull();
    press(rig, "ArrowUp");
    expect(cursor()).toMatchObject({ x: 600, y: 200, shown: true });
    expect(points()).toEqual([[600, 200]]);
  });

  it("stays when the browser reports a pointer that has not moved, as it does when the page scrolls under one", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    rig.move(500, 400);
    place(rig, 100, 100);
    walkTo(rig, 300, 300);
    rig.move(500, 400);
    expect(cursor()).toMatchObject({ x: 300, y: 300, shown: true });
    expect(pen()!.hover).toEqual({ x: 300, y: 300 });
    rig.move(501, 400);
    expect(cursor()).toMatchObject({ shown: false });
  });

  it("places with Home also after the pointer was used, and shows the keyboard point on the first point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    pickUpPen();
    for (const [x, y] of [
      [100, 100],
      [300, 100],
      [300, 300],
    ]) {
      rig.down(x, y);
      rig.up(x, y);
    }
    press(rig, "Home");
    expect(cursor()).toMatchObject({ x: 100, y: 100, shown: true });
    press(rig, "Enter");
    expect(paths()[0].path).toMatch(/Z$/);
  });
});

describe("what a screen reader is told", () => {
  const settle = () => act(() => vi.advanceTimersByTime(400));

  it("hears in the description of the canvas that the Pen can be used with the keys", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const hint = document.getElementById(rig.host.getAttribute("aria-describedby")!);
    expect(hint!.textContent).toMatch(/With the Pen, the arrow keys move its point and Enter places a point there/);
  });

  it("has a polite status that is empty until the keyboard point is used", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const status = rig.container.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
  });

  it("says where the keyboard point is once it rests, and only the last place of a held key", async () => {
    const rig = await mountWorkspace(canvasDesign());
    vi.useFakeTimers();
    pickUpPen();
    press(rig, "ArrowRight");
    expect(said(rig)).toBe("");
    settle();
    expect(said(rig)).toBe("Pen at 428, 302");
    for (let i = 0; i < 5; i++) {
      press(rig, "ArrowRight", { shiftKey: true });
      act(() => vi.advanceTimersByTime(40));
      expect(said(rig)).toBe("Pen at 428, 302");
    }
    settle();
    expect(said(rig)).toBe("Pen at 478, 302");
  });

  it("says that a point was placed, and what Enter would do on the last and on the first point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    vi.useFakeTimers();
    pickUpPen();
    place(rig, 100, 100);
    settle();
    expect(said(rig)).toBe("Point 1 placed at 100, 100");
    place(rig, 300, 100);
    place(rig, 300, 300);
    press(rig, "ArrowDown");
    press(rig, "ArrowUp");
    settle();
    expect(said(rig)).toBe("Pen at 300, 300. Enter ends the path.");
    press(rig, "Home");
    settle();
    expect(said(rig)).toBe("Pen at 100, 100. Enter closes the path.");
  });

  it("falls silent when the pointer takes over", async () => {
    const rig = await mountWorkspace(canvasDesign());
    vi.useFakeTimers();
    pickUpPen();
    press(rig, "ArrowRight");
    settle();
    rig.move(500, 400);
    settle();
    expect(said(rig)).toBe("");
  });
});

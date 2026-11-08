/**
 * What point editing does to the open path apart from the pointer: what each action does when no path is open, or
 * nothing is selected, and what each key of point editing does. (The pointer's part is in PathEditOverlay.test.tsx.)
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShape, createText } from "@/core/factory";
import { elementPath, localToDesign } from "@/core/penShape";
import type { Point, ShapeElement } from "@/core/types";
import { live, openElements } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { closeEditedPath, cycleSelectedNode, deleteSelectedNodes, editedPath, nudgeSelectedNodes, pathEditKey, selectNodes, selectedIn, setSelectedKind } from "./pathEditActions";
import { startPathEdit, stopPathEdit, usePathEdit } from "./pathEditStore";

beforeEach(() => resetEditor());
afterEach(() => act(() => stopPathEdit()));

/** An open path of three corners: (100, 100), (300, 100), (300, 200) on the page. */
const pathElement = (extra: Partial<ShapeElement> = {}) =>
  createShape("path", { id: "p", x: 100, y: 100, width: 200, height: 100, fill: null, path: "M0 0 L100 0 L100 100", ...extra });
const open = (el: ShapeElement = pathElement()) => {
  openElements([el], { selected: [el] });
  act(() => startPathEdit(el.id));
};
const key = (name: string, extra: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: name, ...extra });
const press = (name: string, extra?: KeyboardEventInit) => {
  let used = false;
  act(() => {
    used = pathEditKey(key(name, extra));
  });
  return used;
};
const nodes = () => elementPath(live<ShapeElement>("p"))!.nodes;
/** where a point of the path is on the page */
const onPage = (i: number): Point => localToDesign(live<ShapeElement>("p"), nodes()[i]);
const selected = () => usePathEdit.getState().selected;

describe("editedPath", () => {
  it("is the open path, with its element", () => {
    open();
    const edited = editedPath()!;
    expect(edited.el.id).toBe("p");
    expect(edited.path.nodes).toHaveLength(3);
  });

  it("is nothing when no path is open", () => {
    openElements([pathElement()]);
    expect(editedPath()).toBeNull();
  });

  it("is nothing when the open element is gone, is not a shape, or cannot be read into points", () => {
    openElements([
      createText({ id: "t", text: "Hello", x: 0, y: 0, width: 100, fontSize: 20 }),
      pathElement({ id: "arc", path: "M0 0 A50 50 0 0 1 100 100" }),
      createShape("rect", { id: "r", x: 0, y: 0, width: 10, height: 10 }),
    ]);
    for (const id of ["gone", "t", "arc", "r"]) {
      act(() => usePathEdit.setState({ id }));
      expect(editedPath(), id).toBeNull();
    }
  });
});

describe("selectedIn", () => {
  it("leaves out points that are no longer there", () => {
    open();
    act(() => selectNodes([2, 1, 7, 1]));
    expect(selected()).toEqual([1, 2, 7]);
    expect(selectedIn(editedPath()!.path)).toEqual([1, 2]);
  });

  it("can be given the selection to look at instead of reading the store", () => {
    open();
    expect(selectedIn(editedPath()!.path, [0, 5])).toEqual([0]);
  });
});

describe("with no path open", () => {
  it("every action leaves the path alone, and the keys are left to the editor", () => {
    openElements([pathElement()], { selected: ["p"] });
    const before = live("p");
    act(() => {
      deleteSelectedNodes();
      nudgeSelectedNodes(1, 0);
      setSelectedKind("smooth");
      closeEditedPath();
      cycleSelectedNode(1);
    });
    expect(live("p")).toBe(before);
    expect(selected()).toEqual([]);
    for (const name of ["Delete", "Backspace", "Enter", "Tab", "ArrowLeft"]) expect(press(name), name).toBe(false);
  });
});

describe("with nothing selected", () => {
  it("deleting, nudging and changing the kind of points do nothing", () => {
    open();
    const before = live("p");
    act(() => {
      deleteSelectedNodes();
      nudgeSelectedNodes(1, 0);
      setSelectedKind("smooth");
    });
    expect(live("p")).toBe(before);
  });

  it("Delete and Backspace are used up all the same, so that they do not delete the whole shape", () => {
    open();
    expect(press("Delete")).toBe(true);
    expect(press("Backspace")).toBe(true);
    expect(live("p")).toBeTruthy();
  });

  it("the arrow keys are left to the editor", () => {
    open();
    for (const name of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) expect(press(name), name).toBe(false);
  });

  it("Tab starts at the first point, and Shift+Tab at the last", () => {
    open();
    expect(press("Tab")).toBe(true);
    expect(selected()).toEqual([0]);
    act(() => selectNodes([]));
    expect(press("Tab", { shiftKey: true })).toBe(true);
    expect(selected()).toEqual([2]);
  });
});

describe("closing the path", () => {
  it("leaves a path that is closed already as it is", () => {
    open(pathElement({ path: "M0 0 L100 0 L100 100 L0 0 Z" }));
    const before = live("p");
    act(() => closeEditedPath());
    expect(live("p")).toBe(before);
  });

  it("leaves a path of two points as it is, which has no inside", () => {
    open(pathElement({ path: "M0 0 L100 100" }));
    const before = live("p");
    act(() => closeEditedPath());
    expect(live("p")).toBe(before);
  });
});

describe("the keys of point editing", () => {
  it("Delete and Backspace take the selected points away", () => {
    open(pathElement({ path: "M0 0 L50 0 L100 0 L100 100" }));
    act(() => selectNodes([1]));
    expect(press("Delete")).toBe(true);
    expect(nodes()).toHaveLength(3);
    act(() => selectNodes([0]));
    expect(press("Backspace")).toBe(true);
    expect(nodes()).toHaveLength(2);
  });

  it("Enter is done: it leaves point editing", () => {
    open();
    expect(press("Enter")).toBe(true);
    expect(usePathEdit.getState().id).toBeNull();
  });

  it("Tab walks forward through the points, round to the first, and Shift+Tab walks back", () => {
    open();
    for (const want of [0, 1, 2, 0]) {
      expect(press("Tab")).toBe(true);
      expect(selected()).toEqual([want]);
    }
    expect(press("Tab", { shiftKey: true })).toBe(true);
    expect(selected()).toEqual([2]);
  });

  it.each([
    ["ArrowLeft", {}, { x: -1, y: 0 }],
    ["ArrowRight", {}, { x: 1, y: 0 }],
    ["ArrowUp", {}, { x: 0, y: -1 }],
    ["ArrowDown", {}, { x: 0, y: 1 }],
    ["ArrowLeft", { shiftKey: true }, { x: -10, y: 0 }],
    ["ArrowRight", { shiftKey: true }, { x: 10, y: 0 }],
    ["ArrowUp", { shiftKey: true }, { x: 0, y: -10 }],
    ["ArrowDown", { shiftKey: true }, { x: 0, y: 10 }],
  ])("%s %j moves the selected point on the page by %j", (name, extra, by) => {
    open();
    act(() => selectNodes([1]));
    const before = onPage(1);
    expect(press(name, extra)).toBe(true);
    expect(onPage(1).x).toBeCloseTo(before.x + by.x, 2);
    expect(onPage(1).y).toBeCloseTo(before.y + by.y, 2);
  });

  it("leaves the other keys to the editor", () => {
    open();
    act(() => selectNodes([1]));
    for (const name of ["a", "p", "Escape", "Shift"]) expect(press(name), name).toBe(false);
  });
});

describe("walking through the points", () => {
  it("starts at the first point going forward and at the last going back, when none is selected", () => {
    open();
    act(() => cycleSelectedNode(-1));
    expect(selected()).toEqual([2]);
    act(() => selectNodes([]));
    act(() => cycleSelectedNode(1));
    expect(selected()).toEqual([0]);
  });
});

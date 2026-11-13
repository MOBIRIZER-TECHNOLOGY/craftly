/**
 * Keyboard shortcuts and clipboard events. `installHotkeys()` listens on the window, so the keys are sent to the
 * body (or to a focused control) exactly as the browser would, and the assertions look at the document and the
 * editor state in the store.
 */
import { configure, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createGroup, createImage, createPage, createShape, createText } from "@/core/factory";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { DesignElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { elementPath } from "@/core/penShape";
import type { ShapeElement } from "@/core/types";
import { useGesture } from "./canvas/gestureStore";
import { selectNodes } from "./canvas/pathEditActions";
import { startPathEdit, stopPathEdit, usePathEdit } from "./canvas/pathEditStore";
import { usePreview, startPreview } from "./canvas/preview";
import { takeSelectAllOnEdit } from "./canvas/controller";
import { installHotkeys } from "./hotkeys";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const actions = () => getActions();
const elements = () => getActivePage(state())!.elements;
const byId = (id: string) => elements().find((e) => e.id === id)!;
const ids = () => elements().map((e) => e.id);

/** Sends a key to `target` and tells whether the shortcut claimed it (preventDefault was called). */
const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body): boolean => !fireEvent.keyDown(target, { key, ...init });
const ctrl = (key: string, init: KeyboardEventInit = {}) => press(key, { ctrlKey: true, ...init });

const text = () => createText({ id: "t", text: "Hello", x: 50, y: 50, width: 300, fontSize: 40 });
const other = () => createText({ id: "t2", text: "World", x: 50, y: 150, width: 300, fontSize: 20, color: "#ff0000", fontWeight: 700 });
const rect = () => createShape("rect", { id: "r", x: 400, y: 50, width: 100, height: 100 });
const ellipse = () => createShape("ellipse", { id: "e", x: 400, y: 200, width: 100, height: 100 });
const photo = () => createImage({ id: "img", src: "https://example.test/p.jpg", x: 600, y: 50, width: 100, height: 80, naturalWidth: 200, naturalHeight: 160 });
const frame = () => createImage({ id: "frame", src: null, x: 600, y: 200, width: 100, height: 80, naturalWidth: 1, naturalHeight: 1, isFrame: true });

function open(list: DesignElement[] = [text(), other(), rect(), ellipse(), photo(), frame()]) {
  const design = createDesign({ title: "Keys", width: 856, height: 604, pages: [createPage({ elements: list })] });
  actions().openDesign(design);
  return design;
}

let uninstall: () => void;

beforeEach(() => {
  resetEditor();
  usePreview.setState({ preview: null });
  uninstall = installHotkeys();
});

afterEach(() => {
  uninstall();
  document.body.removeAttribute("data-cf-overlay");
  document.body.removeAttribute("data-cf-modal-open");
});

describe("Escape", () => {
  it("peels back one layer of the editor state per press", () => {
    open();
    startPreview(0, 3);
    useEditor.setState({ editingTextId: "t", croppingId: "img", tool: "shape", context: { kind: "effects" }, selection: ["t"] });
    expect(press("Escape")).toBe(false);
    expect(usePreview.getState().preview).toBeNull();
    expect(state().editingTextId).toBe("t");
    press("Escape");
    expect(state().editingTextId).toBeNull();
    expect(state().croppingId).toBe("img");
    press("Escape");
    expect(state().croppingId).toBeNull();
    expect(state().tool).toBe("shape");
    press("Escape");
    expect(state().tool).toBe("select");
    expect(state().context).not.toBeNull();
    press("Escape");
    expect(state().context).toBeNull();
    expect(state().selection).toEqual(["t"]);
    press("Escape");
    expect(state().selection).toEqual([]);
  });

  it("does nothing when there is nothing left to dismiss", () => {
    open();
    expect(press("Escape")).toBe(false);
    expect(state().selection).toEqual([]);
    expect(state().tool).toBe("select");
  });

  it("is left to the dialog while one is open", () => {
    open();
    actions().select(["t"]);
    actions().openDialog("shortcuts");
    press("Escape");
    expect(state().selection).toEqual(["t"]);
    expect(state().dialog).toBe("shortcuts");
  });

  it("still works while typing in a text field", () => {
    open();
    actions().select(["t"]);
    const input = document.body.appendChild(document.createElement("input"));
    press("Escape", {}, input);
    expect(state().selection).toEqual([]);
  });
});

describe("saving", () => {
  it("Ctrl+S asks the autosave service to save now, even while typing", () => {
    open();
    const saved = vi.fn();
    window.addEventListener("craftly:save-now", saved);
    expect(ctrl("s")).toBe(true);
    const input = document.body.appendChild(document.createElement("input"));
    expect(press("s", { metaKey: true }, input)).toBe(true);
    window.removeEventListener("craftly:save-now", saved);
    expect(saved).toHaveBeenCalledTimes(2);
  });
});

describe("when shortcuts must stay quiet", () => {
  it("does nothing without an open design", () => {
    expect(ctrl("a")).toBe(false);
    expect(press("Delete")).toBe(false);
    expect(press("t")).toBe(false);
  });

  it("does nothing while a popover or dialog marks the page as overlaid", () => {
    open();
    actions().select(["r"]);
    document.body.dataset.cfOverlay = "1";
    expect(press("Delete")).toBe(false);
    expect(elements()).toHaveLength(6);
    document.body.dataset.cfOverlay = "0";
    document.body.setAttribute("data-cf-modal-open", "");
    expect(press("Delete")).toBe(false);
    expect(elements()).toHaveLength(6);
    document.body.removeAttribute("data-cf-modal-open");
    press("Delete");
    expect(elements()).toHaveLength(5);
  });

  it("does nothing while presenting, and when another handler already took the key", () => {
    open();
    actions().select(["r"]);
    actions().setPresenting(true);
    actions().select(["r"]);
    expect(press("Delete")).toBe(false);
    expect(press("Escape")).toBe(false);
    expect(elements()).toHaveLength(6);
    actions().setPresenting(false);
    const claim = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", claim, true);
    press("Delete");
    document.removeEventListener("keydown", claim, true);
    expect(elements()).toHaveLength(6);
  });

  it("leaves typing alone: letters, Delete and arrows go to the text field", () => {
    open();
    actions().select(["r"]);
    const input = document.body.appendChild(document.createElement("input"));
    for (const key of ["Delete", "Backspace", "ArrowRight", "t", "r"]) expect(press(key, {}, input)).toBe(false);
    expect(ids()).toEqual(["t", "t2", "r", "e", "img", "frame"]);
    expect(byId("r").x).toBe(400);
  });

  it("lets a focused button, tab or slider keep arrows, Enter, Space and Tab", () => {
    open();
    actions().select(["r"]);
    const button = document.body.appendChild(document.createElement("button"));
    const slider = document.body.appendChild(document.createElement("div"));
    slider.setAttribute("role", "slider");
    for (const control of [button, slider]) for (const key of ["ArrowRight", "Enter", " ", "Tab", "Home", "End"]) expect(press(key, {}, control)).toBe(false);
    expect(byId("r").x).toBe(400);
    expect(state().editingTextId).toBeNull();
    // everything else is still a shortcut, and so are the shortcuts with Ctrl
    expect(press("Delete", {}, button)).toBe(true);
    expect(elements()).toHaveLength(5);
    expect(ctrl("z", {})).toBe(true);
    expect(elements()).toHaveLength(6);
  });

  it("view mode only keeps undo and redo", () => {
    open();
    actions().select(["r"]);
    actions().nudge(10, 0);
    actions().setMode("view");
    actions().select(["r"]);
    expect(ctrl("a")).toBe(false);
    expect(press("Delete")).toBe(false);
    expect(press("t")).toBe(false);
    expect(elements()).toHaveLength(6);
    expect(ctrl("z")).toBe(true);
    expect(byId("r").x).toBe(400);
    expect(ctrl("y")).toBe(true);
    expect(byId("r").x).toBe(410);
  });
});

describe("history", () => {
  it("Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redo", () => {
    open();
    actions().select(["r"]);
    actions().nudge(10, 0);
    expect(ctrl("z")).toBe(true);
    expect(byId("r").x).toBe(400);
    expect(ctrl("z", { shiftKey: true })).toBe(true);
    expect(byId("r").x).toBe(410);
    ctrl("z");
    expect(byId("r").x).toBe(400);
    expect(ctrl("y")).toBe(true);
    expect(byId("r").x).toBe(410);
  });

  it("answers to the Cmd key as well", () => {
    open();
    actions().select(["r"]);
    actions().nudge(10, 0);
    press("z", { metaKey: true });
    expect(byId("r").x).toBe(400);
  });
});

describe("selection and arrangement shortcuts", () => {
  it("Ctrl+A selects every visible element", () => {
    open();
    actions().setHidden(["e"], true);
    expect(ctrl("a")).toBe(true);
    expect(state().selection).toEqual(["t", "t2", "r", "img", "frame"]);
  });

  it("Ctrl+D duplicates the selection above the original and selects the copy", () => {
    open();
    actions().select(["r"]);
    expect(ctrl("d")).toBe(true);
    expect(elements()).toHaveLength(7);
    const copy = elements()[3];
    expect(copy.id).not.toBe("r");
    expect([copy.x, copy.y]).toEqual([424, 74]);
    expect(state().selection).toEqual([copy.id]);
  });

  it("Ctrl+G groups two elements and Ctrl+Shift+G ungroups them again", () => {
    open();
    actions().select(["r", "e"]);
    expect(ctrl("g")).toBe(true);
    expect(elements().filter((e) => e.type === "group")).toHaveLength(1);
    expect(state().selection).toHaveLength(1);
    expect(ctrl("g", { shiftKey: true })).toBe(true);
    expect(elements().filter((e) => e.type === "group")).toHaveLength(0);
    expect(state().selection).toHaveLength(2);
  });

  it("does not group a single element", () => {
    open();
    actions().select(["r"]);
    ctrl("g");
    expect(elements().some((e) => e.type === "group")).toBe(false);
  });

  it.each([
    ["Ctrl+]", { key: "]", init: {} }, ["t", "t2", "e", "r", "img", "frame"]],
    ["Ctrl+Alt+]", { key: "]", init: { altKey: true } }, ["t", "t2", "e", "img", "frame", "r"]],
    ["Ctrl+Shift+}", { key: "}", init: { shiftKey: true } }, ["t", "t2", "e", "img", "frame", "r"]],
    ["Ctrl+[", { key: "[", init: {} }, ["t", "r", "t2", "e", "img", "frame"]],
    ["Ctrl+Alt+[", { key: "[", init: { altKey: true } }, ["r", "t", "t2", "e", "img", "frame"]],
    ["Ctrl+Shift+{", { key: "{", init: { shiftKey: true } }, ["r", "t", "t2", "e", "img", "frame"]],
  ] as const)("%s changes the stacking order", (_name, { key, init }, expected) => {
    open();
    actions().select(["r"]);
    expect(ctrl(key, init)).toBe(true);
    expect(ids()).toEqual(expected);
  });

  it("Alt+Shift+L locks the selection, and unlocks it when everything is locked", () => {
    open();
    actions().select(["r", "e"]);
    expect(press("L", { altKey: true, shiftKey: true })).toBe(true);
    expect(byId("r").locked && byId("e").locked).toBe(true);
    press("L", { altKey: true, shiftKey: true });
    expect(byId("r").locked || byId("e").locked).toBe(false);
  });

  it("Alt+Shift+L locks everything when only some are locked", () => {
    open();
    actions().setLocked(["r"], true);
    actions().select(["r", "e"]);
    press("l", { altKey: true, shiftKey: true });
    expect(byId("r").locked && byId("e").locked).toBe(true);
  });

  it("Ctrl+Alt+C and Ctrl+Alt+V copy the look of one text to another", () => {
    open();
    actions().select(["t2"]);
    expect(press("c", { ctrlKey: true, altKey: true })).toBe(true);
    actions().select(["t"]);
    expect(press("v", { ctrlKey: true, altKey: true })).toBe(true);
    const t = byId("t");
    expect(t.type === "text" && t.fontSize).toBe(20);
    expect(t.type === "text" && t.color).toBe("#ff0000");
    expect(t.type === "text" && t.fontWeight).toBe(700);
  });
});

describe("zoom shortcuts", () => {
  it.each([
    ["Ctrl+=", "=", 1.25],
    ["Ctrl++", "+", 1.25],
    ["Ctrl+-", "-", 0.8],
    ["Ctrl+_", "_", 0.8],
  ])("%s changes the zoom by a step", (_name, key, factor) => {
    open();
    actions().setZoom(1);
    expect(ctrl(key)).toBe(true);
    expect(state().zoom).toBeCloseTo(factor);
    expect(state().zoomMode).toBe("custom");
  });

  it("Ctrl+0 fits the page in the window again", () => {
    open();
    actions().setZoom(2);
    expect(ctrl("0")).toBe(true);
    expect(state().zoomMode).toBe("fit");
    expect(state().zoom).toBeLessThan(2);
  });

  it("Ctrl+F opens find and replace", () => {
    open();
    expect(ctrl("f")).toBe(true);
    expect(state().dialog).toBe("findReplace");
  });
});

describe("Delete, arrows, Enter and Tab", () => {
  it("Delete and Backspace remove the selection", () => {
    open();
    actions().select(["r"]);
    expect(press("Delete")).toBe(true);
    expect(ids()).not.toContain("r");
    actions().select(["e"]);
    expect(press("Backspace")).toBe(true);
    expect(ids()).not.toContain("e");
    expect(state().selection).toEqual([]);
  });

  it("leaves Delete alone when nothing is selected", () => {
    open();
    expect(press("Delete")).toBe(false);
    expect(elements()).toHaveLength(6);
  });

  it.each([
    ["ArrowLeft", {}, [399, 50]],
    ["ArrowRight", {}, [401, 50]],
    ["ArrowUp", {}, [400, 49]],
    ["ArrowDown", {}, [400, 51]],
    ["ArrowLeft", { shiftKey: true }, [390, 50]],
    ["ArrowRight", { shiftKey: true }, [410, 50]],
    ["ArrowUp", { shiftKey: true }, [400, 40]],
    ["ArrowDown", { shiftKey: true }, [400, 60]],
  ] as const)("%s %j nudges the selection", (key, init, expected) => {
    open();
    actions().select(["r"]);
    expect(press(key, init)).toBe(true);
    expect([byId("r").x, byId("r").y]).toEqual(expected);
  });

  it("nudges every selected element and leaves locked ones where they are", () => {
    open();
    actions().setLocked(["e"], true);
    actions().select(["r", "e"]);
    press("ArrowRight", { shiftKey: true });
    expect(byId("r").x).toBe(410);
    expect(byId("e").x).toBe(400);
  });

  it("merges rapid nudges into one undo step", () => {
    open();
    actions().select(["r"]);
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    expect(byId("r").x).toBe(403);
    expect(state().past).toHaveLength(1);
  });

  it("leaves the arrows alone when nothing is selected", () => {
    open();
    expect(press("ArrowRight")).toBe(false);
  });

  it("Enter starts editing the selected text", () => {
    open();
    actions().select(["t"]);
    expect(press("Enter")).toBe(true);
    expect(state().editingTextId).toBe("t");
  });

  it("Enter opens the selected picture for cropping, but not an empty frame", () => {
    open();
    actions().select(["img"]);
    expect(press("Enter")).toBe(true);
    expect(state().croppingId).toBe("img");
    actions().endCrop();
    actions().select(["frame"]);
    expect(press("Enter")).toBe(false);
    expect(state().croppingId).toBeNull();
  });

  it("Enter does nothing for a shape or for several elements", () => {
    open();
    actions().select(["r"]);
    expect(press("Enter")).toBe(false);
    actions().select(["t", "t2"]);
    expect(press("Enter")).toBe(false);
    expect(state().editingTextId).toBeNull();
  });

  /* Tab is the keyboard's way round the page, so the canvas only borrows it while the canvas itself has the focus */
  describe("Tab", () => {
    let canvas: HTMLElement;
    beforeEach(() => {
      canvas = document.createElement("div");
      canvas.setAttribute("data-cf-workspace", "");
      document.body.appendChild(canvas);
    });
    afterEach(() => canvas.remove());

    it("walks forward and back through the elements in stacking order while the canvas has the focus", () => {
      open();
      actions().select(["t"]);
      expect(press("Tab", {}, canvas)).toBe(true);
      expect(state().selection).toEqual(["t2"]);
      press("Tab", {}, canvas);
      expect(state().selection).toEqual(["r"]);
      press("Tab", { shiftKey: true }, canvas);
      press("Tab", { shiftKey: true }, canvas);
      expect(state().selection).toEqual(["t"]);
    });

    it("moves on from the canvas after the last element (and before the first) instead of wrapping round, so the focus is never stuck there", () => {
      open();
      actions().select(["frame"]);
      expect(press("Tab", {}, canvas)).toBe(false);
      expect(state().selection).toEqual(["frame"]);
      actions().select(["t"]);
      expect(press("Tab", { shiftKey: true }, canvas)).toBe(false);
      expect(state().selection).toEqual(["t"]);
    });

    it("is left to the browser while the page itself has the focus, so that a keyboard user can reach the toolbars at all", () => {
      open();
      expect(press("Tab")).toBe(false);
      expect(press("Tab", { shiftKey: true })).toBe(false);
      expect(state().selection).toEqual([]);
      actions().select(["t"]);
      expect(press("Tab")).toBe(false);
      expect(state().selection).toEqual(["t"]);
    });

    it("starts at the first element when nothing is selected, and moves on over an empty page", () => {
      open();
      expect(press("Tab", {}, canvas)).toBe(true);
      expect(state().selection).toEqual(["t"]);
      open([]);
      expect(press("Tab", {}, canvas)).toBe(false);
      expect(state().selection).toEqual([]);
    });

    it("Shift+Tab starts at the last element when nothing is selected, then walks backwards", () => {
      open();
      expect(press("Tab", { shiftKey: true }, canvas)).toBe(true);
      expect(state().selection).toEqual(["frame"]);
      press("Tab", { shiftKey: true }, canvas);
      expect(state().selection).toEqual(["img"]);
    });
  });
});

describe("tool shortcuts", () => {
  it("T adds a text box in the middle of the page with its text selected for editing", () => {
    open([]);
    expect(press("t")).toBe(true);
    const [el] = elements();
    expect(el.type).toBe("text");
    expect(el.type === "text" && el.paragraphs[0].runs[0].text).toBe("Text");
    expect(el.type === "text" && el.fontSize).toBe(36);
    expect(el.x + el.width / 2).toBeCloseTo(428);
    expect(el.y + el.height / 2).toBeCloseTo(302);
    expect(state().editingTextId).toBe(el.id);
    expect(state().selection).toEqual([el.id]);
    expect(takeSelectAllOnEdit()).toBe(true);
  });

  it.each([
    ["r", "rect"],
    ["c", "ellipse"],
  ])("%s adds a centred %s", (key, shape) => {
    open([]);
    expect(press(key)).toBe(true);
    const [el] = elements();
    expect(el.type === "shape" && el.shape).toBe(shape);
    expect([el.width, el.height]).toEqual([145, 145]);
    expect(el.x + el.width / 2).toBeCloseTo(428);
    expect(state().selection).toEqual([el.id]);
  });

  it("L adds a horizontal line", () => {
    open([]);
    expect(press("l")).toBe(true);
    const [el] = elements();
    expect(el.type).toBe("line");
    expect(el.width).toBe(181);
  });

  it("Shift+R shows and hides the rulers instead of adding a rectangle", () => {
    open([]);
    expect(state().showRulers).toBe(false);
    expect(press("R", { shiftKey: true })).toBe(true);
    expect(state().showRulers).toBe(true);
    press("R", { shiftKey: true });
    expect(state().showRulers).toBe(false);
    expect(elements()).toHaveLength(0);
  });

  it("? opens the list of shortcuts", () => {
    open([]);
    press("?", { shiftKey: true });
    expect(state().dialog).toBe("shortcuts");
  });

  it("does not turn Ctrl or Alt combinations into tools", () => {
    open([]);
    for (const init of [{ ctrlKey: true }, { altKey: true }]) {
      press("t", init);
      press("r", init);
      press("c", init);
      press("l", init);
    }
    expect(elements()).toHaveLength(0);
  });
});

describe("the pen and point editing", () => {
  const path = () => createShape("path", { id: "p", x: 100, y: 100, width: 200, height: 100, fill: null, path: "M0 0 L100 0 L100 100" });
  const nodes = () => elementPath(byId("p") as ShapeElement)!.nodes;
  const draft = (count: number) =>
    useGesture.setState({
      pen: {
        path: { closed: false, nodes: Array.from({ length: count }, (_unused, i) => ({ x: 100 + i * 100, y: 100 + i * 50, handleIn: null, handleOut: null })) },
        hover: null,
        pageId: state().activePageId,
      },
    });
  afterEach(() => {
    stopPathEdit();
    useGesture.setState({ pen: null });
  });

  it("P picks up the pen, unless a modifier is held or a field is being typed in", () => {
    open();
    expect(press("p")).toBe(true);
    expect(state().tool).toBe("pen");
    actions().setTool("select");
    press("p", { ctrlKey: true });
    expect(state().tool).toBe("select");
    const input = document.body.appendChild(document.createElement("input"));
    press("p", {}, input);
    input.remove();
    expect(state().tool).toBe("select");
  });

  it("does not pick up the pen in view mode", () => {
    open();
    actions().setMode("view");
    press("p");
    expect(state().tool).toBe("select");
  });

  it("Enter opens the points of a selected path, and does nothing for another shape", () => {
    open([path(), rect()]);
    actions().select(["r"]);
    press("Enter");
    expect(usePathEdit.getState().id).toBeNull();
    actions().select(["p"]);
    expect(press("Enter")).toBe(true);
    expect(usePathEdit.getState().id).toBe("p");
  });

  it("Enter does not open the points of a locked path, which the list of layers can still select", () => {
    open([createShape("path", { id: "p", x: 100, y: 100, width: 200, height: 100, fill: null, path: "M0 0 L100 0 L100 100", locked: true }), rect()]);
    actions().select(["p"]);
    expect(state().selection).toEqual(["p"]);
    press("Enter");
    expect(usePathEdit.getState().id).toBeNull();
  });

  describe("while a path is being placed", () => {
    it("Enter makes the path and Escape does the same", () => {
      open([rect()]);
      actions().setTool("pen");
      draft(3);
      expect(press("Enter")).toBe(true);
      expect(elements().filter((e) => e.type === "shape" && e.shape === "path")).toHaveLength(1);
      expect(state().tool).toBe("select");
      actions().setTool("pen");
      draft(2);
      press("Escape");
      expect(elements().filter((e) => e.type === "shape" && e.shape === "path")).toHaveLength(2);
    });

    it("Escape throws a single point away and keeps the pen, a second Escape puts it down", () => {
      open([rect()]);
      actions().setTool("pen");
      draft(1);
      press("Escape");
      expect(useGesture.getState().pen).toBeNull();
      expect(elements().filter((e) => e.type === "shape" && e.shape === "path")).toHaveLength(0);
      expect(state().tool).toBe("pen");
      press("Escape");
      expect(state().tool).toBe("select");
    });

    it("Backspace and Delete take the last point back and leave the selection alone", () => {
      open([rect()]);
      actions().select(["r"]);
      actions().setTool("pen");
      actions().select(["r"]);
      draft(3);
      expect(press("Backspace")).toBe(true);
      expect(useGesture.getState().pen!.path.nodes).toHaveLength(2);
      press("Delete");
      expect(useGesture.getState().pen!.path.nodes).toHaveLength(1);
      expect(byId("r")).toBeTruthy();
    });

    it("Ctrl+Z takes the last point back and leaves the document alone; with no point left it is undo again", () => {
      open([rect()]);
      actions().select(["r"]);
      actions().nudge(10, 0);
      actions().setTool("pen");
      draft(3);
      expect(ctrl("z")).toBe(true);
      expect(useGesture.getState().pen!.path.nodes).toHaveLength(2);
      ctrl("z");
      ctrl("z");
      expect(useGesture.getState().pen).toBeNull();
      // the move that was made before the path was started is still made
      expect(byId("r").x).toBe(410);
      ctrl("z");
      expect(byId("r").x).toBe(400);
    });

    it("Ctrl+Shift+Z and Ctrl+Y bring nothing back, so that they cannot redo the document under the path", () => {
      open([rect()]);
      actions().select(["r"]);
      actions().nudge(10, 0);
      actions().undo();
      actions().setTool("pen");
      draft(2);
      expect(ctrl("z", { shiftKey: true })).toBe(true);
      expect(ctrl("y")).toBe(true);
      expect(byId("r").x).toBe(400);
      expect(useGesture.getState().pen!.path.nodes).toHaveLength(2);
      useGesture.setState({ pen: null });
      ctrl("y");
      expect(byId("r").x).toBe(410);
    });
  });

  describe("while the points of a path are edited", () => {
    const edit = () => {
      open([path(), rect()]);
      startPathEdit("p");
    };

    it("Escape leaves point editing and keeps the path selected", () => {
      edit();
      press("Escape");
      expect(usePathEdit.getState().id).toBeNull();
      expect(state().selection).toEqual(["p"]);
      press("Escape");
      expect(state().selection).toEqual([]);
    });

    it("Delete takes the selected points away, not the path", () => {
      edit();
      selectNodes([1]);
      expect(press("Delete")).toBe(true);
      expect(nodes()).toHaveLength(2);
      expect(byId("p")).toBeTruthy();
      press("Backspace");
      expect(nodes()).toHaveLength(2); // nothing is selected now
    });

    it("the arrows move the selected points, a pixel or ten with Shift, and the path when no point is selected", () => {
      edit();
      selectNodes([1]);
      const before = nodes()[1].x;
      press("ArrowRight");
      expect(nodes()[1].x - before).toBeCloseTo(1, 1);
      press("ArrowRight", { shiftKey: true });
      expect(nodes()[1].x - before).toBeCloseTo(11, 1);
      selectNodes([]);
      const x = byId("p").x;
      press("ArrowLeft");
      expect(byId("p").x).toBe(x - 1);
    });

    it("Tab walks through the points, and Enter is done", () => {
      edit();
      expect(press("Tab")).toBe(true);
      expect(usePathEdit.getState().selected).toEqual([0]);
      press("Tab");
      expect(usePathEdit.getState().selected).toEqual([1]);
      press("Tab", { shiftKey: true });
      expect(usePathEdit.getState().selected).toEqual([0]);
      expect(press("Enter")).toBe(true);
      expect(usePathEdit.getState().id).toBeNull();
    });

    it("Tab starts at the first point and Shift+Tab at the last when none is selected", () => {
      edit();
      press("Tab", { shiftKey: true });
      expect(usePathEdit.getState().selected).toEqual([2]);
    });

    it("Tab moves on to the toolbar after the last point (Shift+Tab: before the first) instead of wrapping round, and leaves the elements alone", () => {
      const canvas = document.body.appendChild(document.createElement("div"));
      canvas.setAttribute("data-cf-workspace", "");
      edit();
      for (let i = 0; i < 3; i++) expect(press("Tab", {}, canvas)).toBe(true);
      expect(usePathEdit.getState().selected).toEqual([2]);
      expect(press("Tab", {}, canvas)).toBe(false);
      expect(usePathEdit.getState().selected).toEqual([2]);
      selectNodes([0]);
      expect(press("Tab", { shiftKey: true }, canvas)).toBe(false);
      expect(usePathEdit.getState().selected).toEqual([0]);
      // point editing goes on, on the same path
      expect(state().selection).toEqual(["p"]);
      expect(usePathEdit.getState().id).toBe("p");
      canvas.remove();
    });
  });
});

describe("clipboard", () => {
  const MIME = "application/x-craftly-elements";
  const clip = (data: Record<string, string> = {}, files: File[] = []) => ({ setData: vi.fn(), getData: (type: string) => data[type] ?? "", files });
  const send = (type: "copy" | "cut" | "paste", clipboardData: unknown, target: Element = document.body) => !fireEvent[type](target, { clipboardData });

  it("copy puts the selection on the clipboard in Craftly's own format", () => {
    open();
    actions().select(["r"]);
    const data = clip();
    expect(send("copy", data)).toBe(true);
    expect(data.setData).toHaveBeenCalledWith(MIME, expect.stringContaining('"id":"r"'));
    expect(data.setData).toHaveBeenCalledWith("text/plain", "Craftly design elements");
    expect(state().clipboard?.elements.map((e) => e.id)).toEqual(["r"]);
  });

  it("copy still remembers the selection when the browser gives no clipboard", () => {
    open();
    actions().select(["r"]);
    expect(send("copy", null)).toBe(false);
    expect(state().clipboard?.elements).toHaveLength(1);
  });

  it("copy ignores an empty selection and text fields", () => {
    open();
    expect(send("copy", clip())).toBe(false);
    expect(state().clipboard).toBeNull();
    actions().select(["r"]);
    const input = document.body.appendChild(document.createElement("input"));
    expect(send("copy", clip(), input)).toBe(false);
    expect(state().clipboard).toBeNull();
  });

  it("cut copies and then removes the selection", () => {
    open();
    actions().select(["r"]);
    const data = clip();
    expect(send("cut", data)).toBe(true);
    expect(data.setData).toHaveBeenCalledWith(MIME, expect.any(String));
    expect(ids()).not.toContain("r");
    expect(state().clipboard?.elements).toHaveLength(1);
  });

  it("cut does nothing in view mode, in text fields or without a selection", () => {
    open();
    expect(send("cut", clip())).toBe(false);
    actions().select(["r"]);
    const input = document.body.appendChild(document.createElement("input"));
    expect(send("cut", clip(), input)).toBe(false);
    actions().setMode("view");
    actions().select(["r"]);
    expect(send("cut", clip())).toBe(false);
    expect(elements()).toHaveLength(6);
  });

  it("paste brings back elements copied inside Craftly, a little further down and right each time", () => {
    open();
    actions().select(["r"]);
    const json = JSON.stringify([rect()]);
    expect(send("paste", clip({ [MIME]: json }))).toBe(true);
    expect(elements()).toHaveLength(7);
    const first = elements()[6];
    expect([first.x, first.y]).toEqual([424, 74]);
    send("paste", clip({ [MIME]: json }));
    const second = elements()[7];
    expect([second.x, second.y]).toEqual([448, 98]);
    expect(first.id).not.toBe(second.id);
    expect(state().selection).toEqual([second.id]);
  });

  it("paste checks what another page or program put on the clipboard like the elements of a file", () => {
    open();
    // not a list, a list of things that are no elements, an element of a kind that does not exist: nothing is added
    for (const junk of ["{}", "5", JSON.stringify(["text", null, 7]), JSON.stringify([{ id: "x", type: "hologram", x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 }])]) {
      expect(send("paste", clip({ [MIME]: junk }))).toBe(true);
      expect(elements()).toHaveLength(6);
    }
    // of a mixed list the usable element is kept, and a picture that points to the web comes in as an empty frame
    const photo = { ...rect(), id: "p", type: "image", src: "https://tracker.example/pixel.png", crop: { x: 0, y: 0, width: 1, height: 1 }, filter: {}, mask: "none" };
    send("paste", clip({ [MIME]: JSON.stringify([rect(), { id: "bad", type: "shape" }, photo]) }));
    const added = elements().slice(6);
    expect(added.map((e) => e.type)).toEqual(["shape", "image"]);
    expect((added[1] as { src: unknown }).src).toBeNull();
    expect(JSON.stringify(elements())).not.toContain("tracker.example");
  });

  it("paste ignores clipboard data it cannot read", () => {
    open();
    expect(send("paste", clip({ [MIME]: "{not json" }))).toBe(true);
    expect(elements()).toHaveLength(6);
  });

  it("paste uses the internal clipboard when the system clipboard only holds Craftly's marker text or nothing", () => {
    open();
    actions().select(["r"]);
    actions().copy();
    expect(send("paste", clip({ "text/plain": "Craftly design elements" }))).toBe(true);
    expect(elements()).toHaveLength(7);
    expect(send("paste", clip())).toBe(true);
    expect(elements()).toHaveLength(8);
  });

  it("paste turns plain text into a text box half the page wide", () => {
    open([]);
    expect(send("paste", clip({ "text/plain": "  Quarterly numbers  " }))).toBe(true);
    const [el] = elements();
    expect(el.type === "text" && el.paragraphs[0].runs[0].text).toBe("Quarterly numbers");
    expect(el.type === "text" && el.autoWidth).toBe(false);
    expect(el.type === "text" && el.fontSize).toBe(24);
    expect(el.width).toBe(428);
    expect(state().selection).toEqual([el.id]);
  });

  it("paste prefers new text over an older internal copy", () => {
    open();
    actions().select(["r"]);
    actions().copy();
    send("paste", clip({ "text/plain": "fresh words" }));
    const last = elements()[6];
    expect(last.type).toBe("text");
    expect(elements()).toHaveLength(7);
  });

  it("paste puts a copied picture on the page as an uploaded image", async () => {
    open([]);
    const file = new File(["x"], "shot.png", { type: "image/png" });
    expect(send("paste", clip({}, [file]))).toBe(true);
    await waitFor(() => expect(elements()).toHaveLength(1));
    const [el] = elements();
    expect(el.type === "image" && el.src).toMatch(/^asset:/);
    expect(el.x + el.width / 2).toBeCloseTo(428);
  });

  it("paste ignores files that are not pictures", async () => {
    open([]);
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    expect(send("paste", clip({}, [file]))).toBe(false);
    expect(elements()).toHaveLength(0);
  });

  it("paste does nothing with an empty clipboard, in text fields, in view mode or without a clipboard object", () => {
    open([]);
    expect(send("paste", clip())).toBe(false);
    expect(send("paste", null)).toBe(false);
    const input = document.body.appendChild(document.createElement("input"));
    expect(send("paste", clip({ "text/plain": "typed" }), input)).toBe(false);
    actions().setMode("view");
    expect(send("paste", clip({ "text/plain": "typed" }))).toBe(false);
    expect(elements()).toHaveLength(0);
  });

  it("copy, cut and paste are left to the browser while a popover or dialog is open over the page", () => {
    open();
    actions().select(["r"]);
    for (const mark of [() => (document.body.dataset.cfOverlay = "1"), () => document.body.setAttribute("data-cf-modal-open", "")]) {
      mark();
      const data = clip({ "text/plain": "typed" });
      expect(send("copy", data)).toBe(false);
      expect(send("cut", data)).toBe(false);
      expect(send("paste", data)).toBe(false);
      expect(data.setData).not.toHaveBeenCalled();
      expect(state().clipboard).toBeNull();
      expect(ids()).toEqual(["t", "t2", "r", "e", "img", "frame"]);
      document.body.removeAttribute("data-cf-overlay");
      document.body.removeAttribute("data-cf-modal-open");
    }
    // with nothing over the page they work again
    expect(send("cut", clip())).toBe(true);
    expect(ids()).not.toContain("r");
  });

  it("copy, cut and paste are left to the browser while presenting", () => {
    open();
    actions().setPresenting(true);
    actions().select(["r"]);
    const data = clip({ "text/plain": "typed" });
    expect(send("copy", data)).toBe(false);
    expect(send("cut", data)).toBe(false);
    expect(send("paste", data)).toBe(false);
    expect(data.setData).not.toHaveBeenCalled();
    expect(state().clipboard).toBeNull();
    expect(ids()).toEqual(["t", "t2", "r", "e", "img", "frame"]);
  });

  it("copy, cut and paste stand back when another handler already took the event", () => {
    open();
    actions().select(["r"]);
    const claim = (e: Event) => e.preventDefault();
    for (const type of ["copy", "cut", "paste"] as const) {
      document.addEventListener(type, claim, true);
      send(type, clip({ "text/plain": "typed" }));
      document.removeEventListener(type, claim, true);
    }
    expect(state().clipboard).toBeNull();
    expect(ids()).toEqual(["t", "t2", "r", "e", "img", "frame"]);
  });

  it("copy, cut and paste do nothing without an open design", () => {
    resetEditor();
    expect(send("copy", clip())).toBe(false);
    expect(send("cut", clip())).toBe(false);
    expect(send("paste", clip({ "text/plain": "x" }))).toBe(false);
  });
});

describe("installation", () => {
  it("removes every listener when uninstalled", () => {
    open();
    actions().select(["r"]);
    uninstall();
    expect(press("Delete")).toBe(false);
    expect(elements()).toHaveLength(6);
    expect(!fireEvent.copy(document.body, { clipboardData: { setData: vi.fn(), getData: () => "", files: [] } })).toBe(false);
    uninstall = installHotkeys();
    press("Delete");
    expect(elements()).toHaveLength(5);
  });

  it("selects inside groups only through their top level element", () => {
    const group = createGroup([createShape("rect", { id: "kid", x: 0, y: 0, width: 50, height: 50 })], { id: "grp", x: 100, y: 100, width: 50, height: 50 });
    open([group, rect()]);
    actions().select(["grp"]);
    press("ArrowDown", { shiftKey: true });
    expect(byId("grp").y).toBe(110);
  });
});

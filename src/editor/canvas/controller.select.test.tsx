/**
 * Pointer controller: choosing things on the canvas. Pressing, shift-clicking, marquee selection, right click,
 * hovering, double clicking, the context menu and the guards that make the controller ignore the pointer.
 */
import { act, configure, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChart, createGroup, createImage, createShape, createTable, createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { canvasDesign, mountWorkspace, selectIds } from "@/test/canvasUtils";
import { setContextMenuHandler, takePendingCaret } from "./controller";
import { useGesture } from "./gestureStore";
import { useTableCellEditor } from "./tableCellEditing";
import { stopPathEdit, usePathEdit } from "./pathEditStore";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const sel = () => useEditor.getState().selection;

/** Two free shapes, a locked one and a hidden one, laid out on a grid so every test can aim at a known spot. */
const shapes = () => [
  createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 }),
  createShape("ellipse", { id: "b", x: 400, y: 100, width: 200, height: 100 }),
  createShape("rect", { id: "locked", x: 100, y: 300, width: 200, height: 100, locked: true }),
  createShape("rect", { id: "hidden", x: 400, y: 300, width: 200, height: 100, hidden: true }),
];

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).caretRangeFromPoint;
  act(() => stopPathEdit());
});

describe("selecting by clicking", () => {
  it("selects the element under the pointer without touching the history", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150);
    expect(sel()).toEqual(["a"]);
    rig.up(200, 150);
    expect(sel()).toEqual(["a"]);
    expect(useEditor.getState().past).toHaveLength(0);
    expect(rig.host.style.cursor).toBe("");
  });

  it("picks the topmost of two overlapping elements", async () => {
    const under = createShape("rect", { id: "under", x: 100, y: 100, width: 200, height: 200 });
    const over = createShape("rect", { id: "over", x: 150, y: 150, width: 200, height: 200 });
    const rig = await mountWorkspace(canvasDesign([under, over]));
    rig.down(200, 200);
    expect(sel()).toEqual(["over"]);
    rig.up(200, 200);
    rig.down(120, 120);
    expect(sel()).toEqual(["under"]);
  });

  it("clicking empty canvas clears the selection", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(700, 500);
    rig.up(700, 500);
    expect(sel()).toEqual([]);
  });

  it("ignores hidden elements", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(500, 350);
    rig.up(500, 350);
    expect(sel()).toEqual([]);
  });

  it.each([
    ["shift", { shift: true }],
    ["ctrl", { ctrl: true }],
    ["cmd", { meta: true }],
  ])("%s-click adds an element to the selection and clicking it again removes it", async (_name, mod) => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150);
    rig.up(200, 150);
    rig.down(500, 150, mod);
    rig.up(500, 150, mod);
    expect(sel()).toEqual(["a", "b"]);
    rig.down(200, 150, mod);
    rig.up(200, 150, mod);
    expect(sel()).toEqual(["b"]);
  });

  it("keeps a multiple selection while pressing on a member, and narrows it down on release without moving", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a", "b");
    rig.down(200, 150);
    expect(sel()).toEqual(["a", "b"]);
    rig.up(200, 150);
    expect(sel()).toEqual(["a"]);
  });

  it("keeps a multiple selection when the member is dragged instead of clicked", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    getActions().toggle("snapEnabled");
    selectIds("a", "b");
    rig.drag([200, 150], [260, 150]);
    expect(sel()).toEqual(["a", "b"]);
  });

  it("selects a locked element but never moves it", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 350);
    expect(sel()).toEqual(["locked"]);
    rig.move(260, 380);
    rig.move(300, 420);
    rig.up(300, 420);
    const el = useEditor.getState().design!.pages[0].elements.find((e) => e.id === "locked")!;
    expect([el.x, el.y]).toEqual([100, 300]);
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it("picks an element through a group's children, not the group's empty box", async () => {
    const group = createGroup([createShape("rect", { id: "kid", x: 0, y: 0, width: 100, height: 100 })], { id: "grp", x: 300, y: 300, width: 400, height: 300 });
    const rig = await mountWorkspace(canvasDesign([group]));
    rig.down(650, 550);
    expect(sel()).toEqual([]);
    rig.up(650, 550);
    rig.down(350, 350);
    expect(sel()).toEqual(["grp"]);
  });
});

describe("marquee selection", () => {
  it("selects everything the rectangle touches and shows the rectangle while dragging", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(50, 50);
    rig.move(70, 70);
    expect(useGesture.getState().marquee).toEqual({ x: 50, y: 50, w: 20, h: 20 });
    expect(rig.container.querySelector(".cf-marquee")).toBeTruthy();
    rig.move(650, 250);
    expect(sel()).toEqual(["a", "b"]);
    rig.up(650, 250);
    expect(useGesture.getState().marquee).toBeNull();
    expect(rig.container.querySelector(".cf-marquee")).toBeNull();
    expect(sel()).toEqual(["a", "b"]);
  });

  it("includes locked elements but skips hidden ones", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.drag([650, 450], [50, 50]);
    expect(sel()).toEqual(["a", "b", "locked"]);
  });

  it("only starts after the pointer has travelled a few pixels", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(50, 50);
    expect(sel()).toEqual([]);
    rig.move(52, 52);
    expect(useGesture.getState().marquee).toBeNull();
    rig.move(120, 120);
    expect(sel()).toEqual(["a"]);
    rig.up(120, 120);
  });

  it("extends the existing selection when shift is held", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.drag([350, 50], [650, 250], { shift: true });
    expect(sel()).toEqual(["a", "b"]);
  });

  it("does nothing to the document", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const before = useEditor.getState().design;
    rig.drag([50, 50], [650, 250]);
    expect(useEditor.getState().design).toBe(before);
    expect(useEditor.getState().canUndo).toBe(false);
  });
});

describe("right click", () => {
  it("selects the element under the pointer", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150, { button: 2 });
    expect(sel()).toEqual(["a"]);
    rig.down(500, 150, { button: 2 });
    expect(sel()).toEqual(["b"]);
  });

  it("keeps a multiple selection when one of its members is right-clicked", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a", "b");
    rig.down(200, 150, { button: 2 });
    expect(sel()).toEqual(["a", "b"]);
  });

  it("clears the selection on empty canvas, but not on a selection handle", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(700, 500, { button: 2, target: rig.handle("resize:se") });
    expect(sel()).toEqual(["a"]);
    rig.down(700, 500, { button: 2 });
    expect(sel()).toEqual([]);
  });

  it("hands the position to the registered context menu and cancels the browser menu", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const menu = vi.fn();
    setContextMenuHandler(menu);
    rig.down(200, 150, { button: 2 });
    const allowed = rig.contextMenu(200, 150);
    expect(allowed).toBe(false);
    expect(menu).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenCalledWith(272, 198, { overElement: true });
  });

  it("tells the menu that nothing is under the pointer on empty canvas", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const menu = vi.fn();
    setContextMenuHandler(menu);
    rig.down(700, 500, { button: 2 });
    rig.contextMenu(700, 500);
    expect(menu).toHaveBeenCalledWith(772, 548, { overElement: false });
  });

  it("still cancels the browser menu when no menu is registered", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    expect(rig.contextMenu(200, 150)).toBe(false);
  });

  it("leaves the browser menu alone on the editor's own controls", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const menu = vi.fn();
    setContextMenuHandler(menu);
    const chrome = document.createElement("div");
    chrome.setAttribute("data-cf-ui", "");
    rig.host.appendChild(chrome);
    expect(rig.contextMenu(200, 150, { target: chrome })).toBe(true);
    expect(menu).not.toHaveBeenCalled();
  });

  it("does not open a menu without an open design", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const menu = vi.fn();
    setContextMenuHandler(menu);
    act(() => getActions().closeDesign());
    rig.contextMenu(200, 150);
    expect(menu).not.toHaveBeenCalled();
  });
});

describe("when the controller must ignore the pointer", () => {
  it("ignores presses that land on the editor's own controls", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const chrome = document.createElement("button");
    chrome.setAttribute("data-cf-ui", "");
    rig.host.appendChild(chrome);
    rig.down(200, 150, { target: chrome });
    expect(sel()).toEqual([]);
  });

  it("ignores everything while presenting", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setPresenting(true));
    rig.down(200, 150);
    expect(sel()).toEqual([]);
  });

  it("ignores everything without an open design", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().closeDesign());
    expect(rig.down(200, 150)).toBe(true);
    expect(sel()).toEqual([]);
  });

  it("does not select anything in view mode", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setMode("view"));
    rig.down(200, 150);
    rig.up(200, 150);
    expect(sel()).toEqual([]);
  });

  it("does not create anything with a drawing tool in view mode", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setTool("shape"));
    act(() => getActions().setMode("view"));
    rig.drag([500, 450], [600, 520]);
    expect(useEditor.getState().design!.pages[0].elements).toHaveLength(4);
  });

  it("ignores secondary mouse buttons that have no meaning (back, forward)", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150, { button: 4 });
    expect(sel()).toEqual([]);
  });

  it("ignores moves and releases of a different pointer during a gesture", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    getActions().toggle("snapEnabled");
    rig.down(200, 150, { pointerId: 1 });
    rig.move(260, 150, { pointerId: 2 });
    rig.up(260, 150, { pointerId: 2 });
    expect(useEditor.getState().design!.pages[0].elements[0].x).toBe(100);
    rig.move(260, 150, { pointerId: 1 });
    expect(useEditor.getState().design!.pages[0].elements[0].x).toBe(160);
    rig.up(260, 150, { pointerId: 1 });
  });

  it("stops listening once the workspace is unmounted", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.move(200, 150);
    rig.unmount();
    fireEvent.pointerDown(rig.host, { ...rig.client(200, 150), pointerId: 1, button: 0 });
    expect(sel()).toEqual([]);
  });
});

describe("pressing while text or an image is being edited", () => {
  const text = () => createText({ id: "t", text: "Hello", x: 100, y: 400, width: 300, fontSize: 40 });
  const photo = () => createImage({ id: "img", src: "https://example.test/p.jpg", x: 500, y: 300, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300 });

  it("ends text editing when the pointer is pressed elsewhere", async () => {
    const rig = await mountWorkspace(canvasDesign([...shapes(), text()]));
    act(() => getActions().startTextEdit("t"));
    expect(useEditor.getState().editingTextId).toBe("t");
    rig.down(700, 500);
    expect(useEditor.getState().editingTextId).toBeNull();
    expect(sel()).toEqual([]);
  });

  it("keeps editing when the press lands on the text editor itself", async () => {
    const rig = await mountWorkspace(canvasDesign([...shapes(), text()]));
    act(() => getActions().startTextEdit("t"));
    const editor = rig.container.querySelector<HTMLElement>("[data-cf-text-editor]")!;
    rig.down(700, 500, { target: editor });
    expect(useEditor.getState().editingTextId).toBe("t");
    expect(sel()).toEqual(["t"]);
  });

  it("ends cropping when the pointer is pressed outside the crop frame and carries on with the click", async () => {
    const rig = await mountWorkspace(canvasDesign([...shapes(), photo()]));
    act(() => getActions().startCrop("img"));
    expect(useEditor.getState().croppingId).toBe("img");
    rig.down(200, 150);
    expect(useEditor.getState().croppingId).toBeNull();
    expect(sel()).toEqual(["a"]);
  });

  it("leaves the crop frame alone when the press lands inside it", async () => {
    const rig = await mountWorkspace(canvasDesign([...shapes(), photo()]));
    act(() => getActions().startCrop("img"));
    const frame = rig.container.querySelector<HTMLElement>("[data-cf-crop]")!;
    rig.down(200, 150, { target: frame });
    expect(useEditor.getState().croppingId).toBe("img");
    expect(sel()).toEqual(["img"]);
  });
});

describe("hovering", () => {
  it("highlights the element under the pointer and clears the highlight when it leaves", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.move(200, 150);
    await waitFor(() => expect(useEditor.getState().hoverId).toBe("a"));
    expect(rig.container.querySelector(".cf-outline--hover")).toBeTruthy();
    rig.move(700, 500);
    await waitFor(() => expect(useEditor.getState().hoverId).toBeNull());
    expect(rig.container.querySelector(".cf-outline--hover")).toBeNull();
  });

  it("does not highlight the element that is already selected", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.move(200, 150);
    rig.move(201, 151);
    await waitFor(() => expect(useEditor.getState().hoverId).toBeNull());
    rig.move(500, 150);
    await waitFor(() => expect(useEditor.getState().hoverId).toBe("b"));
  });

  it.each([
    ["a drawing tool is active", () => getActions().setTool("text")],
    ["the document is being presented", () => getActions().setPresenting(true)],
  ])("clears the highlight when %s", async (_name, change) => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setHover("a"));
    act(() => change());
    rig.move(500, 150);
    await waitFor(() => expect(useEditor.getState().hoverId).toBeNull());
  });

  it("clears the highlight over the editor's own controls", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const chrome = document.createElement("div");
    chrome.setAttribute("data-cf-ui", "");
    rig.host.appendChild(chrome);
    act(() => getActions().setHover("a"));
    rig.move(200, 150, { target: chrome });
    await waitFor(() => expect(useEditor.getState().hoverId).toBeNull());
  });

  it("does nothing when the workspace goes away before the next frame", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.move(200, 150);
    rig.unmount();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(useEditor.getState().hoverId).toBeNull();
  });
});

describe("drawing a connector", () => {
  it("drags from a shape's anchor to another element and shows a preview", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.move(200, 150);
    await waitFor(() => expect(rig.handle("connect:a:right")).toBeTruthy());
    rig.down(300, 150, { target: rig.handle("connect:a:right") });
    rig.move(500, 150);
    expect(useGesture.getState().connector).toEqual({ start: { x: 300, y: 150 }, end: { x: 500, y: 150 } });
    expect(rig.container.querySelector("[data-cf-connector-preview]")).toBeTruthy();
    rig.up(500, 150);
    const line = useEditor.getState().design!.pages[0].elements.find((el) => el.type === "line");
    expect(line?.type).toBe("line");
    if (line?.type !== "line") throw new Error("connector was not created");
    expect(line.start).toEqual({ elementId: "a", anchor: "right" });
    expect(line.end).toEqual({ elementId: "b", anchor: "auto" });
    expect(useEditor.getState().selection).toEqual([line.id]);
    expect(useGesture.getState().connector).toBeNull();
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it("creates nothing when the drag is cancelled or ends on empty canvas", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.move(200, 150);
    await waitFor(() => expect(rig.handle("connect:a:right")).toBeTruthy());
    rig.down(300, 150, { target: rig.handle("connect:a:right") });
    rig.move(300, 250);
    rig.up(300, 250);
    expect(useEditor.getState().design!.pages[0].elements.some((el) => el.type === "line")).toBe(false);
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useGesture.getState().connector).toBeNull();
  });
});

describe("double click", () => {
  const text = () => createText({ id: "t", text: "Hello there", x: 100, y: 400, width: 300, fontSize: 40 });
  const photo = () => createImage({ id: "img", src: "https://example.test/p.jpg", x: 500, y: 300, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300 });
  const frame = () => createImage({ id: "frame", src: null, x: 500, y: 100, width: 200, height: 150, naturalWidth: 1, naturalHeight: 1, isFrame: true });
  const curve = (path = "M0 0 C50 0 100 50 100 100 L0 100 Z") =>
    createShape("path", { id: "pth", x: 100, y: 100, width: 200, height: 100, fill: { type: "solid", color: "#0e1318" }, path });
  const grouped = () =>
    createGroup([createText({ id: "inner", text: "Inside", x: 10, y: 10, width: 200, fontSize: 30 }), createShape("rect", { id: "bar", x: 10, y: 80, width: 200, height: 20 })], {
      id: "grp",
      x: 100,
      y: 500,
      width: 220,
      height: 100,
    });

  it("starts editing a text element and remembers where the caret belongs", async () => {
    const rig = await mountWorkspace(canvasDesign([text()]));
    rig.dblclick(150, 420);
    expect(useEditor.getState().editingTextId).toBe("t");
    expect(sel()).toEqual(["t"]);
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeTruthy();
  });

  it("puts the caret at the double-clicked character", async () => {
    const at = vi.fn(() => {
      const node = document.querySelector("[data-cf-text-editor] span")!.firstChild as Text;
      const range = document.createRange();
      range.setStart(node, 4);
      return range;
    });
    (document as unknown as Record<string, unknown>).caretRangeFromPoint = at;
    const rig = await mountWorkspace(canvasDesign([text()]));
    rig.dblclick(150, 420);
    const { clientX, clientY } = rig.client(150, 420);
    expect(at).toHaveBeenCalledWith(clientX, clientY);
    const selection = window.getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorOffset).toBe(4);
  });

  it("hands the caret position over only once", async () => {
    const rig = await mountWorkspace(canvasDesign([text()]));
    rig.dblclick(150, 420);
    expect(takePendingCaret()).toBeNull();
  });

  it("opens the cells of a table, on the cell that was double-clicked", async () => {
    const rig = await mountWorkspace(canvasDesign([createTable({ id: "tb", x: 100, y: 400, width: 600, height: 240 })]));
    rig.dblclick(350, 500);
    expect(sel()).toEqual(["tb"]);
    expect(useEditor.getState().context).toEqual({ kind: "data", cell: { row: 1, col: 1 } });
    expect(useEditor.getState().editingTextId).toBeNull();
  });

  it("types in a cell on the page, tabs to the next cell and closes with Escape", async () => {
    const rig = await mountWorkspace(canvasDesign([createTable({ id: "tb", x: 100, y: 400, width: 600, height: 240 })]));
    rig.dblclick(350, 500);
    expect(useTableCellEditor.getState().editing).toEqual({ id: "tb", row: 1, col: 1 });
    const field = rig.container.querySelector<HTMLTextAreaElement>("[data-cf-table-editor]")!;
    fireEvent.change(field, { target: { value: "Edited on page" } });
    const table = useEditor.getState().design!.pages[0].elements[0];
    expect(table.type === "table" && table.cells[1][1]).toBe("Edited on page");
    fireEvent.keyDown(field, { key: "Tab" });
    expect(useTableCellEditor.getState().editing).toEqual({ id: "tb", row: 1, col: 2 });
    fireEvent.keyDown(rig.container.querySelector("[data-cf-table-editor]")!, { key: "Escape" });
    expect(useTableCellEditor.getState().editing).toBeNull();
  });

  it("opens the numbers of a chart", async () => {
    const rig = await mountWorkspace(canvasDesign([createChart({ id: "ch", x: 100, y: 400, width: 600, height: 240 })]));
    rig.dblclick(350, 500);
    expect(sel()).toEqual(["ch"]);
    expect(useEditor.getState().context).toEqual({ kind: "data" });
  });

  it("leaves a locked table and a design that is only looked at alone", async () => {
    const rig = await mountWorkspace(canvasDesign([createTable({ id: "tb", x: 100, y: 400, width: 600, height: 240, locked: true })]));
    rig.dblclick(350, 500);
    expect(useEditor.getState().context).toBeNull();
    act(() => {
      getActions().setLocked(["tb"], false);
      getActions().setMode("view");
    });
    rig.dblclick(350, 500);
    expect(useEditor.getState().context).toBeNull();
  });

  it("opens an image for cropping", async () => {
    const rig = await mountWorkspace(canvasDesign([photo()]));
    rig.dblclick(600, 375);
    expect(useEditor.getState().croppingId).toBe("img");
    expect(sel()).toEqual(["img"]);
  });

  it("does nothing on an empty image frame", async () => {
    const rig = await mountWorkspace(canvasDesign([frame()]));
    rig.dblclick(600, 175);
    expect(useEditor.getState().croppingId).toBeNull();
  });

  it("opens the points of a path", async () => {
    const rig = await mountWorkspace(canvasDesign([curve()]));
    rig.dblclick(200, 150);
    expect(usePathEdit.getState().id).toBe("pth");
    expect(sel()).toEqual(["pth"]);
  });

  it("does not open the points of a path that cannot be edited point by point", async () => {
    const rig = await mountWorkspace(canvasDesign([curve("M0 0 A50 50 0 0 1 100 100 Z")]));
    rig.dblclick(200, 150);
    expect(usePathEdit.getState().id).toBeNull();
  });

  it("does not open the points of a shape that is not a path", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.dblclick(200, 150);
    expect(usePathEdit.getState().id).toBeNull();
  });

  it("does not open the points of a locked path", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("path", { id: "pth", x: 100, y: 100, width: 200, height: 100, path: "M0 0 L100 0 L100 100 Z", locked: true })]));
    rig.dblclick(250, 125);
    expect(usePathEdit.getState().id).toBeNull();
  });

  it("enters a group and edits the selected child text", async () => {
    const rig = await mountWorkspace(canvasDesign([grouped()]));
    rig.dblclick(150, 530);
    expect(useEditor.getState().editingTextId).toBe("inner");
    expect(useEditor.getState().focusGroupId).toBe("grp");
    expect(sel()).toEqual(["inner"]);
  });

  it("enters one group at a time before editing deeply nested text", async () => {
    const inner = createGroup([createText({ id: "deep", text: "Deep", x: 5, y: 5, width: 200, fontSize: 30 })], { id: "inner", x: 10, y: 10, width: 220, height: 60 });
    const outer = createGroup([inner, createShape("rect", { id: "bar", x: 10, y: 120, width: 200, height: 20 })], { id: "outer", x: 100, y: 400, width: 240, height: 150 });
    const rig = await mountWorkspace(canvasDesign([outer]));
    rig.dblclick(150, 430);
    expect(useEditor.getState().editingTextId).toBeNull();
    expect(useEditor.getState().focusGroupId).toBe("outer");
    expect(sel()).toEqual(["inner"]);
    rig.dblclick(150, 430);
    expect(useEditor.getState().editingTextId).toBe("deep");
    expect(useEditor.getState().focusGroupId).toBe("inner");
    expect(sel()).toEqual(["deep"]);
  });

  it("does nothing on a non-text element inside a group", async () => {
    const rig = await mountWorkspace(canvasDesign([grouped()]));
    rig.dblclick(150, 590);
    expect(useEditor.getState().editingTextId).toBeNull();
  });

  it("does nothing on a locked element or on empty canvas", async () => {
    const locked = createText({ id: "lt", text: "Locked", x: 100, y: 400, width: 300, fontSize: 40, locked: true });
    const rig = await mountWorkspace(canvasDesign([locked]));
    rig.dblclick(150, 420);
    rig.dblclick(700, 100);
    expect(useEditor.getState().editingTextId).toBeNull();
  });

  it.each([
    ["view mode", () => getActions().setMode("view")],
    ["a drawing tool", () => getActions().setTool("shape")],
  ])("does nothing in %s", async (_name, change) => {
    const rig = await mountWorkspace(canvasDesign([text()]));
    act(() => change());
    rig.dblclick(150, 420);
    expect(useEditor.getState().editingTextId).toBeNull();
  });

  it("does nothing when the double click lands on a handle or on the editor's controls", async () => {
    const rig = await mountWorkspace(canvasDesign([text()]));
    selectIds("t");
    rig.dblclick(150, 420, { target: rig.handle("resize:se") });
    expect(useEditor.getState().editingTextId).toBeNull();
  });
});

describe("hover and keyboard odds and ends", () => {
  it("does not highlight anything once a gesture has started before the frame is drawn", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.move(500, 150);
    rig.down(200, 150);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(useEditor.getState().hoverId).toBeNull();
    rig.up(200, 150);
  });

  it("leaves the store alone when there is no highlight to clear", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    act(() => getActions().setTool("text"));
    const changed = vi.fn();
    const stop = useEditor.subscribe(changed);
    rig.move(500, 150);
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();
    expect(changed).not.toHaveBeenCalled();
  });

  it("leaves the store alone over the editor's own controls when nothing is highlighted", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const chrome = document.createElement("div");
    chrome.setAttribute("data-cf-ui", "");
    rig.host.appendChild(chrome);
    const changed = vi.fn();
    const stop = useEditor.subscribe(changed);
    rig.move(200, 150, { target: chrome });
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps the grab cursor when a key other than Space is released", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    fireEvent.keyUp(document.body, { code: "KeyA", key: "a" });
    expect(rig.host.style.cursor).toBe("grab");
    fireEvent.keyUp(document.body, { code: "Space", key: " " });
    expect(rig.host.style.cursor).toBe("");
  });

  it("ignores a double click on a hidden member of a group", async () => {
    const ghost = createText({ id: "ghost", text: "Hidden", x: 10, y: 10, width: 200, fontSize: 30, hidden: true });
    const bar = createShape("rect", { id: "bar", x: 10, y: 10, width: 200, height: 40 });
    const rig = await mountWorkspace(canvasDesign([createGroup([bar, ghost], { id: "grp", x: 100, y: 500, width: 220, height: 60 })]));
    rig.dblclick(150, 520);
    expect(useEditor.getState().editingTextId).toBeNull();
  });

  it("copes with drag events that carry no data transfer at all", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    expect(fireEvent(rig.host, new MouseEvent("dragover", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fireEvent(rig.host, new MouseEvent("drop", { bubbles: true, cancelable: true }))).toBe(true);
    expect(useEditor.getState().design!.pages[0].elements).toHaveLength(4);
  });

  it("copes with a dropped panel item that reports no file list", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, ...rig.client(300, 450) });
    const payload = { type: "background", fill: { type: "solid", color: "#112233" } };
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["application/x-craftly"], getData: () => JSON.stringify(payload) } });
    fireEvent(rig.host, drop);
    expect(useEditor.getState().design!.pages[0].background).toEqual(payload.fill);
  });

  it("ignores a press on a handle it does not know", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    const stray = document.createElement("div");
    stray.setAttribute("data-cf-handle", "bogus");
    rig.host.appendChild(stray);
    rig.down(200, 150, { target: stray });
    rig.move(300, 250);
    rig.up(300, 250);
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().design!.pages[0].elements[0].x).toBe(100);
  });
});

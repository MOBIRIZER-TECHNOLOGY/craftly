import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphic, createGroup, createImage, createLine, createShape, createText } from "@/core/factory";
import type { GroupElement } from "@/core/types";
import { contextOf } from "@/test/canvasMock";
import { captureContexts } from "@/test/logicPaint";
import { dragEvent, dragOnto, fakeDataTransfer, live, openElements, paintOrder, showPanel, store } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";
import { LayerThumb } from "./LayerThumb";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

/** text, square, group (circle + text), photo, line: paint order, so the line is the top-most layer */
function scene() {
  const text = createText({ text: "Hello", x: 10, y: 10 });
  const square = createShape("rect", { x: 100, y: 100, width: 100, height: 100 });
  const circle = createShape("ellipse", { x: 0, y: 0, width: 50, height: 50 });
  const inner = createText({ text: "Inner", x: 0, y: 60 });
  const group = createGroup([circle, inner], { x: 300, y: 100, width: 100, height: 100 });
  const photo = createImage({ src: "https://example.test/p.jpg", x: 500, y: 100, width: 100, height: 80, naturalWidth: 100, naturalHeight: 80 });
  const line = createLine({ x: 10, y: 400, width: 200 });
  openElements([text, square, group, photo, line]);
  showPanel({ kind: "position", tab: "layers" });
  return { text, square, circle, inner, group, photo, line };
}

const rowNames = () => Array.from(document.querySelectorAll<HTMLElement>("[data-layer-main]")).map((r) => r.getAttribute("aria-label"));
const row = (name: string) => screen.getByRole("button", { name });
/** the menu labels without their shortcuts ("DuplicateCtrl+D" is the item "Duplicate") */
const items = () => screen.getAllByRole("menuitem").map((i) => (i.textContent ?? "").replace(/(Ctrl\+.*|Del)$/, ""));
const openMenuOf = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const li = row(name).closest("li") as HTMLElement;
  await user.click(within(li).getByRole("button", { name: "Layer actions" }));
  return screen.getByRole("menu", { name: "Layer actions" });
};
const choose = async (user: ReturnType<typeof userEvent.setup>, name: RegExp | string) => user.click(screen.getByRole("menuitem", { name }));

describe("Layers tab", () => {
  it("says so when the page has no elements", () => {
    openElements([]);
    showPanel({ kind: "position", tab: "layers" });
    expect(screen.getByText("No layers yet")).toBeTruthy();
  });

  it("lists the layers top-most first with a name derived from what they are", () => {
    scene();
    expect(rowNames()).toEqual(["Line: Line", "Image: Image", "Group: Group (2)", "Shape: Square", "Text: Hello"]);
  });

  it("selects a layer when it is clicked, adds with Ctrl and responds to Enter and Space", async () => {
    const user = userEvent.setup();
    const { text, square, photo } = scene();
    await user.click(row("Text: Hello"));
    expect(store().selection).toEqual([text.id]);
    expect(row("Text: Hello").getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("{Control>}");
    await user.click(row("Shape: Square"));
    await user.keyboard("{/Control}");
    expect(store().selection).toEqual([text.id, square.id]);
    // Ctrl-click on a selected layer takes it out again
    await user.keyboard("{Control>}");
    await user.click(row("Text: Hello"));
    await user.keyboard("{/Control}");
    expect(store().selection).toEqual([square.id]);

    row("Image: Image").focus();
    await user.keyboard("{Enter}");
    expect(store().selection).toEqual([photo.id]);
    row("Text: Hello").focus();
    await user.keyboard(" ");
    expect(store().selection).toHaveLength(1);
    expect(row("Text: Hello").getAttribute("aria-pressed")).toBe("true");
  });

  it("moves the focus between layers with the arrow keys", async () => {
    const user = userEvent.setup();
    scene();
    row("Line: Line").focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("Image: Image"));
    await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(row("Line: Line"));
    // the top and bottom ends hold the focus instead of wrapping
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(row("Line: Line"));
    // focus outside of a layer row is left alone
    (screen.getAllByRole("button", { name: "Layer actions" })[0] as HTMLElement).focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "Layer actions" })[0]);
  });

  it("opens a group to show its layers and selects the whole group when one of them is clicked", async () => {
    const user = userEvent.setup();
    const { group, inner } = scene();
    expect(screen.queryByRole("button", { name: "Text: Inner" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    expect(rowNames()).toEqual(["Line: Line", "Image: Image", "Group: Group (2)", "Text: Inner", "Shape: Circle", "Shape: Square", "Text: Hello"]);
    await user.click(row("Text: Inner"));
    expect(store().selection).toEqual([group.id]);
    expect(live<GroupElement>(group).children).toContain(inner);
    await user.click(screen.getByRole("button", { name: "Collapse Group (2)" }));
    expect(screen.queryByRole("button", { name: "Text: Inner" })).toBeNull();
  });

  it("opens and closes a group with the right and left arrow keys", async () => {
    const user = userEvent.setup();
    scene();
    row("Group: Group (2)").focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Text: Inner" })).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    row("Group: Group (2)").focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("button", { name: "Text: Inner" })).toBeNull();
    // arrows do nothing on a layer that is not a group
    row("Text: Hello").focus();
    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(rowNames()).toHaveLength(5);
  });

  it("hides and shows a layer, and locks and unlocks it", async () => {
    const user = userEvent.setup();
    const { square } = scene();
    const li = () => row("Shape: Square").closest("li") as HTMLElement;
    await user.click(within(li()).getByRole("button", { name: "Hide layer" }));
    expect(live(square).hidden).toBe(true);
    expect(li().classList.contains("is-hidden")).toBe(true);
    await user.click(within(li()).getByRole("button", { name: "Show layer" }));
    expect(live(square).hidden).toBe(false);

    await user.click(within(li()).getByRole("button", { name: "Lock layer" }));
    expect(live(square).locked).toBe(true);
    expect(li().classList.contains("is-locked")).toBe(true);
    await user.click(within(li()).getByRole("button", { name: "Unlock layer" }));
    expect(live(square).locked).toBe(false);
  });

  it("renames a layer with a double click, Enter, and ignores an unchanged or cancelled name", async () => {
    const user = userEvent.setup();
    const { text, square } = scene();
    await user.dblClick(row("Text: Hello"));
    const input = screen.getByRole("textbox", { name: "Layer name" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Hello");
    await user.keyboard("My title{Enter}");
    expect(live(text).name).toBe("My title");
    expect(row("Text: My title")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Layer name" })).toBeNull();

    // the name it already shows is not stored as a name of its own
    await user.dblClick(row("Shape: Square"));
    await user.keyboard("{Enter}");
    expect(live(square).name).toBeUndefined();

    // Escape drops the edit and keeps the panel open
    await user.dblClick(row("Shape: Square"));
    await user.keyboard("Nope{Escape}");
    expect(live(square).name).toBeUndefined();
    expect(screen.getByRole("list", { name: "Layers, top-most first" })).toBeTruthy();

    // leaving the field commits it, and an empty name goes back to the derived one
    await user.dblClick(row("Shape: Square"));
    await user.keyboard("Box");
    await user.click(screen.getByRole("list", { name: "Layers, top-most first" }));
    expect(live(square).name).toBe("Box");
    await user.dblClick(row("Shape: Box"));
    await user.clear(screen.getByRole("textbox", { name: "Layer name" }));
    await user.keyboard("{Enter}");
    expect(live(square).name).toBeUndefined();
    expect(row("Shape: Square")).toBeTruthy();
  });

  it("renames with F2", async () => {
    const user = userEvent.setup();
    const { line } = scene();
    row("Line: Line").focus();
    await user.keyboard("{F2}Rule{Enter}");
    expect(live(line).name).toBe("Rule");
  });

  it("offers the layer menu for a top-level layer", async () => {
    const user = userEvent.setup();
    const { photo } = scene();
    await openMenuOf(user, "Image: Image");
    expect(items()).toEqual(["Rename", "Duplicate", "Bring to front", "Bring forward", "Send backward", "Send to back", "Hide", "Lock", "Delete"]);
    await choose(user, /^Duplicate/);
    expect(paintOrder()).toHaveLength(6);
    expect(store().selection).toHaveLength(1);
    expect(store().selection[0]).not.toBe(photo.id);
  });

  it("arranges, hides, locks and deletes from the layer menu, and respects the ends of the stack", async () => {
    const user = userEvent.setup();
    const { text, square, photo, line } = scene();

    // the top layer cannot go further up, the bottom one not further down
    await openMenuOf(user, "Line: Line");
    expect(screen.getByRole("menuitem", { name: /^Bring to front/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /^Bring forward/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /^Send to back/ }).getAttribute("aria-disabled")).toBeNull();
    await choose(user, /^Send to back/);
    expect(paintOrder()[0]).toBe(line.id);

    await openMenuOf(user, "Line: Line");
    expect(screen.getByRole("menuitem", { name: /^Send backward/ }).getAttribute("aria-disabled")).toBe("true");
    await choose(user, /^Bring forward/);
    expect(paintOrder()[1]).toBe(line.id);
    await openMenuOf(user, "Line: Line");
    await choose(user, /^Bring to front/);
    expect(paintOrder().at(-1)).toBe(line.id);
    await openMenuOf(user, "Line: Line");
    await choose(user, /^Send backward/);
    expect(paintOrder().at(-2)).toBe(line.id);

    await openMenuOf(user, "Image: Image");
    await choose(user, "Hide");
    expect(live(photo).hidden).toBe(true);
    await openMenuOf(user, "Image: Image");
    await choose(user, "Show");
    expect(live(photo).hidden).toBe(false);

    await openMenuOf(user, "Shape: Square");
    await choose(user, "Lock");
    expect(live(square).locked).toBe(true);
    // a locked layer cannot be deleted from here
    await openMenuOf(user, "Shape: Square");
    expect(screen.getByRole("menuitem", { name: /^Delete/ }).getAttribute("aria-disabled")).toBe("true");
    await choose(user, "Unlock");
    expect(live(square).locked).toBe(false);

    await openMenuOf(user, "Text: Hello");
    await choose(user, /^Delete/);
    expect(paintOrder()).not.toContain(text.id);
    expect(rowNames()).not.toContain("Text: Hello");
  });

  it("groups the selected layers from the menu of one of them", async () => {
    const user = userEvent.setup();
    const { text, square } = scene();
    await user.click(row("Text: Hello"));
    await user.keyboard("{Control>}");
    await user.click(row("Shape: Square"));
    await user.keyboard("{/Control}");
    await openMenuOf(user, "Shape: Square");
    await choose(user, /^Group/);
    const groupId = store().selection[0];
    expect(
      live<GroupElement>(groupId)
        .children.map((c) => c.id)
        .sort(),
    ).toEqual([text.id, square.id].sort());
  });

  it("ungroups a group from the layer menu", async () => {
    const user = userEvent.setup();
    const { group, circle, inner } = scene();
    await openMenuOf(user, "Group: Group (2)");
    await choose(user, /^Ungroup/);
    expect(paintOrder()).not.toContain(group.id);
    expect(paintOrder()).toEqual(expect.arrayContaining([circle.id, inner.id]));
  });

  it("only offers renaming and ordering for a layer inside a group", async () => {
    const user = userEvent.setup();
    const { group, circle, inner } = scene();
    await user.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    await openMenuOf(user, "Shape: Circle");
    expect(items()).toEqual(["Rename", "Bring to front", "Bring forward", "Send backward", "Send to back", "Hide", "Lock", "Delete"]);
    // the circle is the first child: it cannot go further back
    expect(screen.getByRole("menuitem", { name: /^Send to back/ }).getAttribute("aria-disabled")).toBe("true");
    await choose(user, /^Bring to front/);
    expect(live<GroupElement>(group).children.map((c) => c.id)).toEqual([inner.id, circle.id]);
    await openMenuOf(user, "Text: Inner");
    await choose(user, "Rename");
    expect(screen.getByRole("textbox", { name: "Layer name" })).toBeTruthy();
  });

  it("starts a rename from the menu", async () => {
    const user = userEvent.setup();
    scene();
    await openMenuOf(user, "Text: Hello");
    await choose(user, "Rename");
    expect(screen.getByRole("textbox", { name: "Layer name" })).toBeTruthy();
  });
});

describe("Layers tab: more cases", () => {
  it("is empty before a design is open", () => {
    showPanel({ kind: "position", tab: "layers" });
    expect(screen.getByText("No layers yet")).toBeTruthy();
  });

  it("finds the neighbours of a layer in a group inside another group", async () => {
    const user = userEvent.setup();
    const [a1, b1, c1, c2] = [createShape("rect"), createShape("rect"), createShape("ellipse", { name: "Low circle" }), createShape("ellipse", { name: "High circle" })];
    const inner = createGroup([c1, c2], { x: 0, y: 0, width: 50, height: 50 });
    const groupA = createGroup([a1], { x: 0, y: 0, width: 50, height: 50 });
    const groupB = createGroup([b1, inner], { x: 100, y: 0, width: 100, height: 100 });
    openElements([groupA, groupB]);
    showPanel({ kind: "position", tab: "layers" });
    await user.click(screen.getByRole("button", { name: "Expand Group (1)" }));
    await user.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    await user.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    // c2 is on top inside the inner group, c1 below it
    await openMenuOf(user, "Shape: High circle");
    const disabled = screen.getAllByRole("menuitem").filter((i) => i.getAttribute("aria-disabled") === "true");
    expect(disabled.map((i) => (i.textContent ?? "").replace(/Ctrl.*$/, ""))).toEqual(["Bring to front", "Bring forward"]);
  });

  it("drops above a row when the drag never reported where over the row it was", () => {
    const { text, line } = scene();
    const data = fakeDataTransfer();
    dragEvent("dragStart", (row("Text: Hello").closest("li") as HTMLElement).querySelector(".cf-layer__grip") as HTMLElement, data);
    dragEvent("drop", row("Line: Line").closest("li") as HTMLElement, data, 600);
    expect(paintOrder().at(-1)).toBe(text.id);
    expect(paintOrder().at(-2)).toBe(line.id);
  });

  it("commits a rename once even when Enter and the loss of focus arrive together", () => {
    const { text } = scene();
    fireEvent.doubleClick(row("Text: Hello"));
    const input = screen.getByRole("textbox", { name: "Layer name" }) as HTMLInputElement;
    input.value = "Once";
    const before = store().past.length;
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
    });
    expect(live(text).name).toBe("Once");
    expect(store().past.length).toBe(before + 1);
  });

  it("keeps renaming when the field itself is clicked", async () => {
    const user = userEvent.setup();
    scene();
    await user.dblClick(row("Text: Hello"));
    const input = screen.getByRole("textbox", { name: "Layer name" });
    await user.click(input);
    expect(screen.getByRole("textbox", { name: "Layer name" })).toBe(input);
    expect(document.activeElement).toBe(input);
  });
});

describe("Layers tab: drag to reorder", () => {
  const grip = (name: string) => (row(name).closest("li") as HTMLElement).querySelector(".cf-layer__grip") as HTMLElement;
  const li = (name: string) => row(name).closest("li") as HTMLElement;

  it("drops a layer above another one", () => {
    const { text, line } = scene();
    // the top half of the line's row: the layer goes above it, to the top of the stack
    dragOnto(grip("Text: Hello"), li("Line: Line"), 10);
    expect(paintOrder().at(-1)).toBe(text.id);
    expect(paintOrder().at(-2)).toBe(line.id);
  });

  it("drops a layer below another one", () => {
    const { text, line } = scene();
    dragOnto(grip("Text: Hello"), li("Line: Line"), 600);
    expect(paintOrder().at(-1)).toBe(line.id);
    expect(paintOrder().at(-2)).toBe(text.id);
  });

  it("shows where the layer will land and clears the marks when the drag ends or leaves", () => {
    scene();
    const data = fakeDataTransfer();
    dragEvent("dragStart", grip("Text: Hello"), data);
    expect(data.data["text/plain"]).toBeTruthy();
    expect(data.effectAllowed).toBe("move");
    expect(li("Text: Hello").classList.contains("is-dragging")).toBe(true);
    dragEvent("dragOver", li("Image: Image"), data, 10);
    expect(li("Image: Image").classList.contains("drop-above")).toBe(true);
    dragEvent("dragOver", li("Image: Image"), data, 600);
    expect(li("Image: Image").classList.contains("drop-below")).toBe(true);
    // moving onto the row's own children is not leaving it; really leaving clears the mark
    dragEvent("dragLeave", li("Image: Image"), data, 0, li("Image: Image").firstElementChild);
    expect(li("Image: Image").classList.contains("drop-below")).toBe(true);
    dragEvent("dragLeave", li("Image: Image"), data, 0, document.body);
    expect(li("Image: Image").classList.contains("drop-below")).toBe(false);
    dragEvent("dragEnd", grip("Text: Hello"), data);
    expect(li("Text: Hello").classList.contains("is-dragging")).toBe(false);
  });

  it("does nothing when a layer is dropped where it already is, on itself, or on a layer of another group", async () => {
    const user = userEvent.setup();
    scene();
    const before = paintOrder();
    const history = store().past.length;
    // right below the row that is already below it: same place
    dragOnto(grip("Shape: Square"), li("Text: Hello"), 10);
    // on itself
    dragOnto(grip("Shape: Square"), li("Shape: Square"), 10);
    expect(paintOrder()).toEqual(before);
    expect(store().past.length).toBe(history);
    // a layer of the page cannot be dropped between the layers of a group
    await user.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    dragOnto(grip("Shape: Square"), li("Shape: Circle"), 10);
    expect(paintOrder()).toEqual(before);
    // a drop without a drag in progress is ignored too
    dragEvent("drop", li("Line: Line"), fakeDataTransfer(), 10);
    dragEvent("dragOver", li("Line: Line"), fakeDataTransfer(), 10);
    expect(li("Line: Line").classList.contains("drop-above")).toBe(false);
  });

  it("reorders layers inside a group among themselves", async () => {
    const user = userEvent.setup();
    const { group, circle, inner } = scene();
    await user.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    // "Circle" is listed below "Inner" (the child painted first); drop it on the upper half of "Inner"
    dragOnto(grip("Shape: Circle"), li("Text: Inner"), 10);
    expect(live<GroupElement>(group).children.map((c) => c.id)).toEqual([inner.id, circle.id]);
  });
});

describe("Layers tab: thumbnails", () => {
  it("paints each layer's thumbnail and repaints it only when the layer looks different", async () => {
    const square = createShape("rect", { x: 100, y: 100, width: 100, height: 100 });
    const text = createText({ text: "Aa", color: "#101010", x: 0, y: 0 });
    const gradientText = createText({
      text: "G",
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#ffffff" },
          { offset: 1, color: "#000000" },
        ],
      },
    });
    const line = createLine();
    const icon = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>' });
    openElements([square, text, gradientText, line, icon]);
    showPanel({ kind: "position", tab: "layers" });

    const thumbs = Array.from(document.querySelectorAll<HTMLElement>(".cf-layer__thumb"));
    expect(thumbs.filter((t) => t.textContent === "Aa")).toHaveLength(2);
    // a light gradient start colour gets dark ink and vice versa
    const thumbOf = (name: string) => screen.getByRole("button", { name }).querySelector(".cf-layer__thumb") as HTMLElement;
    expect(thumbOf("Text: G").getAttribute("data-on")).toBe("dark");
    expect(thumbOf("Text: Aa").getAttribute("data-on")).toBe("light");

    const canvasOf = (name: string) => screen.getByRole("button", { name }).querySelector("canvas") as HTMLCanvasElement;
    const paints = () => contextOf(canvasOf("Shape: Square"))?.calls.length ?? 0;
    await waitFor(() => expect(paints()).toBeGreaterThan(0));
    expect(canvasOf("Graphic: Graphic")).toBeTruthy();

    // dragging the element on the canvas must not repaint its thumbnail
    const settled = paints();
    act(() => store().actions.updateElements([square.id], { x: 400, y: 300 }));
    await new Promise((r) => setTimeout(r, 80));
    expect(paints()).toBe(settled);
    // a new colour does
    act(() => store().actions.updateElements([square.id], { fill: { type: "solid", color: "#ff0000" } } as never));
    await waitFor(() => expect(paints()).toBeGreaterThan(settled));
  });
});

describe("Layer thumbnail", () => {
  it("shows an element with a blend mode as it is on its own: painted straight, with no layer to mix it on", async () => {
    const spies = captureContexts();
    const blended = createShape("rect", { width: 100, height: 100, blend: "multiply" });
    render(<LayerThumb el={blended} />);
    await waitFor(() => expect(spies[0]?.to("fill").length ?? 0).toBeGreaterThan(0));
    expect(spies).toHaveLength(1);
    expect(spies[0].to("drawImage")).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("repaints when the element it shows becomes another kind of element", async () => {
    const shape = createShape("rect", { width: 100, height: 100 });
    const photo = createImage({ src: "https://example.test/p.jpg", width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 });
    const { container, rerender } = render(<LayerThumb el={shape} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    await waitFor(() => expect(contextOf(canvas)?.calls.length ?? 0).toBeGreaterThan(0));
    const seen = contextOf(canvas)!.calls.length;
    rerender(<LayerThumb el={photo} />);
    await waitFor(() => expect(contextOf(canvas)!.calls.length).toBeGreaterThan(seen));
  });
});

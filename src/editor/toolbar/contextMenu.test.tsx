import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createGroup, createImage, createPage, createShape, createText } from "@/core/factory";
import { screenToDesign, useView } from "@/editor/canvas/viewStore";
import type { DesignElement, ImageElement, ShapeElement } from "@/core/types";
import { live, mountEditorOn, paintOrder, store } from "@/test/ctxUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const square = () => createShape("rect", { x: 100, y: 100, width: 200, height: 200 });
const photo = () => createImage({ src: "https://example.test/p.jpg", x: 400, y: 100, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300 });
const workspace = () => document.querySelector("[data-cf-workspace]") as HTMLElement;
const menu = () => screen.getByRole("menu", { name: "Context menu" });
const item = (name: string | RegExp) => within(menu()).getByRole("menuitem", { name });
const rightClick = (x = 300, y = 200) => fireEvent.contextMenu(workspace(), { clientX: x, clientY: y });

async function open(elements: DesignElement[] = [square(), photo()]) {
  const design = createDesign({ title: "ctx menu", width: 1000, height: 600, pages: [createPage({ elements })] });
  await mountEditorOn(design);
  return design.pages[0].elements;
}

describe("the right-click menu", () => {
  it("offers page actions on an empty page and adds a page", async () => {
    const user = userEvent.setup();
    await open();
    rightClick();
    expect(
      within(menu())
        .getAllByRole("menuitem")
        .map((i) => i.textContent?.replace(/Ctrl\+.$/, "")),
    ).toEqual(["Paste", "Select all", "Add page", "Page background"]);
    expect(item(/^Paste/).getAttribute("aria-disabled")).toBe("true");
    await user.click(item("Add page"));
    expect(store().design!.pages).toHaveLength(2);
    expect(screen.queryByRole("menu", { name: "Context menu" })).toBeNull();
  });

  it("selects everything and opens the page background", async () => {
    const user = userEvent.setup();
    const [a, b] = await open();
    rightClick();
    await user.click(item(/^Select all/));
    expect(store().selection).toEqual([a.id, b.id]);
    act(() => store().actions.clearSelection());
    rightClick();
    await user.click(item("Page background"));
    expect(store().context).toEqual({ kind: "background" });
  });

  it("does not offer 'Select all' when every element is hidden", async () => {
    const el = square();
    el.hidden = true;
    await open([el]);
    rightClick();
    expect(item(/^Select all/).getAttribute("aria-disabled")).toBe("true");
  });

  it("copies the selection, also to the system clipboard through a copy event", async () => {
    const user = userEvent.setup();
    const [a] = await open();
    const exec = vi.spyOn(document, "execCommand");
    act(() => store().actions.select([a.id]));
    rightClick();
    await user.click(item(/^Copy$|^Copy\s*Ctrl/));
    expect(store().clipboard?.elements).toHaveLength(1);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("copies even when the browser refuses the copy command", async () => {
    const user = userEvent.setup();
    const [a] = await open();
    vi.spyOn(document, "execCommand").mockImplementation(() => {
      throw new Error("not allowed");
    });
    act(() => store().actions.select([a.id]));
    rightClick();
    await user.click(item(/^Copy\s*Ctrl\+C/));
    expect(store().clipboard?.elements).toHaveLength(1);
  });

  it("pastes where the pointer is when the page was clicked", async () => {
    const user = userEvent.setup();
    const [a] = await open();
    act(() => {
      store().actions.select([a.id]);
      store().actions.copy();
      store().actions.clearSelection();
    });
    rightClick(420, 310);
    await user.click(item(/^Paste/));
    const pasted = store().design!.pages[0].elements.at(-1)!;
    const target = screenToDesign(useView.getState(), 420, 310);
    expect(pasted.id).not.toBe(a.id);
    expect(pasted.x + pasted.width / 2).toBeCloseTo(target.x, 0);
    expect(pasted.y + pasted.height / 2).toBeCloseTo(target.y, 0);
  });

  it("builds the element menu for the selection and runs its actions", async () => {
    const user = userEvent.setup();
    const [a, b] = await open();
    act(() => store().actions.select([a.id]));
    rightClick();
    const labels = within(menu())
      .getAllByRole("menuitem")
      .map((i) => i.textContent ?? "");
    expect(labels.some((l) => l.startsWith("Duplicate"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Alternative text"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Replace image"))).toBe(false);
    await user.click(item(/^Duplicate/));
    expect(paintOrder()).toHaveLength(3);

    act(() => store().actions.select([b.id]));
    rightClick();
    expect(item(/^Replace image/)).toBeTruthy();
    await user.click(item(/^Hide/));
    expect(live(b).hidden).toBe(true);
  });

  it("changes the stacking order and aligns to the page from the sub-menus", async () => {
    const user = userEvent.setup();
    const [a, b] = await open();
    act(() => store().actions.select([a.id]));
    rightClick();
    await user.click(item("Layer"));
    await user.click(within(screen.getAllByRole("menu").at(-1)!).getByRole("menuitem", { name: /^Bring to front/ }));
    expect(paintOrder()).toEqual([b.id, a.id]);

    rightClick();
    await user.click(item("Align to page"));
    await user.click(within(screen.getAllByRole("menu").at(-1)!).getByRole("menuitem", { name: "Center" }));
    expect(live<ShapeElement>(a).x).toBe(400);
  });

  it("locks, unlocks and deletes from the menu", async () => {
    const user = userEvent.setup();
    const [a] = await open();
    act(() => store().actions.select([a.id]));
    rightClick();
    await user.click(item(/^Lock/));
    expect(live(a).locked).toBe(true);
    rightClick();
    expect(item(/^Delete/).getAttribute("aria-disabled")).toBe("true");
    await user.click(item(/^Unlock/));
    rightClick();
    await user.click(item(/^Delete/));
    expect(paintOrder()).not.toContain(a.id);
  });

  it("groups several elements and ungroups a group", async () => {
    const user = userEvent.setup();
    const [a, b] = await open();
    act(() => store().actions.select([a.id, b.id]));
    rightClick();
    await user.click(item(/^Group/));
    const groupId = store().selection[0];
    expect(live(groupId).type).toBe("group");
    rightClick();
    expect(within(menu()).queryByRole("menuitem", { name: /^Group/ })).toBeNull();
    await user.click(item(/^Ungroup/));
    expect(paintOrder()).toHaveLength(2);
  });

  it("copies and pastes a style between elements", async () => {
    const user = userEvent.setup();
    const [a, b, c] = await open([square(), square(), createText({ text: "T", x: 50, y: 400 })]);
    act(() => store().actions.updateElements([a.id], { fill: { type: "solid", color: "#aa0000" } } as never));
    act(() => store().actions.select([a.id]));
    rightClick();
    await user.click(item(/^Copy style/));
    expect(store().styleClipboard?.__type).toBe("shape");
    act(() => store().actions.select([b.id]));
    rightClick();
    await user.click(item(/^Paste style/));
    expect(live<ShapeElement>(b).fill).toEqual({ type: "solid", color: "#aa0000" });
    // a shape style cannot go on a text
    act(() => store().actions.select([c.id]));
    rightClick();
    expect(item(/^Paste style/).getAttribute("aria-disabled")).toBe("true");
  });

  it("opens the alternative text dialog for the element and saves what you wrote", async () => {
    const user = userEvent.setup();
    const [, b] = await open();
    act(() => store().actions.select([b.id]));
    rightClick();
    await user.click(item(/^Alternative text/));
    const dialog = screen.getByRole("dialog", { name: "Alternative text" });
    const field = within(dialog).getByRole("textbox", { name: "Alternative text" }) as HTMLTextAreaElement;
    expect(field.value).toBe("");
    await user.type(field, "  A lake at dawn  ");
    expect(within(dialog).getByText("18 / 500")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(live<ImageElement>(b).alt).toBe("A lake at dawn");
    expect(screen.queryByRole("dialog", { name: "Alternative text" })).toBeNull();
  });

  it("shows no menu in view mode, without a design, or after the editor is closed", async () => {
    await open();
    act(() => store().actions.setMode("view"));
    rightClick();
    expect(screen.queryByRole("menu", { name: "Context menu" })).toBeNull();
    act(() => store().actions.setMode("edit"));
    act(() => store().actions.closeDesign());
    rightClick();
    expect(screen.queryByRole("menu", { name: "Context menu" })).toBeNull();
  });

  it("leaves a right click on the toolbar and on the text editor to the browser", async () => {
    const [a] = await open();
    act(() => store().actions.select([a.id]));
    const bar = document.querySelector("[data-cf-ui]") as HTMLElement;
    expect(bar).toBeTruthy();
    const proceed = fireEvent.contextMenu(bar, { clientX: 5, clientY: 5 });
    expect(proceed).toBe(true);
    expect(screen.queryByRole("menu", { name: "Context menu" })).toBeNull();
  });

  it("pastes copied elements from the element menu, a little offset from the originals", async () => {
    const user = userEvent.setup();
    const [a] = await open();
    act(() => {
      store().actions.select([a.id]);
      store().actions.copy();
    });
    rightClick();
    await user.click(item(/^Paste\s*Ctrl\+V/));
    expect(paintOrder()).toHaveLength(3);
    const pasted = store().design!.pages[0].elements.at(-1)!;
    expect(pasted.x).toBe(a.x + 24);
  });

  it("lets you pick another picture for a selected image", async () => {
    const user = userEvent.setup();
    const [, b] = await open();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    act(() => store().actions.select([b.id]));
    rightClick();
    await user.click(item(/^Replace image/));
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLInputElement).accept).toBe("image/*");
  });

  it("still opens when the workspace cannot be found to place a paste", async () => {
    const user = userEvent.setup();
    await open();
    const host = workspace();
    host.removeAttribute("data-cf-workspace");
    fireEvent.contextMenu(host, { clientX: 300, clientY: 200 });
    expect(menu()).toBeTruthy();
    await user.click(item("Add page"));
    expect(store().design!.pages).toHaveLength(2);
  });

  it("closes the menu with Escape", async () => {
    const user = userEvent.setup();
    await open();
    rightClick();
    expect(menu()).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Context menu" })).toBeNull());
  });
});

describe("the group menu", () => {
  it("offers Ungroup but not Group for a single group", async () => {
    const group = createGroup([createShape("rect", { width: 10, height: 10 })], { x: 100, y: 100, width: 50, height: 50 });
    await open([group]);
    act(() => store().actions.select([group.id]));
    rightClick();
    expect(within(menu()).queryByRole("menuitem", { name: /^Group/ })).toBeNull();
    expect(item(/^Ungroup/)).toBeTruthy();
  });
});

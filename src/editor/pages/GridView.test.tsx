import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import { activeIndex, chromeDesign, clearToasts, fakeDataTransfer, fireDrag, pageIds, pageNames, renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { GridView } from "./GridView";

const actions = () => useEditor.getState().actions;

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(1000, 700);
});

afterEach(async () => {
  restoreLayout();
  resetEditor();
  await clearToasts();
});

/** The grid is only shown while `gridView` is on; the editor turns it on and off. */
const mount = async (design = chromeDesign("Grid design")) => {
  const view = await renderChrome(<GridView />, design);
  act(() => useEditor.setState({ gridView: true }));
  return view;
};
const cell = (id: string) => document.querySelector<HTMLElement>(`[data-page-id="${id}"]`)!;
const thumbOf = (id: string) => cell(id).querySelector<HTMLElement>(".cf-gridcell__thumb")!;
const toolbar = () => screen.getByRole("toolbar", { name: "Page actions" });
const list = () => screen.getByRole("list", { name: "All pages" });
const cellOptions = (id: string) => within(cell(id)).getByRole("button", { name: /^Page \d+ options$/ });
const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;
const addTile = () => document.querySelector<HTMLElement>(".cf-gridcell--add")!;

describe("<GridView>: showing the pages", () => {
  it("shows every page as a large thumbnail with its number and title", async () => {
    const { design } = await mount();
    expect(within(list()).getAllByRole("button", { name: /^Page \d of 3/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Page 1 of 3, Intro. Double-click to edit." }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Page 2 of 3. Double-click to edit." }).getAttribute("aria-current")).toBeNull();
    expect(cell(design.pages[0].id).textContent).toContain("Intro");
    expect(cell(design.pages[2].id).textContent).toContain("Wrap up");
    expect(cell(design.pages[1].id).querySelector(".cf-pagecap__num")?.textContent).toBe("2");
    await waitFor(() => expect(document.querySelectorAll(".cf-gridcell__canvas canvas")).toHaveLength(3));
  });

  it("lays the pages out in as many columns as fit", async () => {
    await mount();
    // 1000 px wide area, 32 px padding, 24 px gaps, about 208 px per page: four columns of 216 px
    expect(list().style.gridTemplateColumns).toBe("repeat(4, 216px)");
  });

  it("uses fewer, wider columns in a narrow area", async () => {
    restoreLayout();
    restoreLayout = stubLayout(420, 700);
    await mount();
    expect(list().style.gridTemplateColumns).toBe("repeat(1, 356px)");
  });

  it("keeps the thumbnails of a tall design below the height limit", async () => {
    restoreLayout();
    restoreLayout = stubLayout(420, 700);
    await mount(createDesign({ title: "Tall", width: 400, height: 1200, pages: [createPage(), createPage()] }));
    // never wider than 320 px tall allows (320 * 400 / 1200)
    expect(list().style.gridTemplateColumns).toBe("repeat(1, 107px)");
  });

  it("follows the size of the area it is in", async () => {
    let observe: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
          observe = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    await mount();
    expect(list().style.gridTemplateColumns).toBe("repeat(4, 216px)");
    act(() => observe?.([{ contentRect: { width: 100 } }]));
    expect(list().style.gridTemplateColumns).toBe("repeat(1, 120px)");
    act(() => observe?.([{ contentRect: { width: 1500 } }]));
    expect(list().style.gridTemplateColumns).toBe("repeat(6, 219px)");
    vi.unstubAllGlobals();
  });

  it("selects a page on a click and opens it on a double click, which leaves the grid", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(thumbOf(design.pages[1].id));
    expect(useEditor.getState().activePageId).toBe(design.pages[1].id);
    expect(useEditor.getState().gridView).toBe(true);
    fireEvent.doubleClick(thumbOf(design.pages[2].id));
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    expect(useEditor.getState().gridView).toBe(false);
  });

  it("keeps the open page in view", async () => {
    const { design } = await mount();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    act(() => actions().setActivePage(design.pages[2].id));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts.at(-1)).toBe(cell(design.pages[2].id));
  });

  it("renders nothing without a design", () => {
    const { container } = render(<GridView />);
    expect(container.firstChild).toBeNull();
  });
});

describe("<GridView>: the toolbar", () => {
  it("adds a page after the open one", async () => {
    const { design } = await mount();
    await userEvent.setup({ delay: null }).click(within(toolbar()).getByRole("button", { name: "Add page" }));
    expect(pageIds()).toHaveLength(4);
    expect(pageIds()[0]).toBe(design.pages[0].id);
    expect(activeIndex()).toBe(1);
  });

  it("duplicates the open page", async () => {
    await mount();
    await userEvent.setup({ delay: null }).click(within(toolbar()).getByRole("button", { name: "Duplicate page" }));
    expect(pageIds()).toHaveLength(4);
    expect(pageNames().slice(0, 2)).toEqual(["Intro", "Intro"]);
  });

  it("deletes the open page and brings it back on Undo", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(within(toolbar()).getByRole("button", { name: "Delete page" }));
    expect(pageIds()).toEqual([design.pages[1].id, design.pages[2].id]);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
  });

  it("cannot delete the only page", async () => {
    await mount(createDesign({ title: "Single", width: 800, height: 600, pages: [createPage()] }));
    expect(isDisabled(within(toolbar()).getByRole("button", { name: "Delete page" }))).toBe(true);
  });

  it("opens the menu of the open page from the More button and closes it again", async () => {
    const { design } = await mount();
    act(() => actions().setActivePage(design.pages[1].id));
    const user = userEvent.setup({ delay: null });
    const more = within(toolbar()).getByRole("button", { name: "More page options" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await user.click(menuItem("Duplicate page"));
    expect(pageIds()).toHaveLength(4);
    await user.click(more);
    await user.click(more);
    expect(screen.queryByRole("menu", { name: "Page 2 options" })).toBeNull();
  });

  it("names the menu opened from the More button after the page it is for", async () => {
    const { design } = await mount();
    act(() => actions().setActivePage(design.pages[1].id));
    await userEvent.setup({ delay: null }).click(within(toolbar()).getByRole("button", { name: "More page options" }));
    expect(screen.getByRole("menu", { name: "Page 2 options" })).toBeTruthy();
  });

  it("gives the open page a title from the More menu", async () => {
    const { design } = await mount();
    act(() => actions().setActivePage(design.pages[1].id));
    const user = userEvent.setup({ delay: null });
    await user.click(within(toolbar()).getByRole("button", { name: "More page options" }));
    await user.click(menuItem("Add page title"));
    await user.type(within(cell(design.pages[1].id)).getByRole("textbox", { name: "Page title" }), "Middle{Enter}");
    expect(pageNames()[1]).toBe("Middle");
  });

  it("is disabled for editing, but not for presenting, while the design is only being viewed", async () => {
    await mount();
    act(() => actions().setMode("view"));
    for (const name of ["Add page", "Duplicate page", "Delete page"]) expect(isDisabled(within(toolbar()).getByRole("button", { name }))).toBe(true);
    expect(isDisabled(within(toolbar()).getByRole("button", { name: "More page options" }))).toBe(false);
    await userEvent.setup({ delay: null }).click(within(toolbar()).getByRole("button", { name: "Add page" }));
    expect(pageIds()).toHaveLength(3);
  });
});

describe("<GridView>: the add tile and the menu of a page", () => {
  it("adds a page from the last tile", async () => {
    await mount();
    await userEvent.setup({ delay: null }).click(within(addTile()).getByRole("button", { name: "Add page" }));
    expect(pageIds()).toHaveLength(4);
  });

  it("offers Add page and Duplicate this page on the tile's caret", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const caret = within(addTile()).getByRole("button", { name: "Add page options" });
    await user.click(caret);
    expect(caret.getAttribute("aria-expanded")).toBe("true");
    await user.click(within(screen.getByRole("menu", { name: "Add page options" })).getByRole("menuitem", { name: "Duplicate this page" }));
    expect(pageIds()).toHaveLength(4);
    await user.click(caret);
    await user.click(within(screen.getByRole("menu", { name: "Add page options" })).getByRole("menuitem", { name: "Add page" }));
    expect(pageIds()).toHaveLength(5);
    await user.click(caret);
    await user.click(caret);
    expect(screen.queryByRole("menu", { name: "Add page options" })).toBeNull();
  });

  it("disables the tile while the design is only being viewed", async () => {
    await mount();
    act(() => actions().setMode("view"));
    expect(isDisabled(within(addTile()).getByRole("button", { name: "Add page" }))).toBe(true);
    expect(isDisabled(within(addTile()).getByRole("button", { name: "Add page options" }))).toBe(true);
  });

  it("gives each page's options button a name of its own, and the menu it opens the same one", async () => {
    const { design } = await mount();
    const buttons = screen.getAllByRole("button", { name: /^Page \d+ options$/ });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Page 1 options", "Page 2 options", "Page 3 options"]);
    expect(within(cell(design.pages[1].id)).getByRole("button", { name: "Page 2 options" })).toBe(buttons[1]);
    await userEvent.setup({ delay: null }).click(buttons[1]);
    expect(screen.getByRole("menu", { name: "Page 2 options" })).toBeTruthy();
  });

  it("opens the menu of a page where it was right-clicked and selects it", async () => {
    const { design } = await mount();
    fireEvent.contextMenu(thumbOf(design.pages[2].id), { clientX: 30, clientY: 30 });
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    expect(screen.getByRole("menu", { name: "Page 3 options" })).toBeTruthy();
    expect(menuItem("Edit page title")).toBeTruthy();
    expect(isDisabled(menuItem("Move right"))).toBe(true);
  });

  it("moves, presents from and titles a page through its own menu", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(b));
    await user.click(menuItem("Move left"));
    expect(pageIds()).toEqual([b, a, c]);

    await user.click(cellOptions(c));
    await user.click(menuItem("Present from this page"));
    expect(useEditor.getState().presenting).toBe(true);
    expect(useEditor.getState().activePageId).toBe(c);

    await user.click(cellOptions(b));
    await user.click(menuItem("Add page title"));
    const input = within(cell(b)).getByRole("textbox", { name: "Page title" });
    await user.type(input, "Second{Enter}");
    expect(pageNames()[0]).toBe("Second");
    expect(within(cell(b)).queryByRole("textbox")).toBeNull();
  });

  it("stops editing a title when the design turns into a view-only one", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[1].id));
    await user.click(menuItem("Add page title"));
    expect(within(cell(design.pages[1].id)).getByRole("textbox", { name: "Page title" })).toBeTruthy();
    act(() => actions().setMode("view"));
    expect(within(cell(design.pages[1].id)).queryByRole("textbox")).toBeNull();
  });
});

describe("<GridView>: keyboard", () => {
  it("moves the selection with the arrow keys, by row with Up and Down", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    fireEvent.keyDown(thumbOf(a), { key: "ArrowRight" });
    expect(useEditor.getState().activePageId).toBe(b);
    await waitFor(() => expect(document.activeElement).toBe(thumbOf(b)));
    fireEvent.keyDown(thumbOf(b), { key: "ArrowLeft" });
    expect(useEditor.getState().activePageId).toBe(a);
    // four columns: one row down is beyond the last page, which is where it stops
    fireEvent.keyDown(thumbOf(a), { key: "ArrowDown" });
    expect(useEditor.getState().activePageId).toBe(c);
    fireEvent.keyDown(thumbOf(c), { key: "ArrowUp" });
    expect(useEditor.getState().activePageId).toBe(a);
  });

  it("stays where it is at either end", async () => {
    const { design } = await mount();
    fireEvent.keyDown(thumbOf(design.pages[0].id), { key: "ArrowLeft" });
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
    act(() => actions().setActivePage(design.pages[2].id));
    fireEvent.keyDown(thumbOf(design.pages[2].id), { key: "ArrowRight" });
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
  });

  it("jumps to the first and last page with Home and End", async () => {
    const { design } = await mount();
    fireEvent.keyDown(thumbOf(design.pages[0].id), { key: "End" });
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    fireEvent.keyDown(thumbOf(design.pages[2].id), { key: "Home" });
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("opens the page with Enter", async () => {
    const { design } = await mount();
    fireEvent.keyDown(thumbOf(design.pages[1].id), { key: "Enter" });
    expect(useEditor.getState().activePageId).toBe(design.pages[1].id);
    expect(useEditor.getState().gridView).toBe(false);
  });

  it("deletes the page with Delete or Backspace without deleting elements as well", async () => {
    const { design } = await mount();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(thumbOf(design.pages[0].id), { key: "Delete" });
    expect(pageIds()).toEqual([design.pages[1].id, design.pages[2].id]);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(thumbOf(design.pages[2].id), { key: "Backspace" });
    expect(pageIds()).toEqual([design.pages[1].id]);
    document.removeEventListener("keydown", outer);
  });

  it("ignores other keys, keys in the title field and keys from outside the grid", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    fireEvent.keyDown(thumbOf(design.pages[0].id), { key: "x" });
    await user.click(cellOptions(design.pages[0].id));
    fireEvent.keyDown(menuItem("Duplicate page"), { key: "Delete" });
    await user.click(menuItem("Edit page title"));
    const input = within(cell(design.pages[0].id)).getByRole("textbox", { name: "Page title" });
    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(pageIds()).toHaveLength(3);
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("ignores keys pressed on the add tile, which belongs to no page", async () => {
    const { design } = await mount();
    const add = within(addTile()).getByRole("button", { name: "Add page" });
    add.focus();
    fireEvent.keyDown(add, { key: "Delete" });
    fireEvent.keyDown(add, { key: "Enter" });
    fireEvent.keyDown(add, { key: "ArrowRight" });
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
    expect(useEditor.getState().gridView).toBe(true);
  });

  it("leaves the grid on Escape", async () => {
    await mount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useEditor.getState().gridView).toBe(false);
  });

  it("leaves Escape to a dialog or popover that is open on top of the grid", async () => {
    await mount();
    act(() => actions().openDialog("shortcuts"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useEditor.getState().gridView).toBe(true);
    act(() => actions().closeDialog());
    const consume = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", consume);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", consume);
    expect(useEditor.getState().gridView).toBe(true);
  });

  it("does not turn the grid on when Escape is pressed while it is off", async () => {
    await mount();
    act(() => useEditor.setState({ gridView: false }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useEditor.getState().gridView).toBe(false);
  });

  it("ignores other keys on the window", async () => {
    await mount();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(useEditor.getState().gridView).toBe(true);
  });
});

describe("<GridView>: dragging pages", () => {
  it("moves a page to where it was dropped, with the landing place marked", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    const dt = fakeDataTransfer();
    fireDrag(cell(a), "dragStart", dt);
    expect(cell(a).classList.contains("is-dragging")).toBe(true);
    fireDrag(cell(c), "dragOver", dt, 100);
    expect(cell(c).classList.contains("is-drop-before")).toBe(true);
    fireDrag(cell(c), "dragOver", dt, 900);
    expect(cell(c).classList.contains("is-drop-after")).toBe(true);
    fireDrag(cell(c), "drop", dt);
    expect(pageIds()).toEqual([b, c, a]);
  });

  it("moves a page to the end when it is dropped on the add tile", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    const dt = fakeDataTransfer();
    fireDrag(cell(a), "dragStart", dt);
    fireDrag(addTile(), "dragOver", dt);
    fireDrag(addTile(), "drop", dt);
    expect(pageIds()).toEqual([b, c, a]);
  });

  it("cannot drag while the design is only being viewed", async () => {
    const { design } = await mount();
    act(() => actions().setMode("view"));
    expect(cell(design.pages[0].id).draggable).toBe(false);
  });
});

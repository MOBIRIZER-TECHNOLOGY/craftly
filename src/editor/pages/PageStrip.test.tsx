import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import { useGesture } from "@/editor/canvas/gestureStore";
import * as renderPage from "@/render/renderPage";
import { activeIndex, chromeDesign, clearToasts, fakeDataTransfer, fireDrag, pageIds, pageNames, renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { PageStrip, thumbWidth } from "./PageStrip";

const actions = () => useEditor.getState().actions;

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(1000, 200);
});

afterEach(async () => {
  restoreLayout();
  resetEditor();
  await clearToasts();
});

const mount = (title = "Strip design", prepare?: (d: ReturnType<typeof chromeDesign>) => void) => {
  const design = chromeDesign(title);
  prepare?.(design);
  return renderChrome(<PageStrip />, design);
};
const cell = (id: string) => document.querySelector<HTMLElement>(`[data-page-id="${id}"]`)!;
const thumb = (name: string | RegExp) => screen.getByRole("button", { name });
/** The thumbnail button of a page, found by id (its label changes when the pages are renumbered). */
const thumbOf = (id: string) => cell(id).querySelector<HTMLElement>(".cf-strip__thumb")!;
const cellOptions = (id: string) => within(cell(id)).getByRole("button", { name: /^Page \d+ options$/ });
const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;

describe("thumbWidth", () => {
  it("fits a landscape page into the strip's box by its height", () => {
    expect(thumbWidth(1920, 1080)).toBe(114);
  });

  it("fits a portrait page by its height too", () => {
    expect(thumbWidth(1080, 1920)).toBe(36);
  });

  it("limits a very wide page by the strip's width", () => {
    expect(thumbWidth(1920, 480)).toBe(168);
  });

  it("never makes a thumbnail narrower than 28 pixels", () => {
    expect(thumbWidth(100, 8000)).toBe(28);
  });
});

describe("<PageStrip>: showing the pages", () => {
  it("has one thumbnail per page, named by number and title, and marks the open one", async () => {
    const { design } = await mount();
    expect(screen.getByRole("region", { name: "Pages" })).toBeTruthy();
    const first = thumb("Page 1 of 3, Intro");
    const second = thumb("Page 2 of 3");
    const third = thumb("Page 3 of 3, Wrap up");
    expect(first.getAttribute("aria-current")).toBe("true");
    expect(second.getAttribute("aria-current")).toBeNull();
    // only the open page is in the tab order
    expect([first.tabIndex, second.tabIndex, third.tabIndex]).toEqual([0, -1, -1]);
    expect(cell(design.pages[0].id).textContent).toContain("Intro");
    expect(cell(design.pages[2].id).textContent).toContain("Wrap up");
  });

  it("leaves the thumbnail as it is while something is dragged on the canvas, and paints it once the drag is over", async () => {
    const { design } = await mount();
    await waitFor(() => expect(document.querySelectorAll(".cf-strip__canvas canvas")).toHaveLength(3));
    // (a thumbnail follows a change at most every 400 ms: let that time pass, so that only the drag can hold it back)
    await new Promise((resolve) => setTimeout(resolve, 450));
    const painted = vi.spyOn(renderPage, "renderPageToCanvas");
    const pageId = design.pages[0].id;
    act(() => useGesture.getState().set({ active: true }));
    let moved = "";
    act(() => void (moved = actions().addElement(createShape("rect", { x: 10, y: 10, width: 50, height: 50 }), { select: false, center: false })));
    await new Promise((resolve) => setTimeout(resolve, 450));
    act(() => actions().updateElements([moved], (el) => void (el.x += 40)));
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(painted).not.toHaveBeenCalled();
    act(() => useGesture.getState().set({ active: false }));
    await waitFor(() => expect(painted).toHaveBeenCalledTimes(1));
    // with the page as it is now
    const shown = painted.mock.calls[0][1];
    expect(shown.id).toBe(pageId);
    expect(shown.elements.find((el) => el.id === moved)?.x).toBe(50);
    painted.mockRestore();
  });

  it("paints a thumbnail for every page", async () => {
    await mount();
    await waitFor(() => expect(document.querySelectorAll(".cf-strip__canvas canvas")).toHaveLength(3));
  });

  it("marks a page that has animation or a transition", async () => {
    await mount("Animated", (d) => {
      d.pages[0].elements.push(createShape("rect", { animation: { in: { kind: "fade", duration: 1, delay: 0 } } }));
      d.pages[2].transition = { kind: "slide", duration: 0.5 };
    });
    expect(thumb("Page 1 of 3, Intro, animated")).toBeTruthy();
    expect(thumb("Page 2 of 3")).toBeTruthy();
    expect(thumb("Page 3 of 3, Wrap up, animated")).toBeTruthy();
    expect(document.querySelectorAll(".cf-strip__anim")).toHaveLength(2);
  });

  it("selects a page when its thumbnail is clicked", async () => {
    const { design } = await mount();
    await userEvent.setup({ delay: null }).click(thumb("Page 3 of 3, Wrap up"));
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    expect(thumb("Page 3 of 3, Wrap up").getAttribute("aria-current")).toBe("true");
  });

  it("keeps the open page in view when the page changes from elsewhere", async () => {
    const { design } = await mount();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    act(() => actions().setActivePage(design.pages[2].id));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(scroll.mock.contexts.at(-1)).toBe(cell(design.pages[2].id));
  });

  it("renders nothing without a design", () => {
    const { container } = renderEmpty();
    expect(container.firstChild).toBeNull();
  });
});

function renderEmpty() {
  return render(<PageStrip />);
}

describe("<PageStrip>: adding pages", () => {
  it("adds a blank page after the open one and opens it", async () => {
    const { design } = await mount();
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Add page" }));
    const ids = pageIds();
    expect(ids).toHaveLength(4);
    expect(ids.slice(0, 1)).toEqual([design.pages[0].id]);
    expect(useEditor.getState().activePageId).toBe(ids[1]);
    expect(thumb("Page 2 of 4").getAttribute("aria-current")).toBe("true");
  });

  it("offers Add page and Duplicate this page next to it", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    const caret = within(document.querySelector<HTMLElement>(".cf-strip__cell--add")!).getByRole("button", { name: "Add page options" });
    expect(caret.getAttribute("aria-expanded")).toBe("false");
    await user.click(caret);
    expect(caret.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Add page options" });
    await user.click(within(menu).getByRole("menuitem", { name: "Duplicate this page" }));
    expect(pageIds()).toHaveLength(4);
    expect(pageNames()[1]).toBe("Intro");
    expect(pageIds()[1]).not.toBe(design.pages[0].id);

    await user.click(caret);
    await user.click(within(screen.getByRole("menu", { name: "Add page options" })).getByRole("menuitem", { name: "Add page" }));
    expect(pageIds()).toHaveLength(5);
  });

  it("closes the add menu with a second click on its caret", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const caret = within(document.querySelector<HTMLElement>(".cf-strip__cell--add")!).getByRole("button", { name: "Add page options" });
    await user.click(caret);
    await user.click(caret);
    expect(screen.queryByRole("menu", { name: "Add page options" })).toBeNull();
  });

  it("cannot add pages while the design is only being viewed", async () => {
    await mount();
    act(() => actions().setMode("view"));
    expect(isDisabled(screen.getByRole("button", { name: "Add page" }))).toBe(true);
    const caret = within(document.querySelector<HTMLElement>(".cf-strip__cell--add")!).getByRole("button", { name: "Add page options" });
    expect(isDisabled(caret)).toBe(true);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Add page" }));
    expect(pageIds()).toHaveLength(3);
  });
});

describe("<PageStrip>: the menu of a page", () => {
  it("lists what can be done with the page", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[1].id));
    const menu = screen.getByRole("menu", { name: "Page 2 options" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Add page title", "Duplicate page", "Present from this page", "Move left", "Move right", "Delete page"]);
  });

  it("gives each page's options button a name of its own, and the menu it opens the same one", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    // one button per page, each told apart by the number of its page (it used to be "Page options" three times)
    const buttons = screen.getAllByRole("button", { name: /^Page \d+ options$/ });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Page 1 options", "Page 2 options", "Page 3 options"]);
    expect(within(cell(design.pages[2].id)).getByRole("button", { name: "Page 3 options" })).toBe(buttons[2]);
    await user.click(buttons[0]);
    expect(screen.getByRole("menu", { name: "Page 1 options" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(buttons[2]);
    expect(screen.getByRole("menu", { name: "Page 3 options" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Page 1 options" })).toBeNull();
  });

  it("renumbers the options buttons when the pages move", async () => {
    const { design } = await mount();
    act(() => actions().movePage(design.pages[2].id, 0));
    expect(within(cell(design.pages[2].id)).getByRole("button", { name: "Page 1 options" })).toBeTruthy();
    expect(within(cell(design.pages[0].id)).getByRole("button", { name: "Page 2 options" })).toBeTruthy();
  });

  it("opens at the pointer on a right click and selects the page", async () => {
    const { design } = await mount();
    fireEvent.contextMenu(thumb("Page 3 of 3, Wrap up"), { clientX: 40, clientY: 30 });
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    expect(screen.getByRole("menu", { name: "Page 3 options" })).toBeTruthy();
    expect(menuItem("Edit page title")).toBeTruthy(); // this page has a title
    expect(isDisabled(menuItem("Move right"))).toBe(true);
    expect(isDisabled(menuItem("Move left"))).toBe(false);
  });

  it("disables moving the first page left and deleting the only page", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[0].id));
    expect(isDisabled(menuItem("Move left"))).toBe(true);
    expect(isDisabled(menuItem("Move right"))).toBe(false);
    await user.keyboard("{Escape}");
    act(() => {
      actions().deletePage(design.pages[2].id);
      actions().deletePage(design.pages[1].id);
    });
    await user.click(cellOptions(design.pages[0].id));
    expect(isDisabled(menuItem("Delete page"))).toBe(true);
  });

  it("duplicates the page", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[0].id));
    await user.click(menuItem("Duplicate page"));
    expect(pageIds()).toHaveLength(4);
    expect(pageNames().slice(0, 2)).toEqual(["Intro", "Intro"]);
    expect(activeIndex()).toBe(1);
  });

  it("moves the page left and right", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(b));
    await user.click(menuItem("Move left"));
    expect(pageIds()).toEqual([b, a, c]);
    await user.click(cellOptions(b));
    await user.click(menuItem("Move right"));
    expect(pageIds()).toEqual([a, b, c]);
  });

  it("starts the show from that page", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[2].id));
    await user.click(menuItem("Present from this page"));
    const s = useEditor.getState();
    expect(s.presenting).toBe(true);
    expect(s.activePageId).toBe(design.pages[2].id);
  });

  it("deletes the page and brings it back on Undo", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[1].id));
    await user.click(menuItem("Delete page"));
    expect(pageIds()).toEqual([design.pages[0].id, design.pages[2].id]);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
  });

  it("gives a page a title in place", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[1].id));
    await user.click(menuItem("Add page title"));
    const input = within(cell(design.pages[1].id)).getByRole("textbox", { name: "Page title" });
    expect(document.activeElement).toBe(input);
    await user.type(input, "Numbers{Enter}");
    expect(pageNames()[1]).toBe("Numbers");
    expect(thumb("Page 2 of 3, Numbers")).toBeTruthy();
    expect(within(cell(design.pages[1].id)).queryByRole("textbox")).toBeNull();
  });

  it("does not offer changes while the design is only being viewed", async () => {
    const { design } = await mount();
    act(() => actions().setMode("view"));
    await userEvent.setup({ delay: null }).click(cellOptions(design.pages[1].id));
    for (const name of ["Add page title", "Duplicate page", "Move left", "Move right", "Delete page"]) expect(isDisabled(menuItem(name))).toBe(true);
    expect(isDisabled(menuItem("Present from this page"))).toBe(false);
  });

  it("closes the title field when the design turns into a view-only one", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[1].id));
    await user.click(menuItem("Add page title"));
    expect(within(cell(design.pages[1].id)).getByRole("textbox", { name: "Page title" })).toBeTruthy();
    act(() => actions().setMode("view"));
    expect(within(cell(design.pages[1].id)).queryByRole("textbox")).toBeNull();
  });
});

describe("<PageStrip>: keyboard", () => {
  it("selects the next and previous page with the arrow keys and moves the focus along", async () => {
    const { design } = await mount();
    const first = thumb("Page 1 of 3, Intro");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(useEditor.getState().activePageId).toBe(design.pages[1].id);
    await waitFor(() => expect(document.activeElement).toBe(thumb("Page 2 of 3")));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
    await waitFor(() => expect(document.activeElement).toBe(thumb("Page 1 of 3, Intro")));
  });

  it("stops at the ends", async () => {
    const { design } = await mount();
    fireEvent.keyDown(thumb("Page 1 of 3, Intro"), { key: "ArrowLeft" });
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
    act(() => actions().setActivePage(design.pages[2].id));
    fireEvent.keyDown(thumb("Page 3 of 3, Wrap up"), { key: "ArrowRight" });
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
  });

  it("jumps to the first and last page with Home and End", async () => {
    const { design } = await mount();
    fireEvent.keyDown(thumb("Page 1 of 3, Intro"), { key: "End" });
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    fireEvent.keyDown(thumb("Page 3 of 3, Wrap up"), { key: "Home" });
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("moves the page itself with Alt and the arrow keys", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    fireEvent.keyDown(thumbOf(a), { key: "ArrowRight", altKey: true });
    expect(pageIds()).toEqual([b, a, c]);
    fireEvent.keyDown(thumbOf(a), { key: "ArrowLeft", altKey: true });
    expect(pageIds()).toEqual([a, b, c]);
    // nothing beyond the ends
    fireEvent.keyDown(thumbOf(a), { key: "ArrowLeft", altKey: true });
    expect(pageIds()).toEqual([a, b, c]);
    fireEvent.keyDown(thumbOf(c), { key: "ArrowRight", altKey: true });
    expect(pageIds()).toEqual([a, b, c]);
  });

  it("does not move pages with Alt while the design is only being viewed, but still selects", async () => {
    const { design } = await mount();
    act(() => actions().setMode("view"));
    fireEvent.keyDown(thumb("Page 1 of 3, Intro"), { key: "ArrowRight", altKey: true });
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
    expect(useEditor.getState().activePageId).toBe(design.pages[1].id);
  });

  it("deletes the page with Delete or Backspace without deleting elements as well", async () => {
    const { design } = await mount();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(thumbOf(design.pages[0].id), { key: "Delete" });
    expect(pageIds()).toEqual([design.pages[1].id, design.pages[2].id]);
    expect(outer).not.toHaveBeenCalled(); // the editor's own Delete never sees it
    fireEvent.keyDown(thumbOf(design.pages[2].id), { key: "Backspace" });
    expect(pageIds()).toEqual([design.pages[1].id]);
    document.removeEventListener("keydown", outer);
  });

  it("ignores other keys and keys pressed in the title field", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    fireEvent.keyDown(thumb("Page 1 of 3, Intro"), { key: "x" });
    expect(pageIds()).toHaveLength(3);
    await user.click(cellOptions(design.pages[0].id));
    await user.click(menuItem("Edit page title"));
    const input = within(cell(design.pages[0].id)).getByRole("textbox", { name: "Page title" });
    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(pageIds()).toHaveLength(3);
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("ignores keys pressed on the add button, which belongs to no page", async () => {
    const { design } = await mount();
    const add = screen.getByRole("button", { name: "Add page" });
    add.focus();
    fireEvent.keyDown(add, { key: "Delete" });
    fireEvent.keyDown(add, { key: "ArrowRight" });
    fireEvent.keyDown(add, { key: "End" });
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("ignores keys that come from outside the strip", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(cellOptions(design.pages[0].id));
    // keys pressed in the portalled menu bubble through React to the strip; they are the menu's business
    fireEvent.keyDown(menuItem("Duplicate page"), { key: "Delete" });
    expect(pageIds()).toHaveLength(3);
  });
});

describe("<PageStrip>: dragging pages", () => {
  it("shows where the page will land and moves it when dropped", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    const dt = fakeDataTransfer();
    expect(cell(a).draggable).toBe(true);
    fireDrag(cell(a), "dragStart", dt);
    expect(cell(a).classList.contains("is-dragging")).toBe(true);
    fireDrag(cell(c), "dragOver", dt, 100);
    expect(cell(c).classList.contains("is-drop-before")).toBe(true);
    fireDrag(cell(c), "dragOver", dt, 900);
    expect(cell(c).classList.contains("is-drop-before")).toBe(false);
    expect(cell(c).classList.contains("is-drop-after")).toBe(true);
    fireDrag(cell(c), "drop", dt);
    expect(pageIds()).toEqual([b, c, a]);
    expect(cell(a).classList.contains("is-dragging")).toBe(false);
  });

  it("moves a page to the end when it is dropped on the add tile", async () => {
    const { design } = await mount();
    const [a, b, c] = design.pages.map((p) => p.id);
    const dt = fakeDataTransfer();
    fireDrag(cell(a), "dragStart", dt);
    const tail = document.querySelector<HTMLElement>(".cf-strip__cell--add")!;
    fireDrag(tail, "dragOver", dt);
    fireDrag(tail, "drop", dt);
    expect(pageIds()).toEqual([b, c, a]);
  });

  it("leaves the order alone when a page is dropped where it was", async () => {
    const { design } = await mount();
    const dt = fakeDataTransfer();
    fireDrag(cell(design.pages[1].id), "dragStart", dt);
    fireDrag(cell(design.pages[1].id), "dragOver", dt, 100);
    fireDrag(cell(design.pages[1].id), "drop", dt);
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
  });

  it("cannot drag pages while the design is only being viewed", async () => {
    const { design } = await mount();
    act(() => actions().setMode("view"));
    expect(cell(design.pages[0].id).draggable).toBe(false);
    const dt = fakeDataTransfer();
    fireDrag(cell(design.pages[0].id), "dragStart", dt);
    expect(cell(design.pages[0].id).classList.contains("is-dragging")).toBe(false);
  });
});

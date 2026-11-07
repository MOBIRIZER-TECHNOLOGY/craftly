import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createGroup, createPage, createText, paragraphsToText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, DesignElement } from "@/core/types";
import { initialMetrics, useView } from "@/editor/canvas/viewStore";
import { clearToasts, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { FindReplaceDialog } from "./FindReplaceDialog";

const actions = () => useEditor.getState().actions;

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  useView.setState({ ...initialMetrics });
  await clearLibrary();
  restoreLayout = stubLayout(1000, 700);
});

afterEach(async () => {
  restoreLayout();
  resetEditor();
  useView.setState({ ...initialMetrics });
  await clearToasts();
});

/**
 * Page 1: "Hello world, hello again" and a box without a match; page 2: "HELLO from page two";
 * page 3: a locked group with "hello locked" (and, when asked, a second one).
 */
function findDesign(twoLocked = false): Design {
  const lockedGroup = (text: string, y: number) => createGroup([createText({ text, x: 10, y: 10, width: 400 })], { locked: true, x: 0, y, width: 500, height: 100 });
  const first = createPage({
    name: "One",
    elements: [createText({ text: "Hello world, hello again", x: 80, y: 60, width: 700 }), createText({ text: "nothing to see", x: 80, y: 300, width: 400 })],
  });
  const second = createPage({ elements: [createText({ text: "HELLO from page two", x: 100, y: 100, width: 600 })] });
  const third = createPage({ elements: [lockedGroup("hello locked", 50), ...(twoLocked ? [lockedGroup("also locked", 300)] : [])] });
  return createDesign({ title: "Find me", width: 1280, height: 720, pages: [first, second, third] });
}

const mount = (design = findDesign(), onClose = vi.fn()) => renderChrome(<FindReplaceDialog open onClose={onClose} />, design);
const find = () => screen.getByRole("searchbox", { name: "Find text" }) as HTMLInputElement;
const replacement = () => screen.getByRole("textbox", { name: "Replacement text" }) as HTMLInputElement;
const counter = () => document.querySelector(".cf-find__count")?.textContent ?? "";
const texts = (design: Design, pageIndex: number): string[] => {
  const out: string[] = [];
  const visit = (els: DesignElement[]) => {
    for (const el of els) {
      if (el.type === "text") out.push(paragraphsToText(el.paragraphs));
      else if (el.type === "group") visit(el.children);
    }
  };
  visit(design.pages[pageIndex].elements);
  return out;
};
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
const selection = () => useEditor.getState().selection;

describe("<FindReplaceDialog>: finding", () => {
  it("opens with the search field ready", async () => {
    await mount();
    expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
    expect(document.activeElement).toBe(find());
    expect(counter()).toBe("");
    expect(isDisabled(screen.getByRole("button", { name: "Next match" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Previous match" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Replace" }))).toBe(true);
    expect(screen.getByRole("button", { name: "Replace all" })).toBeTruthy();
  });

  it("adds no banner landmark of its own: the design toolbar stays the one banner of the page", async () => {
    await mount();
    const dialog = screen.getByRole("dialog", { name: "Find and replace" });
    expect(within(dialog).queryAllByRole("banner")).toHaveLength(0);
    expect(within(dialog).getByRole("heading", { name: "Find and replace" })).toBeTruthy();
  });

  it("counts the matches and selects the first one on the open page", async () => {
    const design = findDesign();
    await mount(design);
    await userEvent.setup({ delay: null }).type(find(), "hello");
    expect(counter()).toBe("1 of 4");
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
    expect(selection()).toEqual([design.pages[0].elements[0].id]);
    expect(screen.getByRole("button", { name: "Replace all (4)" })).toBeTruthy();
  });

  it("starts at the first match on or after the page being edited", async () => {
    const design = findDesign();
    await mount(design);
    act(() => actions().setActivePage(design.pages[1].id));
    await userEvent.setup({ delay: null }).type(find(), "hello");
    expect(counter()).toBe("3 of 4");
    expect(selection()).toEqual([design.pages[1].elements[0].id]);
  });

  it("starts at the first match when there is none after the open page", async () => {
    const design = findDesign();
    await mount(design);
    act(() => actions().setActivePage(design.pages[2].id));
    await userEvent.setup({ delay: null }).type(find(), "world");
    expect(counter()).toBe("1 of 1");
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("steps through the matches with Enter, across pages, and wraps around", async () => {
    const design = findDesign();
    await mount(design);
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.keyboard("{Enter}");
    expect(counter()).toBe("2 of 4");
    expect(selection()).toEqual([design.pages[0].elements[0].id]);
    await user.keyboard("{Enter}");
    expect(counter()).toBe("3 of 4");
    expect(useEditor.getState().activePageId).toBe(design.pages[1].id);
    await user.keyboard("{Enter}");
    expect(counter()).toBe("4 of 4");
    expect(useEditor.getState().activePageId).toBe(design.pages[2].id);
    // the match is inside a group: the group is what gets selected
    expect(selection()).toEqual([design.pages[2].elements[0].id]);
    await user.keyboard("{Enter}");
    expect(counter()).toBe("1 of 4");
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("goes backwards with Shift+Enter and wraps around", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(counter()).toBe("4 of 4");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(counter()).toBe("3 of 4");
  });

  it("steps with the Next and Previous buttons", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.click(screen.getByRole("button", { name: "Next match" }));
    expect(counter()).toBe("2 of 4");
    await user.click(screen.getByRole("button", { name: "Previous match" }));
    await user.click(screen.getByRole("button", { name: "Previous match" }));
    expect(counter()).toBe("4 of 4");
  });

  it("ignores case unless asked to match it", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    expect(counter()).toBe("1 of 4");
    await user.click(screen.getByRole("checkbox", { name: "Match case" }));
    expect(counter()).toBe("1 of 2");
    await user.clear(find());
    await user.type(find(), "HELLO");
    expect(counter()).toBe("1 of 1");
    expect(useEditor.getState().activePageId).toBe(storeDesign().pages[1].id);
  });

  it("says when there is nothing to find", async () => {
    await mount();
    await userEvent.setup({ delay: null }).type(find(), "zzz");
    expect(counter()).toBe("No results");
    expect(isDisabled(screen.getByRole("button", { name: "Next match" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Replace" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Replace all" }))).toBe(true);
  });

  it("ignores Enter when there are no matches", async () => {
    const design = findDesign();
    await mount(design);
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "zzz{Enter}");
    expect(counter()).toBe("No results");
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("clears the counter with the search", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(counter()).toBe("");
    expect(isDisabled(screen.getByRole("button", { name: "Next match" }))).toBe(true);
  });

  it("keeps the selected text selected when Ctrl+F is pressed in the panel", async () => {
    await mount();
    await userEvent.setup({ delay: null }).type(find(), "hello");
    find().setSelectionRange(2, 2);
    expect(fireEvent.keyDown(find(), { key: "f", ctrlKey: true })).toBe(false); // the browser's own find box stays closed
    expect(find().selectionStart).toBe(0);
    expect(find().selectionEnd).toBe(5);
    fireEvent.keyDown(find(), { key: "F", metaKey: true });
    expect(find().selectionEnd).toBe(5);
  });
});

describe("<FindReplaceDialog>: showing the match", () => {
  it("fits the page when the match is off screen at the current zoom", async () => {
    await mount();
    act(() => actions().setZoom(2));
    act(() => useView.getState().set({ scrollLeft: 4000 }));
    await userEvent.setup({ delay: null }).type(find(), "hello");
    expect(useEditor.getState().zoomMode).toBe("fit");
  });

  it("leaves the zoom alone when the match is in view", async () => {
    await mount();
    act(() => actions().setZoom(2));
    await userEvent.setup({ delay: null }).type(find(), "hello");
    expect(useEditor.getState().zoomMode).toBe("custom");
    expect(useEditor.getState().zoom).toBe(2);
  });

  it("moves with the window", async () => {
    await mount();
    const panel = () => screen.getByRole("dialog", { name: "Find and replace" });
    const before = panel().style.left;
    Object.defineProperty(window, "innerWidth", { value: 700, configurable: true, writable: true });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(panel().style.left).not.toBe(before);
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
  });
});

describe("<FindReplaceDialog>: replacing", () => {
  it("replaces the current match and moves to the next one", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.type(replacement(), "Howdy");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(texts(storeDesign(), 0)).toEqual(["Howdy world, hello again", "nothing to see"]);
    expect(counter()).toBe("1 of 3");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(texts(storeDesign(), 0)[0]).toBe("Howdy world, Howdy again");
    expect(counter()).toBe("1 of 2");
    expect(useEditor.getState().activePageId).toBe(storeDesign().pages[1].id);
  });

  it("goes back to the first match when the replaced one was the last", async () => {
    const design = createDesign({
      title: "Two foos",
      width: 800,
      height: 600,
      pages: [
        createPage({ elements: [createText({ text: "foo one", x: 50, y: 50, width: 300 })] }),
        createPage({ elements: [createText({ text: "foo two", x: 50, y: 50, width: 300 })] }),
      ],
    });
    await mount(design);
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "foo");
    await user.click(screen.getByRole("button", { name: "Next match" }));
    expect(counter()).toBe("2 of 2");
    await user.type(replacement(), "bar");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(texts(storeDesign(), 1)).toEqual(["bar two"]);
    expect(counter()).toBe("1 of 1");
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
  });

  it("replaces with the Enter key of the replacement field", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "world");
    await user.type(replacement(), "there{Enter}");
    expect(texts(storeDesign(), 0)[0]).toBe("Hello there, hello again");
    expect(counter()).toBe("No results");
  });

  it("can replace with nothing", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), " again");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(texts(storeDesign(), 0)[0]).toBe("Hello world, hello");
  });

  it("replaces everything in one undo step and returns to the page it started on", async () => {
    const design = findDesign();
    await mount(design);
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.type(replacement(), "Howdy");
    await user.click(screen.getByRole("button", { name: "Replace all (4)" }));
    expect(texts(storeDesign(), 0)).toEqual(["Howdy world, Howdy again", "nothing to see"]);
    expect(texts(storeDesign(), 1)).toEqual(["Howdy from page two"]);
    // the locked text is left alone, and the person is told
    expect(texts(storeDesign(), 2)).toEqual(["hello locked"]);
    expect(await screen.findByText("One match is in a locked element and was left alone.")).toBeTruthy();
    expect(await screen.findByText("Replaced 3 matches")).toBeTruthy();
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);
    expect(counter()).toBe("1 of 1");
    act(() => actions().undo());
    expect(texts(storeDesign(), 0)[0]).toBe("Hello world, hello again");
    expect(texts(storeDesign(), 1)).toEqual(["HELLO from page two"]);
  });

  it("says '1 match' for a single replacement", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "page two");
    await user.type(replacement(), "page 2");
    await user.click(screen.getByRole("button", { name: "Replace all" }));
    expect(await screen.findByText("Replaced 1 match")).toBeTruthy();
    expect(texts(storeDesign(), 1)).toEqual(["HELLO from page 2"]);
  });

  it("changes nothing and explains when every match is locked", async () => {
    await mount(findDesign(true));
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "locked");
    expect(counter()).toBe("1 of 2");
    await user.type(replacement(), "free");
    await user.click(screen.getByRole("button", { name: "Replace all (2)" }));
    expect(await screen.findByText("2 matches are in locked elements and were left alone.")).toBeTruthy();
    expect(screen.queryByText(/^Replaced /)).toBeNull();
    expect(texts(storeDesign(), 2)).toEqual(["hello locked", "also locked"]);
  });

  it("leaves a locked match alone when replacing one at a time", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello locked");
    await user.type(replacement(), "x");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(await screen.findByText("One match is in a locked element and was left alone.")).toBeTruthy();
    expect(texts(storeDesign(), 2)).toEqual(["hello locked"]);
    expect(counter()).toBe("1 of 1");
  });

  it("does nothing with Enter in the replacement field when nothing matches", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "zzz");
    await user.type(replacement(), "x{Enter}");
    expect(texts(storeDesign(), 0)[0]).toBe("Hello world, hello again");
  });
});

describe("<FindReplaceDialog>: while the design is only being viewed", () => {
  it("can still find, but not replace", async () => {
    await mount();
    act(() => actions().setMode("view"));
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    expect(counter()).toBe("1 of 4");
    expect(replacement().disabled).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Replace" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Replace all (4)" }))).toBe(true);
    expect(screen.getByText("Switch to Editing to replace text.")).toBeTruthy();
    fireEvent.keyDown(replacement(), { key: "Enter" });
    expect(texts(storeDesign(), 0)[0]).toBe("Hello world, hello again");
  });
});

describe("<FindReplaceDialog>: closing", () => {
  it("closes from the close button", async () => {
    const onClose = vi.fn();
    await mount(findDesign(), onClose);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the search on the first Escape and closes on the next", async () => {
    const onClose = vi.fn();
    await mount(findDesign(), onClose);
    const user = userEvent.setup({ delay: null });
    await user.type(find(), "hello");
    await user.keyboard("{Escape}");
    expect(find().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when something outside it is clicked, so the match on the page stays visible", async () => {
    const onClose = vi.fn();
    await mount(findDesign(), onClose);
    const outside = document.createElement("button");
    document.body.append(outside);
    await userEvent.setup({ delay: null }).click(outside);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog", { name: "Find and replace" })).getByRole("heading", { name: "Find and replace" })).toBeTruthy();
  });
});

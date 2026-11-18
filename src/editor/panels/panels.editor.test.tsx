import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getActivePage, useEditor } from "@/core/store";
import type { ShapeElement, TextElement } from "@/core/types";
import { TEMPLATES } from "@/data/templates";
import { ConfirmHost, ToastHost } from "@/ui";
import { clearLibrary, mountEditor, resetEditor, sampleDesign, stubLayout } from "@/test/helpers";
import { clearToasts, resetElementsNav } from "@/test/tabsHarness";

/*
 * The panels inside the whole editor (rail, side panel, canvas, top bar and dialogs together), driven the way the browser
 * journeys in e2e/journey.cjs drive them: choose a rail tab, use the panel, look at the document.
 */

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  resetElementsNav();
  clearToasts();
  await clearLibrary();
  restoreLayout = stubLayout(1000, 700);
});
afterEach(() => {
  restoreLayout();
  resetEditor();
});

const state = () => useEditor.getState();
const elements = () => getActivePage(state())?.elements ?? [];

/** The editor as the app mounts it: with the hosts for confirmations and messages beside it. */
async function openEditor() {
  render(
    <>
      <ConfirmHost />
      <ToastHost />
    </>,
  );
  const view = await mountEditor(sampleDesign({ title: "Panels in the editor" }));
  return { user: userEvent.setup(), view };
}

/** Clicks a rail tab unless it is the open one (clicking the open tab folds the panel away, as in Canva). */
async function tab(user: ReturnType<typeof userEvent.setup>, name: string) {
  const button = screen.getByRole("tab", { name });
  if (button.getAttribute("aria-selected") !== "true") await user.click(button);
}

describe("the rail and its panels inside the editor", () => {
  it("puts a shape from Elements on the page and selects it", async () => {
    const { user } = await openEditor();
    await tab(user, "Elements");
    await user.click(await screen.findByRole("button", { name: "Browse shapes" }));
    const before = elements().length;
    await user.click(await screen.findByRole("button", { name: "Circle" }));
    expect(elements()).toHaveLength(before + 1);
    const added = elements()[elements().length - 1] as ShapeElement;
    expect(added.shape).toBe("ellipse");
    expect(state().selection).toEqual([added.id]);
  });

  describe("Delete and Backspace right after an insert, with the keyboard still on the panel", () => {
    async function insertCircle() {
      const opened = await openEditor();
      await tab(opened.user, "Elements");
      await opened.user.click(await screen.findByRole("button", { name: "Browse shapes" }));
      const before = elements().length;
      const circle = await screen.findByRole("button", { name: "Circle" });
      await opened.user.click(circle);
      expect(elements()).toHaveLength(before + 1);
      const added = state().selection[0];
      return { ...opened, circle, before, added };
    }

    it.each(["Delete", "Backspace"])("%s removes the element just put on the page", async (key) => {
      const { user, circle, before, added } = await insertCircle();
      expect(document.activeElement).toBe(circle);
      await user.keyboard(`{${key}}`);
      expect(elements()).toHaveLength(before);
      expect(elements().map((e) => e.id)).not.toContain(added);
    });

    it("works the same after an insert made with the keyboard (Enter on the item)", async () => {
      const { user, circle, before } = await insertCircle();
      act(() => state().actions.undo());
      expect(elements()).toHaveLength(before);
      circle.focus();
      await user.keyboard("{Enter}");
      expect(elements()).toHaveLength(before + 1);
      // the keyboard stays in the panel to go on through it
      expect(document.activeElement).toBe(circle);
      await user.keyboard("{Delete}");
      expect(elements()).toHaveLength(before);
    });

    it("leaves the other plain keys on the item to the panel", async () => {
      const { user, before, added } = await insertCircle();
      const x = elements().find((e) => e.id === added)!.x;
      await user.keyboard("{ArrowRight}tr");
      expect(elements()).toHaveLength(before + 1);
      expect(elements().find((e) => e.id === added)!.x).toBe(x);
    });

    it("leaves Backspace and Delete to the search box of the panel", async () => {
      const { user, before } = await insertCircle();
      const search = screen.getAllByRole("searchbox")[0] as HTMLInputElement;
      await user.click(search);
      await user.keyboard("star{Backspace}{Backspace}{Delete}");
      expect(search.value).toBe("st");
      expect(elements()).toHaveLength(before + 1);
    });

    it("keeps Delete on a control of a context panel (the Position panel) from removing the element", async () => {
      const { before } = await insertCircle();
      act(() => state().actions.openContext({ kind: "position", tab: "arrange" }));
      const options = await screen.findByRole("complementary", { name: "Options panel" });
      const control = (await within(options).findAllByRole("button"))[0];
      control.focus();
      fireEvent.keyDown(control, { key: "Delete" });
      expect(elements()).toHaveLength(before + 1);
    });
  });

  it("adds a heading from Text, opens it for typing and takes the typed words", async () => {
    const { user } = await openEditor();
    await tab(user, "Text");
    const before = elements().length;
    await user.click(await screen.findByRole("button", { name: "Add a heading" }));
    expect(elements()).toHaveLength(before + 1);
    const heading = elements()[elements().length - 1] as TextElement;
    expect(state().editingTextId).toBe(heading.id);
    expect(heading.paragraphs[0].runs[0].text).toBe("Add a heading");
    await waitFor(() => expect(document.querySelector("[data-cf-text-editor]")).toBeTruthy());
  });

  it("applies a whole deck from Templates after asking, and undo brings the old pages back", async () => {
    const { user } = await openEditor();
    const deck = TEMPLATES.find((t) => t.name === "Startup Pitch Deck")!;
    const pagesBefore = state().design!.pages.length;
    await tab(user, "Templates");
    await user.type(await screen.findByRole("searchbox"), "startup pitch");
    await user.click(await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" }));
    await user.click(await screen.findByRole("button", { name: "Apply all 7 pages" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/6 more pages are added after it/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(state().design!.pages).toHaveLength(pagesBefore - 1 + deck.pages.length));
    expect(state().design!.pages[0].elements).toHaveLength(deck.pages[0].elements.length);

    // each step of the deck can be undone
    for (let i = 0; i < deck.pages.length; i++) act(() => state().actions.undo());
    expect(state().design!.pages).toHaveLength(pagesBefore);
  });

  it("uses the Tools palette to pick a drawing tool, and Escape goes back to Select", async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    await user.click(await screen.findByRole("button", { name: "Line" }));
    expect(state().tool).toBe("line");
    // the keyboard goes to the editor, not to a button of the palette
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(state().tool).toBe("select"));
    // the palette stays open and shows Select as the tool in use
    expect(
      within(screen.getByRole("toolbar", { name: "Tools" }))
        .getByRole("button", { name: "Select" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("folds the side panel away with the open tab and brings it back with the handle", async () => {
    const { user, view } = await openEditor();
    const panel = view.container.querySelector("#cf-sidepanel") as HTMLElement;
    expect(panel.classList.contains("is-open")).toBe(true);
    await user.click(screen.getByRole("tab", { name: "Elements" }));
    expect(panel.hasAttribute("data-collapsed")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Show panel" }));
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(state().panelOpen).toBe(true);
  });

  it("shows a context panel in place of the tab, and the rail gets the tab back", async () => {
    const { user } = await openEditor();
    await tab(user, "Brand");
    await screen.findByRole("heading", { name: "Brand kit" });
    act(() => state().actions.openContext({ kind: "position", tab: "arrange" }));
    expect(await screen.findByRole("complementary", { name: "Options panel" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Brand kit" })).toBeNull();
    // choosing the tab that is already open goes back to it instead of folding the panel
    await user.click(screen.getByRole("tab", { name: "Brand" }));
    expect(await screen.findByRole("heading", { name: "Brand kit" })).toBeTruthy();
    expect(state().context).toBeNull();
    expect(state().panelOpen).toBe(true);
  });

  it("keeps working through every tab in a row", async () => {
    const { user } = await openEditor();
    for (const name of ["Templates", "Text", "Brand", "Uploads", "Projects", "Apps", "Elements"]) {
      await tab(user, name);
      expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true");
      expect(await screen.findByRole("tabpanel")).toBeTruthy();
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

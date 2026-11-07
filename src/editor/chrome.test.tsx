import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import { mountFullEditor } from "@/test/chromeEditor";
import { chromeDesign, clearToasts, pageIds, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";

/*
 * The chrome around the canvas working together inside the real <Editor>: top bar, File menu, page strip, grid view,
 * notes, bottom bar, dialogs and the presenter. The pieces have their own tests next to them; these check the glue.
 */

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(1200, 800);
});

afterEach(async () => {
  restoreLayout();
  resetEditor();
  await clearToasts();
});

const state = () => useEditor.getState();
const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** the page counter of the bottom bar: its visible "2 / 3" and, for a screen reader, "Page 2 of 3" as text */
const pageLabel = (n: number) => ({
  get textContent() {
    return (screen.getByText(`Page ${n} of 3`).closest(".cf-bottombar__pageof")!.querySelector("[aria-hidden=true]") as HTMLElement).textContent;
  },
});
const strip = () => screen.getByRole("region", { name: "Pages" });

describe("the editor chrome", () => {
  it("lays out the top bar, the page strip and the bottom bar around the workspace", async () => {
    await mountFullEditor(chromeDesign("Laid out"));
    expect(screen.getByRole("banner", { name: "Design toolbar" })).toBeTruthy();
    expect(strip()).toBeTruthy();
    expect(screen.getByRole("contentinfo", { name: "View controls" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Design title" })).toHaveProperty("value", "Laid out");
    expect(pageLabel(1).textContent).toBe("1 / 3");
    expect(document.title).toBe("Laid out - Craftly");
  });

  it("keeps the strip and the page counter in step", async () => {
    await mountFullEditor(chromeDesign("In step"));
    const user = userEvent.setup({ delay: null });
    await user.click(within(strip()).getByRole("button", { name: "Page 3 of 3, Wrap up" }));
    expect(pageLabel(3).textContent).toBe("3 / 3");
    await user.click(within(strip()).getByRole("button", { name: "Page 2 of 3" }));
    expect(pageLabel(2).textContent).toBe("2 / 3");
  });

  it("adds a page from the strip and takes it back with Undo and Redo in the top bar", async () => {
    await mountFullEditor(chromeDesign("Undo pages"));
    const user = userEvent.setup({ delay: null });
    await user.click(within(strip()).getByRole("button", { name: "Add page" }));
    expect(pageIds()).toHaveLength(4);
    expect(within(strip()).getAllByRole("button", { name: /^Page \d of 4/ })).toHaveLength(4);
    await user.click(button("Undo"));
    expect(pageIds()).toHaveLength(3);
    expect(within(strip()).getAllByRole("button", { name: /^Page \d of 3/ })).toHaveLength(3);
    await user.click(button("Redo"));
    expect(pageIds()).toHaveLength(4);
  });

  it("hides the page strip from the bottom bar and brings it back", async () => {
    await mountFullEditor(chromeDesign("Strip toggle"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Pages"));
    expect(screen.queryByRole("region", { name: "Pages" })).toBeNull();
    await user.click(button("Pages"));
    expect(strip()).toBeTruthy();
  });

  it("swaps the workspace for the grid of pages and back", async () => {
    const { design } = await mountFullEditor(chromeDesign("Grid swap"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("File"));
    await user.click(screen.getByRole("menuitem", { name: /^Page view/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Grid view" }));
    const grid = await screen.findByRole("list", { name: "All pages" });
    expect(screen.queryByRole("region", { name: "Pages" })).toBeNull();
    expect(button("Exit grid view")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Zoom" })).toBeNull();
    fireEvent.doubleClick(within(grid).getByRole("button", { name: "Page 2 of 3. Double-click to edit." }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "All pages" })).toBeNull());
    expect(state().activePageId).toBe(design.pages[1].id);
    expect(pageLabel(2).textContent).toBe("2 / 3");
    expect(strip()).toBeTruthy();
  });

  it("leaves the grid on Escape", async () => {
    await mountFullEditor(chromeDesign("Grid escape"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Grid view"));
    await screen.findByRole("list", { name: "All pages" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("list", { name: "All pages" })).toBeNull());
    expect(state().gridView).toBe(false);
  });

  it("shows the notes of the open page and presents them with N", async () => {
    await mountFullEditor(chromeDesign("Notes everywhere"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Notes"));
    const notes = screen.getByRole("textbox", { name: "Notes for page 1" }) as HTMLTextAreaElement;
    expect(notes.value).toBe("Welcome everyone");
    await user.type(notes, " and thanks");
    await user.tab();
    expect(storeDesign().pages[0].notes).toBe("Welcome everyone and thanks");

    await user.click(button("Present"));
    await screen.findByRole("dialog", { name: "Presentation" });
    await user.keyboard("n");
    expect(within(screen.getByLabelText("Speaker notes")).getByText("Welcome everyone and thanks")).toBeTruthy();
  });

  it("presents over the editor, which stays untouched until the show ends on the page it reached", async () => {
    const { design } = await mountFullEditor(chromeDesign("Show"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Present"));
    const show = await screen.findByRole("dialog", { name: "Presentation" });
    expect(document.querySelector(".cf-editor__chrome")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".cf-editor")?.classList.contains("is-presenting")).toBe(true);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(within(show).getByText("3 / 3")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Presentation" })).toBeNull());
    expect(document.querySelector(".cf-editor__chrome")?.hasAttribute("inert")).toBe(false);
    expect(state().activePageId).toBe(design.pages[2].id);
    expect(pageLabel(3).textContent).toBe("3 / 3");
  });

  it("starts the show from a page's own menu in the strip", async () => {
    const { design } = await mountFullEditor(chromeDesign("Show from page"));
    const user = userEvent.setup({ delay: null });
    const cell = strip().querySelector(`[data-page-id="${design.pages[2].id}"]`) as HTMLElement;
    await user.click(within(cell).getByRole("button", { name: "Page 3 options" }));
    await user.click(screen.getByRole("menuitem", { name: "Present from this page" }));
    const show = await screen.findByRole("dialog", { name: "Presentation" });
    expect(within(show).getByText("3 / 3")).toBeTruthy();
  });

  it("resizes the design from the top bar with a format from the dialog", async () => {
    await mountFullEditor(chromeDesign("Resize flow"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Resize"));
    await user.click(within(screen.getByRole("dialog", { name: "Resize options" })).getByRole("button", { name: /Change the size/ }));
    const dialog = await screen.findByRole("dialog", { name: "Resize design" });
    await user.click(within(dialog).getByRole("button", { name: /^Instagram Post \(Square\)/ }));
    await user.click(within(dialog).getByRole("button", { name: "Resize" }));
    expect([storeDesign().width, storeDesign().height]).toEqual([1080, 1080]);
    expect(await screen.findByText("Resized to 1080 × 1080 px")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Resize design" })).toBeNull());
  });

  it("finds and replaces text from the File menu", async () => {
    await mountFullEditor(chromeDesign("Find flow"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("File"));
    await user.click(screen.getByRole("menuitem", { name: /^Find and replace text/ }));
    const panel = await screen.findByRole("dialog", { name: "Find and replace" });
    await user.type(within(panel).getByRole("searchbox", { name: "Find text" }), "Hello chrome");
    await user.type(within(panel).getByRole("textbox", { name: "Replacement text" }), "Goodbye chrome");
    await user.click(within(panel).getByRole("button", { name: "Replace all" }));
    expect(JSON.stringify(storeDesign().pages[0])).toContain("Goodbye chrome");
    expect(await screen.findByText("Replaced 1 match")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Find and replace" })).toBeNull());
  });

  it("opens the keyboard shortcuts from the Help menu of the bottom bar", async () => {
    await mountFullEditor(chromeDesign("Shortcuts flow"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Help"));
    await user.click(screen.getByRole("menuitem", { name: /^Keyboard shortcuts/ }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull());
  });

  it("renames the design from the title field and saves it", async () => {
    const { design } = await mountFullEditor(chromeDesign("Before the rename"));
    const user = userEvent.setup({ delay: null });
    const title = screen.getByRole("textbox", { name: "Design title" });
    await user.clear(title);
    await user.type(title, "After the rename{Enter}");
    expect(button("Unsaved changes")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "All changes saved" }, { timeout: 8000 })).toBeTruthy();
    expect((await getDesign(design.id))?.title).toBe("After the rename");
    expect(document.title).toBe("After the rename - Craftly");
  });

  it("moves a design to the trash from the File menu and leaves the editor", async () => {
    const { design } = await mountFullEditor(chromeDesign("Bin it"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("File"));
    await user.click(screen.getByRole("menuitem", { name: /^Move to trash/ }));
    await user.click(await screen.findByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    await waitFor(async () => expect((await getDesign(design.id))?.trashedAt).toEqual(expect.any(Number)));
  });

  it("closes a dialog with Escape before anything else reacts", async () => {
    await mountFullEditor(chromeDesign("Escape order"));
    const user = userEvent.setup({ delay: null });
    act(() => state().actions.openDialog("settings"));
    await screen.findByRole("dialog", { name: "Settings" });
    await user.keyboard("{Escape}");
    expect(state().dialog).toBeNull();
    expect(state().presenting).toBe(false);
  });
});

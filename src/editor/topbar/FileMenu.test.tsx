import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeProblemsDialog, useProblemsDialog } from "@/components/problemsDialogState";
import { createDesign, createPage } from "@/core/factory";
import { createFolder, getDesign, listDesigns, listFolders } from "@/core/library";
import { dbPut } from "@/core/persistence";
import { useEditor } from "@/core/store";
import { installAutosave } from "@/editor/autosave";
import { switchLanguage } from "@/i18n";
import { chromeDesign, clearToasts, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { FileMenu } from "./FileMenu";
import { printDesign } from "./designActions";

// Printing has its own tests (designActions.test.tsx): here only the menu item is checked.
vi.mock("./designActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./designActions")>();
  return { ...actual, printDesign: vi.fn() };
});
// Changing the language reloads the page: here only what the menu does before that is checked.
vi.mock("@/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n")>();
  return { ...actual, switchLanguage: vi.fn(async () => undefined) };
});
vi.mock("@/core/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library")>();
  return { ...actual, listFolders: vi.fn(actual.listFolders) };
});

const actions = () => useEditor.getState().actions;
const onRename = vi.fn();
const onUpload = vi.fn();

const mount = (title = "File menu design", prepare?: (d: ReturnType<typeof chromeDesign>) => void) => {
  const design = chromeDesign(title);
  prepare?.(design);
  return renderChrome(<FileMenu onRename={onRename} onUpload={onUpload} />, design);
};
const fileButton = () => screen.getByRole("button", { name: "File" });
const openMenu = async (user = userEvent.setup({ delay: null })) => {
  await user.click(fileButton());
  return screen.getByRole("menu", { name: "File" });
};
const item = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const checkbox = (name: string | RegExp) => screen.getByRole("menuitemcheckbox", { name });
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  onRename.mockClear();
  onUpload.mockClear();
  vi.mocked(printDesign).mockClear();
  vi.mocked(listFolders).mockClear();
});

afterEach(async () => {
  resetEditor();
  await clearToasts();
});

describe("<FileMenu>: the head of the menu", () => {
  it("shows the name, the number of pages and the size of the design", async () => {
    await mount("Quarterly review");
    await openMenu();
    expect(screen.getByText("Quarterly review")).toBeTruthy();
    expect(screen.getByText(/3 pages/).textContent).toContain("1280 × 720 px");
  });

  it("says '1 page' for a single page and shows print sizes in their own unit", async () => {
    const design = createDesign({ title: "Card", width: 336, height: 192, unit: "in", pages: [createPage()] });
    await renderChrome(<FileMenu onRename={onRename} onUpload={onUpload} />, design);
    await openMenu();
    expect(screen.getByText(/1 page\b/).textContent).toContain("3.5 × 2 in");
  });

  it("names the rename button with the title it shows, so that 'click <the title>' by voice finds it", async () => {
    await mount("Quarterly report");
    await openMenu();
    const button = screen.getByRole("button", { name: /^Rename design/ });
    expect(button.textContent).toContain("Quarterly report");
    expect(button.getAttribute("aria-label")).toContain("Quarterly report");
  });

  it("closes and asks the top bar to rename when the name is clicked", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /^Rename design/ }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
  });

  it("cannot rename a design that is only being viewed", async () => {
    await mount();
    act(() => actions().setMode("view"));
    await openMenu();
    expect((screen.getByRole("button", { name: /^Rename design/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens and closes with the File button and with Escape", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    expect(fileButton().getAttribute("aria-expanded")).toBe("false");
    await user.click(fileButton());
    expect(fileButton().getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
    await user.click(fileButton());
    await user.click(fileButton());
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
  });
});

describe("<FileMenu>: the design", () => {
  it("returns the focus to the File button after a choice", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Make available offline/));
    expect(await screen.findByText(/already works offline/)).toBeTruthy();
    expect(document.activeElement).toBe(fileButton());
  });

  it("creates a new design by going home with a note for the home page", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Create new design/));
    expect(sessionStorage.getItem("craftly:open-create")).toBe("1");
    expect(window.location.hash).toBe("#/");
  });

  it("asks for the file chooser to upload files", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Upload files/));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("makes a copy and opens it", async () => {
    const { design } = await mount("Original");
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Make a copy/));
    expect(await screen.findByText("Copy created")).toBeTruthy();
    const all = await listDesigns();
    expect(all.map((d) => d.title).sort()).toEqual(["Original", "Original (copy)"]);
    const copy = all.find((d) => d.id !== design.id)!;
    expect(window.location.hash).toBe(`#/design/${copy.id}`);
  });

  it("saves now and says so", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Save/));
    expect(await screen.findByText("All changes saved")).toBeTruthy();
  });

  it.each([
    ["saved", "All changes saved"],
    ["saving", "Saving..."],
    ["unsaved", "Unsaved changes"],
    ["error", "Couldn't save"],
  ] as const)("shows the %s state next to Save", async (state, hint) => {
    await mount();
    act(() => actions().setSaveState(state));
    await openMenu();
    expect(item(/^Save/).textContent).toBe(`Save${hint}`);
  });

  it("explains that Craftly already works offline", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Make available offline/));
    expect(await screen.findByText("Craftly already works offline - your designs are stored on this device.")).toBeTruthy();
  });

  it("opens the on-device models dialog", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^On-device models/));
    expect(useEditor.getState().dialog).toBe("models");
  });

  it("opens the download, version history, find and replace dialogs", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    for (const [name, dialog] of [
      [/^Download/, "download"],
      [/^Version history/, "versions"],
      [/^Find and replace text/, "findReplace"],
    ] as const) {
      await openMenu(user);
      await user.click(item(name));
      expect(useEditor.getState().dialog).toBe(dialog);
      act(() => actions().closeDialog());
    }
  });

  it("starts printing", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Print/));
    expect(printDesign).toHaveBeenCalledTimes(1);
  });

  it("finds Report a problem under Help", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Help/));
    await user.click(item(/^Report a problem/));
    expect(useProblemsDialog.getState().open).toBe(true);
    act(() => closeProblemsDialog());
  });

  it("finds the keyboard shortcuts under Help", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Help/));
    await user.click(item(/^Keyboard shortcuts/));
    expect(useEditor.getState().dialog).toBe("shortcuts");
  });
});

describe("<FileMenu>: page view, rulers and settings", () => {
  it.each([
    [{}, "Thumbnails"],
    [{ showPageStrip: false }, "Hidden"],
    [{ gridView: true }, "Grid view"],
  ])("labels the page view %j as %s", async (patch, hint) => {
    await mount();
    act(() => useEditor.setState(patch));
    await openMenu();
    expect(item(/^Page view/).textContent).toBe(`Page view${hint}`);
  });

  it("turns the thumbnails and the grid view on and off", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Page view/));
    expect(checkbox("Thumbnails").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Grid view").getAttribute("aria-checked")).toBe("false");
    await user.click(checkbox("Thumbnails"));
    expect(useEditor.getState().showPageStrip).toBe(false);
    await openMenu(user);
    await user.click(item(/^Page view/));
    await user.click(checkbox("Grid view"));
    expect(useEditor.getState().gridView).toBe(true);
  });

  it("shows rulers and snaps to guides from Rulers and guides", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Rulers and guides/));
    await user.click(checkbox("Show rulers"));
    expect(useEditor.getState().showRulers).toBe(true);

    await openMenu(user);
    await user.click(item(/^Rulers and guides/));
    expect(checkbox("Show rulers").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Snap to guides").getAttribute("aria-checked")).toBe("true");
    await user.click(checkbox("Snap to guides"));
    expect(useEditor.getState().snapEnabled).toBe(false);
  });

  it("keeps the page, the selection and the zoom for the reload into another language (B12)", async () => {
    await mount("Two pages", (d) => {
      d.pages.push(createPage({ id: "second" }));
    });
    act(() => {
      actions().setActivePage("second");
      actions().setZoom(0.75);
    });
    sessionStorage.clear();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Language/));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "हिन्दी" }));
    expect(vi.mocked(switchLanguage)).toHaveBeenCalledWith("hi");
    const kept = JSON.parse(sessionStorage.getItem("craftly.keptView") ?? "null");
    expect(kept).toMatchObject({ designId: storeDesign().id, pageId: "second", zoom: 0.75 });
  });

  it("opens the Settings dialog from Settings, which repeats no toggle of the menu", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    const settings = item("Settings");
    expect(settings.getAttribute("aria-haspopup")).toBeNull();
    await user.click(settings);
    expect(useEditor.getState().dialog).toBe("settings");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clears the guides and says how many there were", async () => {
    await mount("Guides", (d) => {
      d.guides = { vertical: [100], horizontal: [200, 300] };
    });
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Rulers and guides/));
    expect(item(/^Clear guides/).textContent).toBe("Clear guides3");
    await user.click(item(/^Clear guides/));
    expect(await screen.findByText("Guides cleared")).toBeTruthy();
    const guides = storeDesign().guides;
    expect((guides?.vertical.length ?? 0) + (guides?.horizontal.length ?? 0)).toBe(0);
  });

  it("has nothing to clear without guides", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Rulers and guides/));
    expect(isDisabled(item(/^Clear guides/))).toBe(true);
    expect(item(/^Clear guides/).textContent).toBe("Clear guides");
  });
});

describe("<FileMenu>: star, move and trash", () => {
  it("stars the design and takes the star away again", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    expect(checkbox("Star").getAttribute("aria-checked")).toBe("false");
    await user.click(checkbox("Star"));
    expect(storeDesign().starred).toBe(true);
    expect(await screen.findByText("Added to starred")).toBeTruthy();
    await openMenu(user);
    expect(checkbox("Star").getAttribute("aria-checked")).toBe("true");
    await user.click(checkbox("Star"));
    expect(storeDesign().starred).toBe(false);
    expect(await screen.findByText("Removed from starred")).toBeTruthy();
  });

  it("moves the design into a folder, labelled with its parents, and back to the top level", async () => {
    const clients = await createFolder("Clients");
    const year = await createFolder("2026", clients.id);
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    expect(item(/^Move(?! to trash)/).textContent).toBe("MoveProjects");
    await user.click(item(/^Move(?! to trash)/));
    expect(checkbox("Projects (top level)").getAttribute("aria-checked")).toBe("true");
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Clients / 2026" }));
    expect(storeDesign().folderId).toBe(year.id);
    expect(await screen.findByText("Moved to Clients / 2026")).toBeTruthy();

    await openMenu(user);
    expect(item(/^Move(?! to trash)/).textContent).toBe("Move2026");
    await user.click(item(/^Move(?! to trash)/));
    expect((await screen.findByRole("menuitemcheckbox", { name: "Clients / 2026" })).getAttribute("aria-checked")).toBe("true");
    await user.click(checkbox("Projects (top level)"));
    expect(storeDesign().folderId).toBeNull();
    expect(await screen.findByText("Moved to Projects")).toBeTruthy();
  });

  it("shows no folder name for a folder that no longer exists", async () => {
    await mount("Lost folder", (d) => {
      d.folderId = "deleted-folder";
    });
    await openMenu();
    expect(item(/^Move(?! to trash)/).textContent).toBe("Move");
  });

  it("copes with folders that name each other as parents", async () => {
    await dbPut("folders", { id: "loop-a", name: "A", createdAt: 1, parentId: "loop-b" });
    await dbPut("folders", { id: "loop-b", name: "B", createdAt: 2, parentId: "loop-a" });
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Move(?! to trash)/));
    const labels = (await screen.findAllByRole("menuitemcheckbox")).map((i) => i.textContent ?? "");
    const longest = labels.reduce((a, b) => (a.split(" / ").length >= b.split(" / ").length ? a : b));
    expect(longest.split(" / ").length).toBe(9);
  });

  it("still lets the design go to the top level when the folders cannot be read", async () => {
    vi.mocked(listFolders).mockRejectedValueOnce(new Error("blocked"));
    await mount();
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Move(?! to trash)/));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Projects (top level)" })).toBeTruthy();
    expect(within(screen.getByRole("menu", { name: "Move" })).getAllByRole("menuitemcheckbox")).toHaveLength(1);
  });

  it("moves to the trash after asking, and the person can undo it", async () => {
    const { design } = await mount("To the bin");
    // the editor leaves only once the trashed state is stored, and it is the autosave that stores it
    const stopAutosave = installAutosave();
    try {
      const user = userEvent.setup({ delay: null });
      await openMenu(user);
      await user.click(item(/^Move to trash/));
      await user.click(await screen.findByRole("button", { name: "Move to trash" }));
      await waitFor(() => expect(window.location.hash).toBe("#/"));
      expect((await getDesign(design.id))?.trashedAt).toEqual(expect.any(Number));
      await user.click(await screen.findByRole("button", { name: "Undo" }));
      await waitFor(async () => expect((await getDesign(design.id))?.trashedAt).toBeNull());
    } finally {
      stopAutosave();
    }
  });

  it("keeps the design when the person cancels the trash dialog", async () => {
    const { design } = await mount("Kept");
    const user = userEvent.setup({ delay: null });
    await openMenu(user);
    await user.click(item(/^Move to trash/));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(storeDesign().trashedAt).toBeNull();
    expect((await getDesign(design.id))?.trashedAt).toBeNull();
  });

  it("disables everything that changes the design while it is only being viewed", async () => {
    await mount();
    act(() => actions().setMode("view"));
    await openMenu();
    for (const name of [/^Upload files/, /^Move to trash/, /^Move(?! to trash)/]) expect(isDisabled(item(name))).toBe(true);
    expect(isDisabled(checkbox("Star"))).toBe(true);
    expect(isDisabled(item(/^Make a copy/))).toBe(false);
    expect(isDisabled(item(/^Download/))).toBe(false);
  });
});

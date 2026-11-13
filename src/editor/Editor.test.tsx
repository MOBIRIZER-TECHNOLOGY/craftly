import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createGroup, createPage, createShape } from "@/core/factory";
import { getDesign, getSummary, getVersion, listVersions, saveDesign, saveVersion, summarize } from "@/core/library";
import { keepBeforeProblem, markCrashing } from "@/core/recovery";
import { dbGet, dbPut } from "@/core/persistence";
import { CURRENT_DESIGN_VERSION, migrateDesign } from "@/core/schema/design";
import { MigrationError } from "@/core/schema/migrator";
import { getActions, useEditor } from "@/core/store";
import { renderPageToCanvas } from "@/render/renderPage";
import { setMedia } from "@/test/media";
import { clearLibrary, flush, mountEditor, resetEditor, sampleDesign, stubLayout } from "@/test/helpers";
import { Editor } from "./Editor";
import { printDesign } from "./topbar/designActions";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

/* the real library, painter and print job, wrapped so a test can see (and break) the calls the editor makes */
vi.mock("@/core/library", async (importOriginal) => {
  const library = await importOriginal<typeof import("@/core/library")>();
  return { ...library, saveDesign: vi.fn(library.saveDesign) };
});
vi.mock("@/core/recovery", async (importOriginal) => {
  const recovery = await importOriginal<typeof import("@/core/recovery")>();
  return { ...recovery, keepBeforeProblem: vi.fn(recovery.keepBeforeProblem) };
});
vi.mock("@/core/schema/design", async (importOriginal) => {
  const schema = await importOriginal<typeof import("@/core/schema/design")>();
  return { ...schema, migrateDesign: vi.fn(schema.migrateDesign) };
});
vi.mock("@/render/renderPage", async (importOriginal) => {
  const painter = await importOriginal<typeof import("@/render/renderPage")>();
  return { ...painter, renderPageToCanvas: vi.fn(painter.renderPageToCanvas) };
});
vi.mock("./topbar/designActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./topbar/designActions")>()),
  printDesign: vi.fn(async () => undefined),
}));

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout();
  vi.mocked(saveDesign).mockClear();
  vi.mocked(renderPageToCanvas).mockClear();
  vi.mocked(printDesign).mockClear();
  vi.mocked(keepBeforeProblem).mockClear();
});

afterEach(() => {
  restoreLayout();
  resetEditor();
});

const state = () => useEditor.getState();
const actions = () => getActions();
const title = () => screen.getByRole("textbox", { name: "Design title" });

describe("<Editor>", () => {
  it("opens a saved design and lays out the editor", async () => {
    const { design, container } = await mountEditor();
    expect(useEditor.getState().design?.title).toBe(design.title);
    expect(container.querySelector(".cf-editor")).toBeTruthy();
    expect(container.querySelector("[data-cf-workspace]")).toBeTruthy();
  });

  it("walks every left rail tab", async () => {
    await mountEditor();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(5);
    for (const tab of tabs) {
      await act(async () => {
        fireEvent.click(tab);
      });
      await flush();
    }
  });

  it("shows a message for a design that does not exist", async () => {
    const { render } = await import("@testing-library/react");
    const { Editor } = await import("./Editor");
    render(<Editor designId="nope" />);
    await waitFor(() => expect(document.body.textContent).toMatch(/couldn.t find|not found|missing/i));
  });
});

describe("loading", () => {
  it("shows a spinner while the design is fetched, then the editor", async () => {
    const design = sampleDesign({ title: "Loading test" });
    await saveDesign(design);
    const { container } = render(<Editor designId={design.id} />);
    expect(screen.getByRole("status", { name: "Opening your design" })).toBeTruthy();
    expect(container.querySelector(".cf-editor")).toBeNull();
    await waitFor(() => expect(container.querySelector(".cf-editor")).toBeTruthy());
    expect(screen.queryByRole("status", { name: "Opening your design" })).toBeNull();
    expect(state().design?.id).toBe(design.id);
    expect(state().saveState).toBe("saved");
    expect(state().selection).toEqual([]);
  });

  it("lays out the top bar, the rail and side panel, the page, the page strip and the bottom bar", async () => {
    const { container } = await mountEditor();
    expect(screen.getByRole("banner", { name: "Design toolbar" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "Design" })).toBeTruthy();
    expect(container.querySelector(".cf-editor__chrome")).toBeTruthy();
    expect(container.querySelector(".cf-strip")).toBeTruthy();
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(5);
    expect(document.title).toBe("Sample - Craftly");
  });

  it("names the browser tab after the design and puts the old title back on the way out", async () => {
    document.title = "Home";
    const { unmount } = await mountEditor(sampleDesign({ title: "Quarterly report" }));
    expect(document.title).toBe("Quarterly report - Craftly");
    act(() => actions().setTitle("Annual report"));
    expect(document.title).toBe("Annual report - Craftly");
    unmount();
    expect(document.title).toBe("Home");
  });

  it("has one top-level heading that names the design, for screen reader users who move by headings", async () => {
    await mountEditor(sampleDesign({ title: "Quarterly report" }));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Quarterly report");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // first thing in the design toolbar: before the panel's own headings in the page, and not outside every landmark
    const toolbar = screen.getByRole("banner", { name: "Design toolbar" });
    expect(within(toolbar).getByRole("heading", { level: 1 })).toBe(heading);
    expect(toolbar.firstElementChild).toBe(heading);
    act(() => actions().setTitle("Annual report"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Annual report");
  });

  it("explains that a design is missing and offers the way home", async () => {
    window.location.hash = "#/design/nope";
    render(<Editor designId="nope" />);
    expect(await screen.findByText("We couldn't find this design")).toBeTruthy();
    expect(screen.getByText(/may have been deleted/)).toBeTruthy();
    expect(screen.queryByText("Go back to an earlier version")).toBeNull(); // there is no design to go back in
    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    expect(window.location.hash).toBe("#/");
    expect(state().design).toBeNull();
  });

  it("says so when the stored design is damaged, without touching the other designs", async () => {
    const broken = { ...createDesign({ title: "Damaged", width: 800, height: 600 }), id: "damaged", pages: [] };
    await saveDesign(broken);
    render(<Editor designId="damaged" />);
    expect(await screen.findByText("We couldn't open this design")).toBeTruthy();
    expect(screen.getByText(/looks damaged/)).toBeTruthy();
    expect(state().design).toBeNull();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeTruthy();
  });

  it("gives a damaged design a way back: its earlier versions, open, and the one that is chosen put back", async () => {
    const good = sampleDesign({ title: "Poster" });
    await saveDesign(good);
    await saveVersion(good, "Before the problem");
    await saveDesign({ ...good, pages: [] }); // what the editor wrote when the screen stopped
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    try {
      render(<Editor designId={good.id} />);
      expect(await screen.findByText("We couldn't open this design")).toBeTruthy();
      expect(screen.getByText(/Go back to an earlier version below/)).toBeTruthy();
      expect(screen.getByText("Go back to an earlier version").closest("details")!.open).toBe(true);
      expect((await screen.findByText(/Before the problem/)).closest("li")).toBeTruthy();
      fireEvent.click(await screen.findByRole("button", { name: "Use this version" }));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect((await getDesign(good.id))!.pages).toHaveLength(good.pages.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says that a damaged design has no earlier versions when it has none, and still offers a copy of it", async () => {
    const broken = { ...createDesign({ title: "Damaged", width: 800, height: 600 }), id: "damaged-alone", pages: [] };
    await saveDesign(broken);
    render(<Editor designId="damaged-alone" />);
    await screen.findByText("We couldn't open this design");
    expect(await screen.findByText("There are no earlier versions of this design yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save a copy of the design to a file" })).toBeTruthy();
  });

  it("asks for a reload when the design was saved by a newer Craftly, and does not touch it", async () => {
    const design = sampleDesign({ title: "From the future" });
    const future = { ...design, version: CURRENT_DESIGN_VERSION + 1, somethingNew: { a: 1 } };
    await dbPut("designs", future);
    await dbPut("summaries", { ...summarize(design), schema: CURRENT_DESIGN_VERSION + 1 });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    try {
      render(<Editor designId={design.id} />);
      expect(await screen.findByText("Update Craftly to open this design")).toBeTruthy();
      expect(screen.getByText(/saved by a newer version of Craftly than the one running in this tab/)).toBeTruthy();
      expect(screen.queryByText("Go back to an earlier version")).toBeNull(); // a reload is the way on, not an older version
      expect(state().design).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
      expect(window.location.hash).toBe("#/");
      await flush(6);
      expect(await dbGet("designs", design.id)).toEqual(future);
      expect(vi.mocked(saveDesign)).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says why when a design cannot be brought up to date, and does not touch it", async () => {
    const design = sampleDesign({ title: "Cannot be converted" });
    await saveDesign(design);
    vi.mocked(saveDesign).mockClear();
    vi.mocked(migrateDesign).mockImplementationOnce(() => {
      throw new MigrationError("failed", "design", "Craftly could not bring this design up to date (format 1 to 2).", { step: 1 });
    });
    render(<Editor designId={design.id} />);
    expect(await screen.findByText("We couldn't bring this design up to date")).toBeTruthy();
    expect(screen.getByText(/format 1 to 2/)).toBeTruthy();
    expect(screen.getByText(/Nothing has been changed/)).toBeTruthy();
    expect(screen.queryByText("Go back to an earlier version")).toBeNull();
    expect(state().design).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeTruthy();
    expect(vi.mocked(saveDesign)).not.toHaveBeenCalled();
  });

  it("treats a library that cannot be read as a missing design", async () => {
    const design = sampleDesign({ title: "Unreadable" });
    await saveDesign(design);
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    render(<Editor designId={design.id} />);
    expect(await screen.findByText("We couldn't find this design")).toBeTruthy();
  });

  it("does nothing when the editor is closed before the design arrives", async () => {
    const design = sampleDesign({ title: "Too late" });
    await saveDesign(design);
    const { unmount } = render(<Editor designId={design.id} />);
    unmount();
    await flush(6);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state().design).toBeNull();
  });

  it("ignores a failure that arrives after the editor was closed", async () => {
    const design = sampleDesign({ title: "Too late, and broken" });
    await saveDesign(design);
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    const { unmount } = render(<Editor designId={design.id} />);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state().design).toBeNull();
  });

  it("opens the next design when the route changes, keeping the edits of the first", async () => {
    const first = sampleDesign({ id: "design-a", title: "Design A" });
    const second = sampleDesign({ id: "design-b", title: "Design B" });
    await saveDesign(first);
    await saveDesign(second);
    const view = render(<Editor designId="design-a" />);
    await waitFor(() => expect(state().design?.id).toBe("design-a"));
    act(() => actions().setTitle("A, edited"));
    view.rerender(<Editor designId="design-b" />);
    await waitFor(() => expect(state().design?.id).toBe("design-b"));
    await waitFor(async () => expect((await getDesign("design-a"))?.title).toBe("A, edited"));
    expect(state().saveState).toBe("saved");
  });
});

describe("going away because the screen stopped", () => {
  afterEach(() => markCrashing(false));

  it("keeps the last saved state as a version before it writes the one that was on the screen, which may be what stopped it", async () => {
    const { design, unmount } = await mountEditor(sampleDesign({ title: "Saved title" }));
    act(() => actions().setTitle("On the screen when it stopped"));
    markCrashing(true);
    unmount();
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("On the screen when it stopped"));
    const kept = (await listVersions(design.id)).find((v) => v.label === "Before the problem");
    expect(kept).toBeTruthy();
    expect((await getVersion(kept!.id))!.design.title).toBe("Saved title");
  });

  it("makes no version when the person simply leaves", async () => {
    const { design, unmount } = await mountEditor(sampleDesign({ title: "Saved title" }));
    act(() => actions().setTitle("Edited, then left"));
    unmount();
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Edited, then left"));
    expect(await listVersions(design.id)).toEqual([]);
    expect(keepBeforeProblem).not.toHaveBeenCalled();
  });

  it("keeps nothing when everything was saved already: the stored state is the one that was on the screen", async () => {
    const { design, unmount } = await mountEditor();
    markCrashing(true);
    unmount();
    await flush();
    expect(await listVersions(design.id)).toEqual([]);
    expect(keepBeforeProblem).not.toHaveBeenCalled();
  });

  it("still writes the state that was on the screen when the old one could not be kept", async () => {
    vi.mocked(keepBeforeProblem).mockRejectedValueOnce(new Error("no room"));
    const { design, unmount } = await mountEditor(sampleDesign({ title: "Saved title" }));
    act(() => actions().setTitle("Still written"));
    markCrashing(true);
    unmount();
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Still written"));
  });
});

describe("on a phone", () => {
  it("starts with the side panel folded away", async () => {
    setMedia("(max-width: 899px)", true);
    expect(state().panelOpen).toBe(true);
    await mountEditor();
    expect(state().panelOpen).toBe(false);
  });

  it("keeps the side panel open on a wider screen", async () => {
    await mountEditor();
    expect(state().panelOpen).toBe(true);
  });
});

describe("what the editor shows for the state of the document", () => {
  it("swaps the page for the grid of pages, and hides the notes and the page strip there", async () => {
    const { container } = await mountEditor();
    act(() => actions().toggle("notesOpen"));
    expect(screen.getByRole("region", { name: "Presenter notes" })).toBeTruthy();
    expect(container.querySelector(".cf-strip")).toBeTruthy();
    act(() => actions().toggle("gridView"));
    expect(container.querySelector(".cf-editor")?.className).toContain("is-grid");
    expect(container.querySelector("[data-cf-workspace]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Presenter notes" })).toBeNull();
    expect(container.querySelector(".cf-strip")).toBeNull();
    act(() => actions().toggle("gridView"));
    expect(container.querySelector("[data-cf-workspace]")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Presenter notes" })).toBeTruthy();
  });

  it("can hide the page strip", async () => {
    const { container } = await mountEditor();
    act(() => actions().toggle("showPageStrip"));
    expect(container.querySelector(".cf-strip")).toBeNull();
  });

  it("marks the editor read-only in view mode", async () => {
    const { container } = await mountEditor();
    expect(container.querySelector(".cf-editor")?.className).not.toContain("is-view");
    act(() => actions().setMode("view"));
    expect(container.querySelector(".cf-editor")?.className).toContain("is-view");
  });

  it("puts the presenter over an inert editor while presenting", async () => {
    const { container } = await mountEditor();
    expect(container.querySelector(".cf-editor__chrome")?.hasAttribute("inert")).toBe(false);
    act(() => actions().setPresenting(true));
    await flush();
    expect(container.querySelector(".cf-editor")?.className).toContain("is-presenting");
    expect(container.querySelector(".cf-editor__chrome")?.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("dialog", { name: "Presentation" })).toBeTruthy();
    act(() => actions().setPresenting(false));
    await flush();
    expect(screen.queryByRole("dialog", { name: "Presentation" })).toBeNull();
    expect(container.querySelector(".cf-editor__chrome")?.hasAttribute("inert")).toBe(false);
  });

  it("shows the dialog that the store asks for", async () => {
    await mountEditor();
    act(() => actions().openDialog("shortcuts"));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });
});

describe("the services it installs", () => {
  it("lets the shortcuts work on the page", async () => {
    const { design, container } = await mountEditor();
    const box = design.pages[0].elements[1];
    act(() => actions().select([box.id]));
    const host = container.querySelector("[data-cf-workspace]") as HTMLElement;
    expect(fireEvent.keyDown(host, { key: "ArrowRight", shiftKey: true })).toBe(false);
    expect(state().design?.pages[0].elements[1].x).toBe(box.x + 10);
    fireEvent.keyDown(host, { key: "Delete" });
    expect(state().design?.pages[0].elements.map((e) => e.id)).not.toContain(box.id);
  });

  it("removes the shortcuts when the editor is closed", async () => {
    const { design, unmount } = await mountEditor();
    unmount();
    resetEditor();
    actions().openDesign(design);
    actions().select([design.pages[0].elements[1].id]);
    expect(fireEvent.keyDown(document.body, { key: "Delete" })).toBe(true);
    expect(state().design?.pages[0].elements).toHaveLength(4);
  });

  it("saves the design shortly after an edit", async () => {
    const { design } = await mountEditor();
    act(() => actions().setTitle("Autosaved title"));
    expect(state().saveState).toBe("unsaved");
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Autosaved title"), { timeout: 4000 });
    await waitFor(() => expect(state().saveState).toBe("saved"));
    expect((await getSummary(design.id))?.thumbnail).toMatch(/^data:image\/jpeg/);
  });

  it("saves at once on Ctrl+S", async () => {
    const { design } = await mountEditor();
    vi.mocked(saveDesign).mockClear();
    act(() => actions().setTitle("Saved by hand"));
    expect(fireEvent.keyDown(document.body, { key: "s", ctrlKey: true })).toBe(false);
    await waitFor(() => expect(saveDesign).toHaveBeenCalledTimes(1), { timeout: 600 });
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Saved by hand"));
  });
});

describe("keyboard isolation of the editor chrome", () => {
  async function chromeWithSelection() {
    const view = await mountEditor();
    const [, box] = view.design.pages[0].elements;
    act(() => actions().select([box.id]));
    const tab = screen.getAllByRole("tab")[0];
    tab.focus();
    const host = view.container.querySelector("[data-cf-workspace]") as HTMLElement;
    return { ...view, box, tab, host };
  }

  it("keeps plain keys pressed on a control from nudging, deleting or adding things on the page", async () => {
    const { box, tab } = await chromeWithSelection();
    const before = JSON.stringify(state().design?.pages[0].elements);
    for (const key of ["ArrowRight", "ArrowDown", "Delete", "Backspace", "Enter", " ", "t", "r", "c", "l", "Tab"]) fireEvent.keyDown(tab, { key });
    expect(JSON.stringify(state().design?.pages[0].elements)).toBe(before);
    expect(state().editingTextId).toBeNull();
    expect(state().selection).toEqual([box.id]);
    expect(state().showRulers).toBe(false);
  });

  it("lets Escape through from a control: it clears the selection", async () => {
    const { tab } = await chromeWithSelection();
    fireEvent.keyDown(tab, { key: "Escape" });
    expect(state().selection).toEqual([]);
  });

  it("lets ? through from a control: it opens the list of shortcuts", async () => {
    const { tab } = await chromeWithSelection();
    fireEvent.keyDown(tab, { key: "?", shiftKey: true });
    expect(state().dialog).toBe("shortcuts");
  });

  it("lets shortcuts with Ctrl, Cmd or Alt through from a control", async () => {
    const { box, tab } = await chromeWithSelection();
    fireEvent.keyDown(tab, { key: "d", ctrlKey: true });
    expect(state().design?.pages[0].elements).toHaveLength(5);
    fireEvent.keyDown(tab, { key: "z", metaKey: true });
    expect(state().design?.pages[0].elements).toHaveLength(4);
    fireEvent.keyDown(tab, { key: "ArrowRight", altKey: true });
    expect(state().design?.pages[0].elements.find((e) => e.id === box.id)?.x).toBe(box.x);
  });

  it("lets keys pressed outside the editor altogether through to the shortcuts", async () => {
    const { box } = await chromeWithSelection();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(state().design?.pages[0].elements.map((e) => e.id)).not.toContain(box.id);
  });

  it("lets keys pressed on the page itself through", async () => {
    const { box, host } = await chromeWithSelection();
    fireEvent.keyDown(host, { key: "ArrowRight" });
    expect(state().design?.pages[0].elements[1].x).toBe(box.x + 1);
  });

  it("keeps keys pressed on the floating toolbars from reaching the page", async () => {
    const { box, host } = await chromeWithSelection();
    const control = host.appendChild(document.createElement("button"));
    control.setAttribute("data-cf-ui", "");
    fireEvent.keyDown(control, { key: "ArrowRight" });
    fireEvent.keyDown(control, { key: "Delete" });
    expect(state().design?.pages[0].elements[1].x).toBe(box.x);
    expect(state().design?.pages[0].elements).toHaveLength(4);
  });

  it("keeps keys pressed on a floating layer outside the editor from reaching the page", async () => {
    const { box } = await chromeWithSelection();
    const layer = document.body.appendChild(document.createElement("div"));
    layer.setAttribute("data-cf-layer", "");
    const item = layer.appendChild(document.createElement("div"));
    fireEvent.keyDown(item, { key: "Delete" });
    expect(state().design?.pages[0].elements.map((e) => e.id)).toContain(box.id);
  });

  it("passes keys that do not come from an element straight to the shortcuts", async () => {
    const { box } = await chromeWithSelection();
    fireEvent.keyDown(document, { key: "Delete" });
    expect(state().design?.pages[0].elements.map((e) => e.id)).not.toContain(box.id);
  });

  it("opens find and replace on Ctrl+F in the title field instead of the browser's own find", async () => {
    await mountEditor();
    title().focus();
    expect(fireEvent.keyDown(title(), { key: "f", ctrlKey: true })).toBe(false);
    expect(state().dialog).toBe("findReplace");
  });

  it("answers Cmd+F in a text field of the editor in the same way", async () => {
    await mountEditor();
    expect(fireEvent.keyDown(title(), { key: "F", metaKey: true })).toBe(false);
    expect(state().dialog).toBe("findReplace");
  });

  it("leaves Ctrl+F alone in a text field outside the editor, and on Ctrl+Alt+F", async () => {
    await mountEditor();
    const outside = document.body.appendChild(document.createElement("input"));
    expect(fireEvent.keyDown(outside, { key: "f", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(title(), { key: "f", ctrlKey: true, altKey: true })).toBe(true);
    expect(state().dialog).toBeNull();
  });

  it("prints the pages of the design on Ctrl+P, not the editor around them", async () => {
    await mountEditor();
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(false);
    expect(printDesign).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(title(), { key: "P", metaKey: true })).toBe(false);
    expect(printDesign).toHaveBeenCalledTimes(2);
  });

  it("does not print for Ctrl+Shift+P or Ctrl+Alt+P", async () => {
    await mountEditor();
    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true, altKey: true });
    expect(printDesign).not.toHaveBeenCalled();
  });

  it("stops intercepting once the editor is closed", async () => {
    const { unmount } = await mountEditor();
    unmount();
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(true);
    expect(printDesign).not.toHaveBeenCalled();
  });
});

describe("leaving the editor", () => {
  it("writes edits that the autosave had not saved yet, with a fresh thumbnail", async () => {
    const { design, unmount } = await mountEditor();
    vi.mocked(saveDesign).mockClear();
    act(() => actions().setTitle("Changed a moment ago"));
    unmount();
    expect(state().design).toBeNull();
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Changed a moment ago"));
    expect(saveDesign).toHaveBeenCalledTimes(1);
    expect((await getSummary(design.id))?.thumbnail).toMatch(/^data:image\/jpeg/);
  });

  it("still saves when the thumbnail cannot be drawn", async () => {
    const { design, unmount } = await mountEditor();
    vi.mocked(renderPageToCanvas).mockRejectedValueOnce(new Error("no canvas"));
    act(() => actions().setTitle("Saved without a picture"));
    unmount();
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Saved without a picture"));
    expect((await getSummary(design.id))?.thumbnail).toBeUndefined();
  });

  it("gives up quietly when the write fails", async () => {
    const { design, unmount } = await mountEditor();
    vi.mocked(saveDesign).mockClear();
    vi.mocked(saveDesign).mockRejectedValueOnce(new Error("quota exceeded"));
    act(() => actions().setTitle("Lost to a full disk"));
    unmount();
    await waitFor(() => expect(saveDesign).toHaveBeenCalledTimes(1));
    await flush();
    expect((await getDesign(design.id))?.title).toBe(design.title);
  });

  it("writes nothing when everything was saved already", async () => {
    const { unmount } = await mountEditor();
    vi.mocked(saveDesign).mockClear();
    unmount();
    await flush(6);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saveDesign).not.toHaveBeenCalled();
  });

  it("leaves a save that is already running to finish", async () => {
    const { unmount } = await mountEditor();
    vi.mocked(saveDesign).mockClear();
    act(() => useEditor.setState({ saveState: "saving" }));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saveDesign).not.toHaveBeenCalled();
  });

  it("writes an edit made while an older save was running, although the editor is closed before that save ends", async () => {
    const { design, unmount } = await mountEditor();
    const library = await vi.importActual<typeof import("@/core/library")>("@/core/library");
    let finish: () => void = () => undefined;
    vi.mocked(saveDesign).mockClear();
    vi.mocked(saveDesign).mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (finish = resolve));
      return library.saveDesign(...args);
    });
    act(() => actions().setTitle("Being saved"));
    act(() => void window.dispatchEvent(new CustomEvent("craftly:save-now")));
    expect(state().saveState).toBe("saving");
    act(() => actions().setTitle("Changed during the save"));
    unmount();
    expect(state().design).toBeNull();
    finish();
    await waitFor(async () => expect((await getDesign(design.id))?.title).toBe("Changed during the save"));
    expect(saveDesign).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when no design was ever opened", async () => {
    const view = render(<Editor designId="nope" />);
    await screen.findByText("We couldn't find this design");
    vi.mocked(saveDesign).mockClear();
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saveDesign).not.toHaveBeenCalled();
  });

  it("keeps the edits made inside a group when the editor is closed", async () => {
    const group = createGroup([createShape("rect", { id: "kid", x: 0, y: 0, width: 50, height: 50 })], { id: "grp", x: 10, y: 10, width: 50, height: 50 });
    const design = createDesign({ title: "Grouped", width: 800, height: 600, pages: [createPage({ elements: [group] })] });
    const { unmount } = await mountEditor(design);
    act(() => actions().select(["grp"]));
    act(() => actions().nudge(100, 0));
    unmount();
    await waitFor(async () => expect((await getDesign(design.id))?.pages[0].elements[0].x).toBe(110));
  });
});

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duplicateDesign, getDesign, listDesigns, restoreFromTrash, saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import { installAutosave } from "@/editor/autosave";
import { exportProjectFile } from "@/export/projectFile";
import { captureDownloads, chromeDesign, clearToasts, inAct, listenOnWindow, renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { copyPageAsImage, makeCopy, moveToTrash, printDesign, requestSave, safeFileName, saveNow, saveProjectFile, startNewDesign, waitForSaved } from "./designActions";

// Keep the real library and exporter, but let a test make one call fail.
vi.mock("@/core/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library")>();
  return {
    ...actual,
    saveDesign: vi.fn(actual.saveDesign),
    duplicateDesign: vi.fn(actual.duplicateDesign),
    restoreFromTrash: vi.fn(actual.restoreFromTrash),
  };
});
vi.mock("@/export/projectFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/export/projectFile")>();
  return { ...actual, exportProjectFile: vi.fn(actual.exportProjectFile) };
});

const actions = () => useEditor.getState().actions;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  vi.mocked(saveDesign).mockClear();
  vi.mocked(duplicateDesign).mockClear();
  vi.mocked(restoreFromTrash).mockClear();
  vi.mocked(exportProjectFile).mockClear();
});

afterEach(async () => {
  vi.useRealTimers(); // the harness does it too, but only after this hook: clearToasts needs a real clock
  resetEditor();
  await clearToasts();
});

/** A design that is open in the editor and in the library, with the toast and confirm hosts mounted. */
const open = (title: string) => renderChrome(<div />, chromeDesign(title));

describe("requestSave", () => {
  it("asks the autosave service to save now", async () => {
    await open("Request save");
    const events = listenOnWindow("craftly:save-now");
    requestSave();
    expect(events).toHaveLength(1);
  });
});

describe("waitForSaved", () => {
  beforeEach(() => open("Wait for save"));

  it("resolves at once when there is nothing left to save", async () => {
    expect(await waitForSaved()).toBe("saved");
  });

  it("resolves at once with an error when the last save failed", async () => {
    act(() => actions().setSaveState("error"));
    expect(await waitForSaved()).toBe("error");
  });

  it("waits for an unsaved design to be written", async () => {
    act(() => actions().setSaveState("unsaved"));
    const result = waitForSaved();
    act(() => actions().setSaveState("saving"));
    act(() => actions().setSaveState("saved"));
    expect(await result).toBe("saved");
  });

  it("reports a save that fails while it waits", async () => {
    act(() => actions().setSaveState("saving"));
    const result = waitForSaved();
    act(() => actions().setSaveState("error"));
    expect(await result).toBe("error");
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    act(() => actions().setSaveState("unsaved"));
    const result = waitForSaved(1500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toBe("timeout");
  });
});

describe("saveNow", () => {
  it("writes the edits to the library and says so", async () => {
    const { design } = await open("Save now");
    const uninstall = installAutosave();
    try {
      act(() => actions().setTitle("Saved right now"));
      await inAct(() => saveNow());
      expect((await getDesign(design.id))?.title).toBe("Saved right now");
      expect(await screen.findByText("All changes saved")).toBeTruthy();
    } finally {
      uninstall();
    }
  });

  it("says nothing when the save takes too long to wait for", async () => {
    await open("Save is slow");
    act(() => actions().setSaveState("unsaved"));
    vi.useFakeTimers();
    const done = saveNow();
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    vi.useRealTimers();
    expect(screen.queryByText("All changes saved")).toBeNull();
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });

  it("tells the person when the design could not be saved", async () => {
    await open("Save fails");
    act(() => actions().setSaveState("error"));
    await inAct(() => saveNow());
    expect(await screen.findByText(/Couldn't save - storage is full or blocked/)).toBeTruthy();
  });
});

describe("startNewDesign", () => {
  it("leaves a note for the home page and goes there", () => {
    window.location.hash = "#/design/abc";
    startNewDesign();
    expect(sessionStorage.getItem("craftly:open-create")).toBe("1");
    expect(window.location.hash).toBe("#/");
  });

  it("still goes home when the browser blocks session storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.location.hash = "#/design/abc";
    startNewDesign();
    expect(window.location.hash).toBe("#/");
  });
});

describe("makeCopy", () => {
  it("stores the latest edits, copies the design and opens the copy", async () => {
    const { design } = await open("Original");
    act(() => actions().setTitle("Original, edited"));
    await inAct(() => makeCopy());
    const all = await listDesigns();
    expect(all).toHaveLength(2);
    const copy = all.find((d) => d.id !== design.id)!;
    expect(copy.title).toBe("Original, edited (copy)");
    expect(window.location.hash).toBe(`#/design/${encodeURIComponent(copy.id)}`);
    expect(await screen.findByText("Copy created")).toBeTruthy();
  });

  it("makes one copy when asked twice at once", async () => {
    await open("Twice");
    await inAct(() => Promise.all([makeCopy(), makeCopy()]));
    expect(await listDesigns()).toHaveLength(2);
  });

  it("explains when the copy could not be made, and can be tried again", async () => {
    await open("Copy fails");
    window.location.hash = "#/design/stay";
    vi.mocked(duplicateDesign).mockResolvedValueOnce(null);
    await inAct(() => makeCopy());
    expect(await screen.findByText(/Couldn't make a copy/)).toBeTruthy();
    expect(window.location.hash).toBe("#/design/stay");
    expect(await listDesigns()).toHaveLength(1);
    await inAct(() => makeCopy());
    expect(await listDesigns()).toHaveLength(2);
  });

  it("does nothing without an open design", async () => {
    await inAct(() => makeCopy());
    expect(vi.mocked(duplicateDesign)).not.toHaveBeenCalled();
  });
});

describe("moveToTrash", () => {
  it("asks first and leaves the design alone when the person says no", async () => {
    const { design } = await open("Keep me");
    window.location.hash = "#/design/stay";
    const done = moveToTrash();
    const dialog = await screen.findByRole("dialog", { name: "Move to trash?" });
    expect(dialog.textContent).toContain('"Keep me" will move to the trash.');
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Cancel" }));
    await done;
    expect(useEditor.getState().design?.trashedAt).toBeNull();
    expect((await getDesign(design.id))?.trashedAt).toBeNull();
    expect(window.location.hash).toBe("#/design/stay");
  });

  it("trashes the design, leaves the editor and offers to undo", async () => {
    const { design } = await open("Trash me");
    const done = moveToTrash();
    await screen.findByRole("dialog", { name: "Move to trash?" });
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Move to trash" }));
    await done;
    expect(useEditor.getState().design?.trashedAt).toEqual(expect.any(Number));
    expect((await getDesign(design.id))?.trashedAt).toEqual(expect.any(Number));
    expect(window.location.hash).toBe("#/");
    await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: "Undo" }));
    expect(vi.mocked(restoreFromTrash)).toHaveBeenCalledWith(design.id);
    await waitFor(async () => expect((await getDesign(design.id))?.trashedAt).toBeNull());
  });

  it("still leaves when the trashed state cannot be stored right away (autosave tries again)", async () => {
    await open("Trash despite");
    vi.mocked(saveDesign).mockRejectedValueOnce(new Error("quota"));
    const done = moveToTrash();
    await screen.findByRole("dialog", { name: "Move to trash?" });
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Move to trash" }));
    await done;
    expect(window.location.hash).toBe("#/");
    expect(await screen.findByText("Moved to trash")).toBeTruthy();
  });

  it("does nothing without an open design", async () => {
    await moveToTrash();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("safeFileName", () => {
  it("removes characters a file name cannot have and tidies the spaces", () => {
    expect(safeFileName('Q3: "plan" / draft?*')).toBe("Q3 plan draft");
    expect(safeFileName("  a\\b|c<d>e\u0001f  ")).toBe("a b c d e f");
  });

  it("falls back to a name when nothing is left", () => {
    expect(safeFileName("???")).toBe("design");
    expect(safeFileName("", "untitled")).toBe("untitled");
  });

  it("keeps ordinary titles as they are", () => {
    expect(safeFileName("Summer sale 2026")).toBe("Summer sale 2026");
  });
});

describe("saveProjectFile", () => {
  it("downloads the design as a .craftly file named after its title", async () => {
    await open('Summer: "sale"');
    const names = captureDownloads();
    await inAct(() => saveProjectFile());
    expect(names).toEqual(["Summer sale.craftly"]);
    expect(await screen.findByText("Project file saved to your downloads")).toBeTruthy();
  });

  it("explains when the project file could not be created", async () => {
    await open("Export fails");
    const names = captureDownloads();
    vi.mocked(exportProjectFile).mockRejectedValueOnce(new Error("no space"));
    await inAct(() => saveProjectFile());
    expect(names).toEqual([]);
    expect(await screen.findByText(/Couldn't create the project file/)).toBeTruthy();
  });

  it("does nothing without an open design", async () => {
    await inAct(() => saveProjectFile());
    expect(vi.mocked(exportProjectFile)).not.toHaveBeenCalled();
  });
});

describe("copyPageAsImage", () => {
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }
  const writeSpy = () =>
    vi
      .spyOn(navigator.clipboard, "write")
      .mockImplementation(async (items) => void (await Promise.all(items.flatMap((item) => Object.values((item as unknown as FakeClipboardItem).items)))));

  it("says so when the browser cannot put images on the clipboard", async () => {
    await open("No clipboard images");
    await inAct(() => copyPageAsImage());
    expect(await screen.findByText("This browser can't copy images to the clipboard. Use Download instead.")).toBeTruthy();
  });

  it("copies the current page as a PNG", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = writeSpy();
    await open("Copy page");
    act(() => actions().setActivePage(useEditor.getState().design!.pages[1].id));
    await inAct(() => copyPageAsImage());
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    const blob = await item.items["image/png"];
    expect(blob.type).toBe("image/png");
    expect(await screen.findByText("Page 2 copied as an image")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("explains when the browser refuses the clipboard", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.spyOn(navigator.clipboard, "write").mockRejectedValue(new Error("denied"));
    await open("Clipboard denied");
    await inAct(() => copyPageAsImage());
    expect(await screen.findByText(/Couldn't copy the image/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("explains when the page could not be turned into an image", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    writeSpy();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) => callback(null));
    await open("Encoding fails");
    await inAct(() => copyPageAsImage());
    expect(await screen.findByText(/Couldn't copy the image/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("does nothing without an open design", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = writeSpy();
    await inAct(() => copyPageAsImage());
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("printDesign", () => {
  /** Lets a test stand in for the print dialog of the hidden frame: both calls are counted and nothing is "not implemented". */
  function stubFrameWindow() {
    const print = vi.fn();
    const focus = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!.get!;
    vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockImplementation(function (this: HTMLIFrameElement) {
      const win = original.call(this) as (Window & typeof globalThis) | null;
      if (win) {
        win.print = print;
        win.focus = focus;
      }
      return win;
    });
    return { print, focus };
  }
  const frame = () => document.querySelector("iframe");

  it("renders every page, opens the print dialog on a hidden frame and cleans up afterwards", async () => {
    const urls = vi.spyOn(URL, "createObjectURL");
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const { print } = stubFrameWindow();
    await open("Print <me>");
    const done = printDesign();
    expect(await screen.findByText("Preparing pages for printing...")).toBeTruthy();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const hidden = frame()!;
    expect(hidden.getAttribute("aria-hidden")).toBe("true");
    expect(hidden.tabIndex).toBe(-1);
    // one image per page, in the page order, on a landscape sheet, with the title escaped
    expect(urls).toHaveBeenCalledTimes(3);
    expect(hidden.srcdoc.match(/<img /g)).toHaveLength(3);
    expect(hidden.srcdoc).toContain("@page{size:landscape;margin:0}");
    expect(hidden.srcdoc).toContain("<title>Print &lt;me&gt;</title>");
    await waitFor(() => expect(screen.queryByText("Preparing pages for printing...")).toBeNull());
    // the person closes the print dialog
    (hidden.contentWindow as Window).dispatchEvent(new Event("afterprint"));
    await done;
    expect(frame()).toBeNull();
    expect(revoked).toHaveBeenCalledTimes(3);
  });

  it("prints a tall design on a portrait sheet", async () => {
    stubFrameWindow();
    const design = chromeDesign("Portrait");
    design.width = 800;
    design.height = 1200;
    await renderChrome(<div />, design);
    const done = printDesign();
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(frame()!.srcdoc).toContain("@page{size:portrait;margin:0}");
    (frame()!.contentWindow as Window).dispatchEvent(new Event("afterprint"));
    await done;
  });

  it("prints only once at a time", async () => {
    const { print } = stubFrameWindow();
    await open("Once");
    const first = printDesign();
    const second = printDesign();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    (frame()!.contentWindow as Window).dispatchEvent(new Event("afterprint"));
    await Promise.all([first, second]);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("explains when a page cannot be turned into an image, and can be tried again", async () => {
    await open("Print fails");
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) => callback(null));
    await inAct(() => printDesign());
    expect(await screen.findByText(/Couldn't prepare the pages for printing/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Preparing pages for printing...")).toBeNull());
    expect(frame()).toBeNull();
    toBlob.mockRestore();
    stubFrameWindow();
    const again = printDesign();
    await waitFor(() => expect(frame()).not.toBeNull());
    (frame()!.contentWindow as Window).dispatchEvent(new Event("afterprint"));
    await again;
  });

  it("gives up cleanly when the frame has no window", async () => {
    vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(null);
    await open("No window");
    await inAct(() => printDesign());
    expect(frame()).toBeNull();
  });

  it("prints even when the pictures cannot be decoded ahead of time", async () => {
    const { print } = stubFrameWindow();
    const images = [{ decode: () => Promise.reject(new Error("cannot decode")) }, { decode: undefined }];
    vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockReturnValue({ images } as unknown as Document);
    await open("Undecodable");
    const done = printDesign();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    (frame()!.contentWindow as Window).dispatchEvent(new Event("afterprint"));
    await done;
  });

  it("prints when the frame has no document to look at", async () => {
    const { print } = stubFrameWindow();
    vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockReturnValue(null);
    await open("No document");
    const done = printDesign();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    (frame()!.contentWindow as Window).dispatchEvent(new Event("afterprint"));
    await done;
  });

  it("does nothing without an open design", async () => {
    await inAct(() => printDesign());
    expect(frame()).toBeNull();
    expect(screen.queryByText("Preparing pages for printing...")).toBeNull();
  });
});

/**
 * The autosave service: it writes the open design to IndexedDB shortly after every change, keeps the dashboard
 * thumbnail fresh and records version snapshots. The library and the page painter are replaced by spies so each
 * write can be observed (and made slow or failing); time is faked so the 700 ms debounce is exact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { saveDesign, saveThumbnail, saveVersion } from "@/core/library";
import { clearProblems, listProblems } from "@/core/problems";
import { getActions, useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { renderPageToCanvas } from "@/render/renderPage";
import { installAutosave } from "./autosave";

vi.mock("@/core/library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/library")>()),
  saveDesign: vi.fn(async () => "committed"),
  saveThumbnail: vi.fn(async () => undefined),
  saveVersion: vi.fn(async () => undefined),
}));

vi.mock("@/render/renderPage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/render/renderPage")>()),
  renderPageToCanvas: vi.fn(async () => document.createElement("canvas")),
}));

const state = () => useEditor.getState();
const saves = () => vi.mocked(saveDesign).mock.calls;
const edit = (title: string) => getActions().setTitle(title);
const THUMB = "data:image/jpeg;base64,AAAA";

function open(): Design {
  const design = createDesign({ title: "Autosave", width: 800, height: 600, pages: [createPage({ elements: [createShape("rect", { x: 10, y: 10 })] })] });
  getActions().openDesign(design);
  return design;
}

/** A save that stays in flight until the test lets it finish. */
function slowSave() {
  let finish: () => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  vi.mocked(saveDesign).mockImplementationOnce(
    () =>
      new Promise<string>((resolve, reject) => {
        finish = () => resolve("committed");
        fail = reject;
      }),
  );
  return { finish: () => finish(), fail: (e: Error) => fail(e) };
}

let stop: () => void;

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState(), true);
  clearProblems();
  vi.mocked(saveDesign).mockClear();
  vi.mocked(saveThumbnail).mockClear();
  vi.mocked(saveVersion).mockClear();
  vi.mocked(renderPageToCanvas).mockClear();
  vi.useFakeTimers();
  stop = () => undefined;
});

afterEach(() => {
  stop();
});

describe("saving after a change", () => {
  it("writes the design 700 ms after an edit, with a thumbnail, and reports saving then saved", async () => {
    open();
    stop = installAutosave();
    const seen: string[] = [];
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.saveState !== prev.saveState) seen.push(s.saveState);
    });
    edit("First");
    expect(state().saveState).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(699);
    expect(saves()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves()).toHaveLength(1);
    const [design] = saves()[0];
    expect(design.title).toBe("First");
    expect(saveThumbnail).toHaveBeenCalledWith(design.id, "committed", THUMB);
    expect(seen).toEqual(["unsaved", "saving", "saved"]);
    expect(state().lastSavedAt).toBeGreaterThan(0);
    unsubscribe();
  });

  it("waits until the edits stop, then saves once with the latest version", async () => {
    open();
    stop = installAutosave();
    edit("A");
    await vi.advanceTimersByTimeAsync(500);
    edit("B");
    await vi.advanceTimersByTimeAsync(500);
    expect(saves()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(saves()).toHaveLength(1);
    expect(saves()[0][0].title).toBe("B");
  });

  it("does not save when a design is merely opened", async () => {
    stop = installAutosave();
    open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves()).toHaveLength(0);
    expect(state().saveState).toBe("saved");
  });

  it("makes a new thumbnail only every four seconds", async () => {
    open();
    stop = installAutosave();
    edit("One");
    await vi.advanceTimersByTimeAsync(700);
    edit("Two");
    await vi.advanceTimersByTimeAsync(700);
    expect(saveThumbnail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    edit("Three");
    await vi.advanceTimersByTimeAsync(700);
    expect(saveThumbnail).toHaveBeenCalledTimes(2);
    expect(renderPageToCanvas).toHaveBeenCalledTimes(2);
  });

  it("commits the design while thumbnail rendering is still pending", async () => {
    open();
    stop = installAutosave();
    vi.mocked(renderPageToCanvas).mockImplementationOnce(() => new Promise(() => undefined));
    edit("Commit first");
    await vi.advanceTimersByTimeAsync(700);
    expect(saves()[0][0].title).toBe("Commit first");
    expect(state().saveState).toBe("saved");
    expect(saveThumbnail).not.toHaveBeenCalled();
  });

  it("still saves when the thumbnail cannot be drawn", async () => {
    open();
    stop = installAutosave();
    vi.mocked(renderPageToCanvas).mockRejectedValueOnce(new Error("no canvas"));
    edit("No thumb");
    await vi.advanceTimersByTimeAsync(700);
    expect(saves()).toHaveLength(1);
    expect(saves()[0][1]).toBeUndefined();
    expect(state().saveState).toBe("saved");
  });
});

describe("failures and overlapping saves", () => {
  it("reports an error when the write fails, and saves again after the next edit", async () => {
    open();
    stop = installAutosave();
    vi.mocked(saveDesign).mockRejectedValueOnce(new Error("quota exceeded"));
    edit("Fails");
    await vi.advanceTimersByTimeAsync(700);
    expect(state().saveState).toBe("error");
    expect(listProblems()[0]).toMatchObject({ kind: "save", message: "quota exceeded" }); // written down, for the report
    edit("Works");
    await vi.advanceTimersByTimeAsync(700);
    expect(saves()).toHaveLength(2);
    expect(state().saveState).toBe("saved");
  });

  it("leaves the design marked unsaved when it changed while the save was running, then saves the newer version", async () => {
    open();
    stop = installAutosave();
    const slow = slowSave();
    edit("Early");
    await vi.advanceTimersByTimeAsync(700);
    expect(state().saveState).toBe("saving");
    edit("Late");
    slow.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().saveState).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(700);
    expect(saves().map((c) => c[0].title)).toEqual(["Early", "Late"]);
    expect(state().saveState).toBe("saved");
  });

  it("runs a save requested during another one right after it finishes", async () => {
    open();
    stop = installAutosave();
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    edit("Queued");
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(1);
    slow.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves().map((c) => c[0].title)).toEqual(["Busy", "Queued"]);
    expect(state().saveState).toBe("saved");
  });

  it("still queues the next save after a write that failed", async () => {
    open();
    stop = installAutosave();
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    slow.fail(new Error("disk"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(2);
  });
});

describe("saving on demand", () => {
  it("saves at once when asked, and does not save a second time when the timer would have fired", async () => {
    open();
    stop = installAutosave();
    edit("Now");
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves()).toHaveLength(1);
  });

  it("does nothing when asked without an open design", async () => {
    stop = installAutosave();
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(0);
    expect(state().saveState).toBe("saved");
  });

  it("saves unsaved changes when the page is hidden or left", async () => {
    open();
    stop = installAutosave();
    edit("Hidden");
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(1);
    edit("Switched away");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves().map((c) => c[0].title)).toEqual(["Hidden", "Switched away"]);
  });

  it("does not write again when the page is hidden with nothing new to save", async () => {
    open();
    stop = installAutosave();
    edit("Once");
    await vi.advanceTimersByTimeAsync(700);
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(1);
  });
});

describe("version history", () => {
  it("records a snapshot at most every five minutes and only for a design that changed", async () => {
    open();
    stop = installAutosave();
    edit("Early");
    await vi.advanceTimersByTimeAsync(700);
    expect(saveVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    edit("After five minutes");
    await vi.advanceTimersByTimeAsync(700);
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveVersion).mock.calls[0][0].title).toBe("After five minutes");
    edit("Right after");
    await vi.advanceTimersByTimeAsync(700);
    expect(saveVersion).toHaveBeenCalledTimes(1);
  });

  it("does not snapshot a design that is still the one it started from", async () => {
    open();
    stop = installAutosave();
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(0);
    expect(saveVersion).not.toHaveBeenCalled();
  });
});

describe("uninstalling", () => {
  it("cancels the pending save and ignores every later change and event", async () => {
    open();
    const uninstall = installAutosave();
    edit("Pending");
    uninstall();
    await vi.advanceTimersByTimeAsync(2000);
    edit("Later");
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves()).toHaveLength(0);
  });

  it("still writes the newest edit when the editor is closed while an older save is running", async () => {
    const design = open();
    const autosave = installAutosave();
    stop = autosave;
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    edit("Newest");
    // what the editor does on its way out: ask for a save, stop the service, close the design
    void autosave.flush();
    autosave();
    getActions().closeDesign();
    expect(saves()).toHaveLength(1);
    slow.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves().map((c) => [c[0].id, c[0].title])).toEqual([
      [design.id, "Busy"],
      [design.id, "Newest"],
    ]);
    expect(state().design).toBeNull();
  });

  it("writes that last edit to its own design, and leaves a design opened in the meantime alone", async () => {
    const first = open();
    const autosave = installAutosave();
    stop = autosave;
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    edit("Newest");
    void autosave.flush();
    autosave();
    getActions().closeDesign();
    const second = open();
    slow.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(2);
    expect(saves()[1][0]).toMatchObject({ id: first.id, title: "Newest" });
    expect(state().design?.id).toBe(second.id);
    expect(state().saveState).toBe("saved");
  });

  it("writes that last edit after the older save failed, too", async () => {
    open();
    const autosave = installAutosave();
    stop = autosave;
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    edit("Newest");
    void autosave.flush();
    autosave();
    getActions().closeDesign();
    slow.fail(new Error("disk"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saves().map((c) => c[0].title)).toEqual(["Busy", "Newest"]);
  });

  it("writes nothing more when the save that is running already holds the newest state", async () => {
    open();
    const autosave = installAutosave();
    stop = autosave;
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    window.dispatchEvent(new CustomEvent("craftly:save-now")); // asked again, with nothing new
    autosave();
    getActions().closeDesign();
    slow.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(1);
  });

  it("writes nothing more when the design was closed before the service was stopped", async () => {
    open();
    const autosave = installAutosave();
    stop = autosave;
    const slow = slowSave();
    edit("Busy");
    await vi.advanceTimersByTimeAsync(700);
    edit("Newest");
    void autosave.flush();
    getActions().closeDesign();
    autosave();
    slow.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves()).toHaveLength(1);
  });

  it("keeps a failure of that last write quiet when the editor asked for it quietly, and writes it down otherwise", async () => {
    for (const report of [false, true]) {
      clearProblems();
      open();
      const autosave = installAutosave();
      const slow = slowSave();
      edit("Busy");
      await vi.advanceTimersByTimeAsync(700);
      edit("Newest");
      void autosave.flush(report);
      autosave();
      getActions().closeDesign();
      vi.mocked(saveDesign).mockRejectedValueOnce(new Error("quota exceeded"));
      slow.finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(saves().at(-1)?.[0].title).toBe("Newest");
      expect(listProblems().map((p) => p.message)).toEqual(report ? ["quota exceeded"] : []);
      expect(state().design).toBeNull();
    }
  });
});

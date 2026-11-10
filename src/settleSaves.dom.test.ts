import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { settleSaves } from "./settleSaves";

const SAVE_NOW = "craftly:save-now";

beforeEach(() => {
  useEditor.getState().actions.setSaveState("saved");
});

afterEach(() => {
  window.location.hash = "";
});

describe("settleSaves", () => {
  it("has nothing to write on the dashboard: it returns at once and asks for no save", async () => {
    window.location.hash = "#/";
    const asked = vi.fn();
    window.addEventListener(SAVE_NOW, asked);
    await settleSaves(1000);
    window.removeEventListener(SAVE_NOW, asked);
    expect(asked).not.toHaveBeenCalled();
  });

  it("asks the open editor to save, and waits until it has", async () => {
    window.location.hash = "#/design/d_1";
    useEditor.getState().actions.setSaveState("unsaved");
    let settled = false;
    const saveSoon = () => setTimeout(() => useEditor.getState().actions.setSaveState("saved"), 40);
    window.addEventListener(SAVE_NOW, saveSoon, { once: true });
    const done = settleSaves(2000).then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    await done;
    expect(useEditor.getState().saveState).toBe("saved");
  });

  it("gives up after the time it was given", async () => {
    window.location.hash = "#/design/d_1";
    useEditor.getState().actions.setSaveState("unsaved");
    const started = Date.now();
    await settleSaves(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(useEditor.getState().saveState).toBe("unsaved");
  });

  it("reports failure when the save machinery cannot be loaded", async () => {
    window.location.hash = "#/design/d_1";
    vi.resetModules();
    vi.doMock("@/core/saveNow", () => {
      throw new Error("chunk failed to load");
    });
    try {
      const { settleSaves: fresh } = await import("./settleSaves");
      await expect(fresh(50)).resolves.toBe("error");
    } finally {
      vi.doUnmock("@/core/saveNow");
    }
  });
});

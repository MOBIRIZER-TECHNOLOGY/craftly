import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { closeToolsPalette, isToolsOpen, openToolsPalette, previousPanelTab, toggleToolsPalette } from "./railState";

const tab = () => useEditor.getState().leftTab;

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState(), true);
});

describe("the Tools palette and the rail", () => {
  it("remembers the last side-panel tab that was open", () => {
    expect(previousPanelTab()).toBe("elements");
    useEditor.getState().actions.setLeftTab("brand");
    expect(previousPanelTab()).toBe("brand");
  });

  it("opens the palette without forgetting the tab behind it", () => {
    useEditor.getState().actions.setLeftTab("text");
    expect(isToolsOpen()).toBe(false);
    openToolsPalette();
    expect(tab()).toBe("tools");
    expect(isToolsOpen()).toBe(true);
    expect(previousPanelTab()).toBe("text");
  });

  it("returns to the earlier tab when the palette is closed", () => {
    useEditor.getState().actions.setLeftTab("uploads");
    openToolsPalette();
    closeToolsPalette();
    expect(tab()).toBe("uploads");
    expect(isToolsOpen()).toBe(false);
  });

  it("leaves everything as it is when the palette was not open", () => {
    useEditor.getState().actions.setLeftTab("projects");
    closeToolsPalette();
    expect(tab()).toBe("projects");
  });

  it("falls back to Elements when the editor starts with the palette open", async () => {
    // a fresh copy of both modules, with the store already on the Tools tab when the rail state is first read
    vi.resetModules();
    const store = await import("@/core/store");
    store.useEditor.setState({ leftTab: "tools" });
    const fresh = await import("./railState");
    expect(fresh.previousPanelTab()).toBe("elements");
    expect(fresh.isToolsOpen()).toBe(true);
    fresh.closeToolsPalette();
    expect(store.useEditor.getState().leftTab).toBe("elements");
  });

  it("toggles between the palette and the earlier tab", () => {
    useEditor.getState().actions.setLeftTab("apps");
    toggleToolsPalette();
    expect(tab()).toBe("tools");
    toggleToolsPalette();
    expect(tab()).toBe("apps");
  });
});

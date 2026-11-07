import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { mountPanels } from "@/test/tabsHarness";
import { RAIL_TABS } from "./LeftRail";

/* the rail does not care what a panel shows: light stand-ins keep the real catalogues out of this file */
const stubTab = vi.hoisted(() => (name: string) => async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, `${name} panel content`) };
});
vi.mock("./tabs/TemplatesTab", stubTab("Templates"));
vi.mock("./tabs/ElementsTab", stubTab("Elements"));
vi.mock("./tabs/TextTab", stubTab("Text"));
vi.mock("./tabs/BrandTab", stubTab("Brand"));
vi.mock("./tabs/UploadsTab", stubTab("Uploads"));
vi.mock("./tabs/ProjectsTab", stubTab("Projects"));
vi.mock("./tabs/AppsTab", stubTab("Apps"));

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
const tab = (name: string) => screen.getByRole("tab", { name });
const state = () => useEditor.getState();

beforeEach(() => resetEditor());

describe("<LeftRail>", () => {
  it("lists the tools top to bottom with the open tab selected", () => {
    mountPanels();
    expect(tabNames()).toEqual(["Templates", "Elements", "Text", "Brand", "Uploads", "Tools", "Projects", "Apps"]);
    expect(RAIL_TABS.map((t) => t.label)).toEqual(tabNames());
    expect(tab("Elements").getAttribute("aria-selected")).toBe("true");
    expect(tab("Elements").getAttribute("aria-controls")).toBe("cf-tabpanel-elements");
    expect(tab("Text").getAttribute("aria-selected")).toBe("false");
    expect(tab("Text").hasAttribute("aria-controls")).toBe(false);
    expect(tab("Tools").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("navigation", { name: "Editor tools" })).toBeTruthy();
  });

  it("opens the side panel of the tab that is clicked", async () => {
    const user = userEvent.setup();
    mountPanels();
    await user.click(tab("Text"));
    expect(state().leftTab).toBe("text");
    expect(tab("Text").getAttribute("aria-selected")).toBe("true");
    expect(tab("Elements").getAttribute("aria-selected")).toBe("false");
    expect(await screen.findByText("Text panel content")).toBeTruthy();
  });

  it("folds the panel away when the open tab is clicked again, and brings it back on the next click", async () => {
    const user = userEvent.setup();
    const { container } = mountPanels();
    const nav = container.querySelector(".cf-leftrail");
    expect(nav?.classList.contains("is-flush")).toBe(false);

    await user.click(tab("Elements"));
    expect(state().panelOpen).toBe(false);
    expect(state().leftTab).toBe("elements");
    expect(tab("Elements").getAttribute("aria-selected")).toBe("false");
    expect(nav?.classList.contains("is-flush")).toBe(true);

    await user.click(tab("Elements"));
    expect(state().panelOpen).toBe(true);
    expect(tab("Elements").getAttribute("aria-selected")).toBe("true");
    expect(nav?.classList.contains("is-flush")).toBe(false);
  });

  it("opens a different tab straight away while the panel is folded", async () => {
    const user = userEvent.setup();
    mountPanels();
    await user.click(tab("Elements"));
    expect(state().panelOpen).toBe(false);
    await user.click(tab("Brand"));
    expect(state().leftTab).toBe("brand");
    expect(state().panelOpen).toBe(true);
  });

  it("goes back to the tab instead of folding when a context panel covers it", async () => {
    const user = userEvent.setup();
    mountPanels();
    state().actions.openContext({ kind: "effects" });
    expect(state().context).not.toBeNull();
    await user.click(tab("Elements"));
    expect(state().context).toBeNull();
    expect(state().panelOpen).toBe(true);
    expect(state().leftTab).toBe("elements");
  });

  it("only names a panel in aria-controls while that panel is on the page, not while a context panel has taken its place", async () => {
    mountPanels();
    const missing = () =>
      screen
        .getAllByRole("tab")
        .map((t) => t.getAttribute("aria-controls"))
        .filter((id): id is string => !!id && !document.getElementById(id));
    expect(await screen.findByRole("tabpanel")).toBeTruthy();
    expect(missing()).toEqual([]);
    expect(tab("Elements").getAttribute("aria-controls")).toBe("cf-tabpanel-elements");

    act(() => state().actions.openContext({ kind: "effects" }));
    expect(tab("Elements").getAttribute("aria-selected")).toBe("true");
    expect(tab("Elements").hasAttribute("aria-controls")).toBe(false);
    expect(missing()).toEqual([]);
  });

  it("toggles the floating tool palette from the Tools tab and returns to the previous tab", async () => {
    const user = userEvent.setup();
    mountPanels({ tab: "text" });
    expect(screen.queryByRole("toolbar", { name: "Tools" })).toBeNull();

    await user.click(tab("Tools"));
    expect(state().leftTab).toBe("tools");
    expect(tab("Tools").getAttribute("aria-selected")).toBe("true");
    expect(tab("Tools").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeTruthy();

    await user.click(tab("Tools"));
    expect(state().leftTab).toBe("text");
    expect(screen.queryByRole("toolbar", { name: "Tools" })).toBeNull();
  });

  it("closes the palette with its own close button", async () => {
    const user = userEvent.setup();
    mountPanels({ tab: "brand" });
    await user.click(tab("Tools"));
    await user.click(screen.getByRole("button", { name: "Close tools" }));
    expect(state().leftTab).toBe("brand");
    expect(tab("Brand").getAttribute("aria-selected")).toBe("true");
  });

  describe("keyboard", () => {
    it("moves focus down, up, to the first and to the last tab and wraps around", () => {
      mountPanels();
      tab("Elements").focus();
      fireEvent.keyDown(tab("Elements"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(tab("Text"));
      fireEvent.keyDown(tab("Text"), { key: "ArrowUp" });
      expect(document.activeElement).toBe(tab("Elements"));
      fireEvent.keyDown(tab("Elements"), { key: "End" });
      expect(document.activeElement).toBe(tab("Apps"));
      fireEvent.keyDown(tab("Apps"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(tab("Templates"));
      fireEvent.keyDown(tab("Templates"), { key: "ArrowUp" });
      expect(document.activeElement).toBe(tab("Apps"));
      fireEvent.keyDown(tab("Apps"), { key: "Home" });
      expect(document.activeElement).toBe(tab("Templates"));
    });

    it("leaves other keys alone", () => {
      mountPanels();
      tab("Elements").focus();
      const notHandled = fireEvent.keyDown(tab("Elements"), { key: "a" });
      expect(notHandled).toBe(true);
      expect(document.activeElement).toBe(tab("Elements"));
      const handled = fireEvent.keyDown(tab("Elements"), { key: "ArrowDown" });
      expect(handled).toBe(false);
    });

    it("keeps one tab in the tab order and follows the focus while it moves", () => {
      mountPanels();
      const tabIndexes = () =>
        screen
          .getAllByRole("tab")
          .filter((t) => t.getAttribute("tabindex") === "0")
          .map((t) => t.textContent);
      expect(tabIndexes()).toEqual(["Elements"]);
      act(() => tab("Brand").focus());
      expect(tabIndexes()).toEqual(["Brand"]);
      act(() => tab("Brand").blur());
      expect(tabIndexes()).toEqual(["Elements"]);
    });

    it("activates the focused tab with Enter", async () => {
      const user = userEvent.setup();
      mountPanels();
      tab("Uploads").focus();
      await user.keyboard("{Enter}");
      expect(state().leftTab).toBe("uploads");
    });
  });

  it("hovering a tab does not switch to it", async () => {
    const user = userEvent.setup();
    mountPanels();
    await user.hover(tab("Projects"));
    expect(state().leftTab).toBe("elements");
  });
});

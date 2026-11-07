import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { mountPanels } from "@/test/tabsHarness";
import { preloadTab } from "./SidePanel";

/*
 * Light stand-ins for the tabs and the context panels: this file is about the frame around them.
 * A mock factory runs when its module is first imported, and a module that loaded is kept for the rest of the file, so
 * `loaded` tells which chunks were requested - but only the first time. That is why the tests of "preloading" come first
 * and each one watches a tab that no other test has opened yet. A tab in `fail` throws while loading (until removed).
 */
const control = vi.hoisted(() => ({
  loaded: [] as string[],
  fail: new Set<string>(),
  gate: null as Promise<void> | null,
}));

vi.mock("./tabs/TemplatesTab", async () => {
  control.loaded.push("templates");
  if (control.fail.has("templates")) throw new Error("the chunk could not be fetched");
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Templates panel content") };
});
vi.mock("./tabs/ElementsTab", async () => {
  control.loaded.push("elements");
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Elements panel content") };
});
vi.mock("./tabs/TextTab", async () => {
  control.loaded.push("text");
  await control.gate;
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Text panel content") };
});
vi.mock("./tabs/BrandTab", async () => {
  control.loaded.push("brand");
  if (control.fail.has("brand")) throw new Error("the chunk could not be fetched");
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Brand panel content") };
});
vi.mock("./tabs/UploadsTab", async () => {
  control.loaded.push("uploads");
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Uploads panel content") };
});
vi.mock("./tabs/ProjectsTab", async () => {
  control.loaded.push("projects");
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Projects panel content") };
});
vi.mock("./tabs/AppsTab", async () => {
  control.loaded.push("apps");
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Apps panel content") };
});
vi.mock("./context", async () => {
  const { createElement } = await import("react");
  return { ContextPanel: ({ state }: { state: { kind: string } }) => createElement("p", null, `${state.kind} context content`) };
});

const state = () => useEditor.getState();
const panel = () => document.getElementById("cf-sidepanel") as HTMLElement;

beforeEach(() => {
  resetEditor();
  control.fail.clear();
  control.gate = null;
});

describe("preloading (first: each test watches a tab nobody has opened yet)", () => {
  it("warms up the default tab 800 ms after the editor opens", async () => {
    vi.useFakeTimers();
    expect(control.loaded).toEqual([]);
    mountPanels({ tab: "projects" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(700)));
    expect(control.loaded).not.toContain("elements");
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(control.loaded).toContain("elements");
    expect(screen.queryByText("Elements panel content")).toBeNull();
  });

  it("stops the warm-up timer when the panel goes away before it fires", () => {
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    const view = mountPanels({ tab: "projects" });
    expect(vi.getTimerCount()).toBeGreaterThan(before);
    view.unmount();
    expect(vi.getTimerCount()).toBe(before);
  });

  it("uses the browser's idle time for the warm-up when there is any, instead of a timer", () => {
    const idle = vi.fn(() => 7);
    (window as unknown as { requestIdleCallback: typeof idle }).requestIdleCallback = idle;
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const before = vi.getTimerCount();
      const view = mountPanels({ tab: "projects" });
      expect(idle).toHaveBeenCalledTimes(1);
      // the only timers left are the ones of the panel's own animations, not an 800 ms warm-up
      view.unmount();
      expect(vi.getTimerCount()).toBe(before);
      // when the browser gets around to it, the work is just a chunk request: nothing shows up
      const run = idle.mock.calls[0] as unknown as [() => void];
      expect(() => run[0]()).not.toThrow();
    } finally {
      delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    }
  });

  it("starts fetching a tab's chunk without showing it", async () => {
    mountPanels({ tab: "projects" });
    await screen.findByText("Projects panel content");
    expect(control.loaded).not.toContain("apps");
    preloadTab("apps");
    await waitFor(() => expect(control.loaded).toContain("apps"));
    expect(screen.queryByText("Apps panel content")).toBeNull();
  });

  it("ignores the Tools tab, which has no chunk", () => {
    const before = [...control.loaded];
    preloadTab("tools");
    expect(control.loaded).toEqual(before);
  });
});

describe("<SidePanel>", () => {
  it("shows the open tab in a labelled panel", async () => {
    mountPanels({ tab: "uploads" });
    expect(await screen.findByText("Uploads panel content")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Uploads panel" })).toBe(panel());
    const body = screen.getByRole("tabpanel");
    expect(body.id).toBe("cf-tabpanel-uploads");
    expect(body.getAttribute("aria-labelledby")).toBe("cf-tab-uploads");
    expect(panel().classList.contains("is-open")).toBe(true);
    expect(panel().hasAttribute("data-collapsed")).toBe(false);
  });

  it("starts its content with a heading that names the panel, so the headings run h1, h2, h3 down the page", async () => {
    mountPanels({ tab: "uploads" });
    await screen.findByText("Uploads panel content");
    const heading = screen.getByRole("heading", { level: 2, name: "Uploads" });
    expect(panel().contains(heading)).toBe(true);
    expect(screen.getByRole("tabpanel").contains(heading)).toBe(true);
  });

  it("swaps the tab's content when another tab is chosen", async () => {
    const user = userEvent.setup();
    mountPanels({ tab: "uploads" });
    await screen.findByText("Uploads panel content");
    await user.click(screen.getByRole("tab", { name: "Apps" }));
    expect(await screen.findByText("Apps panel content")).toBeTruthy();
    expect(screen.queryByText("Uploads panel content")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Apps panel" })).toBeTruthy();
  });

  it("holds a skeleton in place until the tab's chunk has loaded", async () => {
    let release!: () => void;
    control.gate = new Promise<void>((resolve) => (release = resolve));
    mountPanels({ tab: "text" });
    // a search field and nine tiles are drawn while the chunk is on its way
    await waitFor(() => expect(panel().querySelectorAll(".cf-skeleton").length).toBe(11));
    expect(screen.queryByText("Text panel content")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText("Text panel content")).toBeTruthy();
    expect(panel().querySelectorAll(".cf-skeleton").length).toBe(0);
  });

  describe("the fold handle", () => {
    it("hides and shows the panel", async () => {
      const user = userEvent.setup();
      mountPanels({ tab: "projects" });
      await screen.findByText("Projects panel content");

      await user.click(screen.getByRole("button", { name: "Hide panel" }));
      expect(state().panelOpen).toBe(false);
      expect(panel().hasAttribute("data-collapsed")).toBe(true);
      expect(panel().classList.contains("is-open")).toBe(false);
      const show = screen.getByRole("button", { name: "Show panel" });
      expect(show.getAttribute("aria-expanded")).toBe("false");
      expect(show.getAttribute("aria-controls")).toBe("cf-sidepanel");

      await user.click(show);
      expect(state().panelOpen).toBe(true);
      expect(screen.getByRole("button", { name: "Hide panel" }).getAttribute("aria-expanded")).toBe("true");
    });

    it("keeps the content around for the closing animation, then removes it", async () => {
      const user = userEvent.setup();
      mountPanels({ tab: "projects" });
      await screen.findByText("Projects panel content");
      await user.click(screen.getByRole("button", { name: "Hide panel" }));
      expect(screen.queryByText("Projects panel content")).not.toBeNull();
      await waitFor(() => expect(screen.queryByText("Projects panel content")).toBeNull());
      await user.click(screen.getByRole("button", { name: "Show panel" }));
      expect(await screen.findByText("Projects panel content")).toBeTruthy();
    });
  });

  it("has no panel of its own for the Tools tab", async () => {
    const user = userEvent.setup();
    mountPanels({ tab: "projects" });
    await screen.findByText("Projects panel content");
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    expect(panel().hasAttribute("data-collapsed")).toBe(true);
    expect(screen.queryByRole("button", { name: /panel$/ })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Tools panel" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Projects panel content")).toBeNull());
  });

  describe("context panels", () => {
    it("shows the context panel in place of the tab and the tab again when it closes", async () => {
      mountPanels({ tab: "uploads" });
      await screen.findByText("Uploads panel content");
      act(() => state().actions.openContext({ kind: "effects" }));
      expect(await screen.findByText("effects context content")).toBeTruthy();
      expect(screen.getByRole("complementary", { name: "Options panel" })).toBeTruthy();
      expect(screen.queryByText("Uploads panel content")).toBeNull();
      // a context panel is not a tab panel
      expect(screen.queryByRole("tabpanel")).toBeNull();

      act(() => state().actions.closeContext());
      expect(await screen.findByText("Uploads panel content")).toBeTruthy();
      expect(screen.getByRole("complementary", { name: "Uploads panel" })).toBeTruthy();
    });

    it("opens even while the Tools palette is the active tab", async () => {
      mountPanels({ tab: "tools" });
      expect(panel().hasAttribute("data-collapsed")).toBe(true);
      act(() => state().actions.openContext({ kind: "position", tab: "arrange" }));
      expect(await screen.findByText("position context content")).toBeTruthy();
      expect(panel().hasAttribute("data-collapsed")).toBe(false);
      expect(screen.getByRole("button", { name: "Hide panel" })).toBeTruthy();
    });
  });

  describe("a tab that cannot load", () => {
    it("offers to try again and shows the tab once the chunk loads", async () => {
      const user = userEvent.setup();
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      control.fail.add("brand");
      mountPanels({ tab: "brand" });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("The Brand panel could not load");
      expect(errors.mock.calls.some((call) => String(call[0]).includes("The Brand panel failed:"))).toBe(true);
      // the rest of the editor chrome is still there
      expect(screen.getByRole("tab", { name: "Elements" })).toBeTruthy();

      control.fail.delete("brand");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("Brand panel content")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("clears the message when another tab is opened", async () => {
      const user = userEvent.setup();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      control.fail.add("templates");
      mountPanels({ tab: "templates" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("tab", { name: "Apps" }));
      expect(await screen.findByText("Apps panel content")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});

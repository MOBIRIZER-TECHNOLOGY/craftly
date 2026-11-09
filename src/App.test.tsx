import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import * as dashboardData from "@/dashboard/data";
import { clearLibrary, resetEditor, sampleDesign, stubLayout } from "@/test/helpers";
import { goTo, mountApp } from "@/test/dashuiUtils";
import { saveDesign } from "@/core/library";
import { confirm, openContextMenu, closeContextMenu, toast } from "@/ui";

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

afterEach(() => {
  resetEditor();
  act(() => {
    closeContextMenu();
    toast.clear();
  });
});

describe("<App>", () => {
  it("shows a spinner while the first screen loads, then the dashboard", async () => {
    const { container } = await mountApp("#/trash");
    expect(container.querySelector(".cf-spinner")).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 1, name: "Trash" })).toBeTruthy();
    expect(container.querySelector(".cf-spinner")).toBeNull();
  });

  it("shows the page of the route inside the dashboard", async () => {
    await mountApp("#/trash");
    expect(await screen.findByText("The trash is empty")).toBeTruthy();
    await goTo("#/brand");
    expect(await screen.findByRole("heading", { level: 1, name: "Brand kit" })).toBeTruthy();
    expect(screen.queryByText("The trash is empty")).toBeNull();
  });

  it("falls back to the home page for a route it does not know", async () => {
    await mountApp("#/nowhere");
    expect(await screen.findByRole("heading", { level: 1, name: "What will you design today?" })).toBeTruthy();
  });

  it("opens the editor on the design of a #/design/<id> route", async () => {
    const restore = stubLayout();
    const design = sampleDesign({ id: "app-route-1", title: "Routed design" });
    await saveDesign(design);
    await mountApp(`#/design/${design.id}`);
    await waitFor(() => expect(useEditor.getState().design?.id).toBe("app-route-1"), { timeout: 15_000 });
    expect(useEditor.getState().design?.title).toBe("Routed design");
    restore();
  });

  it("opens the page for a link to a shared design on a #/join/<token> route, and says when the link is not one of ours", async () => {
    await mountApp("#/join/not-a-link-we-made");
    expect(await screen.findByText(/not a link that Craftly made/, undefined, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText("This shared design could not be opened")).toBeTruthy();
  });

  it("goes from the editor back to the dashboard when the route changes", async () => {
    const restore = stubLayout();
    const design = sampleDesign({ id: "app-route-2", title: "Back and forth" });
    await saveDesign(design);
    await mountApp(`#/design/${design.id}`);
    await waitFor(() => expect(useEditor.getState().design?.id).toBe("app-route-2"), { timeout: 15_000 });
    await goTo("#/projects");
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" }, { timeout: 15_000 })).toBeTruthy();
    restore();
  });

  describe("global hosts", () => {
    it("shows toasts anywhere in the app", async () => {
      await mountApp("#/trash");
      await screen.findByText("The trash is empty");
      act(() => void toast.success("Saved everywhere"));
      expect(await screen.findByText("Saved everywhere")).toBeTruthy();
    });

    it("shows confirm dialogs anywhere in the app instead of the browser's own box", async () => {
      const native = vi.spyOn(window, "confirm").mockReturnValue(true);
      await mountApp("#/trash");
      await screen.findByText("The trash is empty");
      let answer!: Promise<boolean>;
      act(() => {
        answer = confirm({ title: "Really?", confirmLabel: "Yes, really" });
      });
      const button = await screen.findByRole("button", { name: "Yes, really" });
      act(() => button.click());
      await expect(answer).resolves.toBe(true);
      expect(native).not.toHaveBeenCalled();
    });

    it("shows context menus anywhere in the app", async () => {
      await mountApp("#/trash");
      await screen.findByText("The trash is empty");
      act(() => openContextMenu({ x: 10, y: 10, items: [{ id: "x", label: "Do the thing" }] }));
      expect(await screen.findByRole("menuitem", { name: "Do the thing" })).toBeTruthy();
    });
  });

  describe("crashes", () => {
    it("shows the recovery screen for a crashed page and recovers when the route changes", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const designs = vi.spyOn(dashboardData, "useDesigns").mockImplementation(() => {
        throw new Error("the library exploded");
      });
      await mountApp("#/trash");
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Something went wrong");
      expect(alert.textContent).toContain("the library exploded");
      designs.mockRestore();
      await goTo("#/projects");
      expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeTruthy();
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });
});

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFolder } from "@/core/library";
import { TEMPLATES } from "@/data/templates";
import { dismissOpenDialogs, emptyLibrary, goTo, mountApp, resetDashboardStores, seedDesign } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { OPEN_CREATE_KEY, closeCreateDialog } from "./createDialogState";
import { closeTemplatePreview, openTemplatePreview } from "./templatePreview";

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });
const navLink = (name: string) => within(screen.getAllByRole("navigation", { name: "Main" })[0]).getByRole("link", { name });

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeCreateDialog();
    closeTemplatePreview();
    toast.clear();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<Dashboard>", () => {
  describe("pages", () => {
    it.each([
      ["#/", "What will you design today?", "Home"],
      ["#/projects", "Projects", "Projects"],
      ["#/templates", "Start with a great template", "Templates"],
      ["#/brand", "Brand kit", "Brand"],
      ["#/trash", "Trash", "Trash"],
    ])("shows the page of %s", async (hash, title, nav) => {
      await mountApp(hash);
      expect(await heading(title)).toBeTruthy();
      expect(navLink(nav).getAttribute("aria-current")).toBe("page");
    });

    // the account screens are loaded when one is opened; each names the tab after itself
    it.each([
      ["#/signin", "Sign in", "Sign in"],
      ["#/signup", "Create account", "Create account"],
      ["#/reset", "Set a new password", "Set a new password"],
      ["#/reset/AAAAAAAAAAAAAAAAAAAAAA", "Set a new password", "Set a new password"],
      ["#/invite/not-a-code", "Join a team", "Join a team"],
      // a team's page asks a person who is not signed in to sign in first
      ["#/team/t_1", "Sign in", "Team members"],
    ])("loads the account screen of %s", async (hash, title, tab) => {
      await mountApp(hash);
      expect(await heading(title)).toBeTruthy();
      await waitFor(() => expect(document.title).toBe(tab));
    });

    it("shows the home page for a team route without a team", async () => {
      await mountApp("#/team");
      expect(await heading("What will you design today?")).toBeTruthy();
    });

    it("shows the home page for a route it does not know", async () => {
      await mountApp("#/nowhere");
      expect(await heading("What will you design today?")).toBeTruthy();
    });

    it("opens a folder on #/projects/<id>", async () => {
      const folder = await createFolder("Campaign");
      await seedDesign({ title: "Inside", folderId: folder.id });
      await mountApp(`#/projects/${folder.id}`);
      expect(await heading("Campaign")).toBeTruthy();
      expect(await screen.findByRole("link", { name: "Inside" })).toBeTruthy();
    });

    it("moves between the pages from the rail", async () => {
      const user = userEvent.setup();
      await mountApp("#/trash");
      await heading("Trash");
      await user.click(navLink("Projects"));
      expect(await heading("Projects")).toBeTruthy();
      await user.click(navLink("Brand"));
      expect(await heading("Brand kit")).toBeTruthy();
    });

    it("filters templates by category on #/templates/<category>", async () => {
      await mountApp("#/templates/social");
      expect(await heading("Start with a great template")).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Social media" }).getAttribute("aria-selected")).toBe("true");
      expect(TEMPLATES.some((template) => template.category === "social")).toBe(true);
    });
  });

  describe("the tab title", () => {
    it.each([
      ["#/", "Craftly - Design anything"],
      ["#/projects", "Projects - Craftly"],
      ["#/templates", "Templates - Craftly"],
      ["#/brand", "Brand kit - Craftly"],
      ["#/trash", "Trash - Craftly"],
      ["#/whatever", "Craftly - Design anything"],
    ])("is set for %s", async (hash, title) => {
      await mountApp(hash);
      await waitFor(() => expect(document.title).toBe(title));
    });

    it("follows the page as the route changes", async () => {
      await mountApp("#/trash");
      await waitFor(() => expect(document.title).toBe("Trash - Craftly"));
      await goTo("#/brand");
      await waitFor(() => expect(document.title).toBe("Brand kit - Craftly"));
    });

    it("gives the original title back when the dashboard goes away", async () => {
      document.title = "Original title";
      const view = await mountApp("#/trash");
      await waitFor(() => expect(document.title).toBe("Trash - Craftly"));
      view.unmount();
      expect(document.title).toBe("Original title");
    });
  });

  describe("the Create dialog", () => {
    it("opens on arrival when another screen asked for it", async () => {
      sessionStorage.setItem(OPEN_CREATE_KEY, "1");
      await mountApp("#/");
      expect(await screen.findByRole("dialog", { name: "Create a design" })).toBeTruthy();
      expect(sessionStorage.getItem(OPEN_CREATE_KEY)).toBeNull();
    });

    it("stays shut when nobody asked for it", async () => {
      await mountApp("#/trash");
      await heading("Trash");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes, with the template preview, when the user goes to another page", async () => {
      const user = userEvent.setup();
      await mountApp("#/trash");
      await heading("Trash");
      await user.click(within(screen.getAllByRole("navigation", { name: "Main" })[0]).getByRole("button", { name: "Create a design" }));
      expect(await screen.findByRole("dialog", { name: "Create a design" })).toBeTruthy();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(within(screen.getAllByRole("navigation", { name: "Main" })[0]).getByRole("button", { name: "Create a design" }));
      act(() => openTemplatePreview(TEMPLATES[0]));
      expect(await screen.findByRole("dialog", { name: `Template preview: ${TEMPLATES[0].name}` })).toBeTruthy();
      await goTo("#/brand");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("stays open while the route stays the same", async () => {
      const user = userEvent.setup();
      await mountApp("#/trash");
      await heading("Trash");
      await user.click(within(screen.getAllByRole("navigation", { name: "Main" })[0]).getByRole("button", { name: "Create a design" }));
      await screen.findByRole("dialog", { name: "Create a design" });
      await goTo("#/trash");
      expect(screen.getByRole("dialog", { name: "Create a design" })).toBeTruthy();
    });
  });

  describe("name dialogs", () => {
    it("serves the rename dialog that pages ask for", async () => {
      const user = userEvent.setup();
      await seedDesign({ title: "Rename me" });
      await mountApp("#/projects");
      await user.click(await screen.findByRole("button", { name: "More actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      expect(await screen.findByRole("dialog", { name: "Rename design" })).toBeTruthy();
    });
  });

  it("renders in a bare container without hosts", async () => {
    const { Dashboard } = await import("./Dashboard");
    window.location.hash = "#/trash";
    render(<Dashboard />);
    expect(await heading("Trash")).toBeTruthy();
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEditor, stubLayout } from "@/test/helpers";
import { mountPanels } from "@/test/tabsHarness";
import { useAppsNav } from "./apps/appKit";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  useAppsNav.setState({ app: null, query: "" });
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

const APPS = [
  ["qr", "QR code", "Make a scannable code for a link, Wi-Fi or text"],
  ["emoji", "Emoji", "Search and drop emoji onto your design"],
  ["lorem", "Lorem ipsum", "Placeholder text by the paragraph, sentence or word"],
  ["placeholder", "Placeholder image", "A coloured stand-in picture at any size"],
  ["palette", "Colour palette from image", "Pull the main colours out of a picture"],
  ["bulk", "Bulk create", "Make a page for every row of a spreadsheet"],
] as const;

async function openApps() {
  const user = userEvent.setup();
  mountPanels({ tab: "apps" });
  await screen.findByRole("searchbox", { name: "Search apps" });
  return user;
}

const appItems = () => screen.getAllByRole("button").filter((b) => APPS.some(([, name, description]) => b.getAttribute("aria-label") === `${name}. ${description}`));

describe("Apps tab", () => {
  it("lists the six built-in apps with what each one does", async () => {
    await openApps();
    expect(screen.getByRole("heading", { name: "Built into Craftly" })).toBeTruthy();
    expect(screen.getByText("Tools that run right here")).toBeTruthy();
    expect(appItems().map((b) => b.getAttribute("aria-label"))).toEqual(APPS.map(([, name, description]) => `${name}. ${description}`));
    for (const item of appItems()) expect(within(item).getByText("Works offline")).toBeTruthy();
  });

  it.each(APPS)("opens the %s app from its row and comes back with the arrow", async (id, name, description) => {
    const user = await openApps();
    await user.click(screen.getByRole("button", { name: `${name}. ${description}` }));
    expect(useAppsNav.getState().app).toBe(id);
    expect(await screen.findByRole("heading", { name })).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search apps" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back to apps" }));
    expect(await screen.findByRole("searchbox", { name: "Search apps" })).toBeTruthy();
    expect(useAppsNav.getState().app).toBeNull();
  });

  it("opens an app from the keyboard", async () => {
    const user = await openApps();
    appItems()[1].focus();
    await user.keyboard("{Enter}");
    expect(useAppsNav.getState().app).toBe("emoji");
  });

  it("keeps the open app while another tab is used", async () => {
    const user = await openApps();
    await user.click(appItems()[0]);
    await screen.findByRole("heading", { name: "QR code" });
    await user.click(screen.getByRole("tab", { name: "Projects" }));
    await screen.findByRole("searchbox", { name: "Search your content" });
    await user.click(screen.getByRole("tab", { name: "Apps" }));
    expect(await screen.findByRole("heading", { name: "QR code" })).toBeTruthy();
  });

  describe("searching", () => {
    it("finds apps by their name, description or keywords and counts them", async () => {
      const user = await openApps();
      await user.type(screen.getByRole("searchbox"), "wifi");
      await waitFor(() => expect(appItems()).toHaveLength(1));
      expect(appItems()[0].getAttribute("aria-label")).toContain("QR code");
      expect(screen.getByRole("heading", { name: "1 app" })).toBeTruthy();
      // the banner makes way for the results
      expect(screen.queryByText("Tools that run right here")).toBeNull();
    });

    it("counts several matches in the plural", async () => {
      const user = await openApps();
      await user.type(screen.getByRole("searchbox"), "image");
      await waitFor(() => expect(appItems().map((b) => b.getAttribute("aria-label")?.split(".")[0])).toEqual(["Placeholder image", "Colour palette from image"]));
      expect(screen.getByRole("heading", { name: "2 apps" })).toBeTruthy();
    });

    it("says when nothing matches", async () => {
      const user = await openApps();
      await user.type(screen.getByRole("searchbox"), "zzzz");
      expect(await screen.findByText("No apps found")).toBeTruthy();
      expect(screen.getByText('Nothing matches "zzzz". Try "qr", "emoji" or "palette".')).toBeTruthy();
      expect(screen.getByRole("heading", { name: "0 apps" })).toBeTruthy();
    });

    it("remembers the search while an app is open", async () => {
      const user = await openApps();
      await user.type(screen.getByRole("searchbox"), "emoji");
      await waitFor(() => expect(appItems()).toHaveLength(1));
      await user.click(appItems()[0]);
      await screen.findByRole("heading", { name: "Emoji" });
      await user.click(screen.getByRole("button", { name: "Back to apps" }));
      expect(((await screen.findByRole("searchbox", { name: "Search apps" })) as HTMLInputElement).value).toBe("emoji");
    });
  });
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEditor, stubLayout } from "@/test/helpers";
import { mountPanels, resetElementsNav } from "@/test/tabsHarness";
import { useElementsNav } from "./elements/nav";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  resetElementsNav();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

const CATEGORIES = [
  ["shapes", "Shapes", "Search shapes"],
  ["graphics", "Graphics", "Search graphics"],
  ["photos", "Photos", "Search photos"],
  ["frames", "Frames", "Search frames"],
  ["grids", "Grids", "Search grids"],
  ["charts", "Charts", "Search charts"],
  ["tables", "Tables", "Search tables"],
  ["lines", "Lines", "Search lines and arrows"],
  ["backgrounds", "Backgrounds", "Search backgrounds"],
] as const;

async function openOverview() {
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByText("Browse categories");
  return user;
}

describe("<ElementsTab> overview", () => {
  it("offers a search box and a tile for each kind of element", async () => {
    await openOverview();
    expect(screen.getByRole("searchbox", { name: "Search elements" })).toBeTruthy();
    for (const [, label] of CATEGORIES) {
      const tile = screen.getByRole("button", { name: `Browse ${label.toLowerCase()}` });
      expect(tile.textContent).toBe(label);
    }
    expect(screen.getAllByRole("button", { name: /^Browse / })).toHaveLength(9);
  });

  it.each(CATEGORIES)("opens the %s page from its tile and comes back with the arrow", async (page, label, placeholder) => {
    const user = await openOverview();
    await user.click(screen.getByRole("button", { name: `Browse ${label.toLowerCase()}` }));
    expect(await screen.findByRole("searchbox", { name: placeholder })).toBeTruthy();
    expect(screen.getByRole("heading", { name: label })).toBeTruthy();
    expect(useElementsNav.getState().page).toBe(page);
    expect(screen.queryByText("Browse categories")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back to all elements" }));
    expect(await screen.findByText("Browse categories")).toBeTruthy();
    expect(useElementsNav.getState().page).toBeNull();
  });

  it("clears a page's search when going back to the overview", async () => {
    const user = await openOverview();
    await user.click(screen.getByRole("button", { name: "Browse shapes" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search shapes" }), "heart");
    await user.click(screen.getByRole("button", { name: "Back to all elements" }));
    await screen.findByText("Browse categories");
    await user.click(screen.getByRole("button", { name: "Browse shapes" }));
    expect((await screen.findByRole("searchbox", { name: "Search shapes" })) as HTMLInputElement).toHaveProperty("value", "");
  });

  it("remembers the open page and its search while another tab is used", async () => {
    const user = await openOverview();
    await user.click(screen.getByRole("button", { name: "Browse frames" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search frames" }), "circle");
    await user.click(screen.getByRole("tab", { name: "Projects" }));
    await screen.findByRole("searchbox", { name: "Search your content" });
    await user.click(screen.getByRole("tab", { name: "Elements" }));
    const box = (await screen.findByRole("searchbox", { name: "Search frames" })) as HTMLInputElement;
    expect(box.value).toBe("circle");
    await waitFor(() => expect(screen.getByRole("button", { name: "Circle frame" })).toBeTruthy());
  });

  it("remembers what was typed in the overview search too", async () => {
    const user = await openOverview();
    await user.type(screen.getByRole("searchbox", { name: "Search elements" }), "star");
    await user.click(screen.getByRole("tab", { name: "Apps" }));
    await screen.findByRole("searchbox", { name: "Search apps" });
    await user.click(screen.getByRole("tab", { name: "Elements" }));
    expect(((await screen.findByRole("searchbox", { name: "Search elements" })) as HTMLInputElement).value).toBe("star");
  });
});

describe("the Elements page state", () => {
  it("opens a page with a query and optionally a graphics pane", () => {
    const nav = useElementsNav.getState();
    nav.open("graphics", "cat", "icons");
    expect(useElementsNav.getState()).toMatchObject({ page: "graphics", query: "cat", graphicsPane: "icons" });
    // a pane that is not given stays as it was
    nav.open("graphics", "dog");
    expect(useElementsNav.getState().graphicsPane).toBe("icons");
    nav.open("shapes");
    expect(useElementsNav.getState()).toMatchObject({ page: "shapes", query: "" });
  });

  it("goes back to the overview and forgets the page's query but not the overview's", () => {
    const nav = useElementsNav.getState();
    nav.setRootQuery("tree");
    nav.open("photos", "forest");
    nav.back();
    expect(useElementsNav.getState()).toMatchObject({ page: null, query: "", rootQuery: "tree" });
  });

  it("switches the graphics pane", () => {
    useElementsNav.getState().setGraphicsPane("icons");
    expect(useElementsNav.getState().graphicsPane).toBe("icons");
    useElementsNav.getState().setQuery("x");
    expect(useElementsNav.getState().query).toBe("x");
  });
});

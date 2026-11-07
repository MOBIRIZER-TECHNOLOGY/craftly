import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphicElement, ShapeElement } from "@/core/types";
import { searchGraphics } from "@/data/graphics";
import { PHOTOS } from "@/data/photos";
import { resetEditor, stubLayout } from "@/test/helpers";
import { lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";
import { matchPhoto } from "./PhotosPage";
import { useElementsNav } from "./nav";

/* The icon library is real, but a test can make it fail to load. */
const control = vi.hoisted(() => ({ failIcons: false }));
vi.mock("@/data/icons", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/data/icons")>();
  return { ...real, loadIconIndex: vi.fn(() => (control.failIcons ? Promise.reject(new Error("offline")) : real.loadIconIndex())) };
});

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  control.failIcons = false;
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

async function search(text: string) {
  resetElementsNav();
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  const box = await screen.findByRole("searchbox", { name: "Search elements" });
  await user.type(box, text);
  // the results follow what was typed 140 ms later
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 200))));
  return user;
}

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
/** The result cells of a group (its "See all" link is a button too). */
const cells = (title: string, selector: string) => Array.from(section(title).querySelectorAll<HTMLElement>(selector));
const sections = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("Elements > searching everything at once", () => {
  it("groups what matches into Shapes, Graphics, Photos and Icons", async () => {
    await search("heart");
    expect(await screen.findByRole("heading", { name: "Icons" })).toBeTruthy();
    expect(cells("Shapes", ".cf-cell--shape").map((b) => b.getAttribute("aria-label"))).toEqual(["Heart"]);
    expect(sections()).toContain("Graphics");
    expect(screen.queryByText("Browse categories")).toBeNull();
    expect(cells("Graphics", ".cf-cell--graphic")).toHaveLength(Math.min(6, searchGraphics("heart").length));
    // only the icons are more than a short row: just that group offers "See all"
    expect(within(section("Shapes")).queryByRole("button", { name: "See all" })).toBeNull();
    expect(within(section("Icons")).getByRole("button", { name: "See all" })).toBeTruthy();
  });

  it("finds the ellipse by the word 'oval' in the search over everything", async () => {
    await search("oval");
    await screen.findByRole("heading", { name: "Shapes" });
    expect(cells("Shapes", ".cf-cell--shape").map((b) => b.getAttribute("aria-label"))).toEqual(["Ellipse"]);
  });

  it("puts a found shape on the page when it is clicked", async () => {
    const user = await search("heart");
    const shapes = await waitFor(() => section("Shapes"));
    const before = pageElements().length;
    await user.click(within(shapes).getByRole("button", { name: "Heart" }));
    expect(pageElements()).toHaveLength(before + 1);
    expect((lastElement() as ShapeElement).shape).toBe("heart");
  });

  it("puts a found icon on the page", async () => {
    const user = await search("heart");
    await screen.findByRole("heading", { name: "Icons" });
    const before = pageElements().length;
    await waitFor(() => expect(section("Icons").querySelector(".cf-cell--icon svg")).toBeTruthy());
    await user.click(cells("Icons", ".cf-cell--icon")[0]);
    await waitFor(() => expect(pageElements()).toHaveLength(before + 1));
    expect((lastElement() as GraphicElement).source?.kind).toBe("icon");
  });

  it("limits each group and offers 'See all' with the same search", async () => {
    await search("a");
    await screen.findByRole("heading", { name: "Icons" });
    expect(sections()).toEqual(["Shapes", "Lines", "Graphics", "Photos", "Icons"]);
    expect(cells("Shapes", ".cf-cell--shape")).toHaveLength(8);
    expect(cells("Lines", ".cf-line-cell")).toHaveLength(4);
    expect(cells("Graphics", ".cf-cell--graphic")).toHaveLength(6);
    expect(cells("Photos", ".cf-cell--photo")).toHaveLength(4);
    expect(cells("Icons", ".cf-cell--icon")).toHaveLength(8);
    expect(screen.getAllByRole("button", { name: "See all" })).toHaveLength(5);
  });

  it("opens the full Shapes page for the search with 'See all'", async () => {
    const user = await search("a");
    await user.click(within(await waitFor(() => section("Shapes"))).getByRole("button", { name: "See all" }));
    expect(useElementsNav.getState().page).toBe("shapes");
    expect((await screen.findByRole("searchbox", { name: "Search shapes" })) as HTMLInputElement).toHaveProperty("value", "a");
  });

  it("opens the Lines page for the search with 'See all'", async () => {
    const user = await search("a");
    await user.click(within(await waitFor(() => section("Lines"))).getByRole("button", { name: "See all" }));
    expect(useElementsNav.getState().page).toBe("lines");
    expect(useElementsNav.getState().query).toBe("a");
  });

  it("opens the illustrations for the search with 'See all'", async () => {
    const user = await search("a");
    await user.click(within(await waitFor(() => section("Graphics"))).getByRole("button", { name: "See all" }));
    expect(useElementsNav.getState().page).toBe("graphics");
    expect(useElementsNav.getState().graphicsPane).toBe("illustrations");
    expect((await screen.findByRole("searchbox", { name: "Search graphics" })) as HTMLInputElement).toHaveProperty("value", "a");
  });

  it("opens the photos for the search with 'See all'", async () => {
    const user = await search("a");
    await user.click(within(await waitFor(() => section("Photos"))).getByRole("button", { name: "See all" }));
    expect(useElementsNav.getState().page).toBe("photos");
    expect((await screen.findByRole("searchbox", { name: "Search photos" })) as HTMLInputElement).toHaveProperty("value", "a");
  });

  it("opens the icon library for the search with 'See all'", async () => {
    const user = await search("a");
    await screen.findByRole("heading", { name: "Icons" });
    await user.click(within(section("Icons")).getByRole("button", { name: "See all" }));
    expect(useElementsNav.getState().page).toBe("graphics");
    expect(useElementsNav.getState().graphicsPane).toBe("icons");
    expect((await screen.findByRole("searchbox", { name: "Search icons" })) as HTMLInputElement).toHaveProperty("value", "a");
  });

  it("finds photos by their tags", async () => {
    await search("ocean");
    await screen.findByRole("heading", { name: "Photos" });
    // the photos are laid out in columns, so compare as sets
    const names = cells("Photos", ".cf-cell--photo").map((b) => b.getAttribute("aria-label"));
    expect(names.sort()).toEqual(
      PHOTOS.filter((p) => matchPhoto(p, "ocean"))
        .slice(0, 4)
        .map((p) => p.name)
        .sort(),
    );
  });

  it("shows just the photos when nothing else matches", async () => {
    await search("sahara");
    expect(await screen.findByRole("heading", { name: "Photos" })).toBeTruthy();
    expect(sections()).toEqual(["Photos"]);
    expect(cells("Photos", ".cf-cell--photo").map((c) => c.getAttribute("aria-label"))).toEqual(["Desert dunes"]);
    expect(screen.queryByText("No elements found")).toBeNull();
  });

  it("goes back to the categories when the search is cleared", async () => {
    const user = await search("heart");
    await screen.findByRole("heading", { name: "Icons" });
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByText("Browse categories")).toBeTruthy();
    expect(useElementsNav.getState().rootQuery).toBe("");
  });

  it("says when nothing at all matches, once the icon library has been searched too", async () => {
    await search("zzzzqqq");
    expect(await screen.findByText("No elements found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzzqqq". Try a simpler word like "heart", "arrow" or "sunset".')).toBeTruthy();
  });

  it("still shows shapes, graphics and photos when the icon library cannot be loaded", async () => {
    control.failIcons = true;
    await search("heart");
    expect(await screen.findByRole("heading", { name: "Shapes" })).toBeTruthy();
    // no icons group, and no "nothing found" either
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Icons" })).toBeNull());
    expect(screen.queryByText("No elements found")).toBeNull();
  });

  it("tells that nothing was found when only the icon library is missing too", async () => {
    control.failIcons = true;
    await search("zzzzqqq");
    expect(await screen.findByText("No elements found")).toBeTruthy();
  });
});

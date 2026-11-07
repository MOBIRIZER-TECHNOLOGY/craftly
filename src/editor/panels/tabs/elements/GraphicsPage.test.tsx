import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import type { GraphicElement } from "@/core/types";
import { GRAPHICS, GRAPHIC_CATEGORIES, searchGraphics } from "@/data/graphics";
import { DRAG_MIME } from "@/editor/insert";
import { resetEditor, stubLayout } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";
import { useElementsNav } from "./nav";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

async function openGraphics(opts: { pane?: "illustrations" | "icons"; query?: string } = {}) {
  resetElementsNav("graphics", opts.query ?? "");
  useElementsNav.setState({ graphicsPane: opts.pane ?? "illustrations" });
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: opts.pane === "icons" ? "Search icons" : "Search graphics" });
  return user;
}

const graphicCells = () => Array.from(document.querySelectorAll<HTMLElement>(".cf-cell--graphic"));
const iconCells = () => Array.from(document.querySelectorAll<HTMLElement>(".cf-cell--icon"));
const category = (label: string) => screen.getByRole("button", { name: label });
/** An icon in the grid (the suggestion chips share some of the names). */
const iconCell = (name: string) => within(screen.getByRole("group", { name: "Icons" })).getByRole("button", { name });

describe("Elements > Graphics > Illustrations", () => {
  it("opens on the illustrations with a chip for every category", async () => {
    await openGraphics();
    expect(screen.getByRole("heading", { name: "Graphics" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Illustrations" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Icons" }).getAttribute("aria-selected")).toBe("false");
    const chips = within(screen.getByRole("group", { name: "Illustration categories" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["All", ...GRAPHIC_CATEGORIES.map((c) => c.label)]);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Illustrations" })).toBeTruthy();
    expect(graphicCells()).toHaveLength(GRAPHICS.length);
  });

  it("shows only the chosen category", async () => {
    const user = await openGraphics();
    const nature = GRAPHIC_CATEGORIES.find((c) => c.id === "nature")!;
    await user.click(category(nature.label));
    expect(category(nature.label).getAttribute("aria-pressed")).toBe("true");
    expect(graphicCells()).toHaveLength(nature.count);
    await user.click(category("All"));
    expect(graphicCells()).toHaveLength(GRAPHICS.length);
  });

  it("puts a graphic on the page at 30% of the page's shorter side", async () => {
    const user = await openGraphics({ query: "Soft pebble" });
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Soft pebble blob" }));
    const el = lastElement() as GraphicElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(el.type).toBe("graphic");
    expect(el.svg).toContain("<svg");
    expect(Math.max(el.width, el.height)).toBe(Math.round(720 * 0.3));
    expect(el.source).toEqual({ kind: "illustration", id: "abstract-blob-1" });
    expect(useEditor.getState().selection).toEqual([el.id]);
  });

  it("hands a graphic to the canvas when dragged", async () => {
    await openGraphics({ query: "Soft pebble" });
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Soft pebble blob" }), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(payload.type).toBe("elements");
    expect(payload.elements[0].type).toBe("graphic");
  });

  it("finds graphics by name, category or tag and narrows by category too", async () => {
    const user = await openGraphics();
    await user.type(screen.getByRole("searchbox"), "blob");
    const all = searchGraphics("blob").length;
    expect(graphicCells()).toHaveLength(all);
    await user.click(category("Nature"));
    expect(graphicCells()).toHaveLength(searchGraphics("blob", "nature").length);
  });

  it("says when nothing matches", async () => {
    const user = await openGraphics();
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No graphics found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try another word or pick a different category.')).toBeTruthy();
  });

  it("goes back to the overview", async () => {
    const user = await openGraphics();
    await user.click(screen.getByRole("button", { name: "Back to all elements" }));
    expect(await screen.findByText("Browse categories")).toBeTruthy();
  });
});

describe("Elements > Graphics > Icons", () => {
  async function openIcons(query = "") {
    const user = await openGraphics({ pane: "icons", query });
    await screen.findByText(/\d+ icons/);
    return user;
  }

  it("switches to the icon library with its own search and suggestions", async () => {
    const user = await openGraphics();
    await user.click(screen.getByRole("tab", { name: "Icons" }));
    expect(screen.getByRole("searchbox", { name: "Search icons" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Popular icon searches" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Illustration categories" })).toBeNull();
    expect(await screen.findByText(/icons - popular ones first/)).toBeTruthy();
    expect(useElementsNav.getState().graphicsPane).toBe("icons");
    await user.click(screen.getByRole("tab", { name: "Illustrations" }));
    expect(screen.getByRole("group", { name: "Illustration categories" })).toBeTruthy();
  });

  it("switches panes from the keyboard too", async () => {
    const user = await openGraphics();
    screen.getByRole("tab", { name: "Illustrations" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(useElementsNav.getState().graphicsPane).toBe("icons");
  });

  it("lists the popular icons first and only draws the rows that are near the viewport", async () => {
    await openGraphics({ pane: "icons" });
    await screen.findByText(/icons - popular ones first/);
    // the grid is windowed: far fewer icon cells than icons
    const cells = iconCells();
    expect(cells.length).toBeGreaterThan(8);
    const total = Number(/^(\d+) icons/.exec(screen.getByText(/icons - popular ones first/).textContent ?? "")?.[1]);
    expect(total).toBeGreaterThan(1000);
    expect(cells.length).toBeLessThan(total / 5);
    expect(cells[0].getAttribute("aria-label")).toBe("Heart");
    await waitFor(() => expect(cells[0].querySelector("svg")).toBeTruthy());
  });

  it("puts an icon on the page, dark, 160 px wide and recolourable", async () => {
    const user = await openIcons();
    const before = pageElements().length;
    await user.click(iconCell("Heart"));
    await waitFor(() => expect(pageElements()).toHaveLength(before + 1));
    const el = lastElement() as GraphicElement;
    expect(el.type).toBe("graphic");
    expect(el.source).toEqual({ kind: "icon", id: "heart" });
    expect([el.width, el.height]).toEqual([160, 160]);
    expect(el.colors).toEqual({ currentColor: "#0e1318" });
    expect(el.svg).toContain("currentColor");
  });

  it("hands an icon to the canvas once its drawing has loaded", async () => {
    await openIcons();
    const cell = iconCell("Heart");
    await waitFor(() => expect(cell.querySelector("svg")).toBeTruthy());
    const dt = fakeDataTransfer();
    fireEvent.dragStart(cell, { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(payload.elements[0].source).toEqual({ kind: "icon", id: "heart" });
    expect(payload.elements[0].width).toBe(160);
  });

  it("finds icons by what is typed and counts them", async () => {
    const user = await openIcons();
    await user.type(screen.getByRole("searchbox", { name: "Search icons" }), "heart");
    await waitFor(() => expect(screen.queryByText(/popular ones first/)).toBeNull());
    expect(screen.getByText(/^\d+ icons$/)).toBeTruthy();
    expect(iconCells()[0].getAttribute("aria-label")).toBe("Heart");
  });

  it("uses a suggestion chip as the search, and clears it when the chip is pressed again", async () => {
    const user = await openIcons();
    const chip = within(screen.getByRole("group", { name: "Popular icon searches" })).getByRole("button", { name: "Camera" });
    await user.click(chip);
    expect((screen.getByRole("searchbox", { name: "Search icons" }) as HTMLInputElement).value).toBe("camera");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await user.click(chip);
    expect((screen.getByRole("searchbox", { name: "Search icons" }) as HTMLInputElement).value).toBe("");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("says when no icon matches", async () => {
    const user = await openIcons();
    await user.type(screen.getByRole("searchbox", { name: "Search icons" }), "zzzzqqq");
    expect(await screen.findByText("No icons found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzzqqq". Try "arrow", "heart" or "chart".')).toBeTruthy();
  });

  it("keeps the pane when the Elements tab is left and opened again", async () => {
    const user = await openIcons();
    await user.click(screen.getByRole("tab", { name: "Projects" }));
    await user.click(screen.getByRole("tab", { name: "Elements" }));
    expect(await screen.findByRole("searchbox", { name: "Search icons" })).toBeTruthy();
  });
});

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { FRAME_PRESETS, GRID_PRESETS } from "@/data/shapes";
import { DRAG_MIME } from "@/editor/insert";
import { resetEditor } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";

beforeEach(() => resetEditor());

async function openPage(page: "frames" | "grids", query = "") {
  resetElementsNav(page, query);
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: page === "frames" ? "Search frames" : "Search grids" });
  return user;
}

const labelsOf = (names: string[]) =>
  screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((l) => names.includes(l));

describe("Elements > Frames", () => {
  it("lists every frame and explains how to fill one", async () => {
    await openPage("frames");
    expect(screen.getByRole("heading", { name: "Frames" })).toBeTruthy();
    expect(screen.getByText("Drop a photo onto a frame to fill it")).toBeTruthy();
    expect(labelsOf(FRAME_PRESETS.map((p) => p.name))).toEqual(FRAME_PRESETS.map((p) => p.name));
  });

  it("puts an empty frame in the middle of the page and selects it", async () => {
    const user = await openPage("frames");
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Circle frame" }));
    const el = lastElement() as ImageElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(el.type).toBe("image");
    expect(el.isFrame).toBe(true);
    expect(el.src).toBeNull();
    expect(el.mask).toBe("ellipse");
    expect(el.width).toBe(Math.round(720 * 0.4));
    expect(el.x + el.width / 2).toBeCloseTo(640, 0);
    expect(useEditor.getState().selection).toEqual([el.id]);
  });

  it("sizes a frame by its proportions and keeps the rounded corners of the rounded frame", async () => {
    const user = await openPage("frames");
    await user.click(screen.getByRole("button", { name: "Arch frame" }));
    const arch = lastElement() as ImageElement;
    expect(arch.width).toBeLessThan(arch.height);
    expect(arch.width / arch.height).toBeCloseTo(0.7, 1);
    await user.click(screen.getByRole("button", { name: "Tag frame" }));
    const tag = lastElement() as ImageElement;
    // a wide frame is no wider than 1.5 times the base size, but keeps its own proportions
    expect(tag.width).toBe(Math.round(720 * 0.4 * 1.5));
    expect(tag.width / tag.height).toBeCloseTo(1.7, 1);
    await user.click(screen.getByRole("button", { name: "Rounded frame" }));
    expect((lastElement() as ImageElement).radius).toBe(60);
  });

  it("hands a new frame to the canvas when dragged", async () => {
    await openPage("frames");
    const before = pageElements().length;
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Heart frame" }), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(payload.elements).toHaveLength(1);
    expect(payload.elements[0].mask).toBe("heart");
    expect(pageElements()).toHaveLength(before);
  });

  it("finds frames by name or mask and says when there are none", async () => {
    const user = await openPage("frames");
    await user.type(screen.getByRole("searchbox"), "blob");
    expect(labelsOf(FRAME_PRESETS.map((p) => p.name))).toEqual(["Blob frame 1", "Blob frame 2", "Blob frame 3", "Blob frame 4"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No frames found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try "circle", "heart" or "arch".')).toBeTruthy();
  });

  it("draws each frame as the shape of its mask with a picture glyph", async () => {
    await openPage("frames", "star");
    const cell = screen.getByRole("button", { name: "Star frame" });
    expect(cell.querySelector(".cf-frame-preview__shape")?.getAttribute("d")?.startsWith("M")).toBe(true);
    expect(cell.querySelector(".cf-frame-preview__icon")).toBeTruthy();
  });
});

describe("Elements > Grids", () => {
  it("lists the photo layouts", async () => {
    await openPage("grids");
    expect(screen.getByRole("heading", { name: "Grids" })).toBeTruthy();
    expect(screen.getByText("Photo layouts that fill the page")).toBeTruthy();
    expect(labelsOf(GRID_PRESETS.map((p) => p.name))).toEqual(GRID_PRESETS.map((p) => p.name));
    const preview = screen.getByRole("button", { name: "Six photos" }).querySelectorAll("rect");
    expect(preview).toHaveLength(6);
  });

  it("fills the page with one empty frame per cell and selects them all", async () => {
    const user = await openPage("grids");
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Four squares" }));
    const added = pageElements().slice(before) as ImageElement[];
    expect(added).toHaveLength(4);
    expect(added.every((e) => e.isFrame && e.src === null)).toBe(true);
    expect(useEditor.getState().selection).toEqual(added.map((e) => e.id));

    // a margin of 6% of the shorter side, a gutter of 1.2% between the cells, and not centred again afterwards
    const margin = Math.round(720 * 0.06);
    const gap = Math.max(6, Math.round(720 * 0.012));
    const boxW = 1280 - margin * 2;
    expect(added[0].x).toBeCloseTo(margin + gap / 2);
    expect(added[0].y).toBeCloseTo(margin + gap / 2);
    expect(added[0].width).toBeCloseTo(boxW / 2 - gap);
    const right = Math.max(...added.map((e) => e.x + e.width));
    expect(right).toBeCloseTo(1280 - margin - gap / 2);
  });

  it("adds the cells of an uneven layout", async () => {
    const user = await openPage("grids");
    await user.click(screen.getByRole("button", { name: "Hero and strip" }));
    const added = pageElements().slice(-4) as ImageElement[];
    expect(added).toHaveLength(4);
    expect(added[0].width).toBeGreaterThan(added[1].width * 2);
  });

  it("hands the layout to the canvas when dragged", async () => {
    await openPage("grids");
    const before = pageElements().length;
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Mosaic" }), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(payload.elements).toHaveLength(5);
    expect(pageElements()).toHaveLength(before);
  });

  it("sizes the layout for a 1920 x 1080 page when no design is open", async () => {
    await openPage("grids");
    useEditor.getState().actions.closeDesign();
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Two columns" }), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    const margin = Math.round(1080 * 0.06);
    expect(payload.elements).toHaveLength(2);
    expect(payload.elements[0].x).toBeGreaterThan(margin);
    expect(Math.max(...payload.elements.map((e: ImageElement) => e.x + e.width))).toBeLessThan(1920 - margin);
  });

  it("finds layouts by name and says when there are none", async () => {
    const user = await openPage("grids");
    await user.type(screen.getByRole("searchbox"), "column");
    await waitFor(() => expect(labelsOf(GRID_PRESETS.map((p) => p.name))).toEqual(["Two columns", "Three columns"]));
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No grids found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try "mosaic" or "columns".')).toBeTruthy();
  });
});

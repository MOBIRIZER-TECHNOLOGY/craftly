import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage, createShape } from "@/core/factory";
import type { Fill } from "@/core/types";
import { BACKGROUND_GROUPS } from "@/data/backgrounds";
import { contextOf } from "@/test/canvasMock";
import { openElements, showPanel, store, stubDomMatrix } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  stubDomMatrix();
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.unstubAllGlobals();
});

const background = (pageIndex = 0): Fill => store().design!.pages[pageIndex].background;
const heading = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}`) });
const section = (title: string) => heading(title).parentElement as HTMLElement;
const tiles = (title: string) =>
  within(section(title))
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("aria-pressed"));
const tile = (name: string) => screen.getByRole("button", { name });
const group = (id: string) => BACKGROUND_GROUPS.find((g) => g.id === id)!;
const openBackground = () => showPanel({ kind: "background" });

describe("Background panel", () => {
  it("asks you to open a design first", () => {
    openBackground();
    expect(screen.getByRole("region", { name: "Background" })).toBeTruthy();
    expect(screen.getByText("No page open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Page color/ })).toBeNull();
  });

  it("shows the page colour and opens the colour panel from it", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    openBackground();
    const current = screen.getByRole("button", { name: "Page color: #FFFFFF. Open the color panel" });
    expect(within(current).getByText("#FFFFFF")).toBeTruthy();
    await user.click(current);
    expect(store().context).toEqual({ kind: "color", target: "page" });
  });

  it("describes gradients, patterns and photos the page may have", () => {
    openElements([createShape("rect")]);
    openBackground();
    const describe_ = () => screen.getByRole("button", { name: /^Page color: / }).getAttribute("aria-label");
    act(() => store().actions.setPageBackground(group("gradient").presets[0].fill));
    expect(describe_()).toBe("Page color: Gradient. Open the color panel");
    act(() => store().actions.setPageBackground(group("pattern").presets[0].fill));
    expect(describe_()).toBe("Page color: Pattern. Open the color panel");
    act(() => store().actions.setPageBackground({ type: "image", src: "builtin:nebula", fit: "cover" }));
    expect(describe_()).toMatch(/^Page color: Nebula\./);
    act(() => store().actions.setPageBackground({ type: "image", src: "asset:abc", fit: "cover" }));
    expect(describe_()).toBe("Page color: Photo. Open the color panel");
    act(() => store().actions.setPageBackground({ type: "image", src: "builtin:nope", fit: "cover" }));
    expect(describe_()).toBe("Page color: Photo. Open the color panel");
    act(() =>
      store().actions.setPageBackground({
        type: "radial",
        stops: [
          { offset: 0, color: "#fff" },
          { offset: 1, color: "#000" },
        ],
      }),
    );
    expect(describe_()).toBe("Page color: Gradient. Open the color panel");
  });

  it("lists the four kinds of background with a short list and a 'See all' for the long ones", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    openBackground();
    for (const g of BACKGROUND_GROUPS) expect(heading(g.label)).toBeTruthy();
    expect(tiles("Solid colours")).toHaveLength(18);
    expect(tiles("Gradients")).toHaveLength(18);
    expect(tiles("Patterns")).toHaveLength(12);
    expect(tiles("Photos & textures")).toHaveLength(6);

    await user.click(within(section("Solid colours")).getByRole("button", { name: "See all" }));
    expect(tiles("Solid colours")).toHaveLength(group("solid").presets.length);
    await user.click(within(section("Solid colours")).getByRole("button", { name: "Show less" }));
    expect(tiles("Solid colours")).toHaveLength(18);
  });

  it("applies a solid colour and marks it as the current one", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    openBackground();
    expect(tile("White").getAttribute("aria-pressed")).toBe("true");
    await user.click(tile("Blush"));
    expect(background()).toEqual({ type: "solid", color: "#fde4e4" });
    expect(tile("Blush").getAttribute("aria-pressed")).toBe("true");
    expect(tile("White").getAttribute("aria-pressed")).toBe("false");
  });

  it("applies a gradient", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    openBackground();
    const first = group("gradient").presets[0];
    await user.click(tile(first.name));
    expect(background()).toEqual(first.fill);
    expect(tile(first.name).getAttribute("aria-pressed")).toBe("true");
  });

  it("tunes a pattern: scale, ink and paper", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    openBackground();
    expect(screen.queryByRole("slider", { name: "Scale" })).toBeNull();
    const pattern = group("pattern").presets[0];
    await user.click(tile(pattern.name));
    expect(screen.getByRole("heading", { name: "Pattern" })).toBeTruthy();
    expect(tile(pattern.name).getAttribute("aria-pressed")).toBe("true");
    const slider = screen.getByRole("slider", { name: "Scale" });
    expect(slider.getAttribute("aria-valuetext")).toBe("100%");
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(background()).toMatchObject({ type: "pattern", scale: 1.1, pattern: "dots" });
    // changing the scale does not unselect the preset: patterns match without their scale
    expect(tile(pattern.name).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Pattern ink color" }));
    const hex = within(screen.getByRole("dialog", { name: "Pattern ink color picker" })).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "123456");
    expect(background()).toMatchObject({ type: "pattern", color: "#123456" });
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Pattern paper color" }));
    const paper = within(screen.getByRole("dialog", { name: "Pattern paper color picker" })).getByRole("textbox", { name: "Hex colour" });
    await user.clear(paper);
    await user.type(paper, "fedcba");
    expect(background()).toMatchObject({ type: "pattern", background: "#fedcba", color: "#123456" });
    expect(tile(pattern.name).getAttribute("aria-pressed")).toBe("false");
  });

  it("dims a photo background, changes how it fits and keeps the dimming for the next photo", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    openBackground();
    const [first, second] = group("photo").presets;
    await user.click(tile(first.name));
    expect(background()).toMatchObject({ type: "image", src: first.fill.type === "image" ? first.fill.src : "", fit: "cover" });
    expect(screen.getByRole("heading", { name: "Photo" })).toBeTruthy();
    const dim = screen.getByRole("slider", { name: "Dim" });
    expect(dim.getAttribute("aria-valuetext")).toBe("Off");
    dim.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(dim.getAttribute("aria-valuetext")).toBe("Dim 2%");
    expect(background()).toMatchObject({ dim: 0.02 });
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(dim.getAttribute("aria-valuetext")).toBe("Lighten 1%");

    await user.click(screen.getByRole("combobox", { name: "Photo fit" }));
    await user.click(screen.getByRole("option", { name: "Tile" }));
    expect(background()).toMatchObject({ fit: "tile" });

    await user.click(tile(second.name));
    expect(background()).toMatchObject({ src: second.fill.type === "image" ? second.fill.src : "", dim: -0.01, fit: "cover" });
  });

  it("paints the thumbnails of patterns and photos", async () => {
    openElements([createShape("rect")]);
    const { container } = openBackground();
    const canvases = Array.from(container.querySelectorAll<HTMLCanvasElement>(".cf-bg__tile canvas"));
    expect(canvases).toHaveLength(12);
    await waitFor(() => expect(canvases.every((c) => contextOf(c)?.calls.some((k) => k.name === "createPattern" || k.name === "fillRect" || k.name === "fill"))).toBe(true));
    // a photo tile shows its picture once it has been painted
    await waitFor(
      () => {
        const photoTile = container.querySelectorAll<HTMLElement>(".cf-fill--photo");
        expect(photoTile.length).toBe(6);
        expect(Array.from(photoTile).every((p) => p.style.backgroundImage.startsWith("url("))).toBe(true);
      },
      { timeout: 8000 },
    );
  });

  it("loads the thumbnails straight away in a browser without an intersection observer", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    openElements([createShape("rect")]);
    const { container } = openBackground();
    const patterns = Array.from(container.querySelectorAll<HTMLCanvasElement>(".cf-bg__tile canvas"));
    await waitFor(() => expect(patterns.every((c) => contextOf(c)?.calls.some((k) => k.name === "createPattern" || k.name === "fillRect" || k.name === "fill"))).toBe(true));
    await waitFor(
      () => {
        const photos = Array.from(container.querySelectorAll<HTMLElement>(".cf-fill--photo"));
        expect(photos).toHaveLength(6);
        expect(photos.every((p) => p.style.backgroundImage.startsWith("url("))).toBe(true);
      },
      { timeout: 8000 },
    );
  });

  it("offers 'Apply to all pages' only for a design with more than one page", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")], { pages: [createPage(), createPage()] });
    openBackground();
    await user.click(tile("Peach"));
    expect(background(1)).toEqual({ type: "solid", color: "#ffffff" });
    await user.click(screen.getByRole("button", { name: "Apply to all pages" }));
    for (const i of [0, 1, 2]) expect(background(i)).toEqual({ type: "solid", color: "#ffe3d3" });
    expect(screen.getByRole("button", { name: "Applied to all pages" })).toBeTruthy();
    // all three pages changed in one step: one undo gives the other two pages their old colour back
    store().actions.undo();
    expect(background(0)).toEqual({ type: "solid", color: "#ffe3d3" });
    for (const i of [1, 2]) expect(background(i)).toEqual({ type: "solid", color: "#ffffff" });
  });

  it("gives every page its own copy of the background", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")], { pages: [createPage()] });
    openBackground();
    await user.click(tile(group("pattern").presets[1].name));
    await user.click(screen.getByRole("button", { name: "Apply to all pages" }));
    expect(background(1)).toEqual(background(0));
    expect(background(1)).not.toBe(background(0));
  });

  it("does nothing when the design is closed before 'Apply to all pages' is handled", () => {
    openElements([createShape("rect")], { pages: [createPage()] });
    openBackground();
    const apply = screen.getByRole("button", { name: "Apply to all pages" });
    act(() => {
      store().actions.closeDesign();
      fireEvent.click(apply);
    });
    expect(store().design).toBeNull();
    expect(screen.queryByRole("button", { name: "Applied to all pages" })).toBeNull();
  });

  it("has no 'Apply to all pages' button on a single page design", () => {
    openElements([createShape("rect")]);
    openBackground();
    expect(screen.queryByRole("button", { name: /Apply to all pages/ })).toBeNull();
  });

  it("takes the 'Applied' notice away after a moment", async () => {
    vi.useFakeTimers();
    openElements([createShape("rect")], { pages: [createPage()] });
    openBackground();
    fireEvent.click(screen.getByRole("button", { name: "Apply to all pages" }));
    expect(screen.getByRole("button", { name: "Applied to all pages" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2300));
    expect(screen.getByRole("button", { name: "Apply to all pages" })).toBeTruthy();
  });
});

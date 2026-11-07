import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFrame, createImage, createShape } from "@/core/factory";
import type { ImageElement } from "@/core/types";
import { FILTER_PRESETS } from "@/data/filters";
import { contextOf } from "@/test/canvasMock";
import { live, openElements, selectElements, showPanel, store } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const photo = (extra: Partial<ImageElement> = {}) =>
  createImage({ src: "https://example.test/p.jpg", x: 50, y: 50, width: 300, height: 200, naturalWidth: 300, naturalHeight: 200, ...extra });
const openFilters = (tab: "filters" | "adjust" = "filters") => showPanel({ kind: "filters", tab });
const presets = () => within(screen.getByRole("group", { name: "Filter presets" }));
const slider = (name: string) => screen.getByRole("slider", { name });

describe("Filters panel", () => {
  it("asks for a photo when there is none, and does not count an empty frame", () => {
    const frame = createFrame("rect");
    const box = createShape("rect");
    openElements([frame, box], { selected: [box] });
    openFilters();
    expect(screen.getByText("No photo selected")).toBeTruthy();
    selectElements(frame);
    expect(screen.getByText("No photo selected")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Filter presets" })).toBeNull();
  });

  it("lists every preset and applies one at full strength", async () => {
    const user = userEvent.setup();
    const p = photo();
    openElements([p], { selected: [p] });
    openFilters();
    expect(screen.getByRole("region", { name: "Filters" })).toBeTruthy();
    expect(presets().getAllByRole("button")).toHaveLength(FILTER_PRESETS.length);
    expect(presets().getByRole("button", { name: "None" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("slider", { name: "Intensity" })).toBeNull();

    await user.click(presets().getByRole("button", { name: "Vivid" }));
    expect(live<ImageElement>(p).filter).toMatchObject({ preset: "vivid", intensity: 100 });
    expect(presets().getByRole("button", { name: "Vivid" }).getAttribute("aria-pressed")).toBe("true");
    expect(presets().getByRole("button", { name: "None" }).getAttribute("aria-pressed")).toBe("false");
    expect(slider("Intensity").getAttribute("aria-valuetext")).toBe("100%");
  });

  it("scales a preset with the intensity slider and starts the next preset at full strength", async () => {
    const user = userEvent.setup();
    const p = photo();
    openElements([p], { selected: [p] });
    openFilters();
    await user.click(presets().getByRole("button", { name: "Vivid" }));
    slider("Intensity").focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(live<ImageElement>(p).filter.intensity).toBe(98);
    // picking the same preset again keeps what was set
    await user.click(presets().getByRole("button", { name: "Vivid" }));
    expect(live<ImageElement>(p).filter.intensity).toBe(98);
    await user.click(presets().getByRole("button", { name: "Noir" }));
    expect(live<ImageElement>(p).filter).toMatchObject({ preset: "noir", intensity: 100 });
    await user.click(presets().getByRole("button", { name: "None" }));
    expect(live<ImageElement>(p).filter.preset).toBe("none");
    expect(screen.queryByRole("slider", { name: "Intensity" })).toBeNull();
  });

  it("applies a preset to every selected photo and marks none when they disagree", async () => {
    const user = userEvent.setup();
    const [a, b] = [photo(), photo()];
    a.filter = { ...a.filter, preset: "vivid" };
    b.filter = { ...b.filter, preset: "noir" };
    openElements([a, b], { selected: [a, b] });
    openFilters();
    for (const name of ["None", "Vivid", "Noir"]) expect(presets().getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("slider", { name: "Intensity" })).toBeNull();
    await user.click(presets().getByRole("button", { name: "Fresco" }));
    expect(live<ImageElement>(a).filter.preset).toBe("fresco");
    expect(live<ImageElement>(b).filter.preset).toBe("fresco");
  });

  it("previews every preset on the photo itself", async () => {
    const p = photo();
    openElements([p], { selected: [p] });
    const { container } = openFilters();
    await waitFor(() => {
      const canvases = Array.from(container.querySelectorAll("canvas"));
      expect(canvases).toHaveLength(FILTER_PRESETS.length);
      expect(canvases.every((c) => (contextOf(c)?.callsTo("drawImage").length ?? 0) > 0)).toBe(true);
    });
  });

  it("switches to the Adjust tab and back", async () => {
    const user = userEvent.setup();
    const p = photo();
    openElements([p], { selected: [p] });
    openFilters();
    await user.click(screen.getByRole("tab", { name: "Adjust" }));
    expect(store().context).toEqual({ kind: "filters", tab: "adjust" });
    expect(screen.getByRole("region", { name: "Adjust" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Adjust" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Filters" }));
    expect(store().context).toEqual({ kind: "filters", tab: "filters" });
    expect(screen.getByRole("group", { name: "Filter presets" })).toBeTruthy();
  });
});

describe("Filters panel: Adjust", () => {
  it("offers a slider for each adjustment and writes the value to the photo", async () => {
    const user = userEvent.setup();
    const p = photo();
    openElements([p], { selected: [p] });
    openFilters("adjust");
    for (const name of ["Brightness", "Contrast", "Saturation", "Warmth", "Fade", "Vignette", "Blur", "Hue"]) expect(slider(name)).toBeTruthy();

    slider("Brightness").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(live<ImageElement>(p).filter.brightness).toBe(3);
    // signed read-out for sliders that go both ways, plain for the others
    expect(screen.getByText("+3")).toBeTruthy();
    slider("Contrast").focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("-1")).toBeTruthy();
    slider("Fade").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(live<ImageElement>(p).filter.fade).toBe(2);
    expect(screen.queryByText("+2")).toBeNull();
  });

  it("resets one adjustment or all of them, and keeps the chosen preset", async () => {
    const user = userEvent.setup();
    const p = photo();
    p.filter = { ...p.filter, preset: "vivid", intensity: 60, brightness: 10, warmth: -20 };
    openElements([p], { selected: [p] });
    openFilters("adjust");
    await user.click(screen.getByRole("button", { name: "Reset brightness" }));
    expect(live<ImageElement>(p).filter.brightness).toBe(0);
    expect(screen.queryByRole("button", { name: "Reset brightness" })).toBeNull();
    expect(live<ImageElement>(p).filter.warmth).toBe(-20);

    await user.click(screen.getByRole("button", { name: "Reset all" }));
    expect(live<ImageElement>(p).filter).toMatchObject({ preset: "vivid", intensity: 60, brightness: 0, warmth: 0, duotone: null });
    expect((screen.getByRole("button", { name: "Reset all" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns the duotone on with default colours, edits them and turns it off", async () => {
    const user = userEvent.setup();
    const p = photo();
    openElements([p], { selected: [p] });
    openFilters("adjust");
    const toggle = screen.getByRole("switch", { name: "Duotone" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(/Turn it on to repaint the photo/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Duotone shadows" })).toBeNull();

    await user.click(toggle);
    expect(live<ImageElement>(p).filter.duotone).toEqual({ dark: "#0b1f4b", light: "#7ee8e0" });
    expect((screen.getByRole("switch", { name: "Duotone" }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Duotone shadows" }));
    let hex = within(screen.getByRole("dialog", { name: "Duotone shadows picker" })).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "112233");
    expect(live<ImageElement>(p).filter.duotone).toEqual({ dark: "#112233", light: "#7ee8e0" });
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Duotone highlights" }));
    hex = within(screen.getByRole("dialog", { name: "Duotone highlights picker" })).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "eeddcc");
    expect(live<ImageElement>(p).filter.duotone).toEqual({ dark: "#112233", light: "#eeddcc" });
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("switch", { name: "Duotone" }));
    expect(live<ImageElement>(p).filter.duotone).toBeNull();
  });

  it("turns a duotone preset into a custom duotone when its colours are edited", async () => {
    const user = userEvent.setup();
    const p = photo();
    p.filter = { ...p.filter, preset: "duo-ocean", intensity: 100 };
    openElements([p], { selected: [p] });
    openFilters("adjust");
    // the preset paints with two colours: the switch shows them as on
    expect((screen.getByRole("switch", { name: "Duotone" }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Duotone highlights" }));
    const hex = within(screen.getByRole("dialog", { name: "Duotone highlights picker" })).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "ffcc00");
    const filter = live<ImageElement>(p).filter;
    expect(filter.preset).toBe("none");
    expect(filter.duotone?.light).toBe("#ffcc00");
    expect(filter.duotone?.dark).toBeTruthy();
  });

  it("switching a duotone preset off removes the preset", async () => {
    const user = userEvent.setup();
    const p = photo();
    p.filter = { ...p.filter, preset: "duo-sunset", intensity: 100 };
    openElements([p], { selected: [p] });
    openFilters("adjust");
    await user.click(screen.getByRole("switch", { name: "Duotone" }));
    expect(live<ImageElement>(p).filter).toMatchObject({ preset: "none", duotone: null });
  });
});

describe("Filters panel: edge cases", () => {
  it("treats a photo without a preset name as having no filter", () => {
    const p = photo();
    p.filter = { ...p.filter, preset: "" };
    openElements([p], { selected: [p] });
    openFilters();
    expect(presets().getByRole("button", { name: "None" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("changes only the photos of a mixed selection", async () => {
    const user = userEvent.setup();
    const [p, box] = [photo(), createShape("rect")];
    openElements([p, box], { selected: [p, box] });
    openFilters();
    await user.click(presets().getByRole("button", { name: "Vivid" }));
    expect(live<ImageElement>(p).filter.preset).toBe("vivid");
    expect(live(box)).not.toHaveProperty("filter");
    slider("Intensity").focus();
    await user.keyboard("{ArrowLeft}");
    expect(live<ImageElement>(p).filter.intensity).toBe(99);
    expect(live(box)).not.toHaveProperty("filter");
  });

  it("adjusts only the photos of a mixed selection", async () => {
    const user = userEvent.setup();
    const [p, box] = [photo(), createShape("rect")];
    openElements([p, box], { selected: [p, box] });
    openFilters("adjust");
    slider("Brightness").focus();
    await user.keyboard("{ArrowRight}");
    expect(live<ImageElement>(p).filter.brightness).toBe(1);
    expect(live(box)).not.toHaveProperty("filter");
  });

  it("keeps the preview tiles empty while the picture cannot be loaded", async () => {
    const p = photo({ src: "https://example.test/broken.jpg" });
    openElements([p], { selected: [p] });
    const { container } = openFilters();
    await new Promise((r) => setTimeout(r, 60));
    const canvases = Array.from(container.querySelectorAll("canvas"));
    expect(canvases).toHaveLength(FILTER_PRESETS.length);
    expect(canvases.every((c) => (contextOf(c)?.callsTo("drawImage").length ?? 0) === 0)).toBe(true);
  });
});

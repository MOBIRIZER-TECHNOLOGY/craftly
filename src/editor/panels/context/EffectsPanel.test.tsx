import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createGraphic, createGroup, createImage, createLine, createShape, createTable, createText } from "@/core/factory";
import type { ImageElement, ShapeElement, TextElement } from "@/core/types";
import { contextOf } from "@/test/canvasMock";
import { live, openElements, selectElements, showPanel, store } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const text = (extra: Parameters<typeof createText>[0] = {}) => createText({ text: "Effects", fontSize: 40, x: 50, y: 50, ...extra });
const openEffects = () => showPanel({ kind: "effects" });
const group = (name: string) => screen.getByRole("group", { name });
const tile = (groupName: string, label: string) => within(group(groupName)).getByRole("button", { name: label });
const slider = (name: string) => screen.getByRole("slider", { name });
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed") === "true";

describe("Effects panel: empty states", () => {
  it("asks for a selection", () => {
    openElements([text()]);
    openEffects();
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    expect(screen.getByText(/Select text to add effects/)).toBeTruthy();
  });

  it("explains that a table has no effects", () => {
    const table = createTable();
    openElements([table], { selected: [table] });
    openEffects();
    expect(screen.getByText("No effects for this element")).toBeTruthy();
    expect(screen.getByText(/Effects are available for text, shapes, lines, images and graphics/)).toBeTruthy();
  });
});

describe("Effects panel: text", () => {
  it("starts with no effect and applies a style from the grid with its own defaults", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    expect(pressed(tile("Text effect styles", "None"))).toBe(true);
    expect(screen.queryByRole("slider", { name: "Offset" })).toBeNull();

    await user.click(tile("Text effect styles", "Shadow"));
    expect(live<TextElement>(t).effect).toMatchObject({ kind: "shadow", offset: 50, direction: 45, blur: 30, transparency: 50 });
    expect(pressed(tile("Text effect styles", "Shadow"))).toBe(true);
    expect(pressed(tile("Text effect styles", "None"))).toBe(false);
    expect(screen.getByText("Shadow settings")).toBeTruthy();
    for (const name of ["Offset", "Direction", "Blur", "Transparency"]) expect(slider(name)).toBeTruthy();
  });

  it("reveals the sliders of a picked style by scrolling to them", async () => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    await user.click(tile("Text effect styles", "Neon"));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it("switches the style off when its tile is picked again and keeps None as it is", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    await user.click(tile("Text effect styles", "Outline"));
    expect(live<TextElement>(t).effect.kind).toBe("outline");
    await user.click(tile("Text effect styles", "Outline"));
    expect(live<TextElement>(t).effect.kind).toBe("none");
    await user.click(tile("Text effect styles", "None"));
    expect(live<TextElement>(t).effect.kind).toBe("none");
  });

  it("offers the sliders each style paints with, and a colour for the styles that have one", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    const sliderNames = () =>
      screen.queryAllByRole("slider").map((s) => s.getAttribute("aria-labelledby") && document.getElementById(s.getAttribute("aria-labelledby") as string)?.textContent);
    await user.click(tile("Text effect styles", "Lift"));
    expect(sliderNames()).toEqual(["Intensity"]);
    expect(screen.queryByRole("button", { name: /Color \(opens the colour panel\)/ })).toBeNull();
    await user.click(tile("Text effect styles", "Splice"));
    expect(sliderNames()).toEqual(["Thickness", "Offset", "Direction"]);
    await user.click(tile("Text effect styles", "Background"));
    expect(sliderNames()).toEqual(["Roundness", "Spread", "Transparency"]);
    await user.click(screen.getByRole("button", { name: "Color (opens the colour panel)" }));
    expect(store().context).toEqual({ kind: "color", target: "effect" });
  });

  it("changes a slider of the effect and keeps the rest of the effect", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    await user.click(tile("Text effect styles", "Shadow"));
    slider("Offset").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(live<TextElement>(t).effect).toMatchObject({ kind: "shadow", offset: 52, blur: 30, color: "#000000" });
    slider("Blur").focus();
    await user.keyboard("{Home}");
    expect(live<TextElement>(t).effect).toMatchObject({ offset: 52, blur: 0 });
    // a typed value of the slider shows in its read-out
    expect(within(screen.getByText("Offset").parentElement as HTMLElement).getByText("52")).toBeTruthy();
  });

  it("makes a whole slider drag one undo step", () => {
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    fireEvent.click(tile("Text effect styles", "Shadow"));
    const before = store().past.length;
    const control = slider("Offset").closest(".cf-slider__control") as HTMLElement;
    fireEvent.pointerDown(control, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(control, { clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(control, { clientX: 800, pointerId: 1 });
    fireEvent.pointerUp(control, { clientX: 800, pointerId: 1 });
    expect(live<TextElement>(t).effect.offset).toBe(80);
    expect(store().past.length).toBe(before + 1);
    store().actions.undo();
    expect(live<TextElement>(t).effect.offset).toBe(50);
  });

  it("tells when the selected texts use different effects and applies the picked style to all of them", async () => {
    const user = userEvent.setup();
    const [a, b] = [text({ effect: { kind: "shadow" } }), text({ effect: { kind: "neon" } })];
    openElements([a, b], { selected: [a, b] });
    openEffects();
    expect(screen.getByText(/use different effects/)).toBeTruthy();
    for (const name of ["None", "Shadow", "Neon"]) expect(pressed(tile("Text effect styles", name))).toBe(false);
    await user.click(tile("Text effect styles", "Echo"));
    expect(live<TextElement>(a).effect.kind).toBe("echo");
    expect(live<TextElement>(b).effect.kind).toBe("echo");
    expect(screen.queryByText(/use different effects/)).toBeNull();
  });

  it("curves the text with the Curve tile and its slider, and straightens it again", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    openEffects();
    expect(pressed(tile("Text shape", "None"))).toBe(true);
    expect(screen.queryByRole("slider", { name: "Curve" })).toBeNull();
    await user.click(tile("Text shape", "Curve"));
    expect(live<TextElement>(t).curve).toBe(50);
    expect(pressed(tile("Text shape", "Curve"))).toBe(true);
    slider("Curve").focus();
    await user.keyboard("{ArrowLeft}");
    expect(live<TextElement>(t).curve).toBe(49);
    await user.keyboard("{End}");
    expect(live<TextElement>(t).curve).toBe(100);
    await user.click(tile("Text shape", "Curve"));
    expect(live<TextElement>(t).curve).toBe(0);
    await user.click(tile("Text shape", "Curve"));
    await user.click(tile("Text shape", "None"));
    expect(live<TextElement>(t).curve).toBe(0);
  });

  it("styles the text inside a group", async () => {
    const user = userEvent.setup();
    const inner = text({ text: "Inside" });
    const g = createGroup([createShape("rect"), inner], { x: 0, y: 0, width: 300, height: 100 });
    openElements([g], { selected: [g] });
    openEffects();
    await user.click(tile("Text effect styles", "Outline"));
    expect(live<TextElement>(inner).effect.kind).toBe("outline");
  });

  it("paints the style tiles with the real text painter", async () => {
    const t = text();
    openElements([t], { selected: [t] });
    const { container } = openEffects();
    await waitFor(() => {
      const canvases = Array.from(container.querySelectorAll("canvas"));
      expect(canvases.length).toBeGreaterThanOrEqual(10);
      // the "hollow" style is outlined only, every other tile fills its letters
      expect(canvases.every((c) => (contextOf(c)?.callsTo("fillText").length ?? 0) + (contextOf(c)?.callsTo("strokeText").length ?? 0) > 0)).toBe(true);
    });
  });
});

describe("Effects panel: shapes, images and graphics", () => {
  const shape = (): ShapeElement => createShape("rect", { x: 100, y: 100, width: 200, height: 200 });

  it("adds a shadow from a preset and takes it away again", async () => {
    const user = userEvent.setup();
    const s = shape();
    openElements([s], { selected: [s] });
    openEffects();
    expect(pressed(tile("Shadow styles", "None"))).toBe(true);
    expect(screen.queryByText("Shadow settings")).toBeNull();
    await user.click(tile("Shadow styles", "Drop"));
    expect(live<ShapeElement>(s).shadow).not.toBeNull();
    expect(pressed(tile("Shadow styles", "Drop"))).toBe(true);
    expect(screen.getByText("Shadow settings")).toBeTruthy();
    await user.click(tile("Shadow styles", "Drop"));
    expect(live<ShapeElement>(s).shadow).toBeNull();
    await user.click(tile("Shadow styles", "Soft"));
    await user.click(tile("Shadow styles", "None"));
    expect(live<ShapeElement>(s).shadow).toBeNull();
  });

  it("changes the shadow with its sliders and remembers the direction of a glow", async () => {
    const user = userEvent.setup();
    const s = shape();
    openElements([s], { selected: [s] });
    openEffects();
    await user.click(tile("Shadow styles", "Hard"));
    const hard = live<ShapeElement>(s).shadow!;
    expect(hard.blur).toBe(0);
    slider("Blur").focus();
    await user.keyboard("{ArrowRight}");
    expect(live<ShapeElement>(s).shadow!.blur).toBeGreaterThan(0);
    slider("Direction").focus();
    await user.keyboard("{ArrowRight}");
    expect(live<ShapeElement>(s).shadow!.x).not.toBe(hard.x);

    // a glow has no offset and therefore no direction
    await user.click(tile("Shadow styles", "Glow"));
    expect(slider("Direction").getAttribute("aria-disabled")).toBe("true");
    slider("Offset").focus();
    await user.keyboard("{ArrowRight}");
    expect(slider("Direction").getAttribute("aria-disabled")).toBeNull();
    expect(live<ShapeElement>(s).shadow!.x).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Color (opens the colour panel)" }));
    expect(store().context).toEqual({ kind: "color", target: "shadow" });
  });

  it("gives the elements that have no shadow yet one built from the Drop preset when a slider moves", async () => {
    const user = userEvent.setup();
    const [withShadow, without] = [shape(), shape()];
    openElements([withShadow, without], { selected: [withShadow, without] });
    openEffects();
    await user.click(tile("Shadow styles", "Hard"));
    store().actions.updateElements([without.id], { shadow: null });
    slider("Blur").focus();
    await user.keyboard("{ArrowRight}");
    // the second element had none: it starts from the Drop preset with the new blur
    const made = live<ShapeElement>(without).shadow!;
    expect(made).toBeTruthy();
    expect(made.blur).toBeGreaterThan(0);
    expect(made.x).toBeGreaterThan(0);
    expect(live<ShapeElement>(withShadow).shadow!.color).toBe("rgba(14,19,24,0.9)");
  });

  it.each([
    ["a graphic", () => createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>' })],
    ["a line", () => createLine({ width: 200 })],
    ["a photo", () => createImage({ src: "https://example.test/p.jpg", width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 })],
  ])("applies a shadow to %s", async (_name, make) => {
    const user = userEvent.setup();
    const el = make();
    openElements([el], { selected: [el] });
    openEffects();
    await user.click(tile("Shadow styles", "Soft"));
    expect(live(el).shadow).not.toBeNull();
  });

  it("blurs a photo with its own slider", async () => {
    const user = userEvent.setup();
    const photo = createImage({ src: "https://example.test/p.jpg", x: 0, y: 0, width: 300, height: 200, naturalWidth: 300, naturalHeight: 200 });
    openElements([photo], { selected: [photo] });
    openEffects();
    expect(screen.getByText("Image blur")).toBeTruthy();
    slider("Blur").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    // 0..100 maps to 0..30px on a 1080px page; this design is 600px tall
    expect(live<ImageElement>(photo).blur).toBeGreaterThan(0);
    expect(live<ImageElement>(photo).blur).toBeCloseTo(3 * 0.3 * (600 / 1080), 1);

    await user.click(tile("Shadow styles", "Drop"));
    expect(screen.getAllByRole("slider", { name: "Blur" })).toHaveLength(2);
  });

  it("leaves out the elements that cannot carry a shadow and says how many", async () => {
    const user = userEvent.setup();
    const [s, table, chart] = [shape(), createTable(), createChart()];
    openElements([s, table, chart], { selected: [s, table] });
    openEffects();
    expect(screen.getByText("One selected element does not support shadows and is left unchanged.")).toBeTruthy();
    await user.click(tile("Shadow styles", "Hard"));
    expect(live<ShapeElement>(s).shadow).not.toBeNull();
    expect(live(table).shadow).toBeUndefined();

    selectElements(s, table, chart);
    expect(screen.getByText("2 selected elements do not support shadows and are left unchanged.")).toBeTruthy();
  });

  it("paints the shadow tiles", async () => {
    const s = shape();
    openElements([s], { selected: [s] });
    const { container } = openEffects();
    await waitFor(() => {
      const canvases = Array.from(container.querySelectorAll("canvas"));
      expect(canvases).toHaveLength(5);
      expect(canvases.every((c) => (contextOf(c)?.calls.length ?? 0) > 0)).toBe(true);
    });
  });
});

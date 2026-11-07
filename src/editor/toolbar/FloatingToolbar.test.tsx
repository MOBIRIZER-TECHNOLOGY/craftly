import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createFrame, createGraphic, createGroup, createImage, createLine, createShape, createTable, createText } from "@/core/factory";
import type { DesignElement, GraphicElement, GroupElement, ImageElement, LineElement, ShapeElement } from "@/core/types";
import { useGesture } from "@/editor/canvas/gestureStore";
import { ContextHost, live, openElements, paintOrder, selectElements, store, typeNumber } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";
import { FloatingToolbar } from "./FloatingToolbar";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
  useGesture.setState({ active: false });
});
afterEach(() => {
  restoreLayout();
  useGesture.setState({ active: false });
});

const mount = (elements: DesignElement[], selected: Array<DesignElement | string> = elements) => {
  openElements(elements, { selected });
  return render(
    <>
      <FloatingToolbar />
      <ContextHost />
    </>,
  );
};
const bar = () => screen.getByRole("toolbar");
const kind = () => bar().getAttribute("data-cf-toolbar");
const btn = (name: string | RegExp) => within(bar()).getByRole("button", { name }) as HTMLButtonElement;
const has = (name: string | RegExp) => within(bar()).queryByRole("button", { name }) !== null;
const names = () =>
  within(bar())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");
const box = (extra: Partial<ShapeElement> = {}) => createShape("rect", { x: 100, y: 100, width: 200, height: 100, ...extra });
const photo = (extra: Partial<ImageElement> = {}) =>
  createImage({ src: "https://example.test/p.jpg", x: 50, y: 50, width: 300, height: 200, naturalWidth: 600, naturalHeight: 400, ...extra });

describe("which toolbar a selection gets", () => {
  it("shows page controls when nothing is selected", async () => {
    const user = userEvent.setup();
    mount([box()], []);
    expect(screen.getByRole("toolbar", { name: "Page controls" })).toBeTruthy();
    expect(kind()).toBe("page");
    expect(names()).toEqual(["Background color", "Animate"]);
    await user.click(btn("Background color"));
    expect(store().context).toEqual({ kind: "background" });
    expect(pressed(btn("Background color"))).toBe("true");
    await user.click(btn("Animate"));
    expect(store().context).toEqual({ kind: "animate", tab: "page" });
    await user.click(btn("Animate"));
    expect(store().context).toBeNull();
  });

  it("shows the swatch of the page background", () => {
    const page = {
      type: "linear" as const,
      angle: 45,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    openElements([box()], { selected: [] });
    act(() => store().actions.setPageBackground(page));
    render(<FloatingToolbar />);
    expect((btn("Background color").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toBe("linear-gradient(45deg, #ff0000 0%, #0000ff 100%)");
  });

  it("follows the selection from kind to kind", () => {
    const [text, shape, line, icon, group, table, chart] = [
      createText({ text: "T", x: 10, y: 10 }),
      box(),
      createLine({ x: 10, y: 300 }),
      createGraphic({ svg: '<svg viewBox="0 0 10 10"><path fill="#ff0000" d="M0 0h10v10z"/></svg>', x: 500, y: 100 }),
      createGroup([createShape("rect", { width: 10, height: 10 })], { x: 600, y: 100, width: 10, height: 10 }),
      createTable({ x: 0, y: 400 }),
      createChart({ x: 0, y: 300 }),
    ];
    const frame = createFrame("rect", { x: 700, y: 100 });
    const picture = photo();
    const locked = box({ locked: true });
    mount([text, shape, line, icon, group, table, chart, frame, picture, locked], []);
    const expectations: Array<[string[], string, string]> = [
      [[text.id], "text", "Selected element common controls"],
      [[shape.id], "shape", "Selected element common controls"],
      [[line.id], "line", "Selected element common controls"],
      [[icon.id], "graphic", "Selected element common controls"],
      [[group.id], "group", "Selected element common controls"],
      [[table.id], "data", "Selected element common controls"],
      [[chart.id], "data", "Selected element common controls"],
      [[frame.id], "frame", "Selected element common controls"],
      [[picture.id], "image", "Selected element common controls"],
      [[text.id, shape.id], "multi", "Selected element common controls"],
      [[shape.id, icon.id], "multi", "Selected element common controls"],
      [[locked.id], "locked", "Locked element controls"],
      [[], "page", "Page controls"],
    ];
    for (const [selection, expectedKind, label] of expectations) {
      selectElements(...selection);
      expect(kind(), JSON.stringify(selection)).toBe(expectedKind);
      expect(screen.getByRole("toolbar", { name: label })).toBeTruthy();
    }
  });

  it("acts on the unlocked elements of a selection that includes locked ones", () => {
    const [free, fixed] = [createText({ text: "free" }), createText({ text: "fixed", locked: true })];
    mount([free, fixed], [free, fixed]);
    expect(kind()).toBe("text");
    expect(has("Bold")).toBe(true);
  });

  it("hides while an element is dragged, in view mode and while presenting", () => {
    mount([box()]);
    expect(kind()).toBe("shape");
    act(() => useGesture.setState({ active: true }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useGesture.setState({ active: false }));
    expect(kind()).toBe("shape");
    act(() => store().actions.setPresenting(true));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => store().actions.setPresenting(false));
    act(() => store().actions.setMode("view"));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("shows nothing before a design is open", () => {
    render(<FloatingToolbar />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("shape toolbar", () => {
  it("lists the controls of a rectangle, and leaves out the corner radius of other shapes", () => {
    const rect = box();
    mount([rect, createShape("ellipse", { x: 400, y: 100, width: 100, height: 100 })], [rect]);
    expect(names()).toEqual(["Fill color", "Border", "Corner radius", "Transparency", "Effects", "Flip", "Animate", "Position", "Copy style", "More actions"]);
    selectElements(store().design!.pages[0].elements[1]);
    expect(has("Corner radius")).toBe(false);
    expect(has("Border")).toBe(true);
  });

  it("opens the colour panel from the fill swatch and shows the fill colour in it", async () => {
    const user = userEvent.setup();
    const s = box({ fill: { type: "solid", color: "#336699" } });
    mount([s]);
    const swatch = btn("Fill color").querySelector(".cf-tb__swatch") as HTMLElement;
    expect(swatch.style.getPropertyValue("--cf-sw")).toBe("#336699");
    await user.click(btn("Fill color"));
    expect(store().context).toEqual({ kind: "color", target: "fill" });
    expect(pressed(btn("Fill color"))).toBe("true");
    expect(screen.getByRole("region", { name: "Fill color" })).toBeTruthy();
  });

  it("shows a rainbow for different fills and a crossed-out swatch for no fill", () => {
    const [a, b] = [box({ fill: { type: "solid", color: "#ff0000" } }), box({ fill: { type: "solid", color: "#00ff00" } })];
    const view = mount([a, b]);
    expect((btn("Fill color").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toContain("conic-gradient");
    view.unmount();
    resetEditor();
    const none = box({ fill: null as never });
    mount([none]);
    expect((btn("Fill color").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toContain("var(--c-danger)");
  });

  it("sets border style, weight and colour from one popover", async () => {
    const user = userEvent.setup();
    const s = box();
    mount([s]);
    await user.click(btn("Border"));
    const dialog = () => screen.getByRole("dialog", { name: "Border" });
    const styles = () => within(dialog()).getByRole("radiogroup", { name: "Border style" });
    expect(within(styles()).getByRole("radio", { name: "No border" }).getAttribute("aria-checked")).toBe("true");

    await user.click(within(styles()).getByRole("radio", { name: "Dashed" }));
    expect(live<ShapeElement>(s).stroke).toMatchObject({ style: "dashed", cap: "butt", width: 2 });
    await user.click(within(styles()).getByRole("radio", { name: "Dotted" }));
    expect(live<ShapeElement>(s).stroke).toMatchObject({ style: "dotted", cap: "round" });
    await user.click(within(styles()).getByRole("radio", { name: "Solid" }));
    expect(live<ShapeElement>(s).stroke?.style).toBe("solid");
    expect(live<ShapeElement>(s).stroke).not.toHaveProperty("cap");
    // a border makes the button look "on" even when its popover is closed
    await user.keyboard("{Escape}");
    expect(btn("Border").classList.contains("is-active")).toBe(true);
    await user.click(btn("Border"));

    await typeNumber(user, within(dialog()).getByRole("spinbutton", { name: "Border weight value" }), "9");
    expect(live<ShapeElement>(s).stroke?.width).toBe(9);
    await user.click(within(styles()).getByRole("radio", { name: "No border" }));
    expect(live<ShapeElement>(s).stroke).toBeNull();
    await user.keyboard("{Escape}");
    expect(btn("Border").classList.contains("is-active")).toBe(false);
    await user.click(btn("Border"));

    // a weight without a border makes a solid one
    await typeNumber(user, within(dialog()).getByRole("spinbutton", { name: "Border weight value" }), "5");
    expect(live<ShapeElement>(s).stroke).toMatchObject({ width: 5, style: "solid" });
  });

  it("makes a border before it opens the colour panel for it", async () => {
    const user = userEvent.setup();
    const s = box();
    mount([s]);
    await user.click(btn("Border"));
    await user.click(within(screen.getByRole("dialog", { name: "Border" })).getByRole("button", { name: "Color" }));
    expect(live<ShapeElement>(s).stroke).toMatchObject({ style: "solid", width: 2 });
    expect(store().context).toEqual({ kind: "color", target: "stroke" });
    // the popover closed itself
    expect(screen.queryByRole("dialog", { name: "Border" })).toBeNull();
  });

  it("keeps an existing border when the colour is chosen and shows mixed colours", async () => {
    const user = userEvent.setup();
    const [a, b] = [box({ stroke: { color: "#ff0000", width: 4, style: "solid" } }), box({ stroke: { color: "#0000ff", width: 8, style: "dashed", cap: "butt" } })];
    mount([a, b]);
    await user.click(btn("Border"));
    const dialog = screen.getByRole("dialog", { name: "Border" });
    expect((within(dialog).getByRole("button", { name: "Color" }).querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toContain("conic-gradient");
    expect((within(dialog).getByRole("spinbutton", { name: "Border weight value" }) as HTMLInputElement).value).toBe("");
    await user.click(within(dialog).getByRole("button", { name: "Color" }));
    expect(live<ShapeElement>(a).stroke?.width).toBe(4);
    expect(store().context).toEqual({ kind: "color", target: "stroke" });
  });

  it("rounds the corners of a rectangle up to half its shortest side", async () => {
    const user = userEvent.setup();
    const s = box();
    mount([s]);
    await user.click(btn("Corner radius"));
    const dialog = screen.getByRole("dialog", { name: "Corner radius" });
    expect(within(dialog).getByRole("slider", { name: "Corner radius" }).getAttribute("aria-valuemax")).toBe("50");
    await typeNumber(user, within(dialog).getByRole("spinbutton", { name: "Corner radius value" }), "30");
    expect(live<ShapeElement>(s).radius).toBe(30);
    await typeNumber(user, within(dialog).getByRole("spinbutton", { name: "Corner radius value" }), "500");
    expect(live<ShapeElement>(s).radius).toBe(50);
  });

  it("changes the transparency of several shapes at once", async () => {
    const user = userEvent.setup();
    const [a, b] = [box({ opacity: 0.2 }), box({ opacity: 0.8 })];
    mount([a, b]);
    await user.click(btn("Transparency"));
    const field = screen.getByRole("spinbutton", { name: "Transparency value" }) as HTMLInputElement;
    expect(field.value).toBe("");
    await typeNumber(user, field, "50");
    expect(live<ShapeElement>(a).opacity).toBe(0.5);
    expect(live<ShapeElement>(b).opacity).toBe(0.5);
  });

  it("flips the shape in either direction", async () => {
    const user = userEvent.setup();
    const s = box();
    mount([s]);
    await user.click(btn("Flip"));
    await user.click(screen.getByRole("menuitem", { name: "Flip horizontal" }));
    expect(live<ShapeElement>(s).flipH).toBe(true);
    await user.click(btn("Flip"));
    await user.click(screen.getByRole("menuitem", { name: "Flip vertical" }));
    expect(live<ShapeElement>(s).flipV).toBe(true);
  });

  it("aligns and groups several shapes, and distributes three", async () => {
    const user = userEvent.setup();
    const [a, b, c] = [box({ x: 0 }), box({ x: 300 }), box({ x: 900 })];
    mount([a, b, c]);
    await user.click(btn("Align"));
    expect(screen.getByRole("menuitem", { name: /Distribute horizontally/ }).getAttribute("aria-disabled")).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /Distribute horizontally/ }));
    expect(live<ShapeElement>(b).x).toBeCloseTo(450 - 0, 0);
    await user.click(btn("Align"));
    await user.click(screen.getByRole("menuitem", { name: /Distribute vertically/ }));
    await user.click(btn("Align"));
    await user.click(screen.getByRole("menuitem", { name: "Bottom" }));
    await user.click(btn("Group"));
    expect(live<GroupElement>(store().selection[0]).children).toHaveLength(3);
  });
});

describe("line toolbar", () => {
  it("lists the controls of a line", () => {
    mount([createLine({ x: 10, y: 10 })]);
    expect(names()).toEqual(["Line color", "Line weight", "Line style", "Start arrowhead", "End arrowhead", "Transparency", "Animate", "Position", "Copy style", "More actions"]);
  });

  it("opens the colour panel for the stroke, sets the weight and the style", async () => {
    const user = userEvent.setup();
    const l = createLine({ x: 10, y: 10, stroke: { color: "#aa00aa", width: 6, style: "solid", cap: "round" } });
    mount([l]);
    expect((btn("Line color").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toBe("#aa00aa");
    await user.click(btn("Line color"));
    expect(store().context).toEqual({ kind: "color", target: "stroke" });

    await user.click(btn("Line weight"));
    await typeNumber(user, screen.getByRole("spinbutton", { name: "Weight value" }), "20");
    expect(live<LineElement>(l).stroke.width).toBe(20);
    await user.keyboard("{Escape}");

    await user.click(btn("Line style"));
    expect(screen.getByRole("menuitemcheckbox", { name: "Solid" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Dashed" }));
    expect(live<LineElement>(l).stroke).toMatchObject({ style: "dashed", cap: "butt", width: 20 });
    await user.click(btn("Line style"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Dotted" }));
    expect(live<LineElement>(l).stroke.cap).toBe("round");
    await user.click(btn("Line style"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Solid" }));
    expect(live<LineElement>(l).stroke).toMatchObject({ style: "solid", cap: "round" });
  });

  it("puts arrowheads on both ends", async () => {
    const user = userEvent.setup();
    const l = createLine({ x: 10, y: 10 });
    mount([l]);
    await user.click(btn("Start arrowhead"));
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(8);
    expect(screen.getByRole("menuitemcheckbox", { name: "None" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Triangle" }));
    expect(live<LineElement>(l).startArrow).toBe("triangle");
    await user.click(btn("End arrowhead"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Open arrow" }));
    expect(live<LineElement>(l).endArrow).toBe("open-arrow");
    await user.click(btn("Start arrowhead"));
    expect(screen.getByRole("menuitemcheckbox", { name: "Triangle" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows mixed lines as unchecked and a rainbow colour", async () => {
    const user = userEvent.setup();
    const [a, b] = [
      createLine({ stroke: { color: "#ff0000", width: 2, style: "solid" }, startArrow: "arrow", endArrow: "circle" }),
      createLine({ stroke: { color: "#00ff00", width: 4, style: "dashed" }, startArrow: "none", endArrow: "bar" }),
    ];
    mount([a, b]);
    expect((btn("Line color").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toContain("conic-gradient");
    await user.click(btn("Line style"));
    expect(screen.getAllByRole("menuitemcheckbox").every((i) => i.getAttribute("aria-checked") === "false")).toBe(true);
    await user.keyboard("{Escape}");
    await user.click(btn("Start arrowhead"));
    expect(screen.getAllByRole("menuitemcheckbox").every((i) => i.getAttribute("aria-checked") === "false")).toBe(true);
    await user.keyboard("{Escape}");
    await user.click(btn("End arrowhead"));
    expect(screen.getAllByRole("menuitemcheckbox").every((i) => i.getAttribute("aria-checked") === "false")).toBe(true);
  });
});

describe("image toolbar", () => {
  it("lists the controls of a photo", () => {
    mount([photo()]);
    expect(names()).toEqual(["Edit image", "Crop", "Flip", "Corner radius", "Border", "Transparency", "Effects", "Animate", "Position", "Replace", "Copy style", "More actions"]);
  });

  it("rounds the corners of a photo that has no mask of its own", () => {
    mount([photo({ mask: undefined })]);
    expect(has("Corner radius")).toBe(true);
  });

  it("leaves out the corner radius for a shaped photo and crop and replace for several", () => {
    mount([photo({ mask: "ellipse" })]);
    expect(has("Corner radius")).toBe(false);
    const [a, b] = [photo(), photo({ x: 400 })];
    openElements([a, b], { selected: [a, b] });
    expect(has("Crop")).toBe(false);
    expect(has("Replace")).toBe(false);
    expect(has("Align")).toBe(true);
  });

  it("flips a photo", async () => {
    const user = userEvent.setup();
    const p = photo();
    mount([p]);
    await user.click(btn("Flip"));
    await user.click(screen.getByRole("menuitem", { name: "Flip horizontal" }));
    expect(live<ImageElement>(p).flipH).toBe(true);
    expect(live<ImageElement>(p).flipV).toBeFalsy();
  });

  it("opens the filters panel", async () => {
    const user = userEvent.setup();
    mount([photo()]);
    await user.click(btn("Edit image"));
    expect(store().context).toEqual({ kind: "filters", tab: "filters" });
    expect(pressed(btn("Edit image"))).toBe("true");
    expect(screen.getByRole("region", { name: "Filters" })).toBeTruthy();
  });

  it("crops: zoom slider, reset and Done", async () => {
    const user = userEvent.setup();
    const p = photo();
    mount([p]);
    await user.click(btn("Crop"));
    expect(store().croppingId).toBe(p.id);
    expect(screen.getByRole("toolbar", { name: "Crop controls" })).toBeTruthy();
    expect(kind()).toBe("crop");
    expect(screen.getByText("100%")).toBeTruthy();

    screen.getByRole("slider", { name: "Crop zoom" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(live<ImageElement>(p).crop.w).toBeGreaterThan(1);
    expect(screen.getByText("102%")).toBeTruthy();
    await user.click(btn("Reset crop"));
    expect(live<ImageElement>(p).crop.w).toBeCloseTo(1);
    await user.click(btn("Done"));
    expect(store().croppingId).toBeNull();
    expect(kind()).toBe("image");
  });

  it("only offers to upload into an empty frame", async () => {
    const user = userEvent.setup();
    const frame = createFrame("ellipse", { x: 100, y: 100 });
    mount([frame]);
    expect(kind()).toBe("frame");
    expect(names()).toEqual(["Upload", "Animate", "Position", "More actions"]);
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    await user.click(btn("Upload"));
    expect(click).toHaveBeenCalledTimes(1);
    const input = click.mock.contexts[0] as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
  });

  it("opens the picture chooser from Replace", async () => {
    const user = userEvent.setup();
    mount([photo()]);
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    await user.click(btn("Replace"));
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("graphic toolbar", () => {
  const colourful = () =>
    createGraphic({
      svg: '<svg viewBox="0 0 10 10"><path fill="#ff0000" d="M0 0h5v5z"/><path fill="#00ff00" d="M5 5h5v5z"/><path fill="#0000ff" d="M0 5h5v5z"/></svg>',
      x: 100,
      y: 100,
    });
  const outline = () => createGraphic({ svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12h16"/></svg>', x: 100, y: 100 });

  it("offers a swatch for each colour of the picture", async () => {
    const user = userEvent.setup();
    const g = colourful();
    mount([g]);
    expect(names().filter((n) => /^Color \d/.test(n))).toEqual(["Color 1", "Color 2", "Color 3"]);
    expect(has("Stroke width")).toBe(false);
    await user.click(btn("Color 2"));
    expect(store().context).toEqual({ kind: "color", target: "graphic", key: "#00ff00" });
    expect(pressed(btn("Color 2"))).toBe("true");
    expect(pressed(btn("Color 1"))).toBe("false");
    await user.click(btn("Color 2"));
    expect(store().context).toBeNull();
  });

  it("shows the recoloured swatch and the ink colour for outline icons", () => {
    const g = outline();
    g.colors = {};
    mount([g]);
    expect((btn("Color 1").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toBe("var(--c-ink)");
    act(() => store().actions.updateElements([g.id], { colors: { currentColor: "#abcdef" } }));
    expect((btn("Color 1").querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw")).toBe("#abcdef");
  });

  it("changes the stroke width of an outline icon", async () => {
    const user = userEvent.setup();
    const g = outline();
    mount([g]);
    await user.click(btn("Stroke width"));
    const field = screen.getByRole("spinbutton", { name: "Stroke width value" }) as HTMLInputElement;
    expect(field.value).toBe("3");
    await typeNumber(user, field, "1.5");
    expect(live<GraphicElement>(g).strokeWidth).toBe(1.5);
    expect(btn("Color 1")).toBeTruthy();
  });

  it("reads an outline icon that does not say how thick its line is as 2", async () => {
    const user = userEvent.setup();
    const g = createGraphic({ svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12h16"/></svg>', x: 100, y: 100 });
    mount([g]);
    await user.click(btn("Stroke width"));
    expect((screen.getByRole("spinbutton", { name: "Stroke width value" }) as HTMLInputElement).value).toBe("2");
  });

  it("shows no swatches for several graphics, but the shared controls", () => {
    const [a, b] = [colourful(), outline()];
    mount([a, b]);
    expect(names().some((n) => /^Color \d/.test(n))).toBe(false);
    expect(has("Group")).toBe(true);
    expect(has("Stroke width")).toBe(false);
  });
});

describe("other toolbars", () => {
  it("ungroups a group", async () => {
    const user = userEvent.setup();
    const inner = [createShape("rect", { width: 10, height: 10 }), createShape("rect", { x: 20, width: 10, height: 10 })];
    const g = createGroup(inner, { x: 100, y: 100, width: 40, height: 20 });
    mount([g]);
    expect(names()).toEqual(["Ungroup", "Transparency", "Animate", "Position", "More actions"]);
    await user.click(btn("Ungroup"));
    expect(paintOrder()).toHaveLength(2);
    expect(store().selection).toHaveLength(2);
  });

  it("opens the data panel for a table and a chart", async () => {
    const user = userEvent.setup();
    const [table, chart] = [createTable({ x: 0, y: 0 }), createChart({ x: 0, y: 300 })];
    mount([table, chart], [table]);
    expect(names()).toEqual(["Edit data", "Transparency", "Animate", "Position", "More actions"]);
    await user.click(btn("Edit data"));
    expect(store().context).toEqual({ kind: "data" });
    expect(pressed(btn("Edit data"))).toBe("true");
    expect(screen.getByRole("region", { name: "Table" })).toBeTruthy();
    selectElements(chart);
    expect(screen.getByRole("region", { name: "Chart" })).toBeTruthy();
    await user.click(btn("Edit data"));
    expect(store().context).toBeNull();
  });

  it("only unlocks a locked selection", async () => {
    const user = userEvent.setup();
    const s = box({ locked: true });
    mount([s]);
    expect(names()).toEqual(["Unlock", "More actions"]);
    await user.click(btn("Unlock"));
    expect(live<ShapeElement>(s).locked).toBe(false);
    expect(kind()).toBe("shape");
  });

  it("groups and aligns elements of different kinds", async () => {
    const user = userEvent.setup();
    const [s, t] = [box(), createText({ text: "x", x: 500, y: 300 })];
    mount([s, t]);
    expect(names()).toEqual(["Group", "Align", "Transparency", "Animate", "Position", "More actions"]);
    await user.click(btn("Group"));
    expect(store().selection).toHaveLength(1);
  });
});

describe("toolbar frame", () => {
  const layout = (scrollWidth: number) => {
    // the stubbed layout reports a 1000px wide scroller
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  };
  const scroller = () => bar().querySelector(".cf-tb__scroll") as HTMLElement;

  it("fades the edge where more buttons are hidden", () => {
    layout(1800);
    mount([box()]);
    expect(scroller().getAttribute("data-fade")).toBe("r");
    scroller().scrollLeft = 400;
    fireEvent.scroll(scroller());
    expect(scroller().getAttribute("data-fade")).toBe("lr");
    scroller().scrollLeft = 800;
    fireEvent.scroll(scroller());
    expect(scroller().getAttribute("data-fade")).toBe("l");
  });

  it("has no fade when everything fits", () => {
    layout(900);
    mount([box()]);
    expect(scroller().hasAttribute("data-fade")).toBe(false);
  });

  it("scrolls sideways with the mouse wheel when the buttons do not fit", () => {
    layout(1800);
    mount([box()]);
    fireEvent.wheel(scroller(), { deltaY: 120 });
    expect(scroller().scrollLeft).toBe(120);
    // a sideways wheel is left to the browser
    fireEvent.wheel(scroller(), { deltaX: 200, deltaY: 10 });
    expect(scroller().scrollLeft).toBe(120);
  });

  it("does not scroll when the buttons fit", () => {
    layout(900);
    mount([box()]);
    fireEvent.wheel(scroller(), { deltaY: 120 });
    expect(scroller().scrollLeft).toBe(0);
  });

  it("keeps keys pressed in the toolbar away from the canvas shortcuts, except Escape and Ctrl combinations", () => {
    mount([box()]);
    const seen: string[] = [];
    const listener = (e: KeyboardEvent) => void seen.push(e.key + (e.ctrlKey ? "+ctrl" : ""));
    window.addEventListener("keydown", listener);
    fireEvent.keyDown(btn("Position"), { key: "ArrowRight" });
    fireEvent.keyDown(btn("Position"), { key: "Delete" });
    expect(seen).toEqual([]);
    fireEvent.keyDown(btn("Position"), { key: "Escape" });
    fireEvent.keyDown(btn("Position"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    window.removeEventListener("keydown", listener);
    expect(seen).toEqual(["Escape", "z+ctrl", "ArrowLeft"]);
  });
});

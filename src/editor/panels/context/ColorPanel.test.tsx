import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createGraphic, createShape, createTable, createText } from "@/core/factory";
import { getRecentColors, setBrandKit } from "@/core/library";
import type { ContextPanelState } from "@/core/store";
import type { ChartElement, GraphicElement, ShapeElement, TextElement } from "@/core/types";
import { DEFAULT_GRADIENTS, DEFAULT_SOLID_COLORS } from "@/data/palettes";
import { registerTextEditor, useTextSelectionStyle } from "@/editor/canvas/textEditing";
import { live, openElements, selectElements, showPanel, store } from "@/test/ctxUtils";
import { clearLibrary, flush, resetEditor } from "@/test/helpers";
import { ColorField } from "./ColorField";

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
});
afterEach(() => {
  registerTextEditor(null);
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
  vi.unstubAllGlobals();
});

const text = (extra: Partial<TextElement> = {}) => createText({ text: "Colour me", color: "#101010", x: 50, y: 50, ...extra });
const openColor = async (target: ContextPanelState) => {
  const view = showPanel(target);
  await flush();
  return view;
};
/** the block under a heading (a heading's name includes its "Edit" / "See all" link, so match the start) */
const heading = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}`) });
const section = (title: string) => heading(title).parentElement as HTMLElement;
/** the colour swatches of a section (its "Edit" / "See all" / "Show all" links are buttons too, but not swatches) */
const swatchesIn = (title: string) =>
  within(section(title))
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("aria-pressed"));
const gradientSwatches = () => swatchesIn("Default gradient colors");

describe("Colour panel: what it offers", () => {
  it("explains what to select when the target has nothing to colour", async () => {
    const s = createShape("rect");
    openElements([s], { selected: [s] });
    await openColor({ kind: "color", target: "text" });
    expect(screen.getByRole("region", { name: "Text color" })).toBeTruthy();
    expect(screen.getByText("No text selected")).toBeTruthy();
    expect(screen.getByText("Select a text box to change its text color.")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("lists document colours, the brand kit, the default colours and gradients for text", async () => {
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    for (const title of ["Document colors", "Brand kit", "Default solid colors", "Default gradient colors"]) expect(heading(title)).toBeTruthy();
    // the colour the text has now is marked as the current one
    expect(within(section("Document colors")).getByRole("button", { name: "#101010" }).getAttribute("aria-pressed")).toBe("true");
    expect(swatchesIn("Default solid colors")).toHaveLength(DEFAULT_SOLID_COLORS.length);
    expect(gradientSwatches()).toHaveLength(18);
  });

  it("offers no gradients where the target cannot paint with one", async () => {
    const s = createShape("rect", { stroke: { color: "#112233", width: 4, style: "solid" } });
    openElements([s], { selected: [s] });
    await openColor({ kind: "color", target: "stroke" });
    expect(screen.getByRole("region", { name: "Border color" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Default gradient colors/ })).toBeNull();
  });

  it("shows the whole list of gradients on request", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await user.click(screen.getByRole("button", { name: "See all" }));
    expect(gradientSwatches()).toHaveLength(DEFAULT_GRADIENTS.length);
    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(gradientSwatches()).toHaveLength(18);
  });

  it("folds a long list of document colours behind 'Show all'", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 30 }, (_, i) => createShape("rect", { fill: { type: "solid", color: `#${(i + 1).toString(16).padStart(2, "0")}3050` } }));
    const t = text();
    openElements([t, ...many], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    const docs = () => swatchesIn("Document colors");
    // 21 slots: the "add a colour" button takes one
    expect(docs()).toHaveLength(20);
    // the text colour, 30 fills and the page's white
    await user.click(screen.getByRole("button", { name: "Show all 32 colors" }));
    expect(docs()).toHaveLength(32);
    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(docs()).toHaveLength(20);
  });
});

describe("Colour panel: choosing", () => {
  it("applies a colour to the text and remembers it as recently used", async () => {
    const user = userEvent.setup();
    const t = text({
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    expect(screen.queryByRole("heading", { name: /^Recently used/ })).toBeNull();
    await user.click(within(section("Default solid colors")).getByRole("button", { name: DEFAULT_SOLID_COLORS[5].toUpperCase() }));
    expect(live<TextElement>(t)).toMatchObject({ color: DEFAULT_SOLID_COLORS[5], gradient: null });
    await waitFor(() => expect(heading("Recently used")).toBeTruthy());
    expect(await getRecentColors()).toEqual([DEFAULT_SOLID_COLORS[5]]);
    expect(swatchesIn("Recently used")[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("applies a gradient to the text", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    const first = DEFAULT_GRADIENTS[0];
    const swatch = gradientSwatches()[0];
    expect(swatch.getAttribute("aria-label")).toBe(`Gradient ${first.stops.map((s) => s.color).join(" to ")}`);
    await user.click(swatch);
    expect(live<TextElement>(t).gradient).toEqual(first);
    expect(swatch.getAttribute("aria-pressed")).toBe("true");
  });

  it("searches colours by name and by hex code", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    const search = screen.getByRole("searchbox", { name: "Search colors" });
    await user.type(search, "blue");
    expect(heading("Search results")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Document colors/ })).toBeNull();
    const results = swatchesIn("Search results");
    expect(results.length).toBeGreaterThan(3);
    await user.click(results[1]);
    expect(live<TextElement>(t).color).toBe(results[1].getAttribute("aria-label")!.toLowerCase());

    await user.clear(search);
    await user.type(search, "#00c4cc");
    expect(swatchesIn("Search results")[0].getAttribute("aria-label")).toBe("#00C4CC");
    // Enter takes the first match
    await user.type(search, "{Enter}");
    expect(live<TextElement>(t).color).toBe("#00c4cc");
  });

  it("says when no colour matches and clears the search with Escape", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    const search = screen.getByRole("searchbox", { name: "Search colors" });
    await user.type(search, "zzzz");
    expect(screen.getByText(/No colors match/)).toBeTruthy();
    // Enter with no match does nothing
    await user.type(search, "{Enter}");
    expect(live<TextElement>(t).color).toBe("#101010");
    await user.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
    expect(heading("Document colors")).toBeTruthy();
  });

  it("picks a custom colour with the colour picker, as one undo step", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await user.click(screen.getByRole("button", { name: "Add a new color" }));
    const dialog = screen.getByRole("dialog", { name: "Pick a custom color" });
    const before = store().past.length;
    const hex = within(dialog).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "ff0000");
    expect(live<TextElement>(t).color).toBe("#ff0000");
    // arrow keys nudge the picker: brightness down makes the colour darker
    within(dialog).getByRole("slider", { name: "Saturation and brightness" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(live<TextElement>(t).color).not.toBe("#ff0000");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Pick a custom color" })).toBeNull();
    expect(store().past.length).toBeGreaterThan(before);
    await waitFor(async () => expect((await getRecentColors()).length).toBeGreaterThan(0));
    // the button toggles the picker
    await user.click(screen.getByRole("button", { name: "Add a new color" }));
    await user.click(screen.getByRole("button", { name: "Add a new color" }));
    expect(screen.queryByRole("dialog", { name: "Pick a custom color" })).toBeNull();
  });

  it("starts the custom picker from the colour the text has, or from a gradient's first colour", async () => {
    const user = userEvent.setup();
    const t = text({
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#00ff00" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await user.click(screen.getByRole("button", { name: "Add a new color" }));
    expect((screen.getByRole("textbox", { name: "Hex colour" }) as HTMLInputElement).value).toBe("00FF00");
  });

  it("takes a colour from the screen when the browser has an eyedropper, and ignores a cancelled pick", async () => {
    const user = userEvent.setup();
    let pick: () => Promise<{ sRGBHex: string }> = async () => ({ sRGBHex: "#123456" });
    vi.stubGlobal(
      "EyeDropper",
      class {
        open() {
          return pick();
        }
      },
    );
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await user.click(screen.getByRole("button", { name: "Pick a color from the screen" }));
    expect(live<TextElement>(t).color).toBe("#123456");
    pick = async () => {
      throw new DOMException("cancelled", "AbortError");
    };
    await user.click(screen.getByRole("button", { name: "Pick a color from the screen" }));
    expect(live<TextElement>(t).color).toBe("#123456");
  });

  it("has no eyedropper button in browsers without one", async () => {
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    expect(screen.queryByRole("button", { name: "Pick a color from the screen" })).toBeNull();
  });

  it("formats only the selected characters while text is being edited, and shows their colour as current", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    const applyInline = vi.fn(() => true);
    registerTextEditor({ applyInline, hasSelection: () => true, focus: () => undefined });
    const inline = DEFAULT_SOLID_COLORS[3];
    act(() => useTextSelectionStyle.setState({ active: true, collapsed: false, style: { color: inline } }));
    await openColor({ kind: "color", target: "text" });
    expect(within(section("Default solid colors")).getByRole("button", { name: inline.toUpperCase() }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(section("Default solid colors")).getByRole("button", { name: DEFAULT_SOLID_COLORS[7].toUpperCase() }));
    expect(applyInline).toHaveBeenCalledWith({ color: DEFAULT_SOLID_COLORS[7] });
    expect(live<TextElement>(t).color).toBe("#101010");
  });
});

describe("Colour panel: brand kit", () => {
  it("lists the brand colours and opens the Brand tab to edit them", async () => {
    const user = userEvent.setup();
    await setBrandKit({ colors: ["#0a0b0c", "#c0ffee"], fonts: [], logos: [] });
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await waitFor(() => expect(swatchesIn("Brand kit")).toHaveLength(2));
    await user.click(within(section("Brand kit")).getByRole("button", { name: "#C0FFEE" }));
    expect(live<TextElement>(t).color).toBe("#c0ffee");
    await user.click(within(section("Brand kit")).getByRole("button", { name: "Edit" }));
    expect(store().leftTab).toBe("brand");
    expect(store().context).toBeNull();
  });

  it("invites you to add brand colours when there are none", async () => {
    const user = userEvent.setup();
    await setBrandKit({ colors: [], fonts: [], logos: [] });
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await user.click(await screen.findByRole("button", { name: "Add your brand colors" }));
    expect(store().leftTab).toBe("brand");
  });

  it("follows changes made to the brand kit while the panel is open", async () => {
    const t = text();
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "text" });
    await setBrandKit({ colors: [], fonts: [], logos: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add your brand colors" })).toBeTruthy());
  });
});

describe("Colour panel: other targets", () => {
  it("fills a shape, and keeps the gradient swatches for it", async () => {
    const user = userEvent.setup();
    const s = createShape("rect");
    openElements([s], { selected: [s] });
    await openColor({ kind: "color", target: "fill" });
    expect(screen.getByRole("region", { name: "Fill color" })).toBeTruthy();
    await user.click(gradientSwatches()[2]);
    expect(live<ShapeElement>(s).fill?.type).toBe("linear");
    await user.click(within(section("Default solid colors")).getAllByRole("button")[0]);
    expect(live<ShapeElement>(s).fill).toEqual({ type: "solid", color: DEFAULT_SOLID_COLORS[0] });
  });

  it("colours the header of a table and a slot of a chart", async () => {
    const user = userEvent.setup();
    const table = createTable();
    const chart = createChart();
    openElements([table, chart], { selected: [table] });
    await openColor({ kind: "color", target: "table" });
    await user.click(within(section("Default solid colors")).getAllByRole("button")[4]);
    expect(live(table)).toMatchObject({ headerFill: DEFAULT_SOLID_COLORS[4] });
    selectElements(chart);
    act(() => store().actions.openContext({ kind: "color", target: "chart", key: "2" }));
    await user.click(within(section("Default solid colors")).getAllByRole("button")[6]);
    expect(live<ChartElement>(chart).palette[2]).toBe(DEFAULT_SOLID_COLORS[6]);
  });

  it("colours the page", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")]);
    await openColor({ kind: "color", target: "page" });
    expect(screen.getByRole("region", { name: "Page color" })).toBeTruthy();
    await user.click(within(section("Default solid colors")).getAllByRole("button")[8]);
    expect(store().design!.pages[0].background).toEqual({ type: "solid", color: DEFAULT_SOLID_COLORS[8] });
    await user.click(gradientSwatches()[0]);
    expect(store().design!.pages[0].background.type).toBe("linear");
  });

  it("recolours one colour of a graphic", async () => {
    const user = userEvent.setup();
    const g = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path fill="#ff8a65" d="M0 0h10v10z"/><circle fill="#222222" r="2"/></svg>' });
    openElements([g], { selected: [g] });
    await openColor({ kind: "color", target: "graphic", key: "#222222" });
    await user.click(within(section("Default solid colors")).getAllByRole("button")[10]);
    expect(live<GraphicElement>(g).colors).toEqual({ "#222222": DEFAULT_SOLID_COLORS[10] });
  });

  it("colours the shadow, the effect and the highlight of a text", async () => {
    const user = userEvent.setup();
    const t = text({ effect: { kind: "shadow", color: "#000000", offset: 50 } });
    openElements([t], { selected: [t] });
    await openColor({ kind: "color", target: "effect" });
    await user.click(within(section("Default solid colors")).getAllByRole("button")[2]);
    expect(live<TextElement>(t).effect).toMatchObject({ kind: "shadow", color: DEFAULT_SOLID_COLORS[2], offset: 50 });
    act(() => store().actions.openContext({ kind: "color", target: "highlight" }));
    await user.click(within(section("Default solid colors")).getAllByRole("button")[3]);
    expect(live<TextElement>(t).effect).toMatchObject({ kind: "background", color: DEFAULT_SOLID_COLORS[3] });
  });

  it("colours the shadow of a shape", async () => {
    const user = userEvent.setup();
    const s = createShape("rect", { shadow: { color: "rgba(0,0,0,0.4)", blur: 8, x: 4, y: 4 } });
    openElements([s], { selected: [s] });
    await openColor({ kind: "color", target: "shadow" });
    await user.click(within(section("Default solid colors")).getAllByRole("button")[1]);
    const color = live<ShapeElement>(s).shadow!.color;
    expect(color.startsWith("rgba(")).toBe(true);
    expect(color.endsWith(",0.4)")).toBe(true);
  });
});

describe("<ColorField>", () => {
  it("opens a picker from its swatch and reports drags and the final colour", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onOpenChange = vi.fn();
    render(<ColorField label="Header fill" value="#336699" onChange={onChange} onCommit={onCommit} onOpenChange={onOpenChange} />);
    const swatch = screen.getByRole("button", { name: "Header fill" });
    await user.click(swatch);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    const picker = screen.getByRole("dialog", { name: "Header fill picker" });
    const hex = within(picker).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "ff8800");
    expect(onChange).toHaveBeenCalledWith("#ff8800");
    expect(onCommit).toHaveBeenCalledWith("#ff8800");
    fireEvent.keyDown(hex, { key: "Escape" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Header fill picker" })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    // closing a picker settles an interrupted drag
    expect(onCommit.mock.calls.length).toBeGreaterThanOrEqual(2);
    await user.click(swatch);
    await user.click(swatch);
    expect(screen.queryByRole("dialog", { name: "Header fill picker" })).toBeNull();
  });
});

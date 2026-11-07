import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createDesign, createGraphic, createGroup, createImage, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { ChartElement, DesignElement, GraphicElement, ImageElement, LinearGradientFill, LineElement, ShapeElement, TableElement, TextElement } from "@/core/types";
import { registerTextEditor } from "@/editor/canvas/textEditing";
import { applyGradient, applySolid, describeTarget } from "./colorTargets";

const gradient: LinearGradientFill = {
  type: "linear",
  angle: 90,
  stops: [
    { offset: 0, color: "#ff0000" },
    { offset: 1, color: "#0000ff" },
  ],
};

/** Opens a 1000 x 600 design holding `elements` and selects `selected` (all of them by default). */
function load(elements: DesignElement[], selected: DesignElement[] = elements) {
  const { actions } = useEditor.getState();
  actions.openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ elements })] }));
  actions.select(selected.map((e) => e.id));
}
const find = <T extends DesignElement>(el: DesignElement) => getActivePage(useEditor.getState())!.elements.find((e) => e.id === el.id) as T;

beforeEach(() => useEditor.setState(useEditor.getInitialState(), true));
afterEach(() => registerTextEditor(null));

describe("applySolid", () => {
  it("colours selected text and drops its gradient", () => {
    const t = createText({ text: "x", gradient });
    load([t]);
    applySolid("text", undefined, "#112233");
    expect(find<TextElement>(t)).toMatchObject({ color: "#112233", gradient: null });
  });

  it("formats only the selected characters while a text box is being edited", () => {
    const t = createText({ text: "x", color: "#000000" });
    load([t]);
    const applyInline = vi.fn(() => true);
    registerTextEditor({ applyInline, hasSelection: () => true, focus: () => undefined });
    applySolid("text", undefined, "#abcdef");
    expect(applyInline).toHaveBeenCalledWith({ color: "#abcdef" });
    expect(find<TextElement>(t).color).toBe("#000000");
  });

  it("falls back to the whole box when the editor has only a caret", () => {
    const t = createText({ text: "x" });
    load([t]);
    registerTextEditor({ applyInline: () => false, hasSelection: () => false, focus: () => undefined });
    applySolid("text", undefined, "#abcdef");
    expect(find<TextElement>(t).color).toBe("#abcdef");
  });

  it("turns a highlight on with a colour, then only recolours it", () => {
    const t = createText({ text: "x" });
    load([t]);
    applySolid("highlight", undefined, "#ffee00");
    expect(find<TextElement>(t).effect).toMatchObject({ kind: "background", color: "#ffee00", roundness: 50 });
    useEditor.getState().actions.setTextProps(null, { effect: { kind: "background", color: "#ffee00", roundness: 10, spread: 5 } });
    applySolid("highlight", undefined, "#00ffee");
    expect(find<TextElement>(t).effect).toMatchObject({ kind: "background", color: "#00ffee", roundness: 10, spread: 5 });
  });

  it("recolours the effect of text, also inside a group", () => {
    const inner = createText({ text: "in", effect: { kind: "outline", color: "#000000", thickness: 20 } });
    const g = createGroup([createShape("rect"), inner], { width: 100, height: 100 });
    load([g]);
    applySolid("effect", undefined, "#336699");
    expect((find<ReturnType<typeof createGroup>>(g).children[1] as TextElement).effect).toMatchObject({ kind: "outline", color: "#336699", thickness: 20 });
  });

  it("fills shapes with a solid colour and tables with a header colour", () => {
    const s = createShape("rect", { fill: gradient });
    const table = createTable();
    load([s, table]);
    applySolid("fill", undefined, "#112233");
    expect(find<ShapeElement>(s).fill).toEqual({ type: "solid", color: "#112233" });
    expect(find<TableElement>(table).headerFill).toBe("#112233");
  });

  it("only touches what the target is about", () => {
    const s = createShape("rect", { fill: solid("#000000") });
    const table = createTable();
    load([s, table]);
    applySolid("table", undefined, "#445566");
    expect(find<ShapeElement>(s).fill).toEqual({ type: "solid", color: "#000000" });
    expect(find<TableElement>(table).headerFill).toBe("#445566");
  });

  it("colours the chart slot named by the key, and the series that owns that slot", () => {
    const chart = createChart({
      series: [
        { name: "a", values: [1], color: "#111111" },
        { name: "b", values: [2] },
      ],
    });
    load([chart]);
    applySolid("chart", "1", "#aa0000");
    expect(find<ChartElement>(chart).palette[1]).toBe("#aa0000");
    expect(find<ChartElement>(chart).series[0].color).toBe("#111111");
    applySolid("fill", "0", "#00aa00");
    expect(find<ChartElement>(chart).palette[0]).toBe("#00aa00");
    expect(find<ChartElement>(chart).series[0].color).toBe("#00aa00");
    // a key beyond the palette wraps around, and a broken key means the first slot
    applySolid("chart", "6", "#0000aa");
    expect(find<ChartElement>(chart).palette[0]).toBe("#0000aa");
    applySolid("chart", "x", "#0a0a0a");
    expect(find<ChartElement>(chart).palette[0]).toBe("#0a0a0a");
  });

  it("gives a shape, a line and a photo a border colour and keeps the width they have", () => {
    const s = createShape("rect");
    const l = createLine({ stroke: { color: "#000000", width: 9, style: "dashed" } });
    const photo = createImage({ src: "x", width: 100, height: 100 });
    load([s, l, photo]);
    applySolid("stroke", undefined, "#cc0000");
    // no border yet: a visible one is made, about 0.4% of the shorter side
    expect(find<ShapeElement>(s).stroke).toEqual({ color: "#cc0000", width: 2, style: "solid" });
    expect(find<LineElement>(l).stroke).toEqual({ color: "#cc0000", width: 9, style: "dashed" });
    expect(find<ImageElement>(photo).stroke?.color).toBe("#cc0000");
  });

  it("colours the shadow and keeps its opacity, or makes one when there is none", () => {
    const withShadow = createShape("rect", { shadow: { color: "rgba(0,0,0,0.5)", blur: 4, x: 2, y: 2 } });
    const without = createShape("rect");
    load([withShadow, without]);
    applySolid("shadow", undefined, "#ff0000");
    expect(find<ShapeElement>(withShadow).shadow).toEqual({ color: "rgba(255,0,0,0.5)", blur: 4, x: 2, y: 2 });
    expect(find<ShapeElement>(without).shadow?.color).toBe("rgba(255,0,0,0.45)");
    // text cannot carry this kind of shadow
    const t = createText({ text: "x" });
    load([t]);
    applySolid("shadow", undefined, "#ff0000");
    expect(find<TextElement>(t)).not.toHaveProperty("shadow");
  });

  it("changes the page colour", () => {
    load([createShape("rect")], []);
    applySolid("page", undefined, "#fafafa");
    expect(getActivePage(useEditor.getState())!.background).toEqual({ type: "solid", color: "#fafafa" });
  });

  it("recolours one colour of a graphic, the first one when no key is given", () => {
    const g = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path fill="#ff8a65" d="M0 0h10v10z"/><circle fill="#222222" r="2"/></svg>' });
    load([g]);
    applySolid("graphic", "#222222", "#00ff00");
    expect(find<GraphicElement>(g).colors).toEqual({ "#222222": "#00ff00" });
    applySolid("graphic", undefined, "#0000ff");
    expect(find<GraphicElement>(g).colors).toEqual({ "#222222": "#00ff00", "#ff8a65": "#0000ff" });
    // other kinds of element are ignored
    const s = createShape("rect");
    load([s]);
    applySolid("graphic", undefined, "#0000ff");
    expect(find<ShapeElement>(s).fill).toEqual({ type: "solid", color: "#0e1318" });
  });
});

describe("applyGradient", () => {
  it("paints text, shapes and the page with a gradient", () => {
    const t = createText({ text: "x" });
    const s = createShape("rect");
    load([t, s]);
    applyGradient("text", undefined, gradient);
    applyGradient("fill", undefined, gradient);
    applyGradient("page", undefined, gradient);
    expect(find<TextElement>(t).gradient).toEqual(gradient);
    expect(find<TextElement>(t).gradient).not.toBe(gradient);
    expect(find<ShapeElement>(s).fill).toEqual(gradient);
    expect(getActivePage(useEditor.getState())!.background).toEqual(gradient);
  });

  it("uses the first colour of the gradient for tables and charts, which have no gradients", () => {
    const table = createTable();
    const chart = createChart();
    load([table, chart]);
    applyGradient("fill", "2", gradient);
    expect(find<TableElement>(table).headerFill).toBe("#ff0000");
    expect(find<ChartElement>(chart).palette[2]).toBe("#ff0000");
    const empty: LinearGradientFill = { ...gradient, stops: [] };
    applyGradient("fill", "0", empty);
    expect(find<ChartElement>(chart).palette[0]).toBe("#7c3aed");
    expect(find<TableElement>(table).headerFill).toBe("#ff0000");
  });

  it("ignores targets without gradients", () => {
    const s = createShape("rect", { stroke: { color: "#000000", width: 2, style: "solid" } });
    load([s]);
    applyGradient("stroke", undefined, gradient);
    expect(find<ShapeElement>(s).stroke?.color).toBe("#000000");
  });
});

describe("describeTarget for tables, charts and borders", () => {
  const page = createPage();

  it("reads the header colour of a table and the palette slot of a chart", () => {
    const table = createTable({ headerFill: "#123456" });
    const chart = createChart({ palette: ["#111111", "#222222"] });
    expect(describeTarget("table", undefined, [table], page)).toMatchObject({ supported: true, current: { type: "solid", color: "#123456" } });
    expect(describeTarget("fill", undefined, [table], page)).toMatchObject({ supported: true, gradients: false, current: { type: "solid", color: "#123456" } });
    expect(describeTarget("chart", "1", [chart], page)).toMatchObject({ supported: true, current: { type: "solid", color: "#222222" } });
    expect(describeTarget("fill", "3", [chart], page).current).toEqual({ type: "solid", color: "#222222" });
    expect(describeTarget("chart", undefined, [table], page).supported).toBe(false);
    expect(describeTarget("table", undefined, [chart], page).supported).toBe(false);
  });

  it("reads borders and shadows, and has nothing for what has none", () => {
    const photo = createImage({ src: "x", stroke: { color: "#445566", width: 3, style: "solid" } });
    const bare = createShape("rect");
    expect(describeTarget("stroke", undefined, [photo], page).current).toEqual({ type: "solid", color: "#445566" });
    expect(describeTarget("stroke", undefined, [bare], page)).toMatchObject({ supported: true, current: null });
    expect(describeTarget("stroke", undefined, [createText({ text: "x" })], page).supported).toBe(false);
    expect(describeTarget("shadow", undefined, [bare], page)).toMatchObject({ supported: true, current: null });
    expect(describeTarget("highlight", undefined, [createText({ text: "x", effect: { kind: "background", color: "#ffee00" } })], page).current).toEqual({
      type: "solid",
      color: "#ffee00",
    });
    expect(
      describeTarget("fill", undefined, [createShape("rect", { fill: { type: "pattern", pattern: "dots", color: "#000", background: "#fff", scale: 1 } })], page).current,
    ).toBeNull();
    expect(describeTarget("page", undefined, [], null).supported).toBe(false);
    expect(describeTarget("graphic", undefined, [createGraphic({ svg: '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>' })], page).supported).toBe(true);
  });
});

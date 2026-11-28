import { describe, expect, it } from "vitest";
import { createChart, createGraphic, createGroup, createImage, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import { moveToIndex } from "@/core/ops";
import { getShape } from "@/render/shapePaths";
import type { ChartElement, DesignElement, ImageElement, Page, ShapeElement, TableElement, TextElement } from "@/core/types";
import { describeTarget, sameColor, samePaint } from "./colorTargets";
import {
  addChartRow,
  addChartSeries,
  addTableColumn,
  addTableRow,
  chartColor,
  parseNumber,
  removeChartRow,
  removeChartSeries,
  removeTableColumn,
  removeTableRow,
  setChartPaletteColor,
  tableSize,
} from "./dataEdit";
import { collectDocumentColors } from "./docColors";
import { collectDocumentFonts, filterFonts } from "./docFonts";
import { alphaOf, effectDefaults, effectValue, fromShadow, getEffectDef, matchShadowPreset, SHADOW_PRESETS, shadowScale, TEXT_EFFECTS, toShadow, withAlpha } from "./effectModels";
import { defaultRatioLock, describePosition, normalizeRotation, resizeSingle, rotateFromSnapshot, scaleAbout, topElements, translate } from "./boxEdit";
import { dropIndex, layerKind, layerName } from "./layerInfo";

const page = (...elements: DesignElement[]): Page => createPage({ elements });
const clone = <T>(v: T): T => structuredClone(v);

/* ------------------------------------------------------------------ */

describe("position model", () => {
  it("shows the box of a single element and the union of several", () => {
    const a = createShape("rect", { x: 10, y: 20, width: 100, height: 50 });
    const b = createShape("rect", { x: 200, y: 100, width: 40, height: 40 });
    expect(describePosition([a])).toMatchObject({ x: 10, y: 20, width: 100, height: 50, single: true, heightReadOnly: false });
    expect(describePosition([a, b])).toMatchObject({ x: 10, y: 20, width: 230, height: 120, single: false, rotation: 0 });
    expect(describePosition([])).toBeNull();
  });

  it("uses the bounds for X / Y of a rotated element but keeps its own width and height", () => {
    const a = createShape("rect", { x: 100, y: 100, width: 100, height: 100, rotation: 45 });
    const m = describePosition([a])!;
    expect(m.width).toBe(100);
    expect(m.x).toBeCloseTo(150 - Math.SQRT2 * 50, 3);
  });

  it("makes text height and line height read-only, and reports locked selections", () => {
    expect(describePosition([createText({ text: "Hi" })])!.heightReadOnly).toBe(true);
    expect(describePosition([createLine()])!.heightReadOnly).toBe(true);
    expect(describePosition([createShape("rect", { locked: true })])!.allLocked).toBe(true);
  });

  it("defaults the ratio lock on for photos, graphics, groups and multi selections", () => {
    expect(defaultRatioLock([createImage({ src: null })])).toBe(true);
    expect(defaultRatioLock([createShape("rect")])).toBe(false);
    expect(defaultRatioLock([createText({ text: "x" })])).toBe(false);
    expect(defaultRatioLock([createShape("rect"), createShape("rect")])).toBe(true);
  });

  it("reduces a selection to its top-level elements", () => {
    const child = createShape("rect", { id: "child" });
    const group = createGroup([child], { id: "grp", width: 10, height: 10 });
    const p = page(group);
    expect(topElements(p, ["grp", "child"]).map((e) => e.id)).toEqual(["grp"]);
  });

  it("normalises rotation into 0..360", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(370)).toBe(10);
  });
});

describe("resizing from the panel", () => {
  it("resizes a shape and scales its radius; a rotated one keeps its centre", () => {
    const s = createShape("rect", { x: 10, y: 10, width: 100, height: 100, radius: 20 });
    resizeSingle(s, 200, 100, false);
    expect(s).toMatchObject({ x: 10, y: 10, width: 200, height: 100, radius: 20 });
    const r = createShape("rect", { x: 0, y: 0, width: 100, height: 100, rotation: 30 });
    resizeSingle(r, 200, 100, false);
    expect(r.x + r.width / 2).toBeCloseTo(50);
    expect(r.y + r.height / 2).toBeCloseTo(50);
  });

  it("text: unlocked reflows at the new width, locked scales the type", () => {
    const t = createText({ text: "Hello", fontSize: 40, width: 200, autoWidth: false });
    const reflow = clone(t);
    resizeSingle(reflow, 100, 0, false);
    expect(reflow).toMatchObject({ width: 100, fontSize: 40, autoWidth: false });
    const scaled = clone(t);
    resizeSingle(scaled, 400, 0, true);
    expect(scaled.fontSize).toBeCloseTo(80);
    expect(scaled.width).toBe(400);
    const tiny = clone(t);
    resizeSingle(tiny, 3, 0, false);
    expect(tiny.width).toBe(24);
  });

  it("a locked photo scales with its crop intact", () => {
    const img = createImage({ src: "builtin:x", naturalWidth: 1000, naturalHeight: 500, width: 400, height: 200 });
    const before = clone(img.crop);
    resizeSingle(img, 200, 100, true);
    expect(img).toMatchObject({ width: 200, height: 100 });
    expect(img.crop).toEqual(before);
  });

  it("an unlocked photo moves its frame over the picture and keeps covering it", () => {
    const img = createImage({ src: "builtin:x", naturalWidth: 1000, naturalHeight: 1000, width: 400, height: 400 }) as ImageElement;
    resizeSingle(img, 200, 400, false);
    expect(img.width).toBe(200);
    // the picture still has its absolute size: 400 wide inside a 200 wide frame
    expect(img.crop.w * img.width).toBeCloseTo(400);
    expect(img.crop.x).toBeLessThanOrEqual(0);
    expect(img.crop.x + img.crop.w).toBeGreaterThanOrEqual(1 - 1e-9);
    // growing past the picture zooms it just enough
    resizeSingle(img, 800, 400, false);
    expect(img.crop.w * img.width).toBeGreaterThanOrEqual(800 - 1e-6);
    expect(img.crop.x).toBeLessThanOrEqual(1e-9);
  });

  it("groups scale their children and tables their columns / rows", () => {
    const child = createShape("rect", { x: 10, y: 10, width: 40, height: 40 });
    const g = createGroup([child], { x: 0, y: 0, width: 100, height: 100 });
    resizeSingle(g, 200, 200, true);
    expect(g.children[0]).toMatchObject({ x: 20, y: 20, width: 80, height: 80 });
    const t = createTable({ width: 600, height: 240 });
    resizeSingle(t, 300, 240, false);
    expect(t.colWidths.reduce((a, b) => a + b, 0)).toBeCloseTo(300);
    expect(t.rowHeights.reduce((a, b) => a + b, 0)).toBeCloseTo(240);
  });

  it("a line only changes its length", () => {
    const l = createLine({ width: 300 });
    resizeSingle(l, 150, 99, false);
    expect(l.width).toBe(150);
    expect(l.height).toBe(0);
  });

  it("scales several elements about the union's top-left and rotates them about its centre", () => {
    const a = createShape("rect", { x: 100, y: 100, width: 100, height: 100 });
    const b = createShape("rect", { x: 300, y: 100, width: 100, height: 100 });
    scaleAbout(a, 0.5, 0.5, 100, 100);
    scaleAbout(b, 0.5, 0.5, 100, 100);
    expect(a).toMatchObject({ x: 100, y: 100, width: 50, height: 50 });
    expect(b).toMatchObject({ x: 200, y: 100, width: 50, height: 50 });
    const c = createShape("rect", { x: 0, y: 0, width: 100, height: 100 });
    const orig = clone(c);
    rotateFromSnapshot(c, orig, { x: 100, y: 50 }, 180);
    expect(c.x).toBeCloseTo(100);
    expect(c.rotation).toBe(180);
    translate(c, 5, -5);
    expect(c.x).toBeCloseTo(105);
  });
});

/* ------------------------------------------------------------------ */

describe("layers", () => {
  it("derives names from the content", () => {
    expect(layerName(createText({ text: "  Hello\nworld  " }))).toBe("Hello world");
    expect(layerName(createText({ text: "" }))).toBe("Empty text");
    expect(layerName(createText({ text: "x".repeat(80) })).length).toBeLessThanOrEqual(40);
    expect(layerName(createShape("ellipse"))).toBe("Circle");
    expect(layerName(createShape("ellipse", { width: 300, height: 100 }))).toBe("Ellipse");
    expect(layerName(createShape("rect", { width: 100, height: 100 }))).toBe("Square");
    expect(layerName(createShape("rect", { width: 320, height: 92, radius: 46 }))).toBe("Rounded rectangle");
    expect(layerName(createShape("star"))).toBe(getShape("star")?.name);
    expect(layerName(createImage({ src: "builtin:sunset-hills" }))).toBe("Sunset hills");
    expect(layerName(createImage({ src: null, isFrame: true }))).toBe("Frame");
    expect(layerName(createLine({ endArrow: "arrow" }))).toBe("Arrow");
    expect(layerName(createLine())).toBe("Line");
    expect(layerName(createGroup([createShape("rect"), createShape("rect")]))).toBe("Group (2)");
    expect(layerName(createChart({ chart: "donut" }))).toBe("Donut chart");
    expect(layerName(createTable())).toBe("Table");
    expect(layerName(createText({ text: "abc", name: " My title " }))).toBe("My title");
  });

  it("labels types", () => {
    expect(layerKind(createText({ text: "x" }))).toBe("Text");
    expect(layerKind(createGraphic({ svg: '<svg viewBox="0 0 10 10"></svg>', source: { kind: "sticker" } }))).toBe("Sticker");
  });

  it("computes the index handed to moveToIndex for every drop position", () => {
    const ids = ["A", "B", "C", "D"]; // paint order, D is on top
    const run = (from: number, target: number, edge: "above" | "below") => {
      const els = ids.map((id) => createShape("rect", { id }));
      const p = page(...els);
      moveToIndex(p, ids[from], dropIndex(from, target, edge));
      return p.elements.map((e) => e.id).join("");
    };
    expect(run(0, 3, "above")).toBe("BCDA"); // A to the very top
    expect(run(3, 0, "below")).toBe("DABC"); // D to the very bottom
    expect(run(1, 2, "below")).toBe("ABCD"); // dropped right where it is: nothing changes
    expect(run(1, 2, "above")).toBe("ACBD");
    expect(run(2, 1, "below")).toBe("ACBD");
    expect(run(2, 1, "above")).toBe("ABCD");
    expect(run(0, 1, "above")).toBe("BACD");
  });
});

/* ------------------------------------------------------------------ */

describe("effect models", () => {
  it("describes the ten text effects with the sliders the painter reads", () => {
    expect(TEXT_EFFECTS.map((e) => e.kind)).toEqual(["none", "shadow", "lift", "hollow", "splice", "outline", "echo", "glitch", "neon", "background"]);
    expect(getEffectDef("shadow").controls).toEqual(["offset", "direction", "blur", "transparency"]);
    expect(getEffectDef("background").controls).toEqual(["roundness", "spread", "transparency"]);
    expect(getEffectDef("none").controls).toEqual([]);
    expect(effectDefaults("neon")).toEqual({ kind: "neon", color: "#ff2fb3", intensity: 50 });
    // defaults are fresh copies
    expect(effectDefaults("neon")).not.toBe(getEffectDef("neon").defaults);
    expect(effectValue({ kind: "shadow" }, "direction")).toBe(45);
    expect(effectValue({ kind: "shadow", offset: 12 }, "offset")).toBe(12);
  });

  it("round-trips a shadow through the slider units", () => {
    for (const preset of SHADOW_PRESETS) {
      const s = toShadow(preset.parts, 1);
      const back = fromShadow(s, 1);
      expect(back.offset).toBeCloseTo(preset.parts.offset, 0);
      expect(back.blur).toBeCloseTo(preset.parts.blur, 0);
      expect(back.transparency).toBe(preset.parts.transparency);
      expect(back.color).toBe(preset.parts.color);
      if (preset.parts.offset > 0) expect(back.direction).toBeCloseTo(preset.parts.direction, 0);
      expect(matchShadowPreset(s, 1)).toBe(preset.id);
    }
    expect(matchShadowPreset(null, 1)).toBeNull();
    expect(matchShadowPreset({ color: "rgba(1,2,3,.5)", blur: 3, x: 7, y: 1 }, 1)).toBeNull();
  });

  it("scales shadows with the page and remembers a glow's direction", () => {
    expect(shadowScale({ width: 2160, height: 2160 })).toBe(2);
    const big = toShadow(SHADOW_PRESETS[0].parts, 2);
    const small = toShadow(SHADOW_PRESETS[0].parts, 1);
    expect(big.blur).toBeCloseTo(small.blur * 2);
    expect(fromShadow({ color: "#000", blur: 10, x: 0, y: 0 }, 1, 120).direction).toBe(120);
  });

  it("keeps or replaces the opacity of a colour", () => {
    expect(withAlpha("#ff0000", 1)).toBe("#ff0000");
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(alphaOf("rgba(0,0,0,.3)")).toBeCloseTo(0.3);
    expect(withAlpha("rgba(0,0,0,.3)", alphaOf("rgba(9,9,9,.3)"))).toBe("rgba(0,0,0,0.3)");
  });
});

/* ------------------------------------------------------------------ */

describe("colours", () => {
  it("compares colours across notations", () => {
    expect(sameColor("#FF0000", "rgb(255,0,0)")).toBe(true);
    expect(sameColor("#ff0000", "#ff0001")).toBe(false);
    expect(samePaint({ type: "solid", color: "#fff" }, { type: "solid", color: "#ffffff" })).toBe(true);
    const g = {
      type: "linear" as const,
      angle: 90,
      stops: [
        { offset: 0, color: "#000" },
        { offset: 1, color: "#fff" },
      ],
    };
    expect(samePaint(g, clone(g))).toBe(true);
    expect(samePaint(g, { ...clone(g), angle: 45 })).toBe(false);
    expect(samePaint(null, g)).toBe(false);
  });

  it("collects the document colours most used first, from every kind of element", () => {
    const text = createText({ text: "x", color: "#111111", effect: { kind: "shadow", color: "#ff0000" } });
    text.paragraphs[0].runs[0].color = "#00ff00";
    const design = {
      pages: [
        createPage({
          background: {
            type: "linear",
            angle: 0,
            stops: [
              { offset: 0, color: "#ABCDEF" },
              { offset: 1, color: "#111111" },
            ],
          },
          elements: [
            text,
            createShape("rect", { fill: solid("#111111"), stroke: { color: "#222222", width: 2, style: "solid" } }),
            createShape("rect", { fill: { type: "pattern", pattern: "dots", color: "#333333", background: "#444444", scale: 1 } }),
            createLine({ stroke: { color: "#222222", width: 4, style: "solid" } }),
            createTable({ headerFill: "#555555", headerColor: "#ffffff", stripeFill: null, borderColor: "#666666", color: "#111111" }),
            createChart({ palette: ["#777777", "#888888", "#999999"], series: [{ name: "a", values: [1] }], textColor: "#aaaaaa" }),
            createGroup([createShape("rect", { fill: solid("rgba(0,0,0,0)") }), createShape("rect", { fill: solid("#bbbbbb") })]),
          ],
        }),
      ],
    };
    const colors = collectDocumentColors(design);
    // #111111 is used four times, #222222 twice
    expect(colors[0]).toBe("#111111");
    expect(colors[1]).toBe("#222222");
    expect(colors).toContain("#abcdef");
    expect(colors).toContain("#00ff00");
    expect(colors).toContain("#ff0000");
    expect(colors).toContain("#bbbbbb");
    // transparent colours and unused chart palette slots are left out
    expect(colors).not.toContain("#000000");
    expect(colors).not.toContain("#888888");
    expect(new Set(colors).size).toBe(colors.length);
    expect(collectDocumentColors(design, 3)).toHaveLength(3);
  });

  it("knows what each colour target can colour and what it currently is", () => {
    const shape = createShape("rect", {
      fill: solid("#123456"),
      stroke: { color: "#654321", width: 2, style: "solid" },
      shadow: { color: "rgba(255,0,0,0.5)", blur: 4, x: 1, y: 1 },
    });
    const text = createText({ text: "x", color: "#101010", effect: { kind: "outline", color: "#abcdef" } });
    const p = page(shape, text);
    expect(describeTarget("fill", undefined, [shape], p)).toMatchObject({ supported: true, gradients: true, current: { type: "solid", color: "#123456" } });
    expect(describeTarget("fill", undefined, [text], p).supported).toBe(false);
    expect(describeTarget("stroke", undefined, [shape], p).current).toEqual({ type: "solid", color: "#654321" });
    expect(describeTarget("shadow", undefined, [shape], p).current).toEqual({ type: "solid", color: "#ff0000" });
    expect(describeTarget("text", undefined, [text], p)).toMatchObject({ supported: true, gradients: true, current: { type: "solid", color: "#101010" } });
    expect(describeTarget("effect", undefined, [text], p).current).toEqual({ type: "solid", color: "#abcdef" });
    expect(describeTarget("page", undefined, [], p)).toMatchObject({ supported: true, title: "Page color" });
    expect(describeTarget("text", undefined, [], p).supported).toBe(false);
    const g = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path fill="#ff8a65" d="M0 0h10v10z"/></svg>' });
    expect(describeTarget("graphic", undefined, [g], p).current).toEqual({ type: "solid", color: "#ff8a65" });
    expect(describeTarget("graphic", "#ff8a65", [{ ...g, colors: { "#ff8a65": "#00ff00" } }], p).current).toEqual({ type: "solid", color: "#00ff00" });
    const names = (["text", "fill", "stroke", "shadow", "page", "graphic", "effect"] as const).map((t) => describeTarget(t, undefined, [], p).title);
    expect(names).toEqual(["Text color", "Fill color", "Border color", "Shadow color", "Page color", "Color", "Effect color"]);
  });
});

/* ------------------------------------------------------------------ */

describe("fonts", () => {
  it("collects document fonts most used first, runs and tables included", () => {
    const a = createText({ text: "a", fontFamily: "Lora" });
    a.paragraphs[0].runs[0].font = "Pacifico";
    const design = {
      pages: [
        createPage({
          elements: [a, createText({ text: "b", fontFamily: "Lora" }), createTable({ fontFamily: "Inter" }), createGroup([createText({ text: "c", fontFamily: "Inter" })])],
        }),
      ],
    };
    expect(collectDocumentFonts(design)).toEqual(["Lora", "Inter", "Pacifico"]);
  });

  it("filters by name", () => {
    const fonts = [{ family: "Open Sans" }, { family: "Roboto" }, { family: "Lora" }] as Parameters<typeof filterFonts>[0];
    expect(filterFonts(fonts, "  ro ").map((f) => f.family)).toEqual(["Roboto"]);
    expect(filterFonts(fonts, "")).toHaveLength(3);
    expect(filterFonts(fonts, "zzz")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe("table edits", () => {
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const fresh = (): TableElement => createTable({ width: 600, height: 240 });

  it("adds and removes rows and columns without changing the element size", () => {
    const t = fresh();
    addTableRow(t);
    expect(tableSize(t)).toEqual({ rows: 4, cols: 3 });
    expect(sum(t.rowHeights)).toBeCloseTo(240);
    addTableColumn(t);
    expect(tableSize(t)).toEqual({ rows: 4, cols: 4 });
    expect(t.cells[0][3]).toBe("Heading 4");
    expect(t.cells[1][3]).toBe("");
    expect(sum(t.colWidths)).toBeCloseTo(600);
    expect(t.width).toBe(600);
    removeTableRow(t, 3);
    removeTableColumn(t, 3);
    expect(tableSize(t)).toEqual({ rows: 3, cols: 3 });
    expect(sum(t.rowHeights)).toBeCloseTo(240);
    expect(sum(t.colWidths)).toBeCloseTo(600);
  });

  it("inserts at a position and never removes the last row or column", () => {
    const t = fresh();
    t.cells[1][0] = "keep";
    addTableRow(t, 1);
    expect(t.cells[1]).toEqual(["", "", ""]);
    expect(t.cells[2][0]).toBe("keep");
    const small = createTable({ cells: [["only"]], colWidths: [100], rowHeights: [40], width: 100, height: 40 });
    removeTableRow(small, 0);
    removeTableColumn(small, 0);
    expect(tableSize(small)).toEqual({ rows: 1, cols: 1 });
  });

  it("keeps uneven sizes proportional", () => {
    const t = createTable({
      cells: [
        ["a", "b"],
        ["c", "d"],
      ],
      colWidths: [100, 300],
      rowHeights: [50, 150],
      width: 400,
      height: 200,
    });
    addTableColumn(t);
    expect(t.colWidths[1] / t.colWidths[0]).toBeCloseTo(3);
    expect(sum(t.colWidths)).toBeCloseTo(400);
  });
});

describe("chart edits", () => {
  const fresh = (): ChartElement => createChart({ labels: ["A", "B", "C"], series: [{ name: "One", values: [10, 20, 30] }] });

  it("adds rows and series keeping the data rectangular", () => {
    const c = fresh();
    addChartRow(c);
    expect(c.labels).toHaveLength(4);
    expect(c.series[0].values).toEqual([10, 20, 30, 20]);
    addChartSeries(c);
    expect(c.series).toHaveLength(2);
    expect(c.series[1].values).toHaveLength(4);
    expect(c.series[1].name).toBe("Series 2");
  });

  it("removes rows and series but never the last one", () => {
    const c = fresh();
    addChartSeries(c);
    removeChartRow(c, 1);
    expect(c.labels).toEqual(["A", "C"]);
    expect(c.series.every((s) => s.values.length === 2)).toBe(true);
    removeChartSeries(c, 1);
    removeChartSeries(c, 0);
    expect(c.series).toHaveLength(1);
    removeChartRow(c, 0);
    removeChartRow(c, 0);
    expect(c.labels).toHaveLength(1);
  });

  it("edits palette colours so the swatch always changes something visible", () => {
    const c = fresh();
    c.series[0].color = "#123456";
    setChartPaletteColor(c, 0, "#ff00ff");
    expect(c.palette[0]).toBe("#ff00ff");
    expect(chartColor(c, 0)).toBe("#ff00ff");
    c.chart = "pie";
    expect(chartColor(c, 1)).toBe(c.palette[1]);
  });

  it("parses typed numbers strictly", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" -3.5 ")).toBe(-3.5);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("1.")).toBe(1);
    for (const bad of ["", "abc", "1e3", "--1", "1 2", "-"]) expect(parseNumber(bad)).toBeNull();
  });

  it("refuses a number made only of digits that is too large to hold", () => {
    expect(parseNumber("9".repeat(400))).toBeNull();
    expect(parseNumber(`-${"9".repeat(400)}`)).toBeNull();
    expect(parseNumber("9".repeat(300))).toBe(1e300);
  });
});

/* ------------------------------------------------------------------ */

describe("type guards used by the panels", () => {
  it("narrows elements the way the panels expect", () => {
    const shape: ShapeElement = createShape("rect");
    const text: TextElement = createText({ text: "x" });
    expect(describeTarget("fill", undefined, [shape], page(shape)).supported).toBe(true);
    expect(describeTarget("highlight", undefined, [text], page(text)).supported).toBe(true);
  });
});

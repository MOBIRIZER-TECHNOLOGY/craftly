import { describe, expect, it } from "vitest";
import { getShape } from "@/render/shapePaths";
import { DESIGN_CATEGORY_LABELS, DESIGN_TYPES, POPULAR_DESIGN_TYPES, describeSize, fromPx, getDesignType, toPx } from "./designTypes";
import { GRAPHICS, GRAPHIC_CATEGORIES, createGraphicElement, getGraphic, searchGraphics } from "./graphics";
import { GRAPHIC_CATEGORY_LABELS } from "./graphicTypes";
import { describeColor, hueColor, nameOfColor } from "./palettes";
import {
  ELLIPSE_ASPECT,
  ELLIPSE_PRESET,
  FRAME_PRESETS,
  GRID_PRESETS,
  LINE_PRESETS,
  ROUNDED_RECT_PRESET,
  SHAPE_GROUP_LABELS,
  SHAPE_PRESETS,
  createFrameFromPreset,
  createGridFrames,
  createLineFromPreset,
} from "./shapes";

describe("shape presets", () => {
  it("labels every group of shapes", () => {
    expect(Object.keys(SHAPE_GROUP_LABELS).sort()).toEqual(["arrows", "basic", "blobs", "bubbles", "polygons", "stars", "symbols"]);
    for (const preset of SHAPE_PRESETS) expect(SHAPE_GROUP_LABELS[preset.group], preset.id).toBeTruthy();
  });

  it("offers one preset for each shape of the catalogue", () => {
    const ids = SHAPE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of SHAPE_PRESETS) expect(getShape(preset.id)?.name, preset.id).toBe(preset.name);
  });

  it("makes a filled shape that is a fifth of the page", () => {
    const rect = SHAPE_PRESETS.find((p) => p.id === "rect")!.create(1000);
    expect(rect).toMatchObject({ type: "shape", shape: "rect", width: 220, height: 220, fill: { type: "solid", color: "#0e1318" } });
    expect(rect.params).toBeUndefined();
  });

  it("keeps the proportions a wide or a tall shape was drawn with", () => {
    const wide = SHAPE_PRESETS.find((p) => p.id === "half-circle")!.create(1000);
    expect([wide.width, wide.height]).toEqual([378, 189]);
    const slightlyWide = SHAPE_PRESETS.find((p) => p.id === "triangle")!.create(1000);
    expect([slightlyWide.width, slightlyWide.height]).toEqual([240, 218]);
    const tall = SHAPE_PRESETS.find((p) => p.id === "arch")!.create(1000);
    expect([tall.width, tall.height]).toEqual([220, 314]);
  });

  it("gives a shape its own copy of the parameters of its preset", () => {
    const a = SHAPE_PRESETS.find((p) => p.id === "star")!.create(1000);
    const b = SHAPE_PRESETS.find((p) => p.id === "star")!.create(1000);
    expect(a.params).toEqual({ points: 5, inner: 0.42 });
    expect(a.params).not.toBe(b.params);
    a.params!.points = 9;
    expect(b.params!.points).toBe(5);
    expect(getShape("star")!.params!.points).toBe(5);
  });

  it("scales with the page", () => {
    expect(SHAPE_PRESETS[0].create(500).width).toBe(110);
    for (const preset of SHAPE_PRESETS) {
      const el = preset.create(800);
      expect(el.width, preset.id).toBeGreaterThan(0);
      expect(el.height, preset.id).toBeGreaterThan(0);
    }
  });

  it("offers a rounded square with a fifth of its side as corner radius", () => {
    const el = ROUNDED_RECT_PRESET.create(1000);
    expect(el).toMatchObject({ shape: "rect", width: 220, height: 220, radius: 44 });
    expect(ROUNDED_RECT_PRESET.group).toBe("basic");
  });

  it("offers an ellipse next to the circle: the same shape, wider than tall", () => {
    const ellipse = ELLIPSE_PRESET.create(1000);
    expect(ellipse).toMatchObject({ type: "shape", shape: "ellipse", width: 319, height: 213, fill: { type: "solid", color: "#0e1318" } });
    expect(ellipse.width / ellipse.height).toBeCloseTo(ELLIPSE_ASPECT, 1);
    expect(getShape(ellipse.shape)?.name).toBe("Circle");
    const circle = SHAPE_PRESETS.find((p) => p.id === "ellipse")!.create(1000);
    expect(circle).toMatchObject({ shape: "ellipse", width: 220, height: 220 });
    expect(ELLIPSE_PRESET).toMatchObject({ name: "Ellipse", group: "basic" });
  });

  it("scales the ellipse with the page like the other wide shapes", () => {
    expect(ELLIPSE_PRESET.create(500)).toMatchObject({ width: 160, height: 107 });
    const wide = SHAPE_PRESETS.find((p) => p.id === "parallelogram")!.create(1000);
    // a shape of the same proportions is sized by the same rule
    expect(wide.width / wide.height).toBeCloseTo(ELLIPSE_PRESET.create(1000).width / ELLIPSE_PRESET.create(1000).height, 1);
    expect(wide.width).toBe(ELLIPSE_PRESET.create(1000).width);
  });

  it("answers to the words people use for the circle, the ellipse and the square", () => {
    const words = (id: string) => SHAPE_PRESETS.find((p) => p.id === id)?.keywords ?? "";
    expect(words("ellipse")).toContain("round");
    expect(words("rect")).toContain("rectangle");
    expect(ELLIPSE_PRESET.keywords).toContain("oval");
    expect(ROUNDED_RECT_PRESET.keywords).toContain("rounded rectangle");
    // most shapes need no extra words: their name says it
    expect(words("heart")).toBe("");
  });

  it("gives the extra entries ids of their own and thumbnails that draw them", () => {
    const ids = [...SHAPE_PRESETS, ROUNDED_RECT_PRESET, ELLIPSE_PRESET].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ELLIPSE_PRESET.preview).toEqual({ kind: "ellipse", aspect: ELLIPSE_ASPECT });
    expect(ROUNDED_RECT_PRESET.preview).toEqual({ kind: "rect", radiusRatio: 0.22 });
    expect(SHAPE_PRESETS.every((p) => p.preview === undefined)).toBe(true);
  });
});

describe("line presets", () => {
  it("has uniquely named lines and arrows", () => {
    const ids = LINE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LINE_PRESETS).toHaveLength(8);
  });

  it("makes a line of a third of the page, with a stroke that grows with it", () => {
    const arrow = createLineFromPreset(LINE_PRESETS.find((p) => p.id === "arrow")!, 1000);
    expect(arrow).toMatchObject({ type: "line", width: 300, startArrow: "none", endArrow: "arrow", stroke: { color: "#0e1318", width: 6, style: "solid", cap: "round" } });
  });

  it("never makes the stroke thinner than four pixels", () => {
    const line = createLineFromPreset(LINE_PRESETS[0], 300);
    expect(line.type === "line" && line.stroke.width).toBe(4);
    expect(line.width).toBe(90);
  });

  it("takes style and cap from the preset", () => {
    const dashed = createLineFromPreset(LINE_PRESETS.find((p) => p.id === "line-dashed")!, 1000);
    expect(dashed.type === "line" && dashed.stroke).toMatchObject({ style: "dashed", cap: "butt" });
    const dots = createLineFromPreset(LINE_PRESETS.find((p) => p.id === "line-dot-end")!, 1000);
    expect(dots).toMatchObject({ startArrow: "circle", endArrow: "circle" });
  });
});

describe("frame presets", () => {
  it("only uses masks that exist", () => {
    for (const preset of FRAME_PRESETS) expect(getShape(preset.mask), preset.id).toBeDefined();
    expect(new Set(FRAME_PRESETS.map((p) => p.id)).size).toBe(FRAME_PRESETS.length);
  });

  it("makes an empty frame that waits for a photo", () => {
    const frame = createFrameFromPreset(FRAME_PRESETS.find((p) => p.id === "frame-circle")!, 1000);
    expect(frame).toMatchObject({ type: "image", src: null, isFrame: true, mask: "ellipse", width: 400, height: 400, radius: 0 });
  });

  it("keeps the proportions of a frame, limiting wide ones", () => {
    const arch = createFrameFromPreset(FRAME_PRESETS.find((p) => p.id === "frame-arch")!, 1000);
    expect([arch.width, arch.height]).toEqual([280, 400]);
    const tag = createFrameFromPreset(FRAME_PRESETS.find((p) => p.id === "frame-tag")!, 1000);
    expect([tag.width, tag.height]).toEqual([600, 353]);
  });

  it("rounds the corners of the rounded frame only", () => {
    expect(createFrameFromPreset(FRAME_PRESETS.find((p) => p.id === "frame-rounded")!, 1000).radius).toBe(60);
    expect(createFrameFromPreset(FRAME_PRESETS.find((p) => p.id === "frame-square")!, 1000).radius).toBe(0);
  });
});

describe("photo grids", () => {
  it("fills the whole box with the cells of every grid", () => {
    for (const grid of GRID_PRESETS) {
      const area = grid.cells.reduce((sum, [, , w, h]) => sum + w * h, 0);
      expect(area, grid.id).toBeCloseTo(1);
      for (const [x, y, w, h] of grid.cells) {
        expect(x + w, grid.id).toBeLessThanOrEqual(1.0001);
        expect(y + h, grid.id).toBeLessThanOrEqual(1.0001);
      }
    }
    expect(new Set(GRID_PRESETS.map((g) => g.id)).size).toBe(GRID_PRESETS.length);
  });

  it("makes a frame for each cell with a gutter between them", () => {
    const frames = createGridFrames(GRID_PRESETS.find((g) => g.id === "grid-2")!, { x: 100, y: 50, w: 800, h: 600 });
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ x: 105, y: 55, width: 390, height: 590, mask: "rect", isFrame: true });
    expect(frames[1]).toMatchObject({ x: 505, y: 55, width: 390, height: 590 });
  });

  it("takes the gutter from the caller and keeps every frame at least 8 px", () => {
    const frames = createGridFrames(GRID_PRESETS.find((g) => g.id === "grid-2x2")!, { x: 0, y: 0, w: 400, h: 400 }, 30);
    expect(frames[3]).toMatchObject({ x: 215, y: 215, width: 170, height: 170 });
    const tiny = createGridFrames(GRID_PRESETS.find((g) => g.id === "grid-3x2")!, { x: 0, y: 0, w: 100, h: 100 }, 1000);
    expect(tiny.every((f) => f.width === 8 && f.height === 8)).toBe(true);
  });
});

describe("design types", () => {
  it("has uniquely identified types in known categories", () => {
    const ids = DESIGN_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const type of DESIGN_TYPES) {
      expect(DESIGN_CATEGORY_LABELS[type.category], type.id).toBeTruthy();
      expect(type.width, type.id).toBeGreaterThan(0);
      expect(type.height, type.id).toBeGreaterThan(0);
    }
  });

  it("finds a type by id", () => {
    expect(getDesignType("presentation")).toMatchObject({ width: 1920, height: 1080, unit: "px" });
    expect(getDesignType("flyer")).toMatchObject({ width: 816, height: 1056, unit: "in" });
    expect(getDesignType("nope")).toBeUndefined();
  });

  it("lists the popular types", () => {
    expect(POPULAR_DESIGN_TYPES.length).toBeGreaterThan(3);
    expect(POPULAR_DESIGN_TYPES.every((t) => t.popular)).toBe(true);
    expect(POPULAR_DESIGN_TYPES.map((t) => t.id)).toContain("presentation");
  });

  it("describes a size in the unit it is shown in", () => {
    expect(describeSize(1920, 1080, "px")).toBe("1920 × 1080 px");
    expect(describeSize(1919.6, 1080.4, "px")).toBe("1920 × 1080 px");
    expect(describeSize(816, 1056, "in")).toBe("8.5 × 11 in");
    // A4 and A3 are stored in whole pixels, a fraction of a millimetre off: they are named as the paper is
    expect(describeSize(794, 1123, "mm")).toBe("210 × 297 mm");
    expect(describeSize(1123, 1587, "mm")).toBe("297 × 420 mm");
    expect(describeSize(794, 1123, "cm")).toBe("21 × 29.7 cm");
    // a size that is not near a round one keeps a tenth of a millimetre, or a hundredth of a centimetre
    expect(describeSize(1280, 720, "mm")).toBe("338.7 × 190.5 mm");
    expect(describeSize(1280, 721, "cm")).toBe("33.87 × 19.08 cm");
    expect(describeSize(816, 1056, "in")).toBe("8.5 × 11 in");
    expect(describeSize(96, 192, "cm")).toBe("2.54 × 5.08 cm");
  });

  it("converts between pixels and the other units at 96 dpi", () => {
    expect(toPx(2, "in")).toBe(192);
    expect(toPx(25.4, "mm")).toBeCloseTo(96);
    expect(toPx(2.54, "cm")).toBeCloseTo(96);
    expect(toPx(123, "px")).toBe(123);
    expect(fromPx(192, "in")).toBe(2);
    expect(fromPx(96, "mm")).toBeCloseTo(25.4);
    expect(fromPx(96, "cm")).toBeCloseTo(2.54);
    expect(fromPx(123, "px")).toBe(123);
    for (const unit of ["in", "mm", "cm", "px"] as const) expect(fromPx(toPx(7.25, unit), unit)).toBeCloseTo(7.25);
  });
});

describe("graphics library", () => {
  it("merges both packs under unique ids", () => {
    const ids = GRAPHICS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GRAPHICS.length).toBeGreaterThan(100);
  });

  it("counts the graphics of each category, in the order of the labels", () => {
    expect(GRAPHIC_CATEGORIES.reduce((n, c) => n + c.count, 0)).toBe(GRAPHICS.length);
    for (const category of GRAPHIC_CATEGORIES) {
      expect(category.label).toBe(GRAPHIC_CATEGORY_LABELS[category.id]);
      expect(category.count).toBe(GRAPHICS.filter((g) => g.category === category.id).length);
      expect(category.count).toBeGreaterThan(0);
    }
  });

  it("finds a graphic by id", () => {
    const first = GRAPHICS[0];
    expect(getGraphic(first.id)).toBe(first);
    expect(getGraphic("nope")).toBeUndefined();
  });

  it("searches name, category and tags, every word having to match", () => {
    const sample = GRAPHICS.find((g) => g.tags.length >= 2)!;
    const [t1, t2] = sample.tags;
    expect(searchGraphics("")).toHaveLength(GRAPHICS.length);
    expect(searchGraphics("   ")).toHaveLength(GRAPHICS.length);
    expect(searchGraphics(sample.name.toUpperCase()).map((g) => g.id)).toContain(sample.id);
    expect(searchGraphics(` ${t1}   ${t2} `).map((g) => g.id)).toContain(sample.id);
    expect(searchGraphics(`${t1} zzzzqqqq`)).toEqual([]);
    expect(searchGraphics(sample.category).map((g) => g.id)).toContain(sample.id);
  });

  it("limits a search to one category", () => {
    const sample = GRAPHICS[0];
    const inCategory = searchGraphics("", sample.category);
    expect(inCategory.length).toBeGreaterThan(0);
    expect(inCategory.every((g) => g.category === sample.category)).toBe(true);
    expect(searchGraphics("", null)).toHaveLength(GRAPHICS.length);
    expect(searchGraphics(sample.name, sample.category === "abstract" ? "nature" : "abstract").map((g) => g.id)).not.toContain(sample.id);
  });

  it("makes an element a third of the page wide, keeping the proportions of the drawing", () => {
    for (const def of GRAPHICS.slice(0, 60)) {
      const el = createGraphicElement(def, 1000);
      expect(el.type).toBe("graphic");
      expect(Math.max(el.width, el.height), def.id).toBe(300);
      expect(el.width / el.height, def.id).toBeCloseTo(el.viewW / el.viewH, 1);
      expect(el.source).toEqual({ kind: def.kind === "sticker" ? "sticker" : "illustration", id: def.id });
    }
  });

  it("marks stickers as stickers and everything else as illustrations", () => {
    const sticker = GRAPHICS.find((g) => g.kind === "sticker");
    const plain = GRAPHICS.find((g) => g.kind !== "sticker")!;
    if (sticker) expect(createGraphicElement(sticker, 600).source?.kind).toBe("sticker");
    expect(createGraphicElement(plain, 600).source?.kind).toBe("illustration");
  });

  it("lays out a tall drawing by its height and a wide one by its width", () => {
    const wide = createGraphicElement({ id: "w", name: "Wide", category: "abstract", tags: [], svg: `<svg viewBox="0 0 200 100"/>` }, 1000);
    expect([wide.width, wide.height]).toEqual([300, 150]);
    const tall = createGraphicElement({ id: "t", name: "Tall", category: "abstract", tags: [], svg: `<svg viewBox="0 0 100 200"/>` }, 1000);
    expect([tall.width, tall.height]).toEqual([150, 300]);
    const square = createGraphicElement({ id: "s", name: "Square", category: "abstract", tags: [], svg: `<svg viewBox="0 0 10 10"/>` }, 1000);
    expect([square.width, square.height]).toEqual([300, 300]);
  });

  it("treats a drawing without a viewBox as square", () => {
    const el = createGraphicElement({ id: "n", name: "No box", category: "abstract", tags: [], svg: `<svg width="50" height="10"/>` }, 1000);
    expect(el.width).toBe(300);
    expect(el.height).toBe(300);
  });
});

describe("colour descriptions", () => {
  it("describes a colour by name, hue, saturation and value", () => {
    expect(describeColor("#ff0000")).toEqual({ name: nameOfColor("#ff0000"), h: 0, s: 1, v: 1 });
    const green = describeColor("#00ff00");
    expect(green.h).toBeCloseTo(120);
    expect(green.name).toBe("green");
  });

  it("treats a colour it cannot read as black", () => {
    expect(describeColor("nonsense")).toEqual({ name: nameOfColor("nonsense"), h: 0, s: 0, v: 0 });
    expect(describeColor("nonsense").v).toBe(0);
  });

  it("gives the fully saturated colour for a hue angle", () => {
    expect(hueColor(0)).toBe("#ff0000");
    expect(hueColor(120)).toBe("#00ff00");
    expect(hueColor(240)).toBe("#0000ff");
    expect(hueColor(-120)).toBe("#0000ff");
    expect(hueColor(360)).toBe("#ff0000");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT,
  DEFAULT_INK,
  DEFAULT_SHAPE_FILL,
  cloneElement,
  clonePage,
  createChart,
  createDesign,
  createFrame,
  createGraphic,
  createGroup,
  createImage,
  createLine,
  createPage,
  createShape,
  createTable,
  createText,
  defaultEffect,
  defaultFilter,
  extractSvgColors,
  paragraphsToText,
  plainParagraphs,
  solid,
  textPresetSizes,
} from "./factory";
import { extractSvgColors as fromSvg } from "./svg";
import type { GroupElement } from "./types";

describe("text helpers", () => {
  it("splits plain text into one paragraph per line, whatever the line ending", () => {
    expect(plainParagraphs("a\nb\r\nc")).toEqual([{ runs: [{ text: "a" }] }, { runs: [{ text: "b" }] }, { runs: [{ text: "c" }] }]);
    expect(plainParagraphs("")).toEqual([{ runs: [{ text: "" }] }]);
  });

  it("joins paragraphs back into text, run by run", () => {
    expect(paragraphsToText([{ runs: [{ text: "he" }, { text: "llo", bold: true }] }, { runs: [] }, { runs: [{ text: "x" }] }])).toBe("hello\n\nx");
    expect(paragraphsToText(plainParagraphs("a\n\nb"))).toBe("a\n\nb");
  });

  it("offers a heading, a subheading and body size that scale with the shorter side of the design", () => {
    expect(textPresetSizes(1920, 1080)).toEqual({ heading: 97, subheading: 52, body: 32 });
    expect(textPresetSizes(1080, 1920)).toEqual({ heading: 97, subheading: 52, body: 32 });
    expect(textPresetSizes(100, 100)).toEqual({ heading: 9, subheading: 5, body: 3 });
  });
});

describe("createText", () => {
  it("makes a one line auto-width text box sized after its text", () => {
    const el = createText();
    expect(el.type).toBe("text");
    expect(el.id).toMatch(/^t_/);
    expect(paragraphsToText(el.paragraphs)).toBe("Add text");
    expect(el.autoWidth).toBe(true);
    expect(el.fontSize).toBe(48);
    expect(el.width).toBe(Math.ceil(8 * 48 * 0.55));
    expect(el.height).toBe(60);
    expect(el).toMatchObject({
      fontFamily: DEFAULT_FONT,
      color: DEFAULT_INK,
      fontWeight: 400,
      italic: false,
      align: "left",
      lineHeight: 1.25,
      letterSpacing: 0,
      textCase: "none",
      curve: 0,
      list: null,
      gradient: null,
      effect: { kind: "none" },
    });
  });

  it("gives text a fixed width, and wrapping, when a width is given", () => {
    const el = createText({ text: "Hello", width: 300 });
    expect(el.width).toBe(300);
    expect(el.autoWidth).toBe(false);
    expect(createText({ text: "Hello", width: 300, autoWidth: true }).autoWidth).toBe(true);
  });

  it("measures the box from the longest line and the number of lines", () => {
    const el = createText({ text: "a\nlonger line", fontSize: 20 });
    expect(el.paragraphs).toHaveLength(2);
    expect(el.width).toBe(Math.ceil(11 * 20 * 0.55));
    expect(el.height).toBe(Math.ceil(20 * 1.25 * 2));
    expect(createText({ text: "x", fontSize: 10, lineHeight: 2 }).height).toBe(20);
    expect(createText({ text: "" }).width).toBe(Math.ceil(1 * 48 * 0.55));
  });

  it("takes ready-made paragraphs instead of text, and lets any field be overridden", () => {
    const paragraphs = [{ runs: [{ text: "ab", bold: true }] }, { runs: [{ text: "cde" }] }];
    const el = createText({ paragraphs, text: "ignored", color: "#ff0000", height: 999 });
    expect(el.paragraphs).toBe(paragraphs);
    expect(el.color).toBe("#ff0000");
    expect(el.height).toBe(999);
    expect(el.width).toBe(Math.ceil(3 * 48 * 0.55));
  });

  it("gives every element its own id", () => {
    expect(createText().id).not.toBe(createText().id);
  });
});

describe("shapes, lines and containers", () => {
  it("makes a filled square shape", () => {
    const el = createShape("star");
    expect(el).toMatchObject({
      type: "shape",
      shape: "star",
      fill: { type: "solid", color: DEFAULT_SHAPE_FILL },
      stroke: null,
      radius: 0,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
    });
    expect(el.id).toMatch(/^s_/);
    expect(createShape("rect", { fill: null, x: 5 })).toMatchObject({ fill: null, x: 5 });
  });

  it("makes a flat line with a round-capped stroke and no arrows", () => {
    const el = createLine();
    expect(el).toMatchObject({ type: "line", width: 300, height: 0, startArrow: "none", endArrow: "none", stroke: { color: DEFAULT_INK, width: 6, style: "solid", cap: "round" } });
    expect(createLine({ endArrow: "arrow", width: 50 })).toMatchObject({ endArrow: "arrow", width: 50 });
  });

  it("makes a group around the children it is given", () => {
    const child = createShape("rect");
    const group = createGroup([child], { x: 10 });
    expect(group).toMatchObject({ type: "group", x: 10 });
    expect(group.children).toEqual([child]);
    expect(group.id).toMatch(/^grp_/);
  });

  it("makes a three by three table with a header row", () => {
    const table = createTable();
    expect(table.cells).toEqual([
      ["Heading 1", "Heading 2", "Heading 3"],
      ["", "", ""],
      ["", "", ""],
    ]);
    expect(table.colWidths).toEqual([200, 200, 200]);
    expect(table.rowHeights).toEqual([80, 80, 80]);
    expect(table).toMatchObject({ type: "table", width: 600, height: 240, headerRow: true, fontFamily: DEFAULT_FONT, borderWidth: 2, align: "left" });
    expect(createTable({ headerRow: false }).headerRow).toBe(false);
  });

  it("makes a four column column chart with one series", () => {
    const chart = createChart();
    expect(chart).toMatchObject({ type: "chart", chart: "column", labels: ["Q1", "Q2", "Q3", "Q4"], showLegend: false, showValues: true, showGrid: true, width: 640, height: 400 });
    expect(chart.series).toEqual([{ name: "Revenue", values: [32, 48, 41, 66] }]);
    expect(chart.palette).toHaveLength(6);
    expect(createChart({ chart: "pie" }).chart).toBe("pie");
  });
});

describe("createImage and createFrame", () => {
  it("uses the natural size when no size is given, and 800 x 600 when that is unknown too", () => {
    expect(createImage({ src: "a.png" })).toMatchObject({
      width: 800,
      height: 600,
      naturalWidth: 800,
      naturalHeight: 600,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      mask: "rect",
      radius: 0,
      stroke: null,
      isFrame: false,
      src: "a.png",
    });
    expect(createImage({ src: "a.png", naturalWidth: 640, naturalHeight: 480 })).toMatchObject({ width: 640, height: 480 });
  });

  it("keeps the shape of the picture when only a width is given", () => {
    const el = createImage({ src: "a.png", naturalWidth: 640, naturalHeight: 480, width: 320 });
    expect([el.width, el.height]).toEqual([320, 240]);
  });

  it("covers the box with the picture when both sizes are given", () => {
    const el = createImage({ src: "a.png", naturalWidth: 640, naturalHeight: 480, width: 200, height: 200 });
    expect(el.crop.w).toBeCloseTo(4 / 3);
    expect(el.crop.h).toBeCloseTo(1);
    expect(el.crop.x).toBeCloseTo(-1 / 6);
    expect(el.crop.y).toBeCloseTo(0);
  });

  it("does not touch a crop it is given", () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.5 };
    expect(createImage({ src: "a.png", width: 100, height: 100, crop }).crop).toBe(crop);
  });

  it("starts with a neutral filter", () => {
    expect(createImage({ src: null }).src).toBeNull();
    expect(createImage({ src: "a.png" }).filter).toEqual(defaultFilter());
  });

  it("makes an empty frame that waits for a photo", () => {
    const frame = createFrame("ellipse");
    expect(frame).toMatchObject({ type: "image", src: null, mask: "ellipse", isFrame: true, width: 400, height: 400, naturalWidth: 1, naturalHeight: 1 });
    expect(createFrame("rect", { x: 30, y: 40 })).toMatchObject({ x: 30, y: 40 });
  });
});

describe("createGraphic", () => {
  it("normalises the markup and sizes a wide picture to 320 wide", () => {
    const g = createGraphic({ svg: `<svg width="40" height="20"><rect/></svg>` });
    expect(g.type).toBe("graphic");
    expect(g.id).toMatch(/^g_/);
    expect(g.svg).toContain('viewBox="0 0 40 20"');
    expect(g.svg).not.toContain("width=");
    expect([g.viewW, g.viewH, g.width, g.height]).toEqual([40, 20, 320, 160]);
    expect(g.colors).toEqual({});
  });

  it("sizes a tall picture to 320 high at most", () => {
    const g = createGraphic({ svg: `<svg viewBox="0 0 10 20"/>` });
    expect([g.width, g.height]).toEqual([160, 320]);
  });

  it("works out the other side from a size it is given", () => {
    expect(createGraphic({ svg: `<svg viewBox="0 0 10 20"/>`, width: 100 })).toMatchObject({ width: 100, height: 200 });
    expect(createGraphic({ svg: `<svg viewBox="0 0 10 20"/>`, width: 100, height: 50 })).toMatchObject({ width: 100, height: 50 });
  });

  it("keeps the recolouring it is given and exposes the colour extraction", () => {
    expect(createGraphic({ svg: `<svg viewBox="0 0 1 1"/>`, colors: { "#ff0000": "#00ff00" } }).colors).toEqual({ "#ff0000": "#00ff00" });
    expect(extractSvgColors).toBe(fromSvg);
  });
});

describe("pages and designs", () => {
  it("makes a blank white page", () => {
    const page = createPage();
    expect(page).toMatchObject({ background: { type: "solid", color: "#ffffff" }, elements: [] });
    expect(page.id).toMatch(/^p_/);
    expect(createPage({ name: "Cover", duration: 8 })).toMatchObject({ name: "Cover", duration: 8 });
  });

  it("makes a design with one blank page unless pages are given", () => {
    const design = createDesign({ width: 800, height: 600 });
    expect(design).toMatchObject({ title: "Untitled design", typeId: "custom", unit: "px", width: 800, height: 600, folderId: null, starred: false, trashedAt: null, version: 1 });
    expect(design.pages).toHaveLength(1);
    expect(design.createdAt).toBe(design.updatedAt);
    expect(design.id).toMatch(/^d_/);
    expect(createDesign({ width: 1, height: 1, pages: [] }).pages).toHaveLength(1);
  });

  it("takes title, type, unit and pages from the caller", () => {
    const pages = [createPage(), createPage()];
    const design = createDesign({ title: "Poster", typeId: "poster", unit: "mm", width: 210, height: 297, pages });
    expect(design).toMatchObject({ title: "Poster", typeId: "poster", unit: "mm" });
    expect(design.pages).toBe(pages);
  });

  it("makes independent defaults every time", () => {
    const a = defaultFilter();
    a.brightness = 50;
    expect(defaultFilter().brightness).toBe(0);
    expect(defaultEffect()).toEqual({ kind: "none" });
    expect(solid("#123456")).toEqual({ type: "solid", color: "#123456" });
  });
});

describe("cloning", () => {
  it("copies an element deeply with new ids all the way down", () => {
    const group = createGroup([createShape("rect", { id: "inner" }), createGroup([createText({ id: "deep" })], { id: "g2" })], { id: "g1" });
    const copy = cloneElement(group);
    const ids = (g: GroupElement): string[] => g.children.flatMap((c) => (c.type === "group" ? [c.id, ...ids(c)] : [c.id]));
    expect(copy.id).not.toBe("g1");
    expect(copy.id).toMatch(/^g_/);
    expect(ids(copy).some((id) => ["inner", "g2", "deep"].includes(id))).toBe(false);
    expect(ids(copy)).toHaveLength(3);
    (copy.children[0] as { x: number }).x = 99;
    expect((group.children[0] as { x: number }).x).toBe(0);
  });

  it("copies a plain element with a new id", () => {
    const shape = createShape("rect", { id: "orig", x: 4 });
    const copy = cloneElement(shape);
    expect(copy).toMatchObject({ x: 4, shape: "rect" });
    expect(copy.id).not.toBe("orig");
    expect(copy).not.toBe(shape);
  });

  it("copies a page with new ids for the page and everything on it", () => {
    const page = createPage({ id: "page", name: "A", elements: [createShape("rect", { id: "s" }), createGroup([createShape("rect", { id: "c" })], { id: "g" })] });
    const copy = clonePage(page);
    expect(copy.id).not.toBe("page");
    expect(copy.name).toBe("A");
    expect(copy.elements.map((e) => e.id)).not.toContain("s");
    expect((copy.elements[1] as GroupElement).children[0].id).not.toBe("c");
    copy.elements.pop();
    expect(page.elements).toHaveLength(2);
  });
});

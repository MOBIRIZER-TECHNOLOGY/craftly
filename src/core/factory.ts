/**
 * Constructors for every document object, with sensible defaults. Use these
 * instead of writing object literals so new fields get defaults everywhere.
 */
import { m } from "@/i18n";
import { cloneDeep } from "./clone";
import { rebindClones } from "./connectors";
import { uid } from "./ids";
import { CURRENT_DESIGN_VERSION } from "./schema/design";
import { extractSvgColors, normalizeSvg } from "./svg";
import type {
  ChartElement,
  Design,
  DesignElement,
  Fill,
  GraphicElement,
  GroupElement,
  ImageElement,
  ImageFilter,
  LineElement,
  Page,
  ShapeElement,
  ShapeKind,
  SizeUnit,
  TableElement,
  TextElement,
  TextEffect,
  TextParagraph,
} from "./types";

export const DEFAULT_FONT = "Plus Jakarta Sans";
export const DEFAULT_INK = "#0e1318";
export const DEFAULT_SHAPE_FILL = "#0e1318";

export const defaultFilter = (): ImageFilter => ({
  preset: "none",
  intensity: 100,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  fade: 0,
  vignette: 0,
  blur: 0,
  hue: 0,
  highlights: 0,
  shadows: 0,
  sharpen: 0,
  tint: 0,
  curves: 0,
  levels: 0,
  duotone: null,
});

export const defaultEffect = (): TextEffect => ({ kind: "none" });

export const solid = (color: string): Fill => ({ type: "solid", color });

/* ---------------- text helpers ---------------- */

export function plainParagraphs(text: string): TextParagraph[] {
  return text.split(/\r?\n/).map((line) => ({ runs: [{ text: line }] }));
}

export function paragraphsToText(paragraphs: TextParagraph[]): string {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}

/* ---------------- elements ---------------- */

/** Constructor options: any field except `type`; `id` may be supplied for stable template ids. */
type Init<T> = Partial<Omit<T, "type">>;

const base = (type: DesignElement["type"], init: Partial<DesignElement>) => ({
  id: uid(type[0]),
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  rotation: 0,
  opacity: 1,
  ...init,
});

export function createText(init: Init<TextElement> & { text?: string } = {}): TextElement {
  const { text, ...rest } = init;
  const fontSize = rest.fontSize ?? 48;
  const autoWidth = rest.autoWidth ?? rest.width === undefined;
  const paragraphs = rest.paragraphs ?? plainParagraphs(text ?? "Add text");
  const approxChars = Math.max(...paragraphs.map((p) => p.runs.reduce((n, r) => n + r.text.length, 0)), 1);
  return {
    ...base("text", {}),
    id: uid("t"),
    type: "text",
    width: rest.width ?? Math.ceil(approxChars * fontSize * 0.55),
    height: Math.ceil(fontSize * (rest.lineHeight ?? 1.25) * paragraphs.length),
    paragraphs,
    fontFamily: DEFAULT_FONT,
    fontSize,
    fontWeight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: DEFAULT_INK,
    gradient: null,
    align: "left",
    lineHeight: 1.25,
    letterSpacing: 0,
    textCase: "none",
    autoWidth,
    effect: defaultEffect(),
    curve: 0,
    list: null,
    ...rest,
  } as TextElement;
}

export function createShape(shape: ShapeKind, init: Init<ShapeElement> = {}): ShapeElement {
  return {
    ...base("shape", {}),
    id: uid("s"),
    type: "shape",
    shape,
    fill: solid(DEFAULT_SHAPE_FILL),
    stroke: null,
    radius: 0,
    ...init,
  } as ShapeElement;
}

export function createLine(init: Init<LineElement> = {}): LineElement {
  return {
    ...base("line", {}),
    id: uid("l"),
    type: "line",
    width: 300,
    height: 0,
    stroke: { color: DEFAULT_INK, width: 6, style: "solid", cap: "round" },
    startArrow: "none",
    endArrow: "none",
    ...init,
  } as LineElement;
}

/**
 * An image element. Pass the natural size so the box can match the picture's
 * aspect ratio; `fit` decides how it is sized when both width and height are given.
 */
export function createImage(init: Init<ImageElement> & { src: string | null; naturalWidth?: number; naturalHeight?: number }): ImageElement {
  const nw = init.naturalWidth ?? init.width ?? 800;
  const nh = init.naturalHeight ?? init.height ?? 600;
  const width = init.width ?? nw;
  const height = init.height ?? (init.width ? (init.width * nh) / nw : nh);
  if (!init.crop && init.width && init.height) {
    // cover the box with the picture
    const s = Math.max(init.width / nw, init.height / nh);
    const iw = (nw * s) / init.width;
    const ih = (nh * s) / init.height;
    init = { ...init, crop: { x: (1 - iw) / 2, y: (1 - ih) / 2, w: iw, h: ih } };
  }
  return {
    ...base("image", {}),
    id: uid("i"),
    type: "image",
    width,
    height,
    naturalWidth: nw,
    naturalHeight: nh,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    mask: "rect",
    radius: 0,
    filter: defaultFilter(),
    stroke: null,
    isFrame: false,
    ...init,
  } as ImageElement;
}

/** Empty placeholder that accepts a dropped photo. */
export function createFrame(mask: ShapeKind, init: Init<ImageElement> = {}): ImageElement {
  return createImage({
    src: null,
    naturalWidth: 1,
    naturalHeight: 1,
    width: 400,
    height: 400,
    mask,
    isFrame: true,
    ...init,
  });
}

export function createGraphic(init: Init<GraphicElement> & { svg: string }): GraphicElement {
  const norm = normalizeSvg(init.svg);
  const ratio = norm.viewW / norm.viewH;
  const width = init.width ?? (ratio >= 1 ? 320 : Math.round(320 * ratio));
  const height = init.height ?? Math.round(width / ratio);
  return {
    ...base("graphic", {}),
    id: uid("g"),
    type: "graphic",
    viewW: norm.viewW,
    viewH: norm.viewH,
    colors: {},
    ...init,
    svg: norm.svg,
    width,
    height,
  } as GraphicElement;
}

export function createGroup(children: DesignElement[], init: Init<GroupElement> = {}): GroupElement {
  return {
    ...base("group", {}),
    id: uid("grp"),
    type: "group",
    children,
    ...init,
  } as GroupElement;
}

export function createTable(init: Init<TableElement> = {}): TableElement {
  const rows = 3;
  const cols = 3;
  return {
    ...base("table", {}),
    id: uid("tb"),
    type: "table",
    width: 600,
    height: 240,
    cells: Array.from({ length: rows }, (_r, r) => Array.from({ length: cols }, (_c, c) => (r === 0 ? `Heading ${c + 1}` : ""))),
    colWidths: Array(cols).fill(200),
    rowHeights: Array(rows).fill(80),
    headerRow: true,
    fontFamily: DEFAULT_FONT,
    fontSize: 24,
    color: DEFAULT_INK,
    headerFill: "#7c3aed",
    headerColor: "#ffffff",
    stripeFill: "#f3f0ff",
    borderColor: "#d9d4ee",
    borderWidth: 2,
    align: "left",
    ...init,
  } as TableElement;
}

export function createChart(init: Init<ChartElement> = {}): ChartElement {
  return {
    ...base("chart", {}),
    id: uid("c"),
    type: "chart",
    width: 640,
    height: 400,
    chart: "column",
    labels: ["Q1", "Q2", "Q3", "Q4"],
    series: [{ name: "Revenue", values: [32, 48, 41, 66] }],
    palette: ["#7c3aed", "#14b8a6", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"],
    fontFamily: DEFAULT_FONT,
    textColor: DEFAULT_INK,
    showLegend: false,
    showValues: true,
    showGrid: true,
    ...init,
  } as ChartElement;
}

/* ---------------- pages and designs ---------------- */

export function createPage(init: Partial<Page> = {}): Page {
  return {
    id: uid("p"),
    background: solid("#ffffff"),
    elements: [],
    ...init,
  };
}

export function createDesign(init: { title?: string; typeId?: string; width: number; height: number; unit?: SizeUnit; pages?: Page[] }): Design {
  const now = Date.now();
  return {
    id: uid("d"),
    title: init.title ?? m.core.untitledDesign,
    typeId: init.typeId ?? "custom",
    width: init.width,
    height: init.height,
    unit: init.unit ?? "px",
    pages: init.pages?.length ? init.pages : [createPage()],
    createdAt: now,
    updatedAt: now,
    folderId: null,
    starred: false,
    trashedAt: null,
    version: CURRENT_DESIGN_VERSION,
  };
}

/* ---------------- cloning ---------------- */

/** Deep clone with fresh ids (recursing into groups). */
export function cloneElement<T extends DesignElement>(el: T): T {
  const copy = cloneDeep(el) as T;
  const refresh = (e: DesignElement) => {
    e.id = uid(e.type[0]);
    if (e.type === "group") e.children.forEach(refresh);
  };
  refresh(copy);
  return copy;
}

export function clonePage(page: Page): Page {
  const copy = cloneDeep(page);
  copy.id = uid("p");
  const refresh = (e: DesignElement) => {
    e.id = uid(e.type[0]);
    if (e.type === "group") e.children.forEach(refresh);
  };
  copy.elements.forEach(refresh);
  rebindClones(page.elements, copy.elements);
  return copy;
}

/** Preferred text sizes for "Add a heading / subheading / body" in a design of this size. */
export function textPresetSizes(designWidth: number, designHeight: number) {
  const side = Math.min(designWidth, designHeight);
  return { heading: Math.round(side * 0.09), subheading: Math.round(side * 0.048), body: Math.round(side * 0.03) };
}

export { extractSvgColors };

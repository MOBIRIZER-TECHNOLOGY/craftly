/**
 * "Complete" documents: every optional field of the stored formats is present, and the compiler checks it. A new optional
 * property on `Design`, an element, a fill, a summary ... makes the builders below fail to compile until it is added here,
 * and a new property in the builders then differs from the frozen v1 fixtures, which the tests of src/core/schema name
 * (docs/MIGRATIONS.md: "changing what is stored"). Adding a field is allowed; doing it without noticing is what this stops.
 *
 * `Complete<T>`: T with every optional property required and not null, in every nested object, array item and union member.
 */
import type { VersionRecord } from "@/core/library";
import type { Asset, BrandKit, Design, DesignElement, DesignSummary, Folder, Page } from "@/core/types";

export type Complete<T> = T extends Blob ? T : T extends readonly (infer Item)[] ? Complete<Item>[] : T extends object ? { [Key in keyof T]-?: Complete<NonNullable<T[Key]>> } : T;

const animation = (kind: string, direction: "left" | "right" | "up" | "down") => ({ kind, duration: 0.8, delay: 0.25, direction });

/** The fields every element has, all set. */
const base = (id: string) => ({
  id,
  name: `Layer ${id}`,
  x: 40,
  y: 60,
  width: 200,
  height: 120,
  rotation: 15,
  opacity: 0.9,
  flipH: true,
  flipV: true,
  locked: true,
  hidden: true,
  shadow: { color: "rgba(0,0,0,0.35)", blur: 12, x: 4, y: 6 },
  blur: 2,
  alt: "Described for people who cannot see it",
  link: "https://example.com/page",
  animation: { in: animation("fade", "up"), out: animation("slide", "left"), loop: animation("pulse", "right") },
});

const filter = {
  preset: "vivid",
  intensity: 60,
  brightness: 10,
  contrast: 12,
  saturation: 14,
  warmth: -8,
  fade: 20,
  vignette: 30,
  blur: 1,
  hue: 5,
  duotone: { dark: "#101010", light: "#f0e0d0" },
};
const stroke = { color: "#112233", width: 3, style: "dashed" as const, cap: "round" as const, join: "bevel" as const };
const stops = [
  { offset: 0, color: "#ff0000" },
  { offset: 1, color: "#0000ff" },
];

/** One element of every type, each with every field. */
function completeElements(): Complete<DesignElement>[] {
  return [
    {
      ...base("t_1"),
      type: "text",
      paragraphs: [
        {
          runs: [
            { text: "Hello ", bold: true, italic: true, underline: true, strike: true, color: "#ff8800", size: 40, font: "Playfair Display", spacing: 20 },
            { text: "world", bold: false, italic: false, underline: false, strike: false, color: "#0088ff", size: 36, font: "Plus Jakarta Sans", spacing: -10 },
          ],
          align: "center",
          list: "bullet",
        },
      ],
      fontFamily: "Plus Jakarta Sans",
      fontSize: 48,
      fontWeight: 700,
      italic: true,
      underline: true,
      strike: true,
      color: "#0e1318",
      gradient: { type: "linear", angle: 45, stops },
      align: "right",
      lineHeight: 1.3,
      letterSpacing: 25,
      textCase: "title",
      autoWidth: false,
      effect: { kind: "neon", color: "#00ffcc", offset: 40, direction: 90, blur: 50, intensity: 60, thickness: 20, roundness: 30, spread: 10, transparency: 25 },
      curve: 30,
      list: "number",
    },
    {
      ...base("s_1"),
      type: "shape",
      shape: "star",
      fill: { type: "radial", stops, cx: 0.4, cy: 0.6 },
      stroke,
      radius: 12,
      path: "M0 0 L100 0 L100 100 Z",
      params: { sides: 5, innerRatio: 0.5 },
    },
    {
      ...base("s_2"),
      type: "shape",
      shape: "rect",
      fill: { type: "image", src: "asset:a_fill", fit: "tile", dim: 0.2 },
      stroke,
      radius: 0,
      path: "M0 0",
      params: { sides: 4 },
    },
    {
      ...base("s_3"),
      type: "shape",
      shape: "rect",
      fill: { type: "pattern", pattern: "waves", color: "#334455", background: "#eeeeee", scale: 1.5 },
      stroke,
      radius: 4,
      path: "M0 0",
      params: { sides: 4 },
    },
    {
      ...base("s_4"),
      type: "shape",
      shape: "oval",
      fill: { type: "linear", angle: 180, stops },
      stroke,
      radius: 0,
      path: "M0 0",
      params: { sides: 4 },
    },
    {
      ...base("s_5"),
      type: "shape",
      shape: "oval",
      fill: { type: "solid", color: "#abcdef" },
      stroke,
      radius: 0,
      path: "M0 0",
      params: { sides: 4 },
    },
    { ...base("l_1"), type: "line", stroke, startArrow: "triangle", endArrow: "open-arrow" },
    {
      ...base("i_1"),
      type: "image",
      src: "asset:a_photo",
      originalSrc: "asset:a_original",
      naturalWidth: 1600,
      naturalHeight: 900,
      crop: { x: -0.1, y: -0.2, w: 1.2, h: 1.4 },
      mask: "circle",
      radius: 8,
      filter,
      stroke,
      isFrame: true,
    },
    {
      ...base("g_1"),
      type: "graphic",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" fill="#000000"/></svg>',
      viewW: 24,
      viewH: 24,
      colors: { "#000000": "#ff0066" },
      strokeWidth: 2,
      source: { kind: "icon", id: "star" },
    },
    {
      ...base("grp_1"),
      type: "group",
      children: [
        {
          ...base("t_2"),
          type: "text",
          paragraphs: [
            {
              runs: [{ text: "Inside", bold: true, italic: true, underline: true, strike: true, color: "#111111", size: 20, font: "Inter", spacing: 5 }],
              align: "left",
              list: "number",
            },
          ],
          fontFamily: "Inter",
          fontSize: 20,
          fontWeight: 400,
          italic: false,
          underline: false,
          strike: false,
          color: "#111111",
          gradient: { type: "linear", angle: 0, stops },
          align: "left",
          lineHeight: 1.2,
          letterSpacing: 0,
          textCase: "none",
          autoWidth: true,
          effect: { kind: "none", color: "#000000", offset: 0, direction: 0, blur: 0, intensity: 0, thickness: 0, roundness: 0, spread: 0, transparency: 0 },
          curve: 0,
          list: "bullet",
        },
        { ...base("l_2"), type: "line", stroke, startArrow: "none", endArrow: "arrow" },
      ],
    },
    {
      ...base("tab_1"),
      type: "table",
      cells: [
        ["Name", "Qty"],
        ["Pens", "12"],
      ],
      colWidths: [120, 80],
      rowHeights: [40, 40],
      headerRow: true,
      fontFamily: "Inter",
      fontSize: 16,
      color: "#222222",
      headerFill: "#222222",
      headerColor: "#ffffff",
      stripeFill: "#f4f4f4",
      borderColor: "#cccccc",
      borderWidth: 1,
      align: "center",
    },
    {
      ...base("c_1"),
      type: "chart",
      chart: "donut",
      labels: ["North", "South"],
      series: [
        { name: "2025", values: [3, 4], color: "#ff5500" },
        { name: "2026", values: [5, 6], color: "#0055ff" },
      ],
      palette: ["#ff5500", "#0055ff", "#00aa55"],
      fontFamily: "Inter",
      textColor: "#222222",
      showLegend: true,
      showValues: true,
      showGrid: true,
    },
  ];
}

/** Five pages: one for each kind of page background, the elements spread over them. */
function completePages(): Complete<Page>[] {
  const [text, star, imageFill, patternFill, linearShape, solidShape, line, image, graphic, group, table, chart] = completeElements();
  const page = (id: string, background: Complete<Page>["background"], elements: Complete<DesignElement>[]): Complete<Page> => ({
    id,
    name: `Page ${id}`,
    background,
    elements,
    notes: "Say this out loud",
    duration: 7,
    transition: { kind: "slide", duration: 0.9, direction: "left" },
  });
  return [
    page("p_1", { type: "solid", color: "#fafafa" }, [text, star, imageFill]),
    page("p_2", { type: "linear", angle: 135, stops }, [patternFill, linearShape, solidShape]),
    page("p_3", { type: "radial", stops, cx: 0.3, cy: 0.7 }, [line, image, graphic]),
    page("p_4", { type: "pattern", pattern: "dots", color: "#99aabb", background: "#ffffff", scale: 2 }, [group, table, chart]),
    page("p_5", { type: "image", src: "asset:a_background", fit: "cover", dim: 0.35 }, []),
  ];
}

/** A design with every optional field set, in every place it can be. */
export function completeDesign(): Complete<Design> {
  return {
    id: "d_complete",
    title: "Everything the format can hold",
    typeId: "presentation",
    width: 1920,
    height: 1080,
    unit: "mm",
    pages: completePages(),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    folderId: "f_complete",
    starred: true,
    trashedAt: 1_700_000_900_000,
    guides: { vertical: [100, 960], horizontal: [200, 540] },
    version: 1,
  };
}

/** A design with nothing but the required fields: the least any build can have written. */
export function minimalDesign(): Design {
  const required = { x: 10, y: 20, width: 100, height: 50, rotation: 0, opacity: 1 };
  return {
    id: "d_minimal",
    title: "Nothing extra",
    typeId: "custom",
    width: 800,
    height: 600,
    unit: "px",
    pages: [
      {
        id: "p_1",
        background: { type: "solid", color: "#ffffff" },
        elements: [
          {
            id: "t_1",
            type: "text",
            ...required,
            paragraphs: [{ runs: [{ text: "Hello" }] }],
            fontFamily: "Plus Jakarta Sans",
            fontSize: 32,
            fontWeight: 400,
            italic: false,
            underline: false,
            strike: false,
            color: "#0e1318",
            align: "left",
            lineHeight: 1.2,
            letterSpacing: 0,
            textCase: "none",
            autoWidth: true,
            effect: { kind: "none" },
            curve: 0,
          },
          { id: "s_1", type: "shape", ...required, shape: "rect", fill: null, stroke: null, radius: 0 },
          { id: "l_1", type: "line", ...required, height: 0, stroke: { color: "#000000", width: 2, style: "solid" }, startArrow: "none", endArrow: "none" },
          {
            id: "i_1",
            type: "image",
            ...required,
            src: null,
            naturalWidth: 100,
            naturalHeight: 50,
            crop: { x: 0, y: 0, w: 1, h: 1 },
            mask: "rect",
            radius: 0,
            filter: { preset: "none", intensity: 100, brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, blur: 0, hue: 0 },
          },
          { id: "g_1", type: "graphic", ...required, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', viewW: 10, viewH: 10, colors: {} },
          { id: "grp_1", type: "group", ...required, children: [] },
          {
            id: "tab_1",
            type: "table",
            ...required,
            cells: [["a"]],
            colWidths: [100],
            rowHeights: [50],
            headerRow: false,
            fontFamily: "Inter",
            fontSize: 14,
            color: "#000000",
            headerFill: "#eeeeee",
            headerColor: "#000000",
            stripeFill: null,
            borderColor: "#cccccc",
            borderWidth: 1,
            align: "left",
          },
          {
            id: "c_1",
            type: "chart",
            ...required,
            chart: "bar",
            labels: ["a"],
            series: [{ name: "s", values: [1] }],
            palette: ["#ff0000"],
            fontFamily: "Inter",
            textColor: "#000000",
            showLegend: false,
            showValues: false,
            showGrid: false,
          },
        ],
      },
    ],
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    folderId: null,
    starred: false,
    trashedAt: null,
    version: 1,
  };
}

/** The records that sit beside designs in the library, each with every field. */
export function completeRecords() {
  const design = completeDesign();
  const summary: Complete<DesignSummary> = {
    id: design.id,
    title: design.title,
    typeId: design.typeId,
    width: design.width,
    height: design.height,
    pageCount: design.pages.length,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    folderId: design.folderId,
    starred: design.starred,
    trashedAt: design.trashedAt,
    thumbnail: "data:image/jpeg;base64,/9j/4AAQ",
    schema: 1,
  };
  const folder: Complete<Folder> = { id: "f_complete", name: "Campaigns", createdAt: 1_700_000_000_000, parentId: "f_parent" };
  const brandKit: Complete<BrandKit> = { colors: ["#7c3aed", "#14b8a6"], fonts: ["Plus Jakarta Sans"], logos: ["a_logo"] };
  const version: Complete<VersionRecord> = { id: `${design.id}:1700000300000`, designId: design.id, createdAt: 1_700_000_300_000, label: "Saved by you", design };
  const asset: Complete<Asset> = {
    id: "a_photo",
    name: "Photo",
    kind: "image",
    mime: "image/png",
    size: 4,
    width: 1600,
    height: 900,
    createdAt: 1_700_000_000_000,
    blob: new Blob(["png!"], { type: "image/png" }),
  };
  return { summary, folder, brandKit, version, asset };
}

/* The helper itself is checked by the compiler: each directive below is an error that `Complete` must produce. */

// @ts-expect-error an optional property has to be there
const needsOptional: Complete<{ a: number; b?: number }> = { a: 1 };
// @ts-expect-error and has to hold a value, not null
const needsValue: Complete<{ b?: number | null }> = { b: null };
// @ts-expect-error inside an array item too
const needsNested: Complete<{ items: Array<{ a: number; b?: string }> }> = { items: [{ a: 1 }] };
void [needsOptional, needsValue, needsNested];

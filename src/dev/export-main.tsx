/**
 * Dev harness for the export package (dev-export.html, port 5185): the Download panel in a 360 px card, buttons
 * for the other helpers, a "stress" design that exercises every renderer feature, and hooks on `window`
 * (`__editor`, `__h`) that the scripted checks use to compare exports with the on-screen render.
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
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
  defaultFilter,
  solid,
} from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, Fill, Page, TextEffect } from "@/core/types";
import { GRAPHICS_A } from "@/data/graphicsA";
import { copyPageAsImage, downloadBlob, exportDesign, pagePngBlob, printDesign, type ExportOptions } from "@/export/exporters";
import { DownloadPanel } from "@/export/DownloadPanel";
import { exportProjectFile, importProjectFile } from "@/export/projectFile";
import { createZip } from "@/export/zip";
import { designPageToSvg } from "@/export/svg";
import { fontFileUrl } from "@/export/fontFiles";
import { renderPageToCanvas } from "@/render/renderPage";
import { Button, ToastHost, toast } from "@/ui";
import { sampleDesign } from "./sampleDesign";

/* ------------------------------------------------------------------ */
/* a design that touches every feature of the renderer                  */
/* ------------------------------------------------------------------ */

const lin = (angle: number, a: string, b: string): Fill => ({
  type: "linear",
  angle,
  stops: [
    { offset: 0, color: a },
    { offset: 1, color: b },
  ],
});

function typographyPage(): Page {
  const page = createPage({ background: solid("#fffaf3") });
  const E = (kind: TextEffect["kind"], extra: Partial<TextEffect> = {}): TextEffect => ({ kind, ...extra });
  const sample = (label: string, effect: TextEffect, x: number, y: number, extra: Record<string, unknown> = {}) =>
    createText({ text: label, x, y, fontSize: 54, fontWeight: 800, fontFamily: "Montserrat", color: "#1b1233", effect, ...extra });
  page.elements.push(
    createText({ text: "Typography", x: 40, y: 24, fontSize: 64, fontWeight: 800, fontFamily: "Playfair Display", color: "#1b1233" }),
    sample("Shadow", E("shadow", { color: "#7c3aed", offset: 60, direction: 45, blur: 40, transparency: 30 }), 40, 120),
    sample("Lift", E("lift", { intensity: 70 }), 330, 120),
    sample("Hollow", E("hollow", { thickness: 40 }), 580, 120, { color: "#e11d48" }),
    sample("Outline", E("outline", { color: "#7c3aed", thickness: 60 }), 860, 120, { color: "#ffffff" }),
    sample("Splice", E("splice", { color: "#14b8a6", offset: 50, direction: 45, thickness: 40 }), 40, 200, { color: "#1b1233" }),
    sample("Echo", E("echo", { color: "#e11d48", offset: 60, direction: 45 }), 330, 200),
    sample("Glitch", E("glitch", { offset: 60 }), 580, 200),
    createShape("rect", { x: 840, y: 190, width: 330, height: 90, radius: 14, fill: solid("#150b2e") }),
    sample("Neon", E("neon", { color: "#ec4899", intensity: 70 }), 870, 200, { color: "#ffffff", fontFamily: "Bebas Neue", fontWeight: 400 }),
    sample("Background", E("background", { color: "#fde68a", roundness: 60, spread: 50 }), 40, 290, { fontSize: 44 }),
    createText({
      text: "Gradient text",
      x: 420,
      y: 290,
      fontSize: 64,
      fontWeight: 800,
      fontFamily: "Outfit",
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#7c3aed" },
          { offset: 1, color: "#f59e0b" },
        ],
      },
    }),
    createText({
      x: 40,
      y: 390,
      width: 520,
      autoWidth: false,
      fontSize: 24,
      lineHeight: 1.4,
      align: "justify",
      fontFamily: "Lora",
      paragraphs: [
        {
          runs: [
            { text: "Rich text mixes " },
            { text: "bold", bold: true },
            { text: ", " },
            { text: "italic", italic: true },
            { text: ", " },
            { text: "underlined", underline: true },
            { text: ", " },
            { text: "struck out", strike: true },
            { text: " and " },
            { text: "coloured", color: "#e11d48" },
            { text: " runs, plus a " },
            { text: "much larger", size: 40, font: "Pacifico" },
            { text: " word that stretches its line. The paragraph is justified to the box width." },
          ],
        },
      ],
    }),
    createText({
      x: 600,
      y: 390,
      width: 260,
      autoWidth: false,
      fontSize: 24,
      fontFamily: "Poppins",
      lineHeight: 1.5,
      paragraphs: [
        { list: "bullet", runs: [{ text: "Bullets keep a hanging indent" }] },
        { list: "bullet", runs: [{ text: "Second bullet, long enough to wrap onto another line" }] },
      ],
    }),
    createText({
      x: 900,
      y: 390,
      width: 260,
      autoWidth: false,
      fontSize: 24,
      fontFamily: "Poppins",
      lineHeight: 1.5,
      list: "number",
      paragraphs: [{ runs: [{ text: "First step" }] }, { runs: [{ text: "Second step with extra words to wrap" }] }, { runs: [{ text: "Third" }] }],
    }),
    createText({ text: "centered text\nin two lines", x: 40, y: 600, width: 300, autoWidth: false, align: "center", fontSize: 28, fontFamily: "Josefin Sans", color: "#4a4160" }),
    createText({ text: "right aligned\nlines", x: 360, y: 600, width: 300, autoWidth: false, align: "right", fontSize: 28, fontFamily: "Josefin Sans", color: "#4a4160" }),
    createText({ text: "spaced caps", x: 700, y: 610, fontSize: 30, fontWeight: 700, letterSpacing: 300, textCase: "upper", fontFamily: "Space Grotesk", color: "#0e7490" }),
    createText({ text: "Rotated 20", x: 760, y: 700, fontSize: 36, fontWeight: 700, rotation: -20, fontFamily: "Fredoka", color: "#9333ea", opacity: 0.8 }),
    createText({ text: "ARCH UP", x: 40, y: 700, fontSize: 40, fontWeight: 800, curve: 60, letterSpacing: 100, fontFamily: "Montserrat", color: "#e11d48" }),
    createText({ text: "BOW DOWN", x: 360, y: 690, fontSize: 40, fontWeight: 800, curve: -60, letterSpacing: 100, fontFamily: "Montserrat", color: "#0f766e" }),
    createText({ text: "Blurred", x: 1000, y: 700, fontSize: 40, fontFamily: "Anton", color: "#111827", blur: 2.5 }),
  );
  return page;
}

function shapesPage(): Page {
  const page = createPage({ background: lin(180, "#f8fafc", "#e2e8f0") });
  const kinds = ["rect", "ellipse", "triangle", "star", "heart", "hexagon", "arrow-right", "cloud", "speech", "blob-1", "ring", "burst"];
  kinds.forEach((kind, i) => {
    const x = 30 + (i % 6) * 190;
    const y = 30 + Math.floor(i / 6) * 150;
    const fill: Fill =
      i % 3 === 0
        ? lin(135, "#7c3aed", "#14b8a6")
        : i % 3 === 1
          ? {
              type: "radial",
              cx: 0.35,
              cy: 0.35,
              stops: [
                { offset: 0, color: "#fde68a" },
                { offset: 1, color: "#f97316" },
              ],
            }
          : solid("#38bdf8");
    page.elements.push(
      createShape(kind, {
        x,
        y,
        width: 130,
        height: 110,
        radius: kind === "rect" ? 28 : 0,
        fill,
        stroke:
          i % 4 === 0
            ? { color: "#1e1b4b", width: 6, style: "solid" }
            : i % 4 === 1
              ? { color: "#be123c", width: 5, style: "dashed", cap: "round" }
              : i % 4 === 2
                ? { color: "#047857", width: 6, style: "dotted" }
                : null,
      }),
    );
  });
  const patterns = ["dots", "grid", "lines", "diagonal", "checker", "waves", "zigzag", "plus", "bubbles", "noise"] as const;
  patterns.forEach((pattern, i) => {
    page.elements.push(
      createShape("rect", {
        x: 30 + (i % 5) * 225,
        y: 350 + Math.floor(i / 5) * 120,
        width: 200,
        height: 100,
        radius: 12,
        fill: { type: "pattern", pattern, color: i % 2 ? "#7c3aed" : "#0f172a", background: i % 2 ? "#ede9fe" : "#fef9c3", scale: i === 4 ? 0.5 : 1 },
      }),
    );
  });
  page.elements.push(
    createShape("star", { x: 60, y: 600, width: 120, height: 120, fill: solid("#facc15"), shadow: { color: "rgba(30,27,75,.45)", blur: 18, x: 12, y: 14 }, rotation: 30 }),
    createShape("ellipse", { x: 230, y: 610, width: 120, height: 100, fill: solid("#ef4444"), blur: 6 }),
    createShape("rect", {
      x: 400,
      y: 610,
      width: 140,
      height: 100,
      radius: 20,
      fill: solid("#6366f1"),
      stroke: { color: "#312e81", width: 8, style: "solid", join: "miter" },
      opacity: 0.55,
      rotation: -12,
      flipH: true,
    }),
    createGroup(
      [
        createShape("rect", { x: 0, y: 0, width: 120, height: 60, fill: solid("#10b981") }),
        createShape("ellipse", { x: 40, y: 40, width: 60, height: 60, fill: solid("#f43f5e"), opacity: 0.8 }),
      ],
      { x: 600, y: 610, width: 120, height: 100, rotation: 15, opacity: 0.9 },
    ),
  );
  const arrows = ["none", "arrow", "triangle", "open-arrow", "circle", "square", "diamond", "bar"] as const;
  arrows.forEach((end, i) => {
    page.elements.push(
      createLine({
        x: 780 + (i % 2) * 210,
        y: 610 + Math.floor(i / 2) * 36,
        width: 170,
        startArrow: i === 3 ? "circle" : "none",
        endArrow: end,
        stroke: { color: i % 2 ? "#7c3aed" : "#0f172a", width: 4 + (i % 3), style: i === 5 ? "dashed" : "solid", cap: "round" },
        shadow: i === 7 ? { color: "rgba(0,0,0,.4)", blur: 6, x: 4, y: 6 } : null,
      }),
    );
  });
  return page;
}

function mediaPage(): Page {
  const page = createPage({ background: solid("#ffffff") });
  const photo = (id: string, extra: Record<string, unknown>) => createImage({ src: `builtin:${id}`, naturalWidth: 1600, naturalHeight: 1067, ...extra });
  page.elements.push(
    photo("sunset-hills", { x: 30, y: 30, width: 240, height: 160 }),
    photo("ocean-waves", { x: 290, y: 30, width: 160, height: 160, mask: "ellipse", stroke: { color: "#7c3aed", width: 6, style: "solid" } }),
    photo("mountain-lake", { x: 470, y: 30, width: 170, height: 160, mask: "heart" }),
    photo("aurora-night", {
      x: 660,
      y: 30,
      width: 240,
      height: 160,
      radius: 28,
      filter: { ...defaultFilter(), preset: "vintage", intensity: 100 },
      shadow: { color: "rgba(0,0,0,.35)", blur: 20, x: 8, y: 12 },
    }),
    photo("forest-mist", {
      x: 920,
      y: 30,
      width: 240,
      height: 160,
      filter: { ...defaultFilter(), brightness: 10, contrast: 20, saturation: -40, warmth: 30, vignette: 50, fade: 20 },
    }),
    photo("desert-dunes", {
      x: 30,
      y: 215,
      width: 240,
      height: 160,
      crop: { x: -0.4, y: -0.2, w: 1.8, h: 1.6 },
      filter: { ...defaultFilter(), preset: "duo-ocean", intensity: 100 },
    }),
    photo("city-night", { x: 290, y: 215, width: 160, height: 160, mask: "hexagon", filter: { ...defaultFilter(), blur: 8, hue: 40 } }),
    createFrame("ellipse", { x: 470, y: 215, width: 160, height: 160 }),
    photo("tropical-beach", { x: 660, y: 215, width: 200, height: 160, rotation: 8, opacity: 0.85 }),
  );
  GRAPHICS_A.slice(0, 5).forEach((g, i) => {
    page.elements.push(
      createGraphic({
        svg: g.svg,
        x: 880 + (i % 3) * 100,
        y: 215 + Math.floor(i / 3) * 100,
        width: 90,
        height: 90,
        rotation: i === 1 ? 20 : 0,
        opacity: i === 2 ? 0.7 : 1,
        shadow: i === 3 ? { color: "rgba(0,0,0,.4)", blur: 8, x: 4, y: 6 } : null,
      }),
    );
  });
  page.elements.push(
    createTable({
      x: 30,
      y: 410,
      width: 480,
      height: 200,
      cells: [
        ["Plan", "Seats", "Price"],
        ["Starter", "5", "$9"],
        ["Team with a long name", "25", "$49"],
        ["Enterprise", "500", "Custom"],
      ],
      colWidths: [220, 100, 160],
      rowHeights: [50, 50, 50, 50],
      fontSize: 20,
      align: "left",
    }),
    createChart({
      x: 540,
      y: 410,
      width: 300,
      height: 190,
      chart: "column",
      series: [
        { name: "A", values: [12, 30, 22, 41] },
        { name: "B", values: [20, 18, 35, 28] },
      ],
      showLegend: true,
    }),
    createChart({ x: 860, y: 410, width: 300, height: 190, chart: "bar", series: [{ name: "Sales", values: [34, 52, 18, 40] }], labels: ["North", "South", "East", "West"] }),
    createChart({ x: 30, y: 620, width: 280, height: 170, chart: "line", showLegend: true, series: [{ name: "Users", values: [10, 25, 18, 40] }] }),
    createChart({ x: 330, y: 620, width: 280, height: 170, chart: "area", series: [{ name: "Users", values: [10, 25, 18, 40] }], showValues: false }),
    createChart({ x: 630, y: 620, width: 260, height: 170, chart: "pie", showLegend: true, series: [{ name: "Share", values: [40, 25, 20, 15] }], labels: ["A", "B", "C", "D"] }),
    createChart({ x: 910, y: 620, width: 260, height: 170, chart: "donut", showLegend: true, series: [{ name: "Share", values: [55, 30, 15] }], labels: ["X", "Y", "Z"] }),
  );
  return page;
}

function backgroundPage(name: string, background: Fill, ink = "#1b1233"): Page {
  const page = createPage({ background, name });
  page.elements.push(
    createText({ text: name, x: 60, y: 60, fontSize: 72, fontWeight: 800, fontFamily: "Bricolage Grotesque", color: ink }),
    createShape("rect", { x: 60, y: 200, width: 360, height: 120, radius: 20, fill: { type: "solid", color: "rgba(255,255,255,.7)" }, link: "https://craftly.test/background" }),
    createText({ text: "Semi-transparent card", x: 90, y: 240, fontSize: 28, fontFamily: "Inter", color: "#111827" }),
  );
  return page;
}

export function stressDesign(): Design {
  return createDesign({
    title: "Stress: Q4 / Plan? *draft*",
    typeId: "custom",
    width: 1200,
    height: 800,
    pages: [
      typographyPage(),
      shapesPage(),
      mediaPage(),
      backgroundPage("Pattern", { type: "pattern", pattern: "waves", color: "#c4b5fd", background: "#faf5ff", scale: 1.2 }),
      backgroundPage("Radial", {
        type: "radial",
        cx: 0.3,
        cy: 0.3,
        stops: [
          { offset: 0, color: "#fef3c7" },
          { offset: 1, color: "#fb7185" },
        ],
      }),
      backgroundPage("Photo cover", { type: "image", src: "builtin:nebula", fit: "cover", dim: 0.35 }, "#ffffff"),
      backgroundPage("Photo contain", { type: "image", src: "builtin:sunset-hills", fit: "contain" }),
      backgroundPage("Photo tile", { type: "image", src: "builtin:terrazzo", fit: "tile", dim: -0.3 }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* helpers used by the scripted checks                                  */
/* ------------------------------------------------------------------ */

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  return c;
}

async function svgToCanvas(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.drawImage(img, 0, 0, width, height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Mean absolute RGB difference (0..255, composited over white) and the share of pixels differing by more than 8. */
function diffStats(a: HTMLCanvasElement, b: HTMLCanvasElement) {
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] as number[] };
  const da = a.getContext("2d")!.getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext("2d")!.getImageData(0, 0, b.width, b.height).data;
  let sum = 0;
  let max = 0;
  let over = 0;
  const px = a.width * a.height;
  for (let i = 0; i < da.length; i += 4) {
    const aa = da[i + 3] / 255;
    const ba = db[i + 3] / 255;
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const va = da[i + k] * aa + 255 * (1 - aa);
      const vb = db[i + k] * ba + 255 * (1 - ba);
      const d = Math.abs(va - vb);
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > max) max = worst;
    if (worst > 8) over++;
  }
  return { mean: sum / (px * 3), max, overPct: (over / px) * 100, pixels: px };
}

/** [a | b | amplified difference] on one canvas, as a PNG data URL; `region` + `zoom` crop and magnify. */
function compareSheet(
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
  labels: [string, string] = ["canvas", "other"],
  region?: { x: number; y: number; w: number; h: number },
  zoom = 1,
): string {
  const r = region ?? { x: 0, y: 0, w: a.width, h: a.height };
  const w = Math.round(r.w * zoom);
  const h = Math.round(r.h * zoom);
  const gap = 12;
  const head = 28;
  const sheet = document.createElement("canvas");
  sheet.width = w * 3 + gap * 4;
  sheet.height = h + head + gap * 2;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = "#334155";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.imageSmoothingEnabled = false;
  const cell = (source: HTMLCanvasElement, i: number) => {
    const x = gap + i * (w + gap);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, head, w, h);
    ctx.drawImage(source, r.x, r.y, r.w, r.h, x, head, w, h);
  };
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 16px sans-serif";
  ctx.fillText(labels[0], gap, 20);
  ctx.fillText(labels[1], gap * 2 + w, 20);
  ctx.fillText("difference x4", gap * 3 + w * 2, 20);
  cell(a, 0);
  cell(b, 1);
  // difference map over the same region
  const da = a.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data;
  const db = b.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data;
  const diff = document.createElement("canvas");
  diff.width = r.w;
  diff.height = r.h;
  const dctx = diff.getContext("2d")!;
  const img = dctx.createImageData(r.w, r.h);
  for (let i = 0; i < da.length; i += 4) {
    const aa = da[i + 3] / 255;
    const ba = db[i + 3] / 255;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(da[i + k] * aa + 255 * (1 - aa) - (db[i + k] * ba + 255 * (1 - ba))));
    const v = 255 - Math.min(255, d * 4);
    img.data[i] = 255;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  dctx.putImageData(img, 0, 0);
  ctx.drawImage(diff, 0, 0, r.w, r.h, gap + 2 * (w + gap), head, w, h);
  return sheet.toDataURL("image/png");
}

function openDesign(which: "sample" | "stress") {
  const design = which === "stress" ? stressDesign() : sampleDesign();
  useEditor.getState().actions.openDesign(design);
  return design;
}

const hooks = {
  exportDesign,
  pagePngBlob,
  designPageToSvg,
  renderPageToCanvas,
  blobToCanvas,
  svgToCanvas,
  diffStats,
  compareSheet,
  openDesign,
  createZip,
  fontFileUrl,
  exportProjectFile,
  importProjectFile,
  printDesign,
  downloadBlob,
  stressDesign,
  sampleDesign,
};

declare global {
  interface Window {
    __editor: typeof useEditor;
    __h: typeof hooks;
    __ready?: boolean;
  }
}

window.__editor = useEditor;
window.__h = hooks;
openDesign("sample");

/* ------------------------------------------------------------------ */
/* page                                                                 */
/* ------------------------------------------------------------------ */

const pngOptions: ExportOptions = { format: "png", pages: [0], scale: 1, quality: 0.92, transparent: false, pdfMode: "standard", embedFonts: true };

function Harness() {
  const [which, setWhich] = useState<"sample" | "stress">("sample");
  const [log, setLog] = useState("");
  const say = (text: string) => setLog(text);
  const pageIndex = () => {
    const s = useEditor.getState();
    return Math.max(
      0,
      (s.design?.pages ?? []).findIndex((p) => p.id === s.activePageId),
    );
  };
  const withDesign = (fn: (d: Design) => Promise<void> | void) => async () => {
    const d = useEditor.getState().design;
    if (!d) return say("no design");
    try {
      await fn(d);
    } catch (e) {
      say(`error: ${(e as Error).message}`);
    }
  };

  return (
    <div style={{ display: "flex", gap: 24, padding: 24, alignItems: "flex-start", minHeight: "100%", background: "var(--c-workspace)" }}>
      <div style={{ width: 360, background: "var(--c-bg)", borderRadius: "var(--r-lg)", boxShadow: "var(--sh-pop)" }} id="download-card">
        <DownloadPanel onDone={() => say("onDone fired")} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
        <strong>Export harness</strong>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant={which === "sample" ? "primary" : "secondary"}
            onClick={() => {
              openDesign("sample");
              setWhich("sample");
            }}
          >
            Sample design
          </Button>
          <Button
            size="sm"
            variant={which === "stress" ? "primary" : "secondary"}
            onClick={() => {
              openDesign("stress");
              setWhich("stress");
            }}
          >
            Stress design
          </Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" onClick={withDesign((d) => printDesign(d).then(() => say("print dialog requested")))}>
            Print
          </Button>
          <Button size="sm" onClick={withDesign((d) => copyPageAsImage(d, pageIndex()).then(() => say("copied page to the clipboard")))}>
            Copy page
          </Button>
          <Button size="sm" onClick={withDesign(async (d) => downloadBlob(await exportProjectFile(d), `${d.title}.craftly`))}>
            Project file
          </Button>
          <Button
            size="sm"
            onClick={withDesign(async (d) => {
              const f = await exportDesign(d, { ...pngOptions, pages: [pageIndex()] });
              downloadBlob(f.blob, f.name);
              say(`saved ${f.name}`);
            })}
          >
            Quick PNG
          </Button>
          <label style={{ fontSize: 13 }}>
            Import:&nbsp;
            <input
              type="file"
              accept=".craftly,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const imported = await importProjectFile(file);
                  say(`imported "${imported.title}" as ${imported.id}`);
                  toast.show({ kind: "success", message: `Imported ${imported.title}` });
                } catch (error) {
                  say(`import failed: ${(error as Error).message}`);
                  toast.show({ kind: "error", message: (error as Error).message });
                }
              }}
            />
          </label>
        </div>
        <pre id="log" style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
          {log}
        </pre>
      </div>
      <ToastHost />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
window.__ready = true;

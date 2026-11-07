/**
 * Dev-only contact sheet for the print templates (src/data/templates/print.ts).
 *
 *   ?cat=poster            only one category
 *   ?id=poster-xyz         only one template (all pages)
 *   ?page=1                only page index 1 of the selected templates
 *   ?w=340                 canvas width in CSS px (default 340)
 *   ?guides=1              draw the safe-margin rectangle
 *   ?cols=4                grid columns (default: auto)
 *   ?sheet=photos          procedural photo catalogue
 *   ?sheet=graphics&gcat=frames,dividers,badges   graphics catalogue (ids as captions)
 *   ?sheet=fonts           type specimen of the fonts used by the print templates
 *
 * After rendering, `window.__ready` is true and `window.__lint` holds measured text boxes and warnings.
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { createGraphic, createPage, createText, solid } from "@/core/factory";
import type { DesignElement, Page, Template } from "@/core/types";
import { GRAPHICS } from "@/data/graphics";
import { PHOTOS, getPhotoThumb } from "@/data/photos";
import { SIZES } from "@/data/templates/dsl";
import { PRINT_TEMPLATES } from "@/data/templates/print";
import { collectResources, renderPageToCanvas } from "@/render/renderPage";
import { FONT_CATALOG, cssFontFamily, ensureFont } from "@/render/fonts";
import { layoutText, measureTextElement } from "@/render/textLayout";

interface TextInfo {
  i: number;
  txt: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bottom: number;
  lines: number;
  ink: number;
  fs: number;
  font: string;
}

interface PageLint {
  texts: TextInfo[];
  warn: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __lint?: Record<string, PageLint[]>;
    __fonts?: string[];
  }
}

const params = new URLSearchParams(location.search);
const W = Number(params.get("w") ?? 340);
const GUIDES = params.get("guides") === "1";
const COLS = params.get("cols");

const root = document.getElementById("root") as HTMLElement;
document.body.style.cssText = "margin:0;background:#cfd2da;font:12px/1.35 var(--font-ui);color:#1b1f27";
root.style.cssText = "height:auto;padding:16px;";

const grid = document.createElement("div");
grid.style.cssText = `display:grid;gap:18px 16px;align-items:start;grid-template-columns:${COLS ? `repeat(${COLS},max-content)` : `repeat(auto-fill,${W}px)`};`;
root.appendChild(grid);

function card(caption: string, sub: string, warnCount: number): { host: HTMLElement; box: HTMLElement } {
  const host = document.createElement("figure");
  host.style.cssText = `margin:0;width:${W}px;`;
  const box = document.createElement("div");
  box.style.cssText = `position:relative;width:${W}px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.28);`;
  const cap = document.createElement("figcaption");
  cap.style.cssText = "margin-top:6px;font-weight:700;font-size:12px;";
  cap.textContent = caption;
  const subEl = document.createElement("div");
  subEl.style.cssText = `font-weight:500;font-size:11px;color:${warnCount ? "#b42318" : "#566"};`;
  subEl.textContent = sub;
  host.append(box, cap, subEl);
  grid.appendChild(host);
  return { host, box };
}

/** Text elements get their real box (editor behaviour) so selection-sized lint works. */
function measureAll(els: DesignElement[]): void {
  for (const el of els) {
    if (el.type === "text") {
      const m = measureTextElement(el);
      el.width = m.width;
      el.height = m.height;
    } else if (el.type === "group") {
      measureAll(el.children);
    }
  }
}

async function loadFontsFor(page: Page): Promise<void> {
  const res = collectResources(page);
  await Promise.all([...res.fonts.values()].map((f) => ensureFont(f.family, f.weight, f.italic)));
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

function lintPage(t: Template, page: Page): PageLint {
  const texts: TextInfo[] = [];
  const warn: string[] = [];
  const margin = Math.max(10, Math.round(Math.min(t.width, t.height) * 0.03));
  const boxes: Array<{ i: number; x0: number; y0: number; x1: number; y1: number; label: string; rotated: boolean }> = [];

  page.elements.forEach((el, i) => {
    if (el.type !== "text") return;
    const layout = layoutText(el);
    const flat = el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" | ");
    const flatWords = el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ");
    const label = `#${i} "${flat.slice(0, 28)}"`;
    texts.push({
      i,
      txt: flat.slice(0, 40),
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.width),
      h: Math.round(el.height),
      bottom: Math.round(el.y + el.height),
      lines: layout.lines.length,
      ink: Math.round(layout.contentWidth),
      fs: el.fontSize,
      font: `${el.fontFamily} ${el.fontWeight}`,
    });
    if (el.name === "bleed") return;
    // ink extent
    let inkL = Infinity;
    let inkR = -Infinity;
    for (const ln of layout.lines) {
      inkL = Math.min(inkL, ln.x);
      inkR = Math.max(inkR, ln.x + ln.width);
    }
    const ix0 = el.x + (Number.isFinite(inkL) ? inkL : 0);
    const ix1 = el.x + (Number.isFinite(inkR) ? inkR : el.width);
    const rotated = Math.abs(el.rotation) > 0.01;
    if (!rotated) {
      if (ix0 < margin - 0.5 || ix1 > t.width - margin + 0.5) warn.push(`margin-x ${label} ink ${Math.round(ix0)}..${Math.round(ix1)} of ${t.width}`);
      if (el.y < margin - 0.5 || el.y + el.height > t.height - margin + 0.5) warn.push(`margin-y ${label} y ${Math.round(el.y)}..${Math.round(el.y + el.height)} of ${t.height}`);
    }
    // broken words
    const orig = new Set(words(flatWords));
    for (const ln of layout.lines) {
      const lineText = ln.segments.map((s) => s.text).join("");
      for (const w of words(lineText)) {
        if (!orig.has(w) && !el.autoWidth) {
          warn.push(`broken-word ${label} fragment "${w}"`);
          break;
        }
      }
    }
    // orphan: last line of a multi-line paragraph with a single short word
    layout.lines.forEach((ln, li) => {
      const next = layout.lines[li + 1];
      const lastOfPara = !next || next.paragraph !== ln.paragraph;
      const firstOfPara = li === 0 || layout.lines[li - 1].paragraph !== ln.paragraph;
      if (lastOfPara && !firstOfPara) {
        const txt = ln.segments
          .map((s) => s.text)
          .join("")
          .trim();
        if (words(txt).length === 1 && ln.width < el.width * 0.18 && el.fontSize < 60) warn.push(`orphan ${label} last line "${txt}"`);
      }
    });
    boxes.push({ i, x0: ix0, y0: el.y, x1: ix1, y1: el.y + el.height, label, rotated });
  });

  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a];
      const B = boxes[b];
      if (A.rotated || B.rotated) continue;
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ox > 6 && oy > 3) warn.push(`overlap ${A.label} x ${B.label} (${Math.round(ox)}x${Math.round(oy)})`);
    }
  }
  return { texts, warn };
}

async function renderTemplates(): Promise<void> {
  const cat = params.get("cat");
  const idq = params.get("id");
  const pageOnly = params.get("page");
  const list = PRINT_TEMPLATES.filter((t) => (!cat || t.category === cat) && (!idq || t.id === idq || idq.split(",").includes(t.id)));
  window.__lint = {};
  const fontsUsed = new Set<string>();
  const dpr = Math.min(2, Number(params.get("dpr") ?? 1));
  for (const t of list) {
    window.__lint[t.id] = [];
    for (let pi = 0; pi < t.pages.length; pi++) {
      if (pageOnly !== null && Number(pageOnly) !== pi) continue;
      const page = structuredClone(t.pages[pi]);
      await loadFontsFor(page);
      measureAll(page.elements);
      const lint = lintPage(t, page);
      window.__lint[t.id].push(lint);
      for (const f of collectResources(page).fonts.values()) fontsUsed.add(f.family);
      const canvas = await renderPageToCanvas({ width: t.width, height: t.height }, page, { width: Math.round(W * dpr) });
      canvas.style.cssText = `display:block;width:${W}px;height:${Math.round((W * t.height) / t.width)}px;`;
      const { box } = card(
        `${t.name}${t.pages.length > 1 ? `  (page ${pi + 1}/${t.pages.length})` : ""}`,
        `${t.id} - ${t.width}x${t.height}${lint.warn.length ? ` - ${lint.warn.length} warning(s)` : ""}`,
        lint.warn.length,
      );
      box.appendChild(canvas);
      if (GUIDES) {
        const m = Math.max(10, Math.round(Math.min(t.width, t.height) * 0.03));
        const g = document.createElement("div");
        const k = W / t.width;
        g.style.cssText = `position:absolute;left:${m * k}px;top:${m * k}px;right:${m * k}px;bottom:${m * k}px;border:1px dashed rgba(230,30,60,.55);pointer-events:none;`;
        box.appendChild(g);
      }
    }
  }
  window.__fonts = [...fontsUsed].sort();
}

/** ?audit=1 - structural checks over every print template (fonts per template, tags, duplicate ids / names, placeholder copy). */
function runAudit(): void {
  const rows: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const counts: Record<string, number> = {};
  const catalogFamilies = new Set(FONT_CATALOG.map((f) => f.family));
  const visitText = (els: DesignElement[], out: string[]) => {
    for (const el of els) {
      if (el.type === "text") out.push(el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" "));
      else if (el.type === "group") visitText(el.children, out);
    }
  };
  for (const t of PRINT_TEMPLATES) {
    counts[t.category] = (counts[t.category] ?? 0) + 1;
    const fams = new Set<string>();
    const texts: string[] = [];
    let elements = 0;
    for (const p of t.pages) {
      for (const f of collectResources(p).fonts.values()) fams.add(f.family);
      visitText(p.elements, texts);
      elements += p.elements.length;
    }
    const problems: string[] = [];
    if (ids.has(t.id)) problems.push("DUPLICATE ID");
    if (names.has(t.name)) problems.push("DUPLICATE NAME");
    ids.add(t.id);
    names.add(t.name);
    if (fams.size > 2) problems.push(`${fams.size} font families`);
    for (const f of fams) if (!catalogFamilies.has(f)) problems.push(`font not in catalogue: ${f}`);
    if (t.tags.length < 6) problems.push(`only ${t.tags.length} tags`);
    if (texts.some((s) => /lorem|your text|add text|placeholder|ipsum/i.test(s))) problems.push("placeholder copy");
    const e = SIZES_BY_TYPE[t.typeId];
    if (e && (e[0] !== t.width || e[1] !== t.height)) problems.push(`size ${t.width}x${t.height} does not match type ${t.typeId}`);
    rows.push(
      `${t.id.padEnd(34)} ${t.category.padEnd(11)} ${String(t.width).padStart(4)}x${String(t.height).padEnd(4)} pages ${t.pages.length}  els ${String(elements).padStart(3)}  fonts [${[...fams].join(" + ")}]  tags ${t.tags.length}  accent ${t.accent}${problems.length ? "   !! " + problems.join("; ") : ""}`,
    );
  }
  rows.push(
    `TOTAL ${PRINT_TEMPLATES.length} templates: ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  (window as unknown as { __audit: string[] }).__audit = rows;
  const pre = document.createElement("pre");
  pre.style.cssText = "font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;";
  pre.textContent = rows.join("\n");
  root.appendChild(pre);
}

const SIZES_BY_TYPE: Record<string, [number, number]> = Object.fromEntries(Object.values(SIZES).map((s) => [s.typeId, [s.width, s.height]]));

async function renderPhotos(): Promise<void> {
  for (const p of PHOTOS) {
    const url = await getPhotoThumb(p.id, W * 2);
    const { box } = card(p.id, `${p.category} - ${p.width}x${p.height}`, 0);
    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = `display:block;width:${W}px;`;
    box.appendChild(img);
    await img.decode().catch(() => undefined);
  }
}

async function renderGraphics(): Promise<void> {
  const only = (params.get("gcat") ?? "").split(",").filter(Boolean);
  const idq = (params.get("gid") ?? "").split(",").filter(Boolean);
  const list = GRAPHICS.filter((g) => (!only.length || only.includes(g.category)) && (!idq.length || idq.some((q) => g.id.includes(q))));
  for (const g of list) {
    const el = createGraphic({ svg: g.svg, x: 10, y: 10, width: 1, height: 1 });
    const ratio = el.viewW / el.viewH;
    const bw = 220;
    const bh = Math.round(bw / ratio);
    el.width = bw;
    el.height = bh;
    const page = createPage({ background: solid("#f4f1ea"), elements: [el] });
    el.x = 0;
    el.y = 0;
    const canvas = await renderPageToCanvas({ width: bw, height: bh }, page, { width: W });
    canvas.style.cssText = `display:block;width:${W}px;`;
    const { box } = card(g.id, `${g.category} - viewBox ${el.viewW}x${el.viewH}`, 0);
    box.appendChild(canvas);
  }
}

async function renderFonts(): Promise<void> {
  const families = (
    params.get("fam") ??
    "Playfair Display,Cormorant Garamond,Fraunces,DM Serif Display,Cinzel,Libre Baskerville,Lora,Bebas Neue,Anton,Oswald,Archivo Black,Abril Fatface,Yeseva One,Syne,Great Vibes,Dancing Script,Satisfy,Caveat,Space Mono,JetBrains Mono,Montserrat,Inter,DM Sans,Poppins,Raleway,Josefin Sans,Manrope,Outfit,Work Sans,Space Grotesk,Bricolage Grotesque"
  ).split(",");
  const weights = [400, 700];
  for (const fam of families) {
    const els: DesignElement[] = [];
    let y = 8;
    for (const wgt of weights) {
      await ensureFont(fam, wgt, false);
      await ensureFont(fam, wgt, true);
      els.push(
        createText({ text: `${fam} ${wgt}  Hamburgefonstiv 0123456789`, x: 12, y, width: 760, autoWidth: false, fontSize: 40, fontWeight: wgt, fontFamily: fam, lineHeight: 1.1 }),
      );
      y += 50;
      els.push(
        createText({
          text: "The quick brown fox jumps over the lazy dog, sphinx of black quartz.",
          x: 12,
          y,
          width: 760,
          autoWidth: false,
          fontSize: 20,
          fontWeight: wgt,
          italic: true,
          fontFamily: fam,
          lineHeight: 1.1,
        }),
      );
      y += 30;
    }
    const page = createPage({ background: solid("#ffffff"), elements: els });
    const canvas = await renderPageToCanvas({ width: 800, height: y + 8 }, page, { width: W * 2 });
    canvas.style.cssText = `display:block;width:${W}px;`;
    const { box } = card(fam, "", 0);
    box.appendChild(canvas);
  }
}

/** window.__probe(family, weight, text, size, spacing?, italic?) -> painted width of one line (for fitting headlines). */
(window as unknown as { __probe: (family: string, weight: number, text: string, size: number, spacing?: number, italic?: boolean) => Promise<number> }).__probe = async (
  family,
  weight,
  text,
  size,
  spacing = 0,
  italic = false,
) => {
  await ensureFont(family, weight, italic);
  const el = createText({ text, fontFamily: family, fontWeight: weight, fontSize: size, letterSpacing: spacing, italic, autoWidth: true, lineHeight: 1 });
  return layoutText(el).contentWidth;
};

/** window.__metrics(family, weight, italic?) -> ascent / descent / cap height / x height in em (fontBoundingBox based, like the layout). */
(window as unknown as { __metrics: (family: string, weight: number, italic?: boolean) => Promise<Record<string, number>> }).__metrics = async (family, weight, italic = false) => {
  await ensureFont(family, weight, italic);
  const c = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  c.font = `${italic ? "italic " : ""}${weight} 1000px ${cssFontFamily(family)}`;
  const h = c.measureText("H");
  const x = c.measureText("x");
  const m = c.measureText("Hxg");
  return { A: m.fontBoundingBoxAscent / 1000, D: m.fontBoundingBoxDescent / 1000, cap: h.actualBoundingBoxAscent / 1000, xh: x.actualBoundingBoxAscent / 1000 };
};

async function main(): Promise<void> {
  const sheet = params.get("sheet");
  try {
    if (params.get("audit") === "1") runAudit();
    else if (sheet === "photos") await renderPhotos();
    else if (sheet === "graphics") await renderGraphics();
    else if (sheet === "fonts") await renderFonts();
    else await renderTemplates();
  } catch (error) {
    const pre = document.createElement("pre");
    pre.style.cssText = "color:#b42318;white-space:pre-wrap;";
    pre.textContent = String(error instanceof Error ? error.stack : error);
    root.prepend(pre);
    console.error(error);
  }
  window.__ready = true;
}

void main();

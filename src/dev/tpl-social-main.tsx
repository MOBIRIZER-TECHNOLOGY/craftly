/**
 * Dev-only contact sheet for the social + logo templates (dev-tpl-social.html).
 *
 * Query string:
 *   ids=3-7 | ids=peach,sale   which templates (index range, or id/name fragments); default all
 *   w=360                      canvas width in CSS px (1080 for a full-size look)
 *   debug=1                    outline text boxes and the safe area
 *   mode=graphics              render the illustration library instead (id + colours)
 *
 * It mimics what the editor does when a design opens: fonts are loaded first, then every text box
 * is measured with measureTextElement, then the page is painted with renderPageToCanvas.
 * It also lints each page (fonts, safe area, text overlaps, contrast against the painted background).
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { extractSvgColors } from "@/core/svg";
import type { DesignElement, Page, Template, TextElement } from "@/core/types";
import { GRAPHICS } from "@/data/graphics";
import { SOCIAL_TEMPLATES } from "@/data/templates/social";
import { ensureFont, getFontDef } from "@/render/fonts";
import { collectResources, preparePage, renderPage, renderPageToCanvas } from "@/render/renderPage";
import { layoutText, measureTextElement } from "@/render/textLayout";

const params = new URLSearchParams(location.search);
const CANVAS_W = Number(params.get("w") ?? 360);
const DEBUG = params.get("debug") === "1";
const MODE = params.get("mode") ?? "templates";
const IDS = params.get("ids");

declare global {
  interface Window {
    __ready?: boolean;
    __report?: unknown;
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const css = document.createElement("style");
css.textContent = `
  html,body{background:#cfd2dc;margin:0}
  .sheet{display:flex;flex-wrap:wrap;gap:28px 24px;padding:20px;align-items:flex-start;font:12px/1.35 var(--font-ui)}
  .card{display:flex;flex-direction:column;gap:6px}
  .card canvas{display:block;box-shadow:0 2px 12px rgba(0,0,0,.25);background:#fff}
  .cap{font-weight:700;font-size:12px;color:#1a1d26;max-width:var(--cw)}
  .cap small{font-weight:500;color:#4a5060;display:block}
  .warn{color:#a3001b;font-size:11px;max-width:var(--cw)}
  .info{color:#6b5b00;font-size:11px;max-width:var(--cw)}
  .tile{width:150px;font-size:10px;color:#1a1d26}
  .tile canvas{width:150px;height:150px;background:#fff;box-shadow:none}
  h1{font:700 14px var(--font-ui);padding:12px 20px 0;margin:0}
`;
document.head.appendChild(css);

const root = document.getElementById("root") as HTMLElement;
const sheet = document.createElement("div");
sheet.className = "sheet";
root.appendChild(sheet);

type Issue = { level: "warn" | "info"; msg: string };

const colorCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
colorCtx.canvas.width = 1;
colorCtx.canvas.height = 1;
const colorCache = new Map<string, [number, number, number, number]>();
function parseCss(color: string): [number, number, number, number] {
  let v = colorCache.get(color);
  if (!v) {
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = "#000";
    colorCtx.fillStyle = color;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    v = [d[0], d[1], d[2], d[3] / 255];
    colorCache.set(color, v);
  }
  return v;
}
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function walk(els: DesignElement[], fn: (el: DesignElement, ox: number, oy: number) => void, ox = 0, oy = 0): void {
  for (const el of els) {
    fn(el, ox, oy);
    if (el.type === "group") walk(el.children, fn, ox + el.x, oy + el.y);
  }
}

function textOf(el: TextElement): string {
  return el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" / ");
}

interface InkBox {
  el: TextElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ink rectangles (one per laid-out line), in page coordinates, for unrotated text. */
function inkRects(el: TextElement, ox: number, oy: number): Array<{ x: number; y: number; w: number; h: number }> {
  const layout = layoutText(el);
  return layout.lines.filter((l) => l.segments.length && l.width > 0).map((l) => ({ x: el.x + ox + l.x, y: el.y + oy + l.y, w: l.width, h: l.height }));
}

/* ------------------------------------------------------------------ */
/* per template                                                        */
/* ------------------------------------------------------------------ */

async function loadFonts(page: Page): Promise<void> {
  const res = collectResources(page);
  await Promise.all([...res.fonts.values()].map((f) => ensureFont(f.family, f.weight, f.italic)));
}

function measureAll(page: Page): void {
  walk(page.elements, (el) => {
    if (el.type !== "text") return;
    const m = measureTextElement(el);
    el.width = m.width;
    el.height = m.height;
  });
}

async function lintPage(tpl: Template, page: Page): Promise<Issue[]> {
  const issues: Issue[] = [];
  const W = tpl.width;
  const H = tpl.height;
  const isStory = H / W > 1.7;
  const logo = tpl.category === "logo";
  const sideM = logo ? 36 : 64;
  const topM = isStory ? 220 : logo ? 36 : 64;
  const botM = isStory ? 220 : logo ? 36 : 64;
  const texts: Array<{ el: TextElement; ox: number; oy: number }> = [];
  walk(page.elements, (el, ox, oy) => {
    if (el.type === "text" && !el.hidden) texts.push({ el, ox, oy });
  });

  // background without text, to measure contrast
  await preparePage(page);
  const SC = 0.25;
  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = Math.round(W * SC);
  bgCanvas.height = Math.round(H * SC);
  const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true })!;
  const hide = new Set(texts.map((t) => t.el.id));
  renderPage(bgCtx, tpl, page, { scale: SC, hide });
  const bg = bgCtx.getImageData(0, 0, bgCanvas.width, bgCanvas.height);

  const boxes: InkBox[] = [];
  for (const { el, ox, oy } of texts) {
    const label = `"${textOf(el).slice(0, 34)}"`;
    const rects = inkRects(el, ox, oy);
    if (!rects.length) continue;
    const skipEdge = (el.name ?? "").startsWith("Decorative");
    // bounds + safe area (rotated text is skipped: its ink box is not axis aligned)
    if (!el.rotation && !skipEdge && !el.curve) {
      const x0 = Math.min(...rects.map((r) => r.x));
      const x1 = Math.max(...rects.map((r) => r.x + r.w));
      const y0 = Math.min(...rects.map((r) => r.y));
      const y1 = Math.max(...rects.map((r) => r.y + r.h));
      if (x0 < -1 || y0 < -1 || x1 > W + 1 || y1 > H + 1)
        issues.push({ level: "warn", msg: `text outside page ${label} [${Math.round(x0)},${Math.round(y0)} - ${Math.round(x1)},${Math.round(y1)}]` });
      else if (x0 < sideM - 1 || x1 > W - sideM + 1 || y0 < topM - 1 || y1 > H - botM + 1)
        issues.push({ level: "warn", msg: `text in unsafe margin ${label} [${Math.round(x0)},${Math.round(y0)} - ${Math.round(x1)},${Math.round(y1)}]` });
    }
    if (el.fontSize < 34 && !skipEdge) issues.push({ level: "info", msg: `small text ${el.fontSize}px ${label}` });
    if (!getFontDef(el.fontFamily)) issues.push({ level: "warn", msg: `unknown font ${el.fontFamily}` });
    for (const r of rects) boxes.push({ el, ...r });

    // contrast (decorative text named with a leading "Decorative" is exempt)
    if (skipEdge || el.curve) continue;
    const k = el.effect.kind;
    if (k === "background" || k === "outline" || k === "neon" || k === "glitch" || k === "hollow" || k === "splice") continue;
    const runColors = new Set<string>();
    for (const para of el.paragraphs) for (const r of para.runs) if (r.text.trim()) runColors.add(r.color ?? el.color);
    if (!runColors.size) runColors.add(el.color);
    const colors = el.gradient ? el.gradient.stops.map((s) => s.color) : [...runColors];
    let worst = Infinity;
    for (const c of colors) {
      const [tr, tg, tb, ta] = parseCss(c);
      const a = ta * el.opacity;
      const ratios: number[] = [];
      for (const r of rects) {
        for (let iy = 0; iy < 3; iy++) {
          for (let ix = 0; ix < 9; ix++) {
            let px = r.x + (r.w * (ix + 0.5)) / 9;
            let py = r.y + r.h * (0.3 + 0.2 * iy);
            if (el.rotation) {
              const ecx = el.x + ox + el.width / 2;
              const ecy = el.y + oy + el.height / 2;
              const a2 = (el.rotation * Math.PI) / 180;
              const dx = px - ecx;
              const dy = py - ecy;
              px = ecx + dx * Math.cos(a2) - dy * Math.sin(a2);
              py = ecy + dx * Math.sin(a2) + dy * Math.cos(a2);
            }
            const bx = Math.min(bgCanvas.width - 1, Math.max(0, Math.floor(px * SC)));
            const by = Math.min(bgCanvas.height - 1, Math.max(0, Math.floor(py * SC)));
            const i = (by * bgCanvas.width + bx) * 4;
            const br = bg.data[i];
            const bgc = bg.data[i + 1];
            const bb = bg.data[i + 2];
            const mr = tr * a + br * (1 - a);
            const mg = tg * a + bgc * (1 - a);
            const mb = tb * a + bb * (1 - a);
            ratios.push(ratio(lum(mr, mg, mb), lum(br, bgc, bb)));
          }
        }
      }
      ratios.sort((p, q) => p - q);
      worst = Math.min(worst, ratios[Math.floor(ratios.length * 0.1)] ?? ratios[0]);
    }
    const large = el.fontSize >= 56 || (el.fontWeight >= 700 && el.fontSize >= 44);
    const need = large ? 3 : 4.5;
    if (worst < need) issues.push({ level: "warn", msg: `contrast ${worst.toFixed(1)} < ${need} ${label}` });
  }

  // overlaps between text elements
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el === b.el) continue;
      if ((a.el.name ?? "").startsWith("Decorative") || (b.el.name ?? "").startsWith("Decorative")) continue;
      if (a.el.rotation || b.el.rotation || a.el.curve || b.el.curve) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      // line boxes of tight headlines legitimately touch a little: ignore slivers
      if (ix > 6 && iy > Math.min(a.h, b.h) * 0.22) issues.push({ level: "warn", msg: `text overlap "${textOf(a.el).slice(0, 22)}" x "${textOf(b.el).slice(0, 22)}"` });
    }
  }
  return issues;
}

function drawDebug(canvas: HTMLCanvasElement, tpl: Template, page: Page): void {
  const ctx = canvas.getContext("2d")!;
  const s = canvas.width / tpl.width;
  const isStory = tpl.height / tpl.width > 1.7;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.lineWidth = 2 / s;
  ctx.setLineDash([10 / s, 8 / s]);
  ctx.strokeStyle = "rgba(0,200,255,.9)";
  const inset = isStory ? 220 : 64;
  ctx.strokeRect(64, inset, tpl.width - 128, tpl.height - inset * 2);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,0,150,.85)";
  walk(page.elements, (el, ox, oy) => {
    if (el.type !== "text") return;
    ctx.save();
    ctx.translate(el.x + ox + el.width / 2, el.y + oy + el.height / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.strokeRect(-el.width / 2, -el.height / 2, el.width, el.height);
    ctx.restore();
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* modes                                                               */
/* ------------------------------------------------------------------ */

function pickTemplates(): Template[] {
  if (!IDS) return SOCIAL_TEMPLATES;
  const out: Template[] = [];
  for (const part of IDS.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) if (SOCIAL_TEMPLATES[i]) out.push(SOCIAL_TEMPLATES[i]);
    } else if (/^\d+$/.test(part)) {
      if (SOCIAL_TEMPLATES[Number(part)]) out.push(SOCIAL_TEMPLATES[Number(part)]);
    } else {
      const q = part.toLowerCase();
      for (const t of SOCIAL_TEMPLATES) if (t.id.includes(q) || t.name.toLowerCase().includes(q)) out.push(t);
    }
  }
  return out.filter((t, i, a) => a.indexOf(t) === i);
}

async function runTemplates(): Promise<void> {
  const list = pickTemplates();
  const report: Array<{ id: string; name: string; size: string; pages: number; fonts: string[]; issues: Issue[] }> = [];
  const t0 = performance.now();
  for (const source of list) {
    const tpl = structuredClone(source);
    const fonts = new Set<string>();
    const issues: Issue[] = [];
    if (tpl.tags.length < 6) issues.push({ level: "warn", msg: `only ${tpl.tags.length} tags` });
    if (!tpl.accent) issues.push({ level: "warn", msg: "no accent" });
    for (let pi = 0; pi < tpl.pages.length; pi++) {
      const page = tpl.pages[pi];
      await loadFonts(page);
      measureAll(page);
      walk(page.elements, (el) => {
        if (el.type === "text") {
          fonts.add(el.fontFamily);
          for (const p of el.paragraphs) for (const r of p.runs) if (r.font) fonts.add(r.font);
        }
      });
      const canvas = await renderPageToCanvas(tpl, page, { width: CANVAS_W });
      if (DEBUG) drawDebug(canvas, tpl, page);
      const pageIssues = await lintPage(tpl, page);
      for (const i of pageIssues) issues.push({ ...i, msg: tpl.pages.length > 1 ? `p${pi + 1}: ${i.msg}` : i.msg });

      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = tpl.id;
      card.dataset.page = String(pi + 1);
      card.style.setProperty("--cw", `${canvas.width}px`);
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.append(document.createTextNode(tpl.name));
      const sub = document.createElement("small");
      sub.textContent = `${tpl.width}x${tpl.height} - ${tpl.category} - ${tpl.id}${tpl.pages.length > 1 ? ` - page ${pi + 1}/${tpl.pages.length}` : ""}`;
      cap.appendChild(sub);
      card.append(canvas, cap);
      for (const i of pageIssues) {
        const w = document.createElement("div");
        w.className = i.level;
        w.textContent = `${i.level === "warn" ? "!" : "i"} ${i.msg}`;
        card.appendChild(w);
      }
      sheet.appendChild(card);
    }
    if (fonts.size > 2) issues.push({ level: "warn", msg: `uses ${fonts.size} font families: ${[...fonts].join(", ")}` });
    report.push({ id: tpl.id, name: tpl.name, size: `${tpl.width}x${tpl.height}`, pages: tpl.pages.length, fonts: [...fonts], issues });
  }
  window.__report = { ms: Math.round(performance.now() - t0), count: list.length, report };
}

async function runGraphics(): Promise<void> {
  const only = IDS?.split(",").filter(Boolean);
  const defs = GRAPHICS.filter((g) => !only || only.some((q) => g.id.includes(q)));
  const rows: Array<{ id: string; colors: string[] }> = [];
  for (const g of defs) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const img = new Image();
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 300;
    await new Promise<void>((res) => {
      img.onload = () => res();
      img.onerror = () => res();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(g.svg);
    });
    const ctx = c.getContext("2d")!;
    const ar = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    const w = ar >= 1 ? 300 : 300 * ar;
    const h = ar >= 1 ? 300 / ar : 300;
    ctx.drawImage(img, (300 - w) / 2, (300 - h) / 2, w, h);
    const colors = extractSvgColors(g.svg);
    rows.push({ id: g.id, colors });
    tile.append(c);
    const cap = document.createElement("div");
    const strong = document.createElement("b");
    strong.textContent = g.id;
    cap.append(strong, document.createElement("br"), document.createTextNode(colors.join(" ")));
    tile.appendChild(cap);
    sheet.appendChild(tile);
  }
  window.__report = { count: rows.length, rows };
}

/**
 * Template thumbnails are painted straight from the template data, before any text box is measured.
 * This paints every page both ways (raw and measured) and reports how many pixels differ.
 */
async function runRawDiff(): Promise<void> {
  const rows: Array<{ id: string; colors: string[]; diff: number }> = [];
  for (const source of SOCIAL_TEMPLATES) {
    for (let pi = 0; pi < source.pages.length; pi++) {
      const raw = structuredClone(source.pages[pi]);
      const measured = structuredClone(source.pages[pi]);
      await loadFonts(measured);
      measureAll(measured);
      const a = await renderPageToCanvas(source, raw, { width: 270 });
      const b = await renderPageToCanvas(source, measured, { width: 270 });
      const da = a.getContext("2d")!.getImageData(0, 0, a.width, a.height).data;
      const db = b.getContext("2d")!.getImageData(0, 0, b.width, b.height).data;
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) diff++;
      const pct = (diff / (da.length / 4)) * 100;
      rows.push({ id: `${source.id} p${pi + 1}`, colors: [], diff: Math.round(pct * 1000) / 1000 });
      if (pct > 0) {
        const card = document.createElement("div");
        card.className = "card";
        card.append(a, b);
        const cap = document.createElement("div");
        cap.className = "cap";
        cap.textContent = `${source.id} p${pi + 1}: ${pct.toFixed(3)}% differ`;
        card.appendChild(cap);
        sheet.appendChild(card);
      }
    }
  }
  window.__report = { count: rows.length, rows, diffs: rows.filter((r) => r.diff > 0) };
}

const PHOTO_IDS = [
  "sunset-hills",
  "ocean-waves",
  "mountain-lake",
  "desert-dunes",
  "forest-mist",
  "aurora-night",
  "tropical-beach",
  "snowy-peaks",
  "rolling-fields",
  "canyon-glow",
  "city-night",
  "city-dawn",
  "glass-towers",
  "mesh-sunrise",
  "mesh-ocean",
  "mesh-candy",
  "mesh-forest",
  "mesh-midnight",
  "liquid-purple",
  "neon-grid",
  "soft-blobs",
  "paper-cream",
  "marble-white",
  "concrete-gray",
  "linen-beige",
  "terrazzo",
  "palm-leaves",
  "monstera",
  "wildflowers",
  "bokeh-gold",
  "water-ripples",
  "nebula",
  "starfield",
];

async function runPhotos(): Promise<void> {
  const only = IDS?.split(",").filter(Boolean);
  const ids = PHOTO_IDS.filter((id) => !only || only.some((q) => id.includes(q)));
  for (const id of ids) {
    const tile = document.createElement("div");
    tile.className = "card";
    const design = { width: 480, height: 320 };
    const page: Page = {
      id: id,
      background: { type: "image", src: `builtin:${id}`, fit: "cover", dim: 0 },
      elements: [],
    };
    const canvas = await renderPageToCanvas(design, page, { width: CANVAS_W });
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = id;
    tile.append(canvas, cap);
    sheet.appendChild(tile);
  }
  window.__report = { count: ids.length, rows: ids.map((id) => ({ id, colors: [] })) };
}

void (async () => {
  try {
    if (MODE === "rawdiff") await runRawDiff();
    else if (MODE === "graphics") await runGraphics();
    else if (MODE === "photos") await runPhotos();
    else await runTemplates();
  } catch (error) {
    console.error(error);
    window.__report = { error: String(error) };
  }
  window.__ready = true;
})();

/**
 * Dev harness for the presentation + banner templates (dev-tpl-pres.html, port 5187).
 *
 * Query params
 *   t=<a,b>        only templates whose id contains one of the fragments
 *   p=<n>          only page n (1-based)
 *   w=<px>         thumbnail width (default 480)
 *   cols=<n>       columns (default 3)
 *   debug=1        overlay the 96px margins, the 12-column grid and every text box
 *   audit=1        print the audit table inside the page (always available as window.__audit)
 *   view=photos|graphics   catalogue sheets of the procedural photos / illustrations
 */
import "@fontsource-variable/plus-jakarta-sans";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { contrastRatio, luminance, parseColor } from "@/core/color";
import { extractSvgColors, parseViewBox, svgToDataUrl } from "@/core/svg";
import type { DesignElement, Page, TextElement, Template } from "@/core/types";
import { GRAPHICS } from "@/data/graphics";
import { PHOTOS } from "@/data/photos";
import { PRESENTATIONS_TEMPLATES } from "@/data/templates/presentations";
import { cssFontFamily, ensureFont, FONT_CATALOG, getFontDef } from "@/render/fonts";
import { collectResources, preparePage, renderPage, renderPageToCanvas } from "@/render/renderPage";
import { layoutText, measureTextElement } from "@/render/textLayout";

declare global {
  interface Window {
    __ready?: boolean;
    __audit?: AuditIssue[];
    __stats?: Record<string, unknown>;
  }
}

interface AuditIssue {
  tpl: string;
  page: number;
  kind: string;
  msg: string;
}

const q = new URLSearchParams(location.search);
const THUMB_W = Number(q.get("w") ?? 480);
const COLS = Number(q.get("cols") ?? 3);
const DEBUG = q.get("debug") === "1";
const ONLY_PAGE = q.get("p") ? Number(q.get("p")) : null;
const FILTER = (q.get("t") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const VIEW = q.get("view");
const DUMP = q.get("dump") === "1";

document.documentElement.style.height = "auto";
document.body.style.height = "auto";
document.body.style.overflow = "auto";
document.body.style.background = "#cfd2da";
document.body.style.font = "13px/1.3 var(--font-ui)";
const root = document.getElementById("root") as HTMLElement;
root.style.height = "auto";
root.style.padding = "12px";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
};

/* ------------------------------------------------------------------ */
/* measuring                                                           */
/* ------------------------------------------------------------------ */

function eachText(elements: DesignElement[], fn: (t: TextElement) => void): void {
  for (const e of elements) {
    if (e.type === "text") fn(e);
    else if (e.type === "group") eachText(e.children, fn);
  }
}

async function measurePage(page: Page): Promise<void> {
  const res = collectResources(page);
  await Promise.all([...res.fonts.values()].map((f) => ensureFont(f.family, f.weight, f.italic)));
  eachText(page.elements, (t) => {
    const m = measureTextElement(t);
    t.width = m.width;
    t.height = m.height;
  });
}

/* ------------------------------------------------------------------ */
/* audit                                                               */
/* ------------------------------------------------------------------ */

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lumRGB = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

async function auditPage(tpl: Template, pageIndex: number, issues: AuditIssue[]): Promise<void> {
  const page = tpl.pages[pageIndex];
  const n = pageIndex + 1;
  const add = (kind: string, msg: string) => issues.push({ tpl: tpl.id, page: n, kind, msg });
  const texts: TextElement[] = [];
  eachText(page.elements, (t) => texts.push(t));
  const label = (t: TextElement) =>
    `"${t.paragraphs
      .map((p) => p.runs.map((r) => r.text).join(""))
      .join(" / ")
      .slice(0, 38)}"`;

  // 1. size, bounds, orphans
  for (const t of texts) {
    if (t.hidden) continue;
    if (DUMP) {
      const lay = layoutText(t);
      const ls = lay.lines.map((l) =>
        l.segments
          .map((s) => s.text)
          .join("")
          .trim(),
      );
      add("lines", `${label(t)} box ${Math.round(t.width)}x${Math.round(t.height)} ink ${Math.round(lay.contentWidth)} @${Math.round(t.x)},${Math.round(t.y)} | ${ls.join(" | ")}`);
    }
    const small = Math.min(t.fontSize, ...t.paragraphs.flatMap((p) => p.runs.map((r) => r.size ?? t.fontSize)));
    if (small < 26) add("small", `${label(t)} is ${small}px`);
    const inside = t.x >= 95 && t.x + t.width <= 1825 && t.y >= 0 && t.y + t.height <= 1081;
    if (!inside && !(t.name ?? "").startsWith("bleed") && tpl.width === 1920 && tpl.height === 1080)
      add("margin", `${label(t)} box ${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.width)}x${Math.round(t.height)}`);
    if (tpl.width !== 1920 || tpl.height !== 1080) {
      if (t.x < 0 || t.y < 0 || t.x + t.width > tpl.width + 1 || t.y + t.height > tpl.height + 1)
        add("bounds", `${label(t)} box ${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.width)}x${Math.round(t.height)}`);
    }
    const layout = layoutText(t);
    const byPara = new Map<number, string[]>();
    for (const line of layout.lines) {
      const txt = line.segments
        .map((s) => s.text)
        .join("")
        .trim();
      byPara.set(line.paragraph, [...(byPara.get(line.paragraph) ?? []), txt]);
    }
    for (const [pi, lines] of byPara) {
      if (lines.length >= 2) {
        const last = lines[lines.length - 1];
        if (last && !/\s/.test(last) && last.length < 14) add("orphan", `${label(t)} para ${pi}: last line is the single word "${last}" (${lines.length} lines)`);
      }
    }
    // a word broken mid-token means the box is too narrow
    for (const line of layout.lines) {
      if (line.width > t.width + 2 && !t.autoWidth) add("overflow", `${label(t)} line wider than box`);
    }
  }

  // 2. overlaps between text boxes
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (a.hidden || b.hidden || a.rotation || b.rotation) continue;
      const shrink = (t: TextElement) => ({ x: t.x, y: t.y + t.fontSize * 0.1, w: t.width, h: Math.max(1, t.height - t.fontSize * 0.2) });
      const A = shrink(a);
      const B = shrink(b);
      const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
      const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      if (ox > 8 && oy > 8) {
        // only count real ink overlap: compare line extents
        const la = layoutText(a).lines;
        const lb = layoutText(b).lines;
        let hit = false;
        for (const x of la) {
          for (const y of lb) {
            const ax0 = a.x + x.x;
            const ax1 = ax0 + x.width;
            const ay0 = a.y + x.y + x.height * 0.12;
            const ay1 = a.y + x.y + x.height * 0.88;
            const bx0 = b.x + y.x;
            const bx1 = bx0 + y.width;
            const by0 = b.y + y.y + y.height * 0.12;
            const by1 = b.y + y.y + y.height * 0.88;
            if (Math.min(ax1, bx1) - Math.max(ax0, bx0) > 6 && Math.min(ay1, by1) - Math.max(ay0, by0) > 6) hit = true;
          }
        }
        if (hit) add("overlap", `${label(a)} x ${label(b)}`);
      }
    }
  }

  // 3. contrast against the rendered background (text hidden)
  const scale = 0.5;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(tpl.width * scale);
  canvas.height = Math.round(tpl.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  await preparePage(page);
  const hide = new Set(texts.map((t) => t.id));
  for (let attempt = 0; attempt < 3; attempt++) if (renderPage(ctx, tpl, page, { scale, hide })) break;
  for (const t of texts) {
    if (t.hidden || t.rotation || t.opacity < 0.5) continue;
    const layout = layoutText(t);
    const worst: number[] = [];
    let bgOverride: string | null = null;
    if (t.effect.kind === "background" && t.effect.color) bgOverride = t.effect.color;
    for (const line of layout.lines) {
      for (const seg of line.segments) {
        if (seg.isSpace || !seg.text.trim()) continue;
        const fg = parseColor(t.gradient ? t.gradient.stops[0].color : seg.style.color);
        if (!fg) continue;
        const x0 = Math.max(0, Math.floor((t.x + line.x + seg.x) * scale));
        const x1 = Math.min(canvas.width, Math.ceil((t.x + line.x + seg.x + seg.width) * scale));
        const y0 = Math.max(0, Math.floor((t.y + line.y + line.height * 0.18) * scale));
        const y1 = Math.min(canvas.height, Math.ceil((t.y + line.y + line.height * 0.82) * scale));
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 0 || h <= 0) continue;
        const data = ctx.getImageData(x0, y0, w, h).data;
        for (let k = 0; k < data.length; k += 4 * 2) {
          let r = data[k];
          let g = data[k + 1];
          let b = data[k + 2];
          if (bgOverride) {
            const o = parseColor(bgOverride);
            if (o) {
              r = o.r;
              g = o.g;
              b = o.b;
            }
          }
          const a = fg.a ?? 1;
          const fr = fg.r * a + r * (1 - a);
          const fgr = fg.g * a + g * (1 - a);
          const fb = fg.b * a + b * (1 - a);
          const l1 = lumRGB(fr, fgr, fb);
          const l2 = lumRGB(r, g, b);
          worst.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
        }
      }
    }
    if (!worst.length) continue;
    worst.sort((a, b) => a - b);
    const p5 = worst[Math.floor(worst.length * 0.05)];
    const large = t.fontSize >= 48 || (t.fontSize >= 36 && t.fontWeight >= 700);
    const need = large ? 3 : 4.5;
    if (p5 < need) add("contrast", `${label(t)} ${p5.toFixed(2)}:1 (needs ${need}) size ${t.fontSize}`);
  }
}

function fontsOf(tpl: Template): string[] {
  const set = new Set<string>();
  for (const p of tpl.pages) {
    eachText(p.elements, (t) => {
      set.add(t.fontFamily);
      for (const para of t.paragraphs) for (const r of para.runs) if (r.font) set.add(r.font);
    });
  }
  return [...set];
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

function overlay(canvas: HTMLCanvasElement, tpl: Template, page: Page): void {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const s = canvas.width / tpl.width;
  ctx.save();
  ctx.scale(s, s);
  if (tpl.width === 1920 && tpl.height === 1080) {
    ctx.fillStyle = "rgba(0,170,255,0.10)";
    for (let i = 0; i < 12; i++) ctx.fillRect(96 + i * 146, 0, 122, 1080);
    ctx.strokeStyle = "rgba(255,0,120,0.9)";
    ctx.lineWidth = 2 / s;
    ctx.strokeRect(96, 96, 1728, 888);
  }
  ctx.strokeStyle = "rgba(255,0,200,0.75)";
  ctx.lineWidth = 1.5 / s;
  eachText(page.elements, (t) => {
    if (t.hidden) return;
    ctx.save();
    ctx.translate(t.x + t.width / 2, t.y + t.height / 2);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.strokeRect(-t.width / 2, -t.height / 2, t.width, t.height);
    ctx.restore();
  });
  ctx.restore();
}

/** Structural checks: finite numbers, unique ids, JSON round trip, known fonts and tags. */
function validate(list: Template[]): AuditIssue[] {
  const out: AuditIssue[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const tpl of list) {
    const add = (kind: string, msg: string, page = 0) => out.push({ tpl: tpl.id, page, kind, msg });
    if (ids.has(tpl.id)) add("dup-template", "duplicate template id");
    ids.add(tpl.id);
    if (tpl.tags.length < 6) add("tags", `only ${tpl.tags.length} tags`);
    if (!tpl.accent) add("accent", "missing accent");
    try {
      JSON.parse(JSON.stringify(tpl));
    } catch {
      add("json", "does not round-trip through JSON");
    }
    tpl.pages.forEach((page, pi) => {
      const walk = (els: DesignElement[]) => {
        for (const e of els) {
          if (seen.has(e.id)) add("dup-id", `element id ${e.id} reused`, pi + 1);
          seen.add(e.id);
          for (const k of ["x", "y", "width", "height", "rotation", "opacity"] as const) {
            if (!Number.isFinite(e[k])) add("nan", `${e.type} ${e.name ?? e.id}: ${k} = ${String(e[k])}`, pi + 1);
          }
          if (e.type === "text") {
            if (!Number.isFinite(e.fontSize) || !Number.isFinite(e.lineHeight)) add("nan", `text ${e.name ?? e.id}: font metrics`, pi + 1);
            if (!getFontDef(e.fontFamily)) add("font", `unknown family ${e.fontFamily}`, pi + 1);
            for (const para of e.paragraphs) for (const r of para.runs) if (r.font && !getFontDef(r.font)) add("font", `unknown run family ${r.font}`, pi + 1);
          }
          if (e.type === "group") walk(e.children);
        }
      };
      walk(page.elements);
      if (page.id && seen.has(page.id)) add("dup-id", `page id ${page.id} reused`, pi + 1);
      seen.add(page.id);
    });
  }
  return out;
}

async function sheetOfTemplates(): Promise<void> {
  const issues: AuditIssue[] = validate(PRESENTATIONS_TEMPLATES);
  const list = PRESENTATIONS_TEMPLATES.filter((t) => !FILTER.length || FILTER.some((f) => t.id.includes(f)));
  window.__stats = { templates: PRESENTATIONS_TEMPLATES.length, shown: list.length, ids: PRESENTATIONS_TEMPLATES.map((t) => `${t.id}:${t.pages.length}`) };
  for (const tpl of list) {
    const fonts = fontsOf(tpl);
    const head = el("div", { display: "flex", gap: "12px", alignItems: "baseline", margin: "14px 0 6px", font: "700 15px var(--font-ui)" });
    const chip = el("span", {
      width: "16px",
      height: "16px",
      borderRadius: "4px",
      background: tpl.accent,
      border: "1px solid #0003",
      display: "inline-block",
      alignSelf: "center",
    });
    head.append(
      chip,
      el("span", {}, `${tpl.name}`),
      el(
        "span",
        { font: "400 12px var(--font-ui)", color: "#444" },
        `${tpl.id} - ${tpl.pages.length} pages - ${tpl.width}x${tpl.height} - ${fonts.join(" + ")}${fonts.length > 2 ? "  !!! >2 fonts" : ""}`,
      ),
    );
    root.append(head);
    const grid = el("div", { display: "grid", gridTemplateColumns: `repeat(${COLS}, ${THUMB_W}px)`, gap: "14px 14px", alignItems: "start" });
    root.append(grid);
    for (let i = 0; i < tpl.pages.length; i++) {
      if (ONLY_PAGE && ONLY_PAGE !== i + 1) continue;
      const page = tpl.pages[i];
      await measurePage(page);
      const canvas = await renderPageToCanvas(tpl, page, { width: THUMB_W });
      if (DEBUG) overlay(canvas, tpl, page);
      const cell = el("figure", { margin: "0" });
      canvas.style.boxShadow = "0 1px 6px rgba(0,0,0,.35)";
      canvas.style.width = `${THUMB_W}px`;
      canvas.style.maxWidth = "none";
      cell.append(canvas, el("figcaption", { font: "600 11px var(--font-ui)", color: "#333", marginTop: "3px" }, `${tpl.name} - ${i + 1}`));
      grid.append(cell);
      await auditPage(tpl, i, issues);
    }
  }
  window.__audit = issues;
  if (q.get("sizes") === "1") {
    const out: Record<string, Record<string, number>> = {};
    for (const tpl of list) {
      const hist: Record<string, number> = {};
      for (const page of tpl.pages)
        eachText(page.elements, (t) => {
          const k = String(t.fontSize);
          hist[k] = (hist[k] ?? 0) + 1;
        });
      out[tpl.id] = Object.fromEntries(Object.entries(hist).sort((a, b) => Number(b[0]) - Number(a[0])));
    }
    window.__stats = { ...(window.__stats ?? {}), sizes: out };
  }
  if (q.get("audit") === "1") {
    const box = el("pre", { whiteSpace: "pre-wrap", font: "12px/1.4 ui-monospace, monospace", background: "#fff", padding: "10px", marginTop: "16px" });
    box.textContent = issues.length ? issues.map((i) => `${i.tpl} p${i.page} [${i.kind}] ${i.msg}`).join("\n") : "audit clean";
    root.append(box);
  }
}

async function sheetOfPhotos(): Promise<void> {
  const grid = el("div", { display: "grid", gridTemplateColumns: "repeat(5, 300px)", gap: "10px" });
  root.append(grid);
  for (const ph of PHOTOS) {
    const canvas = await renderPageToCanvas(
      { width: 600, height: 400 },
      {
        id: "x",
        background: { type: "image", src: `builtin:${ph.id}`, fit: "cover", dim: 0 },
        elements: [],
      },
      { width: 300 },
    );
    const cell = el("figure", { margin: "0" });
    cell.append(canvas, el("figcaption", { font: "600 11px var(--font-ui)", marginTop: "2px" }, `${ph.id} (${ph.width}x${ph.height})`));
    grid.append(cell);
  }
}

function sheetOfGraphics(): void {
  const grid = el("div", { display: "grid", gridTemplateColumns: "repeat(8, 176px)", gap: "10px" });
  root.append(grid);
  for (const g of GRAPHICS) {
    const cell = el("figure", { margin: "0", background: "#fff", borderRadius: "8px", padding: "6px" });
    const img = document.createElement("img");
    img.src = svgToDataUrl(g.svg);
    img.style.width = "164px";
    img.style.height = "120px";
    img.style.objectFit = "contain";
    cell.append(img, el("figcaption", { font: "600 10px var(--font-ui)", marginTop: "2px", wordBreak: "break-all" }, g.id));
    grid.append(cell);
  }
}

/** Prints ascent / descent / cap height / x height (in em) of every catalogue family, for the kit's alignment helpers. */
async function sheetOfMetrics(): Promise<void> {
  const out: Record<string, { a: number; d: number; cap: number; x: number }> = {};
  const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  for (const def of FONT_CATALOG) {
    const w = def.weights.includes(400) ? 400 : def.weights[0];
    await ensureFont(def.family, w, false);
    ctx.font = `${w} 1000px ${cssFontFamily(def.family)}`;
    const m = ctx.measureText("Hxg");
    const h = ctx.measureText("H");
    const x = ctx.measureText("x");
    const r = (v: number) => Math.round(v) / 1000;
    out[def.family] = { a: r(m.fontBoundingBoxAscent), d: r(m.fontBoundingBoxDescent), cap: r(h.actualBoundingBoxAscent), x: r(x.actualBoundingBoxAscent) };
  }
  window.__stats = { metrics: out };
  root.append(el("pre", { font: "12px/1.4 ui-monospace, monospace" }, JSON.stringify(out, null, 1)));
}

/** Prints viewBox + recolourable colours of the graphics named in ?ids=a,b,c */
function sheetOfGraphicColors(): void {
  const ids = (q.get("ids") ?? "").split(",").filter(Boolean);
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const g = GRAPHICS.find((x) => x.id === id);
    out[id] = g ? { vb: parseViewBox(g.svg), colors: extractSvgColors(g.svg) } : "missing";
  }
  window.__stats = { gcolors: out };
  root.append(el("pre", {}, JSON.stringify(out, null, 1)));
}

async function main(): Promise<void> {
  try {
    if (VIEW === "photos") await sheetOfPhotos();
    else if (VIEW === "graphics") sheetOfGraphics();
    else if (VIEW === "metrics") await sheetOfMetrics();
    else if (VIEW === "gcolors") sheetOfGraphicColors();
    else await sheetOfTemplates();
  } catch (error) {
    console.error("harness failed", error);
    root.append(el("pre", { color: "#b00020" }, String(error instanceof Error ? error.stack : error)));
  }
  void contrastRatio;
  void luminance;
  window.__ready = true;
}

void main();

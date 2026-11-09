/**
 * Vector SVG export of one page. It is built from the same data the canvas renderer paints (shape paths from
 * render/shapePaths.ts, text positions from render/textLayout.ts, the recoloured markup of graphics), so the
 * SVG matches the on-screen page:
 *
 *   backgrounds   solid, linear / radial gradients, procedural patterns, images (cover / contain / tile + dim)
 *   shapes        <rect> / <ellipse> / <path> with fill rule, gradient fills, dashed / round-capped strokes, shadows
 *   lines         shaft + the eight arrow head styles, reproduced from renderPage.drawLine
 *   images        embedded as data URLs (original bytes for uploads), masks and crops through <clipPath>;
 *                 any non-neutral filter bakes the filtered raster (render/imageFilters.ts) into the file
 *   graphics      the recoloured SVG inlined as a nested <svg> with namespaced ids
 *   text          <text> / <tspan> from the layout engine, effects as filters, curved text on <textPath>
 *   tables, charts  vector rect / text / path
 *   fonts         optional: the woff2 files of every face used, base64 inside an @font-face <style>
 *
 * Differences from the canvas that cannot be avoided are listed in `SvgPageResult.warnings`.
 */
import { getAsset } from "@/core/assets";
import type { Design, DesignElement, Fill, GraphicElement, ImageElement, LineElement, Page, ShapeElement, Stroke, TableElement } from "@/core/types";
import { isNeutral, renderFiltered } from "@/render/imageFilters";
import { drawableSize, loadImage, type Drawable } from "@/render/images";
import { collectResources, graphicMarkup } from "@/render/renderPage";
import { getShape, shapeFillRule, shapePathData } from "@/render/shapePaths";
import { bytesToBase64, blobToDataUrl } from "./encoding";
import { fontFile, fontFaceKey, type FontFileInfo } from "./fontFiles";
import { mimeOfDataUrl } from "./projectFormat";
import { loadPageResources } from "./resources";
import { elementMatrix, inverseLinear, multiply, safeLinkUrl, IDENTITY, type Matrix } from "./links";
import { chartSvg, tableSvg } from "./svgBlocks";
import { textElementSvg } from "./svgText";
import { PATTERN_TILE, SvgDoc, colorAttr, esc as escText, escAttr, noiseTilePixels, num, paintAttr, type PaintRef } from "./svgUtil";

export interface SvgExportOptions {
  /** embed the woff2 files of the fonts used (default true) */
  embedFonts: boolean;
  /** <title> of the document */
  title?: string;
  /** <desc> of the document */
  description?: string;
}

export interface SvgPageResult {
  svg: string;
  /** things the user should know about (images that could not be embedded ...) */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* image sources                                                       */
/* ------------------------------------------------------------------ */

interface ImageRecord {
  /** the decoded picture (needed for filtered rasters) */
  drawable: Drawable;
  /** natural size used for placement */
  width: number;
  height: number;
  /** data URL (or external URL) of the original picture; null when it was not needed / could not be made */
  href: string | null;
  mime: string;
  /** id of the <image> in <defs>, once defined */
  defId?: string;
}

function toCanvas(d: Drawable): HTMLCanvasElement {
  if (d instanceof HTMLCanvasElement) return d;
  const { width, height } = drawableSize(d);
  const c = document.createElement("canvas");
  c.width = Math.max(1, width);
  c.height = Math.max(1, height);
  c.getContext("2d")?.drawImage(d as CanvasImageSource, 0, 0);
  return c;
}

/** Attribute-safe URL; base64 data URLs (multi-megabyte, nothing to escape) skip the escaping passes. */
const hrefAttr = (href: string) => (/^data:[\w+./-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=]*$/.test(href) ? href : escAttr(href));

/** Can a picture of this mime type carry transparency? (decides PNG vs JPEG when re-encoding) */
const mayHaveAlpha = (mime: string) => !/jpe?g/i.test(mime);

async function sourceHref(src: string, drawable: Drawable, doc: SvgDoc): Promise<{ href: string | null; mime: string; width?: number; height?: number }> {
  if (src.startsWith("data:")) return { href: src, mime: mimeOfDataUrl(src) || "image/png" };
  if (src.startsWith("asset:")) {
    const asset = await getAsset(src.slice(6));
    if (asset) {
      const size = asset.kind === "svg" && asset.width && asset.height ? { width: asset.width, height: asset.height } : {};
      return { href: await blobToDataUrl(asset.blob), mime: asset.mime || asset.blob.type || "image/png", ...size };
    }
  }
  if (/^https?:/i.test(src)) {
    try {
      const response = await fetch(src, { mode: "cors" });
      if (response.ok) {
        const blob = await response.blob();
        return { href: await blobToDataUrl(blob), mime: blob.type || "image/png" };
      }
    } catch {
      /* fall through to re-encoding the decoded picture */
    }
  }
  // builtin photos (generated on a canvas) and anything that could not be fetched: re-encode what was drawn
  try {
    const canvas = toCanvas(drawable);
    const photo = src.startsWith("builtin:");
    return { href: canvas.toDataURL(photo ? "image/jpeg" : "image/png", 0.92), mime: photo ? "image/jpeg" : "image/png" };
  } catch {
    doc.warn("Some images could not be embedded (they come from another website that does not allow it), so they are shown as grey boxes.");
    return { href: null, mime: "image/png" };
  }
}

/* ------------------------------------------------------------------ */
/* fonts                                                               */
/* ------------------------------------------------------------------ */

const fontData = new Map<string, Promise<string | null>>();

function fetchFontBase64(url: string): Promise<string | null> {
  let task = fontData.get(url);
  if (!task) {
    task = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => bytesToBase64(new Uint8Array(buf)))
      .catch(() => null);
    fontData.set(url, task);
  }
  return task;
}

/** The <style> with @font-face rules for every face the page uses (empty string when none could be embedded). */
async function fontStyle(page: Page, doc: SvgDoc): Promise<string> {
  const used = new Map<string, { family: string; weight: number; italic: boolean }>();
  for (const f of collectResources(page).fonts.values()) {
    const key = fontFaceKey(f.family, f.weight, f.italic);
    if (key && !used.has(key)) used.set(key, f);
  }
  const files = (await Promise.all([...used.values()].map((f) => fontFile(f.family, f.weight, f.italic)))).filter((f): f is FontFileInfo => !!f);
  let css = "";
  let failed = false;
  for (const f of files) {
    const data = await fetchFontBase64(f.url);
    if (!data) {
      failed = true;
      continue;
    }
    const weight = f.minWeight === f.maxWeight ? `${f.minWeight}` : `${f.minWeight} ${f.maxWeight}`;
    css += `@font-face{font-family:"${f.css}";font-style:${f.italic ? "italic" : "normal"};font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");}`;
  }
  if (failed) doc.warn("Some fonts could not be embedded; other programs may substitute them.");
  return css ? `<style>${css}</style>` : "";
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type ShapeGeometry = (extra: string) => string;

/** Element markup for an outline: <rect> and <ellipse> where possible (editor friendly), <path> otherwise. */
function shapeGeometry(kind: string, w: number, h: number, o: { radius?: number; params?: ShapeElement["params"]; path?: string; dashed?: boolean } = {}): ShapeGeometry | null {
  if (w <= 0 || h <= 0) return null;
  const def = kind === "path" && o.path ? undefined : getShape(kind);
  if (kind !== "path" && (!def || def.id === "rect")) {
    const r = Math.max(0, Math.min(o.radius ?? 0, w / 2, h / 2));
    return (extra) => `<rect width="${num(w)}" height="${num(h)}"${r > 0.01 ? ` rx="${num(r)}"` : ""}${extra}/>`;
  }
  // a dashed outline must start where the canvas path starts (9 o'clock, not <ellipse>'s 3 o'clock) to keep the same dashes
  if (def?.id === "ellipse" && !o.dashed) return (extra) => `<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}"${extra}/>`;
  const d = shapePathData(kind, w, h, o);
  if (!d) return null;
  return (extra) => `<path d="${d}"${extra}/>`;
}

function transformAttr(el: Pick<DesignElement, "x" | "y" | "width" | "height" | "rotation" | "flipH" | "flipV">): string {
  const flip = el.flipH || el.flipV;
  if (!el.rotation && !flip) return el.x || el.y ? `translate(${num(el.x)} ${num(el.y)})` : "";
  let t = `translate(${num(el.x + el.width / 2)} ${num(el.y + el.height / 2)})`;
  if (el.rotation) t += ` rotate(${num(el.rotation)})`;
  if (flip) t += ` scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1})`;
  return `${t} translate(${num(-el.width / 2)} ${num(-el.height / 2)})`;
}

function strokeAttrs(s: Stroke, alpha: number): string {
  const cap = s.cap ?? (s.style === "dotted" ? "round" : "butt");
  const join = s.join ?? "round";
  let out = `${colorAttr("stroke", s.color, alpha)} stroke-width="${num(s.width)}"`;
  if (cap !== "butt") out += ` stroke-linecap="${cap}"`;
  if (join !== "miter") out += ` stroke-linejoin="${join}"`;
  else out += ` stroke-miterlimit="10"`;
  if (s.style === "dashed") out += ` stroke-dasharray="${num(s.width * 3)} ${num(s.width * 2)}"`;
  else if (s.style === "dotted") out += ` stroke-dasharray="0.01 ${num(s.width * 2)}"`;
  return out;
}

/** Splits `<svg ...>inner</svg>`; null when it is not an SVG document. */
function splitSvg(markup: string): { attrs: string; inner: string } | null {
  const open = markup.match(/<svg\b([^>]*)>/i);
  if (!open || open.index === undefined) return null;
  const end = markup.lastIndexOf("</svg>");
  const innerStart = open.index + open[0].length;
  if (end < innerStart) return open[0].endsWith("/>") ? { attrs: open[1].replace(/\/$/, ""), inner: "" } : null;
  return { attrs: open[1].replace(/\/$/, ""), inner: markup.slice(innerStart, end) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Renames every id of an inlined graphic (and the references to it) so several graphics never collide. */
function scopeIds(inner: string, prefix: string): string {
  const ids = new Set<string>();
  for (const m of inner.matchAll(/\sid\s*=\s*(["'])(.*?)\1/g)) ids.add(m[2]);
  let out = inner;
  for (const id of ids) {
    const e = escapeRe(id);
    out = out
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${e}(["'])`, "g"), `$1${prefix}${id}$2`)
      .replace(new RegExp(`url\\(\\s*(["']?)#${e}\\1\\s*\\)`, "g"), `url(#${prefix}${id})`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${e}(["'])`, "g"), `$1#${prefix}${id}$2`);
  }
  return out;
}

/** The most times a piece of markup is cleaned again; a drawing that still changes after that keeps growing what it is cleaned of. */
const MAX_CLEANINGS = 16;

/**
 * Drops anything active or external from inlined markup: scripts, event handlers (however they are written: after a space or a
 * slash, in quotes or without), foreign objects, remote hrefs, `@import` rules and `url(...)` references that leave the document.
 * Taking one thing out can leave another made of what was around it (`<scr<script></script>ipt>`), so it goes on until the markup no
 * longer changes; markup that never settles is not a drawing and comes back empty. (Graphics that arrive from other people are
 * refused before this, by `svgProblem`; this is for what is already in a design, whoever put it there.)
 */
function sanitizeInline(markup: string): string {
  // whole scripts and foreign objects first, with what is inside them, until none is left...
  const blocks = (text: string) => text.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "");
  // ...then what is left of the rest: tags that are never closed or that close themselves, handlers, and addresses that leave the drawing
  const rest = (text: string) =>
    text
      .replace(/<\/?(?:script|foreignObject)\b[^>]*>/gi, "")
      .replace(/[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/@import[^;{]*;?/gi, "")
      .replace(/url\(\s*(["']?)(?!#|data:)[^)]*\)/gi, "none")
      .replace(/\s(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (all, _name: string, _q: string, a: string | undefined, b: string | undefined) => {
        const value = (a ?? b ?? "").trim();
        return value.startsWith("#") || /^data:image\//i.test(value) ? all : "";
      });
  const settle = (text: string, clean: (text: string) => string): string | null => {
    let out = text;
    for (let pass = 0; pass < MAX_CLEANINGS; pass++) {
      const next = clean(out);
      if (next === out) return out;
      out = next;
    }
    return null;
  };
  const whole = settle(markup, blocks);
  return (whole === null ? null : settle(whole, rest)) ?? "";
}

/**
 * <style> blocks of an inlined graphic apply to the whole document, so two graphics that both define `.cls-1`
 * (Illustrator's habit) would restyle each other. Class names are prefixed per graphic, in the rules and in the markup.
 */
function scopeClasses(inner: string, prefix: string): string {
  const styles = [...inner.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
  if (!styles.length) return inner;
  const names = new Set<string>();
  for (const m of styles) for (const c of m[1].matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) names.add(c[1]);
  if (!names.size) return inner;
  let out = inner.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_all, open: string, css: string, close: string) => `${open}${css.replace(/\.(-?[A-Za-z_][\w-]*)/g, (_m, name: string) => `.${prefix}${name}`)}${close}`,
  );
  out = out.replace(
    /\sclass\s*=\s*(["'])(.*?)\1/g,
    (_all, q: string, value: string) =>
      ` class=${q}${value
        .split(/\s+/)
        .filter(Boolean)
        .map((c) => (names.has(c) ? prefix + c : c))
        .join(" ")}${q}`,
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* the page builder                                                    */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_ICON = "M4 18L9 11L13 16L16 12L22 18ZM17 7A2 2 0 1 1 16.99 7Z";

class PageBuilder {
  readonly doc = new SvgDoc();
  private readonly images = new Map<string, ImageRecord | null>();

  constructor(
    private readonly design: Pick<Design, "width" | "height">,
    private readonly page: Page,
  ) {}

  /* ---- preparation (async) ---- */

  /** Loads every picture the page uses and encodes the ones that are placed unfiltered. */
  async prepare(): Promise<void> {
    const plain = new Set<string>();
    const filtered = new Set<string>();
    const bg = this.page.background;
    if (bg.type === "image") plain.add(bg.src);
    const visit = (el: DesignElement) => {
      if (el.hidden) return;
      if (el.type === "image" && el.src) (isNeutral(el.filter) ? plain : filtered).add(el.src);
      else if (el.type === "group") el.children.forEach(visit);
    };
    this.page.elements.forEach(visit);

    const all = new Set([...plain, ...filtered]);
    await Promise.all(
      [...all].map(async (src) => {
        const drawable = await loadImage(src);
        if (!drawable) {
          this.images.set(src, null);
          return;
        }
        const size = drawableSize(drawable);
        const rec: ImageRecord = { drawable, width: size.width, height: size.height, href: null, mime: "image/png" };
        if (plain.has(src)) {
          const encoded = await sourceHref(src, drawable, this.doc);
          rec.href = encoded.href;
          rec.mime = encoded.mime;
          if (encoded.width && encoded.height) {
            rec.width = encoded.width;
            rec.height = encoded.height;
          }
        } else if (src.startsWith("asset:")) {
          const asset = await getAsset(src.slice(6));
          rec.mime = asset?.mime || "image/png";
        } else rec.mime = src.startsWith("builtin:") ? "image/jpeg" : "image/png";
        this.images.set(src, rec);
      }),
    );
  }

  /** The <use> target for a picture, defined once in <defs>. */
  private imageUse(src: string): { id: string; rec: ImageRecord } | null {
    const rec = this.images.get(src);
    if (!rec || !rec.href || !rec.width || !rec.height) return null;
    if (!rec.defId) {
      rec.defId = this.doc.id("img");
      this.doc.defs.push(`<image id="${rec.defId}" width="${num(rec.width)}" height="${num(rec.height)}" preserveAspectRatio="none" xlink:href="${hrefAttr(rec.href)}"/>`);
    }
    return { id: rec.defId, rec };
  }

  /* ---- page ---- */

  background(): string {
    const fill: Fill = this.page.background;
    const { width: w, height: h } = this.design;
    if (fill.type === "image") {
      let out = `<rect width="${num(w)}" height="${num(h)}" fill="#e9ebf0"/>`;
      if (!this.images.get(fill.src)) return out; // picture missing or broken: the canvas shows the grey base only
      const use = this.imageUse(fill.src);
      if (use) {
        const { rec } = use;
        if (fill.fit === "tile") {
          const id = this.doc.id("tile");
          this.doc.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(rec.width)}" height="${num(rec.height)}"><use xlink:href="#${use.id}"/></pattern>`);
          out += `<rect width="${num(w)}" height="${num(h)}" fill="url(#${id})"/>`;
        } else {
          const s = fill.fit === "cover" ? Math.max(w / rec.width, h / rec.height) : Math.min(w / rec.width, h / rec.height);
          const dw = rec.width * s;
          const dh = rec.height * s;
          out += `<use xlink:href="#${use.id}" transform="translate(${num((w - dw) / 2)} ${num((h - dh) / 2)}) scale(${num(s)})"/>`;
        }
      }
      if (fill.dim) {
        const k = Math.min(0.9, Math.abs(fill.dim));
        out += `<rect width="${num(w)}" height="${num(h)}" fill="${fill.dim > 0 ? "#000000" : "#ffffff"}" fill-opacity="${num(k)}"/>`;
      }
      return out;
    }
    const paint = this.paintFor(fill, w, h);
    return `<rect width="${num(w)}" height="${num(h)}"${paintAttr("fill", paint)}/>`;
  }

  private paintFor(fill: Exclude<Fill, { type: "image" }>, w: number, h: number): PaintRef {
    return this.doc.paint(fill, w, h, fill.type === "pattern" && fill.pattern === "noise" ? () => this.noiseTile(fill) : undefined);
  }

  /** Raster tile of the `noise` pattern: the very pixels the canvas generates at 1 px per design px. */
  private noiseTile(fill: Extract<Fill, { type: "pattern" }>): string {
    const [bw, bh] = PATTERN_TILE.noise;
    const w = Math.max(2, Math.round(bw * fill.scale));
    const h = Math.max(2, Math.round(bh * fill.scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const data = noiseTilePixels(fill, w, h);
    ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    return canvas.toDataURL("image/png");
  }

  /* ---- elements ---- */

  elements(): string {
    return this.page.elements.map((el) => this.element(el, IDENTITY, 1)).join("");
  }

  private element(el: DesignElement, parent: Matrix, alpha: number): string {
    if (el.hidden) return "";
    const m = multiply(parent, elementMatrix(el));
    const a = alpha * el.opacity;
    let inner = "";
    switch (el.type) {
      case "text":
        inner = textElementSvg(el, { doc: this.doc, matrix: m, alpha: a });
        break;
      case "shape":
        inner = this.shape(el, m, a);
        break;
      case "line":
        inner = this.line(el, m, a);
        break;
      case "image":
        inner = this.image(el, m, a);
        break;
      case "graphic":
        inner = this.graphic(el, m, a);
        break;
      case "group":
        inner = el.children.map((child) => this.element(child, m, a)).join("");
        break;
      case "table":
        inner = tableSvg(el as TableElement, { doc: this.doc, alpha: a });
        break;
      case "chart":
        inner = chartSvg(el, { doc: this.doc, alpha: a });
        break;
    }
    if (!inner) return "";
    const transform = transformAttr(el);
    const blur = el.blur && el.blur > 0 ? this.doc.blurFilter(el.blur, { x: 0, y: 0, w: el.width, h: el.height }) : null;
    const label = el.alt ? ` role="img" aria-label="${escAttr(el.alt)}"` : "";
    const needsGroup = transform || blur || label;
    let out = needsGroup ? `<g${transform ? ` transform="${transform}"` : ""}${blur ? ` filter="url(#${blur})"` : ""}${label}>${inner}</g>` : inner;
    const url = safeLinkUrl(el.link);
    if (url) out = `<a xlink:href="${escAttr(url)}">${out}</a>`;
    return out;
  }

  /** Canvas style shadow of an element, rotated into the element's own space. */
  private shadowFilterFor(el: DesignElement, m: Matrix, includeSource: boolean): string | null {
    const s = el.shadow;
    if (!s) return null;
    const local = inverseLinear(m, s.x, s.y);
    return this.doc.shadowFilter({ dx: local.x, dy: local.y, sigma: s.blur / 2, color: s.color, includeSource, region: { x: 0, y: 0, w: el.width, h: el.height } });
  }

  private shape(el: ShapeElement, m: Matrix, a: number): string {
    const geometry = shapeGeometry(el.shape, el.width, el.height, {
      radius: el.radius,
      params: el.params,
      path: el.path,
      dashed: !!el.stroke && el.stroke.width > 0 && el.stroke.style !== "solid",
    });
    if (!geometry) return "";
    const fill = el.fill && el.fill.type !== "image" ? el.fill : null;
    const hasStroke = !!el.stroke && el.stroke.width > 0;
    if (!fill && !hasStroke) return "";
    const rule = shapeFillRule(el.shape) === "evenodd" ? ` fill-rule="evenodd"` : "";
    let out = "";
    if (el.shadow) {
      const filter = this.shadowFilterFor(el, m, false);
      out += geometry(
        `${rule} fill="${fill ? "#000000" : "none"}"${hasStroke ? strokeAttrs(el.stroke as Stroke, 1) : ""} filter="url(#${filter})"${a < 0.9995 ? ` opacity="${num(a)}"` : ""}`,
      );
    }
    const fillAttr = fill ? paintAttr("fill", this.paintFor(fill, el.width, el.height), a) : ` fill="none"`;
    out += geometry(`${rule}${fillAttr}${hasStroke ? strokeAttrs(el.stroke as Stroke, a) : ""}`);
    return out;
  }

  /* ---- lines ---- */

  private arrowHead(kind: string, size: number, s: Stroke, a: number): { markup: string; inset: number } {
    const fill = colorAttr("fill", s.color, a);
    const line = `${colorAttr("stroke", s.color, a)} stroke-width="${num(s.width)}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
    switch (kind) {
      case "arrow":
      case "triangle":
        return { markup: `<path d="M0 0L${num(-size)} ${num(-size * 0.55)}L${num(-size)} ${num(size * 0.55)}Z"${fill}/>`, inset: size * 0.9 };
      case "open-arrow":
        return { markup: `<path d="M${num(-size)} ${num(-size * 0.6)}L0 0L${num(-size)} ${num(size * 0.6)}"${line}/>`, inset: 0 };
      case "circle":
        return { markup: `<circle cx="${num(-size * 0.4)}" cy="0" r="${num(size * 0.4)}"${fill}/>`, inset: size * 0.6 };
      case "square":
        return { markup: `<rect x="${num(-size * 0.8)}" y="${num(-size * 0.4)}" width="${num(size * 0.8)}" height="${num(size * 0.8)}"${fill}/>`, inset: size * 0.7 };
      case "diamond":
        return { markup: `<path d="M0 0L${num(-size * 0.5)} ${num(-size * 0.45)}L${num(-size)} 0L${num(-size * 0.5)} ${num(size * 0.45)}Z"${fill}/>`, inset: size * 0.8 };
      case "bar":
        return { markup: `<path d="M0 ${num(-size * 0.55)}V${num(size * 0.55)}"${line}/>`, inset: 0 };
      default:
        return { markup: "", inset: 0 };
    }
  }

  private line(el: LineElement, m: Matrix, a: number): string {
    const s = el.stroke;
    const head = Math.max(s.width * 3.2, 14);
    const startInset = el.startArrow !== "none" ? head * 0.1 : 0;
    const end = el.endArrow !== "none" ? this.arrowHead(el.endArrow, head, s, a) : { markup: "", inset: 0 };
    const start = el.startArrow !== "none" ? this.arrowHead(el.startArrow, head, s, a) : { markup: "", inset: 0 };
    const x0 = start.inset + startInset;
    const x1 = el.width - end.inset;
    let body = `<path d="M${num(x0)} 0L${num(Math.max(x0, x1))} 0" fill="none"${strokeAttrs(s, a)}/>`;
    if (end.markup) body += `<g transform="translate(${num(el.width)} 0)">${end.markup}</g>`;
    if (start.markup) body += `<g transform="scale(-1 1)">${start.markup}</g>`;
    const filter = this.shadowFilterFor(el, m, true);
    return filter ? `<g filter="url(#${filter})">${body}</g>` : body;
  }

  /* ---- images ---- */

  private image(el: ImageElement, m: Matrix, a: number): string {
    const { width: w, height: h } = el;
    const geometry = shapeGeometry(el.mask || "rect", w, h, { radius: el.radius });
    if (!geometry) return "";
    const clipId = this.doc.clipPath(geometry(""), `img|${el.mask || "rect"}|${num(w)}|${num(h)}|${num(el.radius)}`);
    const opacity = a < 0.9995 ? ` opacity="${num(a)}"` : "";

    if (!el.src) {
      const s = Math.min(w, h) * 0.26;
      return `<g clip-path="url(#${clipId})"><rect width="${num(w)}" height="${num(h)}" fill="#e7e9ef"${opacity}/><path d="${PLACEHOLDER_ICON}" transform="translate(${num(w / 2 - s / 2)} ${num(h / 2 - s / 2)}) scale(${num(s / 26)})" fill="#b3b8c4"${opacity}/></g>`;
    }

    const rec = this.images.get(el.src);
    if (!rec) return `<g clip-path="url(#${clipId})"><rect width="${num(w)}" height="${num(h)}" fill="#eceef3"${opacity}/></g>`;

    const dx = el.crop.x * w;
    const dy = el.crop.y * h;
    const dw = el.crop.w * w;
    const dh = el.crop.h * h;
    let out = "";
    if (el.shadow) {
      const filter = this.shadowFilterFor(el, m, false);
      out += geometry(` fill="#000000" filter="url(#${filter})"${opacity}`);
    }

    let picture = "";
    if (isNeutral(el.filter)) {
      const use = this.imageUse(el.src);
      if (use) picture = `<use xlink:href="#${use.id}" transform="translate(${num(dx)} ${num(dy)}) scale(${num(dw / use.rec.width)} ${num(dh / use.rec.height)})"${opacity}/>`;
    } else {
      // filters (warmth, vignette, duotone ...) are baked: embed exactly the raster the canvas shows
      const density = Math.min(2, Math.max(1, rec.width / Math.max(dw, 1)));
      try {
        const baked = renderFiltered({ key: el.src, img: rec.drawable, dx, dy, dw, dh, boxW: w, boxH: h, filter: el.filter, scale: density });
        const href = baked.toDataURL(mayHaveAlpha(rec.mime) ? "image/png" : "image/jpeg", 0.92);
        picture = `<image width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" xlink:href="${href}"${opacity}/>`;
      } catch {
        this.doc.warn("Some filtered images could not be embedded.");
      }
    }
    out += picture ? `<g clip-path="url(#${clipId})">${picture}</g>` : `<g clip-path="url(#${clipId})"><rect width="${num(w)}" height="${num(h)}" fill="#eceef3"${opacity}/></g>`;
    if (el.stroke && el.stroke.width > 0) out += geometry(` fill="none"${strokeAttrs(el.stroke, a)}`);
    return out;
  }

  /* ---- graphics ---- */

  private graphicCount = 0;

  private graphic(el: GraphicElement, m: Matrix, a: number): string {
    const parts = splitSvg(sanitizeInline(graphicMarkup(el)));
    if (!parts) {
      this.doc.warn("A graphic could not be read and was left out.");
      return "";
    }
    const prefix = `g${++this.graphicCount}-`;
    const viewBox = parts.attrs.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? `0 0 ${num(el.viewW)} ${num(el.viewH)}`;
    const pAR = parts.attrs.match(/preserveAspectRatio\s*=\s*["']([^"']+)["']/i)?.[1];
    // keep presentation attributes of the root (fill, stroke, stroke-width ...) - they style the whole graphic
    const kept = parts.attrs
      .replace(/\s(xmlns(:\w+)?|width|height|viewBox|preserveAspectRatio|x|y|id|version|baseProfile)\s*=\s*("[^"]*"|'[^']*')/gi, "")
      .replace(/\s+/g, " ")
      .trimEnd();
    const filter = this.shadowFilterFor(el, m, true);
    const opacity = a < 0.9995 ? ` opacity="${num(a)}"` : "";
    const nested = `<svg x="0" y="0" width="${num(el.width)}" height="${num(el.height)}" viewBox="${escAttr(viewBox)}"${pAR ? ` preserveAspectRatio="${escAttr(pAR)}"` : ""}${kept}>${scopeClasses(scopeIds(parts.inner, prefix), prefix)}</svg>`;
    // the filter / opacity sit on a wrapper: on the nested <svg> itself the viewport clip would cut the shadow off
    return filter || opacity ? `<g${filter ? ` filter="url(#${filter})"` : ""}${opacity}>${nested}</g>` : nested;
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Renders one page to a standalone SVG document. Waits for fonts and images first. */
export async function designPageToSvg(design: Pick<Design, "width" | "height">, page: Page, options: SvgExportOptions, signal?: AbortSignal): Promise<SvgPageResult> {
  await loadPageResources(page, signal);
  const builder = new PageBuilder(design, page);
  await builder.prepare();
  const fonts = options.embedFonts ? await fontStyle(page, builder.doc) : "";
  // everything is loaded: from here on the conversion is synchronous
  const body = builder.background() + builder.elements();
  const w = num(design.width);
  const h = num(design.height);
  const title = options.title ? `<title>${escText(options.title)}</title>` : "";
  const desc = `<desc>${escText(options.description ?? "Exported from Craftly")}</desc>`;
  const defs = builder.doc.defsMarkup(fonts ? [fonts] : []);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" color="#000000">${title}${desc}${defs}${body}</svg>\n`;
  return { svg, warnings: [...builder.doc.warnings] };
}

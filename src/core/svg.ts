/**
 * Small, dependency free helpers for SVG markup used by graphic elements
 * (icons, illustrations, stickers, QR codes). Shared by the canvas renderer,
 * the SVG exporter and the recolour UI.
 */
import { isPlainColor, parseColor, toHex } from "./color";

const COLOR_PROPS = "fill|stroke|stop-color|flood-color|color";
const ATTR_RE = new RegExp(`\\b(${COLOR_PROPS})\\s*=\\s*(["'])(.*?)\\2`, "gi");
const STYLE_RE = new RegExp(`\\b(${COLOR_PROPS})\\s*:\\s*([^;"'}]+)`, "gi");

const SKIP = new Set(["none", "transparent", "inherit", "context-fill", "context-stroke", "currentcolor"]);

/** Canonical key for a colour value, or null if it is not a recolourable colour. */
export function svgColorKey(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.startsWith("url(")) return null;
  const lower = v.toLowerCase();
  if (lower === "currentcolor") return "currentColor";
  if (SKIP.has(lower)) return null;
  const c = parseColor(lower);
  return c ? toHex(c) : null;
}

/** Unique, recolourable colours in order of first appearance (max 12). */
export function extractSvgColors(svg: string): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const k = svgColorKey(raw);
    if (k && !found.includes(k)) found.push(k);
  };
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(svg))) push(m[3]);
  STYLE_RE.lastIndex = 0;
  while ((m = STYLE_RE.exec(svg))) push(m[2]);
  return found.slice(0, 12);
}

/**
 * Replaces colours according to `map` (keys as returned by extractSvgColors). A replacement goes into the markup as it stands, so
 * only a colour that is written plainly is put in: the map of a design that somebody else made could hold anything, and anything
 * is markup of its own once it is inside an attribute.
 */
export function recolorSvg(svg: string, map: Record<string, string> | undefined): string {
  if (!map) return svg;
  const keys = Object.keys(map);
  if (!keys.length) return svg;
  const swap = (raw: string) => {
    const k = svgColorKey(raw);
    const to = k ? map[k] : undefined;
    return isPlainColor(to) ? to : raw;
  };
  return svg
    .replace(ATTR_RE, (_all, prop: string, q: string, val: string) => `${prop}=${q}${swap(val)}${q}`)
    .replace(STYLE_RE, (_all, prop: string, val: string) => `${prop}:${swap(val)}`);
}

/** Sets stroke-width on the root <svg> element (stroke based icons). */
export function setSvgStrokeWidth(svg: string, width: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) =>
    /stroke-width\s*=/.test(tag) ? tag.replace(/stroke-width\s*=\s*(["'])[^"']*\1/, `stroke-width="${width}"`) : tag.replace(/<svg/i, `<svg stroke-width="${width}"`),
  );
}

export function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } | null {
  // the root's own: a <marker>, <symbol>, <pattern> or nested <svg> inside has a viewBox of its own, which says nothing of the image
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? svg;
  const m = root.match(/(?:^|\s)viewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*["']/i);
  if (m) {
    const [x, y, w, h] = [m[1], m[2], m[3], m[4]].map(parseFloat);
    if (w > 0 && h > 0) return { x, y, w, h };
  }
  const w = root.match(/\swidth\s*=\s*["']([\d.]+)/i);
  const h = root.match(/\sheight\s*=\s*["']([\d.]+)/i);
  if (w && h && parseFloat(w[1]) > 0 && parseFloat(h[1]) > 0) return { x: 0, y: 0, w: parseFloat(w[1]), h: parseFloat(h[1]) };
  return null;
}

/** Makes sure the markup is a standalone image: xmlns, viewBox and no fixed width/height. */
export function normalizeSvg(svg: string): { svg: string; viewW: number; viewH: number } {
  let out = svg
    .trim()
    .replace(/<\?xml[^>]*\?>/i, "")
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .trim();
  const vb = parseViewBox(out) ?? { x: 0, y: 0, w: 100, h: 100 };
  out = out.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs.replace(/\s(width|height)\s*=\s*(["'])[^"']*\2/gi, "");
    if (!/xmlns\s*=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/viewBox\s*=/.test(a)) a += ` viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"`;
    return `<svg${a}>`;
  });
  return { svg: out, viewW: vb.w, viewH: vb.h };
}

/** data: URL for an SVG string, suitable for <img>/Image.src. */
export function svgToDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** Wraps lucide icon nodes ([tag, attrs][]) into a standalone 24x24 stroke icon. */
export function iconNodeToSvg(nodes: Array<[string, Record<string, string | number>]>): string {
  const body = nodes
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

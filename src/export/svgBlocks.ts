/**
 * Tables and charts as vector rect / text / path markup, ported 1:1 from render/drawBlocks.ts (same layout
 * maths, same colours), so they match the canvas. Text is positioned on alphabetic baselines: the canvas code
 * uses `textBaseline = "middle"`, which `middleShift` converts exactly by asking the browser for the offset.
 */
import { measureWidth } from "@/core/textMetrics";
import type { ChartElement, TableElement } from "@/core/types";
import { cssFontFamily } from "@/render/fonts";
import { colorAttr, esc, num, roundRectPath, svgFontFamily, type SvgDoc } from "./svgUtil";

export interface BlockContext {
  doc: SvgDoc;
  alpha: number;
}

/* ---- text helpers ---- */

let scratch: CanvasRenderingContext2D | null | undefined;
const shiftCache = new Map<string, number>();

/**
 * Distance from the canvas "middle" baseline to the alphabetic baseline for this font. The browser reports it
 * itself: with `textBaseline = "middle"`, `measureText().alphabeticBaseline` is how far the alphabetic baseline
 * lies below the middle line - the exact (fractional) offset `fillText` applies, so an SVG <text> placed on
 * `y + middleShift` is snapped to the pixel grid the same way and lands on the same pixels.
 */
export function middleShift(font: string, size: number): number {
  const hit = shiftCache.get(font);
  if (hit !== undefined) return hit;
  let shift = size * 0.35;
  try {
    if (scratch === undefined) scratch = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (scratch) {
      scratch.font = font;
      scratch.textBaseline = "middle";
      const m = scratch.measureText("x");
      if (Number.isFinite(m.alphabeticBaseline) && m.alphabeticBaseline) shift = -m.alphabeticBaseline;
      else {
        scratch.textBaseline = "alphabetic";
        const e = scratch.measureText("x");
        if (typeof e.emHeightAscent === "number" && (e.emHeightAscent || e.emHeightDescent)) shift = (e.emHeightAscent - e.emHeightDescent) / 2;
      }
    }
  } catch {
    /* keep the estimate */
  }
  if (shiftCache.size > 500) shiftCache.clear();
  shiftCache.set(font, shift);
  return shift;
}

interface Label {
  text: string;
  x: number;
  /** y of the canvas "middle" baseline */
  y: number;
  anchor: "start" | "middle" | "end";
  size: number;
  weight: number;
  color: string;
  alpha: number;
  family: string;
}

function label(l: Label): string {
  if (!l.text) return "";
  const font = `${l.weight} ${l.size}px ${cssFontFamily(l.family)}`;
  const y = l.y + middleShift(font, l.size);
  return `<text x="${num(l.x)}" y="${num(y)}"${l.anchor !== "start" ? ` text-anchor="${l.anchor}"` : ""} font-family="${svgFontFamily(cssFontFamily(l.family))}" font-size="${num(l.size)}" font-weight="${l.weight}"${colorAttr("fill", l.color, l.alpha)}>${esc(l.text)}</text>`;
}

/* ------------------------------------------------------------------ */
/* table                                                              */
/* ------------------------------------------------------------------ */

function wrapText(font: string, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (measureWidth(font, test) > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function tableSvg(el: TableElement, cx: BlockContext): string {
  const totalW = el.colWidths.reduce((a, b) => a + b, 0) || el.width;
  const totalH = el.rowHeights.reduce((a, b) => a + b, 0) || el.height;
  const sx = el.width / totalW;
  const sy = el.height / totalH;
  const pad = el.fontSize * 0.5;
  const a = cx.alpha;
  let out = "";
  let y = 0;
  el.rowHeights.forEach((rh, r) => {
    const h = rh * sy;
    let x = 0;
    el.colWidths.forEach((cw, c) => {
      const w = cw * sx;
      const header = el.headerRow && r === 0;
      const fill = header ? el.headerFill : el.stripeFill && r % 2 === 0 ? el.stripeFill : "#ffffff";
      out += `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${colorAttr("fill", fill, a)}/>`;

      const weight = header ? 700 : 400;
      const font = `${weight} ${el.fontSize}px ${cssFontFamily(el.fontFamily)}`;
      const lines = wrapText(font, el.cells[r]?.[c] ?? "", Math.max(10, w - pad * 2));
      const lh = el.fontSize * 1.25;
      const top = y + h / 2 - ((lines.length - 1) * lh) / 2;
      const anchor = el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
      const tx = el.align === "center" ? x + w / 2 : el.align === "right" ? x + w - pad : x + pad;
      const color = header ? el.headerColor : el.color;
      const texts = lines.map((text, i) => label({ text, x: tx, y: top + i * lh, anchor, size: el.fontSize, weight, color, alpha: a, family: el.fontFamily })).join("");
      // the canvas clips every cell; only emit a clip when the text can actually spill out
      const spills = lines.some((l) => measureWidth(font, l) > w - pad * 2 + 0.5) || lines.length * lh > h + 0.5;
      if (spills && texts) {
        const clip = cx.doc.clipPath(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"/>`, `cell|${num(x)}|${num(y)}|${num(w)}|${num(h)}`);
        out += `<g clip-path="url(#${clip})">${texts}</g>`;
      } else out += texts;
      x += w;
    });
    y += h;
  });

  if (el.borderWidth > 0) {
    let d = "";
    let yy = 0;
    for (let r = 0; r <= el.rowHeights.length; r++) {
      d += `M0 ${num(yy)}H${num(el.width)}`;
      yy += (el.rowHeights[r] ?? 0) * sy;
    }
    let xx = 0;
    for (let c = 0; c <= el.colWidths.length; c++) {
      d += `M${num(xx)} 0V${num(el.height)}`;
      xx += (el.colWidths[c] ?? 0) * sx;
    }
    d += `M0 0H${num(el.width)}V${num(el.height)}H0Z`;
    out += `<path d="${d}" fill="none"${colorAttr("stroke", el.borderColor, a)} stroke-width="${num(el.borderWidth)}"/>`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* chart                                                              */
/* ------------------------------------------------------------------ */

const nice = (max: number) => {
  if (max <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(max));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** "r g b / a" colour with the alpha multiplied (canvas `rgba(color, k)` helper). */
const withK = (color: string, k: number, alpha: number) => ({ color, alpha: alpha * k });

function arcPoint(cx: number, cy: number, r: number, angle: number): string {
  return `${num(cx + Math.cos(angle) * r)} ${num(cy + Math.sin(angle) * r)}`;
}

/** Path of one pie / donut slice from angle a0 to a1 (radians, clockwise from 3 o'clock like canvas arc()). */
function slicePath(cx: number, cy: number, r: number, inner: number | null, a0: number, a1: number): string {
  const sweep = a1 - a0;
  if (sweep >= Math.PI * 2 - 1e-6) {
    // a full circle cannot be one SVG arc: use two halves; the inner circle runs the other way round to cut the hole
    const ring = (rad: number, flag: 0 | 1) =>
      `M${num(cx + rad)} ${num(cy)}A${num(rad)} ${num(rad)} 0 1 ${flag} ${num(cx - rad)} ${num(cy)}A${num(rad)} ${num(rad)} 0 1 ${flag} ${num(cx + rad)} ${num(cy)}Z`;
    return inner ? ring(r, 1) + ring(inner, 0) : ring(r, 1);
  }
  const large = sweep > Math.PI ? 1 : 0;
  if (inner) {
    return `M${arcPoint(cx, cy, r, a0)}A${num(r)} ${num(r)} 0 ${large} 1 ${arcPoint(cx, cy, r, a1)}L${arcPoint(cx, cy, inner, a1)}A${num(inner)} ${num(inner)} 0 ${large} 0 ${arcPoint(cx, cy, inner, a0)}Z`;
  }
  return `M${num(cx)} ${num(cy)}L${arcPoint(cx, cy, r, a0)}A${num(r)} ${num(r)} 0 ${large} 1 ${arcPoint(cx, cy, r, a1)}Z`;
}

export function chartSvg(el: ChartElement, cx: BlockContext): string {
  const fam = cssFontFamily(el.fontFamily);
  const fs = Math.max(11, Math.min(el.width, el.height) * 0.04);
  const a = cx.alpha;
  const color = (i: number) => el.series[i]?.color ?? el.palette[i % el.palette.length];
  const text = (t: string, x: number, y: number, anchor: Label["anchor"], size: number, weight: number, fill: string, alpha = a) =>
    label({ text: t, x, y, anchor, size, weight, color: fill, alpha, family: el.fontFamily });
  let out = "";

  let top = fs * 0.8;
  if (el.showLegend) {
    let lx = 0;
    const circular = el.chart === "pie" || el.chart === "donut";
    const names = circular ? el.labels : el.series.map((s) => s.name);
    const font = `500 ${fs}px ${fam}`;
    names.forEach((n, i) => {
      out += `<circle cx="${num(lx + fs * 0.4)}" cy="${num(fs * 0.9)}" r="${num(fs * 0.4)}"${colorAttr("fill", circular ? el.palette[i % el.palette.length] : color(i), a)}/>`;
      out += text(n, lx + fs * 1.1, fs * 0.9, "start", fs, 500, el.textColor);
      lx += measureWidth(font, n) + fs * 2.2;
    });
    top = fs * 2.4;
  }

  if (el.chart === "pie" || el.chart === "donut") {
    const values = el.series[0]?.values ?? [];
    const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const cxm = el.width / 2;
    const cym = top + (el.height - top) / 2;
    const r = Math.max(10, Math.min(el.width, el.height - top) / 2 - fs * 1.2);
    let a0 = -Math.PI / 2;
    values.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      out += `<path d="${slicePath(cxm, cym, r, el.chart === "donut" ? r * 0.55 : null, a0, a1)}"${colorAttr("fill", el.palette[i % el.palette.length], a)} stroke="#ffffff"${a < 0.9995 ? ` stroke-opacity="${num(a)}"` : ""} stroke-width="${num(Math.max(2, fs * 0.15))}"/>`;
      if (el.showValues && a1 - a0 > 0.25) {
        const mid = (a0 + a1) / 2;
        const rr = el.chart === "donut" ? r * 0.8 : r * 0.64;
        out += text(String(v), cxm + Math.cos(mid) * rr, cym + Math.sin(mid) * rr, "middle", fs, 700, "#ffffff");
      }
      a0 = a1;
    });
    return out;
  }

  // cartesian charts
  const left = fs * 3;
  const bottom = fs * 2.2;
  const px = left;
  const py = top;
  const pw = el.width - left - fs * 0.5;
  const ph = el.height - top - bottom;
  const allValues = el.series.flatMap((s) => s.values);
  const max = nice(Math.max(...allValues, 1));
  const horizontal = el.chart === "bar";

  // grid + axis labels
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const v = Math.round(max * t * 100) / 100;
    const grid = withK(el.textColor, 0.12, a);
    const axis = withK(el.textColor, 0.7, a);
    if (horizontal) {
      const x = px + pw * t;
      if (el.showGrid) out += `<path d="M${num(x)} ${num(py)}L${num(x)} ${num(py + ph)}" fill="none"${colorAttr("stroke", grid.color, grid.alpha)} stroke-width="1"/>`;
      out += text(String(v), x, py + ph + fs * 1.1, "middle", fs * 0.9, 400, axis.color, axis.alpha);
    } else {
      const y = py + ph - ph * t;
      if (el.showGrid) out += `<path d="M${num(px)} ${num(y)}L${num(px + pw)} ${num(y)}" fill="none"${colorAttr("stroke", grid.color, grid.alpha)} stroke-width="1"/>`;
      out += text(String(v), px - fs * 0.5, y, "end", fs * 0.9, 400, axis.color, axis.alpha);
    }
  }

  const n = el.labels.length || 1;
  const sCount = el.series.length || 1;
  el.labels.forEach((l, i) => {
    const c = withK(el.textColor, 0.85, a);
    if (horizontal) out += text(l, px - fs * 0.5, py + (ph / n) * (i + 0.5), "end", fs * 0.9, 500, c.color, c.alpha);
    else out += text(l, px + (pw / n) * (i + 0.5), py + ph + fs * 1.1, "middle", fs * 0.9, 500, c.color, c.alpha);
  });

  if (el.chart === "line" || el.chart === "area") {
    el.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => ({ x: px + (pw / n) * (i + 0.5), y: py + ph - (ph * v) / max, v }));
      if (!pts.length) return;
      if (el.chart === "area") {
        const d = `M${num(pts[0].x)} ${num(py + ph)}${pts.map((p) => `L${num(p.x)} ${num(p.y)}`).join("")}L${num(pts[pts.length - 1].x)} ${num(py + ph)}Z`;
        const fill = withK(color(si), 0.28, a);
        out += `<path d="${d}"${colorAttr("fill", fill.color, fill.alpha)}/>`;
      }
      const line = pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join("");
      out += `<path d="${line}" fill="none"${colorAttr("stroke", color(si), a)} stroke-width="${num(Math.max(2, fs * 0.22))}" stroke-linejoin="round"/>`;
      pts.forEach((p) => {
        out += `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${num(fs * 0.34)}"${colorAttr("fill", "#ffffff", a)}${colorAttr("stroke", color(si), a)} stroke-width="${num(Math.max(2, fs * 0.16))}"/>`;
        if (el.showValues) out += text(String(p.v), p.x, p.y - fs * 0.9, "middle", fs * 0.85, 600, el.textColor);
      });
    });
  } else {
    const groupW = (horizontal ? ph : pw) / n;
    const barW = (groupW * 0.72) / sCount;
    el.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const start = (horizontal ? py : px) + groupW * i + groupW * 0.14 + barW * si;
        const len = ((horizontal ? pw : ph) * v) / max;
        const r = Math.min(barW / 2, fs * 0.4);
        const d = horizontal ? roundRectPath(px, start, len, barW, [0, r, r, 0]) : roundRectPath(start, py + ph - len, barW, len, [r, r, 0, 0]);
        out += `<path d="${d}"${colorAttr("fill", color(si), a)}/>`;
        if (el.showValues) {
          if (horizontal) out += text(String(v), px + len + fs * 0.4, start + barW / 2, "start", fs * 0.85, 600, el.textColor);
          else out += text(String(v), start + barW / 2, py + ph - len - fs * 0.7, "middle", fs * 0.85, 600, el.textColor);
        }
      });
    });
  }
  return out;
}

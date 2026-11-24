/**
 * Tables and charts as vector rect / text / path markup, ported 1:1 from render/drawBlocks.ts (same layout
 * maths, same colours), so they match the canvas. Text is positioned on alphabetic baselines: the canvas code
 * uses `textBaseline = "middle"`, which `middleShift` converts exactly by asking the browser for the offset.
 */
import { tableCellStyle, tableLayout } from "@/core/tableCells";
import { measureWidth } from "@/core/textMetrics";
import {
  AXIS_TITLE_ROOM,
  axisTitles,
  categoryStep,
  chartNumber,
  fitText,
  isStacked,
  LEGEND_LINE,
  legendLayout,
  legendTop,
  plotLeft,
  percentSeries,
  stackPieces,
  stackTotals,
  valuesFit,
} from "@/render/chartText";
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
  const pad = el.fontSize * 0.5;
  const a = cx.alpha;
  let out = "";
  for (const cell of tableLayout(el)) {
    const style = tableCellStyle(el, cell);
    const border = el.borderWidth > 0 && el.merges?.length ? `${colorAttr("stroke", el.borderColor, a)} stroke-width="${num(el.borderWidth)}"` : "";
    out += `<rect x="${num(cell.x)}" y="${num(cell.y)}" width="${num(cell.width)}" height="${num(cell.height)}"${colorAttr("fill", style.fill, a)}${border}/>`;
    const weight = style.bold ? 700 : 400;
    const font = `${weight} ${el.fontSize}px ${cssFontFamily(el.fontFamily)}`;
    const lines = wrapText(font, el.cells[cell.row]?.[cell.col] ?? "", Math.max(10, cell.width - pad * 2));
    const lh = el.fontSize * 1.25;
    const top = cell.y + cell.height / 2 - ((lines.length - 1) * lh) / 2;
    const anchor = style.align === "center" ? "middle" : style.align === "right" ? "end" : "start";
    const tx = style.align === "center" ? cell.x + cell.width / 2 : style.align === "right" ? cell.x + cell.width - pad : cell.x + pad;
    const texts = lines.map((text, i) => label({ text, x: tx, y: top + i * lh, anchor, size: el.fontSize, weight, color: style.color, alpha: a, family: el.fontFamily })).join("");
    const spills = lines.some((line) => measureWidth(font, line) > cell.width - pad * 2 + 0.5) || lines.length * lh > cell.height + 0.5;
    if (spills && texts) {
      const clip = cx.doc.clipPath(
        `<rect x="${num(cell.x)}" y="${num(cell.y)}" width="${num(cell.width)}" height="${num(cell.height)}"/>`,
        `cell|${num(cell.x)}|${num(cell.y)}|${num(cell.width)}|${num(cell.height)}`,
      );
      out += `<g clip-path="url(#${clip})">${texts}</g>`;
    } else out += texts;
  }
  if (el.borderWidth > 0 && !el.merges?.length) {
    const sx = el.width / (el.colWidths.reduce((a, b) => a + b, 0) || el.width);
    const sy = el.height / (el.rowHeights.reduce((a, b) => a + b, 0) || el.height);
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
  if (el.percent) el = { ...el, series: percentSeries(el.series) };
  const fam = cssFontFamily(el.fontFamily);
  const fs = Math.max(11, Math.min(el.width, el.height) * 0.04);
  const a = cx.alpha;
  const color = (i: number) => el.series[i]?.color ?? el.palette[i % el.palette.length];
  const text = (t: string, x: number, y: number, anchor: Label["anchor"], size: number, weight: number, fill: string, alpha = a) =>
    label({ text: t, x, y, anchor, size, weight, color: fill, alpha, family: el.fontFamily });
  let out = "";

  let top = fs * 0.8;
  if (el.showLegend) {
    const circular = el.chart === "pie" || el.chart === "donut";
    const names = circular ? el.labels : el.series.map((s) => s.name);
    // the same lines and the same cut names as the painter draws (src/render/chartText.ts)
    const legend = legendLayout(names, `500 ${fs}px ${fam}`, fs, el.width);
    for (const item of legend.items) {
      const y = fs * 0.9 + item.row * fs * LEGEND_LINE;
      out += `<circle cx="${num(item.x + fs * 0.4)}" cy="${num(y)}" r="${num(fs * 0.4)}"${colorAttr("fill", circular ? el.palette[item.index % el.palette.length] : color(item.index), a)}/>`;
      out += text(item.text, item.x + fs * 1.1, y, "start", fs, 500, el.textColor);
    }
    top = legendTop(fs, legend.rows);
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
        out += text(chartNumber(v), cxm + Math.cos(mid) * rr, cym + Math.sin(mid) * rr, "middle", fs, 700, "#ffffff");
      }
      a0 = a1;
    });
    return out;
  }

  if (el.chart === "scatter") {
    const labels = el.labels.length ? el.labels.map((label, i) => Number.parseFloat(label) || i + 1) : [1];
    const minX = Math.min(...labels);
    const maxX = Math.max(...labels);
    const spanX = maxX - minX || 1;
    const max = nice(Math.max(1, ...el.series.flatMap((series) => series.values)));
    const left = fs * 4;
    const top = fs * 1.5;
    const width = el.width - left - fs;
    const height = el.height - top - fs * 3;
    for (let i = 0; i <= 4; i++) {
      const value = (max * i) / 4;
      const y = top + height - (height * i) / 4;
      if (el.showGrid)
        out += `<path d="M${num(left)} ${num(y)}L${num(left + width)} ${num(y)}" fill="none"${colorAttr("stroke", withK(el.textColor, 0.12, a).color, withK(el.textColor, 0.12, a).alpha)} stroke-width="1"/>`;
      out += text(chartNumber(value), left - fs * 0.4, y, "end", fs * 0.9, 400, el.textColor);
    }
    el.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, i) => {
        const x = left + (width * (labels[i] - minX)) / spanX;
        const y = top + height - (height * value) / max;
        out += `<circle cx="${num(x)}" cy="${num(y)}" r="${num(Math.max(3, fs * 0.35))}"${colorAttr("fill", color(seriesIndex), a)}/>`;
        if (el.showValues) out += text(chartNumber(value), x, y - fs * 0.8, "middle", fs * 0.85, 600, el.textColor);
      });
    });
    labels.forEach((label, i) => {
      if (i % categoryStep(fs, width / labels.length, fs * 2) !== 0) return;
      out += text(
        fitText(`400 ${fs * 0.9}px ${fam}`, el.labels[i], width / labels.length),
        left + (width * (label - minX)) / spanX,
        top + height + fs * 1.4,
        "middle",
        fs * 0.9,
        400,
        el.textColor,
      );
    });
    return out;
  }

  // cartesian charts
  const stacked = isStacked(el);
  const allValues = stacked ? stackTotals(el.series) : el.series.flatMap((s) => s.values);
  const titles = axisTitles(el);
  const titleFont = `600 ${fs * 0.9}px ${fam}`;
  const titleRoom = fs * AXIS_TITLE_ROOM;
  const max = nice(Math.max(...allValues, 1));
  const horizontal = el.chart === "bar";
  const axisFont = `400 ${fs * 0.9}px ${fam}`;
  const labelFont = `500 ${fs * 0.9}px ${fam}`;
  const ticks = [0, 1, 2, 3, 4].map((i) => chartNumber(Math.round(max * (i / 4) * 100) / 100));
  const beside = horizontal ? el.labels.map((l) => measureWidth(labelFont, l)) : ticks.map((t) => measureWidth(axisFont, t));
  const labelsLeft = plotLeft(fs, el.width, Math.max(0, ...beside));
  const left = labelsLeft + (titles.left ? titleRoom : 0);
  const besideRoom = labelsLeft - fs * 0.5;
  const bottom = fs * 2.2 + (titles.bottom ? titleRoom : 0);
  const px = left;
  const py = top;
  const pw = el.width - left - fs * 0.5;
  const ph = el.height - top - bottom;

  // grid + axis labels
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const grid = withK(el.textColor, 0.12, a);
    const axis = withK(el.textColor, 0.7, a);
    if (horizontal) {
      const x = px + pw * t;
      if (el.showGrid) out += `<path d="M${num(x)} ${num(py)}L${num(x)} ${num(py + ph)}" fill="none"${colorAttr("stroke", grid.color, grid.alpha)} stroke-width="1"/>`;
      out += text(fitText(axisFont, ticks[i], pw / 4), x, py + ph + fs * 1.1, "middle", fs * 0.9, 400, axis.color, axis.alpha);
    } else {
      const y = py + ph - ph * t;
      if (el.showGrid) out += `<path d="M${num(px)} ${num(y)}L${num(px + pw)} ${num(y)}" fill="none"${colorAttr("stroke", grid.color, grid.alpha)} stroke-width="1"/>`;
      out += text(fitText(axisFont, ticks[i], besideRoom), px - fs * 0.5, y, "end", fs * 0.9, 400, axis.color, axis.alpha);
    }
  }

  // the titles of the axes, where the painter writes them: under the plot, and turned a quarter on its left
  if (titles.bottom || titles.left) {
    const c = withK(el.textColor, 0.85, a);
    if (titles.bottom) out += text(fitText(titleFont, titles.bottom, pw), px + pw / 2, py + ph + fs * 2.2 + titleRoom * 0.45, "middle", fs * 0.9, 600, c.color, c.alpha);
    if (titles.left) {
      const x = titleRoom * 0.5;
      const y = py + ph / 2;
      out += `<g transform="rotate(-90 ${num(x)} ${num(y)})">${text(fitText(titleFont, titles.left, ph), x, y, "middle", fs * 0.9, 600, c.color, c.alpha)}</g>`;
    }
  }

  const n = el.labels.length || 1;
  const sCount = el.series.length || 1;
  // beside a lying plot the names follow each other downwards, where each takes about a line (half a font size and the air around it)
  const step = horizontal ? categoryStep(fs, ph / n, fs * 0.5) : categoryStep(fs, pw / n, Math.max(0, ...el.labels.map((l) => measureWidth(labelFont, l))));
  // the values are written only where they do not run into each other (chartText.ts)
  const slot = (horizontal ? ph : pw) / n;
  const marks = el.chart === "line" || el.chart === "area" || sCount === 1 || stacked ? slot : (slot * 0.72) / sCount;
  const valueFont = `600 ${fs * 0.85}px ${fam}`;
  const showValues = el.showValues && valuesFit(horizontal ? fs * 0.85 : Math.max(0, ...allValues.map((v) => measureWidth(valueFont, chartNumber(v)))), marks);
  el.labels.forEach((l, i) => {
    if (i % step !== 0) return;
    const c = withK(el.textColor, 0.85, a);
    if (horizontal) out += text(fitText(labelFont, l, besideRoom), px - fs * 0.5, py + (ph / n) * (i + 0.5), "end", fs * 0.9, 500, c.color, c.alpha);
    else out += text(fitText(labelFont, l, (pw / n) * step), px + (pw / n) * (i + 0.5), py + ph + fs * 1.1, "middle", fs * 0.9, 500, c.color, c.alpha);
  });

  if (el.chart === "combo" && el.series[0]) {
    const groupW = pw / n;
    const barW = groupW * 0.72;
    el.series[0].values.forEach((value, i) => {
      const x = px + groupW * i + groupW * 0.14;
      const length = (ph * value) / max;
      out += `<rect x="${num(x)}" y="${num(py + ph - length)}" width="${num(barW)}" height="${num(length)}"${colorAttr("fill", color(0), a)}/>`;
      if (showValues) out += text(chartNumber(value), x + barW / 2, py + ph - length - fs * 0.7, "middle", fs * 0.85, 600, el.textColor);
    });
  }
  if (el.chart === "line" || el.chart === "area" || el.chart === "combo") {
    const baselines = Array.from({ length: n }, () => 0);
    el.series.forEach((s, si) => {
      if (el.chart === "combo" && si === 0) return;
      const pts = s.values.map((v, i) => {
        const total = v + (el.chart === "area" && stacked ? baselines[i] : 0);
        return { x: px + (pw / n) * (i + 0.5), y: py + ph - (ph * total) / max, v: total };
      });
      if (!pts.length) return;
      if (el.chart === "area") {
        const topLine = pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join("");
        const bottomLine = pts
          .map((p, i) => `L${num(p.x)} ${num(py + ph - (ph * baselines[pts.length - 1 - i]) / max)}`)
          .reverse()
          .join("");
        const fill = withK(color(si), 0.28, a);
        out += `<path d="${topLine}${bottomLine}Z"${colorAttr("fill", fill.color, fill.alpha)}/>`;
      }
      const line = pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join("");
      out += `<path d="${line}" fill="none"${colorAttr("stroke", color(si), a)} stroke-width="${num(Math.max(2, fs * 0.22))}" stroke-linejoin="round"/>`;
      pts.forEach((p) => {
        out += `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${num(fs * 0.34)}"${colorAttr("fill", "#ffffff", a)}${colorAttr("stroke", color(si), a)} stroke-width="${num(Math.max(2, fs * 0.16))}"/>`;
        if (showValues) out += text(chartNumber(p.v), p.x, p.y - fs * 0.9, "middle", fs * 0.85, 600, el.textColor);
      });
      if (el.chart === "area" && stacked) pts.forEach((point, i) => (baselines[i] = point.v));
    });
  } else if (stacked) {
    // the same pieces as the painter draws: one bar for each category, the far end of its last piece rounded
    const groupW = (horizontal ? ph : pw) / n;
    const barW = groupW * 0.72;
    const unit = (horizontal ? pw : ph) / max;
    for (const piece of stackPieces(el.series)) {
      const start = (horizontal ? py : px) + groupW * piece.category + groupW * 0.14;
      const from = piece.from * unit;
      const len = piece.value * unit;
      const r = piece.last ? Math.max(0, Math.min(barW / 2, fs * 0.4, len)) : 0;
      const d = horizontal ? roundRectPath(px + from, start, len, barW, [0, r, r, 0]) : roundRectPath(start, py + ph - from - len, barW, len, [r, r, 0, 0]);
      out += `<path d="${d}"${colorAttr("fill", color(piece.series), a)}/>`;
    }
    if (showValues) {
      allValues.forEach((total, i) => {
        if (!total) return;
        const start = (horizontal ? py : px) + groupW * i + groupW * 0.14;
        if (horizontal) out += text(chartNumber(total), px + total * unit + fs * 0.4, start + barW / 2, "start", fs * 0.85, 600, el.textColor);
        else out += text(chartNumber(total), start + barW / 2, py + ph - total * unit - fs * 0.7, "middle", fs * 0.85, 600, el.textColor);
      });
    }
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
        if (showValues) {
          if (horizontal) out += text(chartNumber(v), px + len + fs * 0.4, start + barW / 2, "start", fs * 0.85, 600, el.textColor);
          else out += text(chartNumber(v), start + barW / 2, py + ph - len - fs * 0.7, "middle", fs * 0.85, 600, el.textColor);
        }
      });
    });
  }
  return out;
}

/** Table and chart elements. Origin is the element's top-left corner. */
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
} from "./chartText";
import { rgba } from "@/core/color";
import type { ChartElement, TableElement } from "@/core/types";
import { tableCellStyle, tableLayout } from "@/core/tableCells";
import { cssFontFamily } from "./fonts";

type Ctx = CanvasRenderingContext2D;

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function drawTable(ctx: Ctx, el: TableElement): void {
  const pad = el.fontSize * 0.5;
  ctx.save();
  ctx.textBaseline = "middle";
  const cells = tableLayout(el);
  for (const cell of cells) {
    const style = tableCellStyle(el, cell);
    ctx.fillStyle = style.fill;
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.x, cell.y, cell.width, cell.height);
    ctx.clip();
    ctx.font = `${style.bold ? 700 : 400} ${el.fontSize}px ${cssFontFamily(el.fontFamily)}`;
    ctx.fillStyle = style.color;
    const lines = wrap(ctx, el.cells[cell.row]?.[cell.col] ?? "", Math.max(10, cell.width - pad * 2));
    const lh = el.fontSize * 1.25;
    const top = cell.y + cell.height / 2 - ((lines.length - 1) * lh) / 2;
    ctx.textAlign = style.align === "center" ? "center" : style.align === "right" ? "right" : "left";
    const tx = style.align === "center" ? cell.x + cell.width / 2 : style.align === "right" ? cell.x + cell.width - pad : cell.x + pad;
    lines.forEach((line, i) => ctx.fillText(line, tx, top + i * lh));
    ctx.restore();
  }
  if (el.borderWidth > 0) {
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = el.borderWidth;
    if (el.merges?.length) {
      for (const cell of cells) ctx.strokeRect(cell.x, cell.y, cell.width, cell.height);
    } else {
      const sx = el.width / (el.colWidths.reduce((a, b) => a + b, 0) || el.width);
      const sy = el.height / (el.rowHeights.reduce((a, b) => a + b, 0) || el.height);
      ctx.beginPath();
      let yy = 0;
      for (let r = 0; r <= el.rowHeights.length; r++) {
        ctx.moveTo(0, yy);
        ctx.lineTo(el.width, yy);
        yy += (el.rowHeights[r] ?? 0) * sy;
      }
      let xx = 0;
      for (let c = 0; c <= el.colWidths.length; c++) {
        ctx.moveTo(xx, 0);
        ctx.lineTo(xx, el.height);
        xx += (el.colWidths[c] ?? 0) * sx;
      }
      ctx.stroke();
      ctx.strokeRect(0, 0, el.width, el.height);
    }
  }
  ctx.restore();
}

const nice = (max: number) => {
  if (max <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(max));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

function drawScatter(ctx: Ctx, el: ChartElement, fam: string, fs: number, color: (index: number) => string): void {
  const labels = el.labels.length ? el.labels.map((label, i) => Number.parseFloat(label) || i + 1) : [1];
  const minX = Math.min(...labels);
  const maxX = Math.max(...labels);
  const spanX = maxX - minX || 1;
  const max = nice(Math.max(1, ...el.series.flatMap((series) => series.values)));
  const left = fs * 4;
  const top = fs * 1.5;
  const width = el.width - left - fs;
  const height = el.height - top - fs * 3;
  ctx.font = `400 ${fs * 0.9}px ${fam}`;
  for (let i = 0; i <= 4; i++) {
    const value = (max * i) / 4;
    const y = top + height - (height * i) / 4;
    if (el.showGrid) {
      ctx.strokeStyle = rgba(el.textColor, 0.12);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(el.textColor, 0.7);
    ctx.textAlign = "right";
    ctx.fillText(chartNumber(value), left - fs * 0.4, y);
  }
  el.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, i) => {
      const x = left + (width * (labels[i] - minX)) / spanX;
      const y = top + height - (height * value) / max;
      ctx.fillStyle = color(seriesIndex);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, fs * 0.35), 0, Math.PI * 2);
      ctx.fill();
      if (el.showValues) {
        ctx.fillStyle = el.textColor;
        ctx.textAlign = "center";
        ctx.fillText(chartNumber(value), x, y - fs * 0.8);
      }
    });
  });
  ctx.fillStyle = rgba(el.textColor, 0.85);
  ctx.textAlign = "center";
  labels.forEach((label, i) => {
    if (i % categoryStep(fs, width / labels.length, fs * 2) !== 0) return;
    ctx.fillText(fitText(ctx.font, el.labels[i], width / labels.length), left + (width * (label - minX)) / spanX, top + height + fs * 1.4);
  });
}

export function drawChart(ctx: Ctx, el: ChartElement): void {
  if (el.percent) el = { ...el, series: percentSeries(el.series) };
  const fam = cssFontFamily(el.fontFamily);
  const fs = Math.max(11, Math.min(el.width, el.height) * 0.04);
  const color = (i: number) => el.series[i]?.color ?? el.palette[i % el.palette.length];
  ctx.save();
  ctx.font = `500 ${fs}px ${fam}`;
  ctx.fillStyle = el.textColor;
  ctx.strokeStyle = el.textColor;
  ctx.textBaseline = "middle";

  let top = fs * 0.8;
  if (el.showLegend) {
    const names = el.chart === "pie" || el.chart === "donut" ? el.labels : el.series.map((s) => s.name);
    // in lines no wider than the chart, names cut to fit (chartText.ts)
    const legend = legendLayout(names, `500 ${fs}px ${fam}`, fs, el.width);
    for (const item of legend.items) {
      const y = fs * 0.9 + item.row * fs * LEGEND_LINE;
      ctx.fillStyle = el.chart === "pie" || el.chart === "donut" ? el.palette[item.index % el.palette.length] : color(item.index);
      ctx.beginPath();
      ctx.arc(item.x + fs * 0.4, y, fs * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = el.textColor;
      ctx.textAlign = "left";
      ctx.fillText(item.text, item.x + fs * 1.1, y);
    }
    top = legendTop(fs, legend.rows);
  }

  if (el.chart === "pie" || el.chart === "donut") {
    const values = el.series[0]?.values ?? [];
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = el.width / 2;
    const cy = top + (el.height - top) / 2;
    const r = Math.max(10, Math.min(el.width, el.height - top) / 2 - fs * 1.2);
    let a0 = -Math.PI / 2;
    values.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      ctx.beginPath();
      if (el.chart === "donut") {
        ctx.arc(cx, cy, r, a0, a1);
        ctx.arc(cx, cy, r * 0.55, a1, a0, true);
      } else {
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
      }
      ctx.closePath();
      ctx.fillStyle = el.palette[i % el.palette.length];
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, fs * 0.15);
      ctx.stroke();
      if (el.showValues && a1 - a0 > 0.25) {
        const mid = (a0 + a1) / 2;
        const rr = el.chart === "donut" ? r * 0.8 : r * 0.64;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.font = `700 ${fs}px ${fam}`;
        ctx.fillText(chartNumber(v), cx + Math.cos(mid) * rr, cy + Math.sin(mid) * rr);
      }
      a0 = a1;
    });
    ctx.restore();
    return;
  }

  if (el.chart === "scatter") {
    drawScatter(ctx, el, fam, fs, color);
    ctx.restore();
    return;
  }

  // cartesian charts
  const stacked = isStacked(el);
  // a stacked chart is as tall as its tallest stack, and writes the sum of each stack
  const allValues = stacked ? stackTotals(el.series) : el.series.flatMap((s) => s.values);
  const titles = axisTitles(el);
  const titleFont = `600 ${fs * 0.9}px ${fam}`;
  const titleRoom = fs * AXIS_TITLE_ROOM;
  const max = nice(Math.max(...allValues, 1));
  const horizontal = el.chart === "bar";
  const axisFont = `400 ${fs * 0.9}px ${fam}`;
  const labelFont = `500 ${fs * 0.9}px ${fam}`;
  const ticks = [0, 1, 2, 3, 4].map((i) => chartNumber(Math.round(max * (i / 4) * 100) / 100));
  // what stands on the left of the plot (the numbers of the axis, or the names of a bar chart) gets the room it needs, within limits
  const beside = horizontal ? el.labels.map((l) => measureWidth(labelFont, l)) : ticks.map((t) => measureWidth(axisFont, t));
  const labelsLeft = plotLeft(fs, el.width, Math.max(0, ...beside));
  // a title on the left stands outside the numbers or names, a title under the plot below them
  const left = labelsLeft + (titles.left ? titleRoom : 0);
  const besideRoom = labelsLeft - fs * 0.5;
  const bottom = fs * 2.2 + (titles.bottom ? titleRoom : 0);
  const px = left;
  const py = top;
  const pw = el.width - left - fs * 0.5;
  const ph = el.height - top - bottom;
  ctx.lineWidth = 1;

  // grid + axis labels
  ctx.font = axisFont;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    if (horizontal) {
      const x = px + pw * t;
      if (el.showGrid) {
        ctx.strokeStyle = rgba(el.textColor, 0.12);
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x, py + ph);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(el.textColor, 0.7);
      ctx.textAlign = "center";
      ctx.fillText(fitText(axisFont, ticks[i], pw / 4), x, py + ph + fs * 1.1);
    } else {
      const y = py + ph - ph * t;
      if (el.showGrid) {
        ctx.strokeStyle = rgba(el.textColor, 0.12);
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px + pw, y);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(el.textColor, 0.7);
      ctx.textAlign = "right";
      ctx.fillText(fitText(axisFont, ticks[i], besideRoom), px - fs * 0.5, y);
    }
  }

  if (titles.bottom || titles.left) {
    ctx.font = titleFont;
    ctx.fillStyle = rgba(el.textColor, 0.85);
    ctx.textAlign = "center";
    if (titles.bottom) ctx.fillText(fitText(titleFont, titles.bottom, pw), px + pw / 2, py + ph + fs * 2.2 + titleRoom * 0.45);
    if (titles.left) {
      ctx.save();
      ctx.translate(titleRoom * 0.5, py + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(fitText(titleFont, titles.left, ph), 0, 0);
      ctx.restore();
    }
  }

  const n = el.labels.length || 1;
  const sCount = el.series.length || 1;
  ctx.font = labelFont;
  // under the plot a name has the room of its category; when the categories are crowded only every few are named
  // beside a lying plot the names follow each other downwards, where each takes about a line (half a font size and the air around it)
  const step = horizontal ? categoryStep(fs, ph / n, fs * 0.5) : categoryStep(fs, pw / n, Math.max(0, ...el.labels.map((l) => measureWidth(labelFont, l))));
  // the values are written only where they do not run into each other (chartText.ts)
  const slot = (horizontal ? ph : pw) / n;
  const marks = el.chart === "line" || el.chart === "area" || sCount === 1 || stacked ? slot : (slot * 0.72) / sCount;
  const valueFont = `600 ${fs * 0.85}px ${fam}`;
  const showValues = el.showValues && valuesFit(horizontal ? fs * 0.85 : Math.max(0, ...allValues.map((v) => measureWidth(valueFont, chartNumber(v)))), marks);
  el.labels.forEach((label, i) => {
    if (i % step !== 0) return;
    ctx.fillStyle = rgba(el.textColor, 0.85);
    if (horizontal) {
      ctx.textAlign = "right";
      ctx.fillText(fitText(labelFont, label, besideRoom), px - fs * 0.5, py + (ph / n) * (i + 0.5));
    } else {
      ctx.textAlign = "center";
      ctx.fillText(fitText(labelFont, label, (pw / n) * step), px + (pw / n) * (i + 0.5), py + ph + fs * 1.1);
    }
  });

  if (el.chart === "combo" && el.series[0]) {
    const groupW = pw / n;
    const barW = groupW * 0.72;
    el.series[0].values.forEach((value, i) => {
      const x = px + groupW * i + groupW * 0.14;
      const length = (ph * value) / max;
      ctx.fillStyle = color(0);
      ctx.fillRect(x, py + ph - length, barW, length);
      if (showValues) {
        ctx.fillStyle = el.textColor;
        ctx.textAlign = "center";
        ctx.font = valueFont;
        ctx.fillText(chartNumber(value), x + barW / 2, py + ph - length - fs * 0.7);
      }
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
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, py + ph - (ph * baselines[i]) / max);
        ctx.closePath();
        ctx.fillStyle = rgba(color(si), 0.28);
        ctx.fill();
      }
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = color(si);
      ctx.lineWidth = Math.max(2, fs * 0.22);
      ctx.lineJoin = "round";
      ctx.stroke();
      pts.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, fs * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = Math.max(2, fs * 0.16);
        ctx.stroke();
        if (showValues) {
          ctx.fillStyle = el.textColor;
          ctx.textAlign = "center";
          ctx.font = valueFont;
          ctx.fillText(chartNumber(p.v), p.x, p.y - fs * 0.9);
        }
      });
      if (el.chart === "area" && stacked) pts.forEach((point, i) => (baselines[i] = point.v));
    });
  } else if (stacked) {
    // one bar for each category, its series on top of each other from the axis outwards; the far end of the last piece is rounded
    const groupW = (horizontal ? ph : pw) / n;
    const barW = groupW * 0.72;
    const unit = (horizontal ? pw : ph) / max;
    for (const piece of stackPieces(el.series)) {
      const start = (horizontal ? py : px) + groupW * piece.category + groupW * 0.14;
      const from = piece.from * unit;
      const len = piece.value * unit;
      const r = piece.last ? Math.max(0, Math.min(barW / 2, fs * 0.4, len)) : 0;
      ctx.fillStyle = color(piece.series);
      ctx.beginPath();
      if (horizontal) {
        if (ctx.roundRect) ctx.roundRect(px + from, start, len, barW, [0, r, r, 0]);
        else ctx.rect(px + from, start, len, barW);
      } else if (ctx.roundRect) ctx.roundRect(start, py + ph - from - len, barW, len, [r, r, 0, 0]);
      else ctx.rect(start, py + ph - from - len, barW, len);
      ctx.fill();
    }
    if (showValues) {
      ctx.fillStyle = el.textColor;
      ctx.font = valueFont;
      allValues.forEach((total, i) => {
        if (!total) return;
        const start = (horizontal ? py : px) + groupW * i + groupW * 0.14;
        if (horizontal) {
          ctx.textAlign = "left";
          ctx.fillText(chartNumber(total), px + total * unit + fs * 0.4, start + barW / 2);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(chartNumber(total), start + barW / 2, py + ph - total * unit - fs * 0.7);
        }
      });
    }
  } else {
    const groupW = (horizontal ? ph : pw) / n;
    const barW = (groupW * 0.72) / sCount;
    el.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const start = (horizontal ? py : px) + groupW * i + groupW * 0.14 + barW * si;
        const len = ((horizontal ? pw : ph) * v) / max;
        ctx.fillStyle = color(si);
        ctx.beginPath();
        const r = Math.max(0, Math.min(Math.abs(barW) / 2, fs * 0.4));
        if (horizontal) {
          if (ctx.roundRect) ctx.roundRect(px, start, len, barW, [0, r, r, 0]);
          else ctx.rect(px, start, len, barW);
        } else if (ctx.roundRect) ctx.roundRect(start, py + ph - len, barW, len, [r, r, 0, 0]);
        else ctx.rect(start, py + ph - len, barW, len);
        ctx.fill();
        if (showValues) {
          ctx.fillStyle = el.textColor;
          ctx.font = valueFont;
          if (horizontal) {
            ctx.textAlign = "left";
            ctx.fillText(chartNumber(v), px + len + fs * 0.4, start + barW / 2);
          } else {
            ctx.textAlign = "center";
            ctx.fillText(chartNumber(v), start + barW / 2, py + ph - len - fs * 0.7);
          }
        }
      });
    });
  }
  ctx.restore();
}

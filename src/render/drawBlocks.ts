/** Table and chart elements. Origin is the element's top-left corner. */
import { measureWidth } from "@/core/textMetrics";
import { categoryStep, chartNumber, fitText, LEGEND_LINE, legendLayout, legendTop, plotLeft, valuesFit } from "./chartText";
import { rgba } from "@/core/color";
import type { ChartElement, TableElement } from "@/core/types";
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
  const totalW = el.colWidths.reduce((a, b) => a + b, 0) || el.width;
  const totalH = el.rowHeights.reduce((a, b) => a + b, 0) || el.height;
  const sx = el.width / totalW;
  const sy = el.height / totalH;
  const pad = el.fontSize * 0.5;
  ctx.save();
  ctx.textBaseline = "middle";
  let y = 0;
  el.rowHeights.forEach((rh, r) => {
    const h = rh * sy;
    let x = 0;
    el.colWidths.forEach((cw, c) => {
      const w = cw * sx;
      const header = el.headerRow && r === 0;
      ctx.fillStyle = header ? el.headerFill : el.stripeFill && r % 2 === 0 ? el.stripeFill : "#ffffff";
      ctx.fillRect(x, y, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.font = `${header ? 700 : 400} ${el.fontSize}px ${cssFontFamily(el.fontFamily)}`;
      ctx.fillStyle = header ? el.headerColor : el.color;
      const lines = wrap(ctx, el.cells[r]?.[c] ?? "", Math.max(10, w - pad * 2));
      const lh = el.fontSize * 1.25;
      const top = y + h / 2 - ((lines.length - 1) * lh) / 2;
      ctx.textAlign = el.align === "center" ? "center" : el.align === "right" ? "right" : "left";
      const tx = el.align === "center" ? x + w / 2 : el.align === "right" ? x + w - pad : x + pad;
      lines.forEach((l, i) => ctx.fillText(l, tx, top + i * lh));
      ctx.restore();
      x += w;
    });
    y += h;
  });
  if (el.borderWidth > 0) {
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = el.borderWidth;
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
  ctx.restore();
}

const nice = (max: number) => {
  if (max <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(max));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export function drawChart(ctx: Ctx, el: ChartElement): void {
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

  // cartesian charts
  const allValues = el.series.flatMap((s) => s.values);
  const max = nice(Math.max(...allValues, 1));
  const horizontal = el.chart === "bar";
  const axisFont = `400 ${fs * 0.9}px ${fam}`;
  const labelFont = `500 ${fs * 0.9}px ${fam}`;
  const ticks = [0, 1, 2, 3, 4].map((i) => chartNumber(Math.round(max * (i / 4) * 100) / 100));
  // what stands on the left of the plot (the numbers of the axis, or the names of a bar chart) gets the room it needs, within limits
  const beside = horizontal ? el.labels.map((l) => measureWidth(labelFont, l)) : ticks.map((t) => measureWidth(axisFont, t));
  const left = plotLeft(fs, el.width, Math.max(0, ...beside));
  const besideRoom = left - fs * 0.5;
  const bottom = fs * 2.2;
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

  const n = el.labels.length || 1;
  const sCount = el.series.length || 1;
  ctx.font = labelFont;
  // under the plot a name has the room of its category; when the categories are crowded only every few are named
  // beside a lying plot the names follow each other downwards, where each takes about a line (half a font size and the air around it)
  const step = horizontal ? categoryStep(fs, ph / n, fs * 0.5) : categoryStep(fs, pw / n, Math.max(0, ...el.labels.map((l) => measureWidth(labelFont, l))));
  // the values are written only where they do not run into each other (chartText.ts)
  const slot = (horizontal ? ph : pw) / n;
  const marks = el.chart === "line" || el.chart === "area" || sCount === 1 ? slot : (slot * 0.72) / sCount;
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

  if (el.chart === "line" || el.chart === "area") {
    el.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => ({ x: px + (pw / n) * (i + 0.5), y: py + ph - (ph * v) / max, v }));
      if (!pts.length) return;
      if (el.chart === "area") {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, py + ph);
        pts.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, py + ph);
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
    });
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

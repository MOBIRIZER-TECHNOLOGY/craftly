/**
 * The text of a page for the invisible text layer of a PDF (pdf.ts): every line that is painted, with the place,
 * the turn and the width it has in the picture, so that what a reader selects lies over what is seen.
 *
 * The lines come from `layoutText`, the layout the canvas paints and the SVG writer positions its words by, so the
 * breaks and the order are those of the page. What is collected:
 *
 *   text elements   line by line; every word and every stretch of spaces is a piece with its own x and width
 *   list markers    as a piece in front of the first line of the item
 *   curved text     word by word: each word is laid on the tangent of the arc at its middle (the canvas turns
 *                   every letter; a word is close enough for a selection and keeps the words whole for a search)
 *   tables          cell by cell, row by row, wrapped and aligned as `drawTable` paints them
 *
 * Left out: the labels of charts, hidden elements, elements that are fully transparent (or inside such a group),
 * and lines that lie wholly outside the page. A line that is partly on the page is kept whole.
 */
import { measureMetrics, measureWidth } from "@/core/textMetrics";
import type { Design, DesignElement, Page, TableElement, TextElement } from "@/core/types";
import { cssFontFamily } from "@/render/fonts";
import { curveGeometry, layoutText } from "@/render/textLayout";
import { IDENTITY, applyMatrix, elementMatrix, multiply, type Matrix } from "./links";
import { PX_TO_PT } from "./options";
import type { PdfTextLine, PdfTextPiece } from "./pdf";

/** Design pixels to points. */
const TO_POINTS: Matrix = [PX_TO_PT, 0, 0, PX_TO_PT, 0, 0];

interface Collector {
  width: number;
  height: number;
  lines: PdfTextLine[];
}

/**
 * Adds a line whose baseline starts at (x, y) of the space `m` maps to the page, turned by `angle` radians there.
 * Nothing is added when no piece has ink, or when the line cannot be seen because all of it is outside the page.
 */
function addLine(out: Collector, m: Matrix, x: number, y: number, angle: number, pieces: PdfTextPiece[]): void {
  if (!pieces.some((p) => p.text.trim())) return;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = multiply(m, [cos, sin, -sin, cos, x, y]);
  // the box of the line: from its first piece to the end of its last, an em above the baseline and a third below
  const size = Math.max(...pieces.map((p) => p.size));
  const x0 = Math.min(...pieces.map((p) => p.x));
  const x1 = Math.max(...pieces.map((p) => p.x + p.width));
  const corners = [applyMatrix(local, x0, -size), applyMatrix(local, x1, -size), applyMatrix(local, x1, size * 0.3), applyMatrix(local, x0, size * 0.3)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  if (Math.max(...xs) <= 0 || Math.min(...xs) >= out.width || Math.max(...ys) <= 0 || Math.min(...ys) >= out.height) return;
  out.lines.push({ matrix: multiply(TO_POINTS, local), pieces });
}

function collectText(out: Collector, el: TextElement, m: Matrix): void {
  const layout = layoutText(el);
  const curve = el.curve ? curveGeometry(el, layout) : null;
  for (const line of layout.lines) {
    const baseline = line.y + line.baseline;
    if (curve) {
      // the same circle as drawCurved in render/drawText.ts: its centre below the baseline for an arch, above it for a bow
      const { radius, dir, sag } = curve;
      const centreX = layout.width / 2;
      const y0 = baseline + (dir > 0 ? 0 : sag);
      const centreY = dir > 0 ? y0 + radius : y0 - radius;
      for (const seg of line.segments) {
        if (seg.isSpace || !seg.text) continue;
        const theta = (line.x + seg.x + seg.width / 2 - centreX) / radius;
        const rot = dir > 0 ? theta : -theta;
        const px = centreX + radius * Math.sin(theta);
        const py = dir > 0 ? centreY - radius * Math.cos(theta) : centreY + radius * Math.cos(theta);
        // the word is centred on the point of the arc under its middle
        addLine(out, m, px - (Math.cos(rot) * seg.width) / 2, py - (Math.sin(rot) * seg.width) / 2, rot, [{ text: seg.text, x: 0, width: seg.width, size: seg.style.size }]);
      }
      continue;
    }
    const pieces: PdfTextPiece[] = [];
    if (line.marker) pieces.push({ text: line.marker.text, x: line.marker.x, width: measureWidth(line.marker.font, line.marker.text), size: line.marker.style.size });
    for (const seg of line.segments) pieces.push({ text: seg.text, x: line.x + seg.x, width: seg.width, size: seg.style.size });
    addLine(out, m, 0, baseline, 0, pieces);
  }
}

/** The lines of a cell, broken as `wrap` in render/drawBlocks.ts breaks them. */
function wrapCell(font: string, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && measureWidth(font, test) > maxWidth) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

/** Mirrors `drawTable` in render/drawBlocks.ts: the same cell sizes, padding, wrapping, line height and alignment. */
function collectTable(out: Collector, el: TableElement, m: Matrix): void {
  const totalW = el.colWidths.reduce((a, b) => a + b, 0) || el.width;
  const totalH = el.rowHeights.reduce((a, b) => a + b, 0) || el.height;
  const sx = el.width / totalW;
  const sy = el.height / totalH;
  const pad = el.fontSize * 0.5;
  const lineHeight = el.fontSize * 1.25;
  let y = 0;
  el.rowHeights.forEach((rh, r) => {
    const h = rh * sy;
    const font = `${el.headerRow && r === 0 ? 700 : 400} ${el.fontSize}px ${cssFontFamily(el.fontFamily)}`;
    // the canvas writes a cell with the "middle" baseline: the real baseline lies half the difference of ascent and descent lower
    const metrics = measureMetrics(font);
    const drop = (metrics.ascent - metrics.descent) / 2;
    let x = 0;
    el.colWidths.forEach((cw, c) => {
      const w = cw * sx;
      const lines = wrapCell(font, el.cells[r]?.[c] ?? "", Math.max(10, w - pad * 2));
      const top = y + h / 2 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((text, i) => {
        const middle = top + i * lineHeight;
        // the cell clips its text: a line whose middle is outside the row is not seen
        if (middle < y || middle > y + h) return;
        const width = measureWidth(font, text);
        const start = el.align === "center" ? x + w / 2 - width / 2 : el.align === "right" ? x + w - pad - width : x + pad;
        addLine(out, m, start, middle + drop, 0, [{ text, x: 0, width, size: el.fontSize }]);
      });
      x += w;
    });
    y += h;
  });
}

/** Every line of text that is seen on the page, in paint order (elements back to front, the lines of each from the top). */
export function collectPageText(design: Pick<Design, "width" | "height">, page: Page): PdfTextLine[] {
  const out: Collector = { width: design.width, height: design.height, lines: [] };
  const visit = (el: DesignElement, parent: Matrix) => {
    // what is hidden or fully transparent is not in the picture, and neither is anything inside it
    if (el.hidden || !(el.opacity > 0)) return;
    const m = multiply(parent, elementMatrix(el));
    if (el.type === "text") collectText(out, el, m);
    else if (el.type === "table") collectTable(out, el, m);
    else if (el.type === "group") for (const child of el.children) visit(child, m);
  };
  for (const el of page.elements) visit(el, IDENTITY);
  return out.lines;
}

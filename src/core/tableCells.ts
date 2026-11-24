import { rotatePoint } from "./geometry";
import type { Color, Point, TableCell, TableElement, TextAlign } from "./types";

export type { TableCell } from "./types";

export interface TableCellBox extends TableCell {
  x: number;
  y: number;
  width: number;
  height: number;
  rowSpan: number;
  colSpan: number;
}

export const tableCellKey = (cell: TableCell) => `${cell.row}:${cell.col}`;

/** The visible cells, with merged rectangles scaled exactly as the painter scales the table. */
export function tableLayout(table: TableElement): TableCellBox[] {
  const sx = table.width / (table.colWidths.reduce((a, b) => a + b, 0) || table.width || 1);
  const sy = table.height / (table.rowHeights.reduce((a, b) => a + b, 0) || table.height || 1);
  const xs = [0];
  const ys = [0];
  for (const width of table.colWidths) xs.push(xs[xs.length - 1] + width * sx);
  for (const height of table.rowHeights) ys.push(ys[ys.length - 1] + height * sy);
  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  for (const merge of table.merges ?? []) {
    if (merge.row < 0 || merge.col < 0 || merge.row >= table.rowHeights.length || merge.col >= table.colWidths.length) continue;
    const rowSpan = Math.max(1, Math.min(table.rowHeights.length - merge.row, Math.floor(merge.rowSpan)));
    const colSpan = Math.max(1, Math.min(table.colWidths.length - merge.col, Math.floor(merge.colSpan)));
    spans.set(tableCellKey(merge), { rowSpan, colSpan });
  }
  const boxes: TableCellBox[] = [];
  for (let row = 0; row < table.rowHeights.length; row++) {
    for (let col = 0; col < table.colWidths.length; col++) {
      const span = spans.get(tableCellKey({ row, col }));
      if (span) {
        boxes.push({
          row,
          col,
          ...span,
          x: xs[col],
          y: ys[row],
          width: xs[Math.min(xs.length - 1, col + span.colSpan)] - xs[col],
          height: ys[Math.min(ys.length - 1, row + span.rowSpan)] - ys[row],
        });
        continue;
      }
      const covered = [...spans].some(([key, span]) => {
        const [rootRow, rootCol] = key.split(":").map(Number);
        return row >= rootRow && row < rootRow + span.rowSpan && col >= rootCol && col < rootCol + span.colSpan;
      });
      if (!covered) boxes.push({ row, col, rowSpan: 1, colSpan: 1, x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] });
    }
  }
  return boxes;
}

export function tableCellStyle(table: TableElement, cell: TableCell): { fill: Color; color: Color; bold: boolean; align: TextAlign } {
  const header = table.headerRow && cell.row === 0;
  const custom = table.cellStyles?.[tableCellKey(cell)];
  return {
    fill: custom?.fill ?? (header ? table.headerFill : table.stripeFill && cell.row % 2 === 0 ? table.stripeFill : "#ffffff"),
    color: custom?.color ?? (header ? table.headerColor : table.color),
    bold: custom?.bold ?? header,
    align: custom?.align ?? table.align,
  };
}

/** The visible cell under `point` (page coordinates), or null outside the table. */
export function tableCellAt(table: TableElement, point: Point): TableCell | null {
  const { width, height } = table;
  if (!(width > 0) || !(height > 0) || !table.colWidths.length || !table.rowHeights.length) return null;
  const centre = { x: table.x + width / 2, y: table.y + height / 2 };
  const turned = table.rotation ? rotatePoint(point, centre, -table.rotation) : point;
  const local = { x: table.flipH ? 2 * centre.x - turned.x : turned.x, y: table.flipV ? 2 * centre.y - turned.y : turned.y };
  const x = local.x - table.x;
  const y = local.y - table.y;
  const slack = 1e-6;
  if (x < -slack || y < -slack || x > width + slack || y > height + slack) return null;
  const box = tableLayout(table).find((cell) => x >= cell.x - slack && x <= cell.x + cell.width + slack && y >= cell.y - slack && y <= cell.y + cell.height + slack);
  return box ? { row: box.row, col: box.col } : null;
}

/** Merge a rectangle at its top-left cell. Covered text is cleared and overlapping old merges are replaced. */
export function mergeTableCells(table: TableElement, at: TableCell, rowSpan: number, colSpan: number): void {
  if (at.row < 0 || at.col < 0 || at.row >= table.rowHeights.length || at.col >= table.colWidths.length) return;
  const rows = Math.max(1, Math.min(table.rowHeights.length - at.row, Math.floor(rowSpan)));
  const cols = Math.max(1, Math.min(table.colWidths.length - at.col, Math.floor(colSpan)));
  const overlaps = (merge: NonNullable<TableElement["merges"]>[number]) =>
    merge.row < at.row + rows && merge.row + merge.rowSpan > at.row && merge.col < at.col + cols && merge.col + merge.colSpan > at.col;
  table.merges = (table.merges ?? []).filter((merge) => !overlaps(merge));
  if (rows === 1 && cols === 1) return;
  table.merges.push({ row: at.row, col: at.col, rowSpan: rows, colSpan: cols });
  for (let row = at.row; row < at.row + rows; row++) {
    for (let col = at.col; col < at.col + cols; col++) {
      if (row !== at.row || col !== at.col) table.cells[row][col] = "";
    }
  }
}

export function unmergeTableCells(table: TableElement, at: TableCell): void {
  if (!table.merges) return;
  table.merges = table.merges.filter((merge) => merge.row !== at.row || merge.col !== at.col);
  if (!table.merges.length) delete table.merges;
}

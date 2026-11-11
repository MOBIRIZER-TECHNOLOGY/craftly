/** Which cell of a table is under a point of the page: what a double click on a table opens. */
import { rotatePoint } from "./geometry";
import type { Point, TableElement } from "./types";

export interface TableCell {
  row: number;
  col: number;
}

/** The index of the stretch that `at` falls into, when stretches of these sizes are laid end to end over `length`. */
function indexAt(sizes: readonly number[], length: number, at: number): number {
  const total = sizes.reduce((a, b) => a + b, 0) || length;
  const scale = length / total;
  let end = 0;
  for (let i = 0; i < sizes.length; i++) {
    end += sizes[i] * scale;
    if (at < end) return i;
  }
  return sizes.length - 1;
}

/**
 * The cell under `point` (page coordinates), or null when the point is outside the table. The columns and rows are scaled to the
 * table's box the way the painter scales them (src/render/drawBlocks.ts), and a turned table is turned back first.
 */
export function tableCellAt(table: TableElement, point: Point): TableCell | null {
  const { width, height } = table;
  if (!(width > 0) || !(height > 0) || !table.colWidths.length || !table.rowHeights.length) return null;
  const centre = { x: table.x + width / 2, y: table.y + height / 2 };
  const local = table.rotation ? rotatePoint(point, centre, -table.rotation) : point;
  const x = local.x - table.x;
  const y = local.y - table.y;
  // a hair of tolerance: turning a point back leaves it a rounding error off the edge it was on
  const slack = 1e-6;
  if (x < -slack || y < -slack || x > width + slack || y > height + slack) return null;
  return { row: indexAt(table.rowHeights, height, y), col: indexAt(table.colWidths, width, x) };
}

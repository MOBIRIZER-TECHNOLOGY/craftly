import { describe, expect, it } from "vitest";
import { createTable } from "./factory";
import { mergeTableCells, tableCellAt, tableCellStyle, tableLayout, unmergeTableCells } from "./tableCells";

describe("the cell of a table under a point of the page", () => {
  const table = () => createTable({ x: 100, y: 200, width: 600, height: 240 });

  it("finds the row and the column", () => {
    expect(tableCellAt(table(), { x: 110, y: 210 })).toEqual({ row: 0, col: 0 });
    expect(tableCellAt(table(), { x: 350, y: 300 })).toEqual({ row: 1, col: 1 });
    expect(tableCellAt(table(), { x: 690, y: 430 })).toEqual({ row: 2, col: 2 });
  });

  it("follows columns and rows of different sizes, and a table that was made larger since they were set", () => {
    const t = createTable({ x: 0, y: 0, width: 1200, height: 480, colWidths: [100, 200, 300], rowHeights: [40, 40, 160] });
    // drawn twice as large as its columns and rows say: the columns end at 200, 600 and 1200, the rows at 80, 160 and 480
    expect(tableCellAt(t, { x: 199, y: 79 })).toEqual({ row: 0, col: 0 });
    expect(tableCellAt(t, { x: 201, y: 81 })).toEqual({ row: 1, col: 1 });
    expect(tableCellAt(t, { x: 601, y: 161 })).toEqual({ row: 2, col: 2 });
  });

  it("takes the turn of the table into account", () => {
    // turned a quarter: what was the top right corner is now at the bottom right of the box
    const t = createTable({ x: 100, y: 200, width: 600, height: 240, rotation: 90 });
    const centre = { x: 400, y: 320 };
    // the first cell is 250 left and 80 above the centre before the turn, so 80 right and 250 above it afterwards
    expect(tableCellAt(t, { x: centre.x + 80, y: centre.y - 250 })).toEqual({ row: 0, col: 0 });
    expect(tableCellAt(t, { x: centre.x - 80, y: centre.y + 250 })).toEqual({ row: 2, col: 2 });
  });

  it("finds the cell that is drawn under the point in a mirrored table", () => {
    // mirrored left to right, the last column is drawn on the left; top to bottom, the last row is drawn at the top
    expect(tableCellAt(createTable({ x: 100, y: 200, width: 600, height: 240, flipH: true }), { x: 110, y: 210 })).toEqual({ row: 0, col: 2 });
    expect(tableCellAt(createTable({ x: 100, y: 200, width: 600, height: 240, flipV: true }), { x: 110, y: 210 })).toEqual({ row: 2, col: 0 });
    // turned a quarter and mirrored: turned back first, then mirrored back, as it was drawn
    const t = createTable({ x: 100, y: 200, width: 600, height: 240, rotation: 90, flipH: true });
    expect(tableCellAt(t, { x: 400 + 80, y: 320 - 250 })).toEqual({ row: 0, col: 2 });
  });

  it("gives the nearest cell for a point on the edge, and nothing outside the table", () => {
    expect(tableCellAt(table(), { x: 100, y: 200 })).toEqual({ row: 0, col: 0 });
    expect(tableCellAt(table(), { x: 700, y: 440 })).toEqual({ row: 2, col: 2 });
    expect(tableCellAt(table(), { x: 99, y: 210 })).toBeNull();
    expect(tableCellAt(table(), { x: 110, y: 441 })).toBeNull();
  });

  it("gives nothing for a table without cells or without a size", () => {
    expect(tableCellAt(createTable({ cells: [], colWidths: [], rowHeights: [] }), { x: 10, y: 10 })).toBeNull();
    expect(tableCellAt(createTable({ x: 0, y: 0, width: 0, height: 0 }), { x: 0, y: 0 })).toBeNull();
  });
});

describe("merged cells and styles", () => {
  it("lays out one root cell, sends hits there and hides covered cells", () => {
    const t = createTable({ x: 100, y: 200, width: 600, height: 240 });
    mergeTableCells(t, { row: 0, col: 0 }, 2, 2);
    const root = tableLayout(t).find((cell) => cell.row === 0 && cell.col === 0)!;
    expect([root.x, root.y, root.width, root.height]).toEqual([0, 0, 400, 160]);
    expect(tableLayout(t)).toHaveLength(6);
    expect(tableCellAt(t, { x: 350, y: 300 })).toEqual({ row: 0, col: 0 });
    expect(t.cells[0][1]).toBe("");
    unmergeTableCells(t, { row: 0, col: 0 });
    expect(tableLayout(t)).toHaveLength(9);
    expect(t.merges).toBeUndefined();
  });

  it("resolves a cell's own style over the header and table defaults", () => {
    const t = createTable({ cellStyles: { "0:0": { fill: "#112233", color: "#fefefe", bold: false, align: "right" } } });
    expect(tableCellStyle(t, { row: 0, col: 0 })).toEqual({ fill: "#112233", color: "#fefefe", bold: false, align: "right" });
    expect(tableCellStyle(t, { row: 0, col: 1 })).toEqual({ fill: "#7c3aed", color: "#ffffff", bold: true, align: "left" });
  });

  it("clamps merge spans and replaces overlapping old merges", () => {
    const t = createTable();
    mergeTableCells(t, { row: 0, col: 0 }, 2, 2);
    mergeTableCells(t, { row: 1, col: 1 }, 99, 99);
    expect(t.merges).toEqual([{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
    expect(tableLayout(t).find((cell) => cell.row === 1 && cell.col === 1)).toMatchObject({ width: 400, height: 160 });
  });
});

describe("tables in unusual shapes", () => {
  it("falls back to the size of the table when its columns and rows add up to nothing, so no cell ends up at a broken position", () => {
    const t = createTable({
      x: 0,
      y: 0,
      width: 300,
      height: 120,
      colWidths: [0, 0],
      rowHeights: [0, 0],
      cells: [
        ["", ""],
        ["", ""],
      ],
    });
    const boxes = tableLayout(t);
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect([box.x, box.y, box.width, box.height].every(Number.isFinite)).toBe(true);
    // every cell has no size, so a point inside the table finds no cell to land on
    expect(tableCellAt(t, { x: 150, y: 60 })).toBeNull();
  });

  it("keeps the layout finite for a table with no width or height of its own and empty columns", () => {
    const t = createTable({ width: 0, height: 0, colWidths: [0], rowHeights: [0], cells: [[""]] });
    expect(tableLayout(t)).toEqual([{ row: 0, col: 0, rowSpan: 1, colSpan: 1, x: 0, y: 0, width: 0, height: 0 }]);
  });

  it("ignores a stored merge that starts outside the table", () => {
    const t = createTable({
      merges: [
        { row: -1, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 0, col: -1, rowSpan: 2, colSpan: 2 },
        { row: 3, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 0, col: 3, rowSpan: 2, colSpan: 2 },
      ],
    });
    expect(tableLayout(t)).toHaveLength(9);
    expect(tableLayout(t).every((cell) => cell.rowSpan === 1 && cell.colSpan === 1)).toBe(true);
  });
});

describe("the colours of cells without a style of their own", () => {
  it("stripes every other body row below the heading and leaves the rows between white", () => {
    const t = createTable({ rowHeights: [80, 80, 80, 80], cells: [["a"], ["b"], ["c"], ["d"]], colWidths: [600] });
    expect(tableCellStyle(t, { row: 1, col: 0 }).fill).toBe("#ffffff");
    expect(tableCellStyle(t, { row: 2, col: 0 }).fill).toBe("#f3f0ff");
    expect(tableCellStyle(t, { row: 3, col: 0 }).fill).toBe("#ffffff");
  });

  it("stripes the first row like any other when the table has no heading row", () => {
    const t = createTable({ headerRow: false });
    expect(tableCellStyle(t, { row: 0, col: 0 })).toEqual({ fill: "#f3f0ff", color: t.color, bold: false, align: "left" });
  });

  it("paints every body row white when the table has no stripe colour", () => {
    const t = createTable({ stripeFill: null });
    expect(tableCellStyle(t, { row: 2, col: 0 }).fill).toBe("#ffffff");
  });
});

describe("merging and unmerging edge cases", () => {
  it("does nothing when asked to merge from a cell outside the table", () => {
    const t = createTable();
    const before = structuredClone(t.cells);
    mergeTableCells(t, { row: -1, col: 0 }, 2, 2);
    mergeTableCells(t, { row: 0, col: -1 }, 2, 2);
    mergeTableCells(t, { row: 3, col: 0 }, 2, 2);
    mergeTableCells(t, { row: 0, col: 3 }, 2, 2);
    expect(t.merges).toBeUndefined();
    expect(t.cells).toEqual(before);
  });

  it("merging a single cell over an old merge only takes the old merge away and keeps the text", () => {
    const t = createTable();
    mergeTableCells(t, { row: 1, col: 0 }, 2, 2);
    t.cells[1][0] = "kept";
    mergeTableCells(t, { row: 1, col: 0 }, 1, 1);
    expect(t.merges).toEqual([]);
    expect(t.cells[1][0]).toBe("kept");
    expect(tableLayout(t)).toHaveLength(9);
  });

  it("merges a single row across several columns", () => {
    const t = createTable();
    mergeTableCells(t, { row: 2, col: 0 }, 1, 3);
    expect(t.merges).toEqual([{ row: 2, col: 0, rowSpan: 1, colSpan: 3 }]);
    expect(tableLayout(t).find((cell) => cell.row === 2)).toMatchObject({ col: 0, width: 600, height: 80 });
  });

  it("unmerging a table without merges leaves it alone", () => {
    const t = createTable();
    unmergeTableCells(t, { row: 0, col: 0 });
    expect(t.merges).toBeUndefined();
  });

  it("unmerging one of two merges keeps the other", () => {
    const t = createTable();
    mergeTableCells(t, { row: 0, col: 0 }, 1, 2);
    mergeTableCells(t, { row: 2, col: 0 }, 1, 3);
    unmergeTableCells(t, { row: 0, col: 0 });
    expect(t.merges).toEqual([{ row: 2, col: 0, rowSpan: 1, colSpan: 3 }]);
  });
});

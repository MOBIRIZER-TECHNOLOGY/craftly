/**
 * Tables and charts from data: the edits that put rows into a table or a chart, the "Import data" block of the Data panel
 * (pasted text and a chosen file), and a paste into one cell of a table.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_INPUT_CHARS } from "@/core/delimited";
import { createChart, createShape, createTable } from "@/core/factory";
import { getActions } from "@/core/store";
import type { ChartElement, TableElement } from "@/core/types";
import { live, openElements, showPanel, store } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { toast } from "@/ui";
import { replaceChartData, replaceTableCells, spreadTableCells } from "./dataEdit";
import { MAX_FILE_BYTES, importChartData, importTableData, pasteDataIntoSelection } from "./dataImport";

let success: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetEditor();
  success = vi.spyOn(toast, "success");
  info = vi.spyOn(toast, "info");
  error = vi.spyOn(toast, "error");
});

afterEach(() => vi.restoreAllMocks());

const table = (init: Partial<TableElement> = {}) =>
  createTable({
    cells: [
      ["Name", "Qty"],
      ["Apples", "3"],
      ["Pears", "5"],
    ],
    colWidths: [400, 200],
    rowHeights: [80, 80, 80],
    width: 600,
    height: 240,
    fontSize: 20,
    headerRow: true,
    headerFill: "#123456",
    align: "center",
    ...init,
  });

const chart = (init: Partial<ChartElement> = {}) =>
  createChart({
    chart: "column",
    labels: ["A", "B", "C"],
    series: [
      { name: "One", values: [10, 20, 30], color: "#aa0000" },
      { name: "Two", values: [1, 2, 3] },
    ],
    palette: ["#111111", "#222222", "#333333"],
    ...init,
  });

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const openData = () => showPanel({ kind: "data" });
const area = () => screen.getByRole("textbox", { name: "Data to import" }) as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const cell = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const typeData = (text: string) => fireEvent.change(area(), { target: { value: text } });
const pasteInto = (target: Element, text: string) => !fireEvent.paste(target, { clipboardData: { getData: (type: string) => (type === "text/plain" ? text : ""), files: [] } });

describe("replaceTableCells", () => {
  it("takes the new rows, keeps the box and the widths of the columns that are still there", () => {
    const t = table();
    replaceTableCells(t, [
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    expect(t.cells).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    expect([t.width, t.height]).toEqual([600, 240]);
    expect(t.colWidths).toHaveLength(3);
    expect(sum(t.colWidths)).toBeCloseTo(600);
    // the first column was twice as wide as the second and still is; the new one is as wide as their average
    expect(t.colWidths[0] / t.colWidths[1]).toBeCloseTo(2);
    expect(t.colWidths[2] / t.colWidths[1]).toBeCloseTo(1.5);
    expect(t.rowHeights).toEqual([120, 120]);
  });

  it("drops the columns and rows the data does not have", () => {
    const t = table();
    replaceTableCells(t, [["only"]]);
    expect(t.cells).toEqual([["only"]]);
    expect(t.colWidths).toEqual([600]);
    expect(t.rowHeights).toEqual([240]);
  });

  it("makes the table taller when the rows would be too low for their text, and never lower", () => {
    const t = table();
    replaceTableCells(
      t,
      Array.from({ length: 20 }, (_, r) => [`r${r}`, "x"]),
    );
    // 20 rows of text 20 px high need 30 px each
    expect(t.height).toBe(600);
    expect(t.rowHeights).toHaveLength(20);
    expect(sum(t.rowHeights)).toBeCloseTo(600);
    expect(t.width).toBe(600);
    replaceTableCells(t, [
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(t.height).toBe(600);
  });

  it("puts a cell of several lines on one line and copies the rows it is given", () => {
    const t = table();
    const rows = [["two\nlines", "x"]];
    replaceTableCells(t, rows);
    expect(t.cells).toEqual([["two lines", "x"]]);
    t.cells[0][1] = "changed";
    expect(rows[0][1]).toBe("x");
  });

  it("leaves the table alone when there are no rows", () => {
    const t = table();
    replaceTableCells(t, []);
    expect(t.cells).toHaveLength(3);
  });
});

describe("spreadTableCells", () => {
  it("writes the rows from one cell on and leaves the other cells as they were", () => {
    const t = table();
    expect(spreadTableCells(t, { row: 1, col: 0 }, [["Plums", "7"], ["Figs", "9"]])).toBe(false); // prettier-ignore
    expect(t.cells).toEqual([
      ["Name", "Qty"],
      ["Plums", "7"],
      ["Figs", "9"],
    ]);
  });

  it("adds the rows and columns it needs, with empty cells, and keeps the box", () => {
    const t = table();
    spreadTableCells(t, { row: 2, col: 1 }, [["a", "b"], ["c\nd", "e"]]); // prettier-ignore
    expect(t.cells).toEqual([
      ["Name", "Qty", ""],
      ["Apples", "3", ""],
      ["Pears", "a", "b"],
      ["", "c d", "e"],
    ]);
    expect(sum(t.colWidths)).toBeCloseTo(600);
    expect(sum(t.rowHeights)).toBeCloseTo(240);
    expect(t.colWidths).toHaveLength(3);
    expect(t.rowHeights).toHaveLength(4);
  });

  it("stops at the size a table may have and says so", () => {
    const t = table();
    const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => `${r}${c}`));
    expect(spreadTableCells(t, { row: 2, col: 1 }, rows, { rows: 4, cols: 3 })).toBe(true);
    expect(t.cells).toEqual([
      ["Name", "Qty", ""],
      ["Apples", "3", ""],
      ["Pears", "00", "01"],
      ["", "10", "11"],
    ]);
  });
});

describe("replaceChartData", () => {
  it("takes labels and series and keeps the colour a series had", () => {
    const c = chart();
    replaceChartData(c, {
      labels: ["x", "y"],
      series: [
        { name: "S1", values: [1, 2] },
        { name: "S2", values: [3, 4] },
        { name: "S3", values: [5, 6] },
      ],
      notNumbers: 0,
    });
    expect(c.labels).toEqual(["x", "y"]);
    expect(c.series).toEqual([
      { name: "S1", values: [1, 2], color: "#aa0000" },
      { name: "S2", values: [3, 4] },
      { name: "S3", values: [5, 6] },
    ]);
    expect(c.chart).toBe("column");
    expect(c.palette).toEqual(["#111111", "#222222", "#333333"]);
  });
});

describe("importTableData", () => {
  it("fills the table in one undo step and says how much came in", () => {
    const t = table();
    openElements([t], { selected: [t] });
    const report = importTableData(t.id, "City,Country,People\nPune,India,7\nLyon,France,2\nLima,Peru,10\n");
    expect(report).toEqual({ ok: true, clean: true, message: "Imported 4 rows and 3 columns." });
    const now = live<TableElement>(t);
    expect(now.cells[3]).toEqual(["Lima", "Peru", "10"]);
    // the look of the table is untouched
    expect([now.headerRow, now.headerFill, now.align, now.fontSize, now.width]).toEqual([true, "#123456", "center", 20, 600]);
    getActions().undo();
    expect(live<TableElement>(t).cells).toEqual(t.cells);
    expect(live<TableElement>(t).colWidths).toEqual([400, 200]);
  });

  it("says one row and one column in the singular", () => {
    const t = table();
    openElements([t], { selected: [t] });
    expect(importTableData(t.id, "alone").message).toBe("Imported 1 row and 1 column.");
  });

  it("says what was cut off", () => {
    const t = table();
    openElements([t], { selected: [t] });
    const wide = Array.from({ length: 60 }, (_, i) => (i === 0 ? "y".repeat(1500) : `c${i}`)).join(",");
    const report = importTableData(t.id, Array.from({ length: 205 }, () => wide).join("\n"));
    expect(report.ok).toBe(true);
    expect(report.clean).toBe(false);
    expect(report.message).toBe(
      "Imported 200 rows and 50 columns. A table holds at most 200 rows and 50 columns; the rest was left out. 200 cells were shortened to 1,000 characters.",
    );
    expect(live<TableElement>(t).cells).toHaveLength(200);

    const one = importTableData(t.id, `${"z".repeat(1001)},b`);
    expect(one.message).toBe("Imported 1 row and 2 columns. 1 cell was shortened to 1,000 characters.");
    const long = importTableData(t.id, "a,b\n".repeat(MAX_INPUT_CHARS / 4 + 1));
    expect(long.message).toMatch(/The text was too long, so only its beginning was read\.$/);
  });

  it("refuses text without data, a locked table and a table that is not there, and changes nothing", () => {
    const t = table();
    const s = createShape("rect");
    const locked = table({ locked: true });
    openElements([t, s, locked], { selected: [t] });
    expect(importTableData(t.id, "\n\n")).toEqual({ ok: false, clean: false, message: "There is no data in this text." });
    expect(importTableData(s.id, "a,b\n1,2")).toEqual({ ok: false, clean: false, message: "This table is no longer on the page." });
    expect(importTableData("nobody", "a,b\n1,2").ok).toBe(false);
    expect(importTableData(locked.id, "a,b\n1,2")).toEqual({ ok: false, clean: false, message: "Unlock the table to change its data." });
    expect(live<TableElement>(locked).cells).toEqual(t.cells);
    expect(live<TableElement>(t).cells).toEqual(t.cells);
    expect(store().canUndo).toBeFalsy();
  });
});

describe("importChartData", () => {
  it("fills the chart in one undo step and says how much came in", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    const report = importChartData(c.id, "Month\tSales\tCosts\nJan\t1,200\t(300)\nFeb\t1,500.5\t12%\n");
    expect(report).toEqual({ ok: true, clean: true, message: "Imported 2 rows and 2 series." });
    expect(live<ChartElement>(c).labels).toEqual(["Jan", "Feb"]);
    expect(live<ChartElement>(c).series).toEqual([
      { name: "Sales", values: [1200, 1500.5], color: "#aa0000" },
      { name: "Costs", values: [-300, 12] },
    ]);
    getActions().undo();
    expect(live<ChartElement>(c).labels).toEqual(["A", "B", "C"]);
    expect(live<ChartElement>(c).series[1].values).toEqual([1, 2, 3]);
  });

  it("says how many cells were not numbers", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    expect(importChartData(c.id, "Month,Sales\nJan,n/a\nFeb,4").message).toBe("Imported 2 rows and 1 series. 1 cell was empty or not a number and is 0.");
    const report = importChartData(c.id, "Month,Sales,Costs\nJan,n/a,\nFeb,4,5");
    expect(report.message).toBe("Imported 2 rows and 2 series. 2 cells were empty or not numbers and are 0.");
    expect(report.clean).toBe(false);
    expect(live<ChartElement>(c).series[0].values).toEqual([0, 4]);
  });

  it("says that a pie or donut shows the first series only, and keeps the others", () => {
    for (const kind of ["pie", "donut"] as const) {
      const c = chart({ chart: kind });
      openElements([c], { selected: [c] });
      const report = importChartData(c.id, "Month,Sales,Costs\nJan,1,2\nFeb,3,4");
      expect(report.message).toBe("Imported 2 rows and 2 series. A pie or donut chart shows only the first series.");
      expect(report.clean).toBe(false);
      expect(live<ChartElement>(c).series).toHaveLength(2);
    }
    // one series: nothing to say
    const c = chart({ chart: "pie" });
    openElements([c], { selected: [c] });
    expect(importChartData(c.id, "Month,Sales\nJan,1").message).toBe("Imported 1 row and 1 series.");
  });

  it("says what was cut off", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    const head = ["Label", ...Array.from({ length: 15 }, (_, i) => `S${i + 1}`)].join(",");
    const lines = Array.from({ length: 120 }, (_, r) => [`row ${r}`, ...Array.from({ length: 15 }, (_, i) => i)].join(","));
    const report = importChartData(c.id, [head, ...lines].join("\n"));
    expect(report.message).toBe("Imported 100 rows and 12 series. A chart holds at most 100 rows and 12 series; the rest was left out.");
    expect(live<ChartElement>(c).labels).toHaveLength(100);
    expect(live<ChartElement>(c).series).toHaveLength(12);
  });

  it("refuses text without numbers and a chart that is not there, and changes nothing", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    expect(importChartData(c.id, "Name,City\nAnna,Pune")).toEqual({ ok: false, clean: false, message: "There are no numbers for a chart in this text." });
    expect(importChartData(c.id, "").ok).toBe(false);
    expect(importChartData("nobody", "a,1\nb,2").ok).toBe(false);
    expect(live<ChartElement>(c).labels).toEqual(["A", "B", "C"]);
    expect(store().canUndo).toBeFalsy();
  });
});

describe("Data panel: import data into a table", () => {
  it("imports what was pasted into the field, tells it and empties the field", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(screen.getByText("Import data")).toBeTruthy();
    expect(button("Import").disabled).toBe(true);
    typeData("City\tPeople\nPune\t7\n");
    await user.click(button("Import"));
    expect(live<TableElement>(t).cells).toEqual([
      ["City", "People"],
      ["Pune", "7"],
    ]);
    expect(success).toHaveBeenCalledWith("Imported 2 rows and 2 columns.");
    expect(screen.getByText("Imported 2 rows and 2 columns.")).toBeTruthy();
    expect(area().value).toBe("");
    // the grid of cells shows the new rows
    expect(cell("Row 2, column 1").value).toBe("Pune");
  });

  it("tells a cut import as a notice and a refused one as an error, and keeps refused text in the field", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    typeData(Array.from({ length: 201 }, (_, r) => `r${r},x`).join("\n"));
    await user.click(button("Import"));
    expect(info).toHaveBeenCalledWith("Imported 200 rows and 2 columns. A table holds at most 200 rows and 50 columns; the rest was left out.");
    typeData("\n \n");
    // white space alone is nothing to import
    expect(button("Import").disabled).toBe(true);
  });

  it("does not let the field hold more than the parser would read", () => {
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    typeData("x".repeat(MAX_INPUT_CHARS + 500));
    expect(area().value).toHaveLength(MAX_INPUT_CHARS + 1);
  });

  it("keeps Escape in the field from closing the panel", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    await user.click(area());
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", onKey);
    expect(onKey).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(area());
  });

  it("imports a chosen .csv file", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(fileInput().accept).toBe(".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain");
    expect(fileInput().multiple).toBe(false);
    const click = vi.spyOn(fileInput(), "click");
    await user.click(button("Choose a file"));
    expect(click).toHaveBeenCalled();
    // a spreadsheet program on Windows calls its CSV files this
    fireEvent.change(fileInput(), { target: { files: [new File(["\ufeffa;b\r\n1;2\r\n"], "numbers.CSV", { type: "application/vnd.ms-excel" })] } });
    await waitFor(() => expect(success).toHaveBeenCalledWith("Imported 2 rows and 2 columns."));
    expect(live<TableElement>(t).cells).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("takes a file by its type when its name says nothing", async () => {
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    fireEvent.change(fileInput(), { target: { files: [new File(["a\tb\n1\t2"], "export", { type: "text/tab-separated-values" })] } });
    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(live<TableElement>(t).cells[1]).toEqual(["1", "2"]);
  });

  it("refuses a file that is not text, one that is too large and one that cannot be read", async () => {
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });

    choose(new File(["a,b"], "page.html", { type: "text/html" }));
    await waitFor(() => expect(error).toHaveBeenLastCalledWith("Choose a text file: .csv, .tsv or .txt."));
    choose(new File(["PK"], "book.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(2));

    const big = new File(["a,b"], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
    const read = vi.spyOn(big, "text");
    choose(big);
    await waitFor(() => expect(error).toHaveBeenLastCalledWith("This file is larger than 2 MB. Import a smaller part of it."));
    expect(read).not.toHaveBeenCalled();

    // a picture renamed to .csv: bytes that are no text
    choose(new File(["GIF89a\u0000\u0001\u0000"], "picture.csv", { type: "text/csv" }));
    await waitFor(() => expect(error).toHaveBeenLastCalledWith("This file is not plain text."));

    const broken = new File(["a,b"], "broken.csv", { type: "text/csv" });
    vi.spyOn(broken, "text").mockRejectedValue(new Error("gone"));
    choose(broken);
    await waitFor(() => expect(error).toHaveBeenLastCalledWith("The file could not be read."));

    // choosing nothing (the dialog was closed) does nothing
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(error).toHaveBeenCalledTimes(5);
    expect(live<TableElement>(t).cells).toEqual(t.cells);
    expect(screen.getByText("The file could not be read.")).toBeTruthy();
  });

  it("does not import a file into a table that was deselected while the file was read", async () => {
    const t = table();
    const other = table();
    openElements([t, other], { selected: [t] });
    const view = openData();
    const file = new File(["a,b\n1,2"], "late.csv", { type: "text/csv" });
    let finish: (text: string) => void = () => {};
    vi.spyOn(file, "text").mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    fireEvent.change(fileInput(), { target: { files: [file] } });
    view.unmount();
    finish("a,b\n1,2");
    await Promise.resolve();
    await Promise.resolve();
    expect(live<TableElement>(t).cells).toEqual(t.cells);
    expect(success).not.toHaveBeenCalled();
  });
});

describe("Data panel: paste into a cell of a table", () => {
  it("spreads a block of a spreadsheet from the cell it is pasted into", () => {
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(pasteInto(cell("Row 2, column 2"), "7\tkg\n9\tkg\n11\tkg\n")).toBe(true);
    expect(live<TableElement>(t).cells).toEqual([
      ["Name", "Qty", ""],
      ["Apples", "7", "kg"],
      ["Pears", "9", "kg"],
      ["", "11", "kg"],
    ]);
    expect(success).toHaveBeenCalledWith("Pasted 3 rows and 2 columns from this cell on.");
    getActions().undo();
    expect(live<TableElement>(t).cells).toEqual(t.cells);
  });

  it("spreads one row of cells and a clear CSV too", () => {
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(pasteInto(cell("Row 1, column 1"), "Fruit\tCount")).toBe(true);
    expect(live<TableElement>(t).cells[0]).toEqual(["Fruit", "Count"]);
    expect(pasteInto(cell("Row 2, column 1"), "Plums,1\nFigs,2")).toBe(true);
    expect(live<TableElement>(t).cells.slice(1)).toEqual([
      ["Plums", "1"],
      ["Figs", "2"],
    ]);
  });

  it("leaves ordinary text to the field", () => {
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(pasteInto(cell("Row 2, column 1"), "Granny Smith, green")).toBe(false);
    expect(pasteInto(cell("Row 2, column 1"), "two\nlines")).toBe(false);
    expect(pasteInto(cell("Row 2, column 1"), "")).toBe(false);
    // a lone tab is no cell
    expect(pasteInto(cell("Row 2, column 1"), "\t")).toBe(false);
    expect(live<TableElement>(t).cells).toEqual(t.cells);
    expect(success).not.toHaveBeenCalled();
  });

  it("says when the table is full", () => {
    const t = table({ cells: Array.from({ length: 199 }, (_, r) => [`r${r}`, "x"]), rowHeights: Array.from({ length: 199 }, () => 30), height: 5970 });
    openElements([t], { selected: [t] });
    openData();
    pasteInto(cell("Row 199, column 1"), "a\tb\nc\td\ne\tf");
    expect(live<TableElement>(t).cells).toHaveLength(200);
    expect(info).toHaveBeenCalledWith("Pasted 3 rows and 2 columns from this cell on. A table holds at most 200 rows and 50 columns; the rest was left out.");
  });

  it("does not spread a paste into a label of a chart", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    expect(pasteInto(cell("Row 1 label"), "a\tb\nc\td")).toBe(false);
  });
});

describe("Data panel: import data into a chart", () => {
  it("imports what was pasted into the field", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    typeData("Quarter;North;South\nQ1;1,5;2,5\nQ2;3,5;x");
    await user.click(button("Import"));
    expect(live<ChartElement>(c).labels).toEqual(["Q1", "Q2"]);
    expect(live<ChartElement>(c).series.map((s) => s.values)).toEqual([
      [1.5, 3.5],
      [2.5, 0],
    ]);
    expect(info).toHaveBeenCalledWith("Imported 2 rows and 2 series. 1 cell was empty or not a number and is 0.");
    expect(screen.getByRole("textbox", { name: "North, Q1" })).toBeTruthy();
  });

  it("keeps text without numbers in the field and says why", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    typeData("Name,City\nAnna,Pune");
    await user.click(button("Import"));
    expect(error).toHaveBeenCalledWith("There are no numbers for a chart in this text.");
    expect(area().value).toBe("Name,City\nAnna,Pune");
    expect(live<ChartElement>(c).labels).toEqual(["A", "B", "C"]);
  });

  it("imports a chosen file", async () => {
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    fireEvent.change(fileInput(), { target: { files: [new File(["Month,Sales\nJan,10\nFeb,20\n"], "sales.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(success).toHaveBeenCalledWith("Imported 2 rows and 1 series."));
    expect(live<ChartElement>(c).series).toEqual([{ name: "Sales", values: [10, 20], color: "#aa0000" }]);
  });
});

describe("pasteDataIntoSelection", () => {
  it("fills the one selected table with a pasted block", () => {
    const t = table();
    openElements([t], { selected: [t] });
    expect(pasteDataIntoSelection("City\tPeople\nPune\t7\n")).toBe(true);
    expect(live<TableElement>(t).cells).toEqual([
      ["City", "People"],
      ["Pune", "7"],
    ]);
    expect(success).toHaveBeenCalledWith("Imported 2 rows and 2 columns.");
  });

  it("fills the one selected chart with a pasted block", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    expect(pasteDataIntoSelection("Month,Sales\nJan,10\nFeb,20")).toBe(true);
    expect(live<ChartElement>(c).labels).toEqual(["Jan", "Feb"]);
  });

  it("leaves a block without numbers alone when a chart is selected", () => {
    const c = chart();
    openElements([c], { selected: [c] });
    expect(pasteDataIntoSelection("Name\tCity\nAnna\tPune")).toBe(false);
    expect(live<ChartElement>(c).labels).toEqual(["A", "B", "C"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("leaves text that is no table alone", () => {
    const t = table();
    openElements([t], { selected: [t] });
    for (const text of ["A heading", "one\ntwo\nthree", "a\tb\tc", "Hello, world\nGoodbye, moon", ""]) expect(pasteDataIntoSelection(text)).toBe(false);
    expect(live<TableElement>(t).cells).toEqual(t.cells);
  });

  it("does nothing without a selection, with several elements, with another kind of element or with a locked one", () => {
    const t = table();
    const second = table();
    const s = createShape("rect");
    const locked = table({ locked: true });
    openElements([t, second, s, locked]);
    const block = "a\tb\n1\t2";
    expect(pasteDataIntoSelection(block)).toBe(false);
    getActions().select([t.id, second.id]);
    expect(pasteDataIntoSelection(block)).toBe(false);
    getActions().select([s.id]);
    expect(pasteDataIntoSelection(block)).toBe(false);
    getActions().select([locked.id]);
    expect(pasteDataIntoSelection(block)).toBe(false);
    for (const el of [t, second, locked]) expect(live<TableElement>(el).cells).toEqual(t.cells);
  });
});

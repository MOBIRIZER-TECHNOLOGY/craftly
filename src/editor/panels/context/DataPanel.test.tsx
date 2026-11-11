import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createChart, createShape, createTable } from "@/core/factory";
import type { ChartElement, TableElement } from "@/core/types";
import { live, openElements, showPanel } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";

beforeEach(() => resetEditor());

const openData = () => showPanel({ kind: "data" });
const cell = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
/** icon buttons keep focus when disabled, so they say it with aria-disabled */
const disabled = (el: HTMLButtonElement) => el.disabled || el.getAttribute("aria-disabled") === "true";
const toggle = (name: string) => screen.getByRole("switch", { name }) as HTMLInputElement;
const pick = async (user: ReturnType<typeof userEvent.setup>, swatch: string, hex: string) => {
  await user.click(button(swatch));
  const field = within(screen.getByRole("dialog", { name: `${swatch} picker` })).getByRole("textbox", { name: "Hex colour" });
  await user.clear(field);
  await user.type(field, hex);
  await user.keyboard("{Escape}");
};

describe("Data panel", () => {
  it("asks for a table or a chart", () => {
    const s = createShape("rect");
    openElements([s], { selected: [s] });
    openData();
    expect(screen.getByRole("region", { name: "Data" })).toBeTruthy();
    expect(screen.getByText("No table or chart selected")).toBeTruthy();
  });
});

describe("Data panel: table", () => {
  const table = () =>
    createTable({
      cells: [
        ["Name", "Qty"],
        ["Apples", "3"],
        ["Pears", "5"],
      ],
      colWidths: [300, 300],
      rowHeights: [80, 80, 80],
      width: 600,
      height: 240,
    });

  it("edits the cells and keeps typing in one place as one undo step", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(screen.getByRole("region", { name: "Table" })).toBeTruthy();
    expect(cell("Row 2, column 1").value).toBe("Apples");
    await user.clear(cell("Row 2, column 1"));
    await user.type(cell("Row 2, column 1"), "Plums");
    expect(live<TableElement>(t).cells[1]).toEqual(["Plums", "3"]);
    // Enter leaves the cell, Escape too
    await user.keyboard("{Enter}");
    expect(document.activeElement).not.toBe(cell("Row 2, column 1"));
    await user.click(cell("Row 3, column 2"));
    await user.keyboard("{Escape}");
    expect(document.activeElement).not.toBe(cell("Row 3, column 2"));
  });

  it("puts the keyboard into the cell it was opened for, with its text selected", () => {
    const t = createTable({
      cells: [
        ["A", "B"],
        ["C", "Dee"],
      ],
      colWidths: [100, 100],
      rowHeights: [40, 40],
    });
    openElements([t], { selected: [t] });
    showPanel({ kind: "data", cell: { row: 1, col: 1 } });
    const field = cell("Row 2, column 2");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
  });

  it("opens without taking the keyboard when no cell was asked for", () => {
    const t = createTable();
    openElements([t], { selected: [t] });
    openData();
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("opens without taking the keyboard for a cell the table does not have", () => {
    const t = createTable();
    openElements([t], { selected: [t] });
    showPanel({ kind: "data", cell: { row: 9, col: 9 } });
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("adds and removes rows and columns, but never the last one", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    await user.click(button("Add row"));
    await user.click(button("Add column"));
    expect(live<TableElement>(t).cells).toHaveLength(4);
    expect(live<TableElement>(t).cells[0]).toHaveLength(3);
    await user.click(button("Remove column 3"));
    await user.click(button("Remove row 4"));
    expect(live<TableElement>(t).cells).toEqual([
      ["Name", "Qty"],
      ["Apples", "3"],
      ["Pears", "5"],
    ]);

    await user.click(button("Remove row 2"));
    await user.click(button("Remove row 2"));
    expect(live<TableElement>(t).cells).toHaveLength(1);
    expect(disabled(button("Remove row 1"))).toBe(true);
    await user.click(button("Remove column 2"));
    expect(disabled(button("Remove column 1"))).toBe(true);
    expect(live<TableElement>(t).cells).toEqual([["Name"]]);
  });

  it("turns the header row on and off, sets the font size and the alignment", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    expect(cell("Row 1, column 1").classList.contains("is-header")).toBe(true);
    await user.click(toggle("Header row"));
    expect(live<TableElement>(t).headerRow).toBe(false);
    expect(cell("Row 1, column 1").classList.contains("is-header")).toBe(false);

    const size = screen.getByRole("spinbutton", { name: "Font size" });
    await user.click(size);
    await user.clear(size);
    await user.type(size, "32{Enter}");
    expect(live<TableElement>(t).fontSize).toBe(32);

    await user.click(screen.getByRole("radio", { name: "Align center" }));
    expect(live<TableElement>(t).align).toBe("center");
    await user.click(screen.getByRole("radio", { name: "Align right" }));
    expect(live<TableElement>(t).align).toBe("right");
  });

  it("changes the colours, the row stripes and the border", async () => {
    const user = userEvent.setup();
    const t = table();
    openElements([t], { selected: [t] });
    openData();
    await pick(user, "Header fill", "112233");
    expect(live<TableElement>(t).headerFill).toBe("#112233");
    await pick(user, "Header text", "ffeedd");
    expect(live<TableElement>(t).headerColor).toBe("#ffeedd");
    await pick(user, "Text", "010203");
    expect(live<TableElement>(t).color).toBe("#010203");
    await pick(user, "Row stripes", "abcdef");
    expect(live<TableElement>(t).stripeFill).toBe("#abcdef");
    await pick(user, "Border", "654321");
    expect(live<TableElement>(t).borderColor).toBe("#654321");

    await user.click(toggle("Row stripes"));
    expect(live<TableElement>(t).stripeFill).toBeNull();
    await user.click(toggle("Row stripes"));
    expect(live<TableElement>(t).stripeFill).toBe("#f3f0ff");

    const width = screen.getByRole("spinbutton", { name: "Border width" });
    await user.click(width);
    await user.clear(width);
    await user.type(width, "6{Enter}");
    expect(live<TableElement>(t).borderWidth).toBe(6);
  });
});

describe("Data panel: chart", () => {
  const chart = () =>
    createChart({
      chart: "column",
      labels: ["A", "B", "C"],
      series: [
        { name: "One", values: [10, 20, 30] },
        { name: "Two", values: [1, 2, 3] },
      ],
      palette: ["#111111", "#222222", "#333333"],
    });

  it("says that a negative number gets no slice in a pie or donut, and says nothing in the other charts or without one", () => {
    const note = () => screen.queryByText("A pie or donut chart has no slice for a negative number.");
    const open = (init: Partial<ChartElement>) => {
      const c = createChart(init);
      openElements([c], { selected: [c] });
      return openData();
    };
    const pie = open({ chart: "pie", labels: ["a", "b"], series: [{ name: "S", values: [-5, 10] }] });
    expect(note()).toBeTruthy();
    pie.unmount();
    const fine = open({ chart: "donut", labels: ["a", "b"], series: [{ name: "S", values: [0, 10] }] });
    expect(note()).toBeNull();
    fine.unmount();
    open({ chart: "column", labels: ["a", "b"], series: [{ name: "S", values: [-5, 10] }] });
    expect(note()).toBeNull();
  });

  it("switches the chart type", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    expect(screen.getByRole("region", { name: "Chart" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Column chart" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("radio", { name: "Pie chart" }));
    expect(live<ChartElement>(c).chart).toBe("pie");
    for (const name of ["Bar chart", "Line chart", "Area chart", "Donut chart"]) {
      await user.click(screen.getByRole("radio", { name }));
      expect(screen.getByRole("radio", { name }).getAttribute("aria-checked")).toBe("true");
    }
    expect(live<ChartElement>(c).chart).toBe("donut");
  });

  it("edits labels, series names and numbers", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    await user.clear(cell("Row 1 label"));
    await user.type(cell("Row 1 label"), "Alpha");
    expect(live<ChartElement>(c).labels[0]).toBe("Alpha");
    await user.clear(cell("Series 2 name"));
    await user.type(cell("Series 2 name"), "Second");
    expect(live<ChartElement>(c).series[1].name).toBe("Second");

    const number = screen.getByRole("textbox", { name: "One, Alpha" });
    await user.clear(number);
    await user.type(number, "42.5{Enter}");
    expect(live<ChartElement>(c).series[0].values[0]).toBe(42.5);
    // renamed series and labels show in the cell names
    expect(screen.getByRole("textbox", { name: "Second, B" })).toBeTruthy();
  });

  it("fills the gaps with zeros when a number is typed into a row the series has no value for yet", async () => {
    const user = userEvent.setup();
    const c = createChart({ labels: ["A", "B", "C"], series: [{ name: "Short", values: [4] }] });
    openElements([c], { selected: [c] });
    openData();
    const gap = screen.getByRole("textbox", { name: "Short, C" }) as HTMLInputElement;
    expect(gap.value).toBe("0");
    await user.clear(gap);
    await user.type(gap, "5{Enter}");
    expect(live<ChartElement>(c).series[0].values).toEqual([4, 0, 5]);
  });

  it("marks a number that cannot be read and puts the old one back when you leave the cell", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    const number = screen.getByRole("textbox", { name: "One, A" }) as HTMLInputElement;
    await user.clear(number);
    await user.type(number, "12x");
    expect(number.getAttribute("aria-invalid")).toBe("true");
    expect(number.title).toMatch(/Enter a number/);
    // "12" was a real number on its way to "12x" and has been stored; the unreadable text is not
    expect(live<ChartElement>(c).series[0].values[0]).toBe(12);
    await user.tab();
    expect(number.value).toBe("12");
    expect(number.getAttribute("aria-invalid")).toBeNull();

    // numbers typed with a comma, and Escape giving the value back
    await user.clear(number);
    await user.type(number, "7,5");
    expect(live<ChartElement>(c).series[0].values[0]).toBe(7.5);
    await user.clear(number);
    await user.type(number, "99");
    await user.keyboard("{Escape}");
    expect(number.value).toBe("99");
  });

  it("adds and removes rows and series, but never the last of each", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    await user.click(button("Add row"));
    await user.click(button("Add series"));
    expect(live<ChartElement>(c).labels).toHaveLength(4);
    expect(live<ChartElement>(c).series).toHaveLength(3);
    expect(live<ChartElement>(c).series[2].values).toHaveLength(4);
    await user.click(button("Remove row 4"));
    await user.click(button("Remove series 3"));
    await user.click(button("Remove series 2"));
    expect(live<ChartElement>(c).series).toHaveLength(1);
    expect(disabled(button("Remove series 1"))).toBe(true);
    await user.click(button("Remove row 1"));
    await user.click(button("Remove row 1"));
    expect(live<ChartElement>(c).labels).toEqual(["C"]);
    expect(disabled(button("Remove row 1"))).toBe(true);
  });

  it("recolours the series and the text", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    expect(screen.getByText("Series colors")).toBeTruthy();
    await pick(user, "Color 2", "aa5500");
    expect(live<ChartElement>(c).palette[1]).toBe("#aa5500");
    await pick(user, "Text color", "00aa55");
    expect(live<ChartElement>(c).textColor).toBe("#00aa55");
  });

  it("shows slice colours and explains the grid for a pie chart", async () => {
    const user = userEvent.setup();
    const c = createChart({
      chart: "pie",
      labels: ["A", "B"],
      series: [
        { name: "One", values: [1, 2] },
        { name: "Two", values: [3, 4] },
      ],
    });
    openElements([c], { selected: [c] });
    openData();
    expect(screen.getByText("Slice colors")).toBeTruthy();
    expect(screen.getByText(/Pie and donut charts show the first series/)).toBeTruthy();
    expect(toggle("Grid (not used by pie and donut)").disabled).toBe(true);
    await pick(user, "Color 1", "ff00ff");
    expect(live<ChartElement>(c).palette[0]).toBe("#ff00ff");
  });

  it("shows and hides the legend, the values and the grid lines", async () => {
    const user = userEvent.setup();
    const c = chart();
    openElements([c], { selected: [c] });
    openData();
    expect(toggle("Legend").checked).toBe(false);
    await user.click(toggle("Legend"));
    expect(live<ChartElement>(c).showLegend).toBe(true);
    await user.click(toggle("Values"));
    expect(live<ChartElement>(c).showValues).toBe(false);
    await user.click(toggle("Grid lines"));
    expect(live<ChartElement>(c).showGrid).toBe(false);
  });
});

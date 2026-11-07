import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import type { ChartElement, TableElement } from "@/core/types";
import { DRAG_MIME } from "@/editor/insert";
import { resetEditor } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";

beforeEach(() => resetEditor());

async function openPage(page: "charts" | "tables", query = "") {
  resetElementsNav(page, query);
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: page === "charts" ? "Search charts" : "Search tables" });
  return user;
}

const CHART_NAMES = ["Column chart", "Bar chart", "Line chart", "Area chart", "Pie chart", "Donut chart"];
const chartLabels = () =>
  screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((l) => CHART_NAMES.includes(l));

describe("Elements > Charts", () => {
  it("lists the six kinds of chart, each with a preview", async () => {
    await openPage("charts");
    expect(screen.getByText("Edit the data after you add one")).toBeTruthy();
    expect(chartLabels()).toEqual(CHART_NAMES);
    for (const name of CHART_NAMES) expect(screen.getByRole("button", { name }).querySelector("svg.cf-chart-preview")).toBeTruthy();
    // a donut is a pie with a hole
    expect(screen.getByRole("button", { name: "Donut chart" }).querySelectorAll("circle")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Pie chart" }).querySelectorAll("circle")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Column chart" }).querySelectorAll("rect")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Area chart" }).querySelectorAll("path").length).toBeGreaterThan(
      screen.getByRole("button", { name: "Line chart" }).querySelectorAll("path").length,
    );
  });

  it("adds a column chart sized for the page and selects it", async () => {
    const user = await openPage("charts");
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Column chart" }));
    const chart = lastElement() as ChartElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(chart.type).toBe("chart");
    expect(chart.chart).toBe("column");
    // 60% of the page width, but no wider than 1.15 times the shorter side
    expect(chart.width).toBe(Math.round(Math.min(1280 * 0.6, 720 * 1.15)));
    expect(chart.height).toBe(Math.round(chart.width * 0.62));
    expect(chart.showGrid).toBe(true);
    expect(chart.showLegend).toBe(false);
    expect(useEditor.getState().selection).toEqual([chart.id]);
  });

  it("adds each other kind of chart", async () => {
    const user = await openPage("charts");
    for (const [name, kind] of [
      ["Bar chart", "bar"],
      ["Line chart", "line"],
      ["Area chart", "area"],
    ] as const) {
      await user.click(screen.getByRole("button", { name }));
      expect((lastElement() as ChartElement).chart).toBe(kind);
    }
  });

  it("makes pies and donuts squarer, with a legend and no grid", async () => {
    const user = await openPage("charts");
    await user.click(screen.getByRole("button", { name: "Pie chart" }));
    const pie = lastElement() as ChartElement;
    expect(pie.chart).toBe("pie");
    expect(pie.height).toBe(Math.round(720 * 0.55));
    expect(pie.width).toBe(Math.round(pie.height * 1.3));
    expect(pie.showLegend).toBe(true);
    expect(pie.showGrid).toBe(false);
    await user.click(screen.getByRole("button", { name: "Donut chart" }));
    expect((lastElement() as ChartElement).chart).toBe("donut");
  });

  it("hands a new chart to the canvas when dragged, even without an open design (sized for 1920 x 1080)", async () => {
    await openPage("charts");
    useEditor.getState().actions.closeDesign();
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Column chart" }), { dataTransfer: dt });
    const chart = JSON.parse(dt.data.get(DRAG_MIME) ?? "null").elements[0] as ChartElement;
    expect(chart.chart).toBe("column");
    expect(chart.width).toBe(Math.round(Math.min(1920 * 0.6, 1080 * 1.15)));

    const pie = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Pie chart" }), { dataTransfer: pie });
    expect(JSON.parse(pie.data.get(DRAG_MIME) ?? "null").elements[0].height).toBe(Math.round(1080 * 0.55));
  });

  it("finds charts by name or by what they are for, and says when there are none", async () => {
    const user = await openPage("charts");
    await user.type(screen.getByRole("searchbox"), "trend");
    expect(chartLabels()).toEqual(["Line chart", "Area chart"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "pie");
    expect(chartLabels()).toEqual(["Pie chart"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No charts found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try "pie", "line" or "bar".')).toBeTruthy();
  });
});

describe("Elements > Tables", () => {
  const cellAt = (rows: number, cols: number) => screen.getByRole("gridcell", { name: `${rows} rows by ${cols} columns` });
  const caption = () => document.querySelector(".cf-tablepick__caption") as HTMLElement;

  it("offers a 5 x 5 grid of sizes with 3 x 3 ready", async () => {
    await openPage("tables");
    expect(screen.getByRole("grid", { name: "Table size" })).toBeTruthy();
    expect(screen.getAllByRole("gridcell")).toHaveLength(25);
    expect(caption().textContent).toBe("3 x 33 rows, 3 columns");
    // only the cell that is ready for the keyboard is in the tab order
    expect(screen.getAllByRole("gridcell").filter((c) => c.getAttribute("tabindex") === "0")).toEqual([cellAt(3, 3)]);
    expect(cellAt(2, 2).classList.contains("is-lit")).toBe(true);
    expect(cellAt(4, 2).classList.contains("is-lit")).toBe(false);
  });

  it("inserts a table of the clicked size, with a header row, sized for the page", async () => {
    const user = await openPage("tables");
    const before = pageElements().length;
    await user.click(cellAt(3, 4));
    const table = lastElement() as TableElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(table.type).toBe("table");
    expect(table.cells).toHaveLength(3);
    expect(table.cells[0]).toEqual(["Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
    expect(table.cells[1]).toEqual(["", "", "", ""]);
    expect(table.headerRow).toBe(true);
    expect(table.colWidths).toHaveLength(4);
    const unit = 720 / 1080;
    expect(table.rowHeights[0]).toBe(Math.round(78 * unit));
    expect(table.height).toBe(Math.round(78 * unit) * 3);
    expect(table.width).toBe(Math.round(Math.min(1280 * 0.72, 4 * 340 * unit)));
    expect(useEditor.getState().selection).toEqual([table.id]);
  });

  it("leaves the header row out when the switch is turned off", async () => {
    const user = await openPage("tables");
    await user.click(screen.getByRole("switch", { name: "Header row" }));
    await user.click(cellAt(2, 2));
    const table = lastElement() as TableElement;
    expect(table.headerRow).toBe(false);
    expect(table.cells).toEqual([
      ["", ""],
      ["", ""],
    ]);
  });

  it("previews the size under the pointer and goes back to the chosen one when it leaves", async () => {
    const user = await openPage("tables");
    await user.hover(cellAt(5, 2));
    expect(caption().textContent).toBe("5 x 25 rows, 2 columns");
    expect(cellAt(5, 2).classList.contains("is-lit")).toBe(true);
    expect(cellAt(5, 3).classList.contains("is-lit")).toBe(false);
    await user.unhover(cellAt(5, 2));
    expect(caption().textContent).toBe("3 x 33 rows, 3 columns");
  });

  it("moves with the arrow keys and stays inside the grid", async () => {
    const user = await openPage("tables");
    cellAt(3, 3).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(3, 4)));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(4, 4)));
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(4, 1)));
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(1, 1)));
    expect(caption().textContent).toBe("1 x 11 rows, 1 columns");
    expect(cellAt(1, 1).getAttribute("tabindex")).toBe("0");
    expect(cellAt(3, 3).getAttribute("tabindex")).toBe("-1");
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(1, 5)));
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(5, 5)));
  });

  it("inserts the focused size with Enter, and other keys do nothing to the focus", async () => {
    const user = await openPage("tables");
    cellAt(3, 3).focus();
    await user.keyboard("a");
    expect(document.activeElement).toBe(cellAt(3, 3));
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(document.activeElement).toBe(cellAt(3, 4)));
    await user.keyboard("{Enter}");
    expect((lastElement() as TableElement).colWidths).toHaveLength(4);
  });

  it("has quick sizes that insert, and carry the header row choice when dragged", async () => {
    const user = await openPage("tables");
    await user.click(screen.getByRole("button", { name: "5 x 4 table" }));
    const table = lastElement() as TableElement;
    expect([table.cells.length, table.cells[0].length]).toEqual([5, 4]);

    await user.click(screen.getByRole("switch", { name: "Header row" }));
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "2 x 2 table" }), { dataTransfer: dt });
    const dragged = JSON.parse(dt.data.get(DRAG_MIME) ?? "null").elements[0] as TableElement;
    expect(dragged.headerRow).toBe(false);
    expect(dragged.cells).toEqual([
      ["", ""],
      ["", ""],
    ]);
  });

  it("marks the header cells of a quick size only while the header row is on", async () => {
    const user = await openPage("tables");
    const glyph = () => within(screen.getByRole("button", { name: "4 x 3 table" })).getByText("", { selector: ".cf-tablequick__glyph" });
    expect(glyph().querySelectorAll(".is-head")).toHaveLength(3);
    await user.click(screen.getByRole("switch", { name: "Header row" }));
    expect(glyph().querySelectorAll(".is-head")).toHaveLength(0);
  });

  it("sizes a table for a 1920 x 1080 page when no design is open", async () => {
    await openPage("tables");
    useEditor.getState().actions.closeDesign();
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "3 x 3 table" }), { dataTransfer: dt });
    const table = JSON.parse(dt.data.get(DRAG_MIME) ?? "null").elements[0] as TableElement;
    expect(table.width).toBe(Math.round(Math.min(1920 * 0.72, 3 * 340)));
    expect(table.rowHeights[0]).toBe(78);
  });

  it("matches a search about tables, and says when it is about something else", async () => {
    const user = await openPage("tables");
    await user.type(screen.getByRole("searchbox"), "spread");
    expect(screen.getByRole("grid", { name: "Table size" })).toBeTruthy();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByText('No tables match "zzzz".')).toBeTruthy();
  });
});

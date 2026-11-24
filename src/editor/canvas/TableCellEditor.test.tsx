/**
 * The box for typing in one cell of a table on the page. It is mounted on its own here, over a design opened in the
 * store, so each test can open a cell directly and check where the box sits, what it shows and where the keys move it.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape, createTable } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import type { TableElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { TableCellEditor } from "./TableCellEditor";
import { useTableCellEditor } from "./tableCellEditing";

const editing = () => useTableCellEditor.getState().editing;
const field = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>("[data-cf-table-editor]");
const tableNow = () => useEditor.getState().design!.pages[0].elements.find((el) => el.id === "tb") as TableElement;

function mount(table: TableElement = createTable({ id: "tb", x: 100, y: 50, width: 600, height: 240 })) {
  const shape = createShape("rect", { id: "box", x: 0, y: 0, width: 50, height: 50 });
  getActions().openDesign(createDesign({ width: 1000, height: 800, pages: [createPage({ elements: [table, shape] })] }));
  return render(<TableCellEditor />);
}

const open = (id: string, row: number, col: number) => act(() => useTableCellEditor.getState().open(id, row, col));

beforeEach(() => {
  resetEditor();
  useTableCellEditor.setState({ editing: null });
});

describe("where the cell box appears and what it shows", () => {
  it("shows nothing until a cell is opened", () => {
    const { container } = mount();
    expect(field(container)).toBeNull();
  });

  it("covers the opened cell at the current zoom, with the cell's text and the table's look", () => {
    const { container } = mount();
    open("tb", 1, 2);
    const box = field(container)!;
    const zoom = useEditor.getState().zoom;
    expect(box.value).toBe("");
    expect(box.getAttribute("aria-label")).toMatch(/2.*3/);
    expect(box.style.left).toBe(`${(100 + 400) * zoom}px`);
    expect(box.style.top).toBe(`${(50 + 80) * zoom}px`);
    expect(box.style.width).toBe(`${200 * zoom}px`);
    expect(box.style.height).toBe(`${80 * zoom}px`);
    // a body row: regular weight and no turn
    expect(box.style.fontWeight).toBe("400");
    expect(box.style.transform).toBe("");
  });

  it("writes the heading cells in bold and keeps their text", () => {
    const { container } = mount();
    open("tb", 0, 1);
    const box = field(container)!;
    expect(box.value).toBe("Heading 2");
    expect(box.style.fontWeight).toBe("700");
  });

  it("turns with a turned table", () => {
    const { container } = mount(createTable({ id: "tb", x: 100, y: 50, width: 600, height: 240, rotation: 30 }));
    open("tb", 1, 1);
    expect(field(container)!.style.transform).toBe("rotate(30deg)");
  });

  it("shows an empty box for a cell whose row has no text stored yet", () => {
    // three rows are drawn, but the cell text only has two of them
    const table = createTable({
      id: "tb",
      cells: [
        ["a", "b", "c"],
        ["d", "e", "f"],
      ],
    });
    const { container } = mount(table);
    open("tb", 2, 0);
    expect(field(container)!.value).toBe("");
  });

  it("shows nothing for an element that is not a table, a table that is gone, or a cell hidden under a merge", () => {
    const { container } = mount(createTable({ id: "tb", merges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }] }));
    open("box", 0, 0);
    expect(field(container)).toBeNull();
    open("missing", 0, 0);
    expect(field(container)).toBeNull();
    open("tb", 1, 1);
    expect(field(container)).toBeNull();
    open("tb", 0, 0);
    expect(field(container)).not.toBeNull();
  });
});

describe("typing and moving between cells", () => {
  it("puts what is typed into the cell of the table", () => {
    const { container } = mount();
    open("tb", 2, 1);
    fireEvent.change(field(container)!, { target: { value: "Typed" } });
    expect(tableNow().cells[2][1]).toBe("Typed");
  });

  it("goes back one cell with Shift and Tab, wrapping to the end of the row above", () => {
    const { container } = mount();
    open("tb", 1, 0);
    fireEvent.keyDown(field(container)!, { key: "Tab", shiftKey: true });
    expect(editing()).toEqual({ id: "tb", row: 0, col: 2 });
  });

  it("closes when Tab is pressed in the last cell, and when Shift and Tab are pressed in the first", () => {
    const { container } = mount();
    open("tb", 2, 2);
    fireEvent.keyDown(field(container)!, { key: "Tab" });
    expect(editing()).toBeNull();
    open("tb", 0, 0);
    fireEvent.keyDown(field(container)!, { key: "Tab", shiftKey: true });
    expect(editing()).toBeNull();
  });

  it("skips the cells hidden under a merge when tabbing", () => {
    const { container } = mount(createTable({ id: "tb", merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }] }));
    open("tb", 0, 0);
    fireEvent.keyDown(field(container)!, { key: "Tab" });
    expect(editing()).toEqual({ id: "tb", row: 0, col: 2 });
  });

  it.each([
    ["Ctrl and Enter", { key: "Enter", ctrlKey: true }],
    ["Cmd and Enter", { key: "Enter", metaKey: true }],
  ])("closes with %s", (_name, keys) => {
    const { container } = mount();
    open("tb", 1, 1);
    fireEvent.keyDown(field(container)!, keys);
    expect(editing()).toBeNull();
  });

  it("keeps the box open for a plain Enter, which starts a new line in the cell, and for other keys", () => {
    const { container } = mount();
    open("tb", 1, 1);
    const enter = fireEvent.keyDown(field(container)!, { key: "Enter" });
    fireEvent.keyDown(field(container)!, { key: "a" });
    expect(enter).toBe(true);
    expect(editing()).toEqual({ id: "tb", row: 1, col: 1 });
  });

  it("stops Escape from reaching the rest of the editor, so only the cell box closes", () => {
    const { container } = mount();
    open("tb", 1, 1);
    let reached = false;
    const listener = () => (reached = true);
    document.addEventListener("keydown", listener);
    const notCancelled = fireEvent.keyDown(field(container)!, { key: "Escape" });
    document.removeEventListener("keydown", listener);
    expect(notCancelled).toBe(false);
    expect(reached).toBe(false);
    expect(editing()).toBeNull();
  });

  it("closes when it loses the focus", () => {
    const { container } = mount();
    open("tb", 1, 1);
    fireEvent.blur(field(container)!);
    expect(editing()).toBeNull();
  });
});

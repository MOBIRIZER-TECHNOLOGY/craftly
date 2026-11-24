import { useEffect, useRef } from "react";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import { tableCellStyle, tableLayout } from "@/core/tableCells";
import { cssFontFamily } from "@/render/fonts";
import { m } from "@/i18n";
import { worldBox } from "./frame";
import { useTableCellEditor } from "./tableCellEditing";

export function TableCellEditor() {
  const editing = useTableCellEditor((s) => s.editing);
  const page = useEditor((s) => getActivePage(s));
  const zoom = useEditor((s) => s.zoom);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing?.id, editing?.row, editing?.col]);
  if (!editing || !page) return null;
  const table = findElement(page, editing.id);
  const cell = table?.type === "table" ? tableLayout(table).find((box) => box.row === editing.row && box.col === editing.col) : null;
  const frame = table ? worldBox(page, table.id) : null;
  if (!table || table.type !== "table" || !cell || !frame) return null;
  const style = tableCellStyle(table, cell);
  const cells = tableLayout(table);
  const index = cells.findIndex((box) => box.row === cell.row && box.col === cell.col);
  const close = () => useTableCellEditor.getState().close();
  const move = (direction: number) => {
    const next = cells[index + direction];
    if (next) useTableCellEditor.getState().open(table.id, next.row, next.col);
    else close();
  };
  return (
    <textarea
      key={`${table.id}:${cell.row}:${cell.col}`}
      className="cf-tablecell-editor"
      data-cf-table-editor
      aria-label={m.panelsContext.table.cell(cell.row + 1, cell.col + 1)}
      value={table.cells[cell.row]?.[cell.col] ?? ""}
      ref={inputRef}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={close}
      onChange={(event) =>
        getActions().updateElements(
          [table.id],
          (el) => {
            if (el.type === "table") el.cells[cell.row][cell.col] = event.target.value;
          },
          { coalesce: `table-cell:${table.id}:${cell.row}:${cell.col}` },
        )
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === "Tab") {
          event.preventDefault();
          move(event.shiftKey ? -1 : 1);
        }
      }}
      style={{
        left: (frame.x + cell.x) * zoom,
        top: (frame.y + cell.y) * zoom,
        width: cell.width * zoom,
        height: cell.height * zoom,
        transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
        background: style.fill,
        color: style.color,
        fontFamily: cssFontFamily(table.fontFamily),
        fontSize: table.fontSize * zoom,
        fontWeight: style.bold ? 700 : 400,
        textAlign: style.align,
      }}
    />
  );
}

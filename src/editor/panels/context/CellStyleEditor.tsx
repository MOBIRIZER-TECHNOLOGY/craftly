import { useEffect, useState } from "react";
import { getActions } from "@/core/store";
import { mergeTableCells, tableCellKey, tableCellStyle, tableLayout, unmergeTableCells } from "@/core/tableCells";
import type { TableCell, TableCellStyle, TableElement, TextAlign } from "@/core/types";
import { m } from "@/i18n";
import { Button, IconAlignCenter, IconAlignLeft, IconAlignRight, NumberField, Segmented, Switch } from "@/ui";
import { ColorRow } from "./DataControls";
import { Section } from "./PanelShell";

const ALIGN_OPTIONS = [
  { value: "left", icon: <IconAlignLeft />, title: `${m.panelsContext.table.cellText}: ${m.panelsContext.table.align.left}` },
  { value: "center", icon: <IconAlignCenter />, title: `${m.panelsContext.table.cellText}: ${m.panelsContext.table.align.center}` },
  { value: "right", icon: <IconAlignRight />, title: `${m.panelsContext.table.cellText}: ${m.panelsContext.table.align.right}` },
];

export function CellStyleEditor({ table, cell }: { table: TableElement; cell: TableCell }) {
  const root = tableLayout(table).find((box) => cell.row >= box.row && cell.row < box.row + box.rowSpan && cell.col >= box.col && cell.col < box.col + box.colSpan);
  const [span, setSpan] = useState({ rowSpan: 1, colSpan: 1 });
  const key = root ? tableCellKey(root) : "";
  useEffect(() => {
    setSpan({ rowSpan: root?.rowSpan ?? 1, colSpan: root?.colSpan ?? 1 });
  }, [key, table.id, root?.rowSpan, root?.colSpan]);
  if (!root) return null;
  const style = tableCellStyle(table, root);
  const merged = table.merges?.some((merge) => merge.row === root.row && merge.col === root.col);
  const edit = (fn: (table: TableElement) => void) => getActions().updateElements([table.id], (el) => void (el.type === "table" && fn(el)));
  const setStyle = (patch: TableCellStyle) =>
    edit((t) => {
      t.cellStyles = { ...t.cellStyles, [key]: { ...t.cellStyles?.[key], ...patch } };
    });
  return (
    <Section title={`${m.panelsContext.table.selectedCell} ${root.row + 1}:${root.col + 1}`}>
      <div className="cf-ctx__rows">
        <ColorRow label={m.panelsContext.table.cellFill} value={style.fill} onChange={(fill) => setStyle({ fill })} />
        <ColorRow label={m.panelsContext.table.cellText} value={style.color} onChange={(color) => setStyle({ color })} />
        <Switch label={m.panelsContext.table.cellBold} checked={style.bold} onChange={(bold) => setStyle({ bold })} />
        <Segmented
          aria-label={m.panelsContext.table.textAlignment}
          size="sm"
          value={style.align}
          options={ALIGN_OPTIONS}
          onChange={(align) => setStyle({ align: align as TextAlign })}
        />
        <div className="cf-data__inline">
          <NumberField
            label={m.panelsContext.table.rowSpan}
            value={span.rowSpan}
            min={1}
            max={table.rowHeights.length - root.row}
            onChange={(rowSpan) => setSpan((current) => ({ ...current, rowSpan }))}
          />
          <NumberField
            label={m.panelsContext.table.colSpan}
            value={span.colSpan}
            min={1}
            max={table.colWidths.length - root.col}
            onChange={(colSpan) => setSpan((current) => ({ ...current, colSpan }))}
          />
        </div>
        <Button variant="secondary" block disabled={span.rowSpan === 1 && span.colSpan === 1} onClick={() => edit((t) => mergeTableCells(t, root, span.rowSpan, span.colSpan))}>
          {m.panelsContext.table.mergeArea}
        </Button>
        {merged ? (
          <Button variant="ghost" block onClick={() => edit((t) => unmergeTableCells(t, root))}>
            {m.panelsContext.table.unmerge}
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

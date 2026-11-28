import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getActions } from "@/core/store";
import type { TableElement, TextAlign } from "@/core/types";
import { m } from "@/i18n";
import { cx, IconAlignCenter, IconAlignLeft, IconAlignRight, IconButton, IconClose, IconPlus, NumberField, Button, Segmented, Switch } from "@/ui";
import { addTableColumn, addTableRow, removeTableColumn, removeTableRow, tableSize } from "./dataEdit";
import { ColorRow, TextCell } from "./DataControls";
import { CellStyleEditor } from "./CellStyleEditor";
import { importTableData, pasteIntoTableCell, tellImport } from "./dataImport";
import { ImportData } from "./ImportData";
import { Section } from "./PanelShell";
import { useBatch } from "./useBatch";

const ALIGN_OPTIONS = [
  { value: "left", icon: <IconAlignLeft />, title: m.panelsContext.table.align.left },
  { value: "center", icon: <IconAlignCenter />, title: m.panelsContext.table.align.center },
  { value: "right", icon: <IconAlignRight />, title: m.panelsContext.table.align.right },
];

const DEFAULT_STRIPE = "#f3f0ff";

export function TableEditor({ table, focusCell }: { table: TableElement; focusCell?: { row: number; col: number } }) {
  const batch = useBatch();
  const { rows, cols } = tableSize(table);
  const grid = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(focusCell ?? { row: 0, col: 0 });

  // Opened for one cell (a double click on the table): the keyboard goes into its field, so that what is typed next is the cell's
  // text and not a shortcut of the canvas. Asked again for the same cell, a new object arrives and the effect runs again.
  useEffect(() => {
    if (!focusCell) return;
    setSelected(focusCell);
    const field = grid.current?.querySelector<HTMLInputElement>(`[data-cf-cell="${focusCell.row}:${focusCell.col}"]`);
    field?.focus();
    field?.select();
  }, [focusCell, table.id]);

  /** one store write per call; typing in cells merges into one undo step per burst */
  const edit = (fn: (t: TableElement) => void, coalesce?: string) =>
    getActions().updateElements(
      [table.id],
      (el) => {
        if (el.type === "table") fn(el);
      },
      coalesce ? { coalesce } : undefined,
    );

  const setProp = <K extends keyof TableElement>(key: K, value: TableElement[K]) => batch.run(() => edit((t) => void (t[key] = value)));
  const gridStyle = { "--cf-cols": cols } as CSSProperties;

  return (
    <div className="cf-data">
      <Section title={m.panelsContext.table.cells}>
        <div className="cf-data__scroll">
          <div className="cf-data__grid" style={gridStyle} ref={grid}>
            {/* column remove buttons */}
            {Array.from({ length: cols }, (_, c) => (
              <span key={`rm${c}`} className="cf-data__colhead">
                <IconButton
                  size="sm"
                  label={m.panelsContext.table.removeColumn(c + 1)}
                  icon={<IconClose />}
                  disabled={cols <= 1}
                  onClick={() => edit((t) => removeTableColumn(t, c))}
                />
              </span>
            ))}
            <span />
            {table.cells.map((row, r) => (
              <TableRow
                key={r}
                row={row}
                r={r}
                header={table.headerRow && r === 0}
                removable={rows > 1}
                onText={(c, value) => edit((t) => void (t.cells[r][c] = value), `cell:${table.id}`)}
                onPaste={(c, text) => {
                  // a block of cells from a spreadsheet goes into the cells from this one on; other text is the field's own
                  const result = pasteIntoTableCell(table.id, { row: r, col: c }, text);
                  if (result) tellImport(result);
                  return !!result;
                }}
                onRemove={() => edit((t) => removeTableRow(t, r))}
                onSelect={(c) => setSelected({ row: r, col: c })}
              />
            ))}
          </div>
        </div>
        <div className="cf-data__actions">
          <Button block variant="secondary" icon={<IconPlus />} onClick={() => edit((t) => addTableRow(t))}>
            {m.panelsContext.shared.addRow}
          </Button>
          <Button block variant="secondary" icon={<IconPlus />} onClick={() => edit((t) => addTableColumn(t))}>
            {m.panelsContext.table.addColumn}
          </Button>
        </div>
      </Section>

      <CellStyleEditor table={table} cell={selected} />

      <ImportData hint={m.panelsContext.table.importHint} onImport={(text) => importTableData(table.id, text)} />

      <Section title={m.panelsContext.table.layout}>
        <div className="cf-ctx__rows">
          <Switch label={m.panelsContext.table.headerRow} checked={table.headerRow} onChange={(on) => edit((t) => void (t.headerRow = on))} />
          <div className="cf-data__inline">
            <span className="cf-data__colorlabel">{m.panelsContext.table.fontSize}</span>
            <NumberField
              aria-label={m.panelsContext.table.fontSize}
              value={table.fontSize}
              min={6}
              max={200}
              step={1}
              suffix="px"
              width={104}
              onChange={(v) => setProp("fontSize", v)}
              onCommit={() => batch.end()}
            />
          </div>
          <div className="cf-data__inline">
            <span className="cf-data__colorlabel">{m.panelsContext.table.alignment}</span>
            <Segmented
              aria-label={m.panelsContext.table.textAlignment}
              size="sm"
              value={table.align}
              options={ALIGN_OPTIONS}
              onChange={(v) => edit((t) => void (t.align = v as TextAlign))}
            />
          </div>
        </div>
      </Section>

      <Section title={m.panelsContext.table.colors}>
        <div className="cf-ctx__rows">
          <ColorRow label={m.panelsContext.table.headerFill} value={table.headerFill} onChange={(c) => edit((t) => void (t.headerFill = c))} />
          <ColorRow label={m.panelsContext.table.headerText} value={table.headerColor} onChange={(c) => edit((t) => void (t.headerColor = c))} />
          <ColorRow label={m.panelsContext.table.text} value={table.color} onChange={(c) => edit((t) => void (t.color = c))} />
          <div className={cx("cf-data__stripe", !table.stripeFill && "is-off")}>
            <ColorRow label={m.panelsContext.table.rowStripes} value={table.stripeFill ?? DEFAULT_STRIPE} onChange={(c) => edit((t) => void (t.stripeFill = c))}>
              <Switch aria-label={m.panelsContext.table.rowStripes} checked={!!table.stripeFill} onChange={(on) => edit((t) => void (t.stripeFill = on ? DEFAULT_STRIPE : null))} />
            </ColorRow>
          </div>
          <ColorRow label={m.panelsContext.table.border} value={table.borderColor} onChange={(c) => edit((t) => void (t.borderColor = c))}>
            <NumberField
              aria-label={m.panelsContext.table.borderWidth}
              value={table.borderWidth}
              min={0}
              max={24}
              step={1}
              suffix="px"
              width={84}
              onChange={(v) => setProp("borderWidth", v)}
              onCommit={() => batch.end()}
            />
          </ColorRow>
        </div>
      </Section>
    </div>
  );
}

function TableRow({
  row,
  r,
  header,
  removable,
  onText,
  onPaste,
  onRemove,
  onSelect,
}: {
  row: string[];
  r: number;
  header: boolean;
  removable: boolean;
  onText: (c: number, value: string) => void;
  onPaste: (c: number, text: string) => boolean;
  onRemove: () => void;
  onSelect: (c: number) => void;
}) {
  return (
    <>
      {row.map((cell, c) => (
        <TextCell
          key={c}
          className={header ? "is-header" : undefined}
          value={cell}
          label={m.panelsContext.table.cell(r + 1, c + 1)}
          cellKey={`${r}:${c}`}
          onText={(value) => onText(c, value)}
          onPasteText={(text) => onPaste(c, text)}
          onSelect={() => onSelect(c)}
        />
      ))}
      <IconButton size="sm" label={m.panelsContext.shared.removeRow(r + 1)} icon={<IconClose />} disabled={!removable} onClick={onRemove} />
    </>
  );
}

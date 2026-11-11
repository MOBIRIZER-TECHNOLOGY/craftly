import { useEffect, useRef, type CSSProperties } from "react";
import { getActions } from "@/core/store";
import type { TableElement, TextAlign } from "@/core/types";
import { cx, IconAlignCenter, IconAlignLeft, IconAlignRight, IconButton, IconClose, IconPlus, NumberField, Button, Segmented, Switch } from "@/ui";
import { addTableColumn, addTableRow, removeTableColumn, removeTableRow, tableSize } from "./dataEdit";
import { ColorRow, TextCell } from "./DataControls";
import { Section } from "./PanelShell";
import { useBatch } from "./useBatch";

const ALIGN_OPTIONS = [
  { value: "left", icon: <IconAlignLeft />, title: "Align left" },
  { value: "center", icon: <IconAlignCenter />, title: "Align center" },
  { value: "right", icon: <IconAlignRight />, title: "Align right" },
];

const DEFAULT_STRIPE = "#f3f0ff";

export function TableEditor({ table, focusCell }: { table: TableElement; focusCell?: { row: number; col: number } }) {
  const batch = useBatch();
  const { rows, cols } = tableSize(table);
  const grid = useRef<HTMLDivElement>(null);

  // Opened for one cell (a double click on the table): the keyboard goes into its field, so that what is typed next is the cell's
  // text and not a shortcut of the canvas. Asked again for the same cell, a new object arrives and the effect runs again.
  useEffect(() => {
    if (!focusCell) return;
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
      <Section title="Cells">
        <div className="cf-data__scroll">
          <div className="cf-data__grid" style={gridStyle} ref={grid}>
            {/* column remove buttons */}
            {Array.from({ length: cols }, (_, c) => (
              <span key={`rm${c}`} className="cf-data__colhead">
                <IconButton size="sm" label={`Remove column ${c + 1}`} icon={<IconClose />} disabled={cols <= 1} onClick={() => edit((t) => removeTableColumn(t, c))} />
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
                onRemove={() => edit((t) => removeTableRow(t, r))}
              />
            ))}
          </div>
        </div>
        <div className="cf-data__actions">
          <Button block variant="secondary" icon={<IconPlus />} onClick={() => edit((t) => addTableRow(t))}>
            Add row
          </Button>
          <Button block variant="secondary" icon={<IconPlus />} onClick={() => edit((t) => addTableColumn(t))}>
            Add column
          </Button>
        </div>
      </Section>

      <Section title="Layout">
        <div className="cf-ctx__rows">
          <Switch label="Header row" checked={table.headerRow} onChange={(on) => edit((t) => void (t.headerRow = on))} />
          <div className="cf-data__inline">
            <span className="cf-data__colorlabel">Font size</span>
            <NumberField
              aria-label="Font size"
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
            <span className="cf-data__colorlabel">Alignment</span>
            <Segmented aria-label="Text alignment" size="sm" value={table.align} options={ALIGN_OPTIONS} onChange={(v) => edit((t) => void (t.align = v as TextAlign))} />
          </div>
        </div>
      </Section>

      <Section title="Colors">
        <div className="cf-ctx__rows">
          <ColorRow label="Header fill" value={table.headerFill} onChange={(c) => edit((t) => void (t.headerFill = c))} />
          <ColorRow label="Header text" value={table.headerColor} onChange={(c) => edit((t) => void (t.headerColor = c))} />
          <ColorRow label="Text" value={table.color} onChange={(c) => edit((t) => void (t.color = c))} />
          <div className={cx("cf-data__stripe", !table.stripeFill && "is-off")}>
            <ColorRow label="Row stripes" value={table.stripeFill ?? DEFAULT_STRIPE} onChange={(c) => edit((t) => void (t.stripeFill = c))}>
              <Switch aria-label="Row stripes" checked={!!table.stripeFill} onChange={(on) => edit((t) => void (t.stripeFill = on ? DEFAULT_STRIPE : null))} />
            </ColorRow>
          </div>
          <ColorRow label="Border" value={table.borderColor} onChange={(c) => edit((t) => void (t.borderColor = c))}>
            <NumberField
              aria-label="Border width"
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
  onRemove,
}: {
  row: string[];
  r: number;
  header: boolean;
  removable: boolean;
  onText: (c: number, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <>
      {row.map((cell, c) => (
        <TextCell
          key={c}
          className={header ? "is-header" : undefined}
          value={cell}
          label={`Row ${r + 1}, column ${c + 1}`}
          cellKey={`${r}:${c}`}
          onText={(value) => onText(c, value)}
        />
      ))}
      <IconButton size="sm" label={`Remove row ${r + 1}`} icon={<IconClose />} disabled={!removable} onClick={onRemove} />
    </>
  );
}

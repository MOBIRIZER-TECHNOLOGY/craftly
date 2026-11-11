import { useRef, useState, type KeyboardEvent } from "react";
import { createTable } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { IconTable, Switch, cx } from "@/ui";
import { PanelSection, Panel, PanelScroll } from "../../shared/PanelLayout";
import { DraggableItem } from "../../shared/DraggableItem";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./DataPages.css";

const MIN = 1;
const MAX = 5;
const SIZES = Array.from({ length: MAX - MIN + 1 }, (_, i) => i + MIN);

/** A table with the picked number of rows and columns, sized for the open page. */
function buildTable(rows: number, cols: number, headerRow: boolean) {
  const design = useEditor.getState().design;
  const dw = design?.width ?? 1920;
  const dh = design?.height ?? 1080;
  const unit = Math.min(dw, dh) / 1080;
  const fontSize = Math.round(26 * unit);
  const rowH = Math.round(78 * unit);
  const width = Math.round(Math.min(dw * 0.72, cols * 340 * unit));
  const colW = width / cols;
  return createTable({
    cells: Array.from({ length: rows }, (_r, r) => Array.from({ length: cols }, (_c, c) => (headerRow && r === 0 ? `Heading ${c + 1}` : ""))),
    colWidths: Array(cols).fill(colW),
    rowHeights: Array(rows).fill(rowH),
    width,
    height: rowH * rows,
    headerRow,
    fontSize,
    borderWidth: Math.max(1, Math.round(2 * unit)),
  });
}

export function TablesPage() {
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const [focus, setFocus] = useState({ rows: 3, cols: 3 });
  const [headerRow, setHeaderRow] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const query = useElementsNav((s) => s.query);
  const shown = hover ?? focus;
  const q = query.trim().toLowerCase();
  const matches = !q || "table grid rows columns spreadsheet".includes(q);

  const insert = (rows: number, cols: number) => void getActions().addElement(buildTable(rows, cols, headerRow));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    const next = { rows: Math.min(MAX, Math.max(MIN, focus.rows + d[0])), cols: Math.min(MAX, Math.max(MIN, focus.cols + d[1])) };
    setFocus(next);
    setHover(null);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-rows="${next.rows}"][data-cols="${next.cols}"]`)?.focus());
  };

  return (
    <Panel>
      <SubPageTop title="Tables" placeholder="Search tables" />
      <PanelScroll>
        {matches ? (
          <>
            <PanelSection title="Choose a size">
              <div className="cf-tablepick">
                {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the cells are the focusable parts; the arrow keys move between them */}
                <div ref={gridRef} className="cf-tablepick__grid" role="grid" aria-label="Table size" onKeyDown={onKeyDown} onPointerLeave={() => setHover(null)}>
                  {SIZES.map((rows) => (
                    <div key={rows} role="row" className="cf-tablepick__row">
                      {SIZES.map((cols) => {
                        const lit = rows <= shown.rows && cols <= shown.cols;
                        return (
                          <button
                            key={cols}
                            type="button"
                            role="gridcell"
                            data-rows={rows}
                            data-cols={cols}
                            tabIndex={rows === focus.rows && cols === focus.cols ? 0 : -1}
                            aria-label={`${rows} ${rows === 1 ? "row" : "rows"} by ${cols} ${cols === 1 ? "column" : "columns"}`}
                            className={cx("cf-tablepick__cell", lit && "is-lit")}
                            onPointerEnter={() => setHover({ rows, cols })}
                            onFocus={() => setFocus({ rows, cols })}
                            onClick={() => insert(rows, cols)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className="cf-tablepick__caption" aria-live="polite">
                  <strong>
                    {shown.rows} x {shown.cols}
                  </strong>
                  <span>
                    {shown.rows} {shown.rows === 1 ? "row" : "rows"}, {shown.cols} {shown.cols === 1 ? "column" : "columns"}
                  </span>
                </p>
              </div>
              <Switch checked={headerRow} onChange={setHeaderRow} label="Header row" />
            </PanelSection>
            <PanelSection title="Quick add">
              <div className="cf-tablequick">
                {[
                  { rows: 2, cols: 2, name: "2 x 2" },
                  { rows: 3, cols: 3, name: "3 x 3" },
                  { rows: 4, cols: 3, name: "4 x 3" },
                  { rows: 5, cols: 4, name: "5 x 4" },
                ].map((s) => (
                  <DraggableItem
                    key={s.name}
                    label={`${s.name} table`}
                    onInsert={() => insert(s.rows, s.cols)}
                    getPayload={() => ({ type: "elements", elements: [buildTable(s.rows, s.cols, headerRow)] })}
                    className="cf-cell cf-tablequick__item"
                  >
                    <span className="cf-tablequick__glyph" style={{ gridTemplateColumns: `repeat(${s.cols}, 1fr)` }} aria-hidden="true">
                      {Array.from({ length: s.rows * s.cols }, (_, i) => (
                        <i key={i} className={i < s.cols && headerRow ? "is-head" : undefined} />
                      ))}
                    </span>
                    <span>{s.name}</span>
                  </DraggableItem>
                ))}
              </div>
            </PanelSection>
          </>
        ) : (
          <div className="cf-tablepick__none">
            <IconTable aria-hidden="true" />
            <p>No tables match "{query.trim()}".</p>
          </div>
        )}
      </PanelScroll>
    </Panel>
  );
}

import { useSelectedElements } from "@/core/store";
import { m } from "@/i18n";
import { IconTable } from "@/ui";
import { ChartEditor } from "./ChartEditor";
import { PanelEmpty, PanelShell } from "./PanelShell";
import { TableEditor } from "./TableEditor";
import "./DataPanel.css";

/**
 * Data: the cells of a selected table, or the type, numbers and colours of a selected chart. `cell` is the cell of the table that
 * the panel was opened for (a double click on the table): its field gets the keyboard.
 */
export function DataPanel({ cell }: { cell?: { row: number; col: number } }) {
  const els = useSelectedElements();
  // the first table or chart of the selection
  const subject = els.find((e) => e.type === "table" || e.type === "chart");

  if (subject?.type === "table") {
    return (
      <PanelShell title={m.panelsContext.dataPanel.table}>
        <TableEditor table={subject} focusCell={cell} />
      </PanelShell>
    );
  }
  if (subject?.type === "chart") {
    return (
      <PanelShell title={m.panelsContext.dataPanel.chart}>
        <ChartEditor chart={subject} />
      </PanelShell>
    );
  }
  return (
    <PanelShell title={m.panelsContext.dataPanel.data}>
      <PanelEmpty icon={<IconTable />} title={m.panelsContext.dataPanel.emptyTitle} text={m.panelsContext.dataPanel.emptyText} />
    </PanelShell>
  );
}

import { useSelectedElements } from "@/core/store";
import { IconTable } from "@/ui";
import { ChartEditor } from "./ChartEditor";
import { PanelEmpty, PanelShell } from "./PanelShell";
import { TableEditor } from "./TableEditor";
import "./DataPanel.css";

/** Data: the cells of a selected table, or the type, numbers and colours of a selected chart. */
export function DataPanel() {
  const els = useSelectedElements();
  // the first table or chart of the selection
  const subject = els.find((e) => e.type === "table" || e.type === "chart");

  if (subject?.type === "table") {
    return (
      <PanelShell title="Table">
        <TableEditor table={subject} />
      </PanelShell>
    );
  }
  if (subject?.type === "chart") {
    return (
      <PanelShell title="Chart">
        <ChartEditor chart={subject} />
      </PanelShell>
    );
  }
  return (
    <PanelShell title="Data">
      <PanelEmpty icon={<IconTable />} title="No table or chart selected" text="Select a table or a chart on the page to edit its cells, numbers and colors here." />
    </PanelShell>
  );
}

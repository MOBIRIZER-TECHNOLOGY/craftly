import { getActions } from "@/core/store";
import { Tabs } from "@/ui";
import { ArrangeTab } from "./ArrangeTab";
import { LayersTab } from "./LayersTab";
import { PanelShell } from "./PanelShell";

const TABS = [
  { id: "arrange", label: "Arrange" },
  { id: "layers", label: "Layers" },
];

/** Position: Arrange (z-order, align, size and position) and Layers (the page's element list). */
export function PositionPanel({ tab }: { tab: "arrange" | "layers" }) {
  return (
    <PanelShell
      title="Position"
      tabs={
        <Tabs
          value={tab}
          tabs={TABS}
          fullWidth
          aria-label="Position sections"
          idBase="cf-position"
          onChange={(id) => getActions().openContext({ kind: "position", tab: id === "layers" ? "layers" : "arrange" })}
        />
      }
    >
      <div id={`cf-position-panel-${tab}`} role="tabpanel" aria-labelledby={`cf-position-tab-${tab}`}>
        {tab === "arrange" ? <ArrangeTab /> : <LayersTab />}
      </div>
    </PanelShell>
  );
}

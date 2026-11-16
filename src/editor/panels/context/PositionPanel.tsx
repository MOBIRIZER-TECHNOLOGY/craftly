import { getActions } from "@/core/store";
import { m } from "@/i18n";
import { Tabs } from "@/ui";
import { ArrangeTab } from "./ArrangeTab";
import { LayersTab } from "./LayersTab";
import { PanelShell } from "./PanelShell";

const TABS = [
  { id: "arrange", label: m.panelsContext.position.tabs.arrange },
  { id: "layers", label: m.panelsContext.position.tabs.layers },
];

/** Position: Arrange (z-order, align, size and position) and Layers (the page's element list). */
export function PositionPanel({ tab }: { tab: "arrange" | "layers" }) {
  return (
    <PanelShell
      title={m.panelsContext.position.title}
      tabs={
        <Tabs
          value={tab}
          tabs={TABS}
          fullWidth
          aria-label={m.panelsContext.position.sections}
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

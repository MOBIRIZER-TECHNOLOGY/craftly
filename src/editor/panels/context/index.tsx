import type { ContextPanelState } from "@/core/store";
import { AnimatePanel } from "./AnimatePanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { ColorPanel } from "./ColorPanel";
import { DataPanel } from "./DataPanel";
import { EffectsPanel } from "./EffectsPanel";
import { FiltersPanel } from "./FiltersPanel";
import { FontPanel } from "./FontPanel";
import { PositionPanel } from "./PositionPanel";

/**
 * The context panels that replace the left side panel: Position, Effects, Colour, Font, Filters,
 * Background, Data and Animate. Each one acts on the current selection through store actions.
 */
export function ContextPanel({ state }: { state: ContextPanelState }) {
  switch (state.kind) {
    case "position":
      return <PositionPanel tab={state.tab} />;
    case "effects":
      return <EffectsPanel />;
    case "color":
      return <ColorPanel target={state.target} colorKey={state.key} />;
    case "font":
      return <FontPanel />;
    case "filters":
      return <FiltersPanel tab={state.tab} />;
    case "background":
      return <BackgroundPanel />;
    case "data":
      return <DataPanel cell={state.cell} />;
    case "animate":
      return <AnimatePanel tab={state.tab} />;
  }
}

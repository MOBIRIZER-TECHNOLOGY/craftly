/**
 * Tiny helpers around the left rail's "Tools" behaviour. Tools has no side panel: while it is the active tab
 * (`leftTab === "tools"`) the floating tool palette is shown and the side panel is collapsed. Closing the
 * palette returns to the tab that was open before.
 */
import { getActions, useEditor, type LeftTab } from "@/core/store";

let previous: LeftTab = useEditor.getState().leftTab === "tools" ? "elements" : useEditor.getState().leftTab;

useEditor.subscribe((s) => {
  if (s.leftTab !== "tools") previous = s.leftTab;
});

/** The last side-panel tab that was open (never "tools"). */
export const previousPanelTab = (): LeftTab => previous;

export const isToolsOpen = (): boolean => useEditor.getState().leftTab === "tools";

export function openToolsPalette(): void {
  getActions().setLeftTab("tools");
}

export function closeToolsPalette(): void {
  const s = useEditor.getState();
  if (s.leftTab !== "tools") return;
  s.actions.setLeftTab(previous);
}

export function toggleToolsPalette(): void {
  if (isToolsOpen()) closeToolsPalette();
  else openToolsPalette();
}

/**
 * Point editing of a path: which path element is open for it and which of its points are selected. Like the crop mode of an
 * image it is a state of the editor, not of the document; the overlay (PathEditOverlay.tsx) leaves it again as soon as the
 * element is no longer the one thing selected, is no longer a path that can be edited, or a tool is picked up.
 */
import { create } from "zustand";
import { getActions } from "@/core/store";
import type { ID } from "@/core/types";

interface PathEditStore {
  /** the path element whose points are edited, or null */
  id: ID | null;
  /** indices of the selected points of that path */
  selected: number[];
}

export const usePathEdit = create<PathEditStore>()(() => ({ id: null, selected: [] }));

/** Opens a path element for point editing (and selects it, with the Select tool). */
export function startPathEdit(id: ID): void {
  const actions = getActions();
  actions.setTool("select");
  actions.select([id]);
  usePathEdit.setState({ id, selected: [] });
}

export function stopPathEdit(): void {
  if (usePathEdit.getState().id !== null) usePathEdit.setState({ id: null, selected: [] });
}

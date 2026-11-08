/**
 * Point editing of a path: which path element is open for it and which of its points are selected. Like the crop mode of an
 * image it is a state of the editor, not of the document; the overlay (PathEditOverlay.tsx) leaves it again as soon as the
 * element is no longer the one thing selected, is no longer a path that can be edited, is locked, or a tool is picked up.
 */
import { create } from "zustand";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { ID } from "@/core/types";

interface PathEditStore {
  /** the path element whose points are edited, or null */
  id: ID | null;
  /** indices of the selected points of that path */
  selected: number[];
}

export const usePathEdit = create<PathEditStore>()(() => ({ id: null, selected: [] }));

/** Opens a path element of the page for point editing (and selects it, with the Select tool). A locked path is not opened. */
export function startPathEdit(id: ID): void {
  const page = getActivePage(useEditor.getState());
  const el = page ? findElement(page, id) : null;
  if (!el || el.locked) return;
  const actions = getActions();
  actions.setTool("select");
  actions.select([id]);
  usePathEdit.setState({ id, selected: [] });
}

export function stopPathEdit(): void {
  if (usePathEdit.getState().id !== null) usePathEdit.setState({ id: null, selected: [] });
}

/**
 * On a phone the side panel is a sheet over the page. Something added from it (a text, a shape, a photo) lands on the page under
 * the sheet, where the person cannot see what they just made: the sheet is folded away when that happens.
 */
import { getActivePage, useEditor, type EditorState } from "@/core/store";
import type { Page } from "@/core/types";

/** The width below which the side panel is a sheet over the page (the same as in Editor.tsx and the style sheets). */
export const SHEET_QUERY = "(max-width: 899px)";

// (a damaged design may have a page without elements: this looks on while the editor stops for it, and must not add an error of its own)
const idsOnPage = (s: EditorState): Set<string> => new Set((getActivePage(s)?.elements as Page["elements"] | null | undefined)?.map((el) => el.id));

/**
 * Was something put on the open page by this person between two states? It is new on the same page of the same design, and it is
 * what is selected now: what other people add in a shared design is not selected, and neither is what an undo brings back.
 */
export function insertedByThisPerson(now: EditorState, before: EditorState): boolean {
  if (!now.design || !before.design || now.design.id !== before.design.id || now.activePageId !== before.activePageId) return false;
  if (!now.selection.length) return false;
  const had = idsOnPage(before);
  const has = idsOnPage(now);
  return now.selection.every((id) => has.has(id) && !had.has(id));
}

/**
 * Folds the side panel away when something was added from one of its tabs while it is a sheet over the page. A panel of options
 * for what is selected (colours, position, a table's cells) stays: the person asked for it and is working in it.
 * Returns the function that stops it.
 *
 * An action of the store may write the page and the selection one after the other, so the states are compared once the action is
 * over: the state before the first write of a turn with the state at the end of it.
 */
export function installFoldPanelOnInsert(): () => void {
  let before: EditorState | null = null;
  let stopped = false;
  const unsubscribe = useEditor.subscribe((_now, previous) => {
    if (before) return;
    before = previous;
    queueMicrotask(() => {
      const was = before as EditorState;
      before = null;
      const now = useEditor.getState();
      if (stopped || !now.panelOpen || now.context || !insertedByThisPerson(now, was)) return;
      if (!window.matchMedia?.(SHEET_QUERY).matches) return;
      now.actions.toggle("panelOpen");
    });
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

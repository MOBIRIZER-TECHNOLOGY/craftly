/**
 * Open / close state of the Create dialog. It is a module store so that anything on the dashboard (the rail, the
 * tab bar, a shortcut tile, an empty state) can open it without prop drilling.
 */
import { useSyncExternalStore } from "react";
import type { DesignCategory } from "@/data/designTypes";

export type CreateTab = "for-you" | DesignCategory | "custom" | "upload";

export interface CreateDialogState {
  open: boolean;
  tab: CreateTab;
  /** initial text of the search field */
  query: string;
  /** folder the new design is filed in (null = Projects) */
  folderId: string | null;
}

/** Set (any value) by other screens, e.g. the editor's "Create new design", to open the dialog on arrival. */
export const OPEN_CREATE_KEY = "craftly:open-create";

let state: CreateDialogState = { open: false, tab: "for-you", query: "", folderId: null };
const listeners = new Set<() => void>();

function set(next: CreateDialogState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function openCreateDialog(options: { tab?: CreateTab; query?: string; folderId?: string | null } = {}): void {
  set({ open: true, tab: options.tab ?? "for-you", query: options.query ?? "", folderId: options.folderId ?? null });
}

export function closeCreateDialog(): void {
  if (state.open) set({ ...state, open: false });
}

export function useCreateDialog(): CreateDialogState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => state,
  );
}

/** Opens the dialog when another screen asked for it (sessionStorage flag), and clears the flag. */
export function consumeOpenCreateRequest(): boolean {
  try {
    if (sessionStorage.getItem(OPEN_CREATE_KEY) === null) return false;
    sessionStorage.removeItem(OPEN_CREATE_KEY);
  } catch {
    return false;
  }
  openCreateDialog();
  return true;
}

/** Tiny store that opens the "Link" dialog (hosted by FloatingToolbar) for an element. */
import { create } from "zustand";
import type { ID } from "@/core/types";

interface LinkDialogState {
  id: ID | null;
  open(id: ID): void;
  close(): void;
}

export const useLinkDialog = create<LinkDialogState>()((set) => ({
  id: null,
  open: (id) => set({ id }),
  close: () => set({ id: null }),
}));

export const openLinkDialog = (id: ID) => useLinkDialog.getState().open(id);

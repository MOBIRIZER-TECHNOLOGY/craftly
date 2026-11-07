/** Tiny store that opens the "Alternative text" dialog (hosted by FloatingToolbar) for an element. */
import { create } from "zustand";
import type { ID } from "@/core/types";

interface AltTextState {
  id: ID | null;
  open(id: ID): void;
  close(): void;
}

export const useAltTextDialog = create<AltTextState>()((set) => ({
  id: null,
  open: (id) => set({ id }),
  close: () => set({ id: null }),
}));

export const openAltTextDialog = (id: ID) => useAltTextDialog.getState().open(id);

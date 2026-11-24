import { create } from "zustand";
import type { ID } from "@/core/types";

interface TableCellEditingState {
  id: ID;
  row: number;
  col: number;
}

interface TableCellEditorStore {
  editing: TableCellEditingState | null;
  open(id: ID, row: number, col: number): void;
  close(): void;
}

export const useTableCellEditor = create<TableCellEditorStore>()((set) => ({
  editing: null,
  open: (id, row, col) => set({ editing: { id, row, col } }),
  close: () => set({ editing: null }),
}));

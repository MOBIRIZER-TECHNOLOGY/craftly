/** Whether the "Report a problem" dialog is open, and which problem it starts on. Small and apart from the dialog, so that a menu can open it without loading it. */
import { create } from "zustand";

interface ProblemsDialogState {
  open: boolean;
  /** the problem to start on; the newest when there is none */
  problemId: string | null;
  /** counts the times it was opened, so that each opening starts from what is recorded then */
  opened: number;
  show(problemId?: string): void;
  hide(): void;
}

export const useProblemsDialog = create<ProblemsDialogState>()((set) => ({
  open: false,
  problemId: null,
  opened: 0,
  show: (problemId) => set((s) => ({ open: true, problemId: problemId ?? null, opened: s.opened + 1 })),
  hide: () => set({ open: false }),
}));

export const openProblemsDialog = (problemId?: string): void => useProblemsDialog.getState().show(problemId);
export const closeProblemsDialog = (): void => useProblemsDialog.getState().hide();

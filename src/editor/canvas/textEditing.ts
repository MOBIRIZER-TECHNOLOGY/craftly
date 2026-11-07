/**
 * Bridge between the contentEditable text editor and the rest of the UI.
 *
 * While a text box is being edited the toolbar must format the *selected
 * characters* (not the whole box). The active editor registers itself here;
 * toolbar code calls `applyInline` and falls back to element-level styling when
 * it returns false (no editor, or only a caret).
 */
import { create } from "zustand";
import type { TextRun } from "@/core/types";

export interface InlineFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  /** design px */
  size?: number;
  /** display family name, e.g. "Playfair Display" */
  font?: string;
}

export interface TextEditorHandle {
  /** formats the current selection; false when the selection is collapsed */
  applyInline(format: InlineFormat): boolean;
  hasSelection(): boolean;
  focus(): void;
}

let active: TextEditorHandle | null = null;
export const registerTextEditor = (h: TextEditorHandle | null) => {
  active = h;
};
export const textEditing = {
  isActive: () => active !== null,
  hasSelection: () => !!active?.hasSelection(),
  /** returns true when the format was applied to selected characters */
  applyInline: (format: InlineFormat) => (active ? active.applyInline(format) : false),
  focus: () => active?.focus(),
};

/** Formatting at the caret / selection start, for toolbar toggle states. */
interface SelectionStyleStore {
  active: boolean;
  collapsed: boolean;
  style: Pick<TextRun, "bold" | "italic" | "underline" | "strike" | "color" | "size" | "font">;
  set(patch: Partial<Omit<SelectionStyleStore, "set">>): void;
}

export const useTextSelectionStyle = create<SelectionStyleStore>()((set) => ({
  active: false,
  collapsed: true,
  style: {},
  set: (patch) => set(patch),
}));

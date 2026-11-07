import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTextEditor, textEditing, useTextSelectionStyle, type TextEditorHandle } from "./textEditing";

afterEach(() => registerTextEditor(null));

const handle = (over: Partial<TextEditorHandle> = {}): TextEditorHandle => ({ applyInline: vi.fn(() => true), hasSelection: vi.fn(() => true), focus: vi.fn(), ...over });

describe("the text editing bridge", () => {
  it("reports nothing to format when no text is being edited", () => {
    expect(textEditing.isActive()).toBe(false);
    expect(textEditing.hasSelection()).toBe(false);
    expect(textEditing.applyInline({ bold: true })).toBe(false);
    expect(() => textEditing.focus()).not.toThrow();
  });

  it("hands formatting to the active editor", () => {
    const editor = handle();
    registerTextEditor(editor);
    expect(textEditing.isActive()).toBe(true);
    expect(textEditing.hasSelection()).toBe(true);
    expect(textEditing.applyInline({ bold: true, size: 40 })).toBe(true);
    expect(editor.applyInline).toHaveBeenCalledWith({ bold: true, size: 40 });
    textEditing.focus();
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it("passes on the editor's refusal when only a caret is placed", () => {
    registerTextEditor(handle({ applyInline: () => false, hasSelection: () => false }));
    expect(textEditing.applyInline({ italic: true })).toBe(false);
    expect(textEditing.hasSelection()).toBe(false);
  });

  it("forgets the editor once it is unregistered", () => {
    registerTextEditor(handle());
    registerTextEditor(null);
    expect(textEditing.isActive()).toBe(false);
  });
});

describe("the selection style store", () => {
  it("starts inactive and merges updates", () => {
    expect(useTextSelectionStyle.getState()).toMatchObject({ active: false, collapsed: true, style: {} });
    useTextSelectionStyle.getState().set({ active: true, style: { bold: true } });
    expect(useTextSelectionStyle.getState()).toMatchObject({ active: true, collapsed: true, style: { bold: true } });
    useTextSelectionStyle.getState().set({ active: false, collapsed: true, style: {} });
  });
});

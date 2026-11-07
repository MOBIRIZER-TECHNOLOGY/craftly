import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEditorSelection, editorHasFocus, restoreEditorSelection, trackEditorSelection } from "./editorSelection";

/** <div data-cf-text-editor><div>Hello <b>big</b> world</div></div> and a paragraph outside it */
function build() {
  const root = document.createElement("div");
  root.setAttribute("data-cf-text-editor", "");
  root.setAttribute("contenteditable", "true");
  root.tabIndex = 0;
  const line = document.createElement("div");
  const bold = document.createElement("b");
  bold.textContent = "big";
  line.append("Hello ", bold, " world");
  root.appendChild(line);
  const outside = document.createElement("p");
  outside.textContent = "Not the editor";
  outside.tabIndex = 0;
  document.body.append(root, outside);
  return { root, line, bold, outside };
}

const select = (a: Node, ao: number, b: Node, bo: number) => document.getSelection()!.setBaseAndExtent(a, ao, b, bo);

let dom: ReturnType<typeof build>;
beforeEach(() => {
  dom = build();
});
afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

describe("remembering the selection of the text editor", () => {
  it("reads the selected characters as offsets into the plain text", () => {
    select(dom.line.firstChild!, 6, dom.bold.firstChild!, 3);
    expect(captureEditorSelection()).toEqual({ start: 6, end: 9 });
    select(dom.line.firstChild!, 0, dom.line.lastChild!, 6);
    expect(captureEditorSelection()).toEqual({ start: 0, end: 15 });
  });

  it("reports nothing when the selection is outside the editor or there is none", () => {
    select(dom.outside.firstChild!, 0, dom.outside.firstChild!, 3);
    expect(captureEditorSelection()).toBeNull();
    document.getSelection()!.removeAllRanges();
    expect(captureEditorSelection()).toBeNull();
    // one end in, one end out is not a selection of the editor either
    select(dom.line.firstChild!, 1, dom.outside.firstChild!, 3);
    expect(captureEditorSelection()).toBeNull();
  });

  it("falls back to the last selection seen while tracking, until the last tracker stops", () => {
    select(dom.line.firstChild!, 0, dom.line.firstChild!, 5);
    const stopA = trackEditorSelection();
    const stopB = trackEditorSelection();
    // the selection moves away from the editor, e.g. into a number field
    select(dom.outside.firstChild!, 0, dom.outside.firstChild!, 3);
    document.dispatchEvent(new Event("selectionchange"));
    expect(captureEditorSelection()).toEqual({ start: 0, end: 5 });
    // a live selection inside the editor wins over the remembered one
    select(dom.bold.firstChild!, 0, dom.bold.firstChild!, 3);
    expect(captureEditorSelection()).toEqual({ start: 6, end: 9 });
    document.dispatchEvent(new Event("selectionchange"));
    stopA();
    select(dom.outside.firstChild!, 0, dom.outside.firstChild!, 3);
    expect(captureEditorSelection()).toEqual({ start: 6, end: 9 });
    stopB();
    expect(captureEditorSelection()).toBeNull();
  });

  it("follows selection changes while tracking", () => {
    const stop = trackEditorSelection();
    select(dom.line.firstChild!, 2, dom.line.firstChild!, 4);
    document.dispatchEvent(new Event("selectionchange"));
    select(dom.outside.firstChild!, 0, dom.outside.firstChild!, 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(captureEditorSelection()).toEqual({ start: 2, end: 4 });
    stop();
  });
});

describe("selecting the characters again", () => {
  it("selects the same characters, also across formatting boundaries", () => {
    restoreEditorSelection({ start: 6, end: 9 });
    expect(document.getSelection()!.toString()).toBe("big");
    restoreEditorSelection({ start: 3, end: 11 });
    expect(document.getSelection()!.toString()).toBe("lo big w");
    restoreEditorSelection({ start: 0, end: 15 });
    expect(document.getSelection()!.toString()).toBe("Hello big world");
  });

  it("tells the editor right away, so its own remembered range is the restored one", () => {
    const seen = vi.fn();
    document.addEventListener("selectionchange", seen);
    restoreEditorSelection({ start: 0, end: 5 });
    document.removeEventListener("selectionchange", seen);
    expect(seen).toHaveBeenCalled();
  });

  it("ends at the end of the text when the offsets run past it", () => {
    restoreEditorSelection({ start: 12, end: 99 });
    expect(document.getSelection()!.toString()).toBe("rld");
  });

  it("does nothing for a caret, for no snapshot and when the editor is gone", () => {
    select(dom.outside.firstChild!, 0, dom.outside.firstChild!, 3);
    restoreEditorSelection({ start: 4, end: 4 });
    restoreEditorSelection({ start: 5, end: 2 });
    restoreEditorSelection(null);
    expect(document.getSelection()!.toString()).toBe("Not");
    dom.root.remove();
    restoreEditorSelection({ start: 0, end: 5 });
    expect(document.getSelection()!.toString()).toBe("Not");
  });

  it("does nothing when the editor has no text to select in", () => {
    dom.line.replaceChildren();
    select(dom.outside.firstChild!, 0, dom.outside.firstChild!, 3);
    restoreEditorSelection({ start: 0, end: 3 });
    expect(document.getSelection()!.toString()).toBe("Not");
  });
});

describe("focus", () => {
  it("knows when the keyboard focus is inside the editor", () => {
    expect(editorHasFocus()).toBe(false);
    dom.root.focus();
    expect(editorHasFocus()).toBe(true);
    dom.outside.focus();
    expect(editorHasFocus()).toBe(false);
  });
});

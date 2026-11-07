/**
 * Keeps the selected characters of the open text editor alive across toolbar actions.
 *
 * `textEditing.applyInline({ size })` swaps the DOM nodes of the selected text, which collapses the browser
 * selection - a second press on "+" would then resize the whole box instead of the same words. The toolbar
 * records the selection as plain-text offsets (formatting never changes the text) and puts it back afterwards.
 */

export interface EditorSelectionSnapshot {
  /** character offsets from the start of the editor's text */
  start: number;
  end: number;
}

const EDITOR_SELECTOR = "[data-cf-text-editor]";
const editorRoot = () => document.querySelector<HTMLElement>(EDITOR_SELECTOR);

/** Number of characters between the start of `root` and the point (`node`, `offset`). */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function snapshotOfDocumentSelection(): EditorSelectionSnapshot | null {
  const root = editorRoot();
  const sel = document.getSelection();
  if (!root || !sel || !sel.rangeCount || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const range = sel.getRangeAt(0);
  return { start: offsetOf(root, range.startContainer, range.startOffset), end: offsetOf(root, range.endContainer, range.endOffset) };
}

let last: EditorSelectionSnapshot | null = null;
let trackers = 0;

function onSelectionChange(): void {
  const snap = snapshotOfDocumentSelection();
  if (snap) last = snap;
}

/** Starts remembering the editor selection (reference counted); returns the stop function. */
export function trackEditorSelection(): () => void {
  if (trackers++ === 0) document.addEventListener("selectionchange", onSelectionChange);
  onSelectionChange();
  return () => {
    if (--trackers === 0) {
      document.removeEventListener("selectionchange", onSelectionChange);
      last = null;
    }
  };
}

/** The selection to restore later: the live one when it is inside the editor, else the last remembered. */
export function captureEditorSelection(): EditorSelectionSnapshot | null {
  return snapshotOfDocumentSelection() ?? last;
}

/** Text node + offset for a character offset ("start" prefers the node that begins there). */
function locate(root: HTMLElement, offset: number, bias: "start" | "end"): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let passed = 0;
  let lastText: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const end = passed + text.data.length;
    if (bias === "end" ? offset <= end : offset < end) return { node: text, offset: offset - passed };
    passed = end;
    lastText = text;
  }
  return lastText ? { node: lastText, offset: lastText.data.length } : null;
}

/** Selects the remembered characters again (no-op for a caret or when the editor is gone). */
export function restoreEditorSelection(snap: EditorSelectionSnapshot | null): void {
  const root = editorRoot();
  const sel = document.getSelection();
  if (!snap || !root || !sel || snap.end <= snap.start) return;
  const a = locate(root, snap.start, "start");
  const b = locate(root, snap.end, "end");
  if (!a || !b) return;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
  // The browser reports the change asynchronously, and by then focus may already have moved into the number
  // field (which the editor ignores). Tell the editor right away so its remembered range is the restored one.
  document.dispatchEvent(new Event("selectionchange"));
}

/** True when keyboard focus is inside the open text editor. */
export const editorHasFocus = (): boolean => !!document.activeElement?.closest(EDITOR_SELECTOR);

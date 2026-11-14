/**
 * Global keyboard shortcuts (Canva compatible) and clipboard events.
 * `installHotkeys()` returns an uninstall function; the Editor calls it once.
 */
import { usableElements } from "@/export/projectFormat";
import { createLine, createShape, createText } from "@/core/factory";
import { findElement } from "@/core/ops";
import { elementPath } from "@/core/penShape";
import { getActions, getActivePage, useEditor } from "@/core/store";
import { measureTextElement } from "@/render/textLayout";
import { pathEditKey } from "./canvas/pathEditActions";
import { startPathEdit, stopPathEdit, usePathEdit } from "./canvas/pathEditStore";
import { backspacePen, finishPen, hasPenDraft, penHistory, penKey } from "./canvas/penTool";
import { stopPreview, usePreview } from "./canvas/preview";
import { insertImageFiles } from "./insert";
import { pasteDataIntoSelection } from "./panels/context/dataImport";
import { isInteractiveControl, isTyping, markSelectAllOnEdit } from "./canvas/controller";

const CLIP_MIME = "application/x-craftly-elements";

function addCentered(kind: "text" | "rect" | "ellipse" | "line") {
  const s = useEditor.getState();
  const d = s.design;
  if (!d) return;
  const a = getActions();
  const m = Math.min(d.width, d.height);
  if (kind === "text") {
    const el = createText({ text: "Text", fontSize: Math.round(m * 0.06) });
    Object.assign(el, measureTextElement(el));
    const id = a.addElement(el);
    markSelectAllOnEdit();
    a.startTextEdit(id);
  } else if (kind === "line") a.addElement(createLine({ width: Math.round(m * 0.3) }));
  else a.addElement(createShape(kind, { width: Math.round(m * 0.24), height: Math.round(m * 0.24) }));
}

/** Popovers and modals (UI kit) mark the body while open and consume Esc themselves. */
const overlayOpen = () => Number(document.body.dataset.cfOverlay ?? 0) > 0 || document.body.hasAttribute("data-cf-modal-open");

function onKeyDown(e: KeyboardEvent) {
  const s = useEditor.getState();
  if (!s.design || e.defaultPrevented) return;
  if (overlayOpen()) return;
  const a = s.actions;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const typing = isTyping(e.target);

  if (s.presenting) return; // the presenter handles its own keys
  if (key === "escape") {
    if (s.dialog) return;
    if (usePreview.getState().preview) stopPreview();
    else if (s.editingTextId) a.endTextEdit();
    else if (s.croppingId) a.endCrop();
    else if (hasPenDraft()) finishPen(false);
    else if (usePathEdit.getState().id) stopPathEdit();
    else if (s.tool !== "select") a.setTool("select");
    else if (s.context) a.closeContext();
    else if (s.selection.length) a.clearSelection();
    return;
  }
  if (mod && key === "s") {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("craftly:save-now"));
    return;
  }
  if (typing) return; // let inputs and the text editor handle everything else
  // a focused button / slider / menu item owns arrows, Tab, Enter and Space
  if (isInteractiveControl(e.target) && (key.startsWith("arrow") || key === "tab" || key === "enter" || key === " " || key === "home" || key === "end")) return;

  // while a path is being placed undo takes its last point back and redo does nothing: neither reaches into the document
  if (mod && key === "z") {
    e.preventDefault();
    if (penHistory(e.shiftKey)) return;
    if (e.shiftKey) a.redo();
    else a.undo();
    return;
  }
  if (mod && key === "y") {
    e.preventDefault();
    if (!penHistory(true)) a.redo();
    return;
  }
  if (s.mode === "view") return;

  // with the Pen in hand the arrows move its keyboard point, Enter places a point there, Alt and the arrows pull the curve of
  // the last point and Home goes to the first one; Enter stays the end of the path for somebody who draws with the pointer
  if (s.tool === "pen" && penKey(e, s.design)) {
    e.preventDefault();
    return;
  }

  // while a path is being placed, Enter makes it and Backspace takes the last point back; while its points are edited the
  // keys move, delete and walk through them (src/editor/canvas/penTool.ts, pathEditActions.ts)
  if (!mod && !e.altKey) {
    if (hasPenDraft() && (key === "enter" || key === "delete" || key === "backspace")) {
      e.preventDefault();
      if (key === "enter") finishPen(false);
      else backspacePen();
      return;
    }
    if (pathEditKey(e)) {
      e.preventDefault();
      return;
    }
    // with the points of a path open, Tab is theirs and then the browser's (the toolbar of the points comes next), never the page's
    if (key === "tab" && usePathEdit.getState().id) return;
  }

  if (mod && key === "a") {
    e.preventDefault();
    a.selectAll();
  } else if (mod && key === "d") {
    e.preventDefault();
    a.duplicateSelection();
  } else if (mod && key === "g") {
    e.preventDefault();
    if (e.shiftKey) a.ungroupSelection();
    else a.groupSelection();
  } else if (mod && (key === "]" || key === "}")) {
    e.preventDefault();
    a.arrange(e.altKey || e.shiftKey ? "front" : "forward");
  } else if (mod && (key === "[" || key === "{")) {
    e.preventDefault();
    a.arrange(e.altKey || e.shiftKey ? "back" : "backward");
  } else if (mod && e.altKey && key === "c") {
    e.preventDefault();
    a.copyStyle();
  } else if (mod && e.altKey && key === "v") {
    e.preventDefault();
    a.pasteStyle();
  } else if (mod && (key === "=" || key === "+")) {
    e.preventDefault();
    a.zoomBy(1.25);
  } else if (mod && (key === "-" || key === "_")) {
    e.preventDefault();
    a.zoomBy(0.8);
  } else if (mod && key === "0") {
    e.preventDefault();
    a.setZoomMode("fit");
  } else if (mod && key === "f") {
    e.preventDefault();
    a.openDialog("findReplace");
  } else if (e.altKey && e.shiftKey && key === "l") {
    e.preventDefault();
    const page = getActivePage(s);
    const els = s.selection.map((id) => (page ? findElement(page, id) : null)).filter(Boolean);
    const lock = !els.every((el) => el?.locked);
    a.setLocked(s.selection, lock);
  } else if (key === "delete" || key === "backspace") {
    if (s.selection.length) {
      e.preventDefault();
      a.deleteElements();
    }
  } else if (key.startsWith("arrow") && s.selection.length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    a.nudge(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
  } else if (key === "enter" && s.selection.length === 1) {
    const page = getActivePage(s);
    const el = page && findElement(page, s.selection[0]);
    if (el?.type === "text") {
      e.preventDefault();
      a.startTextEdit(el.id);
    } else if (el?.type === "image" && el.src) {
      e.preventDefault();
      a.startCrop(el.id);
    } else if (el?.type === "shape" && elementPath(el)) {
      e.preventDefault();
      startPathEdit(el.id);
    }
  } else if (key === "tab") {
    // Tab is the keyboard's way round the page, so the canvas only borrows it while the canvas has the focus. From the page
    // itself (nothing focused) and after the last (or before the first) element it is left to the browser, which moves on to
    // the next control: otherwise nobody without a mouse could ever reach the toolbars, menus and panels.
    const onCanvas = e.target instanceof Element && !!e.target.closest("[data-cf-workspace]");
    const page = getActivePage(s);
    const count = page?.elements.length ?? 0;
    if (!onCanvas || !page || count === 0) return;
    const idx = page.elements.findIndex((el) => el.id === s.selection[0]);
    // nothing selected: Tab starts at the first element, Shift+Tab at the last
    const next = e.shiftKey ? (idx < 0 ? count : idx) - 1 : idx + 1;
    if (next < 0 || next >= count) return;
    e.preventDefault();
    a.select([page.elements[next].id]);
  } else if (!mod && !e.altKey) {
    if (key === "t") {
      e.preventDefault();
      addCentered("text");
    } else if (key === "r") {
      e.preventDefault();
      if (e.shiftKey) a.toggle("showRulers");
      else addCentered("rect");
    } else if (key === "c") {
      e.preventDefault();
      addCentered("ellipse");
    } else if (key === "l") {
      e.preventDefault();
      addCentered("line");
    } else if (key === "p") {
      e.preventDefault();
      a.setTool("pen");
    } else if (key === "m") {
      // the Comment tool: a click on the page places a pin with a note (src/editor/comments)
      e.preventDefault();
      a.setTool("comment");
    } else if (e.key === "?") {
      a.openDialog("shortcuts");
    }
  }
}

/* ---------------- clipboard ---------------- */

/**
 * Copy, cut and paste stand back exactly where the keys do (see `onKeyDown`): while a popover or dialog is over the page, while
 * presenting, and when another handler took the event. The browser then does what it always does, so text selected in a dialog
 * is what gets copied, and nothing is cut from or pasted into a page that cannot be seen.
 */
const clipboardIsOurs = (e: ClipboardEvent) => !e.defaultPrevented && !overlayOpen() && !useEditor.getState().presenting;

function onCopy(e: ClipboardEvent) {
  const s = useEditor.getState();
  if (!s.design || !clipboardIsOurs(e) || isTyping(e.target) || !s.selection.length) return;
  s.actions.copy();
  const clip = useEditor.getState().clipboard;
  if (clip && e.clipboardData) {
    e.clipboardData.setData(CLIP_MIME, JSON.stringify(clip.elements));
    e.clipboardData.setData("text/plain", "Craftly design elements");
    e.preventDefault();
  }
}

function onCut(e: ClipboardEvent) {
  const s = useEditor.getState();
  if (!s.design || !clipboardIsOurs(e) || isTyping(e.target) || !s.selection.length || s.mode === "view") return;
  onCopy(e);
  useEditor.getState().actions.deleteElements();
}

function onPaste(e: ClipboardEvent) {
  const s = useEditor.getState();
  if (!s.design || !clipboardIsOurs(e) || isTyping(e.target) || s.mode === "view") return;
  const dt = e.clipboardData;
  if (!dt) return;
  const files = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    e.preventDefault();
    void insertImageFiles(files);
    return;
  }
  const json = dt.getData(CLIP_MIME);
  if (json) {
    e.preventDefault();
    try {
      // the clipboard is filled by other pages and programs too: what it holds is checked like the elements of a file
      const elements = usableElements(JSON.parse(json));
      if (!elements.length) return;
      useEditor.setState({ clipboard: { elements, pasted: s.clipboard?.pasted ?? 0 } });
      s.actions.paste();
    } catch {
      /* ignore malformed clipboard data */
    }
    return;
  }
  const raw = dt.getData("text/plain");
  // a block of cells copied from a spreadsheet, with one table or chart selected, is its new data and not a text box
  if (pasteDataIntoSelection(raw)) {
    e.preventDefault();
    return;
  }
  const text = raw.trim();
  if (s.clipboard && (!text || text === "Craftly design elements")) {
    e.preventDefault();
    s.actions.paste();
    return;
  }
  if (text) {
    e.preventDefault();
    const m = Math.min(s.design.width, s.design.height);
    const el = createText({ text, fontSize: Math.round(m * 0.04), width: Math.round(s.design.width * 0.5), autoWidth: false });
    Object.assign(el, measureTextElement(el));
    s.actions.addElement(el);
  }
}

export function installHotkeys(): () => void {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("copy", onCopy);
  window.addEventListener("cut", onCut);
  window.addEventListener("paste", onPaste);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("copy", onCopy);
    window.removeEventListener("cut", onCut);
    window.removeEventListener("paste", onPaste);
  };
}

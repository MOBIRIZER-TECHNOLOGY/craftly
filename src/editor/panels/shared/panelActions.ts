/**
 * Editor operations used by several tabs: inserting text and entering edit mode, applying a colour or a font to
 * whatever is selected, and small CSS helpers for previews.
 */
import { createText, solid } from "@/core/factory";
import { getActions, getSelectedElements, useEditor } from "@/core/store";
import * as ops from "@/core/ops";
import type { DesignElement, Fill, GraphicElement, ID, TextElement } from "@/core/types";
import { markSelectAllOnEdit } from "@/editor/canvas/controller";
import { textEditing } from "@/editor/canvas/textEditing";
import { ensureFont } from "@/render/fonts";
import { svgColorKey, extractSvgColors } from "@/core/svg";

/** The shorter side of the open design (sizes of new elements are relative to it). */
export function designMin(): number {
  const d = useEditor.getState().design;
  return d ? Math.min(d.width, d.height) : 1000;
}

/**
 * Puts a new text element on the page and opens it for typing with its text selected.
 *
 * `markSelectAllOnEdit` is a one-shot flag that the editor overlay consumes in a mount effect. React StrictMode
 * (dev builds) runs that effect twice and the second run finds the flag gone, leaving a bare caret - so the
 * selection is verified on the next frame and completed when needed.
 *
 * That frame can come late (WebKit was measured drawing it some 350 ms after the click, by when "Pri" of "Print me" had
 * been typed): a key pressed or a pointer put down before it means the person is already at work in the box, and the
 * caret they left is theirs, so the text is not selected again (or the next key would replace what was typed).
 */
export function addTextAndEdit(el: TextElement): ID {
  const actions = getActions();
  const id = actions.addElement(el);
  if (id) {
    markSelectAllOnEdit();
    actions.startTextEdit(id);
    let touched = false;
    const touch = () => {
      touched = true;
    };
    document.addEventListener("keydown", touch, true);
    document.addEventListener("pointerdown", touch, true);
    requestAnimationFrame(() => {
      document.removeEventListener("keydown", touch, true);
      document.removeEventListener("pointerdown", touch, true);
      if (!touched) selectAllInTextEditor(id);
    });
  }
  return id;
}

function selectAllInTextEditor(id: ID): void {
  if (useEditor.getState().editingTextId !== id) return;
  const root = document.querySelector<HTMLElement>("[data-cf-text-editor]");
  const sel = window.getSelection();
  if (!root || !sel || !root.isContentEditable) return;
  if (sel.rangeCount > 0 && root.contains(sel.anchorNode) && !sel.isCollapsed) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** A text box with the given look; sizes are in design px. */
export function newText(text: string, init: Partial<TextElement> = {}): TextElement {
  return createText({ text, ...init });
}

/** Loads the face so the text box measures correctly the first time it is laid out. */
export async function addTextInFont(text: string, family: string, init: Partial<TextElement> = {}): Promise<ID> {
  const weight = init.fontWeight ?? 400;
  await ensureFont(family, weight, init.italic ?? false);
  return addTextAndEdit(newText(text, { fontFamily: family, ...init }));
}

/* ------------------------------------------------------------------ */
/* applying brand colours / fonts to the selection                      */
/* ------------------------------------------------------------------ */

function recolour(el: DesignElement, color: string): boolean {
  switch (el.type) {
    case "text":
      ops.applyTextProps(el, { color, gradient: null });
      return true;
    case "shape":
      el.fill = solid(color) as typeof el.fill;
      return true;
    case "line":
      el.stroke.color = color;
      return true;
    case "table":
      el.headerFill = color;
      return true;
    case "chart":
      el.palette = [color, ...el.palette.slice(1)];
      return true;
    case "graphic": {
      const g = el as GraphicElement;
      const keys = extractSvgColors(g.svg).filter((k) => svgColorKey(k) !== null);
      // a single-colour graphic (an icon) takes the colour; illustrations keep their palette
      if (keys.length === 1) {
        g.colors = { ...g.colors, [keys[0]]: color };
        return true;
      }
      return false;
    }
    case "group": {
      let any = false;
      for (const child of el.children) any = recolour(child, color) || any;
      return any;
    }
    default:
      return false;
  }
}

/**
 * Applies a colour the way the colour swatches of the toolbar do: to the selected characters while a text box is
 * edited, otherwise to every selected text / shape / line / icon, or to the page background when nothing is selected.
 * Returns what happened so the caller can tell the user.
 */
export function applyColorToSelection(color: string): "text" | "elements" | "background" | "none" {
  const s = useEditor.getState();
  const actions = s.actions;
  if (s.editingTextId && textEditing.applyInline({ color })) return "text";
  const selected = getSelectedElements(s);
  if (!selected.length) {
    actions.setPageBackground(solid(color));
    return "background";
  }
  let applied = false;
  actions.updateSelection((el) => {
    applied = recolour(el, color) || applied;
  });
  return applied ? "elements" : "none";
}

/** Applies a font family to the selected text; returns false when there was nothing to apply it to. */
export function applyFontToSelection(family: string): boolean {
  const s = useEditor.getState();
  void ensureFont(family, 400);
  if (s.editingTextId && textEditing.applyInline({ font: family })) return true;
  const selected = getSelectedElements(s);
  const hasText = selected.some((el) => el.type === "text" || (el.type === "group" && JSON.stringify(el.children).includes('"type":"text"')));
  if (!hasText) return false;
  s.actions.setTextProps(null, { fontFamily: family });
  return true;
}

/* ------------------------------------------------------------------ */
/* CSS previews of fills                                                */
/* ------------------------------------------------------------------ */

/** CSS `background` for solid and linear / radial gradient fills (patterns and images need the real renderer). */
export function fillToCss(fill: Fill): string | null {
  if (fill.type === "solid") return fill.color;
  if (fill.type === "linear") {
    const stops = fill.stops.map((st) => `${st.color} ${Math.round(st.offset * 100)}%`).join(", ");
    return `linear-gradient(${fill.angle}deg, ${stops})`;
  }
  if (fill.type === "radial") {
    const stops = fill.stops.map((st) => `${st.color} ${Math.round(st.offset * 100)}%`).join(", ");
    return `radial-gradient(circle at ${Math.round((fill.cx ?? 0.5) * 100)}% ${Math.round((fill.cy ?? 0.5) * 100)}%, ${stops})`;
  }
  return null;
}

/** Is `a` the same fill as `b`? (used to mark the current page background) */
export function sameFill(a: Fill, b: Fill): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The right-click menu as data. `buildContextMenuItems(state)` is a pure function of an editor state
 * snapshot (nothing runs until an item is chosen), shared by the canvas context menu and the "..." buttons
 * of the floating and mini toolbars.
 */
import { createElement, type ComponentType } from "react";
import { shapesToCombine } from "@/core/combine";
import { connectable } from "@/core/connectors";
import { canArrange } from "@/core/ops";
import { getActivePage, getSelectedElements, type EditorState } from "@/core/store";
import type { Point } from "@/core/types";
import {
  IconAlignObjBottom,
  IconAlignObjCenter,
  IconAlignObjLeft,
  IconAlignObjMiddle,
  IconAlignObjRight,
  IconAlignObjTop,
  IconBackground,
  IconBringForward,
  IconBringToFront,
  IconCombine,
  IconConnect,
  IconCopy,
  IconCopyStyle,
  IconCurve,
  IconDuplicate,
  IconEyeOff,
  IconFilePlus,
  IconGroup,
  IconLayers,
  IconLock,
  IconPaste,
  IconReplace,
  IconSelect,
  IconSendBackward,
  IconSendToBack,
  IconTrash,
  IconUngroup,
  IconUnlock,
  type MenuEntry,
} from "@/ui";
import { openAltTextDialog } from "./altText";
import { canConvertToPath, combineMenuItems, convertToPath } from "./combine";
import { IconAccessibility } from "./icons";
import { pickImageFor } from "./imageFile";
import { convertToShapes, offersConvertToShapes } from "./svgShapes";

export interface ContextMenuOptions {
  /** design-space point under the pointer; "Paste" drops the copied elements there when nothing is selected */
  at?: Point;
}

const ic = (Icon: ComponentType) => createElement(Icon);

/**
 * Fills the editor clipboard and asks the browser to fire a `copy` event, which the hotkeys module answers by
 * writing the elements to the system clipboard too (so Ctrl+V afterwards cannot paste stale text from elsewhere).
 */
function copySelection(state: EditorState): void {
  state.actions.copy();
  try {
    document.execCommand("copy");
  } catch {
    /* the in-app clipboard is enough */
  }
}

/** Element types `copyStyle` / `pasteStyle` understand (see STYLE_KEYS in the store). */
const STYLE_TYPES = new Set(["text", "shape", "line", "image", "graphic"]);

export function buildContextMenuItems(state: EditorState, opts: ContextMenuOptions = {}): MenuEntry[] {
  const page = getActivePage(state);
  if (!page || state.mode === "view") return [];
  const a = state.actions;
  const els = getSelectedElements(state);
  const ids = els.map((e) => e.id);

  /* ---------------- nothing selected: page menu ---------------- */
  if (!els.length) {
    return [
      { id: "paste", label: "Paste", icon: ic(IconPaste), shortcut: "Ctrl+V", disabled: !state.clipboard, onSelect: () => a.paste(opts.at) },
      { id: "select-all", label: "Select all", icon: ic(IconSelect), shortcut: "Ctrl+A", disabled: page.elements.every((e) => e.hidden), onSelect: () => a.selectAll() },
      { type: "divider" },
      { id: "add-page", label: "Add page", icon: ic(IconFilePlus), onSelect: () => a.addPage() },
      { id: "page-background", label: "Page background", icon: ic(IconBackground), onSelect: () => a.openContext({ kind: "background" }) },
    ];
  }

  /* ---------------- element menu ---------------- */
  const single = els.length === 1 ? els[0] : null;
  const allLocked = els.every((e) => e.locked);
  const hasGroup = els.some((e) => e.type === "group");
  const canCopyStyle = !!single && STYLE_TYPES.has(single.type);
  const styleType = state.styleClipboard?.__type;
  const canPasteStyle = !!state.styleClipboard && els.some((e) => e.type === styleType && !e.locked);

  const arrange = (id: string, label: string, mode: "forward" | "front" | "backward" | "back", shortcut: string, Icon: ComponentType): MenuEntry => ({
    id,
    label,
    shortcut,
    icon: ic(Icon),
    disabled: !canArrange(page, ids, mode),
    onSelect: () => a.arrange(mode),
  });

  const alignTo = (mode: "top" | "middle" | "bottom" | "left" | "center" | "right", label: string, Icon: ComponentType): MenuEntry => ({
    id: `align-${mode}`,
    label,
    icon: ic(Icon),
    disabled: allLocked,
    onSelect: () => a.align(mode, "page"),
  });

  const items: MenuEntry[] = [
    { id: "copy", label: "Copy", icon: ic(IconCopy), shortcut: "Ctrl+C", onSelect: () => copySelection(state) },
    { id: "copy-style", label: "Copy style", icon: ic(IconCopyStyle), shortcut: "Ctrl+Alt+C", disabled: !canCopyStyle, onSelect: () => a.copyStyle() },
    { id: "paste-style", label: "Paste style", icon: ic(IconCopyStyle), shortcut: "Ctrl+Alt+V", disabled: !canPasteStyle, onSelect: () => a.pasteStyle() },
    { id: "paste", label: "Paste", icon: ic(IconPaste), shortcut: "Ctrl+V", disabled: !state.clipboard, onSelect: () => a.paste() },
    { id: "duplicate", label: "Duplicate", icon: ic(IconDuplicate), shortcut: "Ctrl+D", onSelect: () => a.duplicateSelection() },
    { type: "divider" },
    {
      id: "layer",
      label: "Layer",
      icon: ic(IconLayers),
      submenu: [
        arrange("layer-forward", "Bring forward", "forward", "Ctrl+]", IconBringForward),
        arrange("layer-front", "Bring to front", "front", "Ctrl+Alt+]", IconBringToFront),
        arrange("layer-backward", "Send backward", "backward", "Ctrl+[", IconSendBackward),
        arrange("layer-back", "Send to back", "back", "Ctrl+Alt+[", IconSendToBack),
      ],
    },
    {
      id: "align-page",
      label: "Align to page",
      icon: ic(IconAlignObjLeft),
      submenu: [
        alignTo("top", "Top", IconAlignObjTop),
        alignTo("middle", "Middle", IconAlignObjMiddle),
        alignTo("bottom", "Bottom", IconAlignObjBottom),
        { type: "divider" },
        alignTo("left", "Left", IconAlignObjLeft),
        alignTo("center", "Center", IconAlignObjCenter),
        alignTo("right", "Right", IconAlignObjRight),
      ],
    },
  ];

  if (els.length >= 2 || !hasGroup) {
    items.push({ id: "group", label: "Group", icon: ic(IconGroup), shortcut: "Ctrl+G", disabled: els.length < 2, onSelect: () => a.groupSelection() });
  }
  if (hasGroup) {
    items.push({ id: "ungroup", label: "Ungroup", icon: ic(IconUngroup), shortcut: "Ctrl+Shift+G", onSelect: () => a.ungroupSelection() });
  }
  if (els.length >= 2 && els.every((e) => e.type === "shape")) {
    items.push({ id: "combine", label: "Combine shapes", icon: ic(IconCombine), disabled: !shapesToCombine(page, ids), submenu: combineMenuItems(page, ids) });
  }
  if (connectable(page, ids)) {
    items.push({ id: "connect", label: "Connect", hint: "Arrow", icon: ic(IconConnect), onSelect: () => a.connect(ids[0], ids[1]) });
  }
  if (els.some((e) => e.type === "shape" && e.shape !== "path")) {
    items.push({ id: "convert-to-path", label: "Convert to path", icon: ic(IconCurve), disabled: !canConvertToPath(page, ids), onSelect: () => void convertToPath(ids) });
  }
  if (offersConvertToShapes(single)) {
    const drawingId = single.id;
    items.push({ id: "convert-to-shapes", label: "Convert to shapes", icon: ic(IconCurve), disabled: !!single.locked, onSelect: () => void convertToShapes(drawingId) });
  }

  items.push(
    { type: "divider" },
    {
      id: "lock",
      label: allLocked ? "Unlock" : "Lock",
      icon: ic(allLocked ? IconUnlock : IconLock),
      shortcut: "Alt+Shift+L",
      onSelect: () => a.setLocked(ids, !allLocked),
    },
    { id: "hide", label: "Hide", icon: ic(IconEyeOff), onSelect: () => a.setHidden(ids, true) },
  );

  if (single?.type === "image") {
    const imageId = single.id;
    items.push({ id: "replace-image", label: "Replace image", icon: ic(IconReplace), disabled: !!single.locked, onSelect: () => pickImageFor(imageId) });
  }
  if (single) {
    const elementId = single.id;
    items.push({ id: "alt-text", label: "Alternative text", icon: ic(IconAccessibility), onSelect: () => openAltTextDialog(elementId) });
  }

  items.push(
    { type: "divider" },
    { id: "delete", label: "Delete", icon: ic(IconTrash), shortcut: "Delete", danger: true, disabled: allLocked, onSelect: () => a.deleteElements() },
  );
  return items;
}

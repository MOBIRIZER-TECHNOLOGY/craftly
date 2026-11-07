/**
 * Registers the right-click menu with the canvas controller. The editor shell calls `installContextMenu()` once
 * (and mounts <ContextMenuHost /> from the UI kit); it returns the uninstall function.
 */
import { useEditor } from "@/core/store";
import { setContextMenuHandler } from "@/editor/canvas/controller";
import { screenToDesign, useView } from "@/editor/canvas/viewStore";
import { openContextMenu } from "@/ui";
import { buildContextMenuItems } from "./contextMenuItems";

type Handler = Parameters<typeof setContextMenuHandler>[0];

export function installContextMenu(): () => void {
  const handler: NonNullable<Handler> = (clientX, clientY) => {
    const state = useEditor.getState();
    if (!state.design || state.mode === "view") return;

    // Where "Paste" drops the elements when the menu was opened on empty canvas.
    const host = document.querySelector<HTMLElement>("[data-cf-workspace]");
    const box = host?.getBoundingClientRect();
    const at = box ? screenToDesign(useView.getState(), clientX - box.left, clientY - box.top) : undefined;

    const items = buildContextMenuItems(state, { at });
    if (items.length) openContextMenu({ x: clientX, y: clientY, items });
  };
  setContextMenuHandler(handler);
  return () => setContextMenuHandler(null);
}

/**
 * Settings of the freehand "Draw" tool, edited in the pen flyout of the Tools palette.
 *
 * The canvas controller creates a stroke for every freehand gesture; it should read the current look from here
 * instead of hard-coding it:
 *
 *   import { getDrawStroke } from "@/editor/panels/shared/drawSettings";
 *   stroke: { ...getDrawStroke(design.width), style: "solid", cap: "round", join: "round" }
 */
import { useSyncExternalStore } from "react";

export interface DrawSettings {
  /** stroke colour (#rrggbb) */
  color: string;
  /** stroke width in design px; `null` = automatic (a little under half a percent of the page width) */
  width: number | null;
}

/** Live settings object. Treat it as read-only outside this module: use `setDrawSettings`. */
export const drawSettings: DrawSettings = { color: "#0e1318", width: null };

const listeners = new Set<() => void>();
let snapshot: DrawSettings = { ...drawSettings };

export function subscribeDrawSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setDrawSettings(patch: Partial<DrawSettings>): void {
  Object.assign(drawSettings, patch);
  snapshot = { ...drawSettings };
  listeners.forEach((l) => l());
}

/** The width used when the user has not picked one. */
export const autoDrawWidth = (designWidth: number): number => Math.max(4, Math.round(designWidth * 0.004));

/** What the controller needs for a new stroke on a page of the given width. */
export function getDrawStroke(designWidth: number): { color: string; width: number } {
  return { color: drawSettings.color, width: drawSettings.width ?? autoDrawWidth(designWidth) };
}

export function useDrawSettings(): DrawSettings {
  return useSyncExternalStore(
    subscribeDrawSettings,
    () => snapshot,
    () => snapshot,
  );
}

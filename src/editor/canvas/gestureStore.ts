/** Transient, purely visual gesture state (marquee, HUD tooltip, freehand preview). */
import { create } from "zustand";
import type { Point, Rect } from "@/core/types";

interface GestureStore {
  /** marquee / creation preview in design px */
  marquee: Rect | null;
  /** floating label next to the cursor, workspace-relative CSS px */
  hud: { x: number; y: number; text: string } | null;
  /** freehand stroke preview in design px */
  drawPath: Point[] | null;
  /** a gesture is moving/resizing/rotating (hides hover outlines, toolbars dim) */
  active: boolean;
  set(patch: Partial<Omit<GestureStore, "set">>): void;
}

export const useGesture = create<GestureStore>()((set) => ({
  marquee: null,
  hud: null,
  drawPath: null,
  active: false,
  set: (patch) => set(patch),
}));

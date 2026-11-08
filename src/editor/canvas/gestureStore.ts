/** Transient, purely visual gesture state (marquee, HUD tooltip, freehand preview). */
import { create } from "zustand";
import type { PenPath } from "@/core/pen";
import type { ID, Point, Rect } from "@/core/types";

/** The path that the Pen tool is placing (design px): it lasts from the first click until the path is finished. */
export interface PenDraft {
  path: PenPath;
  /** where the pointer is, for the side the next click would make */
  hover: Point | null;
  /** the page the path is being drawn on: it goes there even when another page is chosen before it is finished */
  pageId: ID;
}

interface GestureStore {
  /** marquee / creation preview in design px */
  marquee: Rect | null;
  /** floating label next to the cursor, workspace-relative CSS px */
  hud: { x: number; y: number; text: string } | null;
  /** freehand stroke preview in design px */
  drawPath: Point[] | null;
  /** the path being placed with the Pen tool; unlike the rest it outlives a single pointer gesture */
  pen: PenDraft | null;
  /** a gesture is moving/resizing/rotating (hides hover outlines, toolbars dim) */
  active: boolean;
  set(patch: Partial<Omit<GestureStore, "set">>): void;
}

export const useGesture = create<GestureStore>()((set) => ({
  marquee: null,
  hud: null,
  drawPath: null,
  pen: null,
  active: false,
  set: (patch) => set(patch),
}));

/** The box that carries the selection handles. */
import { boundsOfElements, boxCenter, fromLocalPoint } from "@/core/geometry";
import type { DesignElement, GroupElement, ID, Page } from "@/core/types";
import type { Handle } from "./resize";

/** Page-space box of an element that may live inside groups (positions compose through the group chain). */
export function worldBox(page: Page, id: ID): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const chain: GroupElement[] = [];
  const find = (els: DesignElement[], parents: GroupElement[]): DesignElement | null => {
    for (const e of els) {
      if (e.id === id) {
        chain.push(...parents);
        return e;
      }
      if (e.type === "group") {
        const hit = find(e.children, [...parents, e]);
        if (hit) return hit;
      }
    }
    return null;
  };
  const el = find(page.elements, []);
  if (!el) return null;
  let c = boxCenter(el);
  let rotation = el.rotation;
  for (let i = chain.length - 1; i >= 0; i--) {
    c = fromLocalPoint(chain[i], c);
    rotation += chain[i].rotation;
  }
  return { x: c.x - el.width / 2, y: c.y - el.height / 2, width: el.width, height: el.height, rotation };
}

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** more than one element selected: axis-aligned union box */
  multi: boolean;
}

export function selectionFrame(els: DesignElement[]): Frame | null {
  if (!els.length) return null;
  if (els.length === 1) {
    const e = els[0];
    return { x: e.x, y: e.y, width: e.width, height: e.height, rotation: e.rotation, multi: false };
  }
  const b = boundsOfElements(els)!;
  return { x: b.x, y: b.y, width: b.w, height: b.h, rotation: 0, multi: true };
}

/** Which resize handles an element offers. */
export function handlesFor(els: DesignElement[]): Handle[] {
  if (els.length !== 1) return ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const e = els[0];
  if (e.locked) return [];
  if (e.type === "line") return [];
  if (e.type === "text") return ["nw", "ne", "se", "sw", "e", "w"];
  return ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
}

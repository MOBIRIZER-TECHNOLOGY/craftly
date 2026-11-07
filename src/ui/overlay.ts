/**
 * Overlay plumbing shared by Popover, Tooltip, Menu, Modal and Toast:
 * the lazily created `#cf-overlay-root`, a tiny layer registry (so nested popovers
 * count as "inside" their parent for outside-click handling and get a higher z-index),
 * and the pure placement maths used for flipping / shifting floating panels.
 */

export const OVERLAY_ROOT_ID = "cf-overlay-root";

/** Returns (creating it on first use) the element every overlay is portalled into. */
export function getOverlayRoot(): HTMLElement {
  let el = document.getElementById(OVERLAY_ROOT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = OVERLAY_ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

/* ------------------------------------------------------------------ */
/* Layer registry                                                     */
/* ------------------------------------------------------------------ */

/** Attribute that marks a floating layer (popover panel, modal backdrop). */
export const LAYER_ATTR = "data-cf-layer";

const layerParents = new WeakMap<Element, Element>();
const layerReturnTargets = new WeakMap<Element, HTMLElement>();
let openLayerCount = 0;

/**
 * Records that `layer` was opened from inside `parent` (another layer), and - for a popover - which element to give focus back
 * to when it closes (what had focus when it opened, or its anchor).
 */
export function registerLayer(layer: Element, parent: Element | null, returnTo?: HTMLElement | null): () => void {
  if (parent) layerParents.set(layer, parent);
  if (returnTo) layerReturnTargets.set(layer, returnTo);
  openLayerCount += 1;
  document.body.dataset.cfOverlay = String(openLayerCount);
  return () => {
    layerParents.delete(layer);
    layerReturnTargets.delete(layer);
    openLayerCount = Math.max(0, openLayerCount - 1);
    if (openLayerCount === 0) delete document.body.dataset.cfOverlay;
    else document.body.dataset.cfOverlay = String(openLayerCount);
  };
}

/** Finds the layer element that visually contains the given anchor (element or viewport point). */
export function findParentLayer(anchor: Element | { x: number; y: number } | null): Element | null {
  if (!anchor) return null;
  if (anchor instanceof Element) return anchor.closest(`[${LAYER_ATTR}]`);
  const hit = document.elementFromPoint(anchor.x, anchor.y);
  return hit ? hit.closest(`[${LAYER_ATTR}]`) : null;
}

/**
 * Where focus should go back to when something opened from `el` closes. That is `el` itself, unless it sits in a popover or a
 * menu: those are gone by then, so it is what had focus when the popover opened (a menu item -> the button that opened the
 * menu), and so on for a menu opened from a menu.
 */
export function focusReturnTarget(el: HTMLElement): HTMLElement {
  let node = el;
  for (let guard = 0; guard < 20; guard++) {
    const layer = node.closest(`[${LAYER_ATTR}]`);
    const back = layer ? layerReturnTargets.get(layer) : undefined;
    if (!back || back === node) return node;
    node = back;
  }
  return node;
}

/**
 * True when `target` is inside `root` or inside any layer that was (transitively) opened from `root`.
 * This is what keeps a Select inside a Popover inside a Modal from dismissing its parents.
 */
export function layerContains(root: Element, target: EventTarget | null): boolean {
  let node = target instanceof Node ? target : null;
  let guard = 0;
  while (node && guard++ < 200) {
    if (node === root) return true;
    if (node instanceof Element) {
      const parent = layerParents.get(node);
      if (parent) {
        node = parent;
        continue;
      }
    }
    node = node.parentNode;
  }
  return false;
}

/** z-index a child layer must use to sit directly above `parent` (null when it needs no lift). */
export function zAbove(parent: Element | null): number | null {
  if (!parent) return null;
  // The layer element may be the modal backdrop (z-index set) or a popover panel.
  const z = Number.parseInt(getComputedStyle(parent).zIndex, 10);
  return Number.isFinite(z) ? z + 1 : null;
}

/* ------------------------------------------------------------------ */
/* Placement                                                          */
/* ------------------------------------------------------------------ */

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface ParsedPlacement {
  side: Side;
  align: Align;
}

export function parsePlacement(placement: string): ParsedPlacement {
  const [side, align] = placement.split("-") as [Side, Align | undefined];
  return { side, align: align ?? "center" };
}

export interface BoxLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlaceOptions {
  /** anchor rectangle in viewport coordinates (a point anchor has zero size) */
  anchor: BoxLike;
  /** natural size of the floating element */
  size: { width: number; height: number };
  placement: ParsedPlacement;
  /** gap between anchor and floating element along the main axis */
  offset: number;
  /** shifts the floating element along the cross axis (e.g. to align submenu items) */
  alignOffset?: number;
  /** minimum distance to the viewport edge (default 8) */
  margin?: number;
  /** allow flipping to the opposite side (default true) */
  flip?: boolean;
  /** smallest height a panel may shrink to when neither side fits (default 160) */
  minHeight?: number;
  viewport?: { width: number; height: number };
}

export interface PlaceResult {
  x: number;
  y: number;
  side: Side;
  align: Align;
  /** height the panel should be limited to so it stays inside the viewport */
  maxHeight: number;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Computes the top-left position of a floating box, flipping and shifting it into the viewport. */
export function placeFloating(opts: PlaceOptions): PlaceResult {
  const margin = opts.margin ?? 8;
  const vw = opts.viewport?.width ?? window.innerWidth;
  const vh = opts.viewport?.height ?? window.innerHeight;
  const { anchor, size, offset } = opts;
  const alignOffset = opts.alignOffset ?? 0;
  let { side, align } = opts.placement;
  const flip = opts.flip ?? true;
  const minH = opts.minHeight ?? 160;

  const space = (s: Side): number => {
    switch (s) {
      case "top":
        return anchor.top - offset - margin;
      case "bottom":
        return vh - anchor.bottom - offset - margin;
      case "left":
        return anchor.left - offset - margin;
      default:
        return vw - anchor.right - offset - margin;
    }
  };
  const need = (s: Side): number => (s === "top" || s === "bottom" ? size.height : size.width);

  if (flip && need(side) > space(side) && space(OPPOSITE[side]) > space(side)) {
    side = OPPOSITE[side];
  }

  const vertical = side === "top" || side === "bottom";
  const aw = anchor.right - anchor.left;
  const ah = anchor.bottom - anchor.top;

  // Height the panel is allowed to occupy.
  let h = size.height;
  let maxHeight = vh - margin * 2;
  if (vertical) {
    maxHeight = Math.max(minH, Math.min(maxHeight, space(side)));
    h = Math.min(h, maxHeight);
  } else {
    h = Math.min(h, maxHeight);
  }
  const w = Math.min(size.width, vw - margin * 2);

  const crossStart = (a: Align): number => {
    // x for vertical placements
    if (a === "start") return anchor.left + alignOffset;
    if (a === "end") return anchor.right - w - alignOffset;
    return anchor.left + (aw - w) / 2;
  };
  const crossStartY = (a: Align): number => {
    if (a === "start") return anchor.top + alignOffset;
    if (a === "end") return anchor.bottom - h - alignOffset;
    return anchor.top + (ah - h) / 2;
  };

  let x: number;
  let y: number;
  if (vertical) {
    // Cross-axis flip for start/end alignment: prefer the other edge over clamping on top of the anchor.
    if (align === "start" && crossStart("start") + w > vw - margin && anchor.right - w >= margin) align = "end";
    else if (align === "end" && anchor.right - w < margin && anchor.left + w <= vw - margin) align = "start";
    x = crossStart(align);
    y = side === "top" ? anchor.top - offset - h : anchor.bottom + offset;
  } else {
    x = side === "left" ? anchor.left - offset - w : anchor.right + offset;
    y = crossStartY(align);
  }

  x = Math.min(Math.max(x, margin), Math.max(margin, vw - margin - w));
  y = Math.min(Math.max(y, margin), Math.max(margin, vh - margin - h));

  return { x, y, side, align, maxHeight: vertical ? maxHeight : vh - margin * 2 };
}

/** Rectangle of an anchor given as element or viewport point. */
export function anchorRect(anchor: Element | { x: number; y: number }): BoxLike {
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
}

/**
 * Pointer / wheel / drag-and-drop controller for the workspace.
 *
 * It owns every canvas gesture: selecting, moving (with snapping), resizing,
 * rotating, marquee selection, creating elements with the Tools palette,
 * freehand drawing, panning and zooming. Visuals live in the overlay
 * components; this file only reads/writes the stores.
 */
import { tableCellAt } from "@/core/tableCells";
import { isAcceptedImage, isAcceptedVideo } from "@/core/assets";
import { createLine, createShape, createText } from "@/core/factory";
import {
  boundsOfElements,
  boxBounds,
  boxCenter,
  clamp,
  DEG,
  hitTestElement,
  pageMargin,
  rectFromPoints,
  rectsIntersect,
  rotatePoint,
  snapAngle,
  toLocalPoint,
} from "@/core/geometry";
import { anchorPoint, lineFromRoute } from "@/core/connectors";
import { measureTextElement } from "@/render/textLayout";
import * as ops from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { DesignElement, GroupElement, ID, Point, Rect } from "@/core/types";
import { getDrawStroke } from "@/editor/panels/shared/drawSettings";
import { elementPath } from "@/core/penShape";
import { stopPathEdit, startPathEdit, usePathEdit } from "./pathEditStore";
import { cancelPen, finishPen, forgetPenCursor, hidePenCursor, penCursorShown, penDrag, penHover, penPress } from "./penTool";
import { insertImageFiles, insertPayload, readDragPayload, DRAG_MIME } from "../insert";
import { placeDraft } from "../comments/commentsStore";
import { selectionFrame } from "./frame";
import { useGesture } from "./gestureStore";
import { fingerSpan, pinchZoom, scrollToKeep } from "./pinch";
import { angleToPointer, HANDLE_VEC, isCorner, resizeBox, scaleOf, type BoxLike, type Handle } from "./resize";
import { computeTargets, snapEdges, snapMove, type SnapTargets } from "./snapping";
import { useTableCellEditor } from "./tableCellEditing";

/** The margin elements snap to: the one of the page while margins are shown, none otherwise. */
const shownMargin = (d: { width: number; height: number; margin?: number }): number => (useEditor.getState().showMargins ? pageMargin(d.width, d.height, d.margin) : 0);
const shownGrid = (d: { gridSize?: number }): number => (useEditor.getState().snapToGrid ? (d.gridSize ?? 20) : 0);
import { screenToDesign, setZoomAnchor, useView } from "./viewStore";

/* ------------------------------------------------------------------ */
/* module level hooks other UI plugs into                              */
/* ------------------------------------------------------------------ */

type ContextMenuHandler = (clientX: number, clientY: number, info: { overElement: boolean }) => void;
let contextMenuHandler: ContextMenuHandler | null = null;
/** The toolbar module registers the right-click menu builder here. */
export function setContextMenuHandler(fn: ContextMenuHandler | null): void {
  contextMenuHandler = fn;
}

let pendingCaret: { x: number; y: number } | null = null;
/** Client coordinates where the user double-clicked, consumed once by the text editor overlay. */
export function takePendingCaret(): { x: number; y: number } | null {
  const c = pendingCaret;
  pendingCaret = null;
  return c;
}
let selectAllOnEdit = false;
export function markSelectAllOnEdit(): void {
  selectAllOnEdit = true;
}
export function takeSelectAllOnEdit(): boolean {
  const v = selectAllOnEdit;
  selectAllOnEdit = false;
  return v;
}

/* ------------------------------------------------------------------ */
/* gestures                                                            */
/* ------------------------------------------------------------------ */

interface Base {
  pointerId: number;
  /** coordinate space of a group being edited from the inside */
  space?: GroupElement;
}
interface PanG extends Base {
  kind: "pan";
  x: number;
  y: number;
  left: number;
  top: number;
}
interface MarqueeG extends Base {
  kind: "marquee";
  start: Point;
  base: ID[];
  moved: boolean;
}
interface MoveG extends Base {
  kind: "move";
  ids: ID[];
  start: Point;
  startClient: Point;
  origins: Map<ID, Point>;
  bounds: Rect;
  targets: SnapTargets;
  moved: boolean;
  /** the element that was pressed (for click-to-single-select) */
  pressed: ID;
  wasMulti: boolean;
  shift: boolean;
}
interface ResizeG extends Base {
  kind: "resize";
  handle: Handle;
  ids: ID[];
  orig: DesignElement[];
  frame: BoxLike;
  multi: boolean;
  targets: SnapTargets;
  started: boolean;
}
interface RotateG extends Base {
  kind: "rotate";
  ids: ID[];
  orig: DesignElement[];
  center: Point;
  startAngle: number;
  started: boolean;
}
interface LineG extends Base {
  kind: "line";
  id: ID;
  /** 0 = dragging the start point, 1 = the end point */
  end: 0 | 1;
  fixed: Point;
  started: boolean;
}
interface ConnectG extends Base {
  kind: "connect";
  fromId: ID;
  anchor: "top" | "right" | "bottom" | "left";
  start: Point;
}
interface CreateG extends Base {
  kind: "create";
  tool: "text" | "shape" | "line" | "draw";
  start: Point;
  points: Point[];
  moved: boolean;
}
/** The Pen tool is shaping a point it just placed: the drag pulls its handles out. */
interface PenG extends Base {
  kind: "pen";
  index: number;
}
type Gesture = PanG | MarqueeG | MoveG | ResizeG | RotateG | LineG | ConnectG | CreateG | PenG;

/** Whether the gesture already shows its work: a drag past its threshold, a marquee that selects, a path that has a point. */
function underWay(g: Gesture): boolean {
  switch (g.kind) {
    case "move":
    case "marquee":
    case "create":
      return g.moved;
    case "resize":
    case "rotate":
    case "line":
      return g.started;
    case "pen":
    case "connect":
      return true;
    case "pan":
      return false;
  }
}

/** Two fingers on the canvas: the design point that was between them when they met, how far apart they were, and the zoom then. */
interface Pinch {
  anchor: Point;
  dist: number;
  zoom: number;
}

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 4;
/** Overlays that handle the pointer themselves: fingers on them take no part in a pinch. */
const OWN_POINTER = "[data-cf-text-editor],[data-cf-table-editor],[data-cf-crop],[data-cf-pathedit]";

/* ------------------------------------------------------------------ */

export interface ControllerApi {
  destroy(): void;
  zoomAround(client: { x: number; y: number }, nextZoom: number): void;
}

export function attachController(host: HTMLElement, scroller: HTMLElement): ControllerApi {
  let gesture: Gesture | null = null;
  let pinch: Pinch | null = null;
  // The fingers that may pinch, by pointer id, at their last client position: the first one that came down, and during a
  // pinch the second. A finger that is to be ignored until it lifts is simply not in here.
  const touches = new Map<number, Point>();
  /** the selection as it was before the first finger pressed, which a pinch puts back */
  let selectionBeforeTouch: ID[] = [];
  let spaceDown = false;
  let hoverRaf = 0;
  let lastHoverEvent: PointerEvent | null = null;
  /** where the pointer last was while the Pen was in hand (client px), to tell a pointer that moves from one that only reports */
  let lastPenMove: Point | null = null;

  const st = () => useEditor.getState();
  const act = () => getActions();

  const wsPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toDesign = (e: { clientX: number; clientY: number }): Point => {
    const ws = wsPoint(e);
    const m = { ...useView.getState(), scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop };
    return screenToDesign(m, ws.x, ws.y);
  };
  const zoom = () => st().zoom;
  const px = (n: number) => n / zoom();

  const focusedGroup = (): GroupElement | null => {
    const s = st();
    const page = getActivePage(s);
    const group = s.focusGroupId ? page?.elements.find((el) => el.id === s.focusGroupId) : null;
    return group?.type === "group" ? group : null;
  };
  const inSpace = (pt: Point, space?: GroupElement | null): Point => (space ? toLocalPoint(space, pt) : pt);

  /* ---------------- hit testing ---------------- */

  function hitDeep(el: DesignElement, pt: Point, slop: number): boolean {
    if (el.type !== "group") return hitTestElement(el, pt, slop);
    const l = toLocalPoint(el, pt);
    return el.children.some((c) => !c.hidden && hitDeep(c, l, slop));
  }

  function pickInside(group: GroupElement, pt: Point, slop = px(2)): DesignElement | null {
    const l = toLocalPoint(group, pt);
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      if (!child.hidden && hitDeep(child, l, slop)) return child;
    }
    return null;
  }

  function pick(pt: Point, slop = px(2)): DesignElement | null {
    const page = getActivePage(st());
    if (!page) return null;
    const group = focusedGroup();
    if (group) {
      const child = pickInside(group, pt, slop);
      if (child) return child;
    }
    for (let i = page.elements.length - 1; i >= 0; i--) {
      const el = page.elements[i];
      if (el.id !== group?.id && !el.hidden && hitDeep(el, pt, slop)) return el;
    }
    return null;
  }

  /* ---------------- helpers ---------------- */

  function selectedTop(): DesignElement[] {
    const s = st();
    const page = getActivePage(s);
    if (!page) return [];
    return ops
      .topLevelIds(page, s.selection)
      .map((id) => ops.findElement(page, id))
      .filter((e): e is DesignElement => !!e);
  }

  const hud = (e: { clientX: number; clientY: number }, text: string) => {
    const ws = wsPoint(e);
    useGesture.getState().set({ hud: { x: ws.x + 16, y: ws.y + 18, text } });
  };
  const clearGestureUi = () => useGesture.getState().set({ marquee: null, hud: null, drawPath: null, connector: null, active: false });

  function endGesture(e?: PointerEvent) {
    const g = gesture;
    gesture = null;
    if (e && host.hasPointerCapture?.(e.pointerId)) {
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    if (!g) return;
    act().setGuides([]);
    clearGestureUi();
    host.style.cursor = "";
  }

  /* ---------------- two fingers ---------------- */

  /**
   * A finger came down. Answers true when it began a pinch, and the press is then not looked at any further.
   * The first finger goes on as a press like any other; it is only remembered here.
   */
  function touchDown(e: PointerEvent): boolean {
    const at = { x: e.clientX, y: e.clientY };
    if (touches.size === 0 || touches.has(e.pointerId)) {
      touches.set(e.pointerId, at);
      selectionBeforeTouch = st().selection;
      return false;
    }
    // What the first finger began and already shows goes on, and this finger is ignored like any second pointer: ending a
    // drag here would commit half of it, and taking it back would be a surprise of its own.
    if (gesture && underWay(gesture)) return false;
    // Otherwise the first finger's press was the beginning of the pinch, not a click: its gesture is dropped (it holds no
    // undo step yet) and what the press selected or deselected is put back.
    endGesture();
    if (st().selection !== selectionBeforeTouch) act().select(selectionBeforeTouch);
    touches.set(e.pointerId, at);
    const [a, b] = [...touches.values()];
    const { mid, dist } = fingerSpan(a, b);
    pinch = { anchor: toDesign({ clientX: mid.x, clientY: mid.y }), dist, zoom: zoom() };
    // both fingers report to the workspace from now on, whatever they came down on
    for (const id of touches.keys()) host.setPointerCapture(id);
    return true;
  }

  /** The fingers moved: the zoom follows their distance, and the design point they met on stays between them. */
  function movePinch(p: Pinch) {
    const [a, b] = [...touches.values()];
    const { mid, dist } = fingerSpan(a, b);
    const z = pinchZoom(p.zoom, p.dist, dist, ZOOM_MIN, ZOOM_MAX);
    const screen = wsPoint({ clientX: mid.x, clientY: mid.y });
    const view = useView.getState();
    if (z !== zoom() || view.zoom !== z) {
      // the workspace lays itself out for the new zoom and then scrolls the anchor into place, as for the wheel; while a
      // layout is still to come, the place only has to be brought up to date
      setZoomAnchor({ sx: screen.x, sy: screen.y, dx: p.anchor.x, dy: p.anchor.y });
      act().setZoom(z, "custom");
      return;
    }
    const to = scrollToKeep(p.anchor, screen, view, z);
    scroller.scrollLeft = to.left;
    scroller.scrollTop = to.top;
  }

  /**
   * A pointer lifted, was cancelled or lost its capture. If it was one of two pinching fingers the pinch is over, and
   * the other finger is forgotten too, so that it does nothing until it has lifted and come down again.
   */
  function touchGone(e: PointerEvent) {
    if (!touches.delete(e.pointerId) || !pinch) return;
    pinch = null;
    touches.clear();
  }

  /* ---------------- pointer down ---------------- */

  function onPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cf-ui]")) return;
    const s = st();
    if (!s.design || s.presenting) return;
    // the pointer is in use: the keyboard's point of the Pen goes, and starts on the last point when the arrows ask for it again
    forgetPenCursor();
    const touch = e.pointerType === "touch";
    // The first finger of a touch comes down when no other is on the screen: whatever was remembered of earlier fingers
    // is out of date, should their release never have arrived.
    if (touch && e.isPrimary) {
      pinch = null;
      touches.clear();
    }
    // during a pinch a third finger, or the mouse, starts nothing
    if (pinch) return;
    if (touch && !target.closest(OWN_POINTER) && touchDown(e)) return;
    if (gesture) {
      // a second finger (or pen) while one is dragging starts nothing: taking over here would leave the first drag's undo step
      // open for good, because its release would no longer be recognised
      if (gesture.pointerId !== e.pointerId) return;
      // the same pointer pressing again means the release of the last drag never arrived: that drag is over
      abortGesture(e);
    }
    host.focus({ preventScroll: true });

    if (e.button === 2) {
      selectUnderPointerForMenu(e);
      return;
    }
    if (target.closest("[data-cf-table-editor]")) return;
    useTableCellEditor.getState().close();
    if (s.editingTextId) {
      if (target.closest("[data-cf-text-editor]")) return;
      act().endTextEdit();
    }
    if (s.croppingId && !target.closest("[data-cf-crop]")) act().endCrop();
    else if (s.croppingId) return;
    // pressing anywhere but on the points of a path that is open for point editing is done with it, and goes on as usual
    if (usePathEdit.getState().id) {
      if (target.closest("[data-cf-pathedit]")) return;
      stopPathEdit();
    }

    if (e.button === 1 || spaceDown || s.tool === "hand") {
      e.preventDefault();
      gesture = { kind: "pan", pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      host.setPointerCapture(e.pointerId);
      host.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;

    const handleAttr = target.closest("[data-cf-handle]")?.getAttribute("data-cf-handle");
    if (handleAttr && s.mode === "edit") {
      startHandleGesture(e, handleAttr);
      return;
    }
    if (s.mode === "view") return;
    if (s.tool === "pen") {
      startPen(e);
      return;
    }
    if (s.tool === "comment") {
      // a pin where the page was pressed, on the element there if there is one; its editor takes the keyboard (src/editor/comments)
      e.preventDefault();
      const at = toDesign(e);
      placeDraft(s.design, s.activePageId, at, pick(at));
      return;
    }
    if (s.tool !== "select") {
      startCreate(e, s.tool);
      return;
    }

    const pt = toDesign(e);
    const hit = pick(pt);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const group = focusedGroup();
    if (group && (!hit || !group.children.some((child) => child.id === hit.id))) act().enterGroup(null);

    if (hit) {
      const alreadySelected = s.selection.includes(hit.id);
      if (additive) {
        act().toggleSelect(hit.id);
        if (alreadySelected) return;
      } else if (!alreadySelected) {
        act().select([hit.id]);
      }
      startMove(e, hit.id, alreadySelected && s.selection.length > 1, e.shiftKey);
      return;
    }

    // empty space: marquee (and deselect unless extending)
    if (!additive) act().clearSelection();
    gesture = { kind: "marquee", pointerId: e.pointerId, start: pt, base: additive ? [...s.selection] : [], moved: false };
    host.setPointerCapture(e.pointerId);
  }

  function selectUnderPointerForMenu(e: PointerEvent) {
    const s = st();
    const hit = pick(toDesign(e));
    if (hit && !s.selection.includes(hit.id)) act().select([hit.id]);
    else if (!hit && !(e.target as HTMLElement).closest("[data-cf-handle]")) act().clearSelection();
  }

  function startMove(e: PointerEvent, pressed: ID, wasMulti: boolean, shift: boolean) {
    const els = selectedTop().filter((el) => !el.locked);
    if (!els.length) return;
    const page = getActivePage(st())!;
    const d = st().design!;
    const space = focusedGroup() ?? undefined;
    gesture = {
      kind: "move",
      pointerId: e.pointerId,
      space,
      ids: els.map((x) => x.id),
      start: inSpace(toDesign(e), space),
      startClient: { x: e.clientX, y: e.clientY },
      origins: new Map(els.map((x) => [x.id, { x: x.x, y: x.y }])),
      bounds: boundsOfElements(els)!,
      targets: space ? { xs: [], ys: [] } : computeTargets(page, d.width, d.height, new Set(els.map((x) => x.id)), d.guides, shownMargin(d), shownGrid(d)),
      moved: false,
      pressed,
      wasMulti,
      shift,
    };
    host.setPointerCapture(e.pointerId);
  }

  function startHandleGesture(e: PointerEvent, attr: string) {
    const [kind, arg, side] = attr.split(":");
    if (kind === "connect") {
      const page = getActivePage(st());
      const from = page?.elements.find((el) => el.id === arg);
      if (!from || from.type === "line" || from.locked) return;
      const anchor = side as ConnectG["anchor"];
      const start = anchorPoint(from, anchor);
      e.preventDefault();
      host.setPointerCapture(e.pointerId);
      gesture = { kind: "connect", pointerId: e.pointerId, fromId: from.id, anchor, start };
      useGesture.getState().set({ connector: { start, end: toDesign(e) }, active: true });
      return;
    }
    const els = selectedTop();
    const page = getActivePage(st());
    const d = st().design;
    if (!els.length || !page || !d) return;
    if (els.some((x) => x.locked)) return;
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    const ids = els.map((x) => x.id);
    const space = focusedGroup() ?? undefined;
    if (kind === "move") {
      startMove(e, ids[0], false, false);
      return;
    }
    if (kind === "rotate") {
      const frame = selectionFrame(els)!;
      const center = boxCenter(frame);
      gesture = {
        kind: "rotate",
        pointerId: e.pointerId,
        space,
        ids,
        orig: structuredClone(els),
        center,
        startAngle: angleToPointer(center, inSpace(toDesign(e), space)),
        started: false,
      };
      useGesture.getState().set({ active: true });
      return;
    }
    if (kind === "line") {
      const line = els[0];
      if (line.type !== "line") return;
      const c = boxCenter(line);
      const fixedLocal = { x: arg === "0" ? line.width / 2 : -line.width / 2, y: 0 };
      const fixed = rotatePoint({ x: c.x + fixedLocal.x, y: c.y }, c, line.rotation);
      gesture = { kind: "line", pointerId: e.pointerId, space, id: line.id, end: arg === "0" ? 0 : 1, fixed, started: false };
      useGesture.getState().set({ active: true });
      return;
    }
    if (kind === "resize") {
      const frame = selectionFrame(els)!;
      gesture = {
        kind: "resize",
        pointerId: e.pointerId,
        space,
        handle: arg as Handle,
        ids,
        orig: structuredClone(els),
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: frame.rotation },
        multi: frame.multi,
        targets: space ? { xs: [], ys: [] } : computeTargets(page, d.width, d.height, new Set(ids), d.guides, shownMargin(d), shownGrid(d)),
        started: false,
      };
      useGesture.getState().set({ active: true });
    }
  }

  function startPen(e: PointerEvent) {
    e.preventDefault();
    const press = penPress(toDesign(e), { zoom: zoom(), shift: e.shiftKey });
    if (!press) return;
    gesture = { kind: "pen", pointerId: e.pointerId, index: press.shaping };
    host.setPointerCapture(e.pointerId);
    useGesture.getState().set({ active: true });
  }

  function startCreate(e: PointerEvent, tool: "text" | "shape" | "line" | "draw" | "select" | "hand") {
    if (tool === "select" || tool === "hand") return;
    e.preventDefault();
    const pt = toDesign(e);
    gesture = { kind: "create", pointerId: e.pointerId, tool, start: pt, points: [pt], moved: false };
    host.setPointerCapture(e.pointerId);
    useGesture.getState().set({ active: true });
  }

  /* ---------------- pointer move ---------------- */

  function onPointerMove(e: PointerEvent) {
    const finger = touches.has(e.pointerId);
    if (finger) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (finger) movePinch(pinch);
      return;
    }
    const g = gesture;
    if (!g) {
      if (st().tool === "pen") {
        // A browser also reports a pointer that lies still, when the page scrolls under it, and the page scrolls to follow the
        // keyboard's point: such a report must not take the path away from the keyboard.
        const still = lastPenMove !== null && lastPenMove.x === e.clientX && lastPenMove.y === e.clientY;
        lastPenMove = { x: e.clientX, y: e.clientY };
        if (still && penCursorShown()) return;
        hidePenCursor();
        penHover(toDesign(e), e.shiftKey);
        return;
      }
      lastHoverEvent = e;
      if (!hoverRaf) hoverRaf = requestAnimationFrame(updateHover);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    switch (g.kind) {
      case "pan":
        scroller.scrollLeft = g.left - (e.clientX - g.x);
        scroller.scrollTop = g.top - (e.clientY - g.y);
        break;
      case "marquee":
        moveMarquee(g, e);
        break;
      case "move":
        doMove(g, e);
        break;
      case "resize":
        doResize(g, e);
        break;
      case "rotate":
        doRotate(g, e);
        break;
      case "line":
        doLine(g, e);
        break;
      case "connect":
        useGesture.getState().set({ connector: { start: g.start, end: toDesign(e) } });
        break;
      case "create":
        doCreateMove(g, e);
        break;
      case "pen":
        penDrag(g.index, toDesign(e), zoom());
        break;
    }
  }

  function updateHover() {
    hoverRaf = 0;
    const e = lastHoverEvent;
    if (!e || gesture) return;
    const s = st();
    if (!s.design || s.tool !== "select" || s.editingTextId || s.presenting) {
      if (s.hoverId) act().setHover(null);
      return;
    }
    if ((e.target as HTMLElement).closest?.("[data-cf-ui]")) {
      if (s.hoverId) act().setHover(null);
      return;
    }
    const hit = pick(toDesign(e));
    act().setHover(hit && !s.selection.includes(hit.id) ? hit.id : null);
  }

  function moveMarquee(g: MarqueeG, e: PointerEvent) {
    const pt = toDesign(e);
    if (!g.moved && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) * zoom() < 4) return;
    g.moved = true;
    const rect = rectFromPoints(g.start, pt);
    useGesture.getState().set({ marquee: rect });
    const page = getActivePage(st());
    if (!page) return;
    const hits = page.elements.filter((el) => !el.hidden && rectsIntersect(boxBounds(el), rect)).map((el) => el.id);
    act().select(Array.from(new Set([...g.base, ...hits])));
  }

  function doMove(g: MoveG, e: PointerEvent) {
    const pt = inSpace(toDesign(e), g.space);
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < 3) return;
      g.moved = true;
      act().beginTransaction();
      useGesture.getState().set({ active: true });
      host.style.cursor = "move";
    }
    let dx = pt.x - g.start.x;
    let dy = pt.y - g.start.y;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    let guides: ReturnType<typeof snapMove>["guides"] = [];
    if (st().snapEnabled && !e.ctrlKey && !e.metaKey) {
      const r = snapMove({ x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h }, g.targets, px(6));
      if (!e.shiftKey || dx !== 0) dx += r.dx;
      if (!e.shiftKey || dy !== 0) dy += r.dy;
      guides = r.guides;
    }
    act().updateElements(g.ids, (el) => {
      const o = g.origins.get(el.id);
      if (o) {
        el.x = o.x + dx;
        el.y = o.y + dy;
      }
    });
    act().setGuides(guides);
  }

  /* ---- resize ---- */

  function applyScaleAbout(el: DesignElement, sx: number, sy: number, ax: number, ay: number) {
    el.x -= ax;
    el.y -= ay;
    ops.scaleElement(el, sx, sy);
    el.x += ax;
    el.y += ay;
  }

  function doResize(g: ResizeG, e: PointerEvent) {
    const pt = inSpace(toDesign(e), g.space);
    if (!g.started) {
      g.started = true;
      act().beginTransaction();
    }
    const single = !g.multi ? g.orig[0] : null;
    const type = single?.type;
    const corner = isCorner(g.handle);
    let keepAspect = false;
    if (g.multi) keepAspect = corner && !e.shiftKey;
    else if ((type === "image" || type === "video") && corner) keepAspect = true;
    else if ((type === "graphic" || type === "group" || type === "text") && corner) keepAspect = !e.shiftKey || type === "text";
    else if (type === "shape" && corner) keepAspect = e.shiftKey;
    else if ((type === "table" || type === "chart") && corner) keepAspect = e.shiftKey;
    const widthOnly = type === "text" && !corner;
    const minSize = type === "text" ? 24 : 6;

    let pointer = pt;
    let box = resizeBox(g.frame, g.handle, pointer, { keepAspect, fromCenter: e.altKey, minSize, widthOnly });

    // snap the dragged edges (axis aligned boxes only)
    if (st().snapEnabled && !e.ctrlKey && !e.metaKey && g.frame.rotation === 0) {
      const [hx, hy] = HANDLE_VEC[g.handle];
      const r = snapEdges({ x: box.x, y: box.y, w: box.width, h: box.height }, { left: hx < 0, right: hx > 0, top: hy < 0, bottom: hy > 0 }, g.targets, px(6));
      if (r.dx || r.dy) {
        pointer = { x: pointer.x + (hx !== 0 ? r.dx : 0), y: pointer.y + (hy !== 0 ? r.dy : 0) };
        box = resizeBox(g.frame, g.handle, pointer, { keepAspect, fromCenter: e.altKey, minSize, widthOnly });
      }
      act().setGuides(r.guides);
    }

    const sx = scaleOf(box.width, g.frame.width);
    const sy = scaleOf(box.height, g.frame.height);

    if (g.multi) {
      act().updateElements(g.ids, (el) => {
        const o = g.orig.find((x) => x.id === el.id);
        if (!o) return;
        Object.assign(el, structuredClone(o));
        applyScaleAbout(el, sx, sy, g.frame.x, g.frame.y);
        el.x += box.x - g.frame.x;
        el.y += box.y - g.frame.y;
      });
    } else if (single) {
      act().updateElements(g.ids, (el) => applySingleResize(el, single, box, g.handle, sx, sy));
    }
    hud(e, `${Math.round(box.width)} × ${Math.round(box.height)}`);
  }

  function applySingleResize(el: DesignElement, o: DesignElement, box: BoxLike, handle: Handle, sx: number, sy: number) {
    if (o.type === "text" && el.type === "text") {
      const corner = isCorner(handle);
      if (corner) {
        const s = scaleOf(box.width, o.width);
        el.fontSize = o.fontSize * s;
        el.paragraphs = structuredClone(o.paragraphs);
        for (const p of el.paragraphs) for (const r of p.runs) if (r.size) r.size *= s;
        el.width = o.width * s;
        el.x = box.x;
        el.y = box.y;
      } else {
        el.autoWidth = false;
        el.width = box.width;
        el.x = box.x;
        el.y = box.y;
      }
      return;
    }
    // a clip is framed as a picture is: corners scale it, sides move the frame over it
    if ((o.type === "image" && el.type === "image") || (o.type === "video" && el.type === "video")) {
      const corner = isCorner(handle);
      if (corner) {
        el.x = box.x;
        el.y = box.y;
        el.width = box.width;
        el.height = box.height;
        el.radius = o.radius * ((sx + sy) / 2);
        return;
      }
      // side handles crop: the picture keeps its size and position, the frame moves over it
      const [hx, hy] = HANDLE_VEC[handle];
      const imgX = o.crop.x * o.width;
      const imgY = o.crop.y * o.height;
      const imgW = o.crop.w * o.width;
      const imgH = o.crop.h * o.height;
      const bx = hx < 0 ? o.width - box.width : 0;
      const by = hy < 0 ? o.height - box.height : 0;
      el.x = box.x;
      el.y = box.y;
      el.width = box.width;
      el.height = box.height;
      el.crop = { x: (imgX - bx) / box.width, y: (imgY - by) / box.height, w: imgW / box.width, h: imgH / box.height };
      return;
    }
    if (o.type === "group" && el.type === "group") {
      el.children = structuredClone(o.children);
      for (const c of el.children) ops.scaleElement(c, sx, sy);
      el.x = box.x;
      el.y = box.y;
      el.width = box.width;
      el.height = box.height;
      return;
    }
    if (o.type === "table" && el.type === "table") {
      el.colWidths = o.colWidths.map((w) => w * sx);
      el.rowHeights = o.rowHeights.map((h) => h * sy);
    }
    el.x = box.x;
    el.y = box.y;
    el.width = box.width;
    el.height = box.height;
    if (o.type === "shape" && el.type === "shape") el.radius = o.radius * Math.min(sx, sy);
  }

  /* ---- rotate ---- */

  function doRotate(g: RotateG, e: PointerEvent) {
    if (!g.started) {
      g.started = true;
      act().beginTransaction();
    }
    const ang = angleToPointer(g.center, inSpace(toDesign(e), g.space));
    const delta = ang - g.startAngle;
    const single = g.orig.length === 1;
    const apply = (raw: number) => (e.shiftKey ? Math.round(raw / 15) * 15 : snapAngle(raw, 45, 3));
    if (single) {
      const o = g.orig[0];
      const rot = apply(o.rotation + delta);
      act().updateElements(g.ids, (el) => {
        el.rotation = ((rot % 360) + 360) % 360;
      });
      hud(e, `${Math.round(((rot % 360) + 360) % 360)}°`);
    } else {
      const d = e.shiftKey ? Math.round(delta / 15) * 15 : delta;
      act().updateElements(g.ids, (el) => {
        const o = g.orig.find((x) => x.id === el.id);
        if (!o) return;
        const c = rotatePoint(boxCenter(o), g.center, d);
        el.x = c.x - o.width / 2;
        el.y = c.y - o.height / 2;
        el.rotation = (((o.rotation + d) % 360) + 360) % 360;
      });
      hud(e, `${Math.round(d)}°`);
    }
  }

  /* ---- line endpoints ---- */

  function doLine(g: LineG, e: PointerEvent) {
    if (!g.started) {
      g.started = true;
      act().beginTransaction();
    }
    let p = inSpace(toDesign(e), g.space);
    if (e.shiftKey) {
      const ang = (Math.atan2(p.y - g.fixed.y, p.x - g.fixed.x) * 180) / Math.PI;
      const snapped = Math.round(ang / 15) * 15;
      const len = Math.hypot(p.x - g.fixed.x, p.y - g.fixed.y);
      p = { x: g.fixed.x + Math.cos(snapped * DEG) * len, y: g.fixed.y + Math.sin(snapped * DEG) * len };
    }
    const s = g.end === 1 ? g.fixed : p;
    const t = g.end === 1 ? p : g.fixed;
    const len = Math.max(2, Math.hypot(t.x - s.x, t.y - s.y));
    const angle = Math.atan2(t.y - s.y, t.x - s.x);
    const limitedEnd = { x: s.x + Math.cos(angle) * len, y: s.y + Math.sin(angle) * len };
    act().updateElements([g.id], (el) => {
      if (el.type === "line") Object.assign(el, lineFromRoute(s, limitedEnd, el.routing));
    });
    hud(e, `${Math.round(len)}`);
  }

  /* ---- create ---- */

  function doCreateMove(g: CreateG, e: PointerEvent) {
    const pt = toDesign(e);
    if (!g.moved && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) * zoom() < 4) return;
    g.moved = true;
    if (g.tool === "draw") {
      g.points.push(pt);
      useGesture.getState().set({ drawPath: [...g.points] });
      return;
    }
    if (g.tool === "line") {
      let end = pt;
      if (e.shiftKey) {
        const ang = Math.round((Math.atan2(pt.y - g.start.y, pt.x - g.start.x) * 180) / Math.PI / 15) * 15;
        const len = Math.hypot(pt.x - g.start.x, pt.y - g.start.y);
        end = { x: g.start.x + Math.cos(ang * DEG) * len, y: g.start.y + Math.sin(ang * DEG) * len };
      }
      g.points = [g.start, end];
      useGesture.getState().set({ drawPath: [g.start, end] });
      return;
    }
    const rect = e.shiftKey && g.tool === "shape" ? squareRect(g.start, pt) : rectFromPoints(g.start, pt);
    useGesture.getState().set({ marquee: rect });
    hud(e, `${Math.round(rect.w)} × ${Math.round(rect.h)}`);
  }

  function finishCreate(g: CreateG, e: PointerEvent) {
    const s = st();
    const d = s.design;
    if (!d) return;
    const pt = toDesign(e);
    act().setTool("select");
    if (g.tool === "text") {
      const rect = rectFromPoints(g.start, pt);
      const size = Math.round(Math.min(d.width, d.height) * 0.05);
      const dragged = g.moved && rect.w > 20;
      const el = createText({
        text: "Text",
        fontSize: size,
        x: dragged ? rect.x : g.start.x,
        y: dragged ? rect.y : g.start.y,
        ...(dragged ? { width: rect.w, autoWidth: false } : {}),
      });
      Object.assign(el, measureTextElement(el));
      const id = act().addElement(el, { center: false });
      markSelectAllOnEdit();
      act().startTextEdit(id);
      return;
    }
    if (g.tool === "shape") {
      // with shift held the shape is a square, as the preview showed
      const rect = e.shiftKey ? squareRect(g.start, pt) : rectFromPoints(g.start, pt);
      const fallback = Math.round(Math.min(d.width, d.height) * 0.22);
      const w = g.moved && rect.w > 8 ? rect.w : fallback;
      const h = g.moved && rect.h > 8 ? rect.h : fallback;
      const kind = s.toolShape || "rect";
      const el = createShape(kind, { x: g.moved && rect.w > 8 ? rect.x : g.start.x - w / 2, y: g.moved && rect.h > 8 ? rect.y : g.start.y - h / 2, width: w, height: h });
      act().addElement(el, { center: false });
      return;
    }
    if (g.tool === "line") {
      const [a, b] =
        g.moved && g.points.length > 1
          ? g.points
          : [
              { x: g.start.x - 150, y: g.start.y },
              { x: g.start.x + 150, y: g.start.y },
            ];
      const len = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y));
      const rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      act().addElement(createLine({ x: c.x - len / 2, y: c.y, width: len, rotation: rot }), { center: false });
      return;
    }
    if (g.tool === "draw" && g.points.length > 2) {
      act().setTool("draw");
      const xs = g.points.map((p) => p.x);
      const ys = g.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const w = Math.max(4, Math.max(...xs) - minX);
      const h = Math.max(4, Math.max(...ys) - minY);
      const norm = g.points.map((p) => ({ x: ((p.x - minX) / w) * 100, y: ((p.y - minY) / h) * 100 }));
      const el = createShape("path", {
        x: minX,
        y: minY,
        width: w,
        height: h,
        fill: null,
        path: smoothPath(norm),
        stroke: { ...getDrawStroke(d.width), style: "solid", cap: "round", join: "round" },
      });
      act().addElement(el, { center: false });
    } else if (g.tool === "draw") act().setTool("draw");
  }

  /* ---------------- pointer up ---------------- */

  function onPointerUp(e: PointerEvent) {
    touchGone(e);
    const g = gesture;
    if (!g || g.pointerId !== e.pointerId) return;
    switch (g.kind) {
      case "move":
        if (g.moved) act().endTransaction();
        else if (g.wasMulti && !g.shift) act().select([g.pressed]);
        break;
      case "resize":
      case "rotate":
      case "line":
        if (g.started) act().endTransaction();
        break;
      case "connect": {
        const target = pick(toDesign(e));
        if (target && target.id !== g.fromId && target.type !== "line") act().connect(g.fromId, target.id, { fromAnchor: g.anchor });
        break;
      }
      case "create":
        finishCreate(g, e);
        break;
      default:
        break;
    }
    endGesture(e);
  }

  /** Ends the running gesture without its release: what was changed so far stays, as one undo step. */
  function abortGesture(e: PointerEvent) {
    const g = gesture;
    if (!g) return;
    if ((g.kind === "move" && g.moved) || ((g.kind === "resize" || g.kind === "rotate" || g.kind === "line") && g.started)) act().endTransaction();
    endGesture(e);
  }

  function onPointerCancel(e: PointerEvent) {
    touchGone(e);
    abortGesture(e);
  }

  // A drag can lose its pointer with neither a release nor a cancel (the browser takes the capture away): it ends like a
  // cancelled one. Releasing the capture at the end of a gesture fires this too, but by then there is no gesture left.
  function onLostPointerCapture(e: PointerEvent) {
    touchGone(e);
    if (gesture?.pointerId === e.pointerId) abortGesture(e);
  }

  /* ---------------- double click / context menu ---------------- */

  function onDoubleClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cf-ui],[data-cf-handle],[data-cf-text-editor],[data-cf-table-editor],[data-cf-crop],[data-cf-pathedit]")) return;
    const s = st();
    if (!s.design || s.mode === "view" || s.tool !== "select") return;
    const pt = toDesign(e);
    let hit = pick(pt);
    if (!hit || hit.locked) return;
    if (hit.type === "group") {
      const inner = pickInside(hit, inSpace(pt, focusedGroup()));
      if (!inner) return;
      act().enterGroup(hit.id);
      act().select([inner.id]);
      hit = inner;
      if (hit.locked) return;
    }
    if (hit.type === "text") {
      pendingCaret = { x: e.clientX, y: e.clientY };
      act().startTextEdit(hit.id);
    } else if ((hit.type === "image" || hit.type === "video") && hit.src) {
      act().startCrop(hit.id);
    } else if (hit.type === "shape" && elementPath(hit)) {
      startPathEdit(hit.id);
    } else if (hit.type === "table" || hit.type === "chart") {
      // their content is edited on the page and in the Data panel, for a table on the cell under the pointer
      const cell = hit.type === "table" ? tableCellAt(hit, inSpace(pt, focusedGroup())) : null;
      act().select([hit.id]);
      act().openContext(cell ? { kind: "data", cell } : { kind: "data" });
      if (cell) useTableCellEditor.getState().open(hit.id, cell.row, cell.col);
    }
  }

  function onContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cf-ui],[data-cf-text-editor]")) return;
    e.preventDefault();
    const s = st();
    if (!s.design) return;
    contextMenuHandler?.(e.clientX, e.clientY, { overElement: s.selection.length > 0 });
  }

  /* ---------------- wheel / zoom ---------------- */

  function zoomAround(client: { x: number; y: number }, nextZoom: number) {
    const s = st();
    const d = s.design;
    if (!d) return;
    const z = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    const r = host.getBoundingClientRect();
    const sx = client.x - r.left;
    const sy = client.y - r.top;
    const before = { ...useView.getState(), scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop };
    const anchor = screenToDesign(before, sx, sy);
    setZoomAnchor({ sx, sy, dx: anchor.x, dy: anchor.y });
    act().setZoom(z, "custom");
  }

  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const s = st();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
    zoomAround({ x: e.clientX, y: e.clientY }, s.zoom * factor);
  }

  /* ---------------- drag and drop ---------------- */

  function onDragOver(e: DragEvent) {
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (types.includes(DRAG_MIME) || types.includes("Files")) {
      e.preventDefault();
      // where nothing can be added (View mode, no design) the pointer says so, and the drop is still taken (onDrop)
      const s = st();
      if (e.dataTransfer) e.dataTransfer.dropEffect = s.design && s.mode !== "view" ? "copy" : "none";
    }
  }

  async function onDrop(e: DragEvent) {
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (!types.includes(DRAG_MIME) && !types.includes("Files")) return;
    // taken even where nothing is added: a file left to the browser would open in the tab, in place of the editor
    e.preventDefault();
    const s = st();
    if (!s.design || s.mode === "view") return;
    const pt = toDesign(e);
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => isAcceptedImage(f) || isAcceptedVideo(f));
    if (files.length) {
      await insertImageFiles(files, pt);
      return;
    }
    const payload = readDragPayload(e);
    if (payload) insertPayload(payload, pt);
  }

  /* ---------------- keyboard bits the controller owns ---------------- */

  function onKeyDown(e: KeyboardEvent) {
    if (e.code === "Space" && !isTyping(e.target) && !isInteractiveControl(e.target)) {
      if (!spaceDown) {
        spaceDown = true;
        host.style.cursor = "grab";
      }
      e.preventDefault();
    }
  }
  function releaseSpace() {
    spaceDown = false;
    if (!gesture) host.style.cursor = "";
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space") releaseSpace();
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  host.addEventListener("lostpointercapture", onLostPointerCapture);
  host.addEventListener("dblclick", onDoubleClick);
  host.addEventListener("contextmenu", onContextMenu);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // Space released in another window or tab is never heard of here: once the window loses focus or the page is hidden, the
  // key no longer counts as held, or every click after coming back would pan.
  window.addEventListener("blur", releaseSpace);
  document.addEventListener("visibilitychange", releaseSpace);

  // A path that is being placed is made when another tool is chosen, and when another page is chosen (it goes on the page it was
  // drawn on); it is dropped when the design is closed or another one opened under it. The keyboard's point goes with each of them.
  const stopWatchingTool = useEditor.subscribe((s, prev) => {
    if (prev.tool !== s.tool || prev.design?.id !== s.design?.id || prev.activePageId !== s.activePageId) forgetPenCursor();
    if (prev.tool === "pen" && s.tool !== "pen") finishPen(false, true);
    else if (prev.design?.id !== s.design?.id) cancelPen();
    else if (prev.activePageId !== s.activePageId) finishPen(false, true);
  });

  return {
    zoomAround,
    destroy() {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
      host.removeEventListener("lostpointercapture", onLostPointerCapture);
      host.removeEventListener("dblclick", onDoubleClick);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpace);
      document.removeEventListener("visibilitychange", releaseSpace);
      stopWatchingTool();
      cancelPen();
      forgetPenCursor();
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
    },
  };
}

/** Buttons, sliders, menus and other widgets that own the keyboard when focused (arrows, Enter, Space, Tab). */
export function isInteractiveControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest(
    'button, a[href], summary, select, [role="slider"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="listbox"], [role="spinbutton"], [data-cf-layer]',
  );
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** The square that grows from `start` towards `pt`. */
function squareRect(start: Point, pt: Point): Rect {
  const r = rectFromPoints(start, pt);
  const side = Math.max(r.w, r.h);
  return { x: pt.x < start.x ? start.x - side : start.x, y: pt.y < start.y ? start.y - side : start.y, w: side, h: side };
}

/** Smooth freehand points (0..100 space) into a quadratic SVG path. */
function smoothPath(pts: Point[]): string {
  const thinned = pts.filter((p, i) => i === 0 || i === pts.length - 1 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.6);
  if (thinned.length < 3) return `M${thinned[0].x.toFixed(2)} ${thinned[0].y.toFixed(2)}L${thinned[thinned.length - 1].x.toFixed(2)} ${thinned[thinned.length - 1].y.toFixed(2)}`;
  let d = `M${thinned[0].x.toFixed(2)} ${thinned[0].y.toFixed(2)}`;
  for (let i = 1; i < thinned.length - 1; i++) {
    const mx = (thinned[i].x + thinned[i + 1].x) / 2;
    const my = (thinned[i].y + thinned[i + 1].y) / 2;
    d += `Q${thinned[i].x.toFixed(2)} ${thinned[i].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const last = thinned[thinned.length - 1];
  return d + `L${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

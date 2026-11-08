/**
 * Pointer / wheel / drag-and-drop controller for the workspace.
 *
 * It owns every canvas gesture: selecting, moving (with snapping), resizing,
 * rotating, marquee selection, creating elements with the Tools palette,
 * freehand drawing, panning and zooming. Visuals live in the overlay
 * components; this file only reads/writes the stores.
 */
import { isAcceptedImage } from "@/core/assets";
import { createLine, createShape, createText } from "@/core/factory";
import { boundsOfElements, boxBounds, boxCenter, clamp, DEG, hitTestElement, rectFromPoints, rectsIntersect, rotatePoint, snapAngle, toLocalPoint } from "@/core/geometry";
import { measureTextElement } from "@/render/textLayout";
import * as ops from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { DesignElement, GroupElement, ID, Point, Rect } from "@/core/types";
import { getDrawStroke } from "@/editor/panels/shared/drawSettings";
import { elementPath } from "@/core/penShape";
import { stopPathEdit, startPathEdit, usePathEdit } from "./pathEditStore";
import { cancelPen, finishPen, penDrag, penHover, penPress } from "./penTool";
import { insertImageFiles, insertPayload, readDragPayload, DRAG_MIME } from "../insert";
import { selectionFrame } from "./frame";
import { useGesture } from "./gestureStore";
import { angleToPointer, HANDLE_VEC, isCorner, resizeBox, type BoxLike, type Handle } from "./resize";
import { computeTargets, snapEdges, snapMove, type SnapTargets } from "./snapping";
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
type Gesture = PanG | MarqueeG | MoveG | ResizeG | RotateG | LineG | CreateG | PenG;

/* ------------------------------------------------------------------ */

export interface ControllerApi {
  destroy(): void;
  zoomAround(client: { x: number; y: number }, nextZoom: number): void;
}

export function attachController(host: HTMLElement, scroller: HTMLElement): ControllerApi {
  let gesture: Gesture | null = null;
  let spaceDown = false;
  let hoverRaf = 0;
  let lastHoverEvent: PointerEvent | null = null;

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

  /* ---------------- hit testing ---------------- */

  function hitDeep(el: DesignElement, pt: Point, slop: number): boolean {
    if (el.type !== "group") return hitTestElement(el, pt, slop);
    const l = toLocalPoint(el, pt);
    return el.children.some((c) => !c.hidden && hitDeep(c, l, slop));
  }

  function pick(pt: Point, slop = px(2)): DesignElement | null {
    const page = getActivePage(st());
    if (!page) return null;
    for (let i = page.elements.length - 1; i >= 0; i--) {
      const el = page.elements[i];
      if (!el.hidden && hitDeep(el, pt, slop)) return el;
    }
    return null;
  }

  /** deepest element under the point inside a group (for double-click editing) */
  function pickInside(group: GroupElement, pt: Point): DesignElement | null {
    const l = toLocalPoint(group, pt);
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      if (c.hidden || !hitDeep(c, l, px(2))) continue;
      return c.type === "group" ? (pickInside(c, l) ?? c) : c;
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
  const clearGestureUi = () => useGesture.getState().set({ marquee: null, hud: null, drawPath: null, active: false });

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

  /* ---------------- pointer down ---------------- */

  function onPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cf-ui]")) return;
    const s = st();
    if (!s.design || s.presenting) return;
    host.focus({ preventScroll: true });

    if (e.button === 2) {
      selectUnderPointerForMenu(e);
      return;
    }
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
    if (s.tool !== "select") {
      startCreate(e, s.tool);
      return;
    }

    const pt = toDesign(e);
    const hit = pick(pt);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

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
    gesture = {
      kind: "move",
      pointerId: e.pointerId,
      ids: els.map((x) => x.id),
      start: toDesign(e),
      startClient: { x: e.clientX, y: e.clientY },
      origins: new Map(els.map((x) => [x.id, { x: x.x, y: x.y }])),
      bounds: boundsOfElements(els)!,
      targets: computeTargets(page, d.width, d.height, new Set(els.map((x) => x.id)), d.guides),
      moved: false,
      pressed,
      wasMulti,
      shift,
    };
    host.setPointerCapture(e.pointerId);
  }

  function startHandleGesture(e: PointerEvent, attr: string) {
    const [kind, arg] = attr.split(":");
    const els = selectedTop();
    const page = getActivePage(st());
    const d = st().design;
    if (!els.length || !page || !d) return;
    if (els.some((x) => x.locked)) return;
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    const ids = els.map((x) => x.id);
    if (kind === "move") {
      startMove(e, ids[0], false, false);
      return;
    }
    if (kind === "rotate") {
      const frame = selectionFrame(els)!;
      const center = boxCenter(frame);
      gesture = { kind: "rotate", pointerId: e.pointerId, ids, orig: structuredClone(els), center, startAngle: angleToPointer(center, toDesign(e)), started: false };
      useGesture.getState().set({ active: true });
      return;
    }
    if (kind === "line") {
      const line = els[0];
      if (line.type !== "line") return;
      const c = boxCenter(line);
      const fixedLocal = { x: arg === "0" ? line.width / 2 : -line.width / 2, y: 0 };
      const fixed = rotatePoint({ x: c.x + fixedLocal.x, y: c.y }, c, line.rotation);
      gesture = { kind: "line", pointerId: e.pointerId, id: line.id, end: arg === "0" ? 0 : 1, fixed, started: false };
      useGesture.getState().set({ active: true });
      return;
    }
    if (kind === "resize") {
      const frame = selectionFrame(els)!;
      gesture = {
        kind: "resize",
        pointerId: e.pointerId,
        handle: arg as Handle,
        ids,
        orig: structuredClone(els),
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: frame.rotation },
        multi: frame.multi,
        targets: computeTargets(page, d.width, d.height, new Set(ids), d.guides),
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
    const g = gesture;
    if (!g) {
      if (st().tool === "pen") {
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
    const pt = toDesign(e);
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
    const pt = toDesign(e);
    if (!g.started) {
      g.started = true;
      act().beginTransaction();
    }
    const single = !g.multi ? g.orig[0] : null;
    const type = single?.type;
    const corner = isCorner(g.handle);
    let keepAspect = false;
    if (g.multi) keepAspect = corner && !e.shiftKey;
    else if (type === "image" && corner) keepAspect = true;
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

    const sx = box.width / g.frame.width;
    const sy = box.height / g.frame.height;

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
        const s = box.width / o.width;
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
    if (o.type === "image" && el.type === "image") {
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
    const ang = angleToPointer(g.center, toDesign(e));
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
    let p = toDesign(e);
    if (e.shiftKey) {
      const ang = (Math.atan2(p.y - g.fixed.y, p.x - g.fixed.x) * 180) / Math.PI;
      const snapped = Math.round(ang / 15) * 15;
      const len = Math.hypot(p.x - g.fixed.x, p.y - g.fixed.y);
      p = { x: g.fixed.x + Math.cos(snapped * DEG) * len, y: g.fixed.y + Math.sin(snapped * DEG) * len };
    }
    const s = g.end === 1 ? g.fixed : p;
    const t = g.end === 1 ? p : g.fixed;
    const len = Math.max(2, Math.hypot(t.x - s.x, t.y - s.y));
    const rot = (Math.atan2(t.y - s.y, t.x - s.x) * 180) / Math.PI;
    const c = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
    act().updateElements([g.id], (el) => {
      el.width = len;
      el.rotation = rot;
      el.x = c.x - len / 2;
      el.y = c.y;
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
      case "create":
        finishCreate(g, e);
        break;
      default:
        break;
    }
    endGesture(e);
  }

  function onPointerCancel(e: PointerEvent) {
    const g = gesture;
    if (!g) return;
    if ((g.kind === "move" && g.moved) || ((g.kind === "resize" || g.kind === "rotate" || g.kind === "line") && g.started)) act().endTransaction();
    endGesture(e);
  }

  /* ---------------- double click / context menu ---------------- */

  function onDoubleClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cf-ui],[data-cf-handle],[data-cf-text-editor],[data-cf-crop],[data-cf-pathedit]")) return;
    const s = st();
    if (!s.design || s.mode === "view" || s.tool !== "select") return;
    const pt = toDesign(e);
    const hit = pick(pt);
    if (!hit || hit.locked) return;
    if (hit.type === "text") {
      pendingCaret = { x: e.clientX, y: e.clientY };
      act().startTextEdit(hit.id);
    } else if (hit.type === "image" && hit.src) {
      act().startCrop(hit.id);
    } else if (hit.type === "shape" && elementPath(hit)) {
      startPathEdit(hit.id);
    } else if (hit.type === "group") {
      const inner = pickInside(hit, pt);
      if (inner?.type === "text") {
        pendingCaret = { x: e.clientX, y: e.clientY };
        act().startTextEdit(inner.id, hit.id);
      }
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
    const z = clamp(nextZoom, 0.05, 4);
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
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
  }

  async function onDrop(e: DragEvent) {
    const s = st();
    if (!s.design || s.mode === "view") return;
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (!types.includes(DRAG_MIME) && !types.includes("Files")) return;
    e.preventDefault();
    const pt = toDesign(e);
    const files = Array.from(e.dataTransfer?.files ?? []).filter(isAcceptedImage);
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
  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space") {
      spaceDown = false;
      if (!gesture) host.style.cursor = "";
    }
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  host.addEventListener("dblclick", onDoubleClick);
  host.addEventListener("contextmenu", onContextMenu);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // A path that is being placed is made when another tool is chosen, and when another page is chosen (it goes on the page it was
  // drawn on); it is dropped when the design is closed or another one opened under it.
  const stopWatchingTool = useEditor.subscribe((s, prev) => {
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
      host.removeEventListener("dblclick", onDoubleClick);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      stopWatchingTool();
      cancelPen();
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

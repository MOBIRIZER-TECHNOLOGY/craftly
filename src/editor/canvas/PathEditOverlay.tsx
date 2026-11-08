import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { findElement } from "@/core/ops";
import { insertNode, moveHandle, moveNodes, nearestOnPath, nodeKindOf, pathToString, scalePath, segmentsOf, setNodeKind, type HandleSide, type PenPath } from "@/core/pen";
import { designToLocal, elementPath } from "@/core/penShape";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { Point, ShapeElement } from "@/core/types";
import { applyPath, selectedIn, selectNodes } from "./pathEditActions";
import { stopPathEdit, usePathEdit } from "./pathEditStore";
import { screenToDesign, useView } from "./viewStore";

/** Screen px: the size of a point, of a handle's knob, and how close to a side a press has to be to count as on it. */
const POINT = 9;
const KNOB = 4.5;
const SIDE_REACH = 10;

/**
 * The points and handles of the path that is open for point editing, drawn over it. Pressing a point selects it and dragging
 * moves it (all the selected ones together), pressing a handle reshapes the curve, pressing the path itself adds a point
 * there, and a double click on a point turns it between a corner and a smooth point. A gesture is one step to undo.
 * The element's box changes as the path does (src/core/penShape.ts), so every gesture works from the element as it was when
 * the gesture began.
 */
export function PathEditOverlay() {
  const id = usePathEdit((s) => s.id);
  const selected = usePathEdit((s) => s.selected);
  const zoom = useEditor((s) => s.zoom);
  const shape = useEditor((s) => {
    const page = id && s.design ? getActivePage(s) : null;
    const el = page && id ? findElement(page, id) : null;
    return el?.type === "shape" ? el : null;
  });
  const onlySelected = useEditor((s) => s.selection.length === 1 && s.selection[0] === id);
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const presenting = useEditor((s) => s.presenting);
  const path = useMemo(() => (shape ? elementPath(shape) : null), [shape]);
  const usable = !!shape && !shape.locked && !!path && onlySelected && tool === "select" && mode === "edit" && !presenting;

  // leave point editing when what it needs is gone
  useEffect(() => {
    if (id && !usable) stopPathEdit();
  }, [id, usable]);

  if (!id || !shape || !path || !usable) return null;
  const chosen = selectedIn(path, selected);
  const scaled = scalePath(path, zoom);

  /* ---------------- gestures ---------------- */

  /**
   * The pointer, in pixels of the element's own box (the box as it was when the gesture began). The view metrics count from
   * the corner of the workspace, so the workspace's place on the screen comes off first.
   */
  const localOf = (el: ShapeElement, e: { clientX: number; clientY: number }): Point => {
    const origin = document.querySelector("[data-cf-workspace]")?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return designToLocal(el, screenToDesign(useView.getState(), e.clientX - origin.left, e.clientY - origin.top));
  };

  /** Follows the pointer while it is down; one undo step for the whole gesture. */
  function track(e: ReactPointerEvent, el: ShapeElement, onMove: (delta: Point, ev: PointerEvent) => void, onEnd?: (moved: boolean) => void): void {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    const start = localOf(el, e);
    const startAt = { x: e.clientX, y: e.clientY };
    const actions = getActions();
    actions.beginTransaction();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startAt.x, ev.clientY - startAt.y) < 2) return;
      moved = true;
      const at = localOf(el, ev);
      onMove({ x: at.x - start.x, y: at.y - start.y }, ev);
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      actions.endTransaction();
      onEnd?.(moved);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  /** Moves the points in `indices` of `from` as the pointer moves. */
  function dragPoints(e: ReactPointerEvent, el: ShapeElement, from: PenPath, indices: number[], onEnd?: (moved: boolean) => void): void {
    track(e, el, (d) => applyPath(el, moveNodes(from, indices, d.x, d.y)), onEnd);
  }

  const pressPoint = (e: ReactPointerEvent, index: number) => {
    if (e.button !== 0) return;
    const keep = chosen.includes(index);
    let next = chosen;
    if (e.shiftKey) next = keep ? chosen.filter((i) => i !== index) : [...chosen, index];
    else if (!keep) next = [index];
    selectNodes(next);
    if (!next.includes(index)) {
      e.stopPropagation();
      return;
    }
    dragPoints(e, shape, path, next, (moved) => {
      // a click on one of several selected points picks just that one
      if (!moved && !e.shiftKey && next.length > 1) selectNodes([index]);
    });
  };

  /** `offset` is where the handle is, from its point, in pixels of the element's own box. */
  const pressHandle = (e: ReactPointerEvent, index: number, which: HandleSide, offset: Point) => {
    if (e.button !== 0) return;
    const node = path.nodes[index];
    track(e, shape, (d, ev) =>
      applyPath(shape, moveHandle(path, index, which, { x: node.x + offset.x + d.x, y: node.y + offset.y + d.y }, { breakSymmetry: ev.altKey, mirror: ev.shiftKey })),
    );
  };

  const pressSide = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const hit = nearestOnPath(path, localOf(shape, e), SIDE_REACH / zoom);
    if (!hit) return;
    const inserted = insertNode(path, hit.segment, hit.t);
    const index = hit.segment + 1;
    dragPoints(e, shape, inserted, [index]);
    // started after the gesture began, so that the new point and the drag after it are one step to undo
    applyPath(shape, inserted);
    selectNodes([index]);
  };

  const toggleKind = (index: number) => {
    const next = setNodeKind(path, index, nodeKindOf(path, index) === "smooth" ? "corner" : "smooth");
    applyPath(shape, next);
    selectNodes([index]);
  };

  /* ---------------- drawing ---------------- */

  const flips = shape.flipH || shape.flipV ? `scale(${shape.flipH ? -1 : 1}, ${shape.flipV ? -1 : 1})` : undefined;
  const side = (curve: ReturnType<typeof segmentsOf>[number]) => `M${curve[0].x} ${curve[0].y}C${curve[1].x} ${curve[1].y} ${curve[2].x} ${curve[2].y} ${curve[3].x} ${curve[3].y}`;

  return (
    <div
      className="cf-pathedit"
      data-cf-pathedit
      style={{
        left: shape.x * zoom,
        top: shape.y * zoom,
        width: shape.width * zoom,
        height: shape.height * zoom,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
      }}
    >
      <svg className="cf-pathedit__svg" style={{ transform: flips }} aria-hidden="true">
        <path className="cf-pathedit__outline" d={pathToString(scaled)} />
        {segmentsOf(scaled).map((curve, i) => (
          <path key={`side${i}`} className="cf-pathedit__segment" d={side(curve)} onPointerDown={pressSide} />
        ))}
        {chosen.flatMap((index) =>
          (["in", "out"] as const).map((which) => {
            const node = scaled.nodes[index];
            const handle = which === "in" ? node.handleIn : node.handleOut;
            const offset = which === "in" ? path.nodes[index].handleIn : path.nodes[index].handleOut;
            if (!handle || !offset) return null;
            return (
              <g key={`${index}${which}`}>
                <line className="cf-pathedit__stem" x1={node.x} y1={node.y} x2={node.x + handle.x} y2={node.y + handle.y} />
                <circle className="cf-pathedit__handle" cx={node.x + handle.x} cy={node.y + handle.y} r={KNOB} onPointerDown={(e) => pressHandle(e, index, which, offset)} />
              </g>
            );
          }),
        )}
        {scaled.nodes.map((node, i) => {
          const isSelected = chosen.includes(i);
          const kind = nodeKindOf(path, i);
          return (
            <rect
              key={`point${i}`}
              className={`cf-pathedit__anchor${isSelected ? " is-selected" : ""}${kind === "smooth" ? " is-smooth" : ""}`}
              x={node.x - POINT / 2}
              y={node.y - POINT / 2}
              width={POINT}
              height={POINT}
              rx={kind === "smooth" ? POINT / 2 : 1}
              onPointerDown={(e) => pressPoint(e, i)}
              onDoubleClick={() => toggleKind(i)}
            />
          );
        })}
      </svg>
    </div>
  );
}

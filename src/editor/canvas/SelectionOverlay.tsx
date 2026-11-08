import { Move, RotateCw } from "lucide-react";
import type { CSSProperties } from "react";
import { getActivePage, useEditor, useSelectedElements } from "@/core/store";
import type { DesignElement } from "@/core/types";
import { handlesFor, selectionFrame } from "./frame";
import { useGesture } from "./gestureStore";
import { usePathEdit } from "./pathEditStore";
import { PenPreview } from "./PenPreview";
import { handleFraction, type Handle } from "./resize";

const boxStyle = (b: { x: number; y: number; width: number; height: number; rotation: number }, z: number): CSSProperties => ({
  left: b.x * z,
  top: b.y * z,
  width: b.width * z,
  height: b.height * z,
  transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
});

const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/** Outline, resize / rotate / move handles of the current selection, plus hover outline. */
export function SelectionOverlay() {
  const zoom = useEditor((s) => s.zoom);
  const els = useSelectedElements();
  const editing = useEditor((s) => s.editingTextId);
  const cropping = useEditor((s) => s.croppingId);
  const pathEditing = usePathEdit((s) => s.id !== null);
  const hoverId = useEditor((s) => s.hoverId);
  const mode = useEditor((s) => s.mode);
  const tool = useEditor((s) => s.tool);
  const active = useGesture((s) => s.active);
  const hover = useEditor((s) => {
    const page = getActivePage(s);
    return page && s.hoverId ? (page.elements.find((e) => e.id === s.hoverId) ?? null) : null;
  });
  void hoverId;
  if (mode === "view") return null;

  const frame = selectionFrame(els);
  const locked = els.some((e) => e.locked);
  const handles = !cropping && !pathEditing && !editing && tool === "select" ? handlesFor(els) : [];
  const single = els.length === 1 ? els[0] : null;
  const isLine = single?.type === "line";

  return (
    <>
      {hover && !active && hover.type !== "line" && <div className="cf-outline cf-outline--hover" style={boxStyle(hover, zoom)} />}

      {els.length > 1 && els.map((e) => <div key={e.id} className="cf-outline cf-outline--item" style={boxStyle(e, zoom)} />)}

      {frame && !isLine && !cropping && !pathEditing && (
        <div className={`cf-sel${locked ? " cf-sel--locked" : ""}${editing ? " cf-sel--editing" : ""}`} style={boxStyle(frame, zoom)}>
          <div className="cf-sel__outline" />
          {handles.map((h) => {
            const [fx, fy] = handleFraction(h);
            const corner = h.length === 2;
            return (
              <div
                key={h}
                className={`cf-handle ${corner ? "cf-handle--corner" : h === "n" || h === "s" ? "cf-handle--h" : "cf-handle--v"}`}
                data-cf-handle={`resize:${h}`}
                style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: CURSOR[h] }}
              />
            );
          })}
          {!locked && !editing && tool === "select" && (
            <>
              <div className="cf-handle cf-handle--rotate" data-cf-handle="rotate" title="Rotate" style={{ left: "50%", top: `calc(100% + 30px)` }}>
                <RotateCw size={14} strokeWidth={2.4} />
              </div>
              <div className="cf-handle cf-handle--move" data-cf-handle="move" title="Move" style={{ left: "50%", top: `calc(100% + 30px)`, marginLeft: 38 }}>
                <Move size={13} strokeWidth={2.4} />
              </div>
            </>
          )}
        </div>
      )}

      {single && isLine && !locked && <LineHandles el={single} zoom={zoom} />}
    </>
  );
}

function LineHandles({ el, zoom }: { el: DesignElement; zoom: number }) {
  return (
    <div className="cf-sel cf-sel--line" style={boxStyle(el, zoom)}>
      <div className="cf-handle cf-handle--corner" data-cf-handle="line:0" style={{ left: 0, top: 0, cursor: "crosshair" }} />
      <div className="cf-handle cf-handle--corner" data-cf-handle="line:1" style={{ left: "100%", top: 0, cursor: "crosshair" }} />
    </div>
  );
}

/** Pink smart guides while moving / resizing. */
export function SnapGuides() {
  const guides = useEditor((s) => s.snapGuides);
  const zoom = useEditor((s) => s.zoom);
  return (
    <>
      {guides.map((g, i) =>
        g.axis === "v" ? (
          <div key={i} className="cf-guide cf-guide--v" style={{ left: g.pos * zoom, top: g.from * zoom, height: (g.to - g.from) * zoom }} />
        ) : (
          <div key={i} className="cf-guide cf-guide--h" style={{ top: g.pos * zoom, left: g.from * zoom, width: (g.to - g.from) * zoom }} />
        ),
      )}
    </>
  );
}

/** Marquee rectangle and freehand preview. */
export function GesturePreview() {
  const zoom = useEditor((s) => s.zoom);
  const marquee = useGesture((s) => s.marquee);
  const path = useGesture((s) => s.drawPath);
  return (
    <>
      <PenPreview />
      {marquee && <div className="cf-marquee" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.w * zoom, height: marquee.h * zoom }} />}
      {path && path.length > 1 && (
        <svg className="cf-drawpreview">
          <polyline points={path.map((p) => `${p.x * zoom},${p.y * zoom}`).join(" ")} />
        </svg>
      )}
    </>
  );
}

/** Size / angle label that follows the pointer during a gesture. */
export function GestureHud() {
  const hud = useGesture((s) => s.hud);
  if (!hud) return null;
  return (
    <div className="cf-hud" style={{ left: hud.x, top: hud.y }}>
      {hud.text}
    </div>
  );
}

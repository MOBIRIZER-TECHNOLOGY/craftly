import { Link as LinkIcon, Move, RotateCw } from "lucide-react";
import type { CSSProperties } from "react";
import { boxBounds, unionRects } from "@/core/geometry";
import { linePath } from "@/core/lineRoute";
import { findElement } from "@/core/ops";
import { getActivePage, useEditor, useSelectedElements } from "@/core/store";
import type { DesignElement, Page } from "@/core/types";
import { m } from "@/i18n";
import { handlesFor, inkBox, worldBox } from "./frame";
import { useGesture } from "./gestureStore";
import { usePathEdit } from "./pathEditStore";
import { PenCursor } from "./PenCursor";
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

function pageFrame(page: Page | null, els: DesignElement[]) {
  if (!page || !els.length) return null;
  if (els.length === 1) return { ...worldBox(page, els[0].id)!, multi: false };
  const boxes = els.map((el) => worldBox(page, el.id)).filter((box): box is NonNullable<typeof box> => !!box);
  const bounds = unionRects(boxes.map(boxBounds));
  return bounds ? { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, rotation: 0, multi: true } : null;
}

/** Outline, resize / rotate / move handles of the current selection, plus hover outline. */
export function SelectionOverlay() {
  const zoom = useEditor((s) => s.zoom);
  const page = useEditor((s) => getActivePage(s));
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
    return page && s.hoverId ? findElement(page, s.hoverId) : null;
  });
  void hoverId;
  if (mode === "view") return null;

  const single = els.length === 1 ? els[0] : null;
  // a text's frame holds the ink that reaches past its box (a Devanagari letter in a fallback font)
  const box = pageFrame(page, els);
  const frame = box && single ? inkBox(box, single) : box;
  const locked = els.some((e) => e.locked);
  const handles = !cropping && !pathEditing && !editing && tool === "select" ? handlesFor(els) : [];
  const isLine = single?.type === "line";
  const route = single?.type === "line" ? linePath(single) : [];

  return (
    <>
      {hover && !active && hover.type !== "line" && <div className="cf-outline cf-outline--hover" style={boxStyle(inkBox(worldBox(page, hover.id) ?? hover, hover), zoom)} />}

      {els.length > 1 && els.map((e) => <div key={e.id} className="cf-outline cf-outline--item" style={boxStyle(worldBox(page, e.id) ?? e, zoom)} />)}

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
              <div className="cf-handle cf-handle--rotate" data-cf-handle="rotate" title={m.editor.canvas.rotate} style={{ left: "50%", top: `calc(100% + 30px)` }}>
                <RotateCw size={14} strokeWidth={2.4} />
              </div>
              <div className="cf-handle cf-handle--move" data-cf-handle="move" title={m.editor.canvas.move} style={{ left: "50%", top: `calc(100% + 30px)`, marginLeft: 38 }}>
                <Move size={13} strokeWidth={2.4} />
              </div>
            </>
          )}
        </div>
      )}

      {single && isLine && !locked && frame && <LineHandles box={frame} zoom={zoom} path={route} />}
      {single?.link?.trim() && frame ? (
        <span className="cf-linkmark" data-cf-linkmark title={single.link} aria-label={single.link} style={{ left: frame.x * zoom - 11, top: frame.y * zoom - 11 }}>
          <LinkIcon size={12} aria-hidden="true" />
        </span>
      ) : null}
      {/* not while points, a crop or a text are edited: the anchors would lie over the points and take their drags */}
      {!active && !pathEditing && !cropping && !editing && <ConnectorAnchors page={page} hover={hover} zoom={zoom} />}
    </>
  );
}

function LineHandles({ box, zoom, path }: { box: { x: number; y: number; width: number; height: number; rotation: number }; zoom: number; path: { x: number; y: number }[] }) {
  const first = path[0];
  const last = path[path.length - 1];
  return (
    <div className="cf-sel cf-sel--line" style={boxStyle(box, zoom)}>
      <div className="cf-handle cf-handle--corner" data-cf-handle="line:0" style={{ left: first.x * zoom, top: first.y * zoom, cursor: "crosshair" }} />
      <div className="cf-handle cf-handle--corner" data-cf-handle="line:1" style={{ left: `${(last.x / box.width) * 100}%`, top: last.y * zoom, cursor: "crosshair" }} />
    </div>
  );
}

function ConnectorAnchors({ page, hover, zoom }: { page: Page | null; hover: DesignElement | null; zoom: number }) {
  const el = hover;
  if (!page || !el || el.locked || el.type === "line" || !page.elements.some((item) => item.id === el.id)) return null;
  const box = worldBox(page, el.id);
  if (!box) return null;
  const anchors = [
    ["top", 50, 0],
    ["right", 100, 50],
    ["bottom", 50, 100],
    ["left", 0, 50],
  ] as const;
  return (
    <div className="cf-sel" style={boxStyle(box, zoom)}>
      {anchors.map(([side, x, y]) => (
        <div
          key={side}
          className="cf-handle cf-handle--corner"
          data-cf-handle={`connect:${el.id}:${side}`}
          title={m.editor.actions.connect}
          style={{ left: `${x}%`, top: `${y}%`, cursor: "crosshair" }}
        />
      ))}
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

/** Marquee rectangle and freehand preview, the path of the Pen and its keyboard point. */
export function GesturePreview() {
  const zoom = useEditor((s) => s.zoom);
  const marquee = useGesture((s) => s.marquee);
  const path = useGesture((s) => s.drawPath);
  const connector = useGesture((s) => s.connector);
  return (
    <>
      <PenPreview />
      <PenCursor />
      {marquee && <div className="cf-marquee" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.w * zoom, height: marquee.h * zoom }} />}
      {path && path.length > 1 && (
        <svg className="cf-drawpreview">
          <polyline points={path.map((p) => `${p.x * zoom},${p.y * zoom}`).join(" ")} />
        </svg>
      )}
      {connector && (
        <svg className="cf-drawpreview" data-cf-connector-preview>
          <line x1={connector.start.x * zoom} y1={connector.start.y * zoom} x2={connector.end.x * zoom} y2={connector.end.y * zoom} />
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

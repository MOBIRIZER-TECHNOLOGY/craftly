import { useEffect, useState } from "react";
import { clamp, DEG, fromLocalPoint } from "@/core/geometry";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { ImageCrop, ImageElement } from "@/core/types";
import { m } from "@/i18n";
import { imageUrl } from "@/render/images";
import { useDragEnd } from "./dragEnd";
import { HANDLE_VEC, type Handle } from "./resize";

/* ------------------------------------------------------------------ */
/* crop maths (exported for the toolbar's zoom slider)                 */
/* ------------------------------------------------------------------ */

/** Keeps the picture covering the whole frame. */
export function clampCrop(c: ImageCrop): ImageCrop {
  const x = Math.min(0, Math.max(1 - c.w, c.x));
  const y = Math.min(0, Math.max(1 - c.h, c.y));
  return { x, y, w: c.w, h: c.h };
}

/** Width of the picture that exactly covers the frame, in design px. */
const coverWidth = (el: ImageElement) => Math.max(el.width, (el.height * el.naturalWidth) / el.naturalHeight);

/** 1 = the picture just covers the frame; larger values zoom into it. */
export const getCropScale = (el: ImageElement) => (el.crop.w * el.width) / coverWidth(el);

/** Zooms the picture inside its frame, keeping the visible centre. */
export function setCropScale(id: string, scale: number): void {
  const page = getActivePage(useEditor.getState());
  const el = page && findElement(page, id);
  if (!el || el.type !== "image") return;
  const s = Math.max(1, Math.min(8, scale));
  getActions().updateElements(
    [id],
    (d) => {
      if (d.type !== "image") return;
      const cx = (0.5 - d.crop.x) / d.crop.w;
      const cy = (0.5 - d.crop.y) / d.crop.h;
      const iw = coverWidth(d) * s;
      const ih = (iw * d.naturalHeight) / d.naturalWidth;
      const w = iw / d.width;
      const h = ih / d.height;
      d.crop = clampCrop({ x: 0.5 - cx * w, y: 0.5 - cy * h, w, h });
    },
    { coalesce: `cropzoom:${id}` },
  );
}

/** Restores the default "cover" crop. */
export function resetCrop(id: string): void {
  setCropScale(id, 1);
  getActions().updateElements([id], (d) => {
    if (d.type === "image") d.crop = clampCrop({ x: (1 - d.crop.w) / 2, y: (1 - d.crop.h) / 2, w: d.crop.w, h: d.crop.h });
  });
}

/* ------------------------------------------------------------------ */

export function CropOverlay() {
  const id = useEditor((s) => s.croppingId);
  const page = useEditor((s) => getActivePage(s));
  const zoom = useEditor((s) => s.zoom);
  if (!id || !page) return null;
  const el = findElement(page, id);
  if (!el || el.type !== "image" || !el.src) return null;
  return <Crop el={el} zoom={zoom} />;
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function Crop({ el, zoom }: { el: ImageElement; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const dragEnd = useDragEnd();
  useEffect(() => {
    let live = true;
    void imageUrl(el.src as string).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [el.src]);

  const W = el.width * zoom;
  const H = el.height * zoom;
  const img = { left: el.crop.x * W, top: el.crop.y * H, width: el.crop.w * W, height: el.crop.h * H };
  const actions = getActions();

  /** client delta -> element-local design px */
  const toLocal = (dx: number, dy: number) => {
    const a = -el.rotation * DEG;
    const x = dx / zoom;
    const y = dy / zoom;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  };

  const track = (e: React.PointerEvent, onMove: (d: { x: number; y: number }) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    actions.beginTransaction();
    const move = (ev: PointerEvent) => onMove(toLocal(ev.clientX - sx, ev.clientY - sy));
    // once, whichever comes first: the pointer is released, cancelled or loses its capture, or the crop closes (useDragEnd)
    const up = () => {
      if (dragEnd.current !== up) return;
      dragEnd.current = null;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      target.removeEventListener("lostpointercapture", up);
      actions.endTransaction();
    };
    dragEnd.current?.();
    dragEnd.current = up;
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    target.addEventListener("lostpointercapture", up);
  };

  const startPan = (e: React.PointerEvent) => {
    const o = el.crop;
    track(e, (d) =>
      actions.updateElements([el.id], (n) => {
        if (n.type === "image") n.crop = clampCrop({ ...o, x: o.x + d.x / el.width, y: o.y + d.y / el.height });
      }),
    );
  };

  const startFrame = (e: React.PointerEvent, handle: Handle) => {
    const [hx, hy] = HANDLE_VEC[handle];
    const o = { ...el, crop: { ...el.crop } };
    const ix = o.crop.x * o.width;
    const iy = o.crop.y * o.height;
    const iw = o.crop.w * o.width;
    const ih = o.crop.h * o.height;
    const MIN = 24;
    track(e, (d) => {
      let left = 0;
      let top = 0;
      let right = o.width;
      let bottom = o.height;
      if (hx < 0) left = clamp(d.x, Math.max(ix, 0 - o.width), right - MIN);
      if (hx > 0) right = clamp(o.width + d.x, left + MIN, ix + iw);
      if (hy < 0) top = clamp(d.y, Math.max(iy, 0 - o.height), bottom - MIN);
      if (hy > 0) bottom = clamp(o.height + d.y, top + MIN, iy + ih);
      if (hx < 0) left = Math.max(left, ix);
      if (hy < 0) top = Math.max(top, iy);
      const w = right - left;
      const h = bottom - top;
      const c = fromLocalPoint(o, { x: left + w / 2, y: top + h / 2 });
      actions.updateElements([el.id], (n) => {
        if (n.type !== "image") return;
        n.x = c.x - w / 2;
        n.y = c.y - h / 2;
        n.width = w;
        n.height = h;
        n.crop = { x: (ix - left) / w, y: (iy - top) / h, w: iw / w, h: ih / h };
      });
    });
  };

  return (
    <div
      className="cf-crop"
      data-cf-crop
      style={{ left: el.x * zoom, top: el.y * zoom, width: W, height: H, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}
      onWheel={(e) => {
        e.stopPropagation();
        setCropScale(el.id, getCropScale(el) * Math.exp(-e.deltaY * 0.0015));
      }}
    >
      {url && <img className="cf-crop__ghost" src={url} alt="" draggable={false} style={img} />}
      <div className="cf-crop__window" onPointerDown={startPan}>
        {url && <img className="cf-crop__live" src={url} alt="" draggable={false} style={img} />}
      </div>
      {HANDLES.map((h) => (
        <div key={h} className={`cf-crop__handle cf-crop__handle--${h}`} onPointerDown={(e) => startFrame(e, h)} />
      ))}
      <button type="button" className="cf-crop__done" onPointerDown={(e) => e.stopPropagation()} onClick={() => actions.endCrop()}>
        {m.common.done}
      </button>
    </div>
  );
}

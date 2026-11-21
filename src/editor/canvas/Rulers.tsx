import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { useDragEnd } from "./dragEnd";
import { designToScreen, screenToDesign, useView } from "./viewStore";

export const RULER = 22;

/** Smallest "nice" step (design px) that is at least `minPx` wide on screen. */
function niceStep(zoom: number, minPx: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  return steps.find((s) => s * zoom >= minPx) ?? 10000;
}

function drawRuler(canvas: HTMLCanvasElement, horizontal: boolean, designSize: number) {
  const v = useView.getState();
  const dpr = window.devicePixelRatio || 1;
  const len = horizontal ? v.width - RULER : v.height - RULER;
  const w = horizontal ? len : RULER;
  const h = horizontal ? RULER : len;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const z = v.zoom;
  const origin = horizontal ? v.pageLeft - v.scrollLeft - RULER : v.pageTop - v.scrollTop - RULER; // screen px of design 0
  // the page extent is lighter
  ctx.fillStyle = "rgba(124,58,237,0.10)";
  if (horizontal) ctx.fillRect(origin, 0, designSize * z, h);
  else ctx.fillRect(0, origin, w, designSize * z);

  const major = niceStep(z, 70);
  const minor = major / (major >= 10 ? 10 : major >= 5 ? 5 : 2);
  const from = Math.floor(-origin / z / minor) * minor;
  const to = (len - origin) / z;
  ctx.strokeStyle = "#9aa1ad";
  ctx.fillStyle = "#666d7a";
  ctx.font = "600 10px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = from; d <= to; d += minor) {
    const p = Math.round(origin + d * z) + 0.5;
    const isMajor = Math.abs(d / major - Math.round(d / major)) < 1e-6;
    const isMid = !isMajor && Math.abs((d / major) * 2 - Math.round((d / major) * 2)) < 1e-6;
    const size = isMajor ? RULER : isMid ? RULER * 0.45 : RULER * 0.28;
    if (horizontal) {
      ctx.moveTo(p, h);
      ctx.lineTo(p, h - size);
    } else {
      ctx.moveTo(w, p);
      ctx.lineTo(w - size, p);
    }
  }
  ctx.stroke();
  for (let d = Math.ceil(from / major) * major; d <= to; d += major) {
    const p = origin + d * z;
    const label = String(Math.round(d));
    if (horizontal) ctx.fillText(label, p + 3, 3);
    else {
      ctx.save();
      ctx.translate(3, p + 3);
      ctx.rotate(Math.PI / 2);
      ctx.translate(0, -12);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}

/** Top and left rulers. Dragging out of a ruler drops a guide onto the page. */
export function Rulers() {
  const show = useEditor((s) => s.showRulers);
  const design = useEditor((s) => s.design);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<{ axis: "v" | "h"; pos: number } | null>(null);

  useEffect(() => {
    if (!show || !design) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (topRef.current) drawRuler(topRef.current, true, design.width);
      if (leftRef.current) drawRuler(leftRef.current, false, design.height);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    schedule();
    const unsub = useView.subscribe(schedule);
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [show, design?.width, design?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show || !design) return null;

  const startGuide = (e: ReactPointerEvent, axis: "v" | "h") => {
    e.preventDefault();
    e.stopPropagation();
    const host = (e.currentTarget as HTMLElement).closest(".cf-workspace") as HTMLElement;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const toPos = (ev: { clientX: number; clientY: number }) => {
      const r = host.getBoundingClientRect();
      const v = useView.getState();
      const d = screenToDesign(v, ev.clientX - r.left, ev.clientY - r.top);
      return { pos: axis === "v" ? d.x : d.y, inside: ev.clientX - r.left > RULER && ev.clientY - r.top > RULER };
    };
    const move = (ev: PointerEvent) => setDraft({ axis, pos: toPos(ev).pos });
    // a cancelled drag (the browser took the pointer away) ends like a released one, except that it drops no guide
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      const { pos, inside } = toPos(ev);
      setDraft(null);
      if (inside && ev.type !== "pointercancel") useEditor.getState().actions.addGuide(axis, pos);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    setDraft({ axis, pos: toPos(e.nativeEvent).pos });
  };

  return (
    <>
      <div className="cf-ruler__corner" data-cf-ui style={{ width: RULER, height: RULER }} />
      <div className="cf-ruler cf-ruler--top" data-cf-ui style={{ left: RULER, height: RULER }} onPointerDown={(e) => startGuide(e, "h")} title={m.editor.canvas.addGuideDown}>
        <canvas ref={topRef} />
      </div>
      <div className="cf-ruler cf-ruler--left" data-cf-ui style={{ top: RULER, width: RULER }} onPointerDown={(e) => startGuide(e, "v")} title={m.editor.canvas.addGuideRight}>
        <canvas ref={leftRef} />
      </div>
      {draft && <DraftGuide axis={draft.axis} pos={draft.pos} />}
    </>
  );
}

function DraftGuide({ axis, pos }: { axis: "v" | "h"; pos: number }) {
  const v = useView.getState();
  const p = designToScreen(v, axis === "v" ? pos : 0, axis === "h" ? pos : 0);
  return (
    <>
      <div className={`cf-gline cf-gline--${axis} cf-gline--draft`} style={axis === "v" ? { left: p.x } : { top: p.y }} />
      <div className="cf-hud" style={axis === "v" ? { left: p.x + 8, top: RULER + 8 } : { top: p.y + 8, left: RULER + 8 }}>
        {Math.round(pos)}
      </div>
    </>
  );
}

/** Persisted guides, drawn across the whole workspace; drag to move, drop onto a ruler to delete. */
export function Guides() {
  const guides = useEditor((s) => s.design?.guides);
  const zoom = useEditor((s) => s.zoom);
  const showRulers = useEditor((s) => s.showRulers);
  const mode = useEditor((s) => s.mode);
  const shown = !!guides && (guides.vertical.length > 0 || guides.horizontal.length > 0) && showRulers;
  const dragEnd = useDragEnd(shown);
  if (!guides || !shown) return null;

  const drag = (e: ReactPointerEvent, axis: "v" | "h", index: number) => {
    if (mode === "view") return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const host = target.closest(".cf-workspace") as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const actions = useEditor.getState().actions;
    actions.beginTransaction();
    const pos = (ev: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const d = screenToDesign(useView.getState(), ev.clientX - r.left, ev.clientY - r.top);
      return { value: axis === "v" ? d.x : d.y, overRuler: axis === "v" ? ev.clientX - r.left < RULER : ev.clientY - r.top < RULER };
    };
    const move = (ev: PointerEvent) => actions.moveGuide(axis, index, pos(ev).value);
    // a cancelled drag still closes the undo step (left open, it would block undo and the history), but it removes nothing:
    // the guide stays where the pointer last put it. Once, whichever comes first: the pointer is released, cancelled or loses
    // its capture, or the guides are hidden (useDragEnd)
    let done = false;
    const finish = () => {
      if (done) return false;
      done = true;
      if (dragEnd.current === stop) dragEnd.current = null;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      target.removeEventListener("lostpointercapture", up);
      return true;
    };
    const up = (ev: PointerEvent) => {
      if (!finish()) return;
      if (ev.type === "pointerup" && pos(ev).overRuler) actions.removeGuide(axis, index);
      actions.endTransaction();
    };
    const stop = () => {
      if (finish()) actions.endTransaction();
    };
    dragEnd.current?.();
    dragEnd.current = stop;
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    target.addEventListener("lostpointercapture", up);
  };

  const line = (axis: "v" | "h", pos: number, index: number) => (
    <div
      key={`${axis}${index}`}
      className={`cf-gline cf-gline--${axis}`}
      data-cf-ui
      style={axis === "v" ? { left: pos * zoom } : { top: pos * zoom }}
      onPointerDown={(e) => drag(e, axis, index)}
      title={m.editor.canvas.moveGuide}
    />
  );

  return (
    <>
      {guides.vertical.map((p, i) => line("v", p, i))}
      {guides.horizontal.map((p, i) => line("h", p, i))}
    </>
  );
}

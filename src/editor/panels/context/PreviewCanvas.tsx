import { useCallback, useEffect, useRef, useState } from "react";
import { onFontsChange } from "@/render/fonts";
import { onImagesChange } from "@/render/images";

/**
 * A small canvas that paints a live preview with the real renderer (effect tiles, filter tiles, layer
 * thumbnails ...). Painting is queued - a time budget per frame - so a grid of previews never blocks the
 * panel, and it repeats automatically when a font or image the preview was waiting for arrives.
 */
export interface PreviewCanvasProps {
  /** CSS px */
  width: number;
  height: number;
  /**
   * Paint into a context that is already scaled to CSS px (`dpr` is passed for renderers that reset the
   * transform themselves). Return false while a font / image is still loading to be called again later.
   */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) => boolean | void;
  /** repaint whenever one of these changes (the list must keep the same length) */
  deps: ReadonlyArray<unknown>;
  /** paint only once the canvas scrolls into view */
  lazy?: boolean;
  /** stretch to the width / height of the container (the backing store keeps the size above) */
  fluid?: boolean;
  className?: string;
}

/* ---- one shared paint queue ---- */

const queue = new Map<HTMLCanvasElement, () => void>();
let frame = 0;
const BUDGET_MS = 9;

function pump() {
  frame = 0;
  const t0 = performance.now();
  while (queue.size && performance.now() - t0 < BUDGET_MS) {
    const first = queue.entries().next();
    if (first.done) break;
    const [canvas, job] = first.value;
    queue.delete(canvas);
    if (canvas.isConnected) job();
  }
  if (queue.size) frame = requestAnimationFrame(pump);
}

function schedule(canvas: HTMLCanvasElement, job: () => void) {
  queue.set(canvas, job);
  if (!frame) frame = requestAnimationFrame(pump);
}

export function PreviewCanvas({ width, height, draw, deps, lazy = false, fluid = false, className }: PreviewCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const waiting = useRef(false);
  const [visible, setVisible] = useState(!lazy);
  // a fluid canvas follows the width its container gives it (a wide bottom sheet gets crisp tiles too)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const cssW = fluid && box ? box.w : width;
  const cssH = fluid && box ? box.h : height;

  const paint = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.scale(dpr, dpr);
    try {
      waiting.current = drawRef.current(ctx, cssW, cssH, dpr) === false;
    } catch (error) {
      waiting.current = false;
      console.warn("Preview could not be painted", error);
    }
  }, [cssW, cssH]);

  useEffect(() => {
    if (!fluid || typeof ResizeObserver === "undefined") return;
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w > 0 && h > 0) setBox((prev) => (prev && Math.abs(prev.w - w) < 2 && Math.abs(prev.h - h) < 2 ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fluid]);

  useEffect(() => {
    if (!lazy) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy]);

  useEffect(() => {
    const canvas = ref.current;
    if (visible && canvas) schedule(canvas, paint);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's `deps` say when the preview is drawn again
  }, [visible, paint, ...deps]);

  useEffect(() => {
    const retry = () => {
      const canvas = ref.current;
      if (waiting.current && canvas) schedule(canvas, paint);
    };
    const offFonts = onFontsChange(retry);
    const offImages = onImagesChange(retry);
    return () => {
      offFonts();
      offImages();
    };
  }, [paint]);

  return <canvas ref={ref} className={className} style={fluid ? { width: "100%", height: "100%" } : { width, height }} aria-hidden="true" />;
}

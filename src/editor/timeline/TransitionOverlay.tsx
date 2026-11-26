import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/core/store";
import { buildTimeline } from "@/core/transition";
import { onFontsChange } from "@/render/fonts";
import { onImagesChange } from "@/render/images";
import { PlaybackRenderer } from "@/render/playback";
import { placeAt, useTimeline } from "./timelineStore";

/** The longest side of the overlay's picture, in device pixels: a page at a high zoom is not painted at its full size. */
const MAX_SIDE = 2048;

/**
 * While the timeline's playhead is inside a transition (parked, dragged or playing), the page area of the workspace shows that
 * transition as Present and the video download do: the old page at its last moment giving way to the new one at its first. It
 * lies over the page canvas, at the page's place, and lets the pointer through; anywhere else it is not there.
 */
export function TransitionOverlay({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  const design = useEditor((s) => s.design);
  const open = useTimeline((s) => s.open);
  const time = useTimeline((s) => s.time);
  const ref = useRef<HTMLCanvasElement>(null);
  const timeline = useMemo(() => (design ? buildTimeline(design.pages) : null), [design]);
  const renderer = useMemo(() => (design ? new PlaybackRenderer(design) : null), [design]);
  useEffect(() => () => renderer?.dispose(), [renderer]);

  const showing = !!(open && timeline && placeAt(timeline, time).waiting);
  // a picture or a font that arrives is painted: the frame is drawn again
  const [arrived, setArrived] = useState(0);
  useEffect(() => {
    if (!showing) return;
    const again = () => setArrived((n) => n + 1);
    const offFonts = onFontsChange(again);
    const offImages = onImagesChange(again);
    return () => {
      offFonts();
      offImages();
    };
  }, [showing]);

  useEffect(() => {
    const canvas = ref.current;
    if (!showing || !canvas || !renderer || !timeline) return;
    const dpr = window.devicePixelRatio || 1;
    const k = Math.min(dpr, MAX_SIDE / Math.max(1, width, height));
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) renderer.renderAt(ctx, timeline, time);
  }, [showing, renderer, timeline, time, width, height, arrived]);

  if (!showing) return null;
  return <canvas ref={ref} className="cf-tl-overlay" style={{ left, top, width, height }} aria-hidden="true" />;
}

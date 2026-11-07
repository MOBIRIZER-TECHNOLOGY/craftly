import { useEffect, useRef } from "react";
import { getActivePage, useEditor } from "@/core/store";
import { onFontsChange } from "@/render/fonts";
import { onImagesChange } from "@/render/images";
import { renderPage } from "@/render/renderPage";
import { previewTime, stopPreview, usePreview } from "./preview";
import { useView } from "./viewStore";

/**
 * Paints the active page onto a viewport-sized canvas that sticks to the top
 * left of the scroller. Only what is visible is rendered, at the exact device
 * resolution, so the page stays crisp at any zoom without huge canvases.
 */
export function PageView() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    let pendingRetry = 0;

    const draw = () => {
      raf = 0;
      const s = useEditor.getState();
      const v = useView.getState();
      const page = getActivePage(s);
      if (!s.design || !page) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(v.width * dpr));
      const h = Math.max(1, Math.round(v.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.width = `${v.width}px`;
      canvas.style.height = `${v.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const hide = new Set<string>();
      if (s.editingTextId) hide.add(s.editingTextId);
      if (s.croppingId) hide.add(s.croppingId);
      const z = s.zoom;
      // a running preview paints the page part-way through its animations and keeps asking for the next frame
      const preview = usePreview.getState().preview;
      const time = preview ? previewTime(preview) : null;
      const playing = preview !== null && time !== null && time < preview.until;
      if (preview && !playing) queueMicrotask(stopPreview);
      const complete = renderPage(ctx, s.design, page, {
        scale: z * dpr,
        clip: { x: (v.scrollLeft - v.pageLeft) / z, y: (v.scrollTop - v.pageTop) / z, w: v.width / z, h: v.height / z },
        hide,
        animation: playing && time !== null ? { time } : undefined,
      });
      if (playing) schedule();
      // something (a font, an image) was still loading: its own event repaints, this is the safety net
      if (!complete && !pendingRetry) {
        pendingRetry = window.setTimeout(() => {
          pendingRetry = 0;
          schedule();
        }, 250);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    const unsubPreview = usePreview.subscribe(schedule);
    const unsubStore = useEditor.subscribe((s, prev) => {
      // a preview belongs to the page it was started on
      if (s.activePageId !== prev.activePageId) stopPreview();
      if (
        s.design !== prev.design ||
        s.activePageId !== prev.activePageId ||
        s.zoom !== prev.zoom ||
        s.editingTextId !== prev.editingTextId ||
        s.croppingId !== prev.croppingId ||
        s.docVersion !== prev.docVersion
      )
        schedule();
    });
    const unsubView = useView.subscribe(schedule);
    const unsubFonts = onFontsChange(schedule);
    const unsubImages = onImagesChange(schedule);
    const mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq?.addEventListener?.("change", schedule);
    schedule();
    return () => {
      unsubPreview();
      unsubStore();
      unsubView();
      unsubFonts();
      unsubImages();
      mq?.removeEventListener?.("change", schedule);
      if (raf) cancelAnimationFrame(raf);
      if (pendingRetry) clearTimeout(pendingRetry);
    };
  }, []);

  return <canvas ref={ref} className="cf-pageview" aria-hidden="true" />;
}

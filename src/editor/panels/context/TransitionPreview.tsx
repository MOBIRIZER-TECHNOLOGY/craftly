import { useEffect, useRef, useState } from "react";
import type { DesignElement, Design, Page, PageTransition } from "@/core/types";
import { buildTimeline } from "@/core/transition";
import { m } from "@/i18n";
import { PlaybackRenderer } from "@/render/playback";
import { preparePage } from "@/render/renderPage";
import { IconButton, IconPlay } from "@/ui";

const WIDTH = 308;
/** seconds shown before and after the transition itself */
const LEAD = 0.5;
const TAIL = 0.8;

/** The page as it rests: element animations are left out so the preview shows the transition and nothing else. */
function atRest(page: Page, transition: PageTransition | undefined): Page {
  const elements = page.elements.map((el) => {
    if (!el.animation) return el;
    const { animation: _animation, ...rest } = el;
    return rest as DesignElement;
  });
  return { ...page, elements, duration: 5, transition };
}

/**
 * A small player that shows how the previous page gives way to this one, using the same renderer as the
 * presenter and the exports. It plays once whenever the transition changes, and again on "Replay".
 */
export function TransitionPreview({ design, from, to, transition }: { design: Pick<Design, "width" | "height">; from: Page; to: Page; transition: PageTransition | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [replay, setReplay] = useState(0);
  const height = Math.round((WIDTH * design.height) / design.width);
  const key = `${from.id}|${to.id}|${JSON.stringify(transition)}`;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(height * dpr);
    const pages = [atRest(from, undefined), atRest(to, transition ?? undefined)];
    const mini = { width: design.width, height: design.height, pages };
    const renderer = new PlaybackRenderer(mini);
    const timeline = buildTimeline(pages);
    const seg = timeline.segments[1];
    const t0 = Math.max(0, seg.start - (transition ? LEAD : 0));
    const t1 = seg.playStart + TAIL;
    let raf = 0;
    let cancelled = false;

    void Promise.all([preparePage(from), preparePage(to)]).then(() => {
      if (cancelled) return;
      if (!transition) {
        renderer.renderAt(ctx, timeline, seg.playStart);
        return;
      }
      const began = performance.now();
      const tick = () => {
        const t = t0 + (performance.now() - began) / 1000;
        renderer.renderAt(ctx, timeline, Math.min(t, t1));
        if (t < t1 && !cancelled) raf = requestAnimationFrame(tick);
      };
      tick();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [key, replay]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cf-an__preview" style={{ aspectRatio: `${design.width} / ${design.height}` }}>
      <canvas ref={ref} aria-label={transition ? m.panelsContext.transitionPreview.preview : m.panelsContext.transitionPreview.thisPage} role="img" />
      {transition ? (
        <span className="cf-an__replay">
          <IconButton label={m.panelsContext.transitionPreview.replay} size="sm" icon={<IconPlay />} onClick={() => setReplay((n) => n + 1)} />
        </span>
      ) : null}
    </div>
  );
}

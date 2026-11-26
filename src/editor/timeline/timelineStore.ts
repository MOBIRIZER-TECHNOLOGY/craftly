/**
 * The timeline under the page (Timeline.tsx): every page as a block as long as it lasts, the transitions between them, and a
 * playhead that can be parked, dragged and played across the pages. This module holds its state and the pure maths; the moment
 * the playhead stands for is shown on the page canvas through the preview store (src/editor/canvas/preview.ts): held still while
 * the playhead is parked or dragged, playing (with the clips' sound) while it runs.
 *
 * Nothing here is saved with the design: the playhead is a way of looking at it, like the zoom.
 */
import { create } from "zustand";
import { pageDuration } from "@/core/animation";
import { useEditor } from "@/core/store";
import { buildTimeline, type Timeline } from "@/core/transition";
import type { Page } from "@/core/types";
import { holdPreview, previewTime, startPreview, stopPreview, usePreview } from "@/editor/canvas/preview";

/** The fewest and the most pixels a second of the timeline takes. */
export const MIN_PX_PER_SECOND = 6;
export const MAX_PX_PER_SECOND = 60;
/** A playhead this close to the start of a page shows the page at rest (as it is edited), not held at its first moment. */
export const AT_REST = 0.05;
/** A running page that is this far from where the playhead says it should be is started again from there. */
const DRIFT = 0.25;

/** Pixels per second that fit `total` seconds into `width` pixels, within the bounds above. */
export function pxPerSecond(total: number, width: number): number {
  if (!(total > 0) || !(width > 0)) return MAX_PX_PER_SECOND;
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, width / total));
}

export interface Place {
  /** index of the page */
  page: number;
  /** seconds into the page's own time (0 while the transition into it runs) */
  time: number;
  /** the transition into the page is still running: the page waits at its start */
  waiting: boolean;
}

/** Which page, and which moment of it, `t` seconds of the whole timeline stand for (clamped to its ends). */
export function placeAt(timeline: Timeline, t: number): Place {
  const segs = timeline.segments;
  if (!segs.length) return { page: 0, time: 0, waiting: false };
  const at = Math.min(Math.max(0, t), timeline.total);
  // the end of the last page belongs to it, not to a page after it
  const seg = segs.find((s) => at < s.end) ?? segs[segs.length - 1];
  if (at < seg.playStart) return { page: seg.page, time: 0, waiting: true };
  return { page: seg.page, time: Math.min(at - seg.playStart, seg.end - seg.playStart), waiting: false };
}

/** The second of the whole timeline at which page `index` starts its own time (after the transition into it). */
export const pageStartAt = (timeline: Timeline, index: number): number => timeline.segments[index]?.playStart ?? 0;

export interface TimelineState {
  /** the timeline is shown under the page, in place of the page strip */
  open: boolean;
  /** the playhead, in seconds of the whole timeline */
  time: number;
  playing: boolean;
}

export const useTimeline = create<TimelineState>(() => ({ open: false, time: 0, playing: false }));

const pagesOf = (): readonly Page[] => useEditor.getState().design?.pages ?? [];

/* ------------------------------------------------------------------ */
/* showing the playhead's moment on the page canvas                    */
/* ------------------------------------------------------------------ */

/** True while this module moves the editor to another page (the canvas then ends its preview, which is not a stop by the user). */
let turning = false;

function turnTo(page: Page): void {
  const s = useEditor.getState();
  if (s.activePageId === page.id) return;
  turning = true;
  try {
    s.actions.setActivePage(page.id);
  } finally {
    turning = false;
  }
}

/** Shows `t` seconds of the timeline on the canvas: the right page, held still at its moment (or at rest at its very start). */
function showStill(t: number): void {
  const pages = pagesOf();
  if (!pages.length) return;
  const place = placeAt(buildTimeline(pages), t);
  turnTo(pages[place.page]);
  if (place.time < AT_REST) stopPreview();
  else holdPreview(place.time);
}

/** While playing: the right page, running from its moment with its clips' sound, unless it already runs close to it. */
function showRunning(timeline: Timeline, t: number): void {
  const pages = pagesOf();
  const place = placeAt(timeline, t);
  const page = pages[place.page];
  if (!page) return;
  turnTo(page);
  if (place.waiting) {
    // the transition into the page: it waits at its first moment
    const p = usePreview.getState().preview;
    if (!p?.paused || p.from !== 0) holdPreview(0);
    return;
  }
  const p = usePreview.getState().preview;
  if (p && !p.paused && Math.abs(previewTime(p) - place.time) < DRIFT) return;
  startPreview(place.time, pageDuration(page), { sound: true });
}

/* ------------------------------------------------------------------ */
/* the clock                                                           */
/* ------------------------------------------------------------------ */

let raf = 0;
/** performance.now() at which the playhead was at `from` */
let clock: { startedAt: number; from: number } | null = null;

function tick(): void {
  raf = 0;
  if (!clock) return;
  const pages = pagesOf();
  const timeline = buildTimeline(pages);
  const t = clock.from + (performance.now() - clock.startedAt) / 1000;
  if (!pages.length || t >= timeline.total) {
    // the end: the playhead stays there and the page is shown at rest
    clock = null;
    useTimeline.setState({ time: timeline.total, playing: false });
    stopPreview();
    return;
  }
  useTimeline.setState({ time: t });
  showRunning(timeline, t);
  raf = requestAnimationFrame(tick);
}

/** Plays from the playhead (from the start when it is at the end) across the pages, with sound. */
export function playTimeline(): void {
  const pages = pagesOf();
  const total = buildTimeline(pages).total;
  if (!pages.length || total <= 0) return;
  const at = useTimeline.getState().time;
  const from = at >= total - AT_REST ? 0 : Math.max(0, at);
  clock = { startedAt: performance.now(), from };
  useTimeline.setState({ playing: true, time: from });
  if (!raf) raf = requestAnimationFrame(tick);
}

/** Stops where the playhead is and holds that moment on the page. */
export function pauseTimeline(): void {
  if (!clock) return;
  const t = clock.from + (performance.now() - clock.startedAt) / 1000;
  clock = null;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  const total = buildTimeline(pagesOf()).total;
  const at = Math.min(Math.max(0, t), total);
  useTimeline.setState({ playing: false, time: at });
  showStill(at);
}

/** Puts the playhead at `t` seconds and shows that moment (playing on from there when it was playing). */
export function seekTimeline(t: number): void {
  const total = buildTimeline(pagesOf()).total;
  const at = Math.min(Math.max(0, t), total);
  if (clock) {
    clock = { startedAt: performance.now(), from: at };
    useTimeline.setState({ time: at });
    return;
  }
  useTimeline.setState({ time: at });
  showStill(at);
}

/** Opens or closes the timeline; closing it stops a playback and lets the page be edited again. */
export function setTimelineOpen(open: boolean): void {
  if (!open && clock) {
    clock = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    useTimeline.setState({ playing: false });
    stopPreview();
  }
  if (!open && usePreview.getState().preview?.paused) stopPreview();
  useTimeline.setState({ open });
}

/** Whatever else ends the page's preview (Esc, the clip toolbar's Play) also stops the timeline's playback. */
usePreview.subscribe((s, prev) => {
  if (!clock || turning || s.preview !== null || prev.preview === null) return;
  // a page that ran to its end stops its own preview: the clock goes on to the next page
  const ranOut = !prev.preview.paused && previewTime(prev.preview) >= prev.preview.until - DRIFT;
  if (!ranOut) {
    clock = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    useTimeline.setState({ playing: false });
  }
});

/** A page chosen elsewhere (the page strip, the keyboard, a link) moves a parked playhead to its start. */
useEditor.subscribe((s, prev) => {
  if (turning || clock || s.activePageId === prev.activePageId || !s.design) return;
  const index = s.design.pages.findIndex((p) => p.id === s.activePageId);
  if (index < 0) return;
  const timeline = buildTimeline(s.design.pages);
  if (placeAt(timeline, useTimeline.getState().time).page === index) return;
  useTimeline.setState({ time: pageStartAt(timeline, index) });
});

/** For tests: the clock and the state as at start-up. */
export function resetTimeline(): void {
  clock = null;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  turning = false;
  useTimeline.setState({ open: false, time: 0, playing: false });
}

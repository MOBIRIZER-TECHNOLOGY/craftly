/**
 * Playing a page's animations on the editing canvas ("Preview" in the Animate panel). The page canvas reads this
 * store each frame: while a preview runs it paints the page `time` seconds into its animations and hides the
 * selection overlays; when it ends (or anything else happens) the page is painted at rest again.
 */
import { create } from "zustand";
import { animationWindow, pageDuration, type AnimPhase } from "@/core/animation";
import type { ElementAnimation, Page } from "@/core/types";
import { pauseVideos } from "@/render/videos";

export interface PreviewState {
  /** performance.now() when the preview began */
  startedAt: number;
  /** seconds into the page where it begins and where it stops */
  from: number;
  until: number;
  /** the page's clips play with their sound (the clip toolbar's Play); an animation preview leaves it out */
  sound?: boolean;
}

export const usePreview = create<{ preview: PreviewState | null }>(() => ({ preview: null }));

/** Plays the active page from second `from` to second `until`; with `sound` its clips are heard. */
export function startPreview(from: number, until: number, opts: { sound?: boolean } = {}): void {
  usePreview.setState({ preview: { startedAt: performance.now(), from: Math.max(0, from), until, ...(opts.sound ? { sound: true } : {}) } });
}

/** Ends the preview, and stops its clips at once: one that was heard would otherwise go on until the players idle. */
export function stopPreview(): void {
  if (!usePreview.getState().preview) return;
  usePreview.setState({ preview: null });
  pauseVideos();
}

/** Page seconds a running preview has reached. */
export const previewTime = (p: PreviewState, now = performance.now()): number => p.from + (now - p.startedAt) / 1000;

/** The part of the page worth watching after `anim` of `phase` was chosen or changed. */
export function previewRange(phase: AnimPhase, anim: ElementAnimation, page: Pick<Page, "duration">): { from: number; until: number } {
  const duration = pageDuration(page);
  if (phase === "loop") return { from: 0, until: Math.min(duration, Math.max(2, anim.duration * 2)) };
  const w = animationWindow(anim, phase, duration);
  return phase === "in" ? { from: 0, until: Math.min(duration, w.end + 0.5) } : { from: Math.max(0, w.start - 0.6), until: duration };
}

/** The whole entrance of a page animation (the last element finishes at `lastEnd`). */
export function previewEntrances(lastEnd: number, page: Pick<Page, "duration">): { from: number; until: number } {
  return { from: 0, until: Math.min(pageDuration(page), lastEnd + 0.5) };
}

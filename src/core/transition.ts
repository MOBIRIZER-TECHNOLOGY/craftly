/**
 * Page transitions and the timeline of a whole design. Pure maths, like `animation.ts`: `transitionFrame`
 * says how the old and the new page are drawn part-way through a transition, `buildTimeline` / `frameAt`
 * say which page (and which moment of it) is on screen at a given second of an automatic playback.
 */
import { easeInOutCubic, easeOutCubic, pageDuration, type AnimClip } from "./animation";
import type { AnimDirection, Page, PageTransition } from "./types";

export const MAX_TRANSITION_DURATION = 3;

/** How one of the two pages is drawn while the transition runs. Offsets are fractions of the page's width / height. */
export interface TransitionLayer {
  opacity: number;
  dx: number;
  dy: number;
  /** about the page centre */
  scale: number;
  /** visible window in fractions of the page; null = all of it */
  clip: AnimClip | null;
}

export interface TransitionFrame {
  from: TransitionLayer;
  to: TransitionLayer;
}

export interface TransitionPreset {
  id: string;
  label: string;
  directions?: readonly AnimDirection[];
  defaultDirection?: AnimDirection;
  defaultDuration: number;
}

const DIRS: readonly AnimDirection[] = ["left", "right", "up", "down"];

export const TRANSITION_PRESETS: readonly TransitionPreset[] = [
  { id: "dissolve", label: "Dissolve", defaultDuration: 0.7 },
  { id: "slide", label: "Slide", directions: DIRS, defaultDirection: "left", defaultDuration: 0.6 },
  { id: "push", label: "Push", directions: DIRS, defaultDirection: "left", defaultDuration: 0.6 },
  { id: "wipe", label: "Wipe", directions: DIRS, defaultDirection: "left", defaultDuration: 0.7 },
  { id: "zoom", label: "Zoom", defaultDuration: 0.7 },
  { id: "fade-black", label: "Dip to black", defaultDuration: 1 },
];

export const getTransitionPreset = (id: string): TransitionPreset | undefined => TRANSITION_PRESETS.find((p) => p.id === id);

export function defaultTransition(kind: string): PageTransition {
  const preset = getTransitionPreset(kind);
  return { kind, duration: preset?.defaultDuration ?? 0.7, ...(preset?.defaultDirection ? { direction: preset.defaultDirection } : {}) };
}

const REST: TransitionLayer = { opacity: 1, dx: 0, dy: 0, scale: 1, clip: null };
const layer = (patch: Partial<TransitionLayer> = {}): TransitionLayer => ({ ...REST, ...patch });

/** Unit vector of the direction of travel. */
const vec = (d: AnimDirection): readonly [number, number] => (d === "left" ? [-1, 0] : d === "right" ? [1, 0] : d === "up" ? [0, -1] : [0, 1]);

/** The part of the new page that has been uncovered when `e` of the way through, sweeping along `d`. */
function sweep(e: number, d: AnimDirection): AnimClip {
  switch (d) {
    case "left":
      return { x0: 1 - e, y0: 0, x1: 1, y1: 1 };
    case "right":
      return { x0: 0, y0: 0, x1: e, y1: 1 };
    case "up":
      return { x0: 0, y0: 1 - e, x1: 1, y1: 1 };
    default:
      return { x0: 0, y0: 0, x1: 1, y1: e };
  }
}

/**
 * Layers for progress `p` (0 = the old page, 1 = the new page). The new page is always painted on top of the old one.
 * `d` is the direction the new page travels: "left" means it arrives from the right edge.
 */
export function transitionFrame(kind: string, p: number, d: AnimDirection = "left"): TransitionFrame {
  const t = Math.min(1, Math.max(0, p));
  const [vx, vy] = vec(d);
  switch (kind) {
    case "slide": {
      const k = 1 - easeOutCubic(t);
      return { from: layer(), to: layer({ dx: -vx * k, dy: -vy * k }) };
    }
    case "push": {
      const e = easeInOutCubic(t);
      return { from: layer({ dx: vx * e, dy: vy * e }), to: layer({ dx: -vx * (1 - e), dy: -vy * (1 - e) }) };
    }
    case "wipe":
      return { from: layer(), to: layer({ clip: sweep(easeInOutCubic(t), d) }) };
    case "zoom": {
      const e = easeInOutCubic(t);
      return { from: layer({ scale: 1 + 0.18 * e }), to: layer({ opacity: e, scale: 0.86 + 0.14 * e }) };
    }
    case "fade-black":
      // the old page fades out in the first half, the new one fades in during the second; black shows between
      return { from: layer({ opacity: Math.max(0, 1 - t * 2) }), to: layer({ opacity: Math.max(0, t * 2 - 1) }) };
    case "dissolve":
    default:
      return { from: layer(), to: layer({ opacity: easeInOutCubic(t) }) };
  }
}

/* ------------------------------------------------------------------ */
/* timeline                                                            */
/* ------------------------------------------------------------------ */

export interface TimelineSegment {
  page: number;
  /** second the segment begins (its transition, if any, starts here) */
  start: number;
  /** length of the transition into this page, 0 for a cut and for the first page */
  transition: number;
  /** second the page's own time 0 begins */
  playStart: number;
  end: number;
}

export interface Timeline {
  segments: TimelineSegment[];
  total: number;
}

/** The transition into a page that has a previous one, as it will actually run (0 when there is none). */
export function transitionSeconds(page: Pick<Page, "transition">, hasPrevious: boolean): number {
  const tr = page.transition;
  if (!hasPrevious || !tr || tr.kind === "none") return 0;
  return Math.min(MAX_TRANSITION_DURATION, Math.max(0, tr.duration));
}

/** Pages play one after another: [transition into the page][the page for its duration]. */
export function buildTimeline(pages: readonly Pick<Page, "duration" | "transition">[]): Timeline {
  const segments: TimelineSegment[] = [];
  let at = 0;
  pages.forEach((page, i) => {
    const transition = transitionSeconds(page, i > 0);
    const playStart = at + transition;
    const end = playStart + pageDuration(page);
    segments.push({ page: i, start: at, transition, playStart, end });
    at = end;
  });
  return { segments, total: at };
}

export type TimelineFrame = { kind: "page"; page: number; /** seconds into the page */ time: number } | { kind: "transition"; from: number; to: number; progress: number };

/** What is on screen `t` seconds into the whole playback (clamped to the ends). */
export function frameAt(timeline: Timeline, t: number): TimelineFrame {
  const segs = timeline.segments;
  if (!segs.length) return { kind: "page", page: 0, time: 0 };
  const clamped = Math.min(Math.max(0, t), timeline.total);
  const seg = segs.find((s) => clamped < s.end) ?? segs[segs.length - 1];
  if (clamped < seg.playStart && seg.transition > 0) {
    return { kind: "transition", from: seg.page - 1, to: seg.page, progress: (clamped - seg.start) / seg.transition };
  }
  return { kind: "page", page: seg.page, time: Math.min(clamped - seg.playStart, seg.end - seg.playStart) };
}

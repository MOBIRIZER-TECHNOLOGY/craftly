/**
 * The decisions behind the presenter's motion, kept free of the DOM so they can be tested: which transition a move
 * plays and which way it travels, what a page looks like once its exits are left out, which frames are worth
 * painting, and how an automatic playback turns seconds into frames. `PresentPlayer` does the drawing.
 */
import { evaluateAnimation, pageDuration, playsClip } from "@/core/animation";
import { buildTimeline, frameAt, getTransitionPreset, transitionSeconds, type Timeline, type TimelineFrame } from "@/core/transition";
import type { AnimDirection, DesignElement, Page } from "@/core/types";

/* ------------------------------------------------------------------ */
/* transitions between pages                                           */
/* ------------------------------------------------------------------ */

const OPPOSITE: Record<AnimDirection, AnimDirection> = { left: "right", right: "left", up: "down", down: "up" };

/** The same travel the other way round. */
export const reverseDirection = (d: AnimDirection): AnimDirection => OPPOSITE[d];

export interface PlannedTransition {
  kind: string;
  /** the way the incoming page travels, as `drawTransition` takes it (already flipped for a move back); undefined for kinds that have none */
  direction: AnimDirection | undefined;
  /** always > 0: a cut is `null`, not a zero-length transition */
  seconds: number;
}

/**
 * The transition for moving from page `from` to page `to`, or null for a plain cut.
 *  - one page forward: the incoming page's own transition;
 *  - one page back: the transition of the page being left, run in reverse (the pages travel the other way);
 *  - anything else (Home, End, a jump): the destination's own transition, if it has one.
 * The first page has nothing to arrive from, so its transition never plays - the same rule `buildTimeline` follows.
 */
export function planTransition(pages: readonly Pick<Page, "transition">[], from: number, to: number): PlannedTransition | null {
  if (from === to || !pages[from] || !pages[to]) return null;
  const back = to === from - 1;
  const owner = back ? from : to;
  const page = pages[owner];
  const tr = page.transition;
  const seconds = transitionSeconds(page, owner > 0);
  if (!tr || !(seconds > 0)) return null;
  const preset = getTransitionPreset(tr.kind);
  // dissolve, zoom and fade through black look the same whichever way you go
  if (!preset?.directions) return { kind: tr.kind, direction: tr.direction, seconds };
  const given = tr.direction && OPPOSITE[tr.direction] ? tr.direction : undefined;
  const direction = given ?? preset.defaultDirection ?? "left";
  return { kind: tr.kind, direction: back ? reverseDirection(direction) : direction, seconds };
}

/* ------------------------------------------------------------------ */
/* holding a page: no exits                                            */
/* ------------------------------------------------------------------ */

const withoutExits = new WeakMap<Page, Page>();

function dropExit(el: DesignElement): DesignElement {
  const anim = el.animation;
  if (!anim?.out) return el;
  const { out: _out, ...rest } = anim;
  const { animation: _animation, ...bare } = el;
  return (rest.in || rest.loop ? { ...bare, animation: rest } : bare) as DesignElement;
}

/**
 * `page` as the presenter holds it: entrances and emphasis play, exits do not (the page stays until the presenter
 * moves on). A shallow copy that shares every element without an exit, made once per page object so painting a
 * frame never allocates; a page with no exits is returned as it is.
 */
export function stripExits(page: Page): Page {
  let hit = withoutExits.get(page);
  if (!hit) {
    hit = page.elements.some((el) => el.animation?.out) ? { ...page, elements: page.elements.map(dropExit) } : page;
    withoutExits.set(page, hit);
  }
  return hit;
}

/**
 * Whether anything on the page looks different at `t` seconds than at rest: an entrance that has not finished
 * (or not started), an exit that has begun, an emphasis. False means the page is a still picture, and for a page
 * without exits it stays false for good - the moment to stop painting frames.
 */
export function isAnimating(page: Pick<Page, "elements" | "duration">, t: number): boolean {
  const duration = pageDuration(page);
  // a clip plays for as long as the page is shown
  if (page.elements.some(playsClip)) return true;
  return page.elements.some((el) => !el.hidden && !!el.animation && evaluateAnimation(el.animation, t, duration) !== null);
}

/* ------------------------------------------------------------------ */
/* auto-play                                                           */
/* ------------------------------------------------------------------ */

export interface AutoplayPlan {
  timeline: Timeline;
  /** seconds into the timeline where playback begins: time 0 of the page it starts from */
  offset: number;
}

/**
 * Follows the design's own timeline from the start of page `from`. With reduced motion the transitions are left
 * out of the timeline, so the pages simply follow one another for their durations.
 */
export function planAutoplay(pages: readonly Pick<Page, "duration" | "transition">[], from: number, reduceMotion = false): AutoplayPlan {
  const timeline = buildTimeline(reduceMotion ? pages.map((p) => ({ duration: p.duration })) : pages);
  const seg = timeline.segments[Math.min(Math.max(0, from), timeline.segments.length - 1)];
  return { timeline, offset: seg ? seg.playStart : 0 };
}

export interface AutoplayMoment {
  frame: TimelineFrame;
  /** the last page has had its time: this is the final frame and playback is over */
  done: boolean;
}

/** What an automatic playback shows `elapsed` seconds after it began. */
export function autoplayAt(plan: AutoplayPlan, elapsed: number): AutoplayMoment {
  const t = plan.offset + Math.max(0, elapsed);
  return { frame: frameAt(plan.timeline, t), done: t >= plan.timeline.total };
}

/** How far through its time the page on screen is, 0..1. A transition counts as the very start of the page it leads into. */
export function pageProgress(frame: TimelineFrame, pages: readonly Pick<Page, "duration">[]): number {
  if (frame.kind !== "page") return 0;
  const page = pages[frame.page];
  return page ? Math.min(1, Math.max(0, frame.time / pageDuration(page))) : 0;
}

/**
 * Animation engine: pure functions that turn an element's animation settings and a point in time into a paint
 * state (opacity, offset, scale, rotation, clip). There is no DOM and no canvas here - `render/renderPage.ts`
 * applies the state, and the editor, presenter and exporters all ask this module "what does it look like at t?".
 *
 * The timeline of one page, in seconds (0 = the page has just appeared):
 *   entrance   [delay, delay + duration]
 *   exit       [pageDuration - delay - duration, pageDuration - delay]    (an exit's delay counts back from the end)
 *   emphasis   repeats every `duration` for as long as the page is shown
 */
import { m } from "@/i18n";
import type { AnimDirection, ClipCaption, DesignElement, ElementAnimation, ElementAnimations, Page, VideoElement } from "./types";

export type AnimPhase = "in" | "out" | "loop";

export const DEFAULT_PAGE_DURATION = 5;
export const MIN_PAGE_DURATION = 1;
export const MAX_PAGE_DURATION = 60;
export const MAX_ANIMATION_DURATION = 5;
export const MAX_ANIMATION_DELAY = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The longest a page can last by following its clip (a page timed by hand stops at MAX_PAGE_DURATION): ten minutes, as long as a
 * video download can be.
 */
export const MAX_CLIP_PAGE_DURATION = 600;

/** Seconds a clip takes to play once on its page: its trimmed part at its speed (never 0). */
export const clipPlayingLength = (el: Pick<VideoElement, "trimStart" | "trimEnd" | "speed">): number => Math.max(0.05, el.trimEnd - el.trimStart) / (el.speed > 0 ? el.speed : 1);

/** The latest a clip can start playing on its page, in seconds (as long as a page that follows its clip can last). */
export const MAX_CLIP_START = 600;

/** Seconds into its page at which a clip starts playing, 0 to MAX_CLIP_START (a value from outside that is not a number counts as 0). */
export const clipStartAt = (el: Pick<VideoElement, "startAt">): number =>
  typeof el.startAt === "number" && Number.isFinite(el.startAt) ? clamp(el.startAt, 0, MAX_CLIP_START) : 0;

/** Seconds a clip has been playing when its page has been shown for `time` seconds (0 until it starts). */
export const clipLocalTime = (el: Pick<VideoElement, "startAt">, time: number): number => Math.max(0, time - clipStartAt(el));

/** At most this many caption lines on a clip, and this many letters in one. */
export const MAX_CAPTIONS = 200;
export const MAX_CAPTION_LENGTH = 300;

/**
 * A clip's caption lines as they can be shown: lines with a text, a start that is a number of at least 0 and an end after it, at most
 * MAX_CAPTIONS of them, each cut to MAX_CAPTION_LENGTH letters, in the order they start. Anything else (from a file or a shared
 * design) is left out.
 */
export function clipCaptions(el: Pick<VideoElement, "captions">): ClipCaption[] {
  if (!Array.isArray(el.captions)) return [];
  const out: ClipCaption[] = [];
  for (const line of el.captions as unknown[]) {
    if (out.length >= MAX_CAPTIONS) break;
    if (typeof line !== "object" || line === null) continue;
    const { start, end, text } = line as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim()) continue;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    out.push({ start, end, text: text.trim().slice(0, MAX_CAPTION_LENGTH) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The caption line showing `t` seconds into one play of a clip (the last one to start, when two overlap), or null. */
export function captionAt(captions: readonly ClipCaption[], t: number): ClipCaption | null {
  let found: ClipCaption | null = null;
  for (const line of captions) if (line.start <= t && t < line.end) found = line;
  return found;
}

/** The longest a clip's sound can take to fade in or out, in seconds. */
export const MAX_CLIP_FADE = 5;

const finiteOr = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** How loud a clip plays, 0 to 1 (a value from outside that is not a number counts as 1). */
export const clipVolume = (el: Pick<VideoElement, "volume">): number => clamp(finiteOr(el.volume, 1), 0, 1);

/**
 * How long a clip's sound fades in and out, in seconds of the page, 0 to MAX_CLIP_FADE each; when the two add up to more than one
 * play of the clip they are shortened alike, so that they meet instead of overlapping.
 */
export function clipFades(el: Pick<VideoElement, "fadeIn" | "fadeOut" | "trimStart" | "trimEnd" | "speed">): { fadeIn: number; fadeOut: number } {
  let fadeIn = clamp(finiteOr(el.fadeIn, 0), 0, MAX_CLIP_FADE);
  let fadeOut = clamp(finiteOr(el.fadeOut, 0), 0, MAX_CLIP_FADE);
  const length = clipPlayingLength(el);
  if (fadeIn + fadeOut > length) {
    const k = length / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  return { fadeIn, fadeOut };
}

/**
 * How loud a clip sounds `t` seconds into one play of it (0 <= t <= its playing length): its volume, times its fades. Present sets
 * the <video>'s volume to this, and a video download shapes the clip's sound with it.
 */
export function clipGainAt(el: Pick<VideoElement, "volume" | "fadeIn" | "fadeOut" | "trimStart" | "trimEnd" | "speed">, t: number): number {
  const volume = clipVolume(el);
  if (volume === 0) return 0;
  const { fadeIn, fadeOut } = clipFades(el);
  const length = clipPlayingLength(el);
  let g = 1;
  if (fadeIn > 0 && t < fadeIn) g = Math.min(g, Math.max(0, t) / fadeIn);
  if (fadeOut > 0 && t > length - fadeOut) g = Math.min(g, Math.max(0, length - t) / fadeOut);
  return volume * g;
}

/**
 * When the last clip on the page has played once, from the time it starts (groups looked into, hidden ones left out); null without
 * a clip.
 */
export function pageClipLength(page: { elements?: readonly DesignElement[] }): number | null {
  let longest: number | null = null;
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    if (el.type === "video") longest = Math.max(longest ?? 0, clipStartAt(el) + clipPlayingLength(el));
    else if (el.type === "group") el.children.forEach(visit);
  };
  page.elements?.forEach(visit);
  return longest;
}

/**
 * Seconds a page stays on screen when played or exported: the length set for it; without one, as long as its longest clip takes to
 * play once (as Canva does: a page with an 11 s clip plays 11 s); and 5 s for a page with no clip.
 */
export const pageDuration = (page: Pick<Page, "duration"> & { elements?: readonly DesignElement[] }): number => {
  if (Number.isFinite(page.duration)) return clamp(page.duration as number, MIN_PAGE_DURATION, MAX_PAGE_DURATION);
  const clip = pageClipLength(page);
  return clip === null ? DEFAULT_PAGE_DURATION : clamp(clip, MIN_PAGE_DURATION, MAX_CLIP_PAGE_DURATION);
};

/* ------------------------------------------------------------------ */
/* easing                                                              */
/* ------------------------------------------------------------------ */

export const easeOutCubic = (p: number): number => 1 - (1 - p) ** 3;
export const easeInOutCubic = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const easeOutBack = (p: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};
export const easeOutBounce = (p: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};

/* ------------------------------------------------------------------ */
/* paint state                                                         */
/* ------------------------------------------------------------------ */

/** A visible window in fractions of the element's own box; values outside 0..1 leave that side open. */
export interface AnimClip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface AnimState {
  /** multiplier on the element's own opacity */
  opacity: number;
  /** offset in units of the design's shorter side (so a "rise" looks the same on a slide and on a story) */
  dx: number;
  dy: number;
  /** about the element's centre */
  scale: number;
  /** degrees, about the element's centre */
  rotate: number;
  /** visible window; null = not clipped */
  clip: AnimClip | null;
  /** the content moves inside the clip window by this fraction of the element's box (mask reveals) */
  innerDx: number;
  innerDy: number;
  /** text typed so far, 0..1 (other elements treat it as a left-to-right wipe); null = everything */
  reveal: number | null;
}

export const identityState = (): AnimState => ({ opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, clip: null, innerDx: 0, innerDy: 0, reveal: null });

const intersect = (a: AnimClip | null, b: AnimClip | null): AnimClip | null =>
  !a ? b : !b ? a : { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };

function merge(a: AnimState, b: Partial<AnimState>): AnimState {
  const rb = b.reveal ?? null;
  return {
    opacity: a.opacity * (b.opacity ?? 1),
    dx: a.dx + (b.dx ?? 0),
    dy: a.dy + (b.dy ?? 0),
    scale: a.scale * (b.scale ?? 1),
    rotate: a.rotate + (b.rotate ?? 0),
    clip: intersect(a.clip, b.clip ?? null),
    innerDx: a.innerDx + (b.innerDx ?? 0),
    innerDy: a.innerDy + (b.innerDy ?? 0),
    reveal: a.reveal === null ? rb : rb === null ? a.reveal : Math.min(a.reveal, rb),
  };
}

/** Nothing of the element can be seen in this state (the renderer skips it). */
export function isHidden(s: AnimState): boolean {
  if (s.opacity <= 0.002 || s.scale <= 0.002) return true;
  if (s.reveal !== null && s.reveal <= 0) return true;
  return !!s.clip && (s.clip.x1 <= s.clip.x0 || s.clip.y1 <= s.clip.y0);
}

/* ------------------------------------------------------------------ */
/* presets                                                             */
/* ------------------------------------------------------------------ */

export const DIRECTIONS: readonly AnimDirection[] = ["left", "right", "up", "down"];

export interface AnimationPreset {
  id: string;
  label: string;
  phases: readonly AnimPhase[];
  /** directions the preset understands (it is a plain effect when absent) */
  directions?: readonly AnimDirection[];
  defaultDirection?: AnimDirection;
  /** typed letter by letter on text; a left-to-right wipe on anything else */
  textFriendly?: boolean;
  /** seconds */
  defaultDuration: number;
  /** state while arriving: p runs 0 (not there) to 1 (at rest); an exit plays it backwards */
  enter?: (p: number, d: AnimDirection) => Partial<AnimState>;
  /** state of an emphasis: `phase` is the position in the current cycle, 0..1 */
  loop?: (phase: number) => Partial<AnimState>;
}

const vec = (d: AnimDirection): readonly [number, number] => (d === "left" ? [-1, 0] : d === "right" ? [1, 0] : d === "up" ? [0, -1] : [0, 1]);

/** The element starts `dist` behind its resting place (opposite to the direction of travel) and glides in. */
function travel(p: number, d: AnimDirection, dist: number): Pick<AnimState, "dx" | "dy"> {
  const [vx, vy] = vec(d);
  const k = (1 - easeOutCubic(p)) * dist;
  return { dx: -vx * k, dy: -vy * k };
}

const OPEN_LO = -0.5;
const OPEN_HI = 1.5;

/** A window that grows along the direction of travel; the other sides stay open so shadows survive. */
function wipeClip(e: number, d: AnimDirection): AnimClip {
  switch (d) {
    case "right":
      return { x0: OPEN_LO, y0: OPEN_LO, x1: e, y1: OPEN_HI };
    case "left":
      return { x0: 1 - e, y0: OPEN_LO, x1: OPEN_HI, y1: OPEN_HI };
    case "down":
      return { x0: OPEN_LO, y0: OPEN_LO, x1: OPEN_HI, y1: e };
    default:
      return { x0: OPEN_LO, y0: 1 - e, x1: OPEN_HI, y1: OPEN_HI };
  }
}

/** Deterministic on / off pattern that settles to "on" for the last 15% of the entrance. */
function flickerOn(p: number): boolean {
  if (p > 0.85) return true;
  const n = Math.floor(p * 14);
  return Math.abs((Math.sin(n * 12.9898) * 43758.5453) % 1) > 0.45;
}

const ALL_DIRS = DIRECTIONS;
const IN_OUT: readonly AnimPhase[] = ["in", "out"];

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  { id: "fade", label: m.core.animations["fade"], phases: IN_OUT, defaultDuration: 0.7, enter: (p) => ({ opacity: easeInOutCubic(p) }) },
  {
    id: "rise",
    label: m.core.animations["rise"],
    phases: IN_OUT,
    directions: ALL_DIRS,
    defaultDirection: "up",
    defaultDuration: 0.8,
    enter: (p, d) => ({ opacity: Math.min(1, p * 2), ...travel(p, d, 0.07) }),
  },
  {
    id: "pan",
    label: m.core.animations["pan"],
    phases: IN_OUT,
    directions: ALL_DIRS,
    defaultDirection: "right",
    defaultDuration: 0.8,
    enter: (p, d) => ({ opacity: Math.min(1, p * 2.5), ...travel(p, d, 0.24) }),
  },
  { id: "pop", label: m.core.animations["pop"], phases: IN_OUT, defaultDuration: 0.6, enter: (p) => ({ opacity: Math.min(1, p * 3), scale: 0.55 + 0.45 * easeOutBack(p) }) },
  { id: "zoom", label: m.core.animations["zoom"], phases: IN_OUT, defaultDuration: 0.8, enter: (p) => ({ opacity: Math.min(1, p * 2.2), scale: 1.4 - 0.4 * easeOutCubic(p) }) },
  {
    id: "wipe",
    label: m.core.animations["wipe"],
    phases: IN_OUT,
    directions: ALL_DIRS,
    defaultDirection: "right",
    defaultDuration: 0.8,
    enter: (p, d) => ({ clip: wipeClip(easeOutCubic(p), d) }),
  },
  {
    id: "slide",
    label: m.core.animations["slide"],
    phases: IN_OUT,
    directions: ALL_DIRS,
    defaultDirection: "up",
    defaultDuration: 0.8,
    enter: (p, d) => {
      const [vx, vy] = vec(d);
      const k = 1 - easeOutCubic(p);
      return { clip: { x0: 0, y0: 0, x1: 1, y1: 1 }, innerDx: -vx * k, innerDy: -vy * k };
    },
  },
  { id: "drop", label: m.core.animations["drop"], phases: IN_OUT, defaultDuration: 0.9, enter: (p) => ({ opacity: Math.min(1, p * 5), dy: -(1 - easeOutBounce(p)) * 0.16 }) },
  {
    id: "tumble",
    label: m.core.animations["tumble"],
    phases: IN_OUT,
    defaultDuration: 0.9,
    enter: (p) => {
      const e = easeOutCubic(p);
      return { opacity: Math.min(1, p * 2.5), rotate: -(1 - e) * 100, scale: 0.4 + 0.6 * e };
    },
  },
  { id: "typewriter", label: m.core.animations["typewriter"], phases: IN_OUT, textFriendly: true, defaultDuration: 1.2, enter: (p) => ({ reveal: p }) },
  {
    id: "flicker",
    label: m.core.animations["flicker"],
    phases: IN_OUT,
    defaultDuration: 0.8,
    enter: (p) => ({ opacity: flickerOn(p) ? easeInOutCubic(Math.min(1, p * 1.6)) : 0.06 }),
  },

  { id: "breathe", label: m.core.animations["breathe"], phases: ["loop"], defaultDuration: 2.4, loop: (ph) => ({ scale: 1 + 0.05 * Math.sin(2 * Math.PI * ph) }) },
  { id: "pulse", label: m.core.animations["pulse"], phases: ["loop"], defaultDuration: 1.6, loop: (ph) => ({ opacity: 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph)) }) },
  { id: "float", label: m.core.animations["float"], phases: ["loop"], defaultDuration: 3, loop: (ph) => ({ dy: 0.014 * Math.sin(2 * Math.PI * ph) }) },
  { id: "wiggle", label: m.core.animations["wiggle"], phases: ["loop"], defaultDuration: 1.2, loop: (ph) => ({ rotate: 4 * Math.sin(4 * Math.PI * ph) }) },
  { id: "spin", label: m.core.animations["spin"], phases: ["loop"], defaultDuration: 3, loop: (ph) => ({ rotate: 360 * ph }) },
  { id: "flash", label: m.core.animations["flash"], phases: ["loop"], defaultDuration: 1.2, loop: (ph) => ({ opacity: ph < 0.5 ? 1 : 0.2 }) },
];

const BY_ID = new Map(ANIMATION_PRESETS.map((p) => [p.id, p]));

export const getAnimationPreset = (id: string): AnimationPreset | undefined => BY_ID.get(id);
export const presetsFor = (phase: AnimPhase): AnimationPreset[] => ANIMATION_PRESETS.filter((p) => p.phases.includes(phase));

/** A fresh animation of `kind` with the preset's own defaults. */
export function defaultAnimation(kind: string, phase: AnimPhase): ElementAnimation {
  const preset = BY_ID.get(kind);
  return {
    kind,
    duration: preset?.defaultDuration ?? (phase === "loop" ? 2 : 0.8),
    delay: 0,
    ...(preset?.defaultDirection ? { direction: preset.defaultDirection } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* evaluation                                                          */
/* ------------------------------------------------------------------ */

/** How far through [start, end] `t` is, 0..1 (a zero-length window is a switch). */
function progress(t: number, start: number, end: number): number {
  if (end <= start) return t >= start ? 1 : 0;
  return clamp((t - start) / (end - start), 0, 1);
}

/** The window an entrance or exit occupies on a page that lasts `duration` seconds. */
export function animationWindow(a: ElementAnimation, phase: "in" | "out", duration: number): { start: number; end: number } {
  if (phase === "in") return { start: a.delay, end: a.delay + a.duration };
  const end = duration - a.delay;
  return { start: end - a.duration, end };
}

/**
 * The paint state of an element `t` seconds into a page that lasts `duration` seconds,
 * or null when nothing about it is animated at that moment (the common, fast case).
 */
export function evaluateAnimation(anim: ElementAnimations | null | undefined, t: number, duration: number): AnimState | null {
  if (!anim) return null;
  let state = identityState();
  let touched = false;

  const a = anim.in ? BY_ID.get(anim.in.kind) : undefined;
  if (anim.in && a?.enter) {
    const w = animationWindow(anim.in, "in", duration);
    const p = progress(t, w.start, w.end);
    if (p < 1) {
      state = merge(state, a.enter(p, anim.in.direction ?? a.defaultDirection ?? "right"));
      touched = true;
    }
  }

  const b = anim.out ? BY_ID.get(anim.out.kind) : undefined;
  if (anim.out && b?.enter) {
    const w = animationWindow(anim.out, "out", duration);
    const p = progress(t, w.start, w.end);
    if (p > 0) {
      state = merge(state, b.enter(1 - p, anim.out.direction ?? b.defaultDirection ?? "right"));
      touched = true;
    }
  }

  const c = anim.loop ? BY_ID.get(anim.loop.kind) : undefined;
  if (anim.loop && c?.loop) {
    const period = Math.max(0.1, anim.loop.duration);
    state = merge(state, c.loop((((t % period) + period) % period) / period));
    touched = true;
  }
  return touched ? state : null;
}

/** True when the element has any animation at all. */
export const isAnimated = (el: Pick<DesignElement, "animation">): boolean => !!el.animation && !!(el.animation.in || el.animation.out || el.animation.loop);

/** True when the element is a clip that plays, or a group with one (a hidden one plays nothing). */
export const playsClip = (el: DesignElement): boolean => !el.hidden && (el.type === "video" || (el.type === "group" && el.children.some(playsClip)));

/** True when some element on the page is animated, or is a clip, which plays for as long as the page is shown. */
export const pageHasAnimation = (page: Pick<Page, "elements">): boolean => page.elements.some((el) => isAnimated(el) || playsClip(el));

/* ------------------------------------------------------------------ */
/* page animations: one preset for every element, staggered            */
/* ------------------------------------------------------------------ */

export interface PageAnimationPreset {
  id: string;
  label: string;
  /** the entrance every element gets */
  kind: string;
  direction?: AnimDirection;
  duration: number;
  /** seconds between one element starting and the next one (bottom of the stack first) */
  stagger: number;
}

export const PAGE_ANIMATION_PRESETS: readonly PageAnimationPreset[] = [
  { id: "rise", label: m.core.animations["rise"], kind: "rise", direction: "up", duration: 0.8, stagger: 0.14 },
  { id: "fade", label: m.core.animations["fade"], kind: "fade", duration: 0.7, stagger: 0.1 },
  { id: "pan", label: m.core.animations["pan"], kind: "pan", direction: "right", duration: 0.8, stagger: 0.14 },
  { id: "pop", label: m.core.animations["pop"], kind: "pop", duration: 0.6, stagger: 0.12 },
  { id: "wipe", label: m.core.animations["wipe"], kind: "wipe", direction: "right", duration: 0.8, stagger: 0.14 },
  { id: "zoom", label: m.core.animations["zoom"], kind: "zoom", duration: 0.8, stagger: 0.12 },
  { id: "drop", label: m.core.animations["drop"], kind: "drop", duration: 0.9, stagger: 0.16 },
  { id: "cascade", label: m.core.animations["cascade"], kind: "slide", direction: "up", duration: 0.7, stagger: 0.2 },
];

export const getPageAnimationPreset = (id: string): PageAnimationPreset | undefined => PAGE_ANIMATION_PRESETS.find((p) => p.id === id);

/** A full-page picture or panel is a backdrop: a page animation leaves it where it is. */
export const isBackdrop = (el: Pick<DesignElement, "width" | "height">, design: { width: number; height: number }): boolean =>
  el.width * el.height >= 0.85 * design.width * design.height;

/** The elements a page animation applies to, bottom of the stack first. */
export function animatableElements(page: Pick<Page, "elements">, design: { width: number; height: number }): DesignElement[] {
  return page.elements.filter((el) => !el.hidden && !el.locked && !isBackdrop(el, design));
}

/** The entrance element number `index` (of `count`) receives from a page animation. */
export function pageAnimationFor(preset: PageAnimationPreset, index: number): ElementAnimations {
  const delay = Math.round(Math.min(index * preset.stagger, 2) * 100) / 100;
  return { in: { kind: preset.kind, duration: preset.duration, delay, ...(preset.direction ? { direction: preset.direction } : {}) } };
}

/** The page animation every animatable element shares, if they do; used to highlight the active preset. */
export function currentPageAnimation(page: Pick<Page, "elements">, design: { width: number; height: number }): PageAnimationPreset | null {
  const els = animatableElements(page, design);
  if (!els.length) return null;
  for (const preset of PAGE_ANIMATION_PRESETS) {
    if (
      els.every((el, i) => {
        const a = el.animation?.in;
        const want = pageAnimationFor(preset, i).in!;
        return !!a && a.kind === want.kind && (a.direction ?? null) === (want.direction ?? null);
      })
    )
      return preset;
  }
  return null;
}

/**
 * Pure helpers for the animated exports (GIF and WebM): which pages play, how many frames at which times, how
 * big the picture is, how long every GIF frame stays on screen and roughly how large the file will be.
 *
 * Nothing here touches the DOM or the canvas, so it is unit tested in node. The playback maths itself lives in
 * `core/transition.ts` (`buildTimeline`, `frameAt`) and `core/animation.ts`; this file only decides *which* moments
 * of that timeline become frames.
 */
import { animationWindow, pageDuration, pageHasAnimation } from "@/core/animation";
import { buildTimeline, type Timeline } from "@/core/transition";
import type { Design, DesignElement, ElementAnimations, Page } from "@/core/types";
import { m } from "@/i18n";
import type { PageWeight } from "../options";

export type AnimatedFormat = "gif" | "webm";

export const isAnimatedFormat = (format: string): format is AnimatedFormat => format === "gif" || format === "webm";

/* ------------------------------------------------------------------ */
/* choices                                                             */
/* ------------------------------------------------------------------ */

/** Length of the shorter side in pixels: 720 is 1280 x 720 for a 16:9 slide and 720 x 1280 for a story. */
export type AnimResolution = 480 | 720 | 1080;
export const ANIM_RESOLUTIONS: readonly AnimResolution[] = [480, 720, 1080];
export const DEFAULT_ANIM_RESOLUTION: AnimResolution = 720;
export const resolutionLabel = (r: AnimResolution): string => `${r}p`;

/** The frame rates the panel offers for a GIF. The API accepts any whole number up to `MAX_GIF_FPS`. */
export const GIF_FPS_CHOICES: readonly number[] = [10, 15, 20];
export const DEFAULT_GIF_FPS = 15;
export const MAX_GIF_FPS = 30;
/** Video is always recorded at this rate. */
export const VIDEO_FPS = 30;
/** Neither side of the picture is ever longer than this. */
export const MAX_OUTPUT_SIDE = 1920;

/** The preset nearest to `value` (the default for anything that is not a number). */
export function normalizeResolution(value: unknown): AnimResolution {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_ANIM_RESOLUTION;
  return ANIM_RESOLUTIONS.reduce((best, r) => (Math.abs(r - n) < Math.abs(best - n) ? r : best), ANIM_RESOLUTIONS[0]);
}

/** A video is always `VIDEO_FPS`; a GIF takes a whole number of frames per second from 1 to `MAX_GIF_FPS`. */
export function normalizeFps(format: AnimatedFormat, value: unknown): number {
  if (format === "webm") return VIDEO_FPS;
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_GIF_FPS;
  return Math.min(MAX_GIF_FPS, Math.max(1, Math.round(n)));
}

/* ------------------------------------------------------------------ */
/* picture size                                                        */
/* ------------------------------------------------------------------ */

const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2));

export interface OutputSize {
  width: number;
  height: number;
  /** canvas pixels per design pixel (the renderer derives the same value from the canvas width) */
  scale: number;
}

/**
 * Pixel size of the animation for a resolution preset: the shorter side gets `resolution` pixels, then the longer
 * side is capped at `MAX_OUTPUT_SIDE`. Both sides are even (video encoders need it). The width decides the scale
 * (the renderer derives it from the canvas width) and the height follows it, so the picture keeps the design's
 * aspect ratio to within a pixel; for an extremely tall design the width is trimmed until the height fits.
 */
export function outputSize(designWidth: number, designHeight: number, resolution: AnimResolution): OutputSize {
  const w = Math.max(1, designWidth);
  const h = Math.max(1, designHeight);
  let scale = resolution / Math.min(w, h);
  const longest = Math.max(w, h) * scale;
  if (longest > MAX_OUTPUT_SIDE) scale *= MAX_OUTPUT_SIDE / longest;
  let width = Math.min(MAX_OUTPUT_SIDE, even(w * scale));
  let height = even((width * h) / w);
  while (height > MAX_OUTPUT_SIDE && width > 2) {
    width -= 2;
    height = even((width * h) / w);
  }
  return { width, height: Math.min(MAX_OUTPUT_SIDE, height), scale: width / w };
}

/* ------------------------------------------------------------------ */
/* frames                                                              */
/* ------------------------------------------------------------------ */

export interface FramePlan {
  fps: number;
  /** seconds */
  total: number;
  count: number;
}

/**
 * `round(total x fps)` frames (at least one), frame `i` showing the moment `i / fps`. Rounding (rather than always
 * rounding up) keeps the last frame between half and one and a half frame intervals long, never a sliver.
 */
export function planFrames(total: number, fps: number): FramePlan {
  const t = Number.isFinite(total) && total > 0 ? total : 0;
  const f = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_GIF_FPS;
  return { fps: f, total: t, count: t > 0 ? Math.max(1, Math.round(t * f)) : 0 };
}

/** The second of the timeline that frame `index` shows. */
export const frameTime = (plan: FramePlan, index: number): number => Math.min(plan.total, Math.max(0, index) / plan.fps);

/**
 * How long each GIF frame stays up, in the centiseconds a GIF stores. The boundaries are rounded, not the
 * lengths, so the error never accumulates: the delays always add up to `round(total x 100)` and 15 fps comes out
 * as 7, 6, 7, 7, 6, 7 ... (100 per second) rather than 7, 7, 7 ... (105). The last frame runs to the end of the
 * timeline.
 */
export function frameDelays(plan: FramePlan): number[] {
  const out: number[] = [];
  const totalCs = Math.round(plan.total * 100);
  let from = 0;
  for (let i = 0; i < plan.count; i++) {
    const to = i === plan.count - 1 ? totalCs : Math.round(((i + 1) * 100) / plan.fps);
    out.push(Math.max(0, to - from));
    from = Math.max(from, to);
  }
  return out;
}

/** `wanted` frame indices spread evenly over `count` frames, always including the first and the last. */
export function sampleFrameIndices(count: number, wanted: number): number[] {
  if (count <= 0 || wanted <= 0) return [];
  if (wanted >= count) return Array.from({ length: count }, (_v, i) => i);
  if (wanted === 1) return [0];
  return Array.from({ length: wanted }, (_v, k) => Math.round((k * (count - 1)) / (wanted - 1)));
}

/**
 * The frames the GIF palette is chosen from: `base` frames spread over the whole timeline, plus three inside every
 * transition (a quarter, half and three quarters of the way through), because the colours of a dissolve or a fade
 * through black exist nowhere else and a handful of evenly spaced frames would usually miss them. Measured on a
 * gradient page dissolving into a dark one, three per transition lifted the worst frame by 4 dB over two; five
 * or heavier weights gained nothing more. Never more than `max`.
 */
export function paletteSampleFrames(timeline: Timeline, plan: FramePlan, base = 12, max = 36): number[] {
  if (plan.count <= 0) return [];
  const picked = new Set(sampleFrameIndices(plan.count, base));
  for (const seg of timeline.segments) {
    if (seg.transition <= 0) continue;
    for (const share of [0.25, 0.5, 0.75]) picked.add(Math.min(plan.count - 1, Math.max(0, Math.round((seg.start + seg.transition * share) * plan.fps))));
  }
  const all = [...picked].sort((a, b) => a - b);
  return all.length <= max ? all : sampleFrameIndices(all.length, max).map((i) => all[i]);
}

/* ------------------------------------------------------------------ */
/* the whole plan                                                      */
/* ------------------------------------------------------------------ */

export interface AnimationRequest {
  format: AnimatedFormat;
  resolution?: number;
  fps?: number;
}

export interface AnimationPlan {
  format: AnimatedFormat;
  /** design page indices in the order they play */
  pages: number[];
  /** built over exactly `pages`, so `timeline.segments[i].page` indexes `pages` (not the design) */
  timeline: Timeline;
  /** seconds */
  total: number;
  fps: number;
  /** frames a GIF gets, and the frames a video is counted in for progress */
  frames: number;
  width: number;
  height: number;
  resolution: AnimResolution;
  /** something moves: an element animation on a chosen page, or a transition between two chosen pages */
  animated: boolean;
}

/**
 * The timeline of an export. "All pages" is the whole design; "Current page" one page with its own animations and
 * no transition into it; "Custom" the chosen pages in design order with each page's own transition between them.
 * The first chosen page never has an incoming transition (`buildTimeline` ignores it).
 */
export function planAnimation(design: Pick<Design, "width" | "height" | "pages">, pages: readonly number[], request: AnimationRequest): AnimationPlan {
  const resolution = normalizeResolution(request.resolution);
  const fps = normalizeFps(request.format, request.fps);
  const indices = pages.filter((i) => Number.isInteger(i) && i >= 0 && i < design.pages.length);
  const chosen = indices.map((i) => design.pages[i]);
  const timeline = buildTimeline(chosen);
  const size = outputSize(design.width, design.height, resolution);
  return {
    format: request.format,
    pages: indices,
    timeline,
    total: timeline.total,
    fps,
    frames: planFrames(timeline.total, fps).count,
    width: size.width,
    height: size.height,
    resolution,
    animated: chosen.some(pageHasAnimation) || timeline.segments.some((s) => s.transition > 0),
  };
}

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

/** A GIF keeps every frame's work in this tab: beyond these it would take minutes and hundreds of megabytes. */
export const GIF_MAX_FRAMES = 4000;
export const GIF_MAX_PIXEL_FRAMES = 1_500_000_000;
/** A video is recorded in real time, so its length is the time the person waits. */
export const VIDEO_MAX_SECONDS = 600;

/** A sentence for the person when the plan is too big for its format, null when it is fine. */
export function animationProblem(plan: AnimationPlan): string | null {
  if (plan.format === "gif") {
    if (plan.frames > GIF_MAX_FRAMES) return m.exporting.animation.gifTooLong;
    if (plan.frames * plan.width * plan.height > GIF_MAX_PIXEL_FRAMES) return m.exporting.animation.gifTooLarge;
    return null;
  }
  if (plan.total > VIDEO_MAX_SECONDS) return m.exporting.animation.videoTooLong(Math.round(VIDEO_MAX_SECONDS / 60));
  return null;
}

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

/** "12 s", "5.3 s", "1 min 15 s". */
export function formatDuration(seconds: number): string {
  const { amounts } = m.exporting;
  if (!Number.isFinite(seconds) || seconds <= 0) return amounts.seconds(0);
  if (seconds < 60) return amounts.seconds(seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds));
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? amounts.minutesSeconds(minutes, rest) : amounts.minutes(minutes);
}

/* ------------------------------------------------------------------ */
/* size estimates                                                      */
/* ------------------------------------------------------------------ */

export interface PageMotion {
  /** seconds of the page during which something about it changes */
  activeSeconds: number;
  /**
   * Moving flat content (everything but photographs), in "whole picture" seconds: one element covering a tenth of
   * the page that moves for 2 s is 0.2 s.
   */
  flatSeconds: number;
  /**
   * Moving photographs, in the same unit, weighed by how much of their pixels the animation changes: a fade changes
   * fewer than a move, which re-encodes the whole photograph.
   */
  photoSeconds: number;
  /** the transition into this page ("" for none): a push re-encodes everything, a wipe only a strip */
  transitionKind: string;
  /** the page background, serialised: two pages that share one only pay for it once */
  background: string;
}

type Window = [number, number];

interface MotionWindow {
  start: number;
  end: number;
  /** the preset that moves things during the window */
  kind: string;
}

function windowsOf(anim: ElementAnimations, duration: number): MotionWindow[] {
  const out: MotionWindow[] = [];
  const add = (start: number, end: number, kind: string) => {
    const a = Math.max(0, start);
    const b = Math.min(duration, end);
    if (b > a) out.push({ start: a, end: b, kind });
  };
  if (anim.in) {
    const w = animationWindow(anim.in, "in", duration);
    add(w.start, w.end, anim.in.kind);
  }
  if (anim.out) {
    const w = animationWindow(anim.out, "out", duration);
    add(w.start, w.end, anim.out.kind);
  }
  if (anim.loop) add(0, duration, anim.loop.kind);
  return out;
}

/** Total length covered by the windows (overlaps counted once). */
function unionLength(windows: Window[]): number {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  let length = 0;
  let start = 0;
  let end = 0; // the run being built; empty at first
  for (const [a, b] of sorted) {
    if (a > end) {
      length += end - start;
      start = a;
      end = b;
    } else end = Math.max(end, b);
  }
  return length + (end - start);
}

/** Presets that only change opacity: they leave most pixels of a photograph alone once it is in place. */
const OPACITY_ONLY: ReadonlySet<string> = new Set(["fade", "flicker", "pulse", "flash"]);
const OPACITY_ONLY_PHOTO_SHARE = 0.4;

const isPhoto = (el: DesignElement): boolean => el.type === "image" || (el.type === "shape" && el.fill?.type === "image");

/** When and how much of a page moves, and what the transition into it is: the input of the size estimate. */
export function pageMotion(design: Pick<Design, "width" | "height">, page: Pick<Page, "elements" | "duration" | "transition" | "background">): PageMotion {
  const duration = pageDuration(page);
  const area = Math.max(1, design.width * design.height);
  const windows: Window[] = [];
  let flat = 0;
  let photos = 0;
  for (const el of page.elements) {
    if (el.hidden || !el.animation) continue;
    const share = Math.min(1, (el.width * el.height) / area);
    for (const w of windowsOf(el.animation, duration)) {
      windows.push([w.start, w.end]);
      const seconds = (w.end - w.start) * share;
      if (isPhoto(el)) photos += seconds * (OPACITY_ONLY.has(w.kind) ? OPACITY_ONLY_PHOTO_SHARE : 1);
      else flat += seconds;
    }
  }
  const activeSeconds = unionLength(windows);
  return {
    activeSeconds,
    flatSeconds: Math.min(activeSeconds, flat),
    photoSeconds: Math.min(activeSeconds, photos),
    transitionKind: page.transition?.kind ?? "",
    background: JSON.stringify(page.background ?? null),
  };
}

/*
 * The constants below were fitted to real exports: controlled designs (flat pages with up to 40 elements, gradients,
 * patterns, photographs, cuts, every kind of transition between simple and complex pages, fades, rises, loops)
 * encoded at 480p, 720p and 1080p, and recorded as video at 720p. Edges cost with the square root of the pixel
 * count, areas with the pixel count. Most estimates land within a factor of 1.5 of the real file, the worst within
 * about 2.
 */

/** The header, the 256 entry palette and the first (flat) frame. */
const GIF_BASE_BYTES = 700;
const GIF_BASE_BYTES_PER_PIXEL = 0.0009;
/** One element's edges, in bytes per square root of the pixel count; a title counts for several ordinary ones. */
const ELEMENT_BYTES_PER_ROOT_PIXEL = 0.7;
const ELEMENT_TITLE_BONUS = 4;
/** A dithered gradient background (scaled by how far apart its colours are), a pattern, and a photograph. */
const GRADIENT_BYTES_PER_PIXEL = 0.095;
const PATTERN_BYTES_PER_PIXEL = 0.065;
const PHOTO_BYTES_PER_PIXEL = 0.42;
/** One whole picture's worth of moving flat content (bytes per square root of the pixel count) and of moving photograph. */
const MOVING_BYTES_PER_ROOT_PIXEL = 30;
/** A moving element exposes the dithered gradient under it again: this share of a gradient's cost per whole picture. */
const MOVING_GRADIENT_SHARE = 0.6;
/** Per stored frame: image descriptor, graphic control block and the LZW block headers. */
const FRAME_OVERHEAD = 40;

/*
 * A transition frame, as the cost over simply cutting to the page:
 *   push, zoom  everything moves or scales, so all of both pages is encoded again (a page's whole static cost)
 *   slide       only the page coming in moves
 *   wipe        the new page is revealed in place: a strip of it per frame, so the total is the page's own cost
 *   the rest    (dissolve, fade through black) the pictures blend: every pixel changes colour, which is cheap on flat
 *               pages, costs a lot where gradients differ (dithering) or photographs are involved
 */
const MOVE_FRACTION = 0.9;
const SLIDE_FRACTION = 0.5;
const WIPE_FRACTION = 0.03;
const BLEND_BYTES_PER_PIXEL = 0.012;
const BLEND_GRADIENT_BYTES_PER_PIXEL = 0.2;
const BLEND_PHOTO_BYTES_PER_PIXEL = 0.24;
const BLEND_ELEMENT_SHARE = 0.65;
/** Blending two pages that share a background leaves the background's pixels alone. */
const SHARED_BACKGROUND_BLEND_FACTOR = 0.3;

interface StaticParts {
  elements: number;
  background: number;
  photo: number;
}

const gradientFactor = (weight: PageWeight): number => Math.min(1, weight.gradientSpan * 2.2);

/** What a page costs when it appears in one go (a cut, or the first page), by part. */
function staticParts(weight: PageWeight, pixels: number): StaticParts {
  return {
    elements: weight.elements ? ELEMENT_BYTES_PER_ROOT_PIXEL * Math.sqrt(pixels) * (Math.min(weight.elements, 40) + ELEMENT_TITLE_BONUS) : 0,
    background: pixels * (GRADIENT_BYTES_PER_PIXEL * gradientFactor(weight) + (weight.patterned ? PATTERN_BYTES_PER_PIXEL : 0)),
    photo: pixels * PHOTO_BYTES_PER_PIXEL * weight.photo,
  };
}

const wholeBytes = (p: StaticParts): number => p.elements + p.background + p.photo + FRAME_OVERHEAD;

/** Extra bytes of one frame of a transition from `prev` to `next`, over simply cutting. */
function transitionFrameBytes(kind: string, pixels: number, prev: PageWeight, next: PageWeight, sharesBackground: boolean): number {
  const a = staticParts(prev, pixels);
  const b = staticParts(next, pixels);
  switch (kind) {
    case "push":
    case "zoom":
      return MOVE_FRACTION * ((wholeBytes(a) + wholeBytes(b)) / 2);
    case "slide":
      return SLIDE_FRACTION * MOVE_FRACTION * ((wholeBytes(a) + wholeBytes(b)) / 2);
    case "wipe":
      return WIPE_FRACTION * ((wholeBytes(a) + wholeBytes(b)) / 2);
    default: {
      const photo = (prev.photo + next.photo) / 2;
      const gradient = (gradientFactor(prev) + gradientFactor(next)) / 2;
      const background = sharesBackground ? BLEND_BYTES_PER_PIXEL * SHARED_BACKGROUND_BLEND_FACTOR : BLEND_BYTES_PER_PIXEL + BLEND_GRADIENT_BYTES_PER_PIXEL * gradient;
      return pixels * (background + BLEND_PHOTO_BYTES_PER_PIXEL * photo) + BLEND_ELEMENT_SHARE * ((a.elements + b.elements) / 2) + FRAME_OVERHEAD;
    }
  }
}

/**
 * Predicts the size of the GIF. The encoder stores only what changed from one frame to the next and merges frames
 * that are identical, so a page that sits still costs nothing: the bill is every page once (a background two pages
 * share only once), every frame of a transition, and a share of a picture for every frame of an element animation.
 */
export function estimateGifBytes(plan: AnimationPlan, weights: readonly PageWeight[], motions: readonly PageMotion[]): number {
  if (!plan.frames) return 0;
  const pixels = plan.width * plan.height;
  const root = Math.sqrt(pixels);
  let bytes = GIF_BASE_BYTES + GIF_BASE_BYTES_PER_PIXEL * pixels;
  plan.timeline.segments.forEach((seg, i) => {
    const weight = weights[i];
    const motion = motions[i];
    if (!weight || !motion) return;
    const sharesBackground = i > 0 && motions[i - 1]?.background === motion.background;
    const parts = staticParts(weight, pixels);
    bytes += wholeBytes(parts) - (sharesBackground ? parts.background : 0);
    if (seg.transition > 0 && i > 0 && weights[i - 1]) {
      bytes += Math.max(1, Math.round(seg.transition * plan.fps)) * transitionFrameBytes(motion.transitionKind, pixels, weights[i - 1], weight, sharesBackground);
    }
    // frames in which something of the page moves: the seconds are "whole picture" equivalents
    const flatFrames = motion.flatSeconds * plan.fps;
    const photoFrames = motion.photoSeconds * plan.fps;
    bytes +=
      flatFrames * (MOVING_BYTES_PER_ROOT_PIXEL * root + MOVING_GRADIENT_SHARE * parts.background) +
      photoFrames * PHOTO_BYTES_PER_PIXEL * pixels +
      Math.round(motion.activeSeconds * plan.fps) * FRAME_OVERHEAD;
  });
  return Math.round(bytes);
}

/** Bits per second the recorder is asked for: about 0.09 bit per pixel per frame, between 1 and 10 Mbit/s. */
export function videoBitrate(width: number, height: number, fps: number = VIDEO_FPS): number {
  return Math.round(Math.min(10_000_000, Math.max(1_000_000, width * height * fps * 0.09)));
}

/*
 * The recorder works to its bitrate target, and how much of it a page uses depends on what is on the page: a flat page
 * that sits still needs about 3% of it, a page with a gradient or a photograph uses all of it even when nothing
 * moves, and the moment anything moves the encoder spends a burst of bits.
 */
const VIDEO_FLAT_SHARE = 0.03;
const VIDEO_ELEMENT_SHARE = 0.0035;
const VIDEO_GRADIENT_SHARE = 0.95;
const VIDEO_PATTERN_SHARE = 0.6;
const VIDEO_MOTION_BURST = 0.35;
const VIDEO_MOTION_PER_ACTIVE = 0.35;
/** A transition keeps the encoder at about this much of the target. */
const VIDEO_TRANSITION_SHARE = 0.9;

/**
 * Predicts the size of the WebM from its bitrate target: each page and transition keeps the recorder at some share
 * of the target for as long as it lasts.
 */
export function estimateWebmBytes(plan: AnimationPlan, weights: readonly PageWeight[], motions: readonly PageMotion[]): number {
  if (!plan.frames) return 0;
  let seconds = 0; // seconds of recording at the full target rate
  plan.timeline.segments.forEach((seg, i) => {
    const weight = weights[i];
    const motion = motions[i];
    if (!weight || !motion) return;
    const length = seg.end - seg.playStart;
    let share =
      VIDEO_FLAT_SHARE +
      VIDEO_ELEMENT_SHARE * Math.min(weight.elements, 40) +
      VIDEO_GRADIENT_SHARE * Math.min(1, weight.gradientSpan * 40) +
      (weight.patterned ? VIDEO_PATTERN_SHARE : 0) +
      weight.photo;
    if (motion.activeSeconds > 0) share += VIDEO_MOTION_BURST + VIDEO_MOTION_PER_ACTIVE * Math.min(1, motion.activeSeconds / Math.max(0.001, length));
    seconds += length * Math.min(1, share) + seg.transition * VIDEO_TRANSITION_SHARE;
  });
  return Math.round((videoBitrate(plan.width, plan.height) / 8) * seconds);
}

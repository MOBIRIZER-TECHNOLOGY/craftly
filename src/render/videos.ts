/**
 * The pictures of a video element (VideoElement in src/core/types.ts), for the painter, which never waits:
 *
 *   - At rest (the editor, thumbnails, PNG, PDF, SVG, PowerPoint, a GIF) a clip is its frame at `trimStart`, its *poster*. It is
 *     read once from the clip (a hidden <video> is sought there and drawn onto a canvas) and kept in the cache of src/render/images.ts,
 *     so that the page is painted again when it is ready, as it is for a picture.
 *   - Playing (Present, the animation preview, a video recorded as it plays) a clip has a <video> of its own for each element, kept
 *     in step with the time the page has been shown: `playingFrame(el, time)` starts it at the place that time stands for, seeks
 *     it again when it has drifted (or when it went round to `trimStart`), and gives it to be drawn once it has a frame. A player
 *     that is not asked for is paused after a moment and let go of after half a minute.
 *
 * A clip is only ever one of this browser's uploads ("asset:<id>"): a design never plays anything from the web.
 */
import { clipGainAt, clipLocalTime, clipPlayingLength, clipStartAt } from "@/core/animation";
import { getAssetUrl } from "@/core/assets";
import type { DesignElement, VideoElement } from "@/core/types";

/** A frame drawn this long or more from where the clock says the clip should be is sought again. */
const DRIFT = 0.25;
/** A player that has not been asked for a frame for this long is paused (the page was left, the show ended). */
const IDLE_PAUSE_MS = 400;
/** And let go of after this long. */
const IDLE_RELEASE_MS = 30_000;
/** The longest side of a poster, in pixels. */
const POSTER_MAX = 1920;
/** A clip that has not given a frame in this long counts as one that cannot be played here. */
const LOAD_TIMEOUT_MS = 20_000;

export const isVideoSource = (src: unknown): src is string => typeof src === "string" && /^asset:[\w-]+$/.test(src);

/** The length of the part of the clip that plays, in seconds of the clip (never 0, so that a clip trimmed to nothing still has a frame). */
export function trimmedLength(el: Pick<VideoElement, "trimStart" | "trimEnd">): number {
  return Math.max(0.05, el.trimEnd - el.trimStart);
}

/** How long the part that plays takes to play once, in seconds of the page, at the element's speed. */
export const playingLength = clipPlayingLength;

/** How far before `trimEnd` a clip that plays once holds: a seek there lands on its last frame, which a seek to the very end may miss. */
export const LAST_FRAME_BEFORE_END = 0.04;

/**
 * The place in the clip, in seconds, that `time` seconds of the page stand for: from `trimStart`, at `speed`, over again at
 * `trimEnd`; a clip that plays once stays on its last frame after that.
 */
export function clipTime(el: Pick<VideoElement, "trimStart" | "trimEnd" | "speed" | "once" | "startAt">, time: number): number {
  const span = trimmedLength(el);
  const played = clipLocalTime(el, time) * (el.speed > 0 ? el.speed : 1);
  if (el.once) return el.trimStart + Math.min(played, Math.max(0, span - LAST_FRAME_BEFORE_END));
  return el.trimStart + (played % span);
}

/** True when a clip that plays once has played, `time` seconds into its page: it holds its last frame and is silent. */
export const clipFinished = (el: Pick<VideoElement, "trimStart" | "trimEnd" | "speed" | "once" | "startAt">, time: number): boolean =>
  !!el.once && clipLocalTime(el, time) >= playingLength(el);

/** True while a clip waits for its start time on its page: it shows its first frame and is silent. */
export const clipWaiting = (el: Pick<VideoElement, "startAt">, time: number): boolean => time < clipStartAt(el);

/** The shortest part of a clip that can be left to play, in seconds. */
export const MIN_TRIM = 0.1;

/**
 * The start and end of the part that plays, kept inside the clip and at least MIN_TRIM apart: the value that is changed moves the
 * other one out of its way when they would cross.
 */
export function clampTrim(el: Pick<VideoElement, "duration" | "trimStart" | "trimEnd">, next: { start?: number; end?: number }): { trimStart: number; trimEnd: number } {
  const length = Math.max(MIN_TRIM, el.duration);
  // to the hundredth, but never past `most`: a clip of 2.918 s ends at 2.918, not at 2.92, after its last frame
  const round = (v: number, most: number) => Math.min(Math.round(v * 100) / 100, most);
  if (next.start !== undefined) {
    const start = round(Math.min(Math.max(0, next.start), length - MIN_TRIM), length - MIN_TRIM);
    return { trimStart: start, trimEnd: round(Math.max(Math.min(el.trimEnd, length), start + MIN_TRIM), length) };
  }
  const end = round(Math.max(Math.min(length, next.end ?? el.trimEnd), MIN_TRIM), length);
  return { trimStart: round(Math.min(Math.max(0, el.trimStart), end - MIN_TRIM), end - MIN_TRIM), trimEnd: end };
}

/** 0:07, 1:30, 12:05: a length or a place in a clip, to the second (tenths under ten seconds when `tenths`: 2.5 s is 0:02.5). */
export function clipClock(seconds: number, tenths = false): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (tenths && safe < 10) return `0:0${(Math.round(safe * 10) / 10).toFixed(1)}`;
  const whole = Math.round(safe);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/* ---------------- the poster: one frame, read once ---------------- */

/** A hidden, silent <video> of the clip at `url`, sought to `at`, drawn on a canvas. Null when the browser cannot play the clip. */
export function readFrame(url: string, at: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const finish = (canvas: HTMLCanvasElement | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(canvas);
    };
    const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      const end = Number.isFinite(video.duration) ? video.duration : at;
      // a frame just before the end, not at it: some browsers have no frame to show at the very end
      const target = Math.max(0, Math.min(at, end - 0.05));
      if (Math.abs(video.currentTime - target) < 0.01) draw();
      else video.currentTime = target;
    };
    video.onseeked = () => draw();
    function draw() {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!(w > 0 && h > 0)) return finish(null);
      const scale = Math.min(1, POSTER_MAX / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return finish(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      finish(canvas);
    }
    video.src = url;
  });
}

/** The poster of the clip `src` at `at` seconds, for the cache of src/render/images.ts. */
export async function loadPoster(src: string, at: number): Promise<HTMLCanvasElement | null> {
  if (!isVideoSource(src)) return null;
  const url = await getAssetUrl(src.slice(6));
  return url ? readFrame(url, at) : null;
}

/* ---------------- playing ---------------- */

interface Player {
  src: string;
  video: HTMLVideoElement;
  /** when a frame was last asked for (performance.now()) */
  used: number;
  /** the clip could not be played here: the poster stands in */
  broken: boolean;
}

const players = new Map<string, Player>();
const subs = new Set<() => void>();
let sweeper: ReturnType<typeof setInterval> | null = null;

/** Called when a player has its first frame, or could not get one: the page is painted again. */
export function onVideosChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
const tell = () => subs.forEach((cb) => cb());

function release(key: string, player: Player): void {
  player.video.pause();
  player.video.removeAttribute("src");
  player.video.load();
  players.delete(key);
}

function sweep(): void {
  const now = performance.now();
  for (const [key, player] of players) {
    const idle = now - player.used;
    if (idle > IDLE_RELEASE_MS) release(key, player);
    else if (idle > IDLE_PAUSE_MS && !player.video.paused) player.video.pause();
  }
  if (!players.size && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

function playerFor(el: VideoElement): Player | null {
  const known = players.get(el.id);
  if (known && known.src === el.src) return known;
  if (known) release(el.id, known);
  if (!isVideoSource(el.src) || typeof document === "undefined") return null;
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  const player: Player = { src: el.src, video, used: performance.now(), broken: false };
  video.onloadeddata = tell;
  video.onerror = () => {
    player.broken = true;
    tell();
  };
  players.set(el.id, player);
  void getAssetUrl(el.src.slice(6)).then((url) => {
    if (players.get(el.id) !== player) return;
    if (url) video.src = url;
    else {
      player.broken = true;
      tell();
    }
  });
  sweeper ??= setInterval(sweep, 250);
  return player;
}

function start(video: HTMLVideoElement): void {
  let started: Promise<void> | undefined;
  try {
    started = video.play();
  } catch {
    return;
  }
  // a browser that will not play sound before the person has done anything on the page still plays the clip silently
  started?.catch(() => {
    if (video.muted) return;
    video.muted = true;
    video.play()?.catch(() => undefined);
  });
}

/**
 * The <video> to draw for `el` when the page has been shown for `time` seconds, playing at the place that time stands for; null
 * until it has a frame there (the caller draws the poster and is told by `onVideosChange` when to paint again) or when the clip
 * cannot be played in this browser. With `sound` the clip plays with its sound, unless it is muted.
 */
export function playingFrame(el: VideoElement, time: number, sound = false): HTMLVideoElement | null {
  const player = playerFor(el);
  if (!player || player.broken) return null;
  player.used = performance.now();
  const { video } = player;
  const want = clipTime(el, time);
  const rate = el.speed > 0 ? el.speed : 1;
  if (video.playbackRate !== rate) video.playbackRate = rate;
  const muted = !sound || !!el.muted;
  if (video.muted !== muted) video.muted = muted;
  // a clip that waits for its start time, or has played once, stands still and is silent
  const still = clipFinished(el, time) || clipWaiting(el, time);
  if (!muted) {
    // its volume, and its fades at the start and the end of every play of it (silent once a clip that plays once has played)
    const volume = still ? 0 : clipGainAt(el, clipLocalTime(el, time) % playingLength(el));
    if (Math.abs(video.volume - volume) > 0.001) video.volume = volume;
  }
  if (video.readyState < 1) return null;
  const off = Math.abs(video.currentTime - want) > DRIFT;
  if (off && !video.seeking) video.currentTime = want;
  // a clip that has played once stands on its last frame; any other plays on
  if (still) {
    if (!video.paused) video.pause();
  } else if (video.paused || video.ended) start(video);
  return video.readyState >= 2 && !off ? video : null;
}

/**
 * Starts a player for each clip of `elements` (groups looked into) at `trimStart` and waits until each has a frame or cannot get
 * one, for at most `timeoutMs`: a recording then begins with the clips playing, not with their posters.
 */
export async function prepareClips(elements: readonly DesignElement[], timeoutMs = 5000): Promise<void> {
  const clips: VideoElement[] = [];
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    if (el.type === "video") clips.push(el);
    else if (el.type === "group") el.children.forEach(visit);
  };
  elements.forEach(visit);
  const until = performance.now() + timeoutMs;
  for (const el of clips) {
    while (playingFrame(el, 0) === null && !players.get(el.id)?.broken && performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    players.get(el.id)?.video.pause();
  }
}

/** Pauses every clip that plays (the show was left); they go on from where the page is when they are asked for again. */
export function pauseVideos(): void {
  for (const player of players.values()) player.video.pause();
}

/** Lets go of every player. For tests, and for the end of a recording. */
export function releaseVideos(): void {
  for (const [key, player] of players) release(key, player);
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

/**
 * The sounds of a design (`Design.audio`, design version 3): music or a voice on the timeline's own row, placed at a second of the
 * design's time and playing on across its pages. Everything here is pure: what a track sounds like at a moment, where its bar runs,
 * and what of a track that came from outside (a file, a backup) may be kept.
 *
 * A track's volume and fades follow the same rules and the same curve as a clip's (clipGainAt in animation.ts), at speed 1.
 */
import { clipFades, clipGainAt, clipVolume, MAX_CLIP_FADE } from "./animation";
import { uid } from "./ids";
import type { AudioTrack } from "./types";

/** The most sounds a design holds. */
export const MAX_TRACKS = 20;
/** The latest a sound can start, in seconds of the design (an hour: longer than any design can last). */
export const MAX_TRACK_START = 3600;
/** The shortest part of a sound that can be kept by trimming, in seconds. */
export const MIN_TRACK_TRIM = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The fields of a clip a track's sound is worked out with (a track plays at speed 1). */
const asClip = (t: AudioTrack) => ({ trimStart: t.trimStart, trimEnd: t.trimEnd, speed: 1, volume: t.volume, fadeIn: t.fadeIn, fadeOut: t.fadeOut });

/** Seconds one play of a track lasts: its trimmed part. */
export const trackLength = (t: Pick<AudioTrack, "trimStart" | "trimEnd">): number => Math.max(0.05, t.trimEnd - t.trimStart);

/** Seconds into the design at which it starts, 0 to MAX_TRACK_START (a value that is not a number counts as 0). */
export const trackStartAt = (t: Pick<AudioTrack, "startAt">): number => (isNum(t.startAt) ? clamp(t.startAt, 0, MAX_TRACK_START) : 0);

/** How loud it plays, 0 to 1. */
export const trackVolume = (t: AudioTrack): number => clipVolume(t);

/** Its fades, in seconds, shortened alike when they add up to more than one play of it. */
export const trackFades = (t: AudioTrack): { fadeIn: number; fadeOut: number } => clipFades(asClip(t));

export { MAX_CLIP_FADE as MAX_TRACK_FADE };

/** Seconds of the design from which to which a track's bar runs in a design `total` seconds long; nothing past its end. */
export function trackSpan(t: AudioTrack, total: number): { start: number; end: number } {
  const start = Math.min(trackStartAt(t), total);
  return { start, end: t.loop ? total : Math.min(total, start + trackLength(t)) };
}

/**
 * What a track plays `time` seconds into the design: the second of its sound file and how loud (its volume and fades); null while it
 * is silent (before it starts, and after a track that plays once has played).
 */
export function trackSoundAt(t: AudioTrack, time: number): { at: number; gain: number } | null {
  const local = time - trackStartAt(t);
  const length = trackLength(t);
  if (local < 0 || (!t.loop && local >= length)) return null;
  const into = local % length;
  return { at: t.trimStart + into, gain: clipGainAt(asClip(t), into) };
}

/** A new track of a sound of the uploads, `duration` seconds long, starting `startAt` seconds into the design and playing once. */
export function createAudioTrack(init: { src: string; name?: string; duration: number; startAt?: number }): AudioTrack {
  const duration = isNum(init.duration) && init.duration > 0 ? init.duration : 1;
  return {
    id: uid("au"),
    src: init.src,
    ...(init.name ? { name: init.name } : {}),
    duration,
    trimStart: 0,
    trimEnd: duration,
    startAt: clamp(isNum(init.startAt) ? init.startAt : 0, 0, MAX_TRACK_START),
  };
}

const ASSET_SRC = /^asset:[A-Za-z0-9_-]{1,64}$/;

/** A track from outside the app (a file, a backup, a stored design) when it can be used as it is or with its numbers put in range; null otherwise. */
function readTrack(raw: unknown): AudioTrack | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || r.id.length > 64 || typeof r.src !== "string" || !ASSET_SRC.test(r.src)) return null;
  if (!isNum(r.duration) || r.duration <= 0 || !isNum(r.trimStart) || !isNum(r.trimEnd)) return null;
  const duration = r.duration;
  const trimStart = clamp(r.trimStart, 0, Math.max(0, duration - MIN_TRACK_TRIM));
  const trimEnd = clamp(r.trimEnd, Math.min(duration, trimStart + MIN_TRACK_TRIM), duration);
  const track: AudioTrack = { id: r.id, src: r.src, duration, trimStart, trimEnd, startAt: trackStartAt({ startAt: r.startAt as number }) };
  if (typeof r.name === "string" && r.name) track.name = r.name.slice(0, 200);
  if (r.loop === true) track.loop = true;
  const volume = isNum(r.volume) ? clamp(r.volume, 0, 1) : 1;
  if (volume !== 1) track.volume = volume;
  if (isNum(r.fadeIn) && r.fadeIn > 0) track.fadeIn = Math.min(MAX_CLIP_FADE, r.fadeIn);
  if (isNum(r.fadeOut) && r.fadeOut > 0) track.fadeOut = Math.min(MAX_CLIP_FADE, r.fadeOut);
  return track;
}

/**
 * The tracks of a design that came from outside the app, as they can be used: each one that is a track (a sound of the uploads, with
 * a length and a trim) with its numbers put in range, the first of two with one id, at most MAX_TRACKS. `skipped` counts the rest.
 */
export function readAudioTracks(raw: unknown): { tracks: AudioTrack[]; skipped: number } {
  if (!Array.isArray(raw)) return { tracks: [], skipped: 0 };
  const tracks: AudioTrack[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const track = readTrack(item);
    if (!track || seen.has(track.id) || tracks.length >= MAX_TRACKS) continue;
    seen.add(track.id);
    tracks.push(track);
  }
  return { tracks, skipped: raw.length - tracks.length };
}

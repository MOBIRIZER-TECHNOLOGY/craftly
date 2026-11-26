/**
 * The sound of a video download: every clip that is not muted plays its trimmed part while its page is on screen, over and over at
 * its speed, as it does in Present. Pages are laid out on the export's timeline (`buildTimeline`): a clip sounds from the moment its
 * page starts (after the transition into it) to the moment the page ends; a transition, which shows the pages still, is silent.
 *
 * Each clip's audio is read from its stored file with Mediabunny, only the trimmed part, stretched to its speed at the same pitch
 * (stretch.ts), and the timeline is mixed at 48 kHz stereo a second at a time (`ClipSoundMix.read`), as the encoder needs it.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { getAsset } from "@/core/assets";
import { clipFades, clipGainAt, clipLoopFrom, clipStartAt, clipVolume } from "@/core/animation";
import type { Timeline } from "@/core/transition";
import type { Page, VideoElement } from "@/core/types";
import { trimmedLength } from "@/render/videos";
import { throwIfAborted } from "../errors";
import { soundingClips } from "./frames";
import { fadeEnds, timeStretch } from "./stretch";

export const SOUND_RATE = 48_000;
/** a clip fades in and out over this long where it loops and where its page ends, so it never clicks */
const FADE_SECONDS = 0.005;
const PAGE_FADE_SECONDS = 0.01;

/** Gives one play of a clip its volume and its fades (clipGainAt, the same curve Present follows). */
function shapeLoud(channels: Float32Array[], sampleRate: number, el: VideoElement): void {
  const volume = clipVolume(el);
  const { fadeIn, fadeOut } = clipFades(el);
  if (volume === 1 && fadeIn === 0 && fadeOut === 0) return;
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= clipGainAt(el, i / sampleRate);
}

/** One loop of a clip as it sounds on the page: the trimmed part, at the clip's speed. */
interface Loop {
  channels: Float32Array[];
  sampleRate: number;
}

/** The trimmed part of a clip's sound, at its speed; null when the clip has no sound or this browser cannot decode it. */
async function readLoop(el: VideoElement): Promise<Loop | null> {
  const asset = await getAsset(el.src.slice(6));
  if (!asset) return null;
  const input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const start = el.trimStart;
    const span = trimmedLength(el);
    let sampleRate = 0;
    let channels: Float32Array[] = [];
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(start, start + span)) {
      if (!sampleRate) {
        sampleRate = buffer.sampleRate;
        channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, () => new Float32Array(Math.max(1, Math.round(span * sampleRate))));
      }
      // each piece is copied to where it belongs in the trimmed part (the first may start before the trim, the last run past it)
      const offset = Math.round((timestamp - start) * sampleRate);
      for (let c = 0; c < channels.length; c++) {
        const data = buffer.getChannelData(c);
        const dst = channels[c];
        const from = Math.max(0, -offset);
        const to = Math.min(data.length, dst.length - offset);
        if (to > from) dst.set(data.subarray(from, to), offset + from);
      }
    }
    if (!sampleRate) return null;
    const speed = el.speed > 0 ? el.speed : 1;
    const played = timeStretch(channels, speed);
    fadeEnds(played, Math.round(FADE_SECONDS * sampleRate));
    shapeLoud(played, sampleRate, el);
    return { channels: played, sampleRate };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** One play of a clip's sound on the export's timeline: from `begin` to `until` seconds, looping or not, `phase` seconds into its loop at `begin`. */
interface Play {
  loop: Loop;
  begin: number;
  until: number;
  looping: boolean;
  phase: number;
}

/** How much of the mix is rendered at once, in seconds: a long video never holds its whole sound. */
export const MIX_WINDOW_SECONDS = 1;

/**
 * The mixed sound of a video download, read a window at a time (`read`) as the encoder needs it, so a ten-minute video does not hold
 * ten minutes of sound at once. `gain` lowers the whole mix evenly when it would go past full scale (measured before the first read).
 */
export interface ClipSoundMix {
  sampleRate: number;
  /** samples, the length of the video */
  length: number;
  gain: number;
  /** the mix from sample `from` to sample `to` */
  read(from: number, to: number): Promise<AudioBuffer>;
}

/**
 * The mixed sound of the playback described by `timeline` over `pages` (the chosen pages, in playing order), `total` seconds long;
 * null when no clip on them makes a sound, so the video gets no sound track at all.
 */
export async function mixClipSound(pages: readonly Page[], timeline: Timeline, total: number, signal?: AbortSignal): Promise<ClipSoundMix | null> {
  const loops = new Map<string, Promise<Loop | null>>();
  const loopOf = (el: VideoElement) => {
    // one read per clip, trim, speed, volume and fades: two copies of a clip alike sound the same
    const key = `${el.src}|${el.trimStart}|${el.trimEnd}|${el.speed}|${clipVolume(el)}|${el.fadeIn ?? 0}|${el.fadeOut ?? 0}`;
    let loop = loops.get(key);
    if (!loop) {
      loop = readLoop(el);
      loops.set(key, loop);
    }
    return loop;
  };

  const plays: Play[] = [];
  for (const seg of timeline.segments) {
    const page = pages[seg.page];
    const until = Math.min(seg.end, total);
    if (!page || until - seg.playStart <= 0) continue;
    for (const el of soundingClips(page.elements)) {
      throwIfAborted(signal);
      // a clip that starts later on its page is silent until then
      const begin = seg.playStart + clipStartAt(el);
      if (begin >= until) continue;
      const loop = await loopOf(el);
      if (loop) plays.push({ loop, begin, until, looping: !el.once, phase: clipLoopFrom(el) });
    }
  }
  if (!plays.length) return null;

  const length = Math.max(1, Math.ceil(total * SOUND_RATE));
  const mix: ClipSoundMix = { sampleRate: SOUND_RATE, length, gain: 1, read: (from, to) => renderWindow(plays, from, to, mix.gain) };
  // the loudest moment, window by window, before anything is encoded: the gain must be the same all through
  const step = MIX_WINDOW_SECONDS * SOUND_RATE;
  let peak = 0;
  for (let from = 0; from < length; from += step) {
    throwIfAborted(signal);
    peak = Math.max(peak, peakOf(await renderWindow(plays, from, Math.min(length, from + step), 1)));
  }
  if (peak > MIX_CEILING) mix.gain = MIX_CEILING / peak;
  return mix;
}

/** The loudest a mix is left: a little under full scale, so that the encoder does not clip it. */
export const MIX_CEILING = 0.98;

function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * The plays mixed from sample `from` to sample `to` of the timeline, times `gain`. Each play gives only the samples of its sound that
 * fall in the window (going round its loop as often as it needs), and fades out over the last 10 ms of its page.
 */
async function renderWindow(plays: readonly Play[], from: number, to: number, gain: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, to - from), sampleRate: SOUND_RATE });
  const w0 = from / SOUND_RATE;
  const w1 = to / SOUND_RATE;
  for (const play of plays) {
    const start = Math.max(play.begin, w0);
    const end = Math.min(play.until, w1);
    if (end <= start) continue;
    const piece = pieceOf(play, start - play.begin + play.phase, end - start);
    if (!piece) continue;
    const source = ctx.createBufferSource();
    source.buffer = piece;
    const level = ctx.createGain();
    // the page ends inside this window: fade out over its last 10 ms (from wherever that fade has got to at the window's start)
    const fade = Math.min(PAGE_FADE_SECONDS, (play.until - play.begin) / 2);
    if (play.until <= w1 && play.until - fade < w1) {
      const fadeFrom = Math.max(start, play.until - fade);
      // a fade that began in the window before has got part of the way: start this window where it has got to
      const reached = play.until - fade >= start ? 1 : Math.min(1, (play.until - fadeFrom) / fade);
      level.gain.setValueAtTime(reached, fadeFrom - w0);
      level.gain.linearRampToValueAtTime(0, play.until - w0);
    }
    source.connect(level).connect(ctx.destination);
    source.start(start - w0);
  }
  const rendered = await ctx.startRendering();
  if (gain !== 1) {
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= gain;
    }
  }
  return rendered;
}

/**
 * `seconds` of a play's sound from `into` seconds after it began, as its own buffer: round its loop as often as needed, or, for a
 * clip that plays once, only what there is (null when it has finished).
 */
function pieceOf(play: Play, into: number, seconds: number): AudioBuffer | null {
  const { channels, sampleRate } = play.loop;
  const loopLength = channels[0].length;
  let offset = Math.round(into * sampleRate);
  let count = Math.max(1, Math.round(seconds * sampleRate));
  if (play.looping) offset %= loopLength;
  else {
    if (offset >= loopLength) return null;
    count = Math.min(count, loopLength - offset);
  }
  const piece = new AudioBuffer({ length: count, numberOfChannels: channels.length, sampleRate });
  channels.forEach((data, c) => {
    const out = piece.getChannelData(c);
    let written = 0;
    let at = offset;
    while (written < count) {
      const take = Math.min(count - written, loopLength - at);
      out.set(data.subarray(at, at + take), written);
      written += take;
      at = 0;
    }
  });
  return piece;
}

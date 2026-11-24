/**
 * The sound of a video download: every clip that is not muted plays its trimmed part while its page is on screen, over and over at
 * its speed, as it does in Present. Pages are laid out on the export's timeline (`buildTimeline`): a clip sounds from the moment its
 * page starts (after the transition into it) to the moment the page ends; a transition, which shows the pages still, is silent.
 *
 * Each clip's audio is read from its stored file with Mediabunny, only the trimmed part, stretched to its speed at the same pitch
 * (stretch.ts), and the whole timeline is mixed in an OfflineAudioContext at 48 kHz stereo.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { getAsset } from "@/core/assets";
import { clipFades, clipGainAt, clipStartAt, clipVolume } from "@/core/animation";
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

/**
 * The mixed sound of the playback described by `timeline` over `pages` (the chosen pages, in playing order), `total` seconds long;
 * null when no clip on them makes a sound, so the video gets no sound track at all.
 */
export async function mixClipSound(pages: readonly Page[], timeline: Timeline, total: number, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const loops = new Map<string, Promise<Loop | null>>();
  const loopOf = (el: VideoElement) => {
    // one read per clip, trim and speed: two copies of a clip on one page sound the same
    const key = `${el.src}|${el.trimStart}|${el.trimEnd}|${el.speed}|${clipVolume(el)}|${el.fadeIn ?? 0}|${el.fadeOut ?? 0}`;
    let loop = loops.get(key);
    if (!loop) {
      loop = readLoop(el);
      loops.set(key, loop);
    }
    return loop;
  };

  const length = Math.max(1, Math.ceil(total * SOUND_RATE));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: SOUND_RATE });
  let sounding = 0;
  for (const seg of timeline.segments) {
    const page = pages[seg.page];
    const from = seg.playStart;
    const until = Math.min(seg.end, total);
    if (!page || until - from <= 0) continue;
    for (const el of soundingClips(page.elements)) {
      throwIfAborted(signal);
      const loop = await loopOf(el);
      if (!loop) continue;
      const buffer = new AudioBuffer({ length: loop.channels[0].length, numberOfChannels: loop.channels.length, sampleRate: loop.sampleRate });
      loop.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
      // a clip that starts later on its page is silent until then
      const begin = from + clipStartAt(el);
      if (begin >= until) continue;
      const source = loopingSource(ctx, buffer, !el.once);
      const gain = ctx.createGain();
      const fade = Math.min(PAGE_FADE_SECONDS, (until - from) / 2);
      gain.gain.setValueAtTime(1, Math.max(from, until - fade));
      gain.gain.linearRampToValueAtTime(0, until);
      source.connect(gain).connect(ctx.destination);
      source.start(begin);
      source.stop(until);
      sounding++;
    }
  }
  if (!sounding) return null;
  throwIfAborted(signal);
  const mixed = await ctx.startRendering();
  keepUnderFullScale(mixed);
  return mixed;
}

/** The loudest a mix is left: a little under full scale, so that the encoder does not clip it. */
export const MIX_CEILING = 0.98;

/**
 * Lowers the whole mix evenly when clips that sound at once add up past full scale, which an encoder would clip into a crackle
 * (two clips recorded near full volume do). A mix that fits is left exactly as it is.
 */
export function keepUnderFullScale(mix: AudioBuffer): void {
  let peak = 0;
  for (let c = 0; c < mix.numberOfChannels; c++) {
    const data = mix.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak <= MIX_CEILING) return;
  const gain = MIX_CEILING / peak;
  for (let c = 0; c < mix.numberOfChannels; c++) {
    const data = mix.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}

/**
 * A source node for `buffer`; with `loop` it starts again at its beginning, as the clip goes back to its trim, and without (a clip
 * that plays once) it plays once and is silent after.
 */
function loopingSource(ctx: BaseAudioContext, buffer: AudioBuffer, loop: boolean): AudioBufferSourceNode {
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = loop;
  return node;
}

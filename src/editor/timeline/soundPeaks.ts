/**
 * The shape of a sound, for its bar on the timeline: the loudest sample of every PEAKS_PER_SECOND-th of a second, from 0 to 1 (the
 * loudest moment of the whole sound is 1). The sound is read a piece at a time with Mediabunny (loaded only when a bar needs it),
 * so a ten-minute song is never held whole; each sound is read once and kept, so a bar drawn again (a drag, a zoom) costs nothing.
 * The sound is one of this browser's uploads ("asset:<id>").
 */
import { useEffect, useState } from "react";
import { getAsset } from "@/core/assets";

/** How many peaks a second of sound has. */
export const PEAKS_PER_SECOND = 20;
/** The most peaks one sound keeps (an hour at 20 a second): a longer one is read at fewer a second. */
const MAX_PEAKS = 72_000;

/** Peaks of a sound, `perSecond` of them a second, each 0..1. */
export interface SoundPeaks {
  perSecond: number;
  peaks: Float32Array;
}

/**
 * Adds a piece of sound to `peaks`: `channels` (one or two) of samples at `sampleRate`, starting `timestamp` seconds into the sound.
 * Each peak keeps the loudest sample that falls in it, of any channel.
 */
export function addToPeaks(peaks: Float32Array, perSecond: number, timestamp: number, sampleRate: number, channels: readonly Float32Array[]): void {
  const length = channels[0]?.length ?? 0;
  for (let i = 0; i < length; i++) {
    const bin = Math.floor((timestamp + i / sampleRate) * perSecond);
    if (bin < 0) continue;
    if (bin >= peaks.length) break;
    let loud = 0;
    for (const data of channels) {
      const v = Math.abs(data[i]);
      if (v > loud) loud = v;
    }
    if (loud > peaks[bin]) peaks[bin] = loud;
  }
}

/** The peaks scaled so that the loudest is 1 (all 0 for silence). */
export function normalizePeaks(peaks: Float32Array): Float32Array {
  let top = 0;
  for (const v of peaks) if (v > top) top = v;
  if (top > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= top;
  return peaks;
}

/** The peaks of `src` for `duration` seconds of it; null when it cannot be read here (no such upload, no sound, a codec this browser lacks). */
async function readPeaks(src: string, duration: number): Promise<SoundPeaks | null> {
  const asset = await getAsset(src.slice("asset:".length));
  if (!asset) return null;
  const perSecond = Math.min(PEAKS_PER_SECOND, MAX_PEAKS / Math.max(1, duration));
  const peaks = new Float32Array(Math.max(1, Math.ceil(duration * perSecond)));
  const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
      addToPeaks(peaks, perSecond, timestamp, buffer.sampleRate, channels);
    }
    return { perSecond, peaks: normalizePeaks(peaks) };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

const cache = new Map<string, SoundPeaks | null>();
const reading = new Map<string, Promise<SoundPeaks | null>>();

/** The peaks of a sound once they have been read (null until then, and for a sound that cannot be read). */
export function useSoundPeaks(src: string, duration: number): SoundPeaks | null {
  const [, setRead] = useState(0);
  useEffect(() => {
    if (cache.has(src)) return;
    let live = true;
    let job = reading.get(src);
    if (!job) {
      job = readPeaks(src, duration).catch(() => null);
      reading.set(src, job);
      void job.then((result) => {
        cache.set(src, result);
        reading.delete(src);
      });
    }
    void job.then(() => live && setRead((n) => n + 1));
    return () => {
      live = false;
    };
  }, [src, duration]);
  return cache.get(src) ?? null;
}

/**
 * The peaks of one play of a sound, from `trimStart` to `trimEnd` seconds of it, in `count` columns (each the loudest of the peaks
 * it covers), for a bar `count` columns wide.
 */
export function peaksBetween(sound: SoundPeaks, trimStart: number, trimEnd: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const from = trimStart * sound.perSecond;
  const span = Math.max(0, trimEnd - trimStart) * sound.perSecond;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor(from + (span * i) / n);
    const b = Math.max(a + 1, Math.ceil(from + (span * (i + 1)) / n));
    let loud = 0;
    for (let k = a; k < b && k < sound.peaks.length; k++) if (sound.peaks[k] > loud) loud = sound.peaks[k];
    return loud;
  });
}

/** For tests: forget every sound's peaks. */
export function clearSoundPeaks(): void {
  cache.clear();
  reading.clear();
}

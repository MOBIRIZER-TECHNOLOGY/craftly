/**
 * Changing the speed of a sound without changing its pitch (WSOLA: waveform-similarity overlap-add), for a clip that plays faster
 * or slower than it was recorded. A <video> does this itself when it plays at another rate (`preservesPitch`), so a downloaded
 * video sounds as the clip does in Present instead of higher or lower.
 *
 * Windows of `FRAME` samples are taken from the input every `HOP x speed` samples and laid down every `HOP` samples; each is moved
 * by up to `SEEK` samples to where it best continues the window before it, which keeps the waveform from breaking up. Pure maths
 * on plain arrays, so it is unit tested in node.
 */

const FRAME = 2048;
const HOP = FRAME / 2;
const SEEK = 512;
/** the search and the comparison skip samples: a fraction of the work, nearly the same choice */
const SEEK_STEP = 8;
const COMPARE_STEP = 4;

/** A periodic Hann window: two of them half a window apart add up to exactly 1. */
const WINDOW = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));

/** `channels` played `speed` times as fast at the same pitch: each comes out `length / speed` samples long. */
export function timeStretch(channels: readonly Float32Array[], speed: number): Float32Array[] {
  if (!channels.length) return [];
  const length = channels[0].length;
  if (!(speed > 0) || Math.abs(speed - 1) < 1e-6) return channels.map((c) => c.slice());
  const outLength = Math.max(1, Math.floor(length / speed));
  const out = channels.map(() => new Float32Array(outLength + FRAME));
  // the windows are chosen on the sum of the channels, and the same choice is used for every channel
  const mix = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) mix[i] += c[i];

  const at = (i: number) => (i >= 0 && i < length ? mix[i] : 0);
  let previous = 0;
  for (let k = 0; k * HOP < outLength; k++) {
    const nominal = Math.round(k * HOP * speed);
    let from = nominal;
    if (k > 0) {
      // the window that best continues the one laid down before: compare with what followed that one in the input
      const follow = previous + HOP;
      let best = -Infinity;
      for (let delta = -SEEK; delta <= SEEK; delta += SEEK_STEP) {
        const start = nominal + delta;
        if (start < 0 || start >= length) continue;
        let score = 0;
        for (let i = 0; i < HOP; i += COMPARE_STEP) score += at(start + i) * at(follow + i);
        if (score > best) {
          best = score;
          from = start;
        }
      }
    }
    const to = k * HOP;
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < FRAME; i++) {
        const j = from + i;
        if (j >= length) break;
        dst[to + i] += src[j] * WINDOW[i];
      }
    }
    previous = from;
  }
  // the first half-window has only one window under it: it would fade in from silence, so it gets the input as it is
  for (let c = 0; c < channels.length; c++) {
    for (let i = 0; i < Math.min(HOP, outLength, length); i++) out[c][i] = channels[c][i];
  }
  return out.map((o) => o.subarray(0, outLength).slice());
}

/** Fades the first and last `samples` of every channel in and out, so a clip that loops or stops does not click. */
export function fadeEnds(channels: Float32Array[], samples: number): void {
  for (const c of channels) {
    const n = Math.min(samples, Math.floor(c.length / 2));
    for (let i = 0; i < n; i++) {
      const g = i / n;
      c[i] *= g;
      c[c.length - 1 - i] *= g;
    }
  }
}

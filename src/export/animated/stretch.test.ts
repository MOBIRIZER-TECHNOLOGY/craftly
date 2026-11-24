import { describe, expect, it } from "vitest";
import { fadeEnds, timeStretch } from "./stretch";

const RATE = 48_000;

/** `seconds` of a sine at `hz`, at half volume. */
const tone = (hz: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE));

/** The pitch of `data` between `from` and `to` seconds, from how often it crosses zero. */
function pitch(data: Float32Array, from: number, to: number): number {
  let crossings = 0;
  for (let i = Math.round(from * RATE) + 1; i < Math.round(to * RATE); i++) if (data[i - 1] < 0 !== data[i] < 0) crossings++;
  return crossings / 2 / (to - from);
}

const peak = (data: Float32Array, from: number, to: number) => {
  let p = 0;
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) p = Math.max(p, Math.abs(data[i]));
  return p;
};

describe("timeStretch", () => {
  it("leaves a clip at its own speed as it is (a copy)", () => {
    const input = tone(440, 0.5);
    const [out] = timeStretch([input], 1);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it.each([
    [2, 1],
    [0.5, 4],
    [1.5, 4 / 3],
    [0.25, 8],
  ])("plays %sx as fast at the same pitch: two seconds last %s s", (speed, seconds) => {
    const [out] = timeStretch([tone(440, 2)], speed);
    expect(out.length).toBe(Math.floor((2 * RATE) / speed));
    expect(out.length / RATE).toBeCloseTo(seconds, 3);
    // the pitch is the clip's, not 440 x speed
    expect(pitch(out, 0.1, out.length / RATE - 0.1)).toBeGreaterThan(430);
    expect(pitch(out, 0.1, out.length / RATE - 0.1)).toBeLessThan(450);
    // and the volume stays: the windows add up to one
    expect(peak(out, 0.1, out.length / RATE - 0.1)).toBeGreaterThan(0.4);
    expect(peak(out, 0.1, out.length / RATE - 0.1)).toBeLessThan(0.6);
  });

  it("keeps what happens when: a change of pitch half-way through the clip is half-way through the stretched sound", () => {
    const input = new Float32Array(2 * RATE);
    input.set(tone(440, 1), 0);
    input.set(tone(880, 1), RATE);
    const [out] = timeStretch([input], 2);
    expect(pitch(out, 0.1, 0.4)).toBeCloseTo(440, -1);
    expect(pitch(out, 0.6, 0.9)).toBeCloseTo(880, -1);
  });

  it("stretches every channel the same way", () => {
    const left = tone(440, 1);
    const right = left.map((v) => -v);
    const [l, r] = timeStretch([left, right], 0.5);
    expect(l.length).toBe(r.length);
    for (let i = 0; i < l.length; i += 997) expect(r[i]).toBeCloseTo(-l[i], 5);
  });

  it("starts with the sound as it is, not a fade in from silence", () => {
    const input = tone(440, 1);
    const [out] = timeStretch([input], 2);
    for (let i = 0; i < 1024; i += 64) expect(out[i]).toBeCloseTo(input[i], 6);
  });

  it("copes with nothing, a silence, a very short sound and a speed that is not a number", () => {
    expect(timeStretch([], 2)).toEqual([]);
    expect(timeStretch([new Float32Array(RATE)], 2)[0].every((v) => v === 0)).toBe(true);
    expect(timeStretch([tone(440, 0.001)], 0.5)[0].length).toBe(Math.floor(48 / 0.5));
    expect(timeStretch([tone(440, 0.1)], Number.NaN)[0].length).toBe(0.1 * RATE);
  });
});

describe("fadeEnds", () => {
  it("fades the first and last samples in and out and leaves the middle alone", () => {
    const data = new Float32Array(1000).fill(1);
    fadeEnds([data], 100);
    expect(data[0]).toBe(0);
    expect(data[50]).toBeCloseTo(0.5);
    expect(data[999]).toBe(0);
    expect(data[949]).toBeCloseTo(0.5);
    expect(data.slice(100, 900).every((v) => v === 1)).toBe(true);
  });

  it("never fades more than half of a short sound from each end", () => {
    const data = new Float32Array(10).fill(1);
    fadeEnds([data], 100);
    expect(data[4]).toBeCloseTo(0.8);
    expect(data[5]).toBeCloseTo(0.8);
  });
});

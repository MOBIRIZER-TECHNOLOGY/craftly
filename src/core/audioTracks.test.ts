import { describe, expect, it } from "vitest";
import { MAX_TRACKS, MAX_TRACK_START, createAudioTrack, readAudioTracks, trackFades, trackLength, trackSoundAt, trackSpan, trackStartAt, trackVolume } from "./audioTracks";
import v2 from "@/test/fixtures/schema/design-v2-full.json";
import { CURRENT_DESIGN_VERSION, DESIGN_MIGRATIONS, migrateDesign } from "./schema/design";
import type { AudioTrack } from "./types";

const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({ id: "au1", src: "asset:a_song", duration: 10, trimStart: 2, trimEnd: 6, startAt: 1, ...over });

describe("a sound of the design", () => {
  it("is made from an upload, played once from where it is put, whole", () => {
    const t = createAudioTrack({ src: "asset:a_song", name: "Song", duration: 12.5, startAt: 3 });
    expect(t).toMatchObject({ src: "asset:a_song", name: "Song", duration: 12.5, trimStart: 0, trimEnd: 12.5, startAt: 3 });
    expect(t.id).toMatch(/^au/);
    expect(t.loop).toBeUndefined();
    expect(createAudioTrack({ src: "asset:a", duration: Number.NaN, startAt: -4 })).toMatchObject({ duration: 1, trimEnd: 1, startAt: 0 });
    expect(createAudioTrack({ src: "asset:a", duration: 1, startAt: 1e9 }).startAt).toBe(MAX_TRACK_START);
  });

  it("lasts its trimmed part and starts where it is put", () => {
    expect(trackLength(track())).toBe(4);
    expect(trackLength(track({ trimStart: 3, trimEnd: 3 }))).toBe(0.05);
    expect(trackStartAt(track({ startAt: Number.NaN }))).toBe(0);
  });

  it("has a bar from its start to its end, or to the design's end when it plays over and over, and nothing past the end", () => {
    expect(trackSpan(track(), 20)).toEqual({ start: 1, end: 5 });
    expect(trackSpan(track({ loop: true }), 20)).toEqual({ start: 1, end: 20 });
    expect(trackSpan(track(), 3)).toEqual({ start: 1, end: 3 });
    expect(trackSpan(track({ startAt: 30 }), 20)).toEqual({ start: 20, end: 20 });
  });

  it("sounds from its trimmed part while it plays, silent before it starts and after a single play", () => {
    expect(trackSoundAt(track(), 0.5)).toBeNull();
    expect(trackSoundAt(track(), 1)).toEqual({ at: 2, gain: 1 });
    expect(trackSoundAt(track(), 3.5)).toEqual({ at: 4.5, gain: 1 });
    expect(trackSoundAt(track(), 5)).toBeNull();
    // over and over: round its trimmed part again
    expect(trackSoundAt(track({ loop: true }), 6)).toEqual({ at: 3, gain: 1 });
  });

  it("is as loud as its volume, fading in and out over every play of it as a clip does", () => {
    const t = track({ volume: 0.5, fadeIn: 1, fadeOut: 2 });
    expect(trackVolume(t)).toBe(0.5);
    expect(trackFades(t)).toEqual({ fadeIn: 1, fadeOut: 2 });
    expect(trackSoundAt(t, 1.5)!.gain).toBeCloseTo(0.25);
    expect(trackSoundAt(t, 2.5)!.gain).toBeCloseTo(0.5);
    expect(trackSoundAt(t, 4)!.gain).toBeCloseTo(0.25);
    // fades longer than a play are shortened alike
    expect(trackFades(track({ fadeIn: 4, fadeOut: 4 }))).toEqual({ fadeIn: 2, fadeOut: 2 });
  });
});

describe("the sounds of a design from outside", () => {
  it("keeps the tracks that are tracks, with their numbers put in range", () => {
    const { tracks, skipped } = readAudioTracks([
      track(),
      { ...track({ id: "au2", trimStart: -3, trimEnd: 50, startAt: -1, volume: 7, fadeIn: 60, fadeOut: -1, loop: true }), name: "Song" },
    ]);
    expect(skipped).toBe(0);
    expect(tracks[0]).toEqual(track());
    expect(tracks[1]).toEqual({ id: "au2", src: "asset:a_song", name: "Song", duration: 10, trimStart: 0, trimEnd: 10, startAt: 0, loop: true, fadeIn: 5 });
  });

  it("leaves out what is not a track, a sound from the web, an id twice and more than the most there may be", () => {
    const bad = [
      null,
      "track",
      [],
      track({ src: "https://example.test/song.mp3" }),
      track({ src: "asset:../x" }),
      track({ duration: 0 }),
      { ...track(), trimEnd: "6" },
      track({ id: "" }),
    ];
    expect(readAudioTracks(bad)).toEqual({ tracks: [], skipped: bad.length });
    expect(readAudioTracks([track(), track()]).tracks).toHaveLength(1);
    const many = Array.from({ length: MAX_TRACKS + 3 }, (_, i) => track({ id: `au${i}` }));
    expect(readAudioTracks(many)).toMatchObject({ skipped: 3 });
    expect(readAudioTracks("tracks")).toEqual({ tracks: [], skipped: 0 });
    expect(readAudioTracks(undefined)).toEqual({ tracks: [], skipped: 0 });
  });

  it("keeps a trim that is too short at least a tenth of a second long", () => {
    expect(readAudioTracks([track({ trimStart: 5, trimEnd: 5 })]).tracks[0]).toMatchObject({ trimStart: 5, trimEnd: 5.1 });
    expect(readAudioTracks([track({ trimStart: 10, trimEnd: 10 })]).tracks[0]).toMatchObject({ trimStart: 9.9, trimEnd: 10 });
  });
});

describe("version 3 of the design format", () => {
  it("came with the sounds of a design, in one step that changes nothing but the number", () => {
    expect(CURRENT_DESIGN_VERSION).toBe(3);
    expect(DESIGN_MIGRATIONS[1]).toMatchObject({ from: 2, about: "sounds across the pages" });
    const { design, from, migrated } = migrateDesign(v2);
    expect([from, migrated, design.version]).toEqual([2, true, 3]);
    expect({ ...design, version: 2 }).toEqual(v2);
    expect(design.audio).toBeUndefined();
  });
});

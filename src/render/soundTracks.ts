/**
 * Playing the sounds of a design (`Design.audio`) at a moment of its time: one hidden <audio> per sound, started, sought and set to
 * the right loudness by whoever owns the clock (the timeline's Play, Present). `playSoundsAt` is called again and again as the time
 * goes on: a sound that is where it should be is left alone; one that drifted is sought; one that is silent at that moment (before
 * it starts, after a sound that plays once has played, past the end of the design) is paused.
 *
 * The <audio> plays the stored file; its trim, loop, volume and fades come from the track (trackSoundAt in core/audioTracks.ts).
 */
import { getAssetUrl } from "@/core/assets";
import { trackSoundAt } from "@/core/audioTracks";
import type { AudioTrack } from "@/core/types";

/** A sound this far from where it should be is sought; less is left to play on (seeking makes a sound stutter). */
const DRIFT = 0.25;

interface SoundPlayer {
  src: string;
  audio: HTMLAudioElement;
  broken: boolean;
}

const players = new Map<string, SoundPlayer>();

function release(id: string, player: SoundPlayer): void {
  player.audio.pause();
  player.audio.removeAttribute("src");
  player.audio.load();
  players.delete(id);
}

function playerFor(track: AudioTrack): SoundPlayer | null {
  const known = players.get(track.id);
  if (known && known.src === track.src) return known;
  if (known) release(track.id, known);
  if (!track.src.startsWith("asset:") || typeof document === "undefined") return null;
  const audio = document.createElement("audio");
  audio.preload = "auto";
  const player: SoundPlayer = { src: track.src, audio, broken: false };
  audio.onerror = () => {
    player.broken = true;
  };
  players.set(track.id, player);
  void getAssetUrl(track.src.slice(6)).then((url) => {
    if (players.get(track.id) !== player) return;
    if (url) audio.src = url;
    else player.broken = true;
  });
  return player;
}

function start(audio: HTMLAudioElement): void {
  try {
    // a browser that will not make a sound before the person has done anything on the page refuses: the sound stays quiet
    audio.play()?.catch(() => undefined);
  } catch {
    // (jsdom and older browsers throw instead)
  }
}

/**
 * Plays every sound of `tracks` as it sounds `time` seconds into the design, `total` seconds long (silent from its end on). A sound
 * that is no longer among `tracks` lets go of its player.
 */
export function playSoundsAt(tracks: readonly AudioTrack[] | undefined, time: number, total = Number.POSITIVE_INFINITY): void {
  const seen = new Set<string>();
  for (const track of tracks ?? []) {
    seen.add(track.id);
    const player = playerFor(track);
    if (!player || player.broken) continue;
    const { audio } = player;
    const sound = time < total ? trackSoundAt(track, time) : null;
    if (!sound) {
      if (!audio.paused) audio.pause();
      continue;
    }
    const volume = Math.min(1, Math.max(0, sound.gain));
    if (Math.abs(audio.volume - volume) > 0.001) audio.volume = volume;
    if (audio.readyState < 1) continue;
    if (!audio.seeking && Math.abs(audio.currentTime - sound.at) > DRIFT) audio.currentTime = sound.at;
    if (audio.paused) start(audio);
  }
  for (const [id, player] of players) if (!seen.has(id)) release(id, player);
}

/** A sound of the uploads that has come since its player found nothing (from a shared design): the player starts again for it. */
export function retrySound(id: string): void {
  for (const [key, player] of players) if (player.broken && player.src === `asset:${id}`) release(key, player);
}

/** Pauses every sound (the playback stopped); they go on from where the time is when they are asked for again. */
export function stopSounds(): void {
  for (const player of players.values()) if (!player.audio.paused) player.audio.pause();
}

/** Lets go of every player. For tests, and for leaving the editor. */
export function releaseSounds(): void {
  for (const [id, player] of players) release(id, player);
}

/** For tests: the <audio> playing a sound of the design, if there is one. */
export const soundPlayerOf = (id: string): HTMLAudioElement | undefined => players.get(id)?.audio;

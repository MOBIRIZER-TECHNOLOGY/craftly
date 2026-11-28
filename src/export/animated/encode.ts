/**
 * A video made frame by frame with the browser's own encoders (WebCodecs, through Mediabunny), not recorded as it plays: frame `i`
 * is painted at `i / fps` and encoded, as fast as the computer can go, so the download takes as long as the work and not as long as
 * the animation, does not stand still when the tab is in the background, and carries the clips' sound.
 *
 * MP4 with H.264 and AAC plays everywhere, so it comes first; a browser with no AAC encoder (Firefox) writes Opus in the MP4, and one
 * with no H.264 encoder writes WebM (VP9 or VP8 with Opus). The encoders belong to the browser, so no codec ships with Craftly.
 */
import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";
import { m } from "@/i18n";
import { ExportError, cancelledError, isCancelled } from "../errors";
import { nextMacrotask } from "../yield";
import { BlobFile, blobFileStream } from "./blobFile";
import { VIDEO_SOUND_BITRATE } from "./frames";

export interface Encoding {
  container: "mp4" | "webm";
  video: VideoCodec;
  /** null: the video has no sound track (nothing makes a sound, or this browser cannot encode any) */
  audio: AudioCodec | null;
}

/** In order of preference. */
const CHOICES: readonly Encoding[] = [
  { container: "mp4", video: "avc", audio: "aac" },
  { container: "mp4", video: "avc", audio: "opus" },
  { container: "webm", video: "vp9", audio: "opus" },
  { container: "webm", video: "vp8", audio: "opus" },
];

const AUDIO_BITRATE = VIDEO_SOUND_BITRATE;
const AUDIO_CHANNELS = 2;

/** What the browser can encode a `width` x `height` picture into, with a sound track when `withSound`; null when nothing. */
export async function chooseEncoding(width: number, height: number, bitrate: number, sampleRate: number, withSound: boolean): Promise<Encoding | null> {
  const videoOk = new Map<VideoCodec, Promise<boolean>>();
  const audioOk = new Map<AudioCodec, Promise<boolean>>();
  const canVideo = (codec: VideoCodec) => {
    let ok = videoOk.get(codec);
    if (!ok) {
      ok = canEncodeVideo(codec, { width, height, quality: new Quality({ bitrate }) }).catch(() => false);
      videoOk.set(codec, ok);
    }
    return ok;
  };
  const canAudio = (codec: AudioCodec) => {
    let ok = audioOk.get(codec);
    if (!ok) {
      ok = canEncodeAudio(codec, { numberOfChannels: AUDIO_CHANNELS, sampleRate, quality: new Quality({ bitrate: AUDIO_BITRATE }) }).catch(() => false);
      audioOk.set(codec, ok);
    }
    return ok;
  };
  if (withSound) {
    for (const choice of CHOICES) if ((await canVideo(choice.video)) && (await canAudio(choice.audio!))) return choice;
  }
  // a picture without sound is better than no video: the first container whose picture the browser can encode
  for (const choice of CHOICES) if (await canVideo(choice.video)) return { ...choice, audio: null };
  return null;
}

export interface EncodeOptions {
  encoding: Encoding;
  canvas: HTMLCanvasElement;
  /** paints frame `index` onto `canvas` */
  paint: (index: number) => Promise<void>;
  frames: number;
  fps: number;
  bitrate: number;
  /** the sound, as long as the video (or longer: the rest is left out), read a piece at a time */
  sound: SoundSource | null;
  onFrame?: (done: number) => void;
  signal?: AbortSignal;
}

/** Sound that is read a piece at a time (the mixed sound of a video download: clipSound.ts), so it never has to be held whole. */
export interface SoundSource {
  sampleRate: number;
  /** samples */
  length: number;
  /** samples `from` to `to` */
  read(from: number, to: number): Promise<AudioBuffer>;
}

/** The file is handed over to the Blob in pieces of this size (StreamTarget's chunks). */
const PIECE_BYTES = 16 * 1024 * 1024;
/** The fewest samples in one packet of sound the encoders write (Opus at 48 kHz: 960; AAC: 1024). */
const SAMPLES_PER_PACKET = 960;
const OPUS_RATE = 48_000;

/**
 * Paints and encodes every frame (and the sound alongside it) and returns the file. The file is written into a Blob as it is made
 * (blobFile.ts), not kept in the page's memory and copied at the end: an MP4 keeps room at its start for its index, which it can do
 * because how many frames and packets of sound it will have is known before the first frame ("reserve"); it is still an MP4 with
 * its index first, which plays as soon as it starts to load.
 */
export async function encodeFrames(options: EncodeOptions): Promise<Blob> {
  const { encoding, canvas, frames, fps, signal } = options;
  const file = new BlobFile(encoding.container === "mp4" ? "video/mp4" : "video/webm");
  const target = new StreamTarget(blobFileStream(file), { chunked: true, chunkSize: PIECE_BYTES });
  const output = new Output({ format: encoding.container === "mp4" ? new Mp4OutputFormat({ fastStart: "reserve" }) : new WebMOutputFormat(), target });
  const picture = new CanvasSource(canvas, { codec: encoding.video, quality: new Quality({ bitrate: options.bitrate }), keyFrameInterval: 2 });
  output.addVideoTrack(picture, { frameRate: fps, maximumPacketCount: frames + 1 });
  const sound = options.sound && encoding.audio ? options.sound : null;
  const audio = sound ? new AudioBufferSource({ codec: encoding.audio!, quality: new Quality({ bitrate: AUDIO_BITRATE }) }) : null;

  const seconds = frames / fps;
  if (audio && sound) {
    // an upper bound: at the higher of the two rates, in the smallest packets, and a few over for the encoder's priming
    const rate = Math.max(sound.sampleRate, OPUS_RATE);
    output.addAudioTrack(audio, { maximumPacketCount: Math.ceil((seconds * rate) / SAMPLES_PER_PACKET) + 64 });
  }
  const soundEnd = sound ? Math.min(sound.length, Math.round(seconds * sound.sampleRate)) : 0;
  let soundDone = 0;
  /**
   * Hands the encoder the sound up to `until` seconds in whole seconds, so picture and sound are written side by side; `last` hands
   * over what is left, however short.
   */
  const feedSound = async (until: number, last = false) => {
    if (!sound || !audio) return;
    const end = Math.min(soundEnd, Math.round(until * sound.sampleRate));
    while (soundDone < end && (last || soundDone + sound.sampleRate <= end)) {
      const to = Math.min(end, soundDone + sound.sampleRate);
      await audio.add(await sound.read(soundDone, to));
      soundDone = to;
    }
  };

  try {
    await output.start();
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw cancelledError();
      await options.paint(i);
      await picture.add(i / fps, 1 / fps);
      await feedSound((i + 1) / fps + 1);
      options.onFrame?.(i + 1);
      // painting and encoding are each heavy on a big frame: give the page a moment between frames (and Cancel a chance)
      await nextMacrotask();
    }
    await feedSound(seconds, true);
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    if (isCancelled(error) || signal?.aborted) throw cancelledError();
    if (error instanceof ExportError) throw error;
    throw new ExportError("encode-failed", m.exporting.animation.encodeFailed, { cause: error });
  }
  if (file.size === 0) throw new ExportError("encode-failed", m.exporting.animation.encodeFailed);
  return file.blob();
}

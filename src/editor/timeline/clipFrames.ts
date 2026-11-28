/**
 * Small pictures of a clip at a few moments, for its row on the timeline. One hidden, silent <video> per clip is sought to each
 * moment in turn (never several videos for one clip at once); each picture is kept as a small JPEG data URL, so that a row drawn
 * again (a drag, a zoom) does not read the clip again. The clip is one of this browser's uploads ("asset:<id>").
 */
import { useEffect, useState } from "react";
import { getAssetUrl } from "@/core/assets";
import { isVideoSource } from "@/render/videos";

/** Height of a picture, in pixels (it is drawn at about half that). */
const TILE_H = 64;
/** A clip that has given no frame in this long is left without pictures. */
const TIMEOUT_MS = 15_000;

const cache = new Map<string, string>();
/** the clips being read, one queue each, so that two rows of one clip share its <video> */
const reading = new Map<string, Promise<void>>();

const key = (src: string, at: number) => `${src}@${at.toFixed(1)}`;

/** The moments, in seconds of the clip, of `count` pictures spread over its trimmed part (each in the middle of its tile). */
export function tileMoments(trimStart: number, trimEnd: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const span = Math.max(0, trimEnd - trimStart);
  return Array.from({ length: n }, (_, i) => Math.round((trimStart + (span * (i + 0.5)) / n) * 10) / 10);
}

function seek(video: HTMLVideoElement, at: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      video.onseeked = null;
      video.onerror = null;
      resolve(ok);
    };
    video.onseeked = () => done(true);
    video.onerror = () => done(false);
    const end = Number.isFinite(video.duration) ? video.duration : at;
    video.currentTime = Math.max(0, Math.min(at, end - 0.05));
  });
}

async function read(src: string, moments: readonly number[]): Promise<void> {
  const missing = moments.filter((t) => !cache.has(key(src, t)));
  if (!missing.length || !isVideoSource(src)) return;
  const url = await getAssetUrl(src.slice("asset:".length));
  if (!url) return;
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  try {
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
      video.onloadeddata = () => (clearTimeout(timer), resolve(true));
      video.onerror = () => (clearTimeout(timer), resolve(false));
      video.src = url;
    });
    if (!loaded || !(video.videoWidth > 0 && video.videoHeight > 0)) return;
    const canvas = document.createElement("canvas");
    canvas.height = TILE_H;
    canvas.width = Math.max(1, Math.round((TILE_H * video.videoWidth) / video.videoHeight));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (const t of missing) {
      if (!(await seek(video, t))) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      cache.set(key(src, t), canvas.toDataURL("image/jpeg", 0.7));
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** Reads the pictures of `src` at `moments` (after any reading of the same clip that is under way). */
export function loadFrames(src: string, moments: readonly number[]): Promise<void> {
  const before = reading.get(src) ?? Promise.resolve();
  const next = before.then(() => read(src, moments)).catch(() => undefined);
  reading.set(src, next);
  void next.then(() => {
    if (reading.get(src) === next) reading.delete(src);
  });
  return next;
}

/** The pictures of `src` at `moments` that have been read (null where one is not there yet); the row is drawn again as they come. */
export function useClipFrames(src: string, moments: readonly number[]): (string | null)[] {
  const wanted = moments.join(",");
  const [, setRead] = useState(0);
  useEffect(() => {
    let live = true;
    const list = wanted ? wanted.split(",").map(Number) : [];
    if (list.every((t) => cache.has(key(src, t)))) return;
    void loadFrames(src, list).then(() => live && setRead((n) => n + 1));
    return () => {
      live = false;
    };
  }, [src, wanted]);
  return moments.map((t) => cache.get(key(src, t)) ?? null);
}

/** For tests: forget every picture. */
export function clearClipFrames(): void {
  cache.clear();
  reading.clear();
}

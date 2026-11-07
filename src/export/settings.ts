/**
 * What the Download panel remembers between visits, and how those choices become `ExportOptions`.
 * Pure (no DOM, no React), so the clamping and validation are unit tested in node.
 */
import { ANIM_RESOLUTIONS, DEFAULT_ANIM_RESOLUTION, DEFAULT_GIF_FPS, GIF_FPS_CHOICES, VIDEO_FPS, isAnimatedFormat, type AnimResolution } from "./animated/frames";
import type { ExportFormat, ExportOptions } from "./exporters";
import { COMPRESSED_QUALITY, DEFAULT_QUALITY, clampNumber } from "./options";

export type PagesMode = "all" | "current" | "custom";

export interface DownloadSettings {
  format: ExportFormat;
  pdfMode: "standard" | "print";
  /** png / jpg size multiplier, 0.5 .. 4 */
  scale: number;
  /** jpg quality, 0.1 .. 1 */
  quality: number;
  transparent: boolean;
  /** pdf: smaller file, lower image quality */
  compress: boolean;
  embedFonts: boolean;
  pagesMode: PagesMode;
  /** gif / webm: length of the picture's shorter side, 480 | 720 | 1080 */
  resolution: AnimResolution;
  /** gif: frames per second (10 | 15 | 20); a video is always recorded at 30 */
  gifFps: number;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  format: "png",
  pdfMode: "standard",
  scale: 1,
  quality: DEFAULT_QUALITY,
  transparent: false,
  compress: false,
  embedFonts: true,
  pagesMode: "all",
  resolution: DEFAULT_ANIM_RESOLUTION,
  gifFps: DEFAULT_GIF_FPS,
};

export const DOWNLOAD_SETTINGS_KEY = "craftly.download.settings.v1";

/** Size slider limits of the panel. */
export const SIZE_MIN = 0.5;
export const SIZE_MAX = 4;

const FORMATS: ExportFormat[] = ["png", "jpg", "pdf", "svg", "gif", "webm"];
const MODES: PagesMode[] = ["all", "current", "custom"];

/** Reads remembered settings; anything missing, mistyped or out of range falls back to a sane value. */
export function readStoredSettings(raw: string | null | undefined): DownloadSettings {
  const d = DEFAULT_DOWNLOAD_SETTINGS;
  if (!raw) return { ...d };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof DownloadSettings, unknown>> | null;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return { ...d };
    return {
      format: FORMATS.includes(v.format as ExportFormat) ? (v.format as ExportFormat) : d.format,
      pdfMode: v.pdfMode === "print" ? "print" : "standard",
      // snap to the slider's 0.25 steps so a hand edited value cannot leave the thumb between ticks
      scale: Math.round(clampNumber(Number(v.scale), SIZE_MIN, SIZE_MAX, d.scale) * 4) / 4,
      quality: clampNumber(Number(v.quality), 0.1, 1, d.quality),
      transparent: v.transparent === true,
      compress: v.compress === true,
      embedFonts: v.embedFonts !== false,
      pagesMode: MODES.includes(v.pagesMode as PagesMode) ? (v.pagesMode as PagesMode) : d.pagesMode,
      // settings saved before animated exports existed have neither field: they get the defaults
      resolution: ANIM_RESOLUTIONS.includes(v.resolution as AnimResolution) ? (v.resolution as AnimResolution) : d.resolution,
      gifFps: GIF_FPS_CHOICES.includes(v.gifFps as number) ? (v.gifFps as number) : d.gifFps,
    };
  } catch {
    return { ...d };
  }
}

export const serializeSettings = (s: DownloadSettings): string => JSON.stringify(s);

/** The `ExportOptions` the panel's choices stand for. */
export function toExportOptions(s: DownloadSettings, pages: number[]): ExportOptions {
  const pdf = s.format === "pdf";
  return {
    format: s.format,
    pages,
    // PDF: digital is 1.5x (crisp on retina screens), compressed 1x; print always renders at 300 dpi
    scale: pdf ? (s.compress ? 1 : 1.5) : s.scale,
    quality: pdf ? (s.compress ? COMPRESSED_QUALITY : DEFAULT_QUALITY) : s.quality,
    transparent: s.format === "png" && s.transparent,
    pdfMode: s.pdfMode,
    embedFonts: s.embedFonts,
    ...(isAnimatedFormat(s.format) ? { resolution: s.resolution, fps: s.format === "webm" ? VIDEO_FPS : s.gifFps } : {}),
  };
}

/** Which pages a "pages" choice stands for. `custom` is the checked set (indices are clamped to the design). */
export function pagesFor(mode: PagesMode, pageCount: number, activeIndex: number, custom: ReadonlySet<number> | null): number[] {
  if (pageCount <= 0) return [];
  if (mode === "current") return [Math.min(Math.max(0, activeIndex), pageCount - 1)];
  if (mode === "custom")
    return [...(custom ?? new Set(Array.from({ length: pageCount }, (_v, i) => i)))].filter((i) => Number.isInteger(i) && i >= 0 && i < pageCount).sort((a, b) => a - b);
  return Array.from({ length: pageCount }, (_v, i) => i);
}

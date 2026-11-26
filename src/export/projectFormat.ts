/**
 * The pure half of the `.craftly` project file: the JSON shape, validation, asset id discovery / rewriting
 * and the import clean-up. No IndexedDB and no DOM, so it is unit tested in node; `projectFile.ts` adds the
 * storage around it.
 *
 *   { craftly: 1, exportedAt, design, assets: { [assetId]: { name, mime, width, height, dataUrl } } }
 */
import { backgroundWithoutRemoteImage, withoutRemoteImages } from "@/core/imageSources";
import { pageDuration } from "@/core/animation";
import { CURRENT_DESIGN_VERSION, migrateDesign } from "@/core/schema/design";
import { createMigrator, MigrationError, type MigrationStep } from "@/core/schema/migrator";
import { readAudioTracks } from "@/core/audioTracks";
import { isUsableElement } from "@/core/usableElement";
import { usableComments } from "@/core/comments";
import { MAX_TRANSITION_DURATION } from "@/core/transition";
import type { AnimDirection, Design, DesignElement, Fill, Page, PageTransition } from "@/core/types";
import { m } from "@/i18n";

/**
 * The version of the file around the design (`craftly`). The design inside has a version of its own
 * (src/core/schema/design.ts) and is brought up to date on its own. Changing how the file is laid out (not what is in a
 * design) is a step here: docs/MIGRATIONS.md.
 */
export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_MIGRATIONS: readonly MigrationStep[] = [];
const projectMigrator = createMigrator({ kind: "project", field: "craftly", current: PROJECT_FORMAT_VERSION, steps: PROJECT_MIGRATIONS });

export const PROJECT_FILE_EXTENSION = ".craftly";
export const NOT_A_PROJECT_MESSAGE = m.exporting.project.notAProject;
export const NEWER_PROJECT_MESSAGE = m.exporting.project.newer;
export const UPDATE_PROJECT_MESSAGE = m.exporting.project.cannotUpdate;

export interface ProjectAsset {
  name: string;
  mime: string;
  width: number;
  height: number;
  /** the original file, base64 encoded */
  dataUrl: string;
}

export interface ProjectFile {
  craftly: number;
  /** ISO timestamp */
  exportedAt: string;
  design: Design;
  assets: Record<string, ProjectAsset>;
}

export class ProjectFileError extends Error {
  constructor(message = NOT_A_PROJECT_MESSAGE) {
    super(message);
    this.name = "ProjectFileError";
  }
}

/* ------------------------------------------------------------------ */
/* Asset references                                                   */
/* ------------------------------------------------------------------ */

const ASSET_PREFIX = "asset:";

export const isAssetSrc = (src: string | null | undefined): src is string => typeof src === "string" && src.startsWith(ASSET_PREFIX);
export const assetIdOf = (src: string): string => src.slice(ASSET_PREFIX.length);

function fillSrc(fill: Fill | null | undefined): string | null {
  return fill && fill.type === "image" ? fill.src : null;
}

/** Calls `visit` for every image source of an element tree: image elements, shape image fills, clips of video elements, groups. */
function forEachElementSource(elements: DesignElement[], visit: (src: string) => void, clips = true): void {
  for (const el of elements) {
    if (el.type === "image" && el.src) {
      visit(el.src);
      if (el.originalSrc) visit(el.originalSrc);
    } else if (el.type === "shape") {
      const s = fillSrc(el.fill);
      if (s) visit(s);
    } else if (el.type === "video") {
      if (clips) visit(el.src);
    } else if (el.type === "group") forEachElementSource(el.children, visit, clips);
  }
}

/**
 * Unique ids of the uploads a design uses (page backgrounds, image elements, image fills, clips, the sounds of the design), in
 * first-use order. `clips: false` leaves out clips and sounds, which account servers and shared designs do not carry.
 */
export function collectAssetIds(design: Pick<Design, "pages" | "audio">, options: { clips?: boolean } = {}): string[] {
  const ids = new Set<string>();
  const add = (src: string | null | undefined) => {
    if (isAssetSrc(src)) ids.add(assetIdOf(src));
  };
  for (const page of design.pages) {
    add(fillSrc(page.background));
    forEachElementSource(page.elements, add, options.clips ?? true);
  }
  if (options.clips ?? true) for (const track of design.audio ?? []) add(track.src);
  return [...ids];
}

/** A copy of the design where every `asset:<old>` reference found in `idMap` points at the new id. */
export function remapAssetSources<T extends Pick<Design, "pages" | "audio">>(design: T, idMap: Readonly<Record<string, string>>): T {
  const rewrite = (src: string): string => {
    if (!isAssetSrc(src)) return src;
    const next = idMap[assetIdOf(src)];
    return next ? `${ASSET_PREFIX}${next}` : src;
  };
  const mapElement = (el: DesignElement): DesignElement => {
    if (el.type === "image") {
      if (!el.src) return el;
      return { ...el, src: rewrite(el.src), ...(el.originalSrc ? { originalSrc: rewrite(el.originalSrc) } : {}) };
    }
    if (el.type === "shape") return el.fill?.type === "image" ? { ...el, fill: { ...el.fill, src: rewrite(el.fill.src) } } : el;
    if (el.type === "video") return { ...el, src: rewrite(el.src) };
    if (el.type === "group") return { ...el, children: el.children.map(mapElement) };
    return el;
  };
  const pages: Page[] = design.pages.map((page) => ({
    ...page,
    background: page.background.type === "image" ? { ...page.background, src: rewrite(page.background.src) } : page.background,
    elements: page.elements.map(mapElement),
  }));
  return { ...design, pages, ...(design.audio ? { audio: design.audio.map((t) => ({ ...t, src: rewrite(t.src) })) } : {}) };
}

/* ------------------------------------------------------------------ */
/* Building and parsing                                               */
/* ------------------------------------------------------------------ */

/** The file contents for a design and the assets it uses. Library metadata (folder, star, trash) is not exported. */
export function buildProjectFile(design: Design, assets: Record<string, ProjectAsset>, now: Date = new Date()): ProjectFile {
  return {
    craftly: PROJECT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    design: { ...structuredCloneJson(portableDesign(design)), folderId: null, starred: false, trashedAt: null },
    assets,
  };
}

export function portableDesign<T extends Design>(design: T): Omit<T, "live"> {
  const { live: _live, ...content } = design;
  return content;
}

export const serializeProjectFile = (file: ProjectFile): string => JSON.stringify(file);

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// The structural check of an element (so that a hand edited or foreign file cannot crash the renderer) is shared with live
// editing, which asks the same of what arrives over the network: it lives in src/core/usableElement.ts and is handed on from here.
export { isUsableElement };

/** What reading a file left out, for the person to be told: nothing is left out without a word. */
export interface ImportReport {
  /** elements that could not be used (damaged, of an unknown kind, or groups nested deeper than `MAX_GROUP_DEPTH`) */
  skipped: number;
  /** pictures that pointed to the web and were taken out: a photo is an empty frame now, a fill or background plain (src/core/imageSources.ts) */
  remote?: number;
  /** sounds of the design that could not be used (damaged, from the web, an id twice, too many: src/core/audioTracks.ts) */
  audio?: number;
  /** comments that could not be used (damaged, on a page that is not there, an id twice, too many: src/core/comments.ts) */
  comments?: number;
}

/**
 * Groups inside groups, this deep and no deeper. The editor makes a few levels at most; a file with thousands (made by hand, or
 * to make trouble) cannot be stored by the browser, which then refused the whole design with an error of its own.
 */
export const MAX_GROUP_DEPTH = 32;

/** As long as the title field of the editor allows (src/editor/topbar/TopBar.tsx). */
export const MAX_TITLE_LENGTH = 120;

function sanitizeElements(elements: unknown[], report: ImportReport, depth = 0): DesignElement[] {
  const out: DesignElement[] = [];
  const count = { remote: 0 };
  for (const el of elements) {
    if (!isUsableElement(el) || (el.type === "group" && depth >= MAX_GROUP_DEPTH)) {
      report.skipped++;
      continue;
    }
    // (the children of a group are gone through by the call for them, so here only the element itself)
    const kept = el.type === "group" ? { ...el, children: sanitizeElements(el.children, report, depth + 1) } : el;
    out.push(kept.type === "group" ? kept : withoutRemoteImages(kept, count));
  }
  if (count.remote) report.remote = (report.remote ?? 0) + count.remote;
  return out;
}

/**
 * Elements that came from outside the app and not from a file (the clipboard): the usable ones, without pictures from the web,
 * or an empty list for anything that is no list of elements.
 */
export function usableElements(value: unknown, report: ImportReport = { skipped: 0 }): DesignElement[] {
  return Array.isArray(value) ? sanitizeElements(value, report) : [];
}

const FILL_TYPES = new Set(["solid", "linear", "radial", "pattern", "image"]);

/**
 * A fill that came from outside the app and not from a file (a drop): the fill when it is one of the kinds there are and its
 * picture, if it has one, is not on the web; null otherwise.
 */
export function usableFill(value: unknown): Fill | null {
  if (!isObject(value) || typeof value.type !== "string" || !FILL_TYPES.has(value.type)) return null;
  const fill = value as unknown as Fill;
  return backgroundWithoutRemoteImage(fill) === fill ? fill : null;
}

const DIRECTIONS = new Set<string>(["left", "right", "up", "down"]);

/**
 * The page fields that drive animated playback and export. Each one is kept when it is well formed and left out
 * (never an error) when it is not, so a hand edited file cannot make the timeline misbehave:
 *   duration    a finite number of seconds, clamped like `pageDuration` (1..60)
 *   transition  an object with a string kind and a finite duration, clamped to 0..MAX_TRANSITION_DURATION; the
 *               direction is kept only when it is one of the four known values
 * Element animations need no work here: elements pass through `sanitizeElements` untouched.
 */
function sanitizePageTiming(p: Record<string, unknown>): Pick<Page, "duration" | "transition"> {
  const timing: Pick<Page, "duration" | "transition"> = {};
  if (isNum(p.duration)) timing.duration = pageDuration({ duration: p.duration });
  const t = p.transition;
  if (isObject(t) && typeof t.kind === "string" && isNum(t.duration)) {
    const transition: PageTransition = { kind: t.kind, duration: Math.min(MAX_TRANSITION_DURATION, Math.max(0, t.duration)) };
    if (typeof t.direction === "string" && DIRECTIONS.has(t.direction)) transition.direction = t.direction as AnimDirection;
    timing.transition = transition;
  }
  return timing;
}

/** `keepLibraryData`: a design read back from the library (a backup) keeps its folder, star and trash state; one from a project file starts fresh. */
function sanitizeDesign(stored: Record<string, unknown>, keepLibraryData = false, report: ImportReport = { skipped: 0 }): Design {
  // first the design is brought up to the current version (a `MigrationError` for a newer one), then it is checked
  const raw = migrateDesign(stored).design as unknown as Record<string, unknown>;
  const width = raw.width;
  const height = raw.height;
  if (!isNum(width) || !isNum(height) || width < 1 || height < 1 || width > 100000 || height > 100000) throw new ProjectFileError();
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) throw new ProjectFileError();
  const pages: Page[] = raw.pages.map((p: unknown) => {
    if (!isObject(p) || !Array.isArray(p.elements)) throw new ProjectFileError();
    const remote = { remote: 0 };
    const background = backgroundWithoutRemoteImage(
      isObject(p.background) && typeof p.background.type === "string" && FILL_TYPES.has(p.background.type)
        ? (p.background as unknown as Fill)
        : ({ type: "solid", color: "#ffffff" } as Fill),
      remote,
    );
    if (remote.remote) report.remote = (report.remote ?? 0) + remote.remote;
    return {
      id: typeof p.id === "string" && p.id ? p.id : `p_${Math.random().toString(36).slice(2, 10)}`,
      ...(typeof p.name === "string" ? { name: p.name } : {}),
      background,
      elements: sanitizeElements(p.elements, report),
      ...(typeof p.notes === "string" ? { notes: p.notes } : {}),
      ...sanitizePageTiming(p),
    };
  });
  const now = Date.now();
  // the comments, checked as strictly as on the wire (src/core/comments.ts): what is not usable is left out and counted
  const { comments: rawComments, audio: rawAudio, ...rest } = raw;
  const comments = usableComments(rawComments, new Set(pages.map((p) => p.id)), report);
  // the sounds, each a sound of the uploads with its numbers in range (src/core/audioTracks.ts): what is not one is left out and counted
  const { tracks: audio, skipped: skippedAudio } = readAudioTracks(rawAudio);
  if (skippedAudio) report.audio = (report.audio ?? 0) + skippedAudio;
  return {
    ...portableDesign(rest as unknown as Design),
    ...(comments.length ? { comments } : {}),
    ...(audio.length ? { audio } : {}),
    id: typeof raw.id === "string" && raw.id ? raw.id : `d_${now.toString(36)}`,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, MAX_TITLE_LENGTH) : "Untitled design",
    typeId: typeof raw.typeId === "string" ? raw.typeId : "custom",
    width,
    height,
    unit: raw.unit === "in" || raw.unit === "mm" || raw.unit === "cm" ? raw.unit : "px",
    pages,
    createdAt: isNum(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : now,
    folderId: keepLibraryData && typeof raw.folderId === "string" ? raw.folderId : null,
    starred: keepLibraryData && raw.starred === true,
    trashedAt: keepLibraryData && isNum(raw.trashedAt) ? raw.trashedAt : null,
    version: CURRENT_DESIGN_VERSION,
  };
}

/**
 * A design as the library stores it (what a backup holds), brought up to the current version and checked as strictly as a
 * project file's: unusable elements are dropped, but the id, the dates and the folder / star / trash state are kept.
 * Throws `ProjectFileError` for a design that is damaged, and the `MigrationError` ("newer") for one that a newer release
 * made, which is not damaged and which the caller counts apart.
 */
export function parseStoredDesign(value: unknown): Design {
  if (!isObject(value)) throw new ProjectFileError();
  try {
    return sanitizeDesign(value, true);
  } catch (error) {
    if (error instanceof MigrationError && error.code !== "newer") throw new ProjectFileError();
    throw error;
  }
}

/**
 * Parses and validates a project file's text. Throws `ProjectFileError` with a message fit for a toast. `report`, when given,
 * is told how many elements were left out.
 */
export function parseProjectFile(text: string, report?: ImportReport): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError();
  }
  if (!isObject(raw) || !isNum(raw.craftly) || !isObject(raw.design)) throw new ProjectFileError();
  let envelope: Record<string, unknown>;
  let design: Design;
  try {
    envelope = projectMigrator.migrate(raw).doc;
    design = sanitizeDesign(envelope.design as Record<string, unknown>, false, report);
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    throw new ProjectFileError(error.code === "newer" ? NEWER_PROJECT_MESSAGE : error.code === "failed" ? UPDATE_PROJECT_MESSAGE : NOT_A_PROJECT_MESSAGE);
  }
  const assets: Record<string, ProjectAsset> = {};
  if (isObject(envelope.assets)) {
    for (const [id, value] of Object.entries(envelope.assets)) {
      if (!isObject(value) || typeof value.dataUrl !== "string" || !/^data:[^,]*,/.test(value.dataUrl)) continue;
      assets[id] = {
        name: typeof value.name === "string" && value.name ? value.name : "Image",
        mime: typeof value.mime === "string" && value.mime ? value.mime : (mimeOfDataUrl(value.dataUrl) ?? "image/png"),
        width: isNum(value.width) ? value.width : 0,
        height: isNum(value.height) ? value.height : 0,
        dataUrl: value.dataUrl,
      };
    }
  }
  return { craftly: PROJECT_FORMAT_VERSION, exportedAt: typeof envelope.exportedAt === "string" ? envelope.exportedAt : new Date(0).toISOString(), design, assets };
}

/** A design ready to be saved as a brand new library entry. */
export function prepareImportedDesign(design: Design, id: string, now: number = Date.now()): Design {
  return { ...design, id, createdAt: now, updatedAt: now, folderId: null, starred: false, trashedAt: null, version: CURRENT_DESIGN_VERSION };
}

/* ------------------------------------------------------------------ */
/* data: URLs                                                         */
/* ------------------------------------------------------------------ */

export function mimeOfDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;,]*)/i);
  return match && match[1] ? match[1].toLowerCase() : null;
}

/** Decodes a `data:` URL (base64 or percent-encoded) into bytes. Returns null when it is malformed. */
export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const meta = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = (meta.split(";")[0] || "text/plain").toLowerCase();
  try {
    if (/;base64$/i.test(meta)) {
      const binary = atob(payload.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/flac": "flac",
};

/** File extension for an image mime type (used when re-creating an uploaded file). */
export const extensionForMime = (mime: string): string => EXTENSIONS[mime.toLowerCase()] ?? mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "png";

/** "My design" -> "My design.craftly" (file name safe). */
export function projectFileName(title: string): string {
  const cleaned = String(title ?? "")
    // eslint-disable-next-line no-control-regex -- a file name has no control characters
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return `${cleaned || "Untitled design"}${PROJECT_FILE_EXTENSION}`;
}

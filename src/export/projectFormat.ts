/**
 * The pure half of the `.craftly` project file: the JSON shape, validation, asset id discovery / rewriting
 * and the import clean-up. No IndexedDB and no DOM, so it is unit tested in node; `projectFile.ts` adds the
 * storage around it.
 *
 *   { craftly: 1, exportedAt, design, assets: { [assetId]: { name, mime, width, height, dataUrl } } }
 */
import { pageDuration } from "@/core/animation";
import { MAX_TRANSITION_DURATION } from "@/core/transition";
import type { AnimDirection, Design, DesignElement, Fill, Page, PageTransition } from "@/core/types";

export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_FILE_EXTENSION = ".craftly";
export const NOT_A_PROJECT_MESSAGE = "That does not look like a Craftly project file";
export const NEWER_PROJECT_MESSAGE = "This project was saved by a newer version of Craftly. Update the app, then try again.";

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

/** Calls `visit` for every image source of an element tree: image elements, shape image fills, groups. */
function forEachElementSource(elements: DesignElement[], visit: (src: string) => void): void {
  for (const el of elements) {
    if (el.type === "image" && el.src) {
      visit(el.src);
      if (el.originalSrc) visit(el.originalSrc);
    } else if (el.type === "shape") {
      const s = fillSrc(el.fill);
      if (s) visit(s);
    } else if (el.type === "group") forEachElementSource(el.children, visit);
  }
}

/** Unique ids of the uploaded images a design uses (page backgrounds, image elements, image fills), in first-use order. */
export function collectAssetIds(design: Pick<Design, "pages">): string[] {
  const ids = new Set<string>();
  const add = (src: string | null | undefined) => {
    if (isAssetSrc(src)) ids.add(assetIdOf(src));
  };
  for (const page of design.pages) {
    add(fillSrc(page.background));
    forEachElementSource(page.elements, add);
  }
  return [...ids];
}

/** A copy of the design where every `asset:<old>` reference found in `idMap` points at the new id. */
export function remapAssetSources<T extends Pick<Design, "pages">>(design: T, idMap: Readonly<Record<string, string>>): T {
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
    if (el.type === "group") return { ...el, children: el.children.map(mapElement) };
    return el;
  };
  const pages: Page[] = design.pages.map((page) => ({
    ...page,
    background: page.background.type === "image" ? { ...page.background, src: rewrite(page.background.src) } : page.background,
    elements: page.elements.map(mapElement),
  }));
  return { ...design, pages };
}

/* ------------------------------------------------------------------ */
/* Building and parsing                                               */
/* ------------------------------------------------------------------ */

/** The file contents for a design and the assets it uses. Library metadata (folder, star, trash) is not exported. */
export function buildProjectFile(design: Design, assets: Record<string, ProjectAsset>, now: Date = new Date()): ProjectFile {
  return {
    craftly: PROJECT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    design: { ...structuredCloneJson(design), folderId: null, starred: false, trashedAt: null },
    assets,
  };
}

export const serializeProjectFile = (file: ProjectFile): string => JSON.stringify(file);

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const ELEMENT_TYPES = new Set(["text", "shape", "line", "image", "graphic", "group", "table", "chart"]);

/** Cheap structural check so a hand edited / foreign file cannot crash the renderer. */
export function isUsableElement(el: unknown): el is DesignElement {
  if (!isObject(el) || typeof el.id !== "string" || typeof el.type !== "string" || !ELEMENT_TYPES.has(el.type)) return false;
  if (![el.x, el.y, el.width, el.height, el.rotation, el.opacity].every(isNum)) return false;
  switch (el.type) {
    case "text":
      return Array.isArray(el.paragraphs) && typeof el.fontFamily === "string" && isNum(el.fontSize) && isNum(el.fontWeight) && isNum(el.lineHeight) && isObject(el.effect);
    case "shape":
      return typeof el.shape === "string";
    case "line":
      return isObject(el.stroke) && isNum(el.stroke.width);
    case "image":
      return isObject(el.crop) && isObject(el.filter) && (el.src === null || typeof el.src === "string") && typeof el.mask === "string";
    case "graphic":
      return typeof el.svg === "string" && isNum(el.viewW) && isNum(el.viewH) && isObject(el.colors);
    case "group":
      return Array.isArray(el.children);
    case "table":
      return Array.isArray(el.cells) && Array.isArray(el.colWidths) && Array.isArray(el.rowHeights) && typeof el.fontFamily === "string";
    case "chart":
      return Array.isArray(el.labels) && Array.isArray(el.series) && Array.isArray(el.palette) && el.palette.length > 0;
    default:
      return false;
  }
}

function sanitizeElements(elements: unknown[]): DesignElement[] {
  const out: DesignElement[] = [];
  for (const el of elements) {
    if (!isUsableElement(el)) continue;
    out.push(el.type === "group" ? { ...el, children: sanitizeElements(el.children) } : el);
  }
  return out;
}

const FILL_TYPES = new Set(["solid", "linear", "radial", "pattern", "image"]);
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

function sanitizeDesign(raw: Record<string, unknown>): Design {
  const width = raw.width;
  const height = raw.height;
  if (!isNum(width) || !isNum(height) || width < 1 || height < 1 || width > 100000 || height > 100000) throw new ProjectFileError();
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) throw new ProjectFileError();
  const pages: Page[] = raw.pages.map((p: unknown) => {
    if (!isObject(p) || !Array.isArray(p.elements)) throw new ProjectFileError();
    const background =
      isObject(p.background) && typeof p.background.type === "string" && FILL_TYPES.has(p.background.type)
        ? (p.background as unknown as Fill)
        : ({ type: "solid", color: "#ffffff" } as Fill);
    return {
      id: typeof p.id === "string" && p.id ? p.id : `p_${Math.random().toString(36).slice(2, 10)}`,
      ...(typeof p.name === "string" ? { name: p.name } : {}),
      background,
      elements: sanitizeElements(p.elements),
      ...(typeof p.notes === "string" ? { notes: p.notes } : {}),
      ...sanitizePageTiming(p),
    };
  });
  const now = Date.now();
  return {
    ...(raw as unknown as Design),
    id: typeof raw.id === "string" && raw.id ? raw.id : `d_${now.toString(36)}`,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "Untitled design",
    typeId: typeof raw.typeId === "string" ? raw.typeId : "custom",
    width,
    height,
    unit: raw.unit === "in" || raw.unit === "mm" || raw.unit === "cm" ? raw.unit : "px",
    pages,
    createdAt: isNum(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : now,
    folderId: null,
    starred: false,
    trashedAt: null,
    version: 1,
  };
}

/** Parses and validates a project file's text. Throws `ProjectFileError` with a message fit for a toast. */
export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError();
  }
  if (!isObject(raw) || !isNum(raw.craftly) || !isObject(raw.design)) throw new ProjectFileError();
  if (raw.craftly > PROJECT_FORMAT_VERSION) throw new ProjectFileError(NEWER_PROJECT_MESSAGE);
  if (raw.craftly < 1) throw new ProjectFileError();
  const design = sanitizeDesign(raw.design);
  const assets: Record<string, ProjectAsset> = {};
  if (isObject(raw.assets)) {
    for (const [id, value] of Object.entries(raw.assets)) {
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
  return { craftly: raw.craftly, exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date(0).toISOString(), design, assets };
}

/** A design ready to be saved as a brand new library entry. */
export function prepareImportedDesign(design: Design, id: string, now: number = Date.now()): Design {
  return { ...design, id, createdAt: now, updatedAt: now, folderId: null, starred: false, trashedAt: null, version: 1 };
}

/* ------------------------------------------------------------------ */
/* data: URLs                                                         */
/* ------------------------------------------------------------------ */

export function mimeOfDataUrl(dataUrl: string): string | null {
  const m = dataUrl.match(/^data:([^;,]*)/i);
  return m && m[1] ? m[1].toLowerCase() : null;
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

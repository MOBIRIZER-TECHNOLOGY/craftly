/**
 * The pure half of a library backup: what the file holds, how it is named and validated, and what restoring it
 * would do to the library that is there now. No IndexedDB and no DOM, so it is unit tested in node; `backup.ts`
 * adds the storage around it.
 *
 * A backup is a ZIP (see `zip.ts` / `zipRead.ts`) that any unzip tool opens:
 *
 *   craftly-backup.json          the manifest below: what is in the archive, and the small things (folders, brand kit)
 *   designs/<id>.json            one design each, trash included, exactly as stored
 *   previews/<id>.jpg            the dashboard thumbnail of a design, when it has one
 *   uploads/<id>.<ext>           an uploaded picture, byte for byte
 *   versions/<designId>/<n>.json one saved version of a design (the Version history list)
 *
 * Restoring only ever adds. Nothing that is in the library now is replaced or removed (see `planRestore`).
 */
import { createMigrator, type MigrationError, type MigrationErrorCode, type MigrationStep } from "@/core/schema/migrator";
import type { BrandKit, Folder } from "@/core/types";
import { extensionForMime } from "./projectFormat";

/**
 * The version of the manifest and the layout of the archive (`craftlyBackup`). The designs inside have a version of their
 * own (src/core/schema/design.ts) and are brought up to date one by one when they are restored. Changing the layout of
 * the archive (not what is in a design) is a step here: docs/MIGRATIONS.md.
 */
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MIGRATIONS: readonly MigrationStep[] = [];
const backupMigrator = createMigrator({ kind: "backup", field: "craftlyBackup", current: BACKUP_FORMAT_VERSION, steps: BACKUP_MIGRATIONS });
const ERROR_FOR: Record<MigrationErrorCode, BackupErrorCode> = { newer: "newer", unreadable: "not-a-backup", failed: "unsupported" };
export const BACKUP_MANIFEST_NAME = "craftly-backup.json";

export type BackupErrorCode = "not-a-backup" | "newer" | "damaged" | "too-large" | "cancelled" | "storage" | "unsupported";

const MESSAGES: Record<BackupErrorCode, string> = {
  "not-a-backup": "That file is not a Craftly backup.",
  newer: "This backup was made by a newer version of Craftly. Update the app, then try again.",
  damaged: "This backup is damaged.",
  "too-large":
    "Your library is larger than one backup file can hold (4 GB). Delete uploads you no longer need, or save the biggest designs one by one with Share > Save project file.",
  cancelled: "Cancelled.",
  storage: "Your browser has no room left for this. Free some space and try again.",
  unsupported: "This backup cannot be opened here.",
};

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Names                                                              */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0");

/** "Craftly backup 2026-11-08.zip" (the local date). */
export function backupFileName(date: Date): string {
  return `Craftly backup ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

const SAFE_ID = /^[A-Za-z0-9_:-]{1,128}$/;

/** Ids end up in links (#/design/<id>) and in file names, so a backup made by hand cannot bring in one that breaks either. */
export const isSafeId = (value: unknown): value is string => typeof value === "string" && SAFE_ID.test(value);

export const designEntryName = (id: string) => `designs/${id}.json`;
export const previewEntryName = (id: string, mime: string) => `previews/${id}.${extensionForMime(mime)}`;
export const uploadEntryName = (id: string, mime: string) => `uploads/${id}.${extensionForMime(mime)}`;
export const versionEntryName = (designId: string, index: number) => `versions/${designId}/${index}.json`;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

/** The picture type a file name says it is, or null for anything else. */
export function mimeForExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null);
}

/** The title of a design that came back next to a newer one with the same id. */
export const restoredCopyTitle = (title: string) => `${title} (restored)`;

/* ------------------------------------------------------------------ */
/* The manifest                                                       */
/* ------------------------------------------------------------------ */

export interface ManifestDesign {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  trashed: boolean;
  folderId: string | null;
  /** entry name of the design JSON */
  file: string;
  /** entry name of the thumbnail */
  preview?: string;
}

export interface ManifestUpload {
  id: string;
  name: string;
  kind: "image" | "svg";
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  file: string;
}

export interface ManifestVersion {
  id: string;
  designId: string;
  createdAt: number;
  label?: string;
  file: string;
}

export interface BackupManifest {
  craftlyBackup: number;
  app: "Craftly";
  /** ISO timestamp */
  exportedAt: string;
  designs: ManifestDesign[];
  uploads: ManifestUpload[];
  folders: Folder[];
  versions: ManifestVersion[];
  /** null when this browser never customised its brand kit */
  brandKit: BrandKit | null;
}

export interface BackupCounts {
  /** designs outside the trash */
  designs: number;
  trashed: number;
  folders: number;
  uploads: number;
  versions: number;
}

export function countsOf(manifest: BackupManifest): BackupCounts {
  const trashed = manifest.designs.filter((d) => d.trashed).length;
  return { designs: manifest.designs.length - trashed, trashed, folders: manifest.folders.length, uploads: manifest.uploads.length, versions: manifest.versions.length };
}

export function buildManifest(parts: Omit<BackupManifest, "craftlyBackup" | "app" | "exportedAt">, now: Date = new Date()): BackupManifest {
  return { craftlyBackup: BACKUP_FORMAT_VERSION, app: "Craftly", exportedAt: now.toISOString(), ...parts };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v : fallback);
const idOrNull = (v: unknown): string | null => (isSafeId(v) ? v : null);

function readDesign(item: unknown): ManifestDesign | null {
  if (!isObject(item) || !isSafeId(item.id) || typeof item.file !== "string" || !item.file) return null;
  const updatedAt = isNum(item.updatedAt) ? item.updatedAt : 0;
  return {
    id: item.id,
    title: text(item.title, "Untitled design"),
    createdAt: isNum(item.createdAt) ? item.createdAt : updatedAt,
    updatedAt,
    trashed: item.trashed === true,
    folderId: idOrNull(item.folderId),
    file: item.file,
    ...(typeof item.preview === "string" && item.preview ? { preview: item.preview } : {}),
  };
}

function readUpload(item: unknown): ManifestUpload | null {
  if (!isObject(item) || !isSafeId(item.id) || typeof item.file !== "string" || !item.file) return null;
  const mime = typeof item.mime === "string" && item.mime ? item.mime : (mimeForExtension(item.file) ?? "image/png");
  return {
    id: item.id,
    name: text(item.name, "Upload"),
    kind: mime === "image/svg+xml" ? "svg" : "image",
    mime,
    size: isNum(item.size) && item.size >= 0 ? item.size : 0,
    width: isNum(item.width) && item.width > 0 ? item.width : 800,
    height: isNum(item.height) && item.height > 0 ? item.height : 600,
    createdAt: isNum(item.createdAt) ? item.createdAt : 0,
    file: item.file,
  };
}

function readFolder(item: unknown): Folder | null {
  if (!isObject(item) || !isSafeId(item.id)) return null;
  return { id: item.id, name: text(item.name, "Untitled folder"), createdAt: isNum(item.createdAt) ? item.createdAt : 0, parentId: idOrNull(item.parentId) };
}

function readVersion(item: unknown): ManifestVersion | null {
  if (!isObject(item) || !isSafeId(item.id) || !isSafeId(item.designId) || typeof item.file !== "string" || !item.file) return null;
  return {
    id: item.id,
    designId: item.designId,
    createdAt: isNum(item.createdAt) ? item.createdAt : 0,
    ...(typeof item.label === "string" ? { label: item.label } : {}),
    file: item.file,
  };
}

const strings = (v: unknown, keep: (s: string) => boolean = () => true): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && keep(s)) : []);

function readBrandKit(value: unknown): BrandKit | null {
  if (!isObject(value)) return null;
  return { colors: strings(value.colors), fonts: strings(value.fonts), logos: strings(value.logos, isSafeId) };
}

/**
 * Parses and validates a manifest. Entries that cannot be used (an unsafe id, no file name) are left out and
 * counted in `skipped`; a file that is not a manifest at all, or comes from a newer app, throws `BackupError`.
 */
export function parseManifest(source: string): { manifest: BackupManifest; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new BackupError("not-a-backup");
  }
  if (!isObject(raw) || !isNum(raw.craftlyBackup)) throw new BackupError("not-a-backup");
  let envelope: Record<string, unknown>;
  try {
    envelope = backupMigrator.migrate(raw).doc;
  } catch (error) {
    // `migrate` throws nothing but a MigrationError
    throw new BackupError(ERROR_FOR[(error as MigrationError).code]);
  }

  let skipped = 0;
  // an id can be in the list once: the first entry wins, a second one is counted as unusable
  const list = <T extends { id: string }>(value: unknown, read: (item: unknown) => T | null): T[] => {
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const entry = read(item);
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id);
        out.push(entry);
      } else skipped++;
    }
    return out;
  };

  const manifest: BackupManifest = {
    craftlyBackup: BACKUP_FORMAT_VERSION,
    app: "Craftly",
    exportedAt: typeof envelope.exportedAt === "string" ? envelope.exportedAt : new Date(0).toISOString(),
    designs: list(envelope.designs, readDesign),
    uploads: list(envelope.uploads, readUpload),
    folders: list(envelope.folders, readFolder),
    versions: list(envelope.versions, readVersion),
    brandKit: readBrandKit(envelope.brandKit),
  };
  return { manifest, skipped };
}

/* ------------------------------------------------------------------ */
/* What restoring does                                                */
/* ------------------------------------------------------------------ */

/** What the library holds right now, as much as a restore needs to know. */
export interface LocalLibrary {
  /** id -> updatedAt, trash included */
  designs: ReadonlyMap<string, number>;
  folders: ReadonlySet<string>;
  uploads: ReadonlySet<string>;
  versions: ReadonlySet<string>;
  /** the brand kit this browser stored; undefined when it never customised one */
  brandKit: BrandKit | undefined;
}

export type DesignAction = "add" | "same" | "copy";

/**
 * add   the design is not here: it comes back under its own id
 * same  it is here and has not been edited since the backup: nothing to do
 * copy  it is here but differs (edited since, or the backup is the older state): the backup's version comes back
 *       as a second design, so neither is lost
 */
export function designAction(local: ReadonlyMap<string, number>, incoming: { id: string; updatedAt: number }): DesignAction {
  const there = local.get(incoming.id);
  if (there === undefined) return "add";
  return there === incoming.updatedAt ? "same" : "copy";
}

export type BrandKitAction = "restore" | "merge" | "none";

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * A browser that never customised its brand kit takes the backed up one as it is; one that did keeps its own and
 * gets what is missing added to the end. `kit` is what to store, null when nothing changes.
 */
export function mergeBrandKit(stored: BrandKit | undefined, incoming: BrandKit | null): { action: BrandKitAction; kit: BrandKit | null } {
  if (!incoming) return { action: "none", kit: null };
  if (!stored) return { action: "restore", kit: { colors: [...incoming.colors], fonts: [...incoming.fonts], logos: [...incoming.logos] } };
  const colors = [...stored.colors];
  for (const color of incoming.colors) if (!colors.some((have) => sameColor(have, color))) colors.push(color);
  const fonts = [...new Set([...stored.fonts, ...incoming.fonts])];
  const logos = [...new Set([...stored.logos, ...incoming.logos])];
  const added = colors.length + fonts.length + logos.length - (stored.colors.length + stored.fonts.length + stored.logos.length);
  return added > 0 ? { action: "merge", kit: { colors, fonts, logos } } : { action: "none", kit: null };
}

/**
 * The folders to add: the ones this browser does not have yet. A folder keeps its parent only when the parent is
 * here or comes back too, and never in a loop (a folder inside itself, or two folders inside each other).
 */
export function foldersToRestore(incoming: readonly Folder[], existing: ReadonlySet<string>): Folder[] {
  const adding = incoming.filter((f) => !existing.has(f.id));
  const parentOf = new Map(adding.map((f) => [f.id, f.parentId]));
  const known = new Set([...existing, ...parentOf.keys()]);
  return adding.map((f) => {
    let parentId = f.parentId && f.parentId !== f.id && known.has(f.parentId) ? f.parentId : null;
    const seen = new Set([f.id]);
    for (let at = parentId; at && parentOf.has(at); at = parentOf.get(at) ?? null) {
      if (seen.has(at)) {
        parentId = null;
        break;
      }
      seen.add(at);
    }
    return { ...f, parentId };
  });
}

export interface RestorePlan {
  designs: { add: number; same: number; copy: number };
  uploads: { add: number; same: number };
  folders: { add: number; same: number };
  /** versions that will be added: those of designs that come back under their own id */
  versions: { add: number };
  brandKit: BrandKitAction;
  /** everything in the backup is here already */
  nothingNew: boolean;
}

/** What restoring `manifest` into `local` would do, worked out from the manifest alone. */
export function planRestore(manifest: BackupManifest, local: LocalLibrary): RestorePlan {
  const designs = { add: 0, same: 0, copy: 0 };
  const keepsId = new Set<string>();
  for (const d of manifest.designs) {
    const action = designAction(local.designs, d);
    designs[action]++;
    if (action !== "copy") keepsId.add(d.id);
  }
  const uploadsAdd = manifest.uploads.filter((u) => !local.uploads.has(u.id)).length;
  const foldersAdd = manifest.folders.filter((f) => !local.folders.has(f.id)).length;
  const versionsAdd = manifest.versions.filter((v) => keepsId.has(v.designId) && !local.versions.has(v.id)).length;
  const brandKit = mergeBrandKit(local.brandKit, manifest.brandKit).action;
  return {
    designs,
    uploads: { add: uploadsAdd, same: manifest.uploads.length - uploadsAdd },
    folders: { add: foldersAdd, same: manifest.folders.length - foldersAdd },
    versions: { add: versionsAdd },
    brandKit,
    nothingNew: designs.add + designs.copy + uploadsAdd + foldersAdd + versionsAdd === 0 && brandKit === "none",
  };
}

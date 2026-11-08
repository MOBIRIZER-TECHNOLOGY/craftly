/**
 * Back up and restore the whole library: every design (the trash too), uploaded picture, folder, saved version and the
 * brand kit, in one ZIP file. The file layout, its validation and what a restore would do are in `backupFormat.ts`
 * (pure, unit tested); this file adds IndexedDB around it.
 *
 * Restoring only ever adds. A design that is already here and unchanged is left alone; one that was edited since the
 * backup is not overwritten, the backed up state comes back as a copy next to it. Nothing is deleted.
 *
 * Memory stays small whatever the size of the library: designs and pictures are read one at a time, the archive is a
 * Blob of references (see `createZip`), and a backup being restored is read in slices (see `openZip`).
 */
import { listAssets, restoreAssets } from "@/core/assets";
import { uid } from "@/core/ids";
import { getStoredBrandKit, getStoredDesign, listDesigns, listFolders, restoreRecords, setBrandKit, type VersionRecord } from "@/core/library";
import { dbGet, dbGetAllKeys, metaGet, metaSet } from "@/core/persistence";
import type { Asset, Design } from "@/core/types";
import {
  BACKUP_MANIFEST_NAME,
  BackupError,
  backupFileName,
  buildManifest,
  countsOf,
  designAction,
  designEntryName,
  foldersToRestore,
  mergeBrandKit,
  mimeForExtension,
  parseManifest,
  planRestore,
  previewEntryName,
  restoredCopyTitle,
  uploadEntryName,
  versionEntryName,
  type BackupCounts,
  type BackupManifest,
  type BrandKitAction,
  type LocalLibrary,
  type ManifestDesign,
  type ManifestUpload,
  type ManifestVersion,
  type RestorePlan,
} from "./backupFormat";
import { bytesToBase64 } from "./encoding";
import { MigrationError } from "@/core/schema/migrator";
import { dataUrlToBytes, mimeOfDataUrl, parseStoredDesign, ProjectFileError } from "./projectFormat";
import { createZip, type ZipInput } from "./zip";
import { openZip, ZipReadError, type ZipArchive, type ZipReadEntry } from "./zipRead";

export { BackupError, backupFileName, type BackupCounts, type BrandKitAction, type RestorePlan } from "./backupFormat";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** What one ZIP file can address: 4 GB, less a little room for the headers. */
const MAX_ARCHIVE_BYTES = 4 * 1024 ** 3 - 1024 ** 2;
const MAX_ENTRIES = 0xffff;
const BATCH_ITEMS = 25;
const BATCH_BYTES = 32 * 1024 * 1024;
const BATCH_DESIGNS = 20;

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";
const isQuotaError = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError";

/** The error to show for anything that went wrong while reading a backup. */
function backupFailure(error: unknown): Error {
  if (error instanceof BackupError) return error;
  if (isAbort(error)) return new BackupError("cancelled");
  if (error instanceof ZipReadError) {
    if (error.code === "not-a-zip") return new BackupError("not-a-backup");
    return new BackupError(error.code === "unsupported" ? "unsupported" : "damaged", error.message);
  }
  return error as Error;
}

/** A full disk is something the person can fix; every other storage failure is passed on as it is. */
async function guardStorage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw isQuotaError(error) ? new BackupError("storage") : error;
  }
}

/**
 * Records waiting to be written together: one transaction, and one notification to the screens, for many records. It
 * writes when it holds `items` of them or `bytes` bytes, and when told to.
 */
function batcher<T>(write: (items: T[]) => Promise<void>, limits: { items: number; bytes?: number }) {
  let waiting: T[] = [];
  let bytes = 0;
  const flush = async () => {
    const batch = waiting;
    waiting = [];
    bytes = 0;
    if (batch.length) await guardStorage(() => write(batch));
  };
  return {
    flush,
    async add(item: T, size = 0) {
      waiting.push(item);
      bytes += size;
      if (waiting.length >= limits.items || bytes >= (limits.bytes ?? Infinity)) await flush();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Making a backup                                                    */
/* ------------------------------------------------------------------ */

export interface BackupProgress {
  /** "collecting" reads the library, "packing" checksums every file into the archive */
  phase: "collecting" | "packing";
  done: number;
  total: number;
}

export interface CreateBackupOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BackupProgress) => void;
  now?: Date;
  /** the most the archive may hold (default: what one ZIP file can address) */
  maxBytes?: number;
  /** the most files the archive may hold (default: what one ZIP file can address) */
  maxEntries?: number;
}

export interface CreatedBackup {
  blob: Blob;
  fileName: string;
  counts: BackupCounts;
}

/** Reads the whole library into one ZIP. Throws `BackupError` ("cancelled", "too-large"). */
export async function createBackup(options: CreateBackupOptions = {}): Promise<CreatedBackup> {
  const { signal, onProgress, now = new Date(), maxBytes = MAX_ARCHIVE_BYTES, maxEntries = MAX_ENTRIES } = options;
  const check = () => {
    if (signal?.aborted) throw new BackupError("cancelled");
  };
  check();

  const summaries = await listDesigns();
  const uploads = (await listAssets()).filter((asset) => asset.blob instanceof Blob);
  const known = new Set(summaries.map((s) => s.id));

  // saved versions are named `<designId>:<time>`; each design's come newest first, like the Version history list
  const versionKeys = new Map<string, string[]>();
  for (const key of await dbGetAllKeys("versions")) {
    const cut = key.lastIndexOf(":");
    if (cut < 1 || !known.has(key.slice(0, cut))) continue;
    const designId = key.slice(0, cut);
    versionKeys.set(designId, [...(versionKeys.get(designId) ?? []), key]);
  }
  const timeOf = (key: string) => Number(key.slice(key.lastIndexOf(":") + 1));
  for (const keys of versionKeys.values()) keys.sort((a, b) => timeOf(b) - timeOf(a));

  const total = summaries.length + uploads.length + [...versionKeys.values()].reduce((sum, keys) => sum + keys.length, 0);
  let done = 0;
  const step = () => onProgress?.({ phase: "collecting", done: ++done, total });
  const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" });

  const files: ZipInput[] = [];
  const manifestDesigns: ManifestDesign[] = [];
  const manifestUploads: ManifestUpload[] = [];
  const manifestVersions: ManifestVersion[] = [];

  for (const summary of summaries) {
    check();
    // exactly as stored: a design that a newer release made is no reason to fail, and a backup must not lose what this tab cannot read
    const design = await getStoredDesign(summary.id);
    step();
    if (!design) continue;
    const file = designEntryName(design.id);
    files.push({ name: file, data: json(design), modified: now });
    const entry: ManifestDesign = {
      id: design.id,
      title: design.title,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt,
      trashed: Boolean(design.trashedAt),
      folderId: design.folderId,
      file,
    };
    const preview = summary.thumbnail ? dataUrlToBytes(summary.thumbnail) : null;
    const previewMime = summary.thumbnail ? mimeOfDataUrl(summary.thumbnail) : null;
    if (preview && previewMime?.startsWith("image/")) {
      entry.preview = previewEntryName(design.id, previewMime);
      files.push({ name: entry.preview, data: preview.bytes, modified: now });
    }
    manifestDesigns.push(entry);
  }

  for (const asset of uploads) {
    check();
    step();
    const file = uploadEntryName(asset.id, asset.mime);
    files.push({ name: file, data: asset.blob, modified: now });
    manifestUploads.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      mime: asset.mime,
      size: asset.blob.size,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      file,
    });
  }

  for (const [designId, keys] of versionKeys) {
    for (const [index, key] of keys.entries()) {
      check();
      const record = await dbGet<VersionRecord>("versions", key);
      step();
      if (!record) continue;
      const file = versionEntryName(designId, index);
      files.push({ name: file, data: json(record), modified: now });
      manifestVersions.push({ id: record.id, designId: record.designId, createdAt: record.createdAt, ...(record.label !== undefined ? { label: record.label } : {}), file });
    }
  }

  const manifest: BackupManifest = buildManifest(
    { designs: manifestDesigns, uploads: manifestUploads, folders: await listFolders(), versions: manifestVersions, brandKit: (await getStoredBrandKit()) ?? null },
    now,
  );
  files.unshift({ name: BACKUP_MANIFEST_NAME, data: json(manifest), modified: now });

  // every file costs its data plus a local and a central header that both carry the name, and the archive an end record
  const bytes = files.reduce((sum, f) => sum + (f.data instanceof Blob ? f.data.size : f.data.length) + 76 + 2 * f.name.length, 22);
  if (bytes > maxBytes || files.length > maxEntries) throw new BackupError("too-large");

  try {
    const blob = await createZip(files, { signal, onProgress: (packed, count) => onProgress?.({ phase: "packing", done: packed, total: count }) });
    return { blob, fileName: backupFileName(now), counts: countsOf(manifest) };
  } catch (error) {
    throw backupFailure(error);
  }
}

/* ------------------------------------------------------------------ */
/* Reading a backup                                                   */
/* ------------------------------------------------------------------ */

interface OpenedBackup {
  archive: ZipArchive;
  manifest: BackupManifest;
  /** the folder the backup sits in when it was zipped again by another tool ("" or "name/") */
  root: string;
  skipped: number;
}

async function openBackup(file: Blob, signal?: AbortSignal): Promise<OpenedBackup> {
  if (signal?.aborted) throw new BackupError("cancelled");
  try {
    const archive = await openZip(file);
    const found = archive.entries.filter((e) => e.name === BACKUP_MANIFEST_NAME || e.name.endsWith(`/${BACKUP_MANIFEST_NAME}`)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!found) throw new BackupError("not-a-backup");
    const { manifest, skipped } = parseManifest(await archive.text(found, { signal }));
    return { archive, manifest, root: found.name.slice(0, found.name.length - BACKUP_MANIFEST_NAME.length), skipped };
  } catch (error) {
    throw backupFailure(error);
  }
}

async function readLocal(): Promise<LocalLibrary> {
  const [designs, folders, uploads, versions, brandKit] = await Promise.all([listDesigns(), listFolders(), dbGetAllKeys("assets"), dbGetAllKeys("versions"), getStoredBrandKit()]);
  return {
    designs: new Map(designs.map((d) => [d.id, d.updatedAt])),
    folders: new Set(folders.map((f) => f.id)),
    uploads: new Set(uploads),
    versions: new Set(versions),
    brandKit,
  };
}

export interface BackupInspection {
  /** ISO timestamp of when the backup was made */
  exportedAt: string;
  counts: BackupCounts;
  /** what restoring would do to the library as it is now */
  plan: RestorePlan;
  /** items in the manifest that could not be used at all */
  skipped: number;
}

/** Reads only the manifest of a backup file: what is in it, and what restoring it here would change. */
export async function inspectBackup(file: Blob, options: { signal?: AbortSignal } = {}): Promise<BackupInspection> {
  const { manifest, skipped } = await openBackup(file, options.signal);
  return { exportedAt: manifest.exportedAt, counts: countsOf(manifest), plan: planRestore(manifest, await readLocal()), skipped };
}

/* ------------------------------------------------------------------ */
/* Restoring                                                          */
/* ------------------------------------------------------------------ */

export interface RestoreOptions {
  signal?: AbortSignal;
  /** called after each upload, design and saved version has been handled */
  onProgress?: (progress: { done: number; total: number }) => void;
}

export interface RestoreResult {
  designs: { added: number; copied: number; same: number; damaged: number };
  uploads: { added: number; same: number; damaged: number };
  folders: { added: number };
  versions: { added: number; damaged: number };
  brandKit: BrandKitAction;
  /** items the backup listed that could not be used at all (an id that is not safe, no file name) */
  skipped: number;
  /** designs and saved versions that a newer Craftly made: not damaged, and left out until this one is updated */
  newer: number;
}

/**
 * Adds everything in a backup that this library does not have. A file in the archive that is damaged is skipped and
 * counted, the rest is restored. Throws `BackupError` when the file is not a backup, is from a newer Craftly, is
 * cancelled ("cancelled"; what was restored until then stays) or the browser has no room left ("storage").
 */
export async function restoreBackup(file: Blob, options: RestoreOptions = {}): Promise<RestoreResult> {
  const { signal, onProgress } = options;
  const { archive, manifest, root, skipped } = await openBackup(file, signal);
  const local = await readLocal();
  const plan = planRestore(manifest, local);
  const result: RestoreResult = {
    designs: { added: 0, copied: 0, same: plan.designs.same, damaged: 0 },
    uploads: { added: 0, same: plan.uploads.same, damaged: 0 },
    folders: { added: 0 },
    versions: { added: 0, damaged: 0 },
    brandKit: plan.brandKit,
    skipped,
    newer: 0,
  };

  const total = plan.uploads.add + plan.designs.add + plan.designs.copy + plan.versions.add;
  let done = 0;
  const tick = () => onProgress?.({ done: ++done, total });

  /**
   * One file of the archive, or null when it is missing or damaged. Only the file is lost, never the restore. A design
   * from a newer Craftly is not damaged: it also gives null, and `onNewer` tells the caller which kind of null it is.
   */
  async function load<T>(name: string, read: (entry: ZipReadEntry) => Promise<T>, onNewer?: () => void): Promise<T | null> {
    const entry = archive.find(root + name);
    if (!entry) return null;
    try {
      return await read(entry);
    } catch (error) {
      if (error instanceof MigrationError && error.code === "newer") {
        onNewer?.();
        return null;
      }
      if (error instanceof ZipReadError || error instanceof SyntaxError || error instanceof ProjectFileError) return null;
      throw backupFailure(error);
    }
  }
  const loadDesign = (name: string, onNewer: () => void, pick: (raw: unknown) => unknown = (raw) => raw) =>
    load(name, async (entry) => parseStoredDesign(pick(JSON.parse(await archive.text(entry, { signal })))), onNewer);

  const assets = batcher<Asset>(restoreAssets, { items: BATCH_ITEMS, bytes: BATCH_BYTES });
  const designs = batcher<{ design: Design; thumbnail?: string }>((batch) => restoreRecords({ designs: batch }), { items: BATCH_DESIGNS });
  const versions = batcher<VersionRecord>((batch) => restoreRecords({ versions: batch }), { items: BATCH_DESIGNS });
  const ownId = new Set<string>(); // designs that are here under their own id once this is done
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new BackupError("cancelled");
  };
  // the thumbnail is tiny and belongs to a design that was already read: a cancel does not need to cut it short
  const thumbnailOf = async (entry: ManifestDesign): Promise<string | undefined> => {
    const mime = entry.preview ? mimeForExtension(entry.preview) : null;
    const blob = entry.preview && mime ? await load(entry.preview, (found) => archive.read(found, { type: mime })) : null;
    return blob && mime ? `data:${mime};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}` : undefined;
  };

  try {
    /* ---- uploaded pictures ---- */
    for (const upload of manifest.uploads) {
      if (local.uploads.has(upload.id)) continue;
      stopIfCancelled();
      const blob = await load(upload.file, (entry) => archive.read(entry, { signal, type: upload.mime }));
      tick();
      if (!blob) {
        result.uploads.damaged++;
        continue;
      }
      result.uploads.added++;
      await assets.add(
        { id: upload.id, name: upload.name, kind: upload.kind, mime: upload.mime, size: blob.size, width: upload.width, height: upload.height, createdAt: upload.createdAt, blob },
        blob.size,
      );
    }
    await assets.flush();

    /* ---- folders ---- */
    const folders = foldersToRestore(manifest.folders, local.folders);
    if (folders.length) await guardStorage(() => restoreRecords({ folders }));
    result.folders.added = folders.length;
    const knownFolders = new Set([...local.folders, ...folders.map((f) => f.id)]);

    /* ---- designs ---- */
    for (const entry of manifest.designs) {
      const action = designAction(local.designs, entry);
      if (action === "same") {
        ownId.add(entry.id);
        continue;
      }
      stopIfCancelled();
      let isNewer = false;
      const design = await loadDesign(entry.file, () => (isNewer = true));
      tick();
      if (!design) {
        if (isNewer) result.newer++;
        else result.designs.damaged++;
        continue;
      }
      const folderId = design.folderId && knownFolders.has(design.folderId) ? design.folderId : null;
      const thumbnail = await thumbnailOf(entry);
      if (action === "add") {
        ownId.add(entry.id);
        result.designs.added++;
      } else result.designs.copied++;
      await designs.add({
        design: action === "add" ? { ...design, id: entry.id, folderId } : { ...design, id: uid("d"), title: restoredCopyTitle(design.title), folderId },
        thumbnail,
      });
    }
    await designs.flush();

    /* ---- saved versions of the designs that came back under their own id ---- */
    for (const entry of manifest.versions) {
      if (!ownId.has(entry.designId) || local.versions.has(entry.id)) continue;
      stopIfCancelled();
      let isNewer = false;
      const design = await loadDesign(
        entry.file,
        () => (isNewer = true),
        (raw) => (raw as { design?: unknown } | null)?.design,
      );
      tick();
      if (!design) {
        if (isNewer) result.newer++;
        else result.versions.damaged++;
        continue;
      }
      result.versions.added++;
      await versions.add({
        id: entry.id,
        designId: entry.designId,
        createdAt: entry.createdAt,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
        design: { ...design, id: entry.designId },
      });
    }
    await versions.flush();

    /* ---- brand kit ---- */
    const { kit } = mergeBrandKit(local.brandKit, manifest.brandKit);
    if (kit) await guardStorage(() => setBrandKit(kit));
  } catch (error) {
    // stopping keeps everything that was read until then, not only what was already written
    if (error instanceof BackupError && error.code === "cancelled") {
      await assets.flush();
      await designs.flush();
      await versions.flush();
    }
    throw error;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* When the last backup was made                                      */
/* ------------------------------------------------------------------ */

const LAST_BACKUP_KEY = "lastBackupAt";

/** When a backup was last handed to the browser for download, or null when none was. */
export const getLastBackupAt = () => metaGet<number | null>(LAST_BACKUP_KEY, null);

export const markBackedUp = (when: number = Date.now()) => metaSet(LAST_BACKUP_KEY, when);

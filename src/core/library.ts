/**
 * The design library: saved designs, folders, trash, brand kit and version
 * history. Everything lives in IndexedDB; components subscribe with
 * `subscribeLibrary` (or `useLibrary` in dashboard code) to refresh on change.
 */
import { createDesign, createPage, solid } from "./factory";
import { uid } from "./ids";
import { dbDelete, dbGet, dbGetAll, dbPut, dbPutMany, metaGet, metaSet, openDb, wrap, writeTransaction, type StoreName } from "./persistence";
import { clonePageWithIds } from "./ops";
import { CURRENT_DESIGN_VERSION, migrateDesign } from "./schema/design";
import { newerError } from "./schema/migrator";
import { askForPersistentStorageOnce } from "./storage";
import type { Asset, BrandKit, Design, DesignSummary, Folder, Page, SizeUnit } from "./types";

/* ---------------- change notifications ---------------- */

const listeners = new Set<() => void>();
export function subscribeLibrary(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((l) => l());

/* ---------------- designs ---------------- */

export function summarize(design: Design, thumbnail?: string, previous?: DesignSummary): DesignSummary {
  return {
    id: design.id,
    title: design.title,
    typeId: design.typeId,
    width: design.width,
    height: design.height,
    pageCount: design.pages.length,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    folderId: design.folderId,
    starred: design.starred,
    trashedAt: design.trashedAt,
    thumbnail: thumbnail ?? previous?.thumbnail,
    schema: design.version,
  };
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const all = await dbGetAll<DesignSummary>("summaries");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * A design exactly as it is stored, whatever version wrote it. For what has nothing to do with the document's format: a
 * backup copies it, and renaming, starring or trashing patch their own fields in it and leave the rest as they found it.
 */
export const getStoredDesign = (id: string) => dbGet<Design>("designs", id).then((d) => d ?? null);

/**
 * A design to open or to copy, at the current version (what is stored is not changed until the design is saved). Rejects
 * with a `MigrationError` for one that a newer release stored (`code` "newer") or that cannot be brought up to date.
 */
export async function getDesign(id: string): Promise<Design | null> {
  const stored = await getStoredDesign(id);
  return stored ? migrateDesign(stored).design : null;
}
export const getSummary = (id: string) => dbGet<DesignSummary>("summaries", id).then((d) => d ?? null);

export class DesignSaveConflict extends Error {
  constructor(deleted: boolean) {
    super(
      deleted
        ? "This design was deleted in another tab. Download a project file to keep your edits."
        : "This design changed in another tab. Download a project file to keep your edits.",
    );
    this.name = "DesignSaveConflict";
  }
}

/** Read the document and its revision from the same database snapshot. */
export async function getDesignForEditing(id: string): Promise<{ design: Design; revision: string | null } | null> {
  const tx = (await openDb()).transaction(["designs", "summaries"], "readonly");
  const [stored, summary] = await Promise.all([wrap<Design | undefined>(tx.objectStore("designs").get(id)), wrap<DesignSummary | undefined>(tx.objectStore("summaries").get(id))]);
  return stored ? { design: migrateDesign(stored).design, revision: summary?.revision ?? null } : null;
}

export async function saveDesign(design: Design, thumbnail?: string, expectedRevision?: string | null, assets: Asset[] = []): Promise<string> {
  const stores: StoreName[] = ["designs", "summaries", "versions"];
  if (assets.length) stores.push("assets");
  const revision = await writeTransaction(stores, async (tx) => {
    const summaries = tx.objectStore("summaries");
    const designs = tx.objectStore("designs");
    const prev = await wrap<DesignSummary | undefined>(summaries.get(design.id));
    if (expectedRevision !== undefined && (!prev || (prev.revision ?? null) !== expectedRevision)) throw new DesignSaveConflict(!prev);
    const stored = prev?.schema ?? 1;
    if (prev && stored > CURRENT_DESIGN_VERSION) throw newerError("design", stored, CURRENT_DESIGN_VERSION);
    if (prev && stored < design.version) {
      const original = await wrap<Design | undefined>(designs.get(design.id));
      if (original) {
        const now = Date.now();
        const record: VersionRecord = { id: `${design.id}:${now}`, designId: design.id, createdAt: now, label: "Before the update", design: original };
        tx.objectStore("versions").put(record);
      }
    }
    const summary = { ...summarize(design, thumbnail, prev), revision: uid("revision") };
    for (const asset of assets) tx.objectStore("assets").add(asset);
    designs.put(design);
    summaries.put(summary);
    return summary.revision;
  });
  emit();
  void askForPersistentStorageOnce();
  return revision;
}

export async function saveThumbnail(id: string, revision: string, thumbnail: string): Promise<void> {
  const written = await writeTransaction(["summaries"], async (tx) => {
    const summaries = tx.objectStore("summaries");
    const prev = await wrap<DesignSummary | undefined>(summaries.get(id));
    if (prev?.revision !== revision) return false;
    summaries.put({ ...prev, thumbnail });
    return true;
  });
  if (written) emit();
}

export async function updateSummary(id: string, patch: Partial<DesignSummary>): Promise<void> {
  const written = await writeTransaction(["designs", "summaries"], async (tx) => {
    const designs = tx.objectStore("designs");
    const summaries = tx.objectStore("summaries");
    const [design, prev] = await Promise.all([wrap<Design | undefined>(designs.get(id)), wrap<DesignSummary | undefined>(summaries.get(id))]);
    if (!design || !prev) return false;
    const nextDesign: Design = { ...design };
    if (patch.title !== undefined) nextDesign.title = patch.title;
    if (patch.starred !== undefined) nextDesign.starred = patch.starred;
    if (patch.folderId !== undefined) nextDesign.folderId = patch.folderId;
    if (patch.trashedAt !== undefined) nextDesign.trashedAt = patch.trashedAt;
    designs.put(nextDesign);
    summaries.put({ ...prev, ...patch, revision: uid("revision") });
    return true;
  });
  if (written) emit();
}

export const renameDesign = (id: string, title: string) => updateSummary(id, { title: title.trim() || "Untitled design" });
export const setStarred = (id: string, starred: boolean) => updateSummary(id, { starred });
export const moveToFolder = (id: string, folderId: string | null) => updateSummary(id, { folderId });
export const moveToTrash = (id: string) => updateSummary(id, { trashedAt: Date.now() });
export const restoreFromTrash = (id: string) => updateSummary(id, { trashedAt: null });

export async function deleteForever(id: string): Promise<void> {
  await writeTransaction(["designs", "summaries", "versions"], async (tx) => {
    tx.objectStore("designs").delete(id);
    tx.objectStore("summaries").delete(id);
    const versions = tx.objectStore("versions");
    const records = await wrap<VersionRecord[]>(versions.getAll());
    for (const version of records) if (version.designId === id) versions.delete(version.id);
  });
  emit();
}

export async function emptyTrash(): Promise<void> {
  const all = await listDesigns();
  for (const s of all) if (s.trashedAt) await deleteForever(s.id);
}

export async function duplicateDesign(id: string): Promise<Design | null> {
  const src = await getDesign(id);
  if (!src) return null;
  const copy: Design = structuredClone(src);
  copy.id = uid("d");
  copy.title = `${src.title} (copy)`;
  copy.createdAt = copy.updatedAt = Date.now();
  copy.trashedAt = null;
  copy.starred = false;
  // a copy of a shared design is a design of its own: with the room and its keys it would open as the shared one, and every
  // change to "the copy" would go to everybody in the room
  delete copy.live;
  copy.pages = src.pages.map((p) => clonePageWithIds(p));
  const prev = await getSummary(id);
  await dbPutMany([
    { store: "designs", value: copy },
    { store: "summaries", value: { ...summarize(copy, prev?.thumbnail), revision: uid("revision") } },
  ]);
  emit();
  return copy;
}

/** Creates and stores a blank design of the given size. */
export async function createBlankDesign(opts: {
  typeId: string;
  width: number;
  height: number;
  title?: string;
  unit?: SizeUnit;
  folderId?: string | null;
  background?: string;
}): Promise<Design> {
  const page = createPage({ background: solid(opts.background ?? "#ffffff") });
  const design = createDesign({ title: opts.title, typeId: opts.typeId, width: opts.width, height: opts.height, unit: opts.unit, pages: [page] });
  design.folderId = opts.folderId ?? null;
  await saveDesign(design);
  return design;
}

/** Creates and stores a design from template pages (fresh ids). */
export async function createDesignFromPages(opts: { typeId: string; width: number; height: number; title: string; pages: Page[]; folderId?: string | null }): Promise<Design> {
  const design = createDesign({ title: opts.title, typeId: opts.typeId, width: opts.width, height: opts.height, pages: opts.pages.map((p) => clonePageWithIds(p)) });
  design.folderId = opts.folderId ?? null;
  await saveDesign(design);
  return design;
}

/** What a backup brings back: designs (with the thumbnail their dashboard card shows), folders and saved versions. */
export interface RestoredRecords {
  designs?: Array<{ design: Design; thumbnail?: string }>;
  folders?: Folder[];
  versions?: VersionRecord[];
}

/** Stores records as they are (ids and library data kept) in one transaction and tells subscribers once. */
export async function restoreRecords(records: RestoredRecords): Promise<void> {
  const writes: Array<{ store: StoreName; value: unknown }> = [];
  for (const { design, thumbnail } of records.designs ?? []) {
    writes.push({ store: "designs", value: design }, { store: "summaries", value: { ...summarize(design, thumbnail), revision: uid("revision") } });
  }
  for (const folder of records.folders ?? []) writes.push({ store: "folders", value: folder });
  for (const version of records.versions ?? []) writes.push({ store: "versions", value: version });
  if (!writes.length) return;
  await dbPutMany(writes);
  emit();
}

/* ---------------- folders ---------------- */

export async function listFolders(): Promise<Folder[]> {
  return (await dbGetAll<Folder>("folders")).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name: string, parentId: string | null = null): Promise<Folder> {
  const folder: Folder = { id: uid("f"), name: name.trim() || "Untitled folder", createdAt: Date.now(), parentId };
  await dbPut("folders", folder);
  emit();
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const f = await dbGet<Folder>("folders", id);
  if (!f) return;
  await dbPut("folders", { ...f, name: name.trim() || f.name });
  emit();
}

/** Deleting a folder moves its designs back to the top level. */
export async function deleteFolder(id: string): Promise<void> {
  const designs = await listDesigns();
  for (const d of designs) if (d.folderId === id) await updateSummary(d.id, { folderId: null });
  await dbDelete("folders", id);
  emit();
}

/* ---------------- brand kit ---------------- */

const DEFAULT_BRAND: BrandKit = { colors: ["#7c3aed", "#14b8a6", "#0e1318", "#f59e0b", "#ffffff"], fonts: ["Plus Jakarta Sans", "Playfair Display"], logos: [] };

export const getBrandKit = () => metaGet<BrandKit>("brandKit", DEFAULT_BRAND);

/** The brand kit this browser saved, or undefined while it still shows the default one. */
export const getStoredBrandKit = () => metaGet<BrandKit | undefined>("brandKit", undefined);

export async function setBrandKit(kit: BrandKit): Promise<void> {
  await metaSet("brandKit", kit);
  emit();
}

/* ---------------- recent colours & misc settings ---------------- */

export const getRecentColors = () => metaGet<string[]>("recentColors", []);

export async function pushRecentColor(color: string): Promise<void> {
  const cur = await getRecentColors();
  await metaSet("recentColors", [color, ...cur.filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 14));
}

/* ---------------- version history ---------------- */

export interface VersionRecord {
  id: string;
  designId: string;
  createdAt: number;
  label?: string;
  design: Design;
}

const MAX_VERSIONS = 25;

export async function saveVersion(design: Design, label?: string, revision?: string): Promise<void> {
  const stores: StoreName[] = revision === undefined ? ["versions"] : ["versions", "summaries"];
  await writeTransaction(stores, async (tx) => {
    if (revision !== undefined) {
      const summary = await wrap<DesignSummary | undefined>(tx.objectStore("summaries").get(design.id));
      if (summary?.revision !== revision) return;
    }
    const versions = tx.objectStore("versions");
    const records = await wrap<VersionRecord[]>(versions.getAll());
    const recent = records.filter((v) => v.designId === design.id).sort((a, b) => b.createdAt - a.createdAt);
    const now = Date.now();
    const id = `${design.id}:${now}`;
    versions.put({ id, designId: design.id, createdAt: now, label, design });
    for (const stale of recent.filter((record) => record.id !== id).slice(MAX_VERSIONS - 1)) versions.delete(stale.id);
  });
}

export async function listVersions(designId: string): Promise<Omit<VersionRecord, "design">[]> {
  const all = (await dbGetAll<VersionRecord>("versions")).filter((v) => v.designId === designId);
  return all.sort((a, b) => b.createdAt - a.createdAt).map(({ design: _design, ...rest }) => rest);
}

/** A saved version with its design at the current version; null when there is none, or when it cannot be read (a newer release saved it). */
export async function getVersion(id: string): Promise<VersionRecord | null> {
  const record = await dbGet<VersionRecord>("versions", id);
  if (!record) return null;
  try {
    return { ...record, design: migrateDesign(record.design).design };
  } catch {
    return null;
  }
}

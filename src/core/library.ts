/**
 * The design library: saved designs, folders, trash, brand kit and version
 * history. Everything lives in IndexedDB; components subscribe with
 * `subscribeLibrary` (or `useLibrary` in dashboard code) to refresh on change.
 */
import { createDesign, createPage, solid } from "./factory";
import { uid } from "./ids";
import { dbDelete, dbDeleteMany, dbGet, dbGetAll, dbPut, dbPutMany, metaGet, metaSet, type StoreName } from "./persistence";
import { clonePageWithIds } from "./ops";
import { CURRENT_DESIGN_VERSION, migrateDesign } from "./schema/design";
import { newerError } from "./schema/migrator";
import { askForPersistentStorageOnce } from "./storage";
import type { BrandKit, Design, DesignSummary, Folder, Page, SizeUnit } from "./types";

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

/** The first save of an upgraded design keeps what was stored in the version history, so a step that went wrong can be undone. */
async function keepOriginal(id: string): Promise<void> {
  const original = await getStoredDesign(id);
  if (!original) return;
  const now = Date.now();
  const record: VersionRecord = { id: `${id}:${now}`, designId: id, createdAt: now, label: "Before the update", design: original };
  await dbPut("versions", record);
}

/**
 * Writes the design and its dashboard record. Never over a design that a newer release stored (this tab is older than the
 * library: it would turn the document back into a format that has lost things), and the first save of a design that was
 * brought up to date keeps what was there. The dashboard record says which version the stored design is, so neither check
 * has to read the design.
 */
export async function saveDesign(design: Design, thumbnail?: string): Promise<void> {
  const prev = await getSummary(design.id);
  const stored = prev?.schema ?? 1;
  if (prev && stored > CURRENT_DESIGN_VERSION) throw newerError("design", stored, CURRENT_DESIGN_VERSION);
  if (prev && stored < design.version) await keepOriginal(design.id);
  await dbPutMany([
    { store: "designs", value: design },
    { store: "summaries", value: summarize(design, thumbnail, prev ?? undefined) },
  ]);
  emit();
  void askForPersistentStorageOnce(); // the first save is when there is something to lose
}

export async function updateSummary(id: string, patch: Partial<DesignSummary>): Promise<void> {
  const design = await getStoredDesign(id);
  const prev = await getSummary(id);
  if (!design || !prev) return;
  const nextDesign: Design = { ...design };
  if (patch.title !== undefined) nextDesign.title = patch.title;
  if (patch.starred !== undefined) nextDesign.starred = patch.starred;
  if (patch.folderId !== undefined) nextDesign.folderId = patch.folderId;
  if (patch.trashedAt !== undefined) nextDesign.trashedAt = patch.trashedAt;
  await dbPutMany([
    { store: "designs", value: nextDesign },
    { store: "summaries", value: { ...prev, ...patch } },
  ]);
  emit();
}

export const renameDesign = (id: string, title: string) => updateSummary(id, { title: title.trim() || "Untitled design" });
export const setStarred = (id: string, starred: boolean) => updateSummary(id, { starred });
export const moveToFolder = (id: string, folderId: string | null) => updateSummary(id, { folderId });
export const moveToTrash = (id: string) => updateSummary(id, { trashedAt: Date.now() });
export const restoreFromTrash = (id: string) => updateSummary(id, { trashedAt: null });

export async function deleteForever(id: string): Promise<void> {
  await dbDelete("designs", id);
  await dbDelete("summaries", id);
  const versions = await dbGetAll<{ id: string; designId: string }>("versions");
  await dbDeleteMany(
    "versions",
    versions.filter((v) => v.designId === id).map((v) => v.id),
  );
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
  copy.pages = src.pages.map((p) => clonePageWithIds(p));
  const prev = await getSummary(id);
  await dbPutMany([
    { store: "designs", value: copy },
    { store: "summaries", value: summarize(copy, prev?.thumbnail) },
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
    writes.push({ store: "designs", value: design }, { store: "summaries", value: summarize(design, thumbnail) });
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

export async function saveVersion(design: Design, label?: string): Promise<void> {
  const all = (await dbGetAll<VersionRecord>("versions")).filter((v) => v.designId === design.id).sort((a, b) => b.createdAt - a.createdAt);
  const rec: VersionRecord = { id: `${design.id}:${Date.now()}`, designId: design.id, createdAt: Date.now(), label, design: structuredClone(design) };
  await dbPut("versions", rec);
  const stale = all.slice(MAX_VERSIONS - 1).map((v) => v.id);
  if (stale.length) await dbDeleteMany("versions", stale);
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

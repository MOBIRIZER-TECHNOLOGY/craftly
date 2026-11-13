import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { getAsset, listAssets, subscribeAssets } from "@/core/assets";
import { createDesign, createImage, createPage, createText } from "@/core/factory";
import {
  createFolder,
  getDesign,
  getStoredBrandKit,
  getSummary,
  getVersion,
  listDesigns,
  listFolders,
  listVersions,
  restoreRecords,
  saveDesign,
  saveVersion,
  setBrandKit,
  summarize,
} from "@/core/library";
import { dbDelete, dbGetAllKeys, dbPut } from "@/core/persistence";
import { CURRENT_DESIGN_VERSION } from "@/core/schema/design";
import type { Asset, Design } from "@/core/types";
import { wipeDatabase } from "@/test/logicDb";
import { buildZip } from "@/test/zipBuilder";
import { createBackup, getLastBackupAt, inspectBackup, markBackedUp, restoreBackup, type BackupProgress } from "./backup";
import { BackupError, BACKUP_MANIFEST_NAME, parseManifest } from "./backupFormat";
import { zipSync } from "./zip";
import { openZip } from "./zipRead";

vi.mock("@/core/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library")>();
  return { ...actual, restoreRecords: vi.fn(actual.restoreRecords) };
});

const NOW = new Date(2026, 10, 8, 12, 0, 0);
const enc = new TextEncoder();
const jpeg = (text: string) => `data:image/jpeg;base64,${btoa(text)}`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"/>`;

async function putUpload(id: string, mime: string, content: string, over: Partial<Asset> = {}): Promise<Asset> {
  const asset: Asset = {
    id,
    name: `Upload ${id}`,
    kind: mime === "image/svg+xml" ? "svg" : "image",
    mime,
    size: content.length,
    width: 30,
    height: 20,
    createdAt: 5,
    blob: new Blob([content], { type: mime }),
    ...over,
  };
  await dbPut("assets", asset);
  return asset;
}

function poster(over: Partial<Design> = {}): Design {
  const page = createPage({ elements: [createText({ text: "Hello" }), createImage({ src: "asset:a_logo", width: 40, height: 40 })] });
  return { ...createDesign({ title: "Poster", width: 400, height: 300, pages: [page] }), createdAt: 1000, updatedAt: 2000, ...over };
}

/** Three designs (one starred in a folder, one in the trash), two uploads, two versions, a brand kit. */
async function seed() {
  const folder = await createFolder("Work");
  const a = poster({ id: "d_poster", folderId: folder.id, starred: true });
  const b = poster({ id: "d_old", title: "Old idea", trashedAt: 3000, updatedAt: 2500 });
  const c = poster({ id: "d_plain", title: "Plain", updatedAt: 2600, pages: [createPage()] });
  await saveDesign(a, jpeg("thumb-a"));
  await saveDesign(b);
  await saveDesign(c, jpeg("thumb-c"));
  await putUpload("a_logo", "image/png", "PNG-BYTES", { name: "Logo", width: 64, height: 32 });
  await putUpload("a_unused", "image/svg+xml", SVG, { name: "Doodle" });
  vi.setSystemTime(10_000);
  await saveVersion(a, "first");
  vi.setSystemTime(20_000);
  await saveVersion({ ...a, title: "Poster, second try" }, "second");
  await setBrandKit({ colors: ["#111111"], fonts: ["Lora"], logos: ["a_logo"] });
  return { folder, a, b, c };
}

/* ---- helpers that take an archive apart and put it together the way other tools would ---- */

async function entriesOf(blob: Blob): Promise<Array<{ name: string; data: Uint8Array }>> {
  const archive = await openZip(blob);
  return Promise.all(archive.entries.map(async (e) => ({ name: e.name, data: new Uint8Array(await (await archive.read(e)).arrayBuffer()) })));
}

async function rebuild(blob: Blob, transform: (entries: Array<{ name: string; data: Uint8Array }>) => Array<{ name: string; data: Uint8Array }>, method = 0): Promise<Blob> {
  const entries = transform(await entriesOf(blob));
  return new Blob([(await buildZip(entries.map((e) => ({ name: e.name, data: e.data, method })))) as BlobPart], { type: "application/zip" });
}

/** A byte flipped inside one file's data: the file no longer matches its checksum. */
async function corrupt(blob: Blob, name: string): Promise<Blob> {
  const entry = (await openZip(blob)).find(name)!;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  bytes[entry.offset + 30 + enc.encode(name).length + Math.min(1, entry.size - 1)] ^= 0xff;
  return new Blob([bytes as BlobPart]);
}

/** The manifest, changed by `edit`, in an otherwise identical archive. */
const withManifest = (blob: Blob, edit: (manifest: Record<string, unknown>) => void) =>
  rebuild(blob, (entries) =>
    entries.map((e) => {
      if (e.name !== BACKUP_MANIFEST_NAME) return e;
      const manifest = JSON.parse(new TextDecoder().decode(e.data)) as Record<string, unknown>;
      edit(manifest);
      return { name: e.name, data: enc.encode(JSON.stringify(manifest)) };
    }),
  );

/** What Explorer or Finder make of an unzipped and zipped again backup: everything inside a folder, compressed. */
const rezip = (blob: Blob, folder = "Craftly backup 2026-11-08/") =>
  rebuild(blob, (entries) => [{ name: folder, data: new Uint8Array(0) }, ...entries.map((e) => ({ ...e, name: folder + e.name }))], 8);

const textOf = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await wipeDatabase();
  vi.mocked(restoreRecords).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackup", () => {
  it("holds every design (the trash too) with its preview, every upload, the saved versions and the brand kit", async () => {
    const { folder, a } = await seed();
    const { blob, fileName, counts } = await createBackup({ now: NOW });

    expect(fileName).toBe("Craftly backup 2026-11-08.zip");
    expect(counts).toEqual({ designs: 2, trashed: 1, folders: 1, uploads: 2, versions: 2 });
    expect(blob.type).toBe("application/zip");

    const archive = await openZip(blob);
    expect(archive.entries[0].name).toBe(BACKUP_MANIFEST_NAME);
    expect(archive.entries.map((e) => e.name).sort()).toEqual([
      BACKUP_MANIFEST_NAME,
      "designs/d_old.json",
      "designs/d_plain.json",
      "designs/d_poster.json",
      "previews/d_plain.jpg",
      "previews/d_poster.jpg",
      "uploads/a_logo.png",
      "uploads/a_unused.svg",
      "versions/d_poster/0.json",
      "versions/d_poster/1.json",
    ]);

    const { manifest, skipped } = parseManifest(await archive.text(archive.find(BACKUP_MANIFEST_NAME)!));
    expect(skipped).toBe(0);
    expect(manifest.exportedAt).toBe(NOW.toISOString());
    expect(manifest.folders).toEqual([folder]);
    expect(manifest.brandKit).toEqual({ colors: ["#111111"], fonts: ["Lora"], logos: ["a_logo"] });
    expect(manifest.designs.find((d) => d.id === "d_poster")).toMatchObject({
      title: "Poster",
      trashed: false,
      folderId: folder.id,
      updatedAt: 2000,
      file: "designs/d_poster.json",
      preview: "previews/d_poster.jpg",
    });
    expect(manifest.designs.find((d) => d.id === "d_old")).toMatchObject({ trashed: true });
    expect(manifest.designs.find((d) => d.id === "d_old")?.preview).toBeUndefined();
    expect(manifest.uploads.find((u) => u.id === "a_logo")).toMatchObject({
      name: "Logo",
      mime: "image/png",
      kind: "image",
      size: 9,
      width: 64,
      height: 32,
      createdAt: 5,
      file: "uploads/a_logo.png",
    });
    expect(manifest.uploads.find((u) => u.id === "a_unused")).toMatchObject({ kind: "svg" });

    expect(JSON.parse(await archive.text(archive.find("designs/d_poster.json")!))).toEqual(a);
    expect(await textOf(await archive.read(archive.find("uploads/a_logo.png")!))).toBe("PNG-BYTES");
    expect(await textOf(await archive.read(archive.find("uploads/a_unused.svg")!))).toBe(SVG);
    expect(await textOf(await archive.read(archive.find("previews/d_poster.jpg")!))).toBe("thumb-a");
    const version = JSON.parse(await archive.text(archive.find("versions/d_poster/1.json")!));
    expect(version).toMatchObject({ designId: "d_poster", label: "first" });
    expect(version.design.title).toBe("Poster");
  });

  it("is a valid backup even when there is nothing to back up", async () => {
    const { blob, counts } = await createBackup({ now: NOW });
    expect(counts).toEqual({ designs: 0, trashed: 0, folders: 0, uploads: 0, versions: 0 });
    const archive = await openZip(blob);
    expect(archive.entries.map((e) => e.name)).toEqual([BACKUP_MANIFEST_NAME]);
    expect(parseManifest(await archive.text(archive.entries[0])).manifest.brandKit).toBeNull();
  });

  it("writes the brand kit only when this browser saved one of its own", async () => {
    await saveDesign(poster({ id: "d_one" }));
    const archive = await openZip((await createBackup({ now: NOW })).blob);
    expect(parseManifest(await archive.text(archive.entries[0])).manifest.brandKit).toBeNull();
  });

  it("does not mind a design that uses a picture which is no longer in the library", async () => {
    await saveDesign(poster({ id: "d_lost" }));
    const { counts, blob } = await createBackup({ now: NOW });
    expect(counts.uploads).toBe(0);
    expect((await openZip(blob)).entries.map((e) => e.name)).toEqual([BACKUP_MANIFEST_NAME, "designs/d_lost.json"]);
  });

  it("leaves out a preview that is not a picture and an upload that has lost its bytes", async () => {
    await saveDesign(poster({ id: "d_one" }), "https://example.test/not-a-data-url.png");
    await dbPut("assets", { id: "a_bad", name: "Bad", kind: "image", mime: "image/png", size: 1, width: 1, height: 1, createdAt: 1, blob: "not bytes" });
    const { blob, counts } = await createBackup({ now: NOW });
    expect(counts.uploads).toBe(0);
    expect((await openZip(blob)).entries.map((e) => e.name)).toEqual([BACKUP_MANIFEST_NAME, "designs/d_one.json"]);
  });

  it("counts a design that has no trash field at all (an old record) as one that is not in the trash", async () => {
    const { trashedAt: _gone, ...legacy } = poster({ id: "d_legacy" });
    await dbPut("designs", legacy);
    await dbPut("summaries", {
      id: "d_legacy",
      title: "Poster",
      typeId: "custom",
      width: 400,
      height: 300,
      pageCount: 1,
      createdAt: 1,
      updatedAt: 2000,
      folderId: null,
      starred: false,
      trashedAt: null,
    });
    const { counts } = await createBackup({ now: NOW });
    expect(counts).toMatchObject({ designs: 1, trashed: 0 });
  });

  it("leaves out a design that has a dashboard card but no document", async () => {
    await saveDesign(poster({ id: "d_real" }));
    await dbPut("summaries", {
      id: "d_ghost",
      title: "Ghost",
      typeId: "custom",
      width: 1,
      height: 1,
      pageCount: 1,
      createdAt: 1,
      updatedAt: 1,
      folderId: null,
      starred: false,
      trashedAt: null,
    });
    const { counts, blob } = await createBackup({ now: NOW });
    expect(counts.designs).toBe(1);
    expect((await openZip(blob)).find("designs/d_ghost.json")).toBeUndefined();
  });

  it("skips a saved version that disappears while the backup is being made", async () => {
    await seed();
    const [victim] = await dbGetAllKeys("versions");
    const { counts } = await createBackup({
      now: NOW,
      onProgress: (p) => {
        if (p.phase === "collecting" && p.done === 5) void dbDelete("versions", victim);
      },
    });
    expect(counts.versions).toBe(1);
  });

  it("keeps a saved version that has no label as it is", async () => {
    const a = poster({ id: "d_a" });
    await saveDesign(a);
    await saveVersion(a);
    const { blob, counts } = await createBackup({ now: NOW });
    expect(counts.versions).toBe(1);
    const archive = await openZip(blob);
    expect(parseManifest(await archive.text(archive.entries[0])).manifest.versions[0]).not.toHaveProperty("label");
    await wipeDatabase();
    expect((await restoreBackup(blob)).versions.added).toBe(1);
    const [only] = await listVersions("d_a");
    expect(only).not.toHaveProperty("label");
  });

  it("only keeps the saved versions of designs that are in the backup", async () => {
    const a = poster({ id: "d_a" });
    await saveDesign(a);
    await saveVersion(a, "kept");
    await saveVersion(poster({ id: "d_never_saved" }), "orphan");
    const { counts } = await createBackup({ now: NOW });
    expect(counts.versions).toBe(1);
  });

  it("reports what it is doing: reading the library, then packing the file", async () => {
    await seed();
    const events: BackupProgress[] = [];
    await createBackup({ now: NOW, onProgress: (p) => events.push(p) });
    const collecting = events.filter((e) => e.phase === "collecting");
    const packing = events.filter((e) => e.phase === "packing");
    expect(collecting.map((e) => e.done)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(collecting.map((e) => e.total))).toEqual(new Set([7]));
    expect(packing.at(-1)).toEqual({ phase: "packing", done: 10, total: 10 });
    expect(events.indexOf(packing[0])).toBeGreaterThan(events.indexOf(collecting.at(-1)!));
  });

  it("stops when it is cancelled, while reading or while packing", async () => {
    await seed();
    const early = new AbortController();
    early.abort();
    await expect(createBackup({ signal: early.signal })).rejects.toMatchObject({ name: "BackupError", code: "cancelled" });

    const reading = new AbortController();
    await expect(createBackup({ signal: reading.signal, onProgress: (p) => p.phase === "collecting" && p.done === 2 && reading.abort() })).rejects.toMatchObject({
      code: "cancelled",
    });

    const packing = new AbortController();
    await expect(createBackup({ signal: packing.signal, onProgress: (p) => p.phase === "packing" && p.done === 1 && packing.abort() })).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("refuses a library with more files than one archive can list", async () => {
    await seed();
    await expect(createBackup({ maxEntries: 9 })).rejects.toMatchObject({ code: "too-large" });
    await expect(createBackup({ maxEntries: 10 })).resolves.toMatchObject({ counts: { designs: 2 } });
  });

  it("refuses a library that would not fit in one file, before packing anything", async () => {
    await seed();
    const events: BackupProgress[] = [];
    const error = await createBackup({ maxBytes: 100, onProgress: (p) => events.push(p) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    expect((error as BackupError).code).toBe("too-large");
    expect(events.some((e) => e.phase === "packing")).toBe(false);
  });
});

describe("inspectBackup", () => {
  it("says what a backup holds and what restoring it would do here", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const found = await inspectBackup(blob);
    expect(found.exportedAt).toBe(NOW.toISOString());
    expect(found.counts).toEqual({ designs: 2, trashed: 1, folders: 1, uploads: 2, versions: 2 });
    expect(found.skipped).toBe(0);
    expect(found.plan).toMatchObject({
      designs: { add: 3, same: 0, copy: 0 },
      uploads: { add: 2 },
      folders: { add: 1 },
      versions: { add: 2 },
      brandKit: "restore",
      nothingNew: false,
    });
  });

  it("finds nothing new once everything has been restored, and a copy where a design changed", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    expect((await inspectBackup(blob)).plan.nothingNew).toBe(true);
    await saveDesign(poster({ id: "d_poster", title: "Edited since", updatedAt: 9999 }));
    const { plan } = await inspectBackup(blob);
    expect(plan.designs).toEqual({ add: 0, same: 2, copy: 1 });
    expect(plan.nothingNew).toBe(false);
  });

  it("says the file is not a backup when it is not a ZIP, or a ZIP without our manifest", async () => {
    for (const file of [
      new Blob(["hello"]),
      new Blob([]),
      new Blob([zipSync([{ name: "photo.png", data: enc.encode("x") }]) as BlobPart]),
      new Blob([zipSync([{ name: BACKUP_MANIFEST_NAME, data: enc.encode("{}") }]) as BlobPart]),
    ]) {
      await expect(inspectBackup(file)).rejects.toMatchObject({ name: "BackupError", code: "not-a-backup" });
    }
  });

  it("says a backup from a newer Craftly needs a newer Craftly", async () => {
    const file = new Blob([zipSync([{ name: BACKUP_MANIFEST_NAME, data: enc.encode('{"craftlyBackup":2}') }]) as BlobPart]);
    await expect(inspectBackup(file)).rejects.toMatchObject({ code: "newer" });
  });

  it("says a backup whose manifest was damaged is damaged", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await expect(inspectBackup(await corrupt(blob, BACKUP_MANIFEST_NAME))).rejects.toMatchObject({ code: "damaged" });
  });

  it("reads a backup that was unzipped and zipped again by another tool", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    const again = await rezip(blob);
    expect((await inspectBackup(again)).counts).toEqual({ designs: 2, trashed: 1, folders: 1, uploads: 2, versions: 2 });
  });

  it("passes on a failure to read the file that is not about the backup being wrong", async () => {
    const unreadable = {
      size: 100,
      slice: () => {
        throw new TypeError("could not read");
      },
    } as unknown as Blob;
    await expect(inspectBackup(unreadable)).rejects.toThrow("could not read");
  });

  it("says what it cannot open", async () => {
    const encrypted = new Blob([(await buildZip([{ name: BACKUP_MANIFEST_NAME, data: enc.encode("{}"), flags: 1 }])) as BlobPart]);
    await expect(inspectBackup(encrypted)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("stops when it is cancelled", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    const stop = new AbortController();
    stop.abort();
    await expect(inspectBackup(blob, { signal: stop.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("createBackup and a library with a design from a newer release", () => {
  it("copies that design exactly as it is stored, instead of failing: a backup is no place to lose what an older tab cannot read", async () => {
    await seed();
    const original = poster({ id: "d_future", title: "From the future" });
    const future = { ...original, version: CURRENT_DESIGN_VERSION + 1, somethingNew: { nested: [1, 2, 3] } };
    await dbPut("designs", future);
    await dbPut("summaries", { ...summarize(original), schema: CURRENT_DESIGN_VERSION + 1 });
    const { blob, counts } = await createBackup({ now: NOW });
    expect(counts.designs).toBe(3);
    const archive = await openZip(blob);
    expect(JSON.parse(await archive.text(archive.find("designs/d_future.json")!))).toEqual(future);
  });
});

describe("restoreBackup", () => {
  it("brings everything back into an empty library, as it was", async () => {
    const { folder, a } = await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();

    const result = await restoreBackup(blob);
    expect(result).toEqual({
      designs: { added: 3, copied: 0, same: 0, damaged: 0 },
      uploads: { added: 2, same: 0, damaged: 0 },
      folders: { added: 1 },
      versions: { added: 2, damaged: 0 },
      brandKit: "restore",
      skipped: 0,
      newer: 0,
    });

    expect((await listDesigns()).map((d) => d.id).sort()).toEqual(["d_old", "d_plain", "d_poster"]);
    expect(await getDesign("d_poster")).toEqual(a);
    expect(await getSummary("d_poster")).toMatchObject({
      title: "Poster",
      folderId: folder.id,
      starred: true,
      trashedAt: null,
      updatedAt: 2000,
      pageCount: 1,
      thumbnail: jpeg("thumb-a"),
    });
    expect(await getSummary("d_plain")).toMatchObject({ thumbnail: jpeg("thumb-c") });
    expect(await getSummary("d_old")).toMatchObject({ title: "Old idea", trashedAt: 3000, starred: false });
    expect((await getSummary("d_old"))?.thumbnail).toBeUndefined();
    expect(await listFolders()).toEqual([folder]);

    const logo = (await getAsset("a_logo"))!;
    expect(logo).toMatchObject({ id: "a_logo", name: "Logo", kind: "image", mime: "image/png", size: 9, width: 64, height: 32, createdAt: 5 });
    expect(logo.blob.type).toBe("image/png");
    expect(await textOf(logo.blob)).toBe("PNG-BYTES");
    expect((await getAsset("a_unused"))!.kind).toBe("svg");
    expect((await listAssets()).map((x) => x.id).sort()).toEqual(["a_logo", "a_unused"]);

    expect((await listVersions("d_poster")).map((v) => v.label)).toEqual(["second", "first"]);
    const [newest] = await listVersions("d_poster");
    expect((await getVersion(newest.id))?.design.title).toBe("Poster, second try");
    expect(await getStoredBrandKit()).toEqual({ colors: ["#111111"], fonts: ["Lora"], logos: ["a_logo"] });
  });

  it("can be done again: the second time finds everything already here and changes nothing", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    await restoreBackup(blob);
    vi.mocked(restoreRecords).mockClear();

    const again = await restoreBackup(blob);
    expect(again).toEqual({
      designs: { added: 0, copied: 0, same: 3, damaged: 0 },
      uploads: { added: 0, same: 2, damaged: 0 },
      folders: { added: 0 },
      versions: { added: 0, damaged: 0 },
      brandKit: "none",
      skipped: 0,
      newer: 0,
    });
    expect(restoreRecords).not.toHaveBeenCalled();
    expect(await listDesigns()).toHaveLength(3);
    expect(await listFolders()).toHaveLength(1);
    expect(await listAssets()).toHaveLength(2);
  });

  it("never replaces anything: a design edited since the backup comes back as a copy next to it", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await saveDesign(poster({ id: "d_poster", title: "Poster v2", updatedAt: 9999 }));

    const result = await restoreBackup(blob);
    expect(result.designs).toEqual({ added: 0, copied: 1, same: 2, damaged: 0 });
    expect(result.versions.added).toBe(0);

    const all = await listDesigns();
    expect(all).toHaveLength(4);
    expect((await getDesign("d_poster"))?.title).toBe("Poster v2");
    const copy = all.find((d) => d.title === "Poster (restored)")!;
    expect(copy.id).not.toBe("d_poster");
    expect(copy.updatedAt).toBe(2000);
    expect((await getDesign(copy.id))?.id).toBe(copy.id);
    expect(await listVersions(copy.id)).toEqual([]);
    expect(await listVersions("d_poster")).toHaveLength(2);
  });

  it("gives a design its folder back only when that folder comes back too", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    await restoreBackup(await withManifest(blob, (m) => (m.folders = [])));
    expect((await getSummary("d_poster"))?.folderId).toBeNull();
    expect((await getDesign("d_poster"))?.folderId).toBeNull();
    expect(await listFolders()).toEqual([]);
  });

  it("restores a design under the id the manifest gives it", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const changed = await rebuild(blob, (entries) =>
      entries.map((e) =>
        e.name === "designs/d_plain.json" ? { name: e.name, data: enc.encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(e.data)), id: "d_other" })) } : e,
      ),
    );
    await restoreBackup(changed);
    expect((await getDesign("d_plain"))?.id).toBe("d_plain");
    expect(await getDesign("d_other")).toBeNull();
  });

  it("carries on past a design that is damaged, and counts it", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const result = await restoreBackup(await corrupt(blob, "designs/d_plain.json"));
    expect(result.designs).toEqual({ added: 2, copied: 0, same: 0, damaged: 1 });
    expect(await getDesign("d_plain")).toBeNull();
    expect((await listDesigns()).map((d) => d.id).sort()).toEqual(["d_old", "d_poster"]);
  });

  it("counts a design whose file is missing from the archive, or is not a design, as damaged", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const broken = await rebuild(blob, (entries) =>
      entries.filter((e) => e.name !== "designs/d_old.json").map((e) => (e.name === "designs/d_plain.json" ? { name: e.name, data: enc.encode('{"title":"no pages"}') } : e)),
    );
    const result = await restoreBackup(broken);
    expect(result.designs).toEqual({ added: 1, copied: 0, same: 0, damaged: 2 });
  });

  it("carries on past a picture that is damaged; the design that uses it still comes back", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const result = await restoreBackup(await corrupt(blob, "uploads/a_logo.png"));
    expect(result.uploads).toEqual({ added: 1, same: 0, damaged: 1 });
    expect(await getAsset("a_logo")).toBeNull();
    expect(await getDesign("d_poster")).not.toBeNull();
  });

  it("does not store a file that the backup calls something other than a picture, and says that it left one out", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const crafted = await withManifest(blob, (manifest) => {
      const uploads = manifest.uploads as Array<{ id: string; mime: string }>;
      uploads.find((u) => u.id === "a_logo")!.mime = "text/html";
    });
    expect((await inspectBackup(crafted)).skipped).toBe(1);
    const result = await restoreBackup(crafted);
    expect(result.skipped).toBe(1);
    expect(result.uploads).toEqual({ added: 1, same: 0, damaged: 0 });
    expect(await getAsset("a_logo")).toBeNull();
    expect((await listAssets()).map((a) => a.id)).toEqual(["a_unused"]);
  });

  it("does not store an SVG that is more than plain drawing as an SVG: one that cannot be drawn as a picture is left out and counted", async () => {
    await seed();
    await putUpload("a_unused", "image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><script>alert(document.domain)</script></svg>`);
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    // (there is no image element and no canvas in this test, so nothing can be drawn; src/core/assets.dom.test.ts draws one)
    const result = await restoreBackup(blob);
    expect(result.uploads).toEqual({ added: 1, same: 0, damaged: 1 });
    expect((await listAssets()).map((a) => a.id)).toEqual(["a_logo"]);
  });

  it("stores what an upload turned out to be, not what the backup calls it", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const drawn = { blob: new Blob(["PNG"], { type: "image/png" }), kind: "image" as const, mime: "image/png", drawn: { width: 1024, height: 683 } };
    const check = vi.spyOn(assets, "checkUpload").mockImplementation(async (given) => (given.type === "image/svg+xml" ? drawn : { blob: given, kind: "image", mime: given.type }));
    const result = await restoreBackup(blob);
    check.mockRestore();
    expect(result.uploads).toEqual({ added: 2, same: 0, damaged: 0 });
    expect(await getAsset("a_unused")).toMatchObject({ name: "Doodle", kind: "image", mime: "image/png", size: 3, width: 1024, height: 683 });
    expect(await getAsset("a_logo")).toMatchObject({ kind: "image", mime: "image/png", width: 64, height: 32 });
  });

  it("does not bring back the history of a design that could not be restored", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const result = await restoreBackup(await corrupt(blob, "designs/d_poster.json"));
    expect(result.versions.added).toBe(0);
    expect(await listVersions("d_poster")).toEqual([]);
  });

  it("counts a saved version that is damaged and keeps the others", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const result = await restoreBackup(await corrupt(blob, "versions/d_poster/0.json"));
    expect(result.versions).toEqual({ added: 1, damaged: 1 });
  });

  it("counts a design that a newer release made apart from the damaged ones, and restores the rest", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const newer = await rebuild(blob, (entries) =>
      entries.map((e) =>
        e.name === "designs/d_plain.json"
          ? { name: e.name, data: enc.encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(e.data)), version: CURRENT_DESIGN_VERSION + 1 })) }
          : e,
      ),
    );
    const result = await restoreBackup(newer);
    expect(result.newer).toBe(1);
    expect(result.designs).toEqual({ added: 2, copied: 0, same: 0, damaged: 0 });
    expect(await getDesign("d_plain")).toBeNull();
    expect((await listDesigns()).map((d) => d.id).sort()).toEqual(["d_old", "d_poster"]);
  });

  it("counts a saved version that a newer release made the same way, and keeps the others", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const newer = await rebuild(blob, (entries) =>
      entries.map((e) => {
        if (e.name !== "versions/d_poster/0.json") return e;
        const record = JSON.parse(new TextDecoder().decode(e.data));
        return { name: e.name, data: enc.encode(JSON.stringify({ ...record, design: { ...record.design, version: CURRENT_DESIGN_VERSION + 1 } })) };
      }),
    );
    const result = await restoreBackup(newer);
    expect(result.newer).toBe(1);
    expect(result.versions).toEqual({ added: 1, damaged: 0 });
  });

  it("counts what the manifest listed with an id that cannot be used", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const result = await restoreBackup(await withManifest(blob, (m) => (m.designs as unknown[]).push({ id: "../escape", file: "designs/x.json" })));
    expect(result.skipped).toBe(1);
    expect(result.designs.added).toBe(3);
  });

  it("merges the brand kit into one that was customised here, and takes it as it is otherwise", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    await setBrandKit({ colors: ["#999999"], fonts: ["Inter"], logos: [] });
    const result = await restoreBackup(blob);
    expect(result.brandKit).toBe("merge");
    expect(await getStoredBrandKit()).toEqual({ colors: ["#999999", "#111111"], fonts: ["Inter", "Lora"], logos: ["a_logo"] });
  });

  it("reports progress, one step for each upload, design and version it handles", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const events: Array<{ done: number; total: number }> = [];
    await restoreBackup(blob, { onProgress: (p) => events.push(p) });
    expect(events.map((e) => e.done)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(events.map((e) => e.total))).toEqual(new Set([7]));
  });

  it("stops when it is cancelled, and keeps what it had already restored", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const stop = new AbortController();
    await expect(restoreBackup(blob, { signal: stop.signal, onProgress: (p) => p.done === 2 && stop.abort() })).rejects.toMatchObject({ name: "BackupError", code: "cancelled" });
    expect(await listAssets()).toHaveLength(2);
    expect(await listDesigns()).toEqual([]);

    const early = new AbortController();
    early.abort();
    await expect(restoreBackup(blob, { signal: early.signal })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("stops at the next upload, the next design or the next version, wherever it is cancelled", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    // handled in this order: upload 1, upload 2, design 3, 4, 5, version 6, 7
    for (const [stopAt, kept] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [6, 6],
    ] as const) {
      await wipeDatabase();
      const stop = new AbortController();
      await expect(restoreBackup(blob, { signal: stop.signal, onProgress: (p) => p.done === stopAt && stop.abort() }), "at " + stopAt).rejects.toMatchObject({ code: "cancelled" });
      const here = (await listAssets()).length + (await listDesigns()).length + (await listVersions("d_poster")).length;
      expect(here, "kept after stopping at " + stopAt).toBe(kept);
    }
  });

  it("passes on a failure to read the backup file that is not about the backup being wrong", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    let slices = 0;
    const flaky = new Proxy(blob, {
      get(target, property) {
        if (property === "slice") {
          return (...args: Parameters<Blob["slice"]>) => {
            slices += 1;
            // the file list and the manifest are read first; the file goes bad after them
            return slices <= 4 ? target.slice(...args) : { arrayBuffer: () => Promise.reject(new DOMException("The file is gone", "NotReadableError")) };
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(restoreBackup(flaky)).rejects.toMatchObject({ name: "NotReadableError" });
  });

  it("works through a big library in batches", async () => {
    for (let i = 0; i < 26; i++) await putUpload(`a_${i}`, "image/png", `PNG ${i}`, { createdAt: i });
    for (let i = 0; i < 21; i++) await saveDesign(poster({ id: `d_${i}`, updatedAt: 5000 + i }));
    const many = poster({ id: "d_many" });
    await saveDesign(many);
    for (let i = 1; i <= 21; i++) {
      vi.setSystemTime(i * 1000);
      await saveVersion(many, `v${i}`);
    }
    const { blob, counts } = await createBackup({ now: NOW });
    expect(counts).toMatchObject({ designs: 22, uploads: 26, versions: 21 });
    await wipeDatabase();
    vi.mocked(restoreRecords).mockClear();
    let heard = 0;
    const stop = subscribeAssets(() => (heard += 1));

    const result = await restoreBackup(blob);
    stop();
    expect(result).toMatchObject({ designs: { added: 22 }, uploads: { added: 26 }, versions: { added: 21 } });
    expect(heard).toBe(2); // 25 uploads, then the last one
    const calls = vi.mocked(restoreRecords).mock.calls.map(([records]) => Object.keys(records)[0]);
    expect(calls.filter((c) => c === "designs")).toHaveLength(2); // 20 designs, then 2
    expect(calls.filter((c) => c === "versions")).toHaveLength(2); // 20 versions, then 1
    expect(await listDesigns()).toHaveLength(22);
    expect(await listVersions("d_many")).toHaveLength(21);
  });

  it("restores a backup that was unzipped and zipped again by another tool", async () => {
    const { a } = await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const result = await restoreBackup(await rezip(blob));
    expect(result.designs.added).toBe(3);
    expect(await getDesign("d_poster")).toEqual(a);
    expect(await textOf((await getAsset("a_logo"))!.blob)).toBe("PNG-BYTES");
  });

  it("says the browser is out of room when the storage is full, and passes any other failure on", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    vi.mocked(restoreRecords).mockRejectedValueOnce(Object.assign(new Error("full"), { name: "QuotaExceededError" }));
    await expect(restoreBackup(blob)).rejects.toMatchObject({ name: "BackupError", code: "storage" });

    const other = new Error("something else");
    vi.mocked(restoreRecords).mockRejectedValueOnce(other);
    await expect(restoreBackup(blob)).rejects.toBe(other);
  });

  it("says the browser is out of room when a picture does not fit, which the browser reports on the write and not on the transaction", async () => {
    await seed();
    const { blob } = await createBackup({ now: NOW });
    await wipeDatabase();
    const full = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const real = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
      const [stores, mode] = args;
      if (mode !== "readwrite" || ![stores].flat().includes("assets")) return real.apply(this, args);
      // a transaction on the uploads whose write fails: it has no error of its own, the failed write has
      const tx = { error: null, objectStore: () => ({ put: () => undefined }) } as unknown as IDBTransaction;
      queueMicrotask(() => {
        tx.onerror?.call(tx, { target: { error: full } } as unknown as Event);
        tx.onabort?.call(tx, new Event("abort"));
      });
      return tx;
    });
    try {
      await expect(restoreBackup(blob)).rejects.toMatchObject({ name: "BackupError", code: "storage" });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the time of the last backup", () => {
  it("is not known until a backup was made, then it is remembered", async () => {
    expect(await getLastBackupAt()).toBeNull();
    await markBackedUp(1234);
    expect(await getLastBackupAt()).toBe(1234);
    await markBackedUp();
    expect(await getLastBackupAt()).toBe(NOW.getTime());
  });
});

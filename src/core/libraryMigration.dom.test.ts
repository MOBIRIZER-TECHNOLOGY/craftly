/**
 * How the library treats designs that were stored by another version of Craftly. The real design format is still at its
 * first version, so the format is replaced here by one at version 3 with two steps (a language is added, then a subtitle):
 * what is stored at version 1 is old, what is stored at version 4 comes from a newer release.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wipeDatabase } from "@/test/logicDb";
import { createDesign, createPage, createText } from "./factory";
import {
  duplicateDesign,
  getDesign,
  getStoredDesign,
  getSummary,
  getVersion,
  listVersions,
  moveToFolder,
  moveToTrash,
  renameDesign,
  restoreFromTrash,
  restoreRecords,
  saveDesign,
  setStarred,
  summarize,
  type VersionRecord,
} from "./library";
import { dbDelete, dbGet, dbPut } from "./persistence";
import { MigrationError } from "./schema/migrator";
import type { Design } from "./types";

vi.mock("./schema/design", async () => {
  const { createMigrator } = await import("./schema/migrator");
  const steps = [
    { from: 1, about: "adds a language", up: (doc: Record<string, unknown>) => ({ ...doc, language: "en" }) },
    {
      from: 2,
      about: "adds a subtitle",
      up: (doc: Record<string, unknown>) => {
        if (doc.explode) throw new Error("boom");
        return { ...doc, subtitle: "" };
      },
    },
  ];
  const migrator = createMigrator({ kind: "design", field: "version", current: 3, steps, assume: 1 });
  return {
    CURRENT_DESIGN_VERSION: 3,
    DESIGN_MIGRATIONS: steps,
    migrateDesign: (raw: unknown) => {
      const { doc, from, migrated } = migrator.migrate(raw);
      return { design: doc, from, migrated };
    },
  };
});

beforeEach(async () => {
  await wipeDatabase();
});

/** A design as a release of another version stored it, with its dashboard record. `legacy`: the record has no `schema` (an older release). */
async function store(version: number, extra: Record<string, unknown> = {}, legacy = false): Promise<Design> {
  const page = createPage({ elements: [createText({ text: "Hello" })] });
  const design = { ...createDesign({ title: "Stored", width: 400, height: 300, pages: [page] }), version, ...extra } as Design;
  const { schema: _schema, ...record } = summarize(design);
  await dbPut("designs", design);
  await dbPut("summaries", legacy ? record : { ...record, schema: version });
  return design;
}

async function failureOf(promise: Promise<unknown>): Promise<MigrationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationError);
    return error as MigrationError;
  }
  throw new Error("expected a MigrationError");
}

describe("a new design", () => {
  it("is made at the current version, and its dashboard record says so", async () => {
    const design = createDesign({ width: 10, height: 10 });
    expect(design.version).toBe(3);
    expect(summarize(design).schema).toBe(3);
  });
});

describe("opening a stored design", () => {
  it("brings an older one up to date in memory and leaves what is stored alone", async () => {
    const old = await store(1, { id: "d_old" });
    const opened = (await getDesign("d_old"))! as Design & { language?: string; subtitle?: string };
    expect(opened.version).toBe(3);
    expect(opened.language).toBe("en");
    expect(opened.subtitle).toBe("");
    expect(opened.title).toBe("Stored");
    expect(await dbGet("designs", "d_old")).toEqual(old);
  });

  it("hands back one that is current as it is", async () => {
    await store(3, { id: "d_now" });
    expect((await getDesign("d_now"))!.version).toBe(3);
  });

  it("refuses one that a newer release stored, and changes nothing", async () => {
    const future = await store(4, { id: "d_future", fromTheFuture: { anything: true } });
    const error = await failureOf(getDesign("d_future"));
    expect(error).toMatchObject({ code: "newer", found: 4, current: 3 });
    expect(await dbGet("designs", "d_future")).toEqual(future);
  });

  it("says when a step cannot bring it up to date, and changes nothing", async () => {
    const broken = await store(2, { id: "d_broken", explode: true });
    expect(await failureOf(getDesign("d_broken"))).toMatchObject({ code: "failed", step: 2 });
    expect(await dbGet("designs", "d_broken")).toEqual(broken);
  });

  it("has no design for an id that is not stored", async () => {
    expect(await getDesign("d_missing")).toBeNull();
    expect(await getStoredDesign("d_missing")).toBeNull();
  });

  it("can give a design exactly as stored, whatever version it is", async () => {
    const future = await store(4, { id: "d_future" });
    const old = await store(1, { id: "d_old" });
    expect(await getStoredDesign("d_future")).toEqual(future);
    expect(await getStoredDesign("d_old")).toEqual(old);
  });
});

describe("renaming, starring, moving and trashing", () => {
  it.each([1, 3, 4])("work on a design of version %i without touching what else is in it", async (version) => {
    const before = await store(version, { id: "d_x", fromAnotherRelease: { keep: [1, 2, 3] } });
    await renameDesign("d_x", "New name");
    await setStarred("d_x", true);
    await moveToFolder("d_x", "f_1");
    await moveToTrash("d_x");
    const trashed = (await getStoredDesign("d_x"))!;
    expect(trashed).toMatchObject({ title: "New name", starred: true, folderId: "f_1", version, fromAnotherRelease: { keep: [1, 2, 3] } });
    expect(trashed.trashedAt).toBeTypeOf("number");
    await restoreFromTrash("d_x");
    expect(await getStoredDesign("d_x")).toEqual({ ...before, title: "New name", starred: true, folderId: "f_1", trashedAt: null });
    // the dashboard record follows, and still says which version the design is
    expect(await getSummary("d_x")).toMatchObject({ title: "New name", starred: true, folderId: "f_1", trashedAt: null, schema: version });
  });
});

describe("saving", () => {
  it("writes the design and a dashboard record that says which version it is", async () => {
    const design = createDesign({ width: 10, height: 10 });
    await saveDesign(design);
    expect(await getSummary(design.id)).toMatchObject({ schema: 3 });
  });

  it("refuses to write over a design that a newer release stored, and leaves it as it is", async () => {
    const future = await store(4, { id: "d_future" });
    const mine = { ...createDesign({ title: "Mine", width: 10, height: 10 }), id: "d_future" };
    const error = await failureOf(saveDesign(mine));
    expect(error).toMatchObject({ code: "newer", found: 4, current: 3 });
    expect(await dbGet("designs", "d_future")).toEqual(future);
    expect((await getSummary("d_future"))!.schema).toBe(4);
  });

  it("keeps the original in the version history when this save is the first to upgrade it, and only then", async () => {
    const old = await store(1, { id: "d_old" }, true);
    const opened = (await getDesign("d_old"))!;
    await saveDesign(opened);
    const versions = await listVersions("d_old");
    expect(versions).toHaveLength(1);
    expect(versions[0].label).toBe("Before the update");
    expect(((await dbGet("versions", versions[0].id)) as VersionRecord).design).toEqual(old);
    expect(await getStoredDesign("d_old")).toMatchObject({ version: 3 });
    expect((await getSummary("d_old"))!.schema).toBe(3);
    await saveDesign({ ...opened, title: "Edited" });
    expect(await listVersions("d_old")).toHaveLength(1);
  });

  it("keeps nothing for a design that is new, or that was stored at the current version", async () => {
    await saveDesign({ ...createDesign({ width: 10, height: 10 }), id: "d_new" });
    await store(3, { id: "d_now" });
    await saveDesign((await getDesign("d_now"))!);
    expect(await listVersions("d_new")).toHaveLength(0);
    expect(await listVersions("d_now")).toHaveLength(0);
  });
});

describe("a dashboard record whose design is not there", () => {
  it("is saved over without a copy to keep, and without an error", async () => {
    const old = await store(1, { id: "d_gone" }, true);
    await dbDelete("designs", "d_gone");
    const upgraded = { ...old, version: 3 } as Design;
    await expect(saveDesign(upgraded)).resolves.toBeUndefined();
    expect(await listVersions("d_gone")).toHaveLength(0);
    expect(await getStoredDesign("d_gone")).toMatchObject({ version: 3 });
  });
});

describe("copying a design", () => {
  it("makes the copy at the current version", async () => {
    await store(1, { id: "d_old" });
    const copy = (await duplicateDesign("d_old"))!;
    expect(copy.version).toBe(3);
    expect((await getSummary(copy.id))!.schema).toBe(3);
  });

  it("is refused for a design that a newer release stored", async () => {
    await store(4, { id: "d_future" });
    expect(await failureOf(duplicateDesign("d_future"))).toMatchObject({ code: "newer" });
  });
});

describe("saved versions", () => {
  const record = (design: unknown): VersionRecord => ({ id: "d_v:1", designId: "d_v", createdAt: 5, label: "Saved by you", design: design as Design });

  it("come back at the current version, whatever version they were saved at", async () => {
    const old = { ...createDesign({ title: "Old", width: 10, height: 10 }), version: 1 };
    await dbPut("versions", record(old));
    const version = (await getVersion("d_v:1"))!;
    expect(version.design.version).toBe(3);
    expect(version.design.title).toBe("Old");
    expect(version).toMatchObject({ id: "d_v:1", designId: "d_v", label: "Saved by you" });
  });

  it("are not offered when a newer release saved them, or when they cannot be read", async () => {
    await dbPut("versions", record({ ...createDesign({ width: 10, height: 10 }), version: 4 }));
    expect(await getVersion("d_v:1")).toBeNull();
    await dbPut("versions", record("not a design"));
    expect(await getVersion("d_v:1")).toBeNull();
    expect(await getVersion("missing")).toBeNull();
  });
});

describe("restoring records from a backup", () => {
  it("writes a dashboard record that says which version each design is", async () => {
    const design = createDesign({ title: "Back", width: 10, height: 10 });
    await restoreRecords({ designs: [{ design }] });
    expect(await getSummary(design.id)).toMatchObject({ schema: 3 });
  });
});

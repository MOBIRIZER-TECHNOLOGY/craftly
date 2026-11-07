import { beforeEach, describe, expect, it, vi } from "vitest";
import { wipeDatabase } from "@/test/logicDb";
import { createDesign, createGroup, createPage, createShape, createText } from "./factory";
import {
  createBlankDesign,
  createDesignFromPages,
  createFolder,
  deleteFolder,
  deleteForever,
  duplicateDesign,
  emptyTrash,
  getBrandKit,
  getDesign,
  getRecentColors,
  getSummary,
  getVersion,
  listDesigns,
  listFolders,
  listVersions,
  moveToFolder,
  moveToTrash,
  pushRecentColor,
  renameDesign,
  renameFolder,
  restoreFromTrash,
  saveDesign,
  saveVersion,
  setBrandKit,
  setStarred,
  subscribeLibrary,
  summarize,
  updateSummary,
} from "./library";
import type { Design } from "./types";

let serial = 0;
/** a design with a distinct title and update time */
function make(over: Partial<Design> = {}): Design {
  serial++;
  const design = createDesign({ title: `Design ${serial}`, width: 800, height: 600, pages: [createPage({ elements: [createText({ text: "Hello" })] })] });
  return { ...design, updatedAt: 1000 + serial, createdAt: 500 + serial, ...over };
}

beforeEach(async () => {
  await wipeDatabase();
});

describe("summaries", () => {
  it("describes a design without its pages", () => {
    const design = make({ title: "Poster", typeId: "poster", starred: true, folderId: "f1", trashedAt: 99 });
    expect(summarize(design)).toEqual({
      id: design.id,
      title: "Poster",
      typeId: "poster",
      width: 800,
      height: 600,
      pageCount: 1,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt,
      folderId: "f1",
      starred: true,
      trashedAt: 99,
      thumbnail: undefined,
    });
  });

  it("takes the thumbnail it is given before the one it had", () => {
    const design = make();
    const previous = { ...summarize(design), thumbnail: "old" };
    expect(summarize(design, "new", previous).thumbnail).toBe("new");
    expect(summarize(design, undefined, previous).thumbnail).toBe("old");
    expect(summarize(design).thumbnail).toBeUndefined();
  });
});

describe("saving and listing designs", () => {
  it("stores the design and its summary and finds them again", async () => {
    const design = make({ title: "Saved" });
    await saveDesign(design, "data:image/jpeg;base64,AAA");
    expect(await getDesign(design.id)).toEqual(design);
    expect(await getSummary(design.id)).toMatchObject({ id: design.id, title: "Saved", pageCount: 1, thumbnail: "data:image/jpeg;base64,AAA" });
  });

  it("answers null for a design that is not there", async () => {
    expect(await getDesign("nope")).toBeNull();
    expect(await getSummary("nope")).toBeNull();
  });

  it("keeps the old thumbnail when a save brings none, and replaces it when it brings one", async () => {
    const design = make();
    await saveDesign(design, "first");
    await saveDesign({ ...design, title: "Edited" });
    expect(await getSummary(design.id)).toMatchObject({ title: "Edited", thumbnail: "first" });
    await saveDesign(design, "second");
    expect((await getSummary(design.id))?.thumbnail).toBe("second");
  });

  it("lists the newest design first", async () => {
    const old = make({ updatedAt: 100 });
    const recent = make({ updatedAt: 300 });
    const middle = make({ updatedAt: 200 });
    for (const d of [old, recent, middle]) await saveDesign(d);
    expect((await listDesigns()).map((s) => s.id)).toEqual([recent.id, middle.id, old.id]);
  });

  it("lists nothing when there is nothing", async () => {
    expect(await listDesigns()).toEqual([]);
  });

  it("tells subscribers about every change, until they unsubscribe", async () => {
    const heard = vi.fn();
    const stop = subscribeLibrary(heard);
    const design = make();
    await saveDesign(design);
    expect(heard).toHaveBeenCalledTimes(1);
    await setStarred(design.id, true);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    await setStarred(design.id, false);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("changing a design's library data", () => {
  it("renames, stars, moves and trashes a design, in the document and in its summary", async () => {
    const design = make();
    await saveDesign(design);
    await renameDesign(design.id, "  Fresh name  ");
    await setStarred(design.id, true);
    await moveToFolder(design.id, "folder-1");
    await moveToTrash(design.id);
    const stored = await getDesign(design.id);
    const summary = await getSummary(design.id);
    expect(stored).toMatchObject({ title: "Fresh name", starred: true, folderId: "folder-1" });
    expect(stored?.trashedAt).toBeGreaterThan(0);
    expect(summary).toMatchObject({ title: "Fresh name", starred: true, folderId: "folder-1" });
    expect(summary?.trashedAt).toBe(stored?.trashedAt);
  });

  it("gives a design with a blank name the default one", async () => {
    const design = make();
    await saveDesign(design);
    await renameDesign(design.id, "   ");
    expect((await getDesign(design.id))?.title).toBe("Untitled design");
  });

  it("takes a design out of its folder and out of the trash again", async () => {
    const design = make({ folderId: "folder-1", trashedAt: 5 });
    await saveDesign(design);
    await moveToFolder(design.id, null);
    await restoreFromTrash(design.id);
    expect(await getDesign(design.id)).toMatchObject({ folderId: null, trashedAt: null });
    expect(await getSummary(design.id)).toMatchObject({ folderId: null, trashedAt: null });
  });

  it("puts other summary fields in the summary only", async () => {
    const design = make();
    await saveDesign(design);
    await updateSummary(design.id, { thumbnail: "thumb" });
    expect((await getSummary(design.id))?.thumbnail).toBe("thumb");
    expect(await getDesign(design.id)).toEqual(design);
  });

  it("ignores a design that is not there", async () => {
    const heard = vi.fn();
    const stop = subscribeLibrary(heard);
    await updateSummary("nope", { title: "x" });
    await renameDesign("nope", "x");
    stop();
    expect(await listDesigns()).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it("does nothing when the summary is missing but the document is not", async () => {
    const design = make();
    await saveDesign(design);
    const { dbDelete } = await import("./persistence");
    await dbDelete("summaries", design.id);
    await updateSummary(design.id, { title: "changed" });
    expect((await getDesign(design.id))?.title).toBe(design.title);
  });
});

describe("deleting", () => {
  it("removes a design for good along with its saved versions, and only those", async () => {
    const keep = make();
    const gone = make();
    await saveDesign(keep);
    await saveDesign(gone);
    await saveVersion(keep, "keep me");
    await saveVersion(gone, "lose me");
    const heard = vi.fn();
    const stop = subscribeLibrary(heard);
    await deleteForever(gone.id);
    stop();
    expect(await getDesign(gone.id)).toBeNull();
    expect(await getSummary(gone.id)).toBeNull();
    expect(await listVersions(gone.id)).toEqual([]);
    expect(await listVersions(keep.id)).toHaveLength(1);
    expect(await getDesign(keep.id)).not.toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("empties the trash and nothing else", async () => {
    const trashed = make({ trashedAt: 10 });
    const alsoTrashed = make({ trashedAt: 20 });
    const live = make();
    for (const d of [trashed, alsoTrashed, live]) await saveDesign(d);
    await saveVersion(trashed);
    await emptyTrash();
    expect((await listDesigns()).map((s) => s.id)).toEqual([live.id]);
    expect(await listVersions(trashed.id)).toEqual([]);
  });

  it("empties an empty trash without fuss", async () => {
    await saveDesign(make());
    await emptyTrash();
    expect(await listDesigns()).toHaveLength(1);
  });
});

describe("duplicating", () => {
  it("copies a design with new ids all the way down and a name that says so", async () => {
    const group = createGroup([createShape("rect", { id: "inner" })], { id: "grp" });
    const source = make({ title: "Original", starred: true, trashedAt: 5, pages: [createPage({ id: "page-1", elements: [createShape("rect", { id: "el-1" }), group] })] });
    await saveDesign(source, "thumb");
    const copy = (await duplicateDesign(source.id))!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("Original (copy)");
    expect(copy.starred).toBe(false);
    expect(copy.trashedAt).toBeNull();
    expect(copy.pages[0].id).not.toBe("page-1");
    expect(copy.pages[0].elements[0].id).not.toBe("el-1");
    const nested = (copy.pages[0].elements[1] as typeof group).children[0];
    expect(nested.id).not.toBe("inner");
    expect(copy.createdAt).toBe(copy.updatedAt);
    expect(copy.createdAt).toBeGreaterThan(source.createdAt);
    expect(await getDesign(copy.id)).toEqual(copy);
    expect(await getSummary(copy.id)).toMatchObject({ title: "Original (copy)", thumbnail: "thumb", starred: false });
  });

  it("leaves the original as it was", async () => {
    const source = make();
    await saveDesign(source);
    await duplicateDesign(source.id);
    expect(await getDesign(source.id)).toEqual(source);
    expect(await listDesigns()).toHaveLength(2);
  });

  it("answers null for a design that is not there", async () => {
    expect(await duplicateDesign("nope")).toBeNull();
    expect(await listDesigns()).toEqual([]);
  });
});

describe("making designs", () => {
  it("starts a blank white design of the given size and keeps it", async () => {
    const design = await createBlankDesign({ typeId: "poster", width: 400, height: 500 });
    expect(design).toMatchObject({ typeId: "poster", width: 400, height: 500, unit: "px", folderId: null, title: "Untitled design" });
    expect(design.pages).toHaveLength(1);
    expect(design.pages[0].background).toEqual({ type: "solid", color: "#ffffff" });
    expect(await getDesign(design.id)).toEqual(design);
    expect(await getSummary(design.id)).toMatchObject({ typeId: "poster", pageCount: 1 });
  });

  it("takes title, unit, folder and background colour from the caller", async () => {
    const design = await createBlankDesign({ typeId: "card", width: 90, height: 55, title: "Business card", unit: "mm", folderId: "f1", background: "#112233" });
    expect(design).toMatchObject({ title: "Business card", unit: "mm", folderId: "f1" });
    expect(design.pages[0].background).toEqual({ type: "solid", color: "#112233" });
  });

  it("starts a design from template pages, giving everything new ids", async () => {
    const template = [createPage({ id: "tp1", elements: [createShape("rect", { id: "te1" })] }), createPage({ id: "tp2" })];
    const design = await createDesignFromPages({ typeId: "slides", width: 1920, height: 1080, title: "From a template", pages: template, folderId: "f2" });
    expect(design).toMatchObject({ title: "From a template", typeId: "slides", folderId: "f2" });
    expect(design.pages).toHaveLength(2);
    expect(design.pages.map((p) => p.id)).not.toContain("tp1");
    expect(design.pages[0].elements[0].id).not.toBe("te1");
    expect(template[0].id).toBe("tp1");
    expect(await getDesign(design.id)).toEqual(design);
    expect((await createDesignFromPages({ typeId: "slides", width: 10, height: 10, title: "No folder", pages: [] })).folderId).toBeNull();
  });
});

describe("folders", () => {
  it("creates a folder with a trimmed name, or a default one", async () => {
    const folder = await createFolder("  Work  ");
    expect(folder).toMatchObject({ name: "Work", parentId: null });
    expect(folder.id).toMatch(/^f_/);
    expect(folder.createdAt).toBeGreaterThan(0);
    expect((await createFolder("   ")).name).toBe("Untitled folder");
    expect((await createFolder("Child", folder.id)).parentId).toBe(folder.id);
  });

  it("lists folders by name", async () => {
    await createFolder("b folder");
    await createFolder("A folder");
    await createFolder("c folder");
    expect((await listFolders()).map((f) => f.name)).toEqual(["A folder", "b folder", "c folder"]);
  });

  it("renames a folder, keeping the old name when the new one is blank, and ignores unknown ones", async () => {
    const folder = await createFolder("Old");
    await renameFolder(folder.id, "  New  ");
    expect((await listFolders())[0].name).toBe("New");
    await renameFolder(folder.id, "   ");
    expect((await listFolders())[0].name).toBe("New");
    const heard = vi.fn();
    const stop = subscribeLibrary(heard);
    await renameFolder("nope", "x");
    stop();
    expect(heard).not.toHaveBeenCalled();
    expect(await listFolders()).toHaveLength(1);
  });

  it("moves the designs of a deleted folder back to the top level", async () => {
    const folder = await createFolder("Doomed");
    const inside = make({ folderId: folder.id });
    const elsewhere = make({ folderId: "other" });
    await saveDesign(inside);
    await saveDesign(elsewhere);
    await deleteFolder(folder.id);
    expect(await listFolders()).toEqual([]);
    expect((await getDesign(inside.id))?.folderId).toBeNull();
    expect((await getSummary(inside.id))?.folderId).toBeNull();
    expect((await getDesign(elsewhere.id))?.folderId).toBe("other");
  });
});

describe("brand kit and recent colours", () => {
  it("starts with the default brand kit", async () => {
    const kit = await getBrandKit();
    expect(kit.colors).toHaveLength(5);
    expect(kit.fonts).toEqual(["Plus Jakarta Sans", "Playfair Display"]);
    expect(kit.logos).toEqual([]);
  });

  it("saves the brand kit and tells subscribers", async () => {
    const heard = vi.fn();
    const stop = subscribeLibrary(heard);
    await setBrandKit({ colors: ["#123456"], fonts: ["Lora"], logos: ["a_1"] });
    stop();
    expect(await getBrandKit()).toEqual({ colors: ["#123456"], fonts: ["Lora"], logos: ["a_1"] });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("remembers recent colours, newest first, each only once whatever its case", async () => {
    expect(await getRecentColors()).toEqual([]);
    await pushRecentColor("#FF0000");
    await pushRecentColor("#00ff00");
    await pushRecentColor("#ff0000");
    expect(await getRecentColors()).toEqual(["#ff0000", "#00ff00"]);
  });

  it("keeps the fourteen most recent colours", async () => {
    for (let i = 0; i < 20; i++) await pushRecentColor(`#0000${i.toString(16).padStart(2, "0")}`);
    const colors = await getRecentColors();
    expect(colors).toHaveLength(14);
    expect(colors[0]).toBe("#000013");
    expect(colors[13]).toBe("#000006");
  });
});

describe("version history", () => {
  let clock = 1_000_000;
  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => ++clock);
  });

  it("saves a snapshot with an optional label and lists it without the design inside", async () => {
    const design = make();
    await saveVersion(design, "Before the redesign");
    const [version] = await listVersions(design.id);
    expect(version.label).toBe("Before the redesign");
    expect(version.designId).toBe(design.id);
    expect(version.id.startsWith(`${design.id}:`)).toBe(true);
    expect(version).not.toHaveProperty("design");
  });

  it("keeps the whole design in the snapshot, apart from the original", async () => {
    const design = make({ title: "As it was" });
    await saveVersion(design);
    const [version] = await listVersions(design.id);
    design.title = "Changed afterwards";
    const stored = await getVersion(version.id);
    expect(stored?.design.title).toBe("As it was");
    expect(stored?.design.id).toBe(design.id);
    expect(stored?.design.pages).toHaveLength(1);
    expect(stored?.design.pages[0].elements[0]).toMatchObject({ type: "text" });
    expect(await getVersion("missing")).toBeNull();
  });

  it("lists the newest version first and only those of the design asked for", async () => {
    const a = make();
    const b = make();
    await saveVersion(a, "first");
    await saveVersion(b, "other design");
    await saveVersion(a, "second");
    expect((await listVersions(a.id)).map((v) => v.label)).toEqual(["second", "first"]);
    expect((await listVersions(b.id)).map((v) => v.label)).toEqual(["other design"]);
    expect(await listVersions("nobody")).toEqual([]);
  });

  it("keeps the 25 newest versions of a design and drops the older ones", async () => {
    const design = make();
    const other = make();
    await saveVersion(other, "untouched");
    for (let i = 1; i <= 27; i++) await saveVersion(design, `v${i}`);
    const versions = await listVersions(design.id);
    expect(versions).toHaveLength(25);
    expect(versions[0].label).toBe("v27");
    expect(versions[24].label).toBe("v3");
    expect(await listVersions(other.id)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import type { BrandKit, Folder } from "@/core/types";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_NAME,
  BackupError,
  backupFileName,
  buildManifest,
  countsOf,
  designAction,
  designEntryName,
  foldersToRestore,
  isSafeId,
  mergeBrandKit,
  mimeForExtension,
  parseManifest,
  planRestore,
  previewEntryName,
  restoredCopyTitle,
  uploadEntryName,
  versionEntryName,
  type BackupManifest,
  type LocalLibrary,
  type ManifestDesign,
} from "./backupFormat";

const design = (id: string, over: Partial<ManifestDesign> = {}): ManifestDesign => ({
  id,
  title: `Design ${id}`,
  createdAt: 100,
  updatedAt: 200,
  trashed: false,
  folderId: null,
  file: designEntryName(id),
  ...over,
});

const folder = (id: string, parentId: string | null = null): Folder => ({ id, name: `Folder ${id}`, createdAt: 1, parentId });

function manifestOf(over: Partial<BackupManifest> = {}): BackupManifest {
  return { craftlyBackup: 1, app: "Craftly", exportedAt: "2026-11-08T12:00:00.000Z", designs: [], uploads: [], folders: [], versions: [], brandKit: null, ...over };
}

const emptyLocal = (): LocalLibrary => ({ designs: new Map(), folders: new Set(), uploads: new Set(), versions: new Set(), brandKit: undefined });

const kit = (colors: string[], fonts: string[] = [], logos: string[] = []): BrandKit => ({ colors, fonts, logos });

describe("backupFileName", () => {
  it("is the local date in the name, so two backups on different days do not collide", () => {
    expect(backupFileName(new Date(2026, 10, 8, 18, 5))).toBe("Craftly backup 2026-11-08.zip");
    expect(backupFileName(new Date(2027, 0, 3, 0, 0))).toBe("Craftly backup 2027-01-03.zip");
  });
});

describe("isSafeId", () => {
  it("accepts the ids Craftly makes and rejects anything that could break a link or a file name", () => {
    for (const id of ["d_ab12cd34ef", "f_xyz", "tpl-1", "d_abc:1731000000000", "a".repeat(128)]) expect(isSafeId(id), id).toBe(true);
    for (const id of ["", "a/b", "a\\b", "a b", "x#y", "x?y", "é", "..", ".", "a".repeat(129)]) expect(isSafeId(id), id).toBe(false);
    for (const id of [null, undefined, 12, {}, []]) expect(isSafeId(id as never)).toBe(false);
  });
});

describe("entry names", () => {
  it("puts every kind of file in its own folder, named by id", () => {
    expect(BACKUP_MANIFEST_NAME).toBe("craftly-backup.json");
    expect(designEntryName("d_1")).toBe("designs/d_1.json");
    expect(previewEntryName("d_1", "image/jpeg")).toBe("previews/d_1.jpg");
    expect(uploadEntryName("a_1", "image/png")).toBe("uploads/a_1.png");
    expect(uploadEntryName("a_2", "image/svg+xml")).toBe("uploads/a_2.svg");
    expect(versionEntryName("d_1", 3)).toBe("versions/d_1/3.json");
  });

  it("knows the picture types by extension, and nothing else", () => {
    expect(mimeForExtension("previews/d_1.jpg")).toBe("image/jpeg");
    expect(mimeForExtension("x.JPEG")).toBe("image/jpeg");
    expect(mimeForExtension("x.png")).toBe("image/png");
    expect(mimeForExtension("x.webp")).toBe("image/webp");
    expect(mimeForExtension("x.svg")).toBe("image/svg+xml");
    expect(mimeForExtension("x.exe")).toBeNull();
    expect(mimeForExtension("noextension")).toBeNull();
  });
});

describe("restoredCopyTitle", () => {
  it("marks a design that came back next to a newer one with the same name", () => {
    expect(restoredCopyTitle("Poster")).toBe("Poster (restored)");
  });
});

describe("the manifest", () => {
  it("is written with the format version, the time and everything in it", () => {
    const folders = [folder("f_1")];
    const manifest = buildManifest({ designs: [design("d_1")], uploads: [], folders, versions: [], brandKit: kit(["#fff"]) }, new Date("2026-11-08T12:00:00.000Z"));
    expect(manifest).toMatchObject({ craftlyBackup: BACKUP_FORMAT_VERSION, app: "Craftly", exportedAt: "2026-11-08T12:00:00.000Z", folders, brandKit: kit(["#fff"]) });
    expect(manifest.designs).toHaveLength(1);
  });

  it("counts what it holds, trash apart", () => {
    const manifest = manifestOf({
      designs: [design("d_1"), design("d_2", { trashed: true }), design("d_3")],
      folders: [folder("f_1")],
      uploads: [{ id: "a_1", name: "Logo", kind: "image", mime: "image/png", size: 1, width: 1, height: 1, createdAt: 1, file: "uploads/a_1.png" }],
      versions: [{ id: "d_1:1", designId: "d_1", createdAt: 1, file: "versions/d_1/0.json" }],
    });
    expect(countsOf(manifest)).toEqual({ designs: 2, trashed: 1, folders: 1, uploads: 1, versions: 1 });
  });

  it("survives being written out and read back", () => {
    const manifest = manifestOf({
      designs: [design("d_1", { folderId: "f_1", preview: "previews/d_1.jpg" })],
      folders: [folder("f_1")],
      brandKit: kit(["#123456"], ["Lora"], ["a_1"]),
    });
    expect(parseManifest(JSON.stringify(manifest))).toEqual({ manifest, skipped: 0 });
  });

  describe("reading one that is not right", () => {
    const rejects = (text: string, code: string) => {
      try {
        parseManifest(text);
      } catch (error) {
        expect(error).toBeInstanceOf(BackupError);
        expect((error as BackupError).code).toBe(code);
        return;
      }
      throw new Error(`expected ${code} for ${text.slice(0, 40)}`);
    };

    it("says it is not a backup for anything that is not our manifest", () => {
      for (const text of ["", "not json", "[]", "null", "12", '"text"', "{}", '{"craftlyBackup":"1"}', '{"craftlyBackup":0}', '{"craftlyBackup":-3}'])
        rejects(text, "not-a-backup");
    });

    it("says a backup from a newer version needs a newer app", () => {
      rejects('{"craftlyBackup":2}', "newer");
      try {
        parseManifest('{"craftlyBackup":2}');
      } catch (error) {
        expect((error as Error).message).toContain("newer version of Craftly");
      }
    });

    it("keeps what is usable and counts what is not", () => {
      const text = JSON.stringify({
        craftlyBackup: 1,
        exportedAt: "2026-11-08T12:00:00.000Z",
        designs: [design("d_ok"), { ...design("bad/id") }, { ...design("d_nofile"), file: undefined }, "nonsense", null, { id: "d_loose", file: "designs/d_loose.json" }],
        uploads: [{ id: "a_ok", file: "uploads/a_ok.png", mime: "image/png" }, { id: "a_nofile" }, { id: "../x", file: "x" }],
        folders: [folder("f_ok"), { id: "f bad", name: "x" }, { name: "no id" }],
        versions: [{ id: "d_ok:1", designId: "d_ok", createdAt: 5, file: "versions/d_ok/0.json" }, { id: "x", designId: "bad id", file: "f" }, { id: "y" }],
        brandKit: { colors: ["#fff", 5, null], fonts: "nope", logos: ["a_ok", "bad id"] },
      });
      const { manifest, skipped } = parseManifest(text);
      expect(manifest.designs.map((d) => d.id)).toEqual(["d_ok", "d_loose"]);
      expect(manifest.uploads.map((u) => u.id)).toEqual(["a_ok"]);
      expect(manifest.folders.map((f) => f.id)).toEqual(["f_ok"]);
      expect(manifest.versions.map((v) => v.id)).toEqual(["d_ok:1"]);
      expect(manifest.brandKit).toEqual({ colors: ["#fff"], fonts: [], logos: ["a_ok"] });
      expect(skipped).toBe(4 + 2 + 2 + 2);
    });

    it("fills in what a hand-made entry leaves out", () => {
      const { manifest } = parseManifest(
        JSON.stringify({
          craftlyBackup: 1,
          designs: [{ id: "d_loose", file: "designs/d_loose.json", updatedAt: 50 }],
          uploads: [{ id: "a_1", file: "uploads/a_1.svg", mime: "image/svg+xml" }],
          folders: [{ id: "f_1" }],
        }),
      );
      expect(manifest.designs[0]).toMatchObject({ title: "Untitled design", createdAt: 50, updatedAt: 50, trashed: false, folderId: null });
      expect(manifest.uploads[0]).toMatchObject({ name: "Upload", kind: "svg", size: 0, width: 800, height: 600 });
      expect(manifest.folders[0]).toMatchObject({ name: "Untitled folder", parentId: null });
      expect(manifest.exportedAt).toBe(new Date(0).toISOString());
      expect(manifest.brandKit).toBeNull();
    });

    it("keeps the first of two entries with the same id and counts the other as unusable", () => {
      const { manifest, skipped } = parseManifest(
        JSON.stringify({
          craftlyBackup: 1,
          designs: [
            { id: "d_1", title: "First", file: "designs/d_1.json" },
            { id: "d_1", title: "Second", file: "designs/d_1b.json" },
          ],
          uploads: [
            { id: "a_1", file: "uploads/a_1.png" },
            { id: "a_1", file: "uploads/a_1b.png" },
          ],
          folders: [{ id: "f_1" }, { id: "f_1", name: "Again" }],
          versions: [
            { id: "d_1:1", designId: "d_1", file: "versions/d_1/0.json" },
            { id: "d_1:1", designId: "d_1", file: "versions/d_1/1.json" },
          ],
        }),
      );
      expect(manifest.designs.map((d) => d.title)).toEqual(["First"]);
      expect(manifest.uploads).toHaveLength(1);
      expect(manifest.folders.map((f) => f.name)).toEqual(["Untitled folder"]);
      expect(manifest.versions.map((v) => v.file)).toEqual(["versions/d_1/0.json"]);
      expect(skipped).toBe(4);
    });

    it("takes the picture type of an upload from its file name when the entry does not say, and PNG when that says nothing either", () => {
      const { manifest } = parseManifest(
        JSON.stringify({
          craftlyBackup: 1,
          uploads: [
            { id: "a_1", file: "uploads/a_1.webp" },
            { id: "a_2", file: "uploads/a_2.dat" },
          ],
          versions: [{ id: "d_1:1", designId: "d_1", file: "versions/d_1/0.json" }],
        }),
      );
      expect(manifest.uploads.map((u) => u.mime)).toEqual(["image/webp", "image/png"]);
      expect(manifest.versions[0].createdAt).toBe(0);
    });

    it("keeps an upload only when its type is a picture, as the upload field does, and counts the others as unusable", () => {
      const { manifest, skipped } = parseManifest(
        JSON.stringify({
          craftlyBackup: 1,
          uploads: [
            { id: "a_png", file: "uploads/a_png.png", mime: "image/png" },
            { id: "a_page", file: "uploads/a_page.png", mime: "text/html" },
            { id: "a_script", file: "uploads/a_script.svg", mime: "application/javascript" },
            { id: "a_tiff", file: "uploads/a_tiff.tiff", mime: "IMAGE/TIFF" },
            { id: "a_odd", file: "uploads/a_odd.png", mime: "text/html;image/png" },
          ],
        }),
      );
      expect(manifest.uploads.map((u) => u.id)).toEqual(["a_png", "a_tiff"]);
      expect(skipped).toBe(3);
    });

    it("treats a missing list as an empty one", () => {
      const { manifest, skipped } = parseManifest('{"craftlyBackup":1}');
      expect(manifest).toMatchObject({ designs: [], uploads: [], folders: [], versions: [], brandKit: null });
      expect(skipped).toBe(0);
    });
  });
});

describe("designAction", () => {
  const here = new Map([["d_1", 200]]);
  it("adds a design that is not here, skips one that is already here as it was, and keeps both when it has changed since", () => {
    expect(designAction(here, { id: "d_new", updatedAt: 1 })).toBe("add");
    expect(designAction(here, { id: "d_1", updatedAt: 200 })).toBe("same");
    expect(designAction(here, { id: "d_1", updatedAt: 150 })).toBe("copy");
    expect(designAction(here, { id: "d_1", updatedAt: 250 })).toBe("copy");
  });
});

describe("planRestore", () => {
  it("adds everything to an empty library", () => {
    const manifest = manifestOf({
      designs: [design("d_1"), design("d_2")],
      folders: [folder("f_1")],
      uploads: [{ id: "a_1", name: "L", kind: "image", mime: "image/png", size: 1, width: 1, height: 1, createdAt: 1, file: "uploads/a_1.png" }],
      versions: [{ id: "d_1:1", designId: "d_1", createdAt: 1, file: "versions/d_1/0.json" }],
      brandKit: kit(["#fff"]),
    });
    expect(planRestore(manifest, emptyLocal())).toEqual({
      designs: { add: 2, same: 0, copy: 0 },
      uploads: { add: 1, same: 0 },
      folders: { add: 1, same: 0 },
      versions: { add: 1 },
      brandKit: "restore",
      nothingNew: false,
    });
  });

  it("finds nothing to do when the library already holds all of it", () => {
    const manifest = manifestOf({
      designs: [design("d_1")],
      folders: [folder("f_1")],
      uploads: [{ id: "a_1", name: "L", kind: "image", mime: "image/png", size: 1, width: 1, height: 1, createdAt: 1, file: "uploads/a_1.png" }],
      versions: [{ id: "d_1:1", designId: "d_1", createdAt: 1, file: "versions/d_1/0.json" }],
      brandKit: kit(["#fff"]),
    });
    const local: LocalLibrary = {
      designs: new Map([["d_1", 200]]),
      folders: new Set(["f_1"]),
      uploads: new Set(["a_1"]),
      versions: new Set(["d_1:1"]),
      brandKit: kit(["#fff"], ["Lora"]),
    };
    const plan = planRestore(manifest, local);
    expect(plan).toMatchObject({
      designs: { add: 0, same: 1, copy: 0 },
      uploads: { add: 0, same: 1 },
      folders: { add: 0, same: 1 },
      versions: { add: 0 },
      brandKit: "none",
      nothingNew: true,
    });
  });

  it("brings back a changed design as a copy and leaves its history behind", () => {
    const manifest = manifestOf({
      designs: [design("d_1", { updatedAt: 100 })],
      versions: [{ id: "d_1:1", designId: "d_1", createdAt: 1, file: "versions/d_1/0.json" }],
    });
    const local = { ...emptyLocal(), designs: new Map([["d_1", 999]]) };
    expect(planRestore(manifest, local)).toMatchObject({ designs: { add: 0, same: 0, copy: 1 }, versions: { add: 0 }, nothingNew: false });
  });

  it("restores the history of a design that is already here as it was", () => {
    const manifest = manifestOf({ designs: [design("d_1")], versions: [{ id: "d_1:1", designId: "d_1", createdAt: 1, file: "versions/d_1/0.json" }] });
    const local = { ...emptyLocal(), designs: new Map([["d_1", 200]]) };
    expect(planRestore(manifest, local)).toMatchObject({ versions: { add: 1 }, nothingNew: false });
  });

  it("does not restore the history of a design that is not coming back", () => {
    const manifest = manifestOf({ versions: [{ id: "d_gone:1", designId: "d_gone", createdAt: 1, file: "versions/d_gone/0.json" }] });
    expect(planRestore(manifest, emptyLocal()).versions.add).toBe(0);
  });

  it("merges the brand kit into one that was customised, and only says so when that changes something", () => {
    const manifest = manifestOf({ brandKit: kit(["#fff", "#000"]) });
    expect(planRestore(manifest, { ...emptyLocal(), brandKit: kit(["#fff"]) }).brandKit).toBe("merge");
    expect(planRestore(manifest, { ...emptyLocal(), brandKit: kit(["#FFF", "#000"]) }).brandKit).toBe("none");
    expect(planRestore(manifestOf(), emptyLocal()).brandKit).toBe("none");
  });
});

describe("mergeBrandKit", () => {
  it("takes the backed up kit when this browser never had one of its own", () => {
    expect(mergeBrandKit(undefined, kit(["#fff"], ["Lora"], ["a_1"]))).toEqual({ action: "restore", kit: kit(["#fff"], ["Lora"], ["a_1"]) });
  });

  it("adds what is missing to a kit that was customised, keeping its own order first", () => {
    const merged = mergeBrandKit(kit(["#111111", "#222222"], ["Lora"], ["a_1"]), kit(["#222222", "#333333"], ["Lora", "Inter"], ["a_2", "a_1"]));
    expect(merged).toEqual({ action: "merge", kit: kit(["#111111", "#222222", "#333333"], ["Lora", "Inter"], ["a_1", "a_2"]) });
  });

  it("compares colours without regard to case", () => {
    expect(mergeBrandKit(kit(["#ABCDEF"]), kit(["#abcdef"])).action).toBe("none");
  });

  it("writes nothing when there is nothing to add", () => {
    expect(mergeBrandKit(kit(["#111"]), null)).toEqual({ action: "none", kit: null });
    expect(mergeBrandKit(undefined, null)).toEqual({ action: "none", kit: null });
    expect(mergeBrandKit(kit(["#111"], ["Lora"], ["a_1"]), kit(["#111"], ["Lora"], ["a_1"]))).toEqual({ action: "none", kit: null });
  });
});

describe("foldersToRestore", () => {
  it("adds the folders that are missing and leaves the ones that are here alone", () => {
    const result = foldersToRestore([folder("f_1"), folder("f_2")], new Set(["f_1"]));
    expect(result.map((f) => f.id)).toEqual(["f_2"]);
  });

  it("keeps a folder inside another when both come back, or when the parent is already here", () => {
    const result = foldersToRestore([folder("f_child", "f_parent"), folder("f_parent"), folder("f_grand", "f_here")], new Set(["f_here"]));
    expect(Object.fromEntries(result.map((f) => [f.id, f.parentId]))).toEqual({ f_child: "f_parent", f_parent: null, f_grand: "f_here" });
  });

  it("moves a folder to the top level when its parent is nowhere to be found", () => {
    expect(foldersToRestore([folder("f_1", "f_lost")], new Set())[0].parentId).toBeNull();
  });

  it("cuts a folder that is its own parent, and folders that contain each other", () => {
    const self = foldersToRestore([folder("f_1", "f_1")], new Set());
    expect(self[0].parentId).toBeNull();
    const loop = foldersToRestore([folder("f_a", "f_b"), folder("f_b", "f_c"), folder("f_c", "f_a")], new Set());
    expect(loop.every((f) => f.parentId === null)).toBe(true);
  });
});

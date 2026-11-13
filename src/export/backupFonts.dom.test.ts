import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCustomFont, listCustomFonts } from "@/core/customFonts";
import { createDesign, createPage, createText } from "@/core/factory";
import { saveDesign } from "@/core/library";
import { getFontDef, setCustomFaces } from "@/render/fonts";
import { brokenFont, fontFileOf, installFontFaces, removeFontFaces, sfntBytes } from "@/test/fontFixtures";
import { wipeDatabase } from "@/test/logicDb";
import { createBackup, inspectBackup, restoreBackup } from "./backup";
import {
  BACKUP_MANIFEST_NAME,
  buildManifest,
  countsOf,
  fontEntryName,
  parseManifest,
  planRestore,
  type BackupManifest,
  type LocalLibrary,
  type ManifestFont,
} from "./backupFormat";
import { createZip } from "./zip";
import { openZip } from "./zipRead";

beforeEach(async () => {
  await wipeDatabase();
  installFontFaces();
  setCustomFaces([]);
});

afterEach(() => {
  setCustomFaces([]);
  removeFontFaces();
});

const REGULAR = sfntBytes({ family: "Acme Sans" });
const BOLD = sfntBytes({ family: "Acme Sans", weight: 700 });

async function library(): Promise<void> {
  await addCustomFont(fontFileOf("AcmeSans-Regular.ttf", REGULAR));
  await addCustomFont(fontFileOf("AcmeSans-Bold.ttf", BOLD));
  await saveDesign(createDesign({ title: "Poster", width: 100, height: 100, pages: [createPage({ elements: [createText({ text: "x", fontFamily: "Acme Sans" })] })] }));
}

async function emptied(): Promise<void> {
  await wipeDatabase();
  setCustomFaces([]);
}

const manifestFont = (over: Partial<ManifestFont> = {}): ManifestFont => ({
  id: "f_1",
  family: "Acme Sans",
  weight: 400,
  maxWeight: 400,
  italic: false,
  format: "ttf",
  fileName: "AcmeSans-Regular.ttf",
  size: REGULAR.length,
  createdAt: 5,
  file: "fonts/f_1.ttf",
  ...over,
});
const EMPTY_LOCAL: LocalLibrary = { designs: new Map(), folders: new Set(), uploads: new Set(), versions: new Set(), brandKit: undefined };
const manifestWith = (fonts: unknown): string => JSON.stringify({ ...buildManifest({ designs: [], uploads: [], folders: [], versions: [], brandKit: null }), fonts });

/** A backup made by hand: a manifest that lists these fonts, and these files. */
async function handMade(fonts: ManifestFont[], files: Record<string, Uint8Array>): Promise<Blob> {
  const manifest: BackupManifest = buildManifest({ designs: [], uploads: [], folders: [], versions: [], brandKit: null, fonts });
  return createZip([{ name: BACKUP_MANIFEST_NAME, data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...Object.entries(files).map(([name, data]) => ({ name, data }))]);
}

describe("the fonts in the manifest of a backup", () => {
  it("are named after their id and kind", () => {
    expect(fontEntryName("f_1", "woff2")).toBe("fonts/f_1.woff2");
  });

  it("are read back as they were written, and counted", () => {
    const { manifest, skipped } = parseManifest(manifestWith([manifestFont(), manifestFont({ id: "f_2", weight: 700, maxWeight: 700, file: "fonts/f_2.ttf" })]));
    expect(manifest.fonts).toEqual([manifestFont(), manifestFont({ id: "f_2", weight: 700, maxWeight: 700, file: "fonts/f_2.ttf" })]);
    expect(skipped).toBe(0);
    expect(countsOf(manifest).fonts).toBe(2);
  });

  it("are not there at all in a backup without uploaded fonts, so that such a backup is what it always was", () => {
    const { manifest } = parseManifest(manifestWith(undefined));
    expect(manifest).not.toHaveProperty("fonts");
    expect(countsOf(manifest)).not.toHaveProperty("fonts");
    expect(planRestore(manifest, EMPTY_LOCAL)).not.toHaveProperty("fonts");
    expect(parseManifest(manifestWith("nonsense")).manifest).not.toHaveProperty("fonts");
  });

  it("are left out and counted when an entry cannot be used: an id that is not safe, no file, no family, a kind that is no font", () => {
    const { manifest, skipped } = parseManifest(
      manifestWith([
        manifestFont(),
        manifestFont({ id: "../x" }),
        manifestFont({ id: "f_3", file: "" }),
        manifestFont({ id: "f_4", family: "  " }),
        manifestFont({ id: "f_5", format: "exe" as ManifestFont["format"], file: "fonts/f_5.exe" }),
        manifestFont(), // the same id twice
        "nonsense",
      ]),
    );
    expect(manifest.fonts?.map((f) => f.id)).toEqual(["f_1"]);
    expect(skipped).toBe(6);
  });

  it("get the kind their file name says when the entry does not, and plain values for what else is missing", () => {
    const { manifest } = parseManifest(manifestWith([{ id: "f_9", family: "Acme Sans", file: "fonts/f_9.WOFF2" }]));
    expect(manifest.fonts).toEqual([
      { id: "f_9", family: "Acme Sans", weight: 400, maxWeight: 400, italic: false, format: "woff2", fileName: "f_9.WOFF2", size: 0, createdAt: 0, file: "fonts/f_9.WOFF2" },
    ]);
  });

  it("count as something new for a library that does not have them", () => {
    const { manifest } = parseManifest(manifestWith([manifestFont(), manifestFont({ id: "f_2", file: "fonts/f_2.ttf" })]));
    expect(planRestore(manifest, EMPTY_LOCAL)).toMatchObject({ fonts: { add: 2, same: 0 }, nothingNew: false });
    expect(planRestore(manifest, { ...EMPTY_LOCAL, fonts: new Set(["f_1"]) })).toMatchObject({ fonts: { add: 1, same: 1 }, nothingNew: false });
    expect(planRestore(manifest, { ...EMPTY_LOCAL, fonts: new Set(["f_1", "f_2"]) })).toMatchObject({ fonts: { add: 0, same: 2 }, nothingNew: true });
  });
});

describe("backing up a library with uploaded fonts", () => {
  it("puts every font file into the archive, byte for byte, and lists it in the manifest", async () => {
    await library();
    const stored = await listCustomFonts();
    const backup = await createBackup();
    expect(backup.counts.fonts).toBe(2);
    const archive = await openZip(backup.blob);
    const names = archive.entries.map((e) => e.name);
    expect(names).toContain(`fonts/${stored[0].id}.ttf`);
    expect(names).toContain(`fonts/${stored[1].id}.ttf`);
    const bold = archive.find(`fonts/${stored[1].id}.ttf`);
    expect(new Uint8Array(await (await archive.read(bold!)).arrayBuffer())).toEqual(BOLD);
    const { manifest } = parseManifest(await archive.text(archive.find(BACKUP_MANIFEST_NAME)!));
    expect(manifest.fonts?.map((f) => [f.id, f.family, f.weight, f.fileName, f.size])).toEqual(stored.map((f) => [f.id, f.family, f.weight, f.fileName, f.size]));
  });

  it("counts the fonts in its progress", async () => {
    await library();
    const totals = new Set<number>();
    await createBackup({ onProgress: (p) => p.phase === "collecting" && totals.add(p.total) });
    // one design and two fonts
    expect([...totals]).toEqual([3]);
  });

  it("writes no list of fonts for a library without any", async () => {
    await saveDesign(createDesign({ title: "Plain", width: 100, height: 100 }));
    const backup = await createBackup();
    const archive = await openZip(backup.blob);
    expect(JSON.parse(await archive.text(archive.find(BACKUP_MANIFEST_NAME)!))).not.toHaveProperty("fonts");
    expect(backup.counts).not.toHaveProperty("fonts");
  });
});

describe("restoring a backup with uploaded fonts", () => {
  it("brings the fonts back under the ids, names and dates they had, usable at once", async () => {
    await library();
    const before = await listCustomFonts();
    const { blob } = await createBackup();
    await emptied();

    expect((await inspectBackup(blob)).plan).toMatchObject({ fonts: { add: 2, same: 0 }, nothingNew: false });
    const seen: Array<{ done: number; total: number }> = [];
    const result = await restoreBackup(blob, { onProgress: (p) => seen.push(p) });
    expect(result.fonts).toEqual({ added: 2, same: 0, damaged: 0 });
    // two fonts and one design
    expect(seen[seen.length - 1]).toEqual({ done: 3, total: 3 });

    const after = await listCustomFonts();
    expect(after.map((f) => [f.id, f.family, f.weight, f.createdAt, f.fileName])).toEqual(before.map((f) => [f.id, f.family, f.weight, f.createdAt, f.fileName]));
    expect(new Uint8Array(after[0].data)).toEqual(REGULAR);
    expect(getFontDef("Acme Sans")).toMatchObject({ weights: [400, 700] });
  });

  it("leaves the fonts alone that are here already, and says that nothing is new", async () => {
    await library();
    const { blob } = await createBackup();
    expect((await inspectBackup(blob)).plan).toMatchObject({ fonts: { add: 0, same: 2 }, nothingNew: true });
    const result = await restoreBackup(blob);
    expect(result.fonts).toEqual({ added: 0, same: 2, damaged: 0 });
    expect(await listCustomFonts()).toHaveLength(2);
  });

  it("checks a font of a backup as an upload is checked, and never takes one under the name of a bundled family", async () => {
    const blob = await handMade(
      [
        manifestFont(),
        manifestFont({ id: "f_html", family: "Evil", file: "fonts/f_html.ttf" }),
        manifestFont({ id: "f_broken", family: "Broken", file: "fonts/f_broken.ttf" }),
        manifestFont({ id: "f_inter", family: "Inter", file: "fonts/f_inter.ttf" }),
        manifestFont({ id: "f_gone", family: "Gone", file: "fonts/f_gone.ttf" }),
      ],
      {
        "fonts/f_1.ttf": REGULAR,
        "fonts/f_html.ttf": new TextEncoder().encode("<html><script>alert(1)</script></html>"),
        "fonts/f_broken.ttf": brokenFont(sfntBytes()),
        "fonts/f_inter.ttf": REGULAR,
      },
    );
    const result = await restoreBackup(blob);
    expect(result.fonts).toEqual({ added: 1, same: 0, damaged: 4 });
    expect((await listCustomFonts()).map((f) => [f.id, f.family])).toEqual([["f_1", "Acme Sans"]]);
    expect(getFontDef("Inter")?.css).toBe("Inter Variable");
    expect(getFontDef("Evil")).toBeUndefined();
  });

  it("counts a font as here when this library has another file for the same family, weight and style", async () => {
    await addCustomFont(fontFileOf("mine.ttf", REGULAR));
    const mine = await listCustomFonts();
    const result = await restoreBackup(await handMade([manifestFont()], { "fonts/f_1.ttf": REGULAR }));
    expect(result.fonts).toEqual({ added: 0, same: 1, damaged: 0 });
    expect((await listCustomFonts()).map((f) => f.id)).toEqual(mine.map((f) => f.id));
  });

  it("says nothing about fonts for a backup that has none", async () => {
    await saveDesign(createDesign({ title: "Plain", width: 100, height: 100 }));
    const { blob } = await createBackup();
    await emptied();
    expect(await restoreBackup(blob)).not.toHaveProperty("fonts");
  });

  it("stops at a font when it is cancelled", async () => {
    await library();
    const { blob } = await createBackup();
    await emptied();
    const stop = new AbortController();
    let calls = 0;
    await expect(
      restoreBackup(blob, {
        signal: stop.signal,
        onProgress: () => {
          if (++calls === 1) stop.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(await listCustomFonts()).toHaveLength(1);
  });
});

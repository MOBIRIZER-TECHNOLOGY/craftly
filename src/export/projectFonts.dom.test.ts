import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCustomFont, deleteCustomFamily, listCustomFonts } from "@/core/customFonts";
import { createDesign, createImage, createPage, createText } from "@/core/factory";
import { getDesign, listDesigns } from "@/core/library";
import type { Design, TextElement } from "@/core/types";
import { getFontDef, setCustomFaces } from "@/render/fonts";
import { brokenFont, fontFileOf, installFontFaces, removeFontFaces, sfntBytes, woffBytes } from "@/test/fontFixtures";
import { wipeDatabase } from "@/test/logicDb";
import { bytesToBase64 } from "./encoding";
import { exportProjectFile, importProjectFile } from "./projectFile";
import { MAX_PROJECT_FONTS, readProjectFonts, type ProjectFont } from "./projectFonts";

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

function designWith(...families: string[]): Design {
  return createDesign({ title: "Poster", width: 100, height: 100, pages: [createPage({ elements: families.map((fontFamily) => createText({ text: "x", fontFamily })) })] });
}

async function uploadAcme(): Promise<void> {
  await addCustomFont(fontFileOf("AcmeSans-Regular.ttf", REGULAR));
  await addCustomFont(fontFileOf("AcmeSans-Bold.ttf", BOLD));
}

const textOf = async (design: Design) => (await exportProjectFile(design)).text();
const fileOf = (text: string) => new File([text], "poster.craftly", { type: "application/json" });
const dataUrl = (bytes: Uint8Array, mime = "font/ttf") => `data:${mime};base64,${bytesToBase64(bytes)}`;
const entry = (over: Partial<ProjectFont> = {}): ProjectFont => ({
  family: "Acme Sans",
  weight: 400,
  maxWeight: 400,
  italic: false,
  fileName: "AcmeSans-Regular.ttf",
  dataUrl: dataUrl(REGULAR),
  ...over,
});
/** The text of a project file for this design that carries exactly these fonts. */
async function projectWith(design: Design, fonts: unknown): Promise<string> {
  return JSON.stringify({ ...JSON.parse(await textOf(design)), fonts });
}
const firstFamily = (design: Design) => (design.pages[0].elements[0] as TextElement).fontFamily;

describe("a project file of a design that uses an uploaded font", () => {
  it("carries every file of the family, byte for byte, with its family, weight and style", async () => {
    await uploadAcme();
    await addCustomFont(fontFileOf("Unused.ttf", sfntBytes({ family: "Unused" })));
    const fonts = readProjectFonts(await textOf(designWith("Acme Sans", "Inter")));
    expect(fonts).toEqual([
      { family: "Acme Sans", weight: 400, maxWeight: 400, italic: false, fileName: "AcmeSans-Regular.ttf", dataUrl: dataUrl(REGULAR) },
      { family: "Acme Sans", weight: 700, maxWeight: 700, italic: false, fileName: "AcmeSans-Bold.ttf", dataUrl: dataUrl(BOLD) },
    ]);
  });

  it("carries a compressed font under its own type", async () => {
    await addCustomFont(fontFileOf("Web-Regular.woff2", woffBytes("woff2")));
    const [font] = readProjectFonts(await textOf(designWith("Web")));
    expect(font.dataUrl.startsWith("data:font/woff2;base64,")).toBe(true);
  });

  it("carries the font of a few characters inside a text too", async () => {
    await uploadAcme();
    const design = designWith("Inter");
    (design.pages[0].elements[0] as TextElement).paragraphs[0].runs[0].font = "Acme Sans";
    expect(readProjectFonts(await textOf(design))).toHaveLength(2);
  });

  it("has no list of fonts when the design uses bundled fonts only, or a font that is not on this device", async () => {
    await uploadAcme();
    expect(JSON.parse(await textOf(designWith("Inter", "Lora")))).not.toHaveProperty("fonts");
    await deleteCustomFamily("Acme Sans");
    expect(JSON.parse(await textOf(designWith("Acme Sans")))).not.toHaveProperty("fonts");
  });
});

describe("opening a project file that carries fonts", () => {
  it("brings the fonts along: on a device that never had them the design draws as it was made", async () => {
    await uploadAcme();
    const text = await textOf(designWith("Acme Sans"));
    await wipeDatabase();
    setCustomFaces([]);
    expect(getFontDef("Acme Sans")).toBeUndefined();

    const design = await importProjectFile(fileOf(text));
    expect(firstFamily(design)).toBe("Acme Sans");
    expect(getFontDef("Acme Sans")).toMatchObject({ weights: [400, 700] });
    const stored = await listCustomFonts();
    expect(stored.map((f) => [f.family, f.weight, f.fileName])).toEqual([
      ["Acme Sans", 400, "AcmeSans-Regular.ttf"],
      ["Acme Sans", 700, "AcmeSans-Bold.ttf"],
    ]);
    expect(new Uint8Array(stored[1].data)).toEqual(BOLD);
    expect((await getDesign(design.id))?.title).toBe("Poster");
  });

  it("checks each font as an upload is checked: what is no font is left out, and the design still opens under the name it uses", async () => {
    const design = designWith("Acme Sans", "Evil");
    const text = await projectWith(design, [
      entry({ family: "Evil", dataUrl: dataUrl(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "text/html") }),
      entry({ family: "Evil", weight: 700, maxWeight: 700, dataUrl: dataUrl(brokenFont(sfntBytes())) }),
      entry(),
    ]);
    const imported = await importProjectFile(fileOf(text));
    expect((await listCustomFonts()).map((f) => f.family)).toEqual(["Acme Sans"]);
    expect(getFontDef("Evil")).toBeUndefined();
    expect((imported.pages[0].elements[1] as TextElement).fontFamily).toBe("Evil");
  });

  it("never takes a font under the name of a bundled family", async () => {
    await importProjectFile(fileOf(await projectWith(designWith("Inter"), [entry({ family: "Inter" }), entry({ family: "Inter Variable" })])));
    expect(await listCustomFonts()).toEqual([]);
    expect(getFontDef("Inter")?.css).toBe("Inter Variable");
  });

  it("keeps the font this device has for the same family, weight and style", async () => {
    await uploadAcme();
    const mine = await listCustomFonts();
    await importProjectFile(fileOf(await projectWith(designWith("Acme Sans"), [entry({ dataUrl: dataUrl(sfntBytes({ family: "Somebody else's" })) })])));
    expect((await listCustomFonts()).map((f) => f.id)).toEqual(mine.map((f) => f.id));
  });

  it("ignores a list of fonts that is not one, and entries that are not fonts of a file", async () => {
    for (const fonts of [
      null,
      "fonts",
      { family: "Acme Sans" },
      [null, 7, "x", {}, entry({ dataUrl: "data:font/ttf;base64,***" }), entry({ dataUrl: "https://example.com/font.ttf" }), entry({ family: 12 as unknown as string })],
    ]) {
      await importProjectFile(fileOf(await projectWith(designWith("Acme Sans"), fonts)));
    }
    expect(await listCustomFonts()).toEqual([]);
    expect(await listDesigns()).toHaveLength(4);
  });

  it("reads what a careless file leaves out: a missing weight is regular, a missing file name gets one", () => {
    const [font] = readProjectFonts(JSON.stringify({ fonts: [{ family: "Acme Sans", dataUrl: dataUrl(REGULAR) }] }));
    expect(font).toEqual({ family: "Acme Sans", weight: 400, maxWeight: 400, italic: false, fileName: "font", dataUrl: dataUrl(REGULAR) });
    expect(readProjectFonts("not json")).toEqual([]);
    expect(readProjectFonts("[]")).toEqual([]);
  });

  it(`looks at no more than ${MAX_PROJECT_FONTS} fonts of one file`, () => {
    const many = Array.from({ length: MAX_PROJECT_FONTS + 10 }, (_unused, i) => entry({ family: `F${i}` }));
    expect(readProjectFonts(JSON.stringify({ fonts: many }))).toHaveLength(MAX_PROJECT_FONTS);
  });

  it("stores no font of a file whose pictures cannot be read: such a file is refused whole", async () => {
    const design = designWith("Acme Sans");
    design.pages[0].elements.push(createImage({ src: "asset:gone", width: 10, height: 10 }));
    const raw = { craftly: 1, exportedAt: new Date(0).toISOString(), design, assets: {}, fonts: [entry()] };
    await expect(importProjectFile(fileOf(JSON.stringify(raw)))).rejects.toThrow(/Could not read 1 embedded image/);
    expect(await listCustomFonts()).toEqual([]);
  });

  it("opens the design even when the library cannot take its fonts", async () => {
    const text = await projectWith(designWith("Acme Sans"), [entry()]);
    const persistence = await import("@/core/persistence");
    const put = vi.spyOn(persistence, "dbPut").mockRejectedValue(new Error("no room"));
    const design = await importProjectFile(fileOf(text));
    put.mockRestore();
    expect(await listCustomFonts()).toEqual([]);
    expect((await getDesign(design.id))?.title).toBe("Poster");
  });

  it("opens the design even when its fonts cannot be stored", async () => {
    const text = await projectWith(designWith("Acme Sans"), [entry()]);
    removeFontFaces(); // nothing to check a font with: every font is refused
    const design = await importProjectFile(fileOf(text));
    expect(await listCustomFonts()).toEqual([]);
    expect(firstFamily(design)).toBe("Acme Sans");
  });
});

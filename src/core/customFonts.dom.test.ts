import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cssFontFamily, customFontCss, ensureFont, getFontDef, setCustomFaces } from "@/render/fonts";
import { brokenFont, fontFileOf, installFontFaces, removeFontFaces, sfntBytes, woffBytes, type FontFaces } from "@/test/fontFixtures";
import { wipeDatabase } from "@/test/logicDb";
import { createText } from "./factory";
import {
  FontUploadError,
  addCustomFont,
  checkFontBytes,
  customFamilies,
  deleteCustomFamily,
  fontFamiliesOf,
  importCustomFont,
  listCustomFonts,
  renameCustomFamily,
  startCustomFonts,
  subscribeCustomFonts,
  usableFamilyName,
} from "./customFonts";
import { MAX_FONT_BYTES } from "./fontFile";
import { dbGetAllKeys, dbPut } from "./persistence";
import type { Design, DesignElement } from "./types";

let faces: FontFaces;

beforeEach(async () => {
  await wipeDatabase();
  faces = installFontFaces();
  setCustomFaces([]);
});

afterEach(() => {
  // while there still is a document.fonts to take the faces out of
  setCustomFaces([]);
  removeFontFaces();
});

const regular = () => fontFileOf("AcmeSans-Regular.ttf", sfntBytes({ family: "Acme Sans" }));
const bold = () => fontFileOf("AcmeSans-Bold.ttf", sfntBytes({ family: "Acme Sans", weight: 700 }));
const refusal = async (work: Promise<unknown>): Promise<string> => {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FontUploadError);
  return (error as Error).message;
};

describe("uploading a font", () => {
  it("stores the file, reads its family, weight and style from the inside, and makes it usable at once", async () => {
    const stored = await addCustomFont(fontFileOf("whatever.ttf", sfntBytes({ family: "Acme Sans", weight: 700, italic: true })));
    expect(stored).toMatchObject({ family: "Acme Sans", weight: 700, maxWeight: 700, italic: true, format: "ttf", fileName: "whatever.ttf" });
    expect(stored.size).toBe(stored.data.byteLength);

    const listed = await listCustomFonts();
    expect(listed.map((f) => f.id)).toEqual([stored.id]);
    expect(new Uint8Array(listed[0].data)).toEqual(sfntBytes({ family: "Acme Sans", weight: 700, italic: true }));
    expect(getFontDef("Acme Sans")).toMatchObject({ weights: [700], italic: true });
    expect(cssFontFamily("Acme Sans")).toBe(`"${customFontCss("Acme Sans")}", "Acme Sans", sans-serif`);
  });

  it("checks the file by loading it with FontFace from its bytes, and does not put that trial face into the document", async () => {
    await addCustomFont(regular());
    expect(faces.made).toHaveLength(1);
    expect(typeof faces.made[0].source).not.toBe("string");
    expect(new Uint8Array(faces.made[0].source as ArrayBuffer)).toEqual(sfntBytes({ family: "Acme Sans" }));
    expect(faces.registered.size).toBe(0);
    // drawing with it registers the real face, under the name the app made up
    await ensureFont("Acme Sans");
    expect([...faces.registered].map((f) => f.family)).toEqual([customFontCss("Acme Sans")]);
  });

  it("goes by what is in the file, not by its name or type", async () => {
    const disguised = await addCustomFont(fontFileOf("photo.png", sfntBytes({ family: "Hidden" }), "image/png"));
    expect(disguised).toMatchObject({ family: "Hidden", format: "ttf" });
    expect(await refusal(addCustomFont(fontFileOf("font.ttf", new TextEncoder().encode("<svg onload='x'/>"), "font/ttf")))).toBe(
      "This is not a font file. Craftly takes .ttf, .otf, .woff and .woff2 files.",
    );
  });

  it("refuses a file with the right first bytes that the browser cannot load as a font, and stores nothing", async () => {
    expect(await refusal(addCustomFont(fontFileOf("Acme.ttf", brokenFont(sfntBytes()))))).toBe("This file could not be read as a font. It may be damaged.");
    expect(await listCustomFonts()).toEqual([]);
    expect(await dbGetAllKeys("meta")).toEqual([]);
  });

  it("refuses a file over 10 MB and an empty one", async () => {
    const big = new Uint8Array(MAX_FONT_BYTES + 1);
    big.set(woffBytes("woff2", 8));
    expect(await refusal(addCustomFont(fontFileOf("big.woff2", big)))).toBe("This font file is larger than 10 MB.");
    expect(await refusal(addCustomFont(fontFileOf("empty.ttf", new Uint8Array(0))))).toBe("This file is empty.");
    expect(faces.made).toHaveLength(0);
  });

  it("refuses every file where the browser has nothing to check a font with", async () => {
    vi.stubGlobal("FontFace", undefined);
    expect(await refusal(addCustomFont(regular()))).toBe("This browser cannot check font files, so the font was not added.");
    expect(await listCustomFonts()).toEqual([]);
  });

  it("names a compressed font after its file, with the weight and style the name ends with", async () => {
    expect(await addCustomFont(fontFileOf("Acme Sans-BoldItalic.woff2", woffBytes("woff2")))).toMatchObject({ family: "Acme Sans", weight: 700, italic: true, format: "woff2" });
    expect(await addCustomFont(fontFileOf("Other.woff", woffBytes("woff")))).toMatchObject({ family: "Other", weight: 400, italic: false, format: "woff" });
  });

  it("takes the family name the person gives", async () => {
    expect((await addCustomFont(regular(), { family: "  House \n Font " })).family).toBe("House Font");
  });

  it("never stores a font under the name of a bundled family", async () => {
    const stored = await addCustomFont(fontFileOf("Inter-Regular.ttf", sfntBytes({ family: "Inter" })));
    expect(stored.family).toBe("Inter (uploaded)");
    expect(getFontDef("Inter")?.css).toBe("Inter Variable");
    expect(usableFamilyName("poppins")).toBe("poppins (uploaded)");
    expect(usableFamilyName("Plus Jakarta Sans Variable")).toBe("Plus Jakarta Sans Variable (uploaded)");
    expect(usableFamilyName(" \n ")).toBe("Custom font");
    expect(usableFamilyName("Acme")).toBe("Acme");
  });

  it("puts several files of one family together", async () => {
    await addCustomFont(regular());
    await addCustomFont(bold());
    await addCustomFont(fontFileOf("i.ttf", sfntBytes({ family: "Acme Sans", italic: true })));
    await addCustomFont(fontFileOf("z.ttf", sfntBytes({ family: "Zed" })));
    const families = customFamilies(await listCustomFonts());
    expect(families.map((f) => [f.family, f.files.length])).toEqual([
      ["Acme Sans", 3],
      ["Zed", 1],
    ]);
    expect(getFontDef("Acme Sans")).toMatchObject({ weights: [400, 700], italic: true });
  });

  it("replaces the file a family already has for the same weight and style", async () => {
    const first = await addCustomFont(regular());
    const second = await addCustomFont(fontFileOf("AcmeSans-New.ttf", sfntBytes({ family: "Acme Sans" })));
    const listed = await listCustomFonts();
    expect(listed.map((f) => f.id)).toEqual([second.id]);
    expect(second.id).not.toBe(first.id);
  });

  it("tells whoever listens, after the catalogue knows the font", async () => {
    const seen: Array<string | undefined> = [];
    const stop = subscribeCustomFonts(() => seen.push(getFontDef("Acme Sans")?.family));
    await addCustomFont(regular());
    expect(seen).toEqual(["Acme Sans"]);
    stop();
    await addCustomFont(bold());
    expect(seen).toHaveLength(1);
  });
});

describe("checking bytes that came from a file somebody else made", () => {
  it("says what the file is", async () => {
    expect(await checkFontBytes(sfntBytes({ family: "A", weight: 300 }), "x.ttf")).toEqual({ format: "ttf", family: "A", weight: 300, maxWeight: 300, italic: false });
  });

  it("checks only the bytes it was given when they are part of something larger", async () => {
    const font = sfntBytes({ family: "A" });
    const padded = new Uint8Array(font.length + 20);
    padded.set(font, 10);
    await checkFontBytes(padded.subarray(10, 10 + font.length), "x.ttf");
    expect(new Uint8Array(faces.made[0].source as ArrayBuffer)).toEqual(font);
  });
});

describe("renaming and deleting a family", () => {
  it("renames every file of the family; the old name is no font any more", async () => {
    await addCustomFont(regular());
    await addCustomFont(bold());
    expect(await renameCustomFamily("Acme Sans", " House ")).toBe("House");
    expect((await listCustomFonts()).map((f) => f.family)).toEqual(["House", "House"]);
    expect(getFontDef("House")?.weights).toEqual([400, 700]);
    expect(getFontDef("Acme Sans")).toBeUndefined();
  });

  it("cannot rename a family to the name of a bundled one, and leaves a family alone that is given its own name", async () => {
    await addCustomFont(regular());
    expect(await renameCustomFamily("Acme Sans", "Lora")).toBe("Lora (uploaded)");
    expect(getFontDef("Lora")?.css).toBe("Lora Variable");
    const listener = vi.fn();
    subscribeCustomFonts(listener);
    expect(await renameCustomFamily("Lora (uploaded)", "Lora (uploaded)")).toBe("Lora (uploaded)");
    expect(listener).not.toHaveBeenCalled();
  });

  it("deletes every file of a family and takes its face out of the document", async () => {
    await addCustomFont(regular());
    await addCustomFont(bold());
    await addCustomFont(fontFileOf("z.ttf", sfntBytes({ family: "Zed" })));
    await ensureFont("Acme Sans");
    expect(faces.registered.size).toBe(1);
    expect(await deleteCustomFamily("Acme Sans")).toBe(2);
    expect((await listCustomFonts()).map((f) => f.family)).toEqual(["Zed"]);
    expect(getFontDef("Acme Sans")).toBeUndefined();
    expect(faces.registered.size).toBe(0);
    // a text that still names it draws in the fallback font, under the name it has
    expect(cssFontFamily("Acme Sans")).toBe('"Acme Sans", sans-serif');
  });
});

describe("a font that arrives inside a project file or a backup", () => {
  const incoming = (over: Partial<Parameters<typeof importCustomFont>[0]> = {}) => ({
    bytes: sfntBytes({ family: "Inside Name" }),
    fileName: "Acme.ttf",
    family: "Acme Sans",
    weight: 400,
    maxWeight: 400,
    italic: false,
    ...over,
  });

  it("is checked like an upload and stored under the family the file was used as", async () => {
    expect(await importCustomFont(incoming())).toBe("added");
    expect(await listCustomFonts()).toMatchObject([{ family: "Acme Sans", weight: 400, format: "ttf" }]);
    expect(faces.made).toHaveLength(1);
    expect(getFontDef("Acme Sans")).toBeDefined();
  });

  it("is refused when it is no font or does not load", async () => {
    expect(await importCustomFont(incoming({ bytes: new TextEncoder().encode("<html>") }))).toBe("refused");
    expect(await importCustomFont(incoming({ bytes: brokenFont(sfntBytes()) }))).toBe("refused");
    expect(await listCustomFonts()).toEqual([]);
  });

  it("is never registered under the name of a bundled family, and is not renamed either: the design names the bundled one", async () => {
    expect(await importCustomFont(incoming({ family: "Inter" }))).toBe("refused");
    expect(await importCustomFont(incoming({ family: "inter variable" }))).toBe("refused");
    expect(await importCustomFont(incoming({ family: "  " }))).toBe("refused");
    expect(await listCustomFonts()).toEqual([]);
  });

  it("is left out when this device has it: the same id, or a file for the same family, weight and style", async () => {
    expect(await importCustomFont(incoming({ id: "f_one", createdAt: 5 }))).toBe("added");
    expect((await listCustomFonts())[0]).toMatchObject({ id: "f_one", createdAt: 5 });
    expect(await importCustomFont(incoming({ id: "f_one", family: "Other" }))).toBe("here");
    expect(await importCustomFont(incoming({ id: "f_two" }))).toBe("here");
    expect(await importCustomFont(incoming({ id: "f_three", weight: 700, maxWeight: 700 }))).toBe("added");
    expect(await listCustomFonts()).toHaveLength(2);
  });

  it("gets a weight the document can ask for, whatever the file around it claims", async () => {
    await importCustomFont(incoming({ weight: 12345, maxWeight: -1 }));
    await importCustomFont(incoming({ family: "Flex", weight: 200, maxWeight: 800 }));
    await importCustomFont(incoming({ family: "Odd", weight: Number.NaN, maxWeight: 300 }));
    expect((await listCustomFonts()).map((f) => [f.family, f.weight, f.maxWeight])).toEqual([
      ["Acme Sans", 900, 900],
      ["Flex", 200, 800],
      ["Odd", 400, 400],
    ]);
  });

  it("does not take an id that is not safe to use as a key", async () => {
    expect(await importCustomFont(incoming({ id: "../../x y" }))).toBe("added");
    expect((await listCustomFonts())[0].id).toMatch(/^f_/);
  });
});

describe("when the app starts", () => {
  it("makes the stored fonts known, and a text that waits for one waits for that", async () => {
    await addCustomFont(regular());
    // a new page: nothing is known yet
    setCustomFaces([]);
    expect(getFontDef("Acme Sans")).toBeUndefined();
    const started = startCustomFonts(true);
    const waiting = ensureFont("Acme Sans");
    await started;
    await waiting;
    expect(getFontDef("Acme Sans")).toBeDefined();
    expect([...faces.registered].map((f) => f.family)).toEqual([customFontCss("Acme Sans")]);
  });

  it("reads the storage once, however often it is asked", async () => {
    const first = startCustomFonts(true);
    expect(startCustomFonts()).toBe(first);
    await first;
  });

  it("skips a stored record that is not a font file record, and other settings in the same store", async () => {
    await addCustomFont(regular());
    await dbPut("meta", { id: "f_bad", family: "Bad" }, "customFont:f_bad");
    await dbPut("meta", "not even an object", "customFont:f_worse");
    await dbPut("meta", { colors: [], fonts: [], logos: [] }, "brandKit");
    expect((await listCustomFonts()).map((f) => f.family)).toEqual(["Acme Sans"]);
  });
});

describe("the font families a design uses", () => {
  it("are those of its texts, the runs inside them, tables and charts, in groups too, each once", () => {
    const text = createText({ text: "a", fontFamily: "Acme Sans" });
    text.paragraphs[0].runs[0].font = "Run Font";
    const inner = createText({ text: "b", fontFamily: "Inner" });
    const group = { type: "group", children: [inner] } as unknown as DesignElement;
    const table = { type: "table", fontFamily: "Table Font" } as unknown as DesignElement;
    const chart = { type: "chart", fontFamily: "Acme Sans" } as unknown as DesignElement;
    const shape = { type: "shape" } as unknown as DesignElement;
    const design = { pages: [{ elements: [text, group] }, { elements: [table, chart, shape] }] } as unknown as Design;
    expect(fontFamiliesOf(design)).toEqual(["Acme Sans", "Run Font", "Inner", "Table Font"]);
  });
});

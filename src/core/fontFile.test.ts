import { describe, expect, it } from "vitest";
import { brokenFont, sfntBytes, woffBytes } from "@/test/fontFixtures";
import { MAX_FONT_BYTES, cleanFamilyName, describeFontFile, fontProblem, fromFileName, readSfnt, sniffFontFormat } from "./fontFile";

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("what kind of font file the first bytes say it is", () => {
  it("knows TrueType, OpenType, WOFF and WOFF2 by their first four bytes", () => {
    expect(sniffFontFormat(sfntBytes())).toBe("ttf");
    expect(sniffFontFormat(sfntBytes({ flavor: "otf" }))).toBe("otf");
    expect(sniffFontFormat(ascii("true0000"))).toBe("ttf");
    expect(sniffFontFormat(woffBytes("woff"))).toBe("woff");
    expect(sniffFontFormat(woffBytes("woff2"))).toBe("woff2");
  });

  it("knows a collection of fonts apart, which is not taken", () => {
    expect(sniffFontFormat(ascii("ttcf0000"))).toBe("collection");
  });

  it("takes nothing else for a font, whatever it is called", () => {
    expect(sniffFontFormat(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffFontFormat(ascii("<!doctype html>"))).toBeNull();
    expect(sniffFontFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffFontFormat(new Uint8Array([0, 1]))).toBeNull();
    expect(sniffFontFormat(new Uint8Array(0))).toBeNull();
  });
});

describe("why a file is refused, in plain words", () => {
  it("has nothing to say about a font of a size that is allowed", () => {
    expect(fontProblem(sfntBytes())).toBeNull();
    expect(fontProblem(woffBytes())).toBeNull();
  });

  it("refuses a file that is no font", () => {
    expect(fontProblem(ascii("<svg/>      "))).toBe("This is not a font file. Craftly takes .ttf, .otf, .woff and .woff2 files.");
  });

  it("refuses an empty file", () => {
    expect(fontProblem(new Uint8Array(0))).toBe("This file is empty.");
  });

  it("refuses a file over 10 MB", () => {
    const big = new Uint8Array(MAX_FONT_BYTES + 1);
    big.set(woffBytes("woff2", 8));
    expect(fontProblem(big)).toBe("This font file is larger than 10 MB.");
  });

  it("refuses a collection and says what to upload instead", () => {
    expect(fontProblem(ascii("ttcf00000000"))).toBe("This file holds several fonts in one (a font collection). Upload each font as its own .ttf or .otf file.");
  });
});

describe("reading the names inside a TrueType or OpenType file", () => {
  it("reads the family, the weight and the style", () => {
    expect(readSfnt(sfntBytes({ family: "Acme Sans", weight: 700, italic: true }))).toEqual({ family: "Acme Sans", weight: 700, maxWeight: 700, italic: true });
    expect(readSfnt(sfntBytes({ family: "Other", flavor: "otf" }))).toEqual({ family: "Other", weight: 400, maxWeight: 400, italic: false });
  });

  it("prefers the typographic family, which is the same for every weight of a large family", () => {
    expect(readSfnt(sfntBytes({ family: "Acme Sans Black", typographicFamily: "Acme Sans", weight: 900 }))?.family).toBe("Acme Sans");
  });

  it("reads names written one byte per character", () => {
    expect(readSfnt(sfntBytes({ family: "Old Mac", macNames: true }))?.family).toBe("Old Mac");
  });

  it("reads the range of weights of a variable font", () => {
    expect(readSfnt(sfntBytes({ family: "Flex", range: [200, 800] }))).toEqual({ family: "Flex", weight: 200, maxWeight: 800, italic: false });
  });

  it("keeps a range inside what the document can ask for, in steps of 100", () => {
    expect(readSfnt(sfntBytes({ range: [1, 1000] }))).toMatchObject({ weight: 100, maxWeight: 900 });
    expect(readSfnt(sfntBytes({ weight: 350 }))).toMatchObject({ weight: 400, maxWeight: 400 });
    expect(readSfnt(sfntBytes({ weight: 0 }))).toMatchObject({ weight: 400 });
  });

  it("leaves out what a missing table would have said", () => {
    expect(readSfnt(sfntBytes({ without: ["name"] }))).toEqual({ family: null, weight: 400, maxWeight: 400, italic: false });
    expect(readSfnt(sfntBytes({ weight: 700, without: ["OS/2"] }))).toEqual({ family: "Acme Sans", weight: null, maxWeight: null, italic: false });
    expect(readSfnt(sfntBytes({ italic: true, without: ["OS/2"] }))?.italic).toBe(true);
    expect(readSfnt(sfntBytes({ without: ["OS/2", "head"] }))?.italic).toBeNull();
  });

  it("gives up on a file that is cut short or points outside itself, without throwing", () => {
    const whole = sfntBytes();
    for (let length = 0; length < whole.length; length += 7) expect(() => readSfnt(whole.subarray(0, length))).not.toThrow();
    expect(readSfnt(whole.subarray(0, 10))).toBeNull();

    const wild = sfntBytes();
    // the first table says it starts far behind the end of the file
    new DataView(wild.buffer).setUint32(12 + 8, 0xfffffff0);
    expect(() => readSfnt(wild)).not.toThrow();

    const many = sfntBytes();
    new DataView(many.buffer).setUint16(4, 60000);
    expect(readSfnt(many)).toBeNull();
  });

  it("does not read a compressed font", () => {
    expect(readSfnt(woffBytes("woff"))).toBeNull();
    expect(readSfnt(woffBytes("woff2"))).toBeNull();
  });
});

describe("what a file name says about a font", () => {
  it("takes the family from the name and the weight and style from its last words", () => {
    expect(fromFileName("AcmeSans-BoldItalic.woff2")).toEqual({ family: "AcmeSans", weight: 700, italic: true });
    expect(fromFileName("Acme_Sans-Regular.woff")).toEqual({ family: "Acme Sans", weight: 400, italic: false });
    expect(fromFileName("Acme Sans ExtraBold.ttf")).toEqual({ family: "Acme Sans", weight: 800, italic: false });
    expect(fromFileName("acme-semibold-oblique.otf")).toEqual({ family: "acme", weight: 600, italic: true });
    expect(fromFileName("Acme-ExtraLight.woff2")).toEqual({ family: "Acme", weight: 200, italic: false });
    expect(fromFileName("Acme-Thin.woff2").weight).toBe(100);
    expect(fromFileName("Acme-Light.woff2").weight).toBe(300);
    expect(fromFileName("Acme-Medium.woff2").weight).toBe(500);
    expect(fromFileName("Acme-Black.woff2").weight).toBe(900);
  });

  it("keeps a word that only looks like a style when it is not at the end", () => {
    expect(fromFileName("Bold Street.woff2")).toEqual({ family: "Bold Street", weight: 400, italic: false });
  });

  it("has a name for a file whose name is only a style, or nothing", () => {
    expect(fromFileName("Bold.woff2")).toEqual({ family: "Custom font", weight: 700, italic: false });
    expect(fromFileName(".woff2").family).toBe("Custom font");
    expect(fromFileName("").family).toBe("Custom font");
  });
});

describe("a family name a person or a file gave", () => {
  it("is trimmed, on one line and not longer than 60 characters", () => {
    expect(cleanFamilyName("  Acme \n\t Sans  ")).toBe("Acme Sans");
    expect(cleanFamilyName("x".repeat(200))).toHaveLength(60);
    expect(cleanFamilyName("\u0000\u0007")).toBe("");
  });

  it("keeps quotes and semicolons: they are text, and are escaped where a name goes into CSS", () => {
    expect(cleanFamilyName('A"; } body { x')).toBe('A"; } body { x');
  });
});

describe("describing an uploaded file", () => {
  it("reads a TrueType file from the inside and ignores what its name says", () => {
    expect(describeFontFile(sfntBytes({ family: "Inside", weight: 300 }), "Outside-Bold.ttf")).toEqual({
      format: "ttf",
      family: "Inside",
      weight: 300,
      maxWeight: 300,
      italic: false,
    });
  });

  it("falls back on the file name for what the tables do not say", () => {
    expect(describeFontFile(sfntBytes({ without: ["name", "OS/2", "head"] }), "Outside-BoldItalic.ttf")).toEqual({
      format: "ttf",
      family: "Outside",
      weight: 700,
      maxWeight: 700,
      italic: true,
    });
  });

  it("goes by the file name for a compressed font", () => {
    expect(describeFontFile(woffBytes("woff2"), "Acme Sans-Bold.woff2")).toEqual({ format: "woff2", family: "Acme Sans", weight: 700, maxWeight: 700, italic: false });
  });

  it("is null for a file that is no font, a broken one included only when its first bytes are wrong", () => {
    expect(describeFontFile(ascii("nothing here"), "a.ttf")).toBeNull();
    expect(describeFontFile(brokenFont(sfntBytes()), "a.ttf")?.format).toBe("ttf");
  });
});

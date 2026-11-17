import { describe, expect, it } from "vitest";
import { encodeCmykImage } from "./cmyk";
import { CROP_MARK_GAP_PT, CROP_MARK_LENGTH_PT, CROP_MARK_ROOM_PT, REGISTRATION_CROSS_PT, buildPdf, pdfNumber, registrationCentres, type PdfPageInput } from "./pdf";
import { decodeFlateImage, pdfBox, pdfEntry, readPdfObjects, readPdfPages } from "./pdfTestUtil";

const META = { id: new Uint8Array(16), created: new Date(0), title: "Poster" };
const BLEED = 8.504; // 3 mm in points

/** A 40 x 30 px picture of the page and its bleed: a red background everywhere, a blue box in the middle. */
async function picture() {
  const width = 40;
  const height = 30;
  return encodeCmykImage(width, height, (y, rows) => {
    const rgba = new Uint8ClampedArray(width * rows * 4);
    for (let row = 0; row < rows; row++)
      for (let x = 0; x < width; x++) {
        const inBox = x >= 15 && x < 25 && y + row >= 10 && y + row < 20;
        rgba.set(inBox ? [0, 0, 255, 255] : [255, 0, 0, 255], (row * width + x) * 4);
      }
    return rgba;
  });
}

const text = [{ matrix: [0.75, 0, 0, 0.75, 30, 37.5] as const, pieces: [{ text: "Hello print", x: 0, width: 200, size: 40 }] }];

async function printPage(over: Partial<PdfPageInput> = {}): Promise<PdfPageInput> {
  return { widthPt: 400, heightPt: 300, image: { ...(await picture()), components: 4, png: true }, text, bleedPt: BLEED, cropMarks: true, registrationMarks: true, ...over };
}

/** The straight lines of a content stream ("x y m x y l") as [x1, y1, x2, y2]. */
/** Numbers as the writer rounds them (three decimals). */
const r = (values: number[]) => values.map((v) => Number(pdfNumber(v)));

const r_ = (lines: number[][]) => lines.map(r);
const segments = (content: string) => [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l/g)].map((m) => m.slice(1, 5).map(Number));

describe("a print PDF in CMYK", () => {
  it("is a sound file: every object where the xref says, every /Length exact", async () => {
    const bytes = buildPdf([await printPage()], META);
    expect(Buffer.from(bytes.subarray(0, 9)).toString("latin1")).toBe("%PDF-1.4\n");
    expect(readPdfObjects(bytes).size).toBeGreaterThan(5);
  });

  it("writes the page picture as a deflated 8-bit DeviceCMYK image with PNG predictors", async () => {
    const [{ image, page }] = readPdfPages(buildPdf([await printPage()], META));
    expect(pdfEntry(image.dict, "Subtype")).toBe("/Image");
    expect(pdfEntry(image.dict, "ColorSpace")).toBe("/DeviceCMYK");
    expect(pdfEntry(image.dict, "BitsPerComponent")).toBe("8");
    expect(pdfEntry(image.dict, "Filter")).toBe("/FlateDecode");
    expect(image.dict).toContain("/DecodeParms << /Predictor 15 /Colors 4 /BitsPerComponent 8 /Columns 40 >>");
    expect(image.dict).not.toContain("/DCTDecode");
    expect(page.dict).toContain("/ProcSet [/PDF /Text /ImageC]");
    // read back like a viewer: red is magenta and yellow, the box is cyan and magenta
    const { width, height, components, pixels } = decodeFlateImage(image);
    expect([width, height, components]).toEqual([40, 30, 4]);
    const at = (x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
    expect(at(0, 0)).toEqual([0, 255, 255, 0]);
    expect(at(39, 29)).toEqual([0, 255, 255, 0]);
    expect(at(20, 15)).toEqual([255, 255, 0, 0]);
  });

  it("says where the design, the bleed and the sheet are: TrimBox, BleedBox and a MediaBox with room for the marks", async () => {
    const [{ page, content }] = readPdfPages(buildPdf([await printPage()], META));
    const room = BLEED + CROP_MARK_ROOM_PT;
    expect(pdfBox(page.dict, "TrimBox")).toEqual(r([room, room, room + 400, room + 300]));
    expect(pdfBox(page.dict, "BleedBox")).toEqual(r([room - BLEED, room - BLEED, room + 400 + BLEED, room + 300 + BLEED]));
    expect(pdfBox(page.dict, "MediaBox")).toEqual(r([0, 0, 400 + room * 2, 300 + room * 2]));
    // the picture holds the design and its bleed: it covers exactly the BleedBox
    expect(content.startsWith(`q ${pdfNumber(400 + BLEED * 2)} 0 0 ${pdfNumber(300 + BLEED * 2)} ${CROP_MARK_ROOM_PT} ${CROP_MARK_ROOM_PT} cm /Im0 Do Q\n`)).toBe(true);
  });

  it("draws the crop marks and registration targets as 0.25 pt vector lines in registration colour, outside the bleed", async () => {
    const [{ page, content }] = readPdfPages(buildPdf([await printPage()], META));
    expect(page.dict).toContain("/ColorSpace << /CS0 [/Separation /All /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 1 1 1] /N 1 >>] >>");
    const strokes = content.split("\n").filter((line) => line.startsWith("q 0.25 w /CS0 CS 1 SCN "));
    expect(strokes).toHaveLength(2);
    expect(strokes.every((line) => line.endsWith(" S Q"))).toBe(true);

    const [crop, registration] = strokes;
    const room = BLEED + CROP_MARK_ROOM_PT;
    const near = BLEED + CROP_MARK_GAP_PT;
    const far = near + CROP_MARK_LENGTH_PT;
    // eight crop marks, in line with the edges of the design, starting beyond the bleed
    expect(segments(crop)).toEqual(
      r_([
        [room - far, room, room - near, room],
        [room + 400 + near, room, room + 400 + far, room],
        [room - far, room + 300, room - near, room + 300],
        [room + 400 + near, room + 300, room + 400 + far, room + 300],
        [room, room - far, room, room - near],
        [room, room + 300 + near, room, room + 300 + far],
        [room + 400, room - far, room + 400, room - near],
        [room + 400, room + 300 + near, room + 400, room + 300 + far],
      ]),
    );
    // four targets: a circle (four curves) and a cross at the middle of every edge
    expect(registration.match(/ c /g)).toHaveLength(16);
    const centres = registrationCentres({ widthPt: 400, heightPt: 300 }, BLEED, room);
    expect(centres).toEqual([
      [room + 200, room + 300 + BLEED + CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT / 2],
      [room + 200, room - BLEED - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT / 2],
      [room - BLEED - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT / 2, room + 150],
      [room + 400 + BLEED + CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT / 2, room + 150],
    ]);
    expect(segments(registration)).toHaveLength(8);

    // nothing of either reaches into the bleed or off the sheet
    const [bx0, by0, bx1, by1] = pdfBox(page.dict, "BleedBox") as number[];
    const [, , sheetW, sheetH] = pdfBox(page.dict, "MediaBox") as number[];
    for (const [x1, y1, x2, y2] of [...segments(crop), ...segments(registration)]) {
      const outside = Math.max(x1, x2) < bx0 || Math.min(x1, x2) > bx1 || Math.max(y1, y2) < by0 || Math.min(y1, y2) > by1;
      expect(outside, `${x1} ${y1} ${x2} ${y2}`).toBe(true);
      for (const v of [x1, x2]) expect(v > 0 && v < sheetW).toBe(true);
      for (const v of [y1, y2]) expect(v > 0 && v < sheetH).toBe(true);
    }
    for (const [cx, cy] of centres) {
      expect(cx - REGISTRATION_CROSS_PT > 0 && cy - REGISTRATION_CROSS_PT > 0 && cx + REGISTRATION_CROSS_PT < sheetW && cy + REGISTRATION_CROSS_PT < sheetH).toBe(true);
    }
  });

  it("keeps the invisible text layer over the CMYK picture, so the text can still be selected and searched", async () => {
    const bytes = buildPdf([await printPage()], META);
    const [{ page, content }] = readPdfPages(bytes);
    const room = BLEED + CROP_MARK_ROOM_PT;
    // "Hello" as WinAnsi bytes, in text rendering mode 3 (invisible), moved in with the design
    expect(content).toMatch(
      new RegExp(
        `BT 3 Tr 0\\.75 0 0 0\\.75 ${pdfNumber(30 + room).replace(".", "\\.")} ${pdfNumber(262.5 + room).replace(".", "\\.")} Tm /F0 40 Tf [\\d.]+ Tz <48656C6C6F207072696E74> Tj ET`,
      ),
    );
    // the text comes after the picture and the marks, so it lies on top
    expect(content.indexOf("BT")).toBeGreaterThan(content.lastIndexOf(" S Q"));
    expect(page.dict).toMatch(/\/Font << \/F0 \d+ 0 R >>/);
    const objects = [...readPdfObjects(bytes).values()];
    expect(objects.some((o) => o.dict.includes("/BaseFont /Helvetica"))).toBe(true);
    expect(objects.some((o) => o.dict.includes("/ToUnicode"))).toBe(true);
  });

  it("can have registration targets without crop marks, and CMYK without any marks", async () => {
    const onlyTargets = readPdfPages(buildPdf([await printPage({ cropMarks: false })], META))[0];
    expect(onlyTargets.content.match(/q 0\.25 w /g)).toHaveLength(1);
    expect(pdfBox(onlyTargets.page.dict, "TrimBox")?.[0]).toBe(BLEED + CROP_MARK_ROOM_PT);
    const bare = readPdfPages(buildPdf([await printPage({ cropMarks: false, registrationMarks: false, bleedPt: 0 })], META))[0];
    expect(bare.page.dict).not.toContain("/TrimBox");
    expect(bare.page.dict).not.toContain("/Separation");
    expect(pdfEntry(bare.image.dict, "ColorSpace")).toBe("/DeviceCMYK");
  });

  it("refuses a page without a picture", () => {
    expect(() => buildPdf([{ widthPt: 10, heightPt: 10 }], META)).toThrow("A PDF page needs a picture.");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPdf, type PdfPageInput } from "./pdf";

/**
 * The PDF that is downloaded without any print option is protected byte for byte: these digests were taken from the writer
 * as it was before the print options (CMYK pages, registration marks, the print resolution) were added, and must not change.
 */

/** A structurally valid JPEG skeleton: SOI, SOF0 with the size, EOI. */
function fakeJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
}

const META = { id: new Uint8Array(16), created: new Date(0), title: "Menu" };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const pages: PdfPageInput[] = [
  {
    widthPt: 720,
    heightPt: 405,
    jpeg: fakeJpeg(1440, 810),
    links: [{ url: "https://craftly.test/a", x: 10, y: 20, w: 100, h: 30 }],
    text: [{ matrix: [0.75, 0, 0, 0.75, 30, 37.5], pieces: [{ text: "Hello world", x: 0, width: 200, size: 40 }] }],
  },
  { widthPt: 720, heightPt: 405, jpeg: fakeJpeg(1440, 810) },
];

describe("the PDF without print options", () => {
  it("is the same, byte for byte, as before the print options existed", () => {
    expect(sha(buildPdf(pages, META))).toBe("813f54af9cf9fc7fc12149eb07d7dc6b088bf24b7a9047b7f6169e371fab4335");
    expect(sha(buildPdf([pages[1]], META))).toBe("0454575be4c919357a5821ce9336bfa9a1343eb2b010a8acc53d32952df88d66");
  });
});

import { describe, expect, it } from "vitest";
import { getAsset } from "@/core/assets";
import { createShape, createText, paragraphsToText, solid } from "@/core/factory";
import type { DesignElement } from "@/core/types";
import { buildPptxParts } from "./pptx";
import { importPptx } from "./pptxImport";
import { createZip } from "./zip";

async function fileOf(parts: ReturnType<typeof buildPptxParts>): Promise<File> {
  return new File([await createZip(parts)], "Imported deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

describe("basic PPTX import", () => {
  it("reads slide size, editable text, rectangles and pictures", async () => {
    const text = createText({ x: 100, y: 50, width: 400, height: 100, rotation: 15, text: "Editable", fontSize: 32 });
    const rectangle = createShape("rect", { x: 600, y: 100, width: 200, height: 150, fill: solid("#112233") });
    const parts = buildPptxParts({
      title: "Deck",
      width: 1280,
      height: 720,
      slides: [
        { image: new Uint8Array([0xff, 0xd8, 1]), type: "image/jpeg", name: "First", alt: "Background", objects: [text, rectangle] },
        { image: new Uint8Array([0xff, 0xd8, 2]), type: "image/jpeg" },
      ],
    });
    const design = await importPptx(await fileOf(parts));
    expect([design.width, design.height]).toEqual([1280, 720]);
    expect(design.pages).toHaveLength(2);
    expect(design.pages[0].name).toBe("First");
    const importedText = design.pages[0].elements.find((el) => el.type === "text");
    expect(importedText?.type).toBe("text");
    if (importedText?.type === "text") {
      expect(paragraphsToText(importedText.paragraphs)).toBe("Editable");
      expect(importedText.rotation).toBe(15);
      expect(importedText.fontSize).toBe(32);
    }
    const importedRect = design.pages[0].elements.find((el) => el.type === "shape");
    expect(importedRect).toMatchObject({ type: "shape", shape: "rect", fill: { type: "solid", color: "#112233" } });
    expect(design.pages[0].elements.some((el) => el.type === "image" && el.src?.startsWith("asset:"))).toBe(true);
  });

  it("refuses a ZIP that is not a presentation", async () => {
    const file = new File([await createZip([{ name: "hello.txt", data: new TextEncoder().encode("hello") }])], "notes.pptx");
    await expect(importPptx(file)).rejects.toThrow(/not a PowerPoint/);
  });
});

/*
 * Files that PowerPoint and other programs write differ from the ones Craftly writes, so the tests below build the parts of a
 * package by hand: a presentation part, slides made of the shapes given, and whatever else a test adds.
 */
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const EMU = 9525;
const PRESENTATION = `${HEAD}<p:presentation ${NS}><p:sldSz cx="${640 * EMU}" cy="${480 * EMU}"/></p:presentation>`;
const slide = (shapes: string, name?: string) => `${HEAD}<p:sld ${NS}><p:cSld${name ? ` name="${name}"` : ""}><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
const rels = (...items: string[]) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
/** A box in design pixels, as the EMU of a transform. */
const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm>`;
const textShape = (paragraphs: string, properties = `<p:spPr>${xfrm(10, 20, 300, 100)}</p:spPr>`) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/></p:nvSpPr>${properties}<p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>`;
const run = (text: string) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;

async function deck(parts: Record<string, string | Uint8Array>, name = "Hand made.pptx"): Promise<File> {
  const encoder = new TextEncoder();
  const all = { "ppt/presentation.xml": PRESENTATION, ...parts };
  const entries = Object.entries(all).map(([entry, data]) => ({ name: entry, data: typeof data === "string" ? encoder.encode(data) : data }));
  return new File([await createZip(entries)], name);
}
/** The elements of the first page of a package made of this one slide. */
async function importedElements(xml: string): Promise<DesignElement[]> {
  return (await importPptx(await deck({ "ppt/slides/slide1.xml": xml }))).pages[0].elements;
}
const textOf = (el: DesignElement) => (el.type === "text" ? paragraphsToText(el.paragraphs) : el.type);

describe("PPTX import of files from other programs", () => {
  it("styles text from the properties of its first run: weight, slant, underline, colour, size and typeface", async () => {
    const [text] = await importedElements(
      slide(
        textShape(
          '<a:p><a:pPr algn="ctr"/><a:r><a:rPr b="1" i="1" u="sng" sz="2400"><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>Big</a:t></a:r></a:p>' +
            '<a:p><a:pPr algn="r"/><a:r><a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Right</a:t></a:r></a:p>' +
            '<a:p><a:pPr algn="just"/><a:r><a:rPr><a:solidFill><a:srgbClr val="red"/></a:solidFill></a:rPr><a:t>Even</a:t></a:r></a:p>',
        ),
      ),
    );
    expect(text).toMatchObject({
      type: "text",
      x: 10,
      y: 20,
      width: 300,
      height: 100,
      fontSize: 24,
      fontFamily: "Georgia",
      color: "#aabbcc",
      fontWeight: 700,
      italic: true,
      underline: true,
    });
    if (text.type !== "text") throw new Error("expected text");
    // centred and right-aligned paragraphs keep their alignment; justified text, which the importer does not read, has none
    expect(text.paragraphs.map((paragraph) => paragraph.align)).toEqual(["center", "right", undefined]);
    expect(text.paragraphs[0].runs[0]).toEqual({ text: "Big", bold: true, italic: true, underline: true, color: "#aabbcc", size: 24, font: "Georgia" });
    // a theme colour, or a value that is not six hex digits, gives a run no colour of its own
    expect(text.paragraphs[1].runs[0]).toEqual({ text: "Right" });
    expect(text.paragraphs[2].runs[0]).toEqual({ text: "Even" });
  });

  it("gives plain text the defaults of a text box, skips empty runs and keeps an empty paragraph as a blank line", async () => {
    const [text] = await importedElements(slide(textShape('<a:p><a:r><a:t>Plain</a:t></a:r><a:r><a:t></a:t></a:r><a:r><a:rPr b="1"/></a:r></a:p><a:p/>', "")));
    expect(text).toMatchObject({ type: "text", fontSize: 18, fontFamily: "Arial", color: "#000000", fontWeight: 400, italic: false, underline: false });
    if (text.type !== "text") throw new Error("expected text");
    expect(text.paragraphs).toEqual([{ runs: [{ text: "Plain" }] }, { runs: [{ text: "" }] }]);
    expect(textOf(text)).toBe("Plain\n");
    // without shape properties the box sits at the corner, one pixel across, and unturned
    expect([text.x, text.y, text.width, text.height, text.rotation]).toEqual([0, 0, 1, 1, 0]);
  });

  it("reads a transform whose numbers are not numbers as a one-pixel box at the corner of the slide", async () => {
    const [text] = await importedElements(slide(textShape(run("Odd"), '<p:spPr><a:xfrm rot="abc"><a:off x="left" y=""/><a:ext cx="NaN" cy="-"/></a:xfrm></p:spPr>')));
    expect([text.x, text.y, text.width, text.height, text.rotation]).toEqual([0, 0, 1, 1, 0]);
  });

  it("imports rectangles with their fill and outline, and leaves out other shapes that hold no text", async () => {
    const elements = await importedElements(
      slide(
        `<p:sp><p:spPr>${xfrm(5, 6, 70, 80)}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:ln w="${3 * EMU}"><a:solidFill><a:srgbClr val="445566"/></a:solidFill></a:ln></p:spPr></p:sp>` +
          `<p:sp><p:spPr>${xfrm(1, 2, 30, 40)}<a:prstGeom prst="rect"/></p:spPr><p:txBody><a:p><a:r><a:t></a:t></a:r></a:p></p:txBody></p:sp>` +
          '<p:sp><p:spPr><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>' +
          `<p:sp><p:spPr>${xfrm(1, 2, 30, 40)}<a:prstGeom prst="ellipse"/></p:spPr></p:sp>`,
      ),
    );
    expect(elements).toHaveLength(3);
    const [filled, bare, thin] = elements;
    expect(filled).toMatchObject({
      type: "shape",
      shape: "rect",
      x: 5,
      y: 6,
      width: 70,
      height: 80,
      fill: { type: "solid", color: "#112233" },
      stroke: { color: "#445566", width: 3, style: "solid" },
    });
    // a box whose text is empty is a rectangle, not a text box, and one without fill or outline has neither
    expect(bare).toMatchObject({ type: "shape", shape: "rect", fill: null, stroke: null });
    // an outline without a width is one pixel wide
    expect(thin).toMatchObject({ type: "shape", fill: { type: "solid", color: "#ffffff" }, stroke: { color: "#000000", width: 1 } });
  });

  it("reads a rectangle whose geometry is not inside a block of shape properties", async () => {
    const [rect] = await importedElements(slide('<p:sp><a:prstGeom prst="rect"/></p:sp>'));
    expect(rect).toMatchObject({ type: "shape", shape: "rect", x: 0, y: 0, width: 1, height: 1, fill: null, stroke: null });
  });

  it("imports pictures by their relationship, as PNG, WebP or JPEG, and drops those whose picture is missing", async () => {
    const picture = (blip: string, extra = "") => `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture"${extra}/></p:nvPicPr><p:blipFill>${blip}</p:blipFill>`;
    const design = await importPptx(
      await deck({
        "ppt/slides/slide1.xml": slide(
          `${picture('<a:blip r:embed="rIdPng"/>', ' descr="A logo"')}<p:spPr>${xfrm(4, 5, 60, 70)}</p:spPr></p:pic>` +
            // a blip may name its relationship without the prefix, and a picture may have no shape properties
            `${picture('<a:blip embed="rIdWebp"/>')}</p:pic>` +
            `${picture('<a:blip r:embed="rIdJpeg"/>')}</p:pic>` +
            // a relationship to a part the package does not have, an id with no relationship, and no blip at all
            `${picture('<a:blip r:embed="rIdGone"/>')}</p:pic>` +
            `${picture('<a:blip r:embed="rIdNowhere"/>')}</p:pic>` +
            `${picture("")}</p:pic>`,
        ),
        "ppt/slides/_rels/slide1.xml.rels": rels(
          '<Relationship Id="rIdPng" Target="../media/logo.png"/>',
          // "." and empty steps of a path are skipped
          '<Relationship Id="rIdWebp" Target="./..//media/photo.webp"/>',
          '<Relationship Id="rIdJpeg" Target="../media/photo.jpg"/>',
          '<Relationship Id="rIdGone" Target="../media/missing.png"/>',
          // a relationship without an id or a target is of no use, but does not stop the rest
          "<Relationship/>",
        ),
        "ppt/media/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        "ppt/media/photo.webp": new Uint8Array([0x52, 0x49, 0x46, 0x46]),
        "ppt/media/photo.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
      }),
    );
    const images = design.pages[0].elements;
    expect(images.map((el) => el.type)).toEqual(["image", "image", "image"]);
    expect(images[0]).toMatchObject({ x: 4, y: 5, width: 60, height: 70, alt: "A logo" });
    expect(images[1]).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect(images[1].type === "image" && images[1].alt).toBeFalsy();
    const types = await Promise.all(images.map(async (el) => (el.type === "image" ? (await getAsset(el.src!.replace(/^asset:/, "")))?.mime : null)));
    expect(types).toEqual(["image/png", "image/webp", "image/jpeg"]);
  });

  it("skips slides without a tree of shapes and content that is not PowerPoint's own, and orders slides by number", async () => {
    const design = await importPptx(
      await deck({
        "ppt/slides/slide10.xml": slide(textShape(run("Ten")), "Tenth"),
        "ppt/slides/slide2.xml": slide(
          // a shape wrapped in another namespace, and a group, are not read
          `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${textShape(run("Hidden"))}</mc:AlternateContent>` +
            `<p:grpSp><p:nvGrpSpPr/>${textShape(run("Grouped"))}</p:grpSp>` +
            textShape(run("Two")),
          "Second",
        ),
        "ppt/slides/slide3.xml": `${HEAD}<p:sld ${NS}><p:cSld name="Empty"/></p:sld>`,
      }),
    );
    expect(design.pages.map((page) => page.name)).toEqual(["Second", "Tenth"]);
    expect(design.pages[0].elements.map(textOf)).toEqual(["Two"]);
    expect([design.width, design.height]).toEqual([640, 480]);
  });

  it("names the design after the file, or generically when the file has no name before its extension", async () => {
    const parts = { "ppt/slides/slide1.xml": slide("") };
    expect((await importPptx(await deck(parts, "Quarterly.PPTX"))).title).toBe("Quarterly");
    expect((await importPptx(await deck(parts, ".pptx"))).title).toBe("Imported presentation");
  });

  it("falls back to a 1920 by 1080 slide when the presentation does not give its size", async () => {
    const design = await importPptx(await deck({ "ppt/presentation.xml": `${HEAD}<p:presentation ${NS}/>`, "ppt/slides/slide1.xml": slide("") }));
    expect([design.width, design.height]).toEqual([1920, 1080]);
  });

  it("refuses a presentation without slides, or whose slides have no shapes at all", async () => {
    await expect(importPptx(await deck({}))).rejects.toThrow(/no slides/);
    await expect(importPptx(await deck({ "ppt/slides/slide1.xml": `${HEAD}<p:sld ${NS}/>` }))).rejects.toThrow(/no slides/);
  });

  it("refuses a presentation whose XML cannot be read", async () => {
    await expect(importPptx(await deck({ "ppt/presentation.xml": "<p:presentation>" }))).rejects.toThrow(/unreadable XML/);
    await expect(importPptx(await deck({ "ppt/slides/slide1.xml": `${HEAD}<p:sld ${NS}><unclosed></p:sld>` }))).rejects.toThrow(/unreadable XML/);
  });
});

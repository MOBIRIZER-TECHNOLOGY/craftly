import { addAssetFromBlob, assetSrc } from "@/core/assets";
import { createDesign, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import { EMU_PER_PX } from "./pptx";
import { openZip, type ZipArchive } from "./zipRead";
import type { Design, DesignElement, Page, TextParagraph, TextRun } from "@/core/types";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";

function elements(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === local);
}
function first(root: Document | Element, local: string): Element | null {
  return elements(root, local)[0] ?? null;
}
function numberAttr(el: Element | null, name: string, fallback = 0): number {
  const value = Number(el?.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}
function xml(document: string): Document {
  const parsed = new DOMParser().parseFromString(document, "application/xml");
  if (parsed.querySelector("parsererror")) throw new Error("The PowerPoint file contains unreadable XML.");
  return parsed;
}
function box(root: Document | Element): { x: number; y: number; width: number; height: number; rotation: number } {
  const transform = first(root, "xfrm");
  const offset = transform ? first(transform, "off") : null;
  const extent = transform ? first(transform, "ext") : null;
  return {
    x: Math.round(numberAttr(offset, "x") / EMU_PER_PX),
    y: Math.round(numberAttr(offset, "y") / EMU_PER_PX),
    width: Math.max(1, Math.round(numberAttr(extent, "cx", EMU_PER_PX) / EMU_PER_PX)),
    height: Math.max(1, Math.round(numberAttr(extent, "cy", EMU_PER_PX) / EMU_PER_PX)),
    rotation: numberAttr(transform, "rot") / 60000,
  };
}
function hex(root: Document | Element | null): string | null {
  const value = root && first(root, "srgbClr")?.getAttribute("val");
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null;
}
function paragraph(root: Element): TextParagraph {
  const runs: TextRun[] = [];
  for (const node of elements(root, "r")) {
    const properties = first(node, "rPr");
    const text = first(node, "t")?.textContent ?? "";
    if (!text) continue;
    runs.push({
      text,
      ...(properties?.getAttribute("b") === "1" ? { bold: true } : {}),
      ...(properties?.getAttribute("i") === "1" ? { italic: true } : {}),
      ...(properties?.getAttribute("u") ? { underline: true } : {}),
      ...(hex(first(properties ?? root, "solidFill")) ? { color: hex(first(properties ?? root, "solidFill"))! } : {}),
      ...(numberAttr(properties, "sz") ? { size: numberAttr(properties, "sz") / 100 } : {}),
      ...(first(properties ?? root, "latin")?.getAttribute("typeface") ? { font: first(properties ?? root, "latin")!.getAttribute("typeface")! } : {}),
    });
  }
  const alignment = first(root, "pPr")?.getAttribute("algn");
  return { runs: runs.length ? runs : [{ text: "" }], ...(alignment === "ctr" ? { align: "center" } : alignment === "r" ? { align: "right" } : {}) };
}

async function relationships(archive: ZipArchive, slide: number): Promise<Map<string, string>> {
  const entry = archive.find(`ppt/slides/_rels/slide${slide}.xml.rels`);
  if (!entry) return new Map();
  const document = xml(await archive.text(entry));
  return new Map(elements(document, "Relationship").map((rel) => [rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? ""]));
}
function mediaPath(target: string): string {
  const parts = ["ppt", "slides"];
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

async function picture(root: Element, rels: Map<string, string>, archive: ZipArchive): Promise<DesignElement | null> {
  const embed = first(root, "blip")?.getAttribute("r:embed") ?? first(root, "blip")?.getAttribute("embed");
  const entry = embed ? archive.find(mediaPath(rels.get(embed) ?? "")) : undefined;
  if (!entry) return null;
  const blob = await archive.read(entry, { type: entry.name.endsWith(".png") ? "image/png" : entry.name.endsWith(".webp") ? "image/webp" : "image/jpeg" });
  const asset = await addAssetFromBlob(blob, entry.name.split("/").pop() ?? "PowerPoint picture");
  return createImage({
    ...box(first(root, "spPr") ?? root),
    src: assetSrc(asset.id),
    naturalWidth: asset.width,
    naturalHeight: asset.height,
    alt: first(root, "cNvPr")?.getAttribute("descr") ?? undefined,
  });
}

function textBox(root: Element): DesignElement {
  const paragraphs = elements(first(root, "txBody") ?? root, "p").map(paragraph);
  const firstRun = paragraphs.flatMap((item) => item.runs)[0];
  const text = paragraphs.map((item) => item.runs.map((run) => run.text).join("")).join("\n");
  return createText({
    ...box(first(root, "spPr") ?? root),
    text,
    paragraphs,
    autoWidth: false,
    fontSize: firstRun?.size ?? 18,
    fontFamily: firstRun?.font ?? "Arial",
    color: firstRun?.color ?? "#000000",
    fontWeight: firstRun?.bold ? 700 : 400,
    italic: !!firstRun?.italic,
    underline: !!firstRun?.underline,
  });
}

function rectangle(root: Element): DesignElement {
  const properties = first(root, "spPr") ?? root;
  const line = first(properties, "ln");
  return createShape("rect", {
    ...box(properties),
    fill: hex(first(properties, "solidFill")) ? solid(hex(first(properties, "solidFill"))!) : null,
    stroke:
      hex(first(line ?? properties, "solidFill")) && line
        ? { color: hex(first(line, "solidFill"))!, width: Math.max(1, numberAttr(line, "w", EMU_PER_PX) / EMU_PER_PX), style: "solid" }
        : null,
  });
}

export async function importPptx(file: File): Promise<Design> {
  const archive = await openZip(file);
  const presentationEntry = archive.find("ppt/presentation.xml");
  if (!presentationEntry) throw new Error("This is not a PowerPoint presentation.");
  const presentation = xml(await archive.text(presentationEntry));
  const size = first(presentation, "sldSz");
  const width = Math.max(1, Math.round(numberAttr(size, "cx", 1920 * EMU_PER_PX) / EMU_PER_PX));
  const height = Math.max(1, Math.round(numberAttr(size, "cy", 1080 * EMU_PER_PX) / EMU_PER_PX));
  const slides = archive.entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => Number(a.name.match(/\d+/)?.[0]) - Number(b.name.match(/\d+/)?.[0]));
  const pages: Page[] = [];
  for (const entry of slides) {
    const slideNumber = Number(entry.name.match(/\d+/)?.[0] ?? pages.length + 1);
    const document = xml(await archive.text(entry));
    const rels = await relationships(archive, slideNumber);
    const content: DesignElement[] = [];
    const tree = first(document, "spTree");
    if (!tree) continue;
    for (const root of Array.from(tree.children)) {
      if (root.namespaceURI !== P) continue;
      if (root.localName === "sp") {
        const hasText = !!first(root, "txBody") && elements(root, "t").some((node) => !!node.textContent);
        const geometry = first(root, "prstGeom")?.getAttribute("prst");
        if (hasText) content.push(textBox(root));
        else if (geometry === "rect") content.push(rectangle(root));
      } else if (root.localName === "pic") {
        const image = await picture(root, rels, archive);
        if (image) content.push(image);
      }
    }
    pages.push(createPage({ elements: content, name: first(document, "cSld")?.getAttribute("name") ?? undefined }));
  }
  if (!pages.length) throw new Error("The PowerPoint presentation has no slides.");
  return createDesign({ title: file.name.replace(/\.pptx$/i, "") || "Imported presentation", width, height, pages });
}

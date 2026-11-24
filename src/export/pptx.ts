/**
 * Writes a PowerPoint file (.pptx): the parts of the package as text and bytes, for a ZIP. Pure: no DOM, no painting.
 *
 * A slide holds one picture that fills it, the page as the editor painted it, so a slide looks like its page in every program
 * that opens the file. The text of a page is part of that picture and cannot be edited there. With `notes`, each slide that
 * has presenter notes gets a notes page with them.
 *
 * The parts are the fewest a presentation needs: one slide master with one blank layout and a theme, the slides, their
 * pictures, and for notes a notes master with a theme of its own. Everything a person wrote (title, names, notes, alternative
 * text) is escaped, and characters that XML does not allow are left out.
 */

import type { PageTransition } from "@/core/types";
import { pptxObjectLinks, pptxObjectXml, type PptxObject } from "./pptxObjects";

export interface PptxSlide {
  /** the picture of the page */
  image: Uint8Array;
  type: "image/jpeg" | "image/png";
  /** the name of the page, shown in the outline of the presentation */
  name?: string;
  /** what the picture shows, for a screen reader */
  alt?: string;
  /** presenter notes; written only when the file is asked to hold notes */
  notes?: string;
  /** native editable text boxes and rectangles, removed from the background picture by the exporter */
  objects?: PptxObject[];
  /** transition into this page */
  transition?: PageTransition;
}

export interface PptxInput {
  title: string;
  /** the size of a page in design pixels (96 to the inch) */
  width: number;
  height: number;
  slides: PptxSlide[];
  /** write the presenter notes into the file */
  notes?: boolean;
  /** when the file was made; left out of the file when absent */
  created?: Date;
}

export interface PptxPart {
  name: string;
  data: Uint8Array;
}

/** English Metric Units: 914,400 to the inch, so 9,525 to a design pixel. */
export const EMU_PER_PX = 9525;
/** PowerPoint takes slides from 1 inch to 56 inches a side. */
export const MIN_SLIDE_EMU = 914_400;
export const MAX_SLIDE_EMU = 51_206_400;
/** A notes page: portrait, 7.5 by 10 inches. */
const NOTES_CX = 6_858_000;
const NOTES_CY = 9_144_000;

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

/** Text as XML takes it: the five characters of markup escaped, and no character that XML 1.0 forbids. */
export function xmlText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- these are the characters XML 1.0 does not allow
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      // a half of a surrogate pair on its own is no character
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

/**
 * The size of a slide for a page of this size, in EMU. A page keeps its size; one that is larger or smaller than PowerPoint
 * takes is scaled, both sides alike, and a page so long and thin that one side still falls outside is held at the limit there.
 */
export function slideSize(width: number, height: number): { cx: number; cy: number } {
  const w = Math.max(1, width) * EMU_PER_PX;
  const h = Math.max(1, height) * EMU_PER_PX;
  let scale = 1;
  if (Math.max(w, h) > MAX_SLIDE_EMU) scale = MAX_SLIDE_EMU / Math.max(w, h);
  else if (Math.min(w, h) < MIN_SLIDE_EMU) scale = Math.min(MIN_SLIDE_EMU / Math.min(w, h), MAX_SLIDE_EMU / Math.max(w, h));
  const fit = (emu: number) => Math.min(MAX_SLIDE_EMU, Math.max(MIN_SLIDE_EMU, Math.round(emu * scale)));
  return { cx: fit(w), cy: fit(h) };
}

const rels = (items: Array<[id: string, type: string, target: string, mode?: string]>): string =>
  `${HEAD}<Relationships xmlns="${PKG_REL}">${items.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}</Relationships>`;

/** The empty group every tree of shapes begins with. */
const TREE_HEAD =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const WHITE_BG = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
const COLOUR_MAP =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const MASTER_MAP = "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>";

function theme(name: string): string {
  const colour = (tag: string, hex: string) => `<a:${tag}><a:srgbClr val="${hex}"/></a:${tag}>`;
  const colours = [
    colour("dk1", "000000"),
    colour("lt1", "FFFFFF"),
    colour("dk2", "1F2937"),
    colour("lt2", "F3F4F6"),
    colour("accent1", "7C3AED"),
    colour("accent2", "2563EB"),
    colour("accent3", "0D9488"),
    colour("accent4", "F97316"),
    colour("accent5", "DB2777"),
    colour("accent6", "65A30D"),
    colour("hlink", "2563EB"),
    colour("folHlink", "7C3AED"),
  ].join("");
  const font = (tag: string) => `<a:${tag}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="9525">${fill}</a:ln>`;
  const effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
  const three = (one: string) => one + one + one;
  return (
    `${HEAD}<a:theme xmlns:a="${NS_A}" name="${name}"><a:themeElements>` +
    `<a:clrScheme name="${name}">${colours}</a:clrScheme>` +
    `<a:fontScheme name="${name}">${font("majorFont")}${font("minorFont")}</a:fontScheme>` +
    `<a:fmtScheme name="${name}"><a:fillStyleLst>${three(fill)}</a:fillStyleLst><a:lnStyleLst>${three(line)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${three(effect)}</a:effectStyleLst><a:bgFillStyleLst>${three(fill)}</a:bgFillStyleLst></a:fmtScheme>` +
    "</a:themeElements></a:theme>"
  );
}

function transitionXml(transition?: PageTransition): string {
  if (!transition) return "";
  const speed = transition.duration <= 0.6 ? "fast" : transition.duration <= 1.2 ? "med" : "slow";
  const direction = transition.direction === "right" ? "r" : transition.direction === "up" ? "u" : transition.direction === "down" ? "d" : "l";
  const body =
    transition.kind === "slide"
      ? `<p:slide dir="${direction}"/>`
      : transition.kind === "push"
        ? `<p:push dir="${direction}"/>`
        : transition.kind === "wipe"
          ? `<p:wipe dir="${direction}"/>`
          : transition.kind === "zoom"
            ? "<p:zoom/>"
            : `<p:fade${transition.kind === "fade-black" ? ' thruBlk="1"' : ""}/>`;
  return `<p:transition spd="${speed}">${body}</p:transition>`;
}

function slideXml(slide: PptxSlide, index: number, cx: number, cy: number): string {
  const name = slide.name?.trim();
  const alt = slide.alt?.trim();
  const objects = slide.objects ?? [];
  return (
    `${HEAD}<p:sld ${NS}><p:cSld${name ? ` name="${xmlText(name)}"` : ""}><p:spTree>${TREE_HEAD}` +
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${index + 1}"${alt ? ` descr="${xmlText(alt)}"` : ""}/>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
    objects.map((object, i) => pptxObjectXml(object, i + 10, EMU_PER_PX, `rId${100 + i}`)).join("") +
    `</p:spTree></p:cSld>${transitionXml(slide.transition)}${MASTER_MAP}</p:sld>`
  );
}

/** A placeholder of a notes page or of the notes master, with a box when the master lays it out. */
function notesShape(id: number, name: string, placeholder: string, locks: string, box: string, body: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks ${locks}/></p:cNvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr>${box}</p:spPr>${body}</p:sp>`;
}

const SLIDE_IMAGE_LOCKS = 'noGrp="1" noRot="1" noChangeAspect="1"';

function notesMasterXml(): string {
  const box = (x: number, y: number, cx: number, cy: number) =>
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  const image = notesShape(2, "Slide Image Placeholder 1", '<p:ph type="sldImg" idx="2"/>', SLIDE_IMAGE_LOCKS, box(685_800, 1_143_000, 5_486_400, 3_086_100), "");
  const text = notesShape(
    3,
    "Notes Placeholder 2",
    '<p:ph type="body" sz="quarter" idx="3"/>',
    'noGrp="1"',
    box(685_800, 4_400_550, 5_486_400, 3_600_450),
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>',
  );
  return `${HEAD}<p:notesMaster ${NS}><p:cSld>${WHITE_BG}<p:spTree>${TREE_HEAD}${image}${text}</p:spTree></p:cSld>${COLOUR_MAP}</p:notesMaster>`;
}

function notesSlideXml(notes: string): string {
  const paragraphs = notes
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line ? `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlText(line)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US"/></a:p>'))
    .join("");
  const image = notesShape(2, "Slide Image Placeholder 1", '<p:ph type="sldImg"/>', SLIDE_IMAGE_LOCKS, "", "");
  const text = notesShape(3, "Notes Placeholder 2", '<p:ph type="body" idx="1"/>', 'noGrp="1"', "", `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody>`);
  return `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${TREE_HEAD}${image}${text}</p:spTree></p:cSld>${MASTER_MAP}</p:notes>`;
}

/**
 * The parts of the package, the list of content types first. Throws a RangeError without a slide: a presentation has at least
 * one, and the caller says so in its own words before it comes to that.
 */
export function buildPptxParts(input: PptxInput): PptxPart[] {
  if (!input.slides.length) throw new RangeError("A presentation needs at least one slide");
  const encoder = new TextEncoder();
  const { cx, cy } = slideSize(input.width, input.height);
  const count = input.slides.length;
  /** the notes of each slide, when the file holds notes and the slide has some */
  const notes = input.slides.map((slide) => (input.notes ? (slide.notes ?? "").trim() : ""));
  const withNotes = notes.some(Boolean);
  const extension = (slide: PptxSlide) => (slide.type === "image/png" ? "png" : "jpeg");
  const parts: PptxPart[] = [];
  const add = (name: string, text: string) => parts.push({ name, data: encoder.encode(text) });

  const overrides: Array<[part: string, type: string]> = [
    ["/ppt/presentation.xml", `${CT}.presentationml.presentation.main+xml`],
    ["/ppt/slideMasters/slideMaster1.xml", `${CT}.presentationml.slideMaster+xml`],
    ["/ppt/slideLayouts/slideLayout1.xml", `${CT}.presentationml.slideLayout+xml`],
    ["/ppt/theme/theme1.xml", `${CT}.theme+xml`],
    ...input.slides.map((_slide, i): [string, string] => [`/ppt/slides/slide${i + 1}.xml`, `${CT}.presentationml.slide+xml`]),
    ...(withNotes ? ([["/ppt/notesMasters/notesMaster1.xml", `${CT}.presentationml.notesMaster+xml`], ["/ppt/theme/theme2.xml", `${CT}.theme+xml`]] as Array<[string, string]>) : []), // prettier-ignore
    ...notes.flatMap((text, i): Array<[string, string]> => (text ? [[`/ppt/notesSlides/notesSlide${i + 1}.xml`, `${CT}.presentationml.notesSlide+xml`]] : [])),
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", `${CT}.extended-properties+xml`],
  ];
  const kinds = new Set(input.slides.map(extension));
  add(
    "[Content_Types].xml",
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      (kinds.has("jpeg") ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : "") +
      (kinds.has("png") ? '<Default Extension="png" ContentType="image/png"/>' : "") +
      overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("") +
      "</Types>",
  );
  add(
    "_rels/.rels",
    rels([
      ["rId1", `${REL}/officeDocument`, "ppt/presentation.xml"],
      ["rId2", `${PKG_REL}/metadata/core-properties`, "docProps/core.xml"],
      ["rId3", `${REL}/extended-properties`, "docProps/app.xml"],
    ]),
  );
  add(
    "docProps/core.xml",
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xmlText(input.title)}</dc:title><dc:creator>Craftly</dc:creator>` +
      (input.created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${input.created.toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>` : "") +
      "</cp:coreProperties>",
  );
  add(
    "docProps/app.xml",
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Craftly</Application><Slides>${count}</Slides></Properties>`,
  );

  // the presentation: rId1 the master, then the slides, then the notes master and the theme
  const notesMasterId = `rId${count + 2}`;
  add(
    "ppt/presentation.xml",
    `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      (withNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterId}"/></p:notesMasterIdLst>` : "") +
      `<p:sldIdLst>${input.slides.map((_slide, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>` +
      `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${NOTES_CX}" cy="${NOTES_CY}"/></p:presentation>`,
  );
  add(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["rId1", `${REL}/slideMaster`, "slideMasters/slideMaster1.xml"],
      ...input.slides.map((_slide, i): [string, string, string] => [`rId${i + 2}`, `${REL}/slide`, `slides/slide${i + 1}.xml`]),
      ...(withNotes ? ([[notesMasterId, `${REL}/notesMaster`, "notesMasters/notesMaster1.xml"]] as Array<[string, string, string]>) : []),
      [`rId${count + 3}`, `${REL}/theme`, "theme/theme1.xml"],
    ]),
  );
  add("ppt/theme/theme1.xml", theme("Craftly"));
  add(
    "ppt/slideMasters/slideMaster1.xml",
    `${HEAD}<p:sldMaster ${NS}><p:cSld>${WHITE_BG}<p:spTree>${TREE_HEAD}</p:spTree></p:cSld>${COLOUR_MAP}` +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
  );
  add(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
      ["rId2", `${REL}/theme`, "../theme/theme1.xml"],
    ]),
  );
  add(
    "ppt/slideLayouts/slideLayout1.xml",
    `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${TREE_HEAD}</p:spTree></p:cSld>${MASTER_MAP}</p:sldLayout>`,
  );
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", `${REL}/slideMaster`, "../slideMasters/slideMaster1.xml"]]));

  input.slides.forEach((slide, i) => {
    const n = i + 1;
    const media = `image${n}.${extension(slide)}`;
    add(`ppt/slides/slide${n}.xml`, slideXml(slide, i, cx, cy));
    add(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      rels([
        ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
        ["rId2", `${REL}/image`, `../media/${media}`],
        ...(notes[i] ? ([["rId3", `${REL}/notesSlide`, `../notesSlides/notesSlide${n}.xml`]] as Array<[string, string, string]>) : []),
        ...pptxObjectLinks(slide.objects ?? []).map((link): [string, string, string, string] => [link.id, `${REL}/hyperlink`, link.url, "External"]),
      ]),
    );
    parts.push({ name: `ppt/media/${media}`, data: slide.image });
    if (notes[i]) {
      add(`ppt/notesSlides/notesSlide${n}.xml`, notesSlideXml(notes[i]));
      add(
        `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        rels([
          ["rId1", `${REL}/notesMaster`, "../notesMasters/notesMaster1.xml"],
          ["rId2", `${REL}/slide`, `../slides/slide${n}.xml`],
        ]),
      );
    }
  });
  if (withNotes) {
    add("ppt/notesMasters/notesMaster1.xml", notesMasterXml());
    add("ppt/notesMasters/_rels/notesMaster1.xml.rels", rels([["rId1", `${REL}/theme`, "../theme/theme2.xml"]]));
    add("ppt/theme/theme2.xml", theme("Craftly notes"));
  }
  return parts;
}

/**
 * Planning for "Several sizes": which sizes are offered for a design, which are ticked to begin with, what the
 * files are called and how much one download may hold. Pure (no DOM, no React), so it is unit tested in node;
 * the export itself is in multiSize.ts.
 */
import type { Design } from "@/core/types";
import { DESIGN_TYPES, getDesignType, type DesignCategory, type DesignType } from "@/data/designTypes";
import { englishName } from "@/data/names";
import { m } from "@/i18n";
import type { ExportOptions } from "./exporters";
import { DEFAULT_QUALITY, normalizePages, planRaster, safeFileName } from "./options";

export type MultiSizeFormat = "png" | "jpg" | "pdf";

export interface SizeChoice {
  /** the id of the format, or CURRENT_SIZE_ID for the size the design has */
  id: string;
  /** the name as the panel shows it, in the language of the page */
  name: string;
  /** the name the files are given: English in every language, so a file is called the same whoever downloads it */
  fileName?: string;
  /** design pixels */
  width: number;
  height: number;
  current: boolean;
}

export const CURRENT_SIZE_ID = "current";
/**
 * The name of the size a design has when it is no format of its own. It is part of the names of the files, which stay in
 * English; the panel shows it in the language of the page (`m.exporting.panel.originalSize`).
 */
export const ORIGINAL_SIZE_NAME = "Original size";
/** Sizes in one download. Every size is a whole export of the chosen pages. */
export const MAX_SIZES = 10;
/** Pixels painted in one download, over all sizes and pages. */
export const MAX_TOTAL_PIXELS = 250_000_000;

type Sized = Pick<Design, "width" | "height" | "typeId">;

export interface MultiSizePlan {
  sizes: SizeChoice[];
  files: number;
  totalPixels: number;
  problem: string | null;
}

/** The format a design is: the one it was made as while it still has that size, else the first of its size. */
function formatOf(design: Sized): DesignType | undefined {
  const same = (t: DesignType) => t.width === design.width && t.height === design.height;
  const made = getDesignType(design.typeId);
  return made && same(made) ? made : DESIGN_TYPES.find(same);
}

/** The formats a design belongs with. A size that is no format is most likely a picture for a feed. */
function familyOf(design: Sized): DesignCategory {
  return (formatOf(design) ?? getDesignType(design.typeId))?.category ?? "social";
}

/**
 * What can be ticked: the size the design has, then the formats of its family, then every other format.
 * A size appears once, whatever it is called elsewhere (US Letter is a flyer, a menu, a document and a resume).
 */
export function sizeChoices(design: Sized): SizeChoice[] {
  const family = familyOf(design);
  const own = formatOf(design);
  const choices: SizeChoice[] = [
    {
      id: CURRENT_SIZE_ID,
      name: own?.name ?? ORIGINAL_SIZE_NAME,
      fileName: own ? englishName("designTypes", own.id) || own.name : ORIGINAL_SIZE_NAME,
      width: design.width,
      height: design.height,
      current: true,
    },
  ];
  const seen = new Set([`${design.width}x${design.height}`]);
  for (const type of [...DESIGN_TYPES.filter((t) => t.category === family), ...DESIGN_TYPES.filter((t) => t.category !== family)]) {
    const key = `${type.width}x${type.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ id: type.id, name: type.name, fileName: englishName("designTypes", type.id) || type.name, width: type.width, height: type.height, current: false });
  }
  return choices;
}

/** Ticked to begin with: the size of the design and up to three of its family, the popular ones first. */
export function defaultSizeIds(design: Sized): string[] {
  const family = familyOf(design);
  const offered = new Set(sizeChoices(design).map((c) => c.id));
  const own = DESIGN_TYPES.filter((t) => t.category === family && offered.has(t.id));
  const picked = [...own.filter((t) => t.popular), ...own.filter((t) => !t.popular)].slice(0, 3);
  return [CURRENT_SIZE_ID, ...picked.map((t) => t.id)];
}

/** "1080 × 1920 px": always pixels, because that is what the files are measured in. */
export function sizeLabel(size: Pick<SizeChoice, "width" | "height">): string {
  return `${size.width} × ${size.height} px`;
}

/**
 * "Menu - Instagram Story 1080x1920 - 3.png". The title and the name of the format are cleaned apart, so a long
 * title cannot push out the part that tells the sizes apart; the pixel size is in every name because two formats
 * can share a name's beginning but never a size.
 */
export function multiSizeFileName(title: string, size: SizeChoice, pageNumber: number | null, extension: string): string {
  const page = pageNumber === null ? "" : ` - ${pageNumber}`;
  return `${safeFileName(title)} - ${safeFileName(size.fileName ?? size.name, "Size")} ${size.width}x${size.height}${page}.${extension}`;
}

export function multiSizeZipName(title: string, sizes: number): string {
  return `${safeFileName(title)} - ${sizes} ${sizes === 1 ? "size" : "sizes"}.zip`;
}

/** The PDF of the panel's "Digital" preset: 1.5 x, crisp on a dense screen. */
const PDF_SCALE = 1.5;

/**
 * The options every size is exported with. A picture is exactly as many pixels as the size says (that is the point
 * of choosing it), with a background; a PDF is the one for screens.
 */
export function multiSizeOptions(format: MultiSizeFormat, quality: number, pages: number[]): ExportOptions {
  const pdf = format === "pdf";
  return { format, pages, scale: pdf ? PDF_SCALE : 1, quality: pdf ? DEFAULT_QUALITY : quality, transparent: false, pdfMode: "standard", embedFonts: true };
}

const millions = (pixels: number) => Math.round(pixels / 1_000_000);

/**
 * What a download of these sizes and pages comes to, and why it cannot be made if it cannot. `selected` may hold
 * ids that are not offered (they are ignored); the sizes come back in the order of the list.
 */
export function planMultiSize(design: Sized & { pages: readonly unknown[] }, selected: readonly string[], pages: readonly number[], format: MultiSizeFormat): MultiSizePlan {
  const wanted = new Set(selected);
  const sizes = sizeChoices(design).filter((c) => wanted.has(c.id));
  const pageCount = normalizePages(pages, design.pages.length).length;
  let totalPixels = 0;
  for (const size of sizes) {
    const raster = planRaster(size.width, size.height, { format, scale: format === "pdf" ? PDF_SCALE : 1, pdfMode: "standard" });
    totalPixels += raster.width * raster.height * pageCount;
  }
  let problem: string | null = null;
  if (!sizes.length) problem = m.exporting.sizes.tickOne;
  else if (!pageCount) problem = m.exporting.errors.noPages;
  else if (sizes.length > MAX_SIZES) problem = m.exporting.sizes.tooMany(sizes.length, MAX_SIZES);
  else if (totalPixels > MAX_TOTAL_PIXELS) problem = m.exporting.sizes.tooManyPixels(millions(totalPixels), millions(MAX_TOTAL_PIXELS));
  return { sizes, files: sizes.length * (format === "pdf" ? 1 : pageCount), totalPixels, problem };
}

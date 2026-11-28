import { parseColor } from "@/core/color";
import { safeLinkUrl } from "./links";
import { xmlText } from "./pptx";
import type { Page, ShapeElement, TextElement, TextParagraph, TextRun } from "@/core/types";

export type PptxObject = TextElement | ShapeElement;

const NATIVE_SHAPES: Record<string, string> = {
  rect: "rect",
  ellipse: "ellipse",
  triangle: "triangle",
  "right-triangle": "rtTriangle",
  diamond: "diamond",
  trapezoid: "trapezoid",
  parallelogram: "parallelogram",
  pentagon: "regularPentagon",
  hexagon: "hexagon",
  octagon: "octagon",
  "star-4": "star4",
  star: "star5",
  "star-6": "star6",
  "arrow-right": "rightArrow",
  "arrow-left": "leftArrow",
  "arrow-up": "upArrow",
  "arrow-down": "downArrow",
  chevron: "chevron",
  "double-arrow": "leftRightArrow",
  heart: "heart",
  plus: "mathPlus",
  cross: "mathMultiply",
  lightning: "lightningBolt",
  moon: "moon",
  cloud: "cloud",
};

function nativeShape(el: ShapeElement): string | null {
  if (el.shape === "rect" && el.radius > 0) return "roundRect";
  return NATIVE_SHAPES[el.shape] ?? null;
}

export function pptxObjects(page: Page): PptxObject[] {
  return page.elements.filter((el): el is PptxObject => {
    if (el.hidden) return false;
    if (el.type === "text") return el.effect.kind === "none" && !el.gradient && el.curve === 0;
    return el.type === "shape" && !!nativeShape(el) && (!el.fill || el.fill.type === "solid") && (!el.stroke || el.stroke.style === "solid");
  });
}

function color(value: string, opacity = 1): string {
  const parsed = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const hex = [parsed.r, parsed.g, parsed.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const alpha = Math.round(parsed.a * opacity * 100000);
  return `<a:srgbClr val="${hex}">${alpha < 100000 ? `<a:alpha val="${alpha}"/>` : ""}</a:srgbClr>`;
}

function transform(el: PptxObject, emu: number): string {
  return `<a:xfrm${el.rotation ? ` rot="${Math.round(el.rotation * 60000)}"` : ""}><a:off x="${Math.round(el.x * emu)}" y="${Math.round(el.y * emu)}"/><a:ext cx="${Math.max(1, Math.round(el.width * emu))}" cy="${Math.max(1, Math.round(el.height * emu))}"/></a:xfrm>`;
}

function relationship(el: PptxObject, linkId?: string): string {
  return linkId && safeLinkUrl(el.link) ? `<a:hlinkClick r:id="${linkId}"/>` : "";
}

function runXml(el: TextElement, run: TextRun): string {
  const size = Math.max(100, Math.round((run.size ?? el.fontSize) * 100));
  const bold = run.bold ?? (run.weight ?? el.fontWeight) >= 600;
  const italic = run.italic ?? el.italic;
  const underline = run.underline ?? el.underline;
  const strike = run.strike ?? el.strike;
  return `<a:r><a:rPr lang="en-US" sz="${size}"${bold ? ' b="1"' : ""}${italic ? ' i="1"' : ""}${underline ? ' u="sng"' : ""}${strike ? ' strike="sngStrike"' : ""}><a:solidFill>${color(run.color ?? el.color, el.opacity)}</a:solidFill><a:latin typeface="${xmlText(run.font ?? el.fontFamily)}"/></a:rPr><a:t>${xmlText(run.text)}</a:t></a:r>`;
}

function paragraphXml(el: TextElement, paragraph: TextParagraph): string {
  const align = paragraph.align ?? el.align;
  const value = align === "center" ? "ctr" : align === "right" ? "r" : align === "justify" ? "just" : "l";
  const runs = paragraph.runs.length ? paragraph.runs.map((run) => runXml(el, run)).join("") : `<a:endParaRPr lang="en-US"/>`;
  return `<a:p><a:pPr algn="${value}"/>${runs}</a:p>`;
}

function textXml(el: TextElement, id: number, emu: number, linkId?: string): string {
  const body = el.paragraphs.map((paragraph) => paragraphXml(el, paragraph)).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlText(el.name || `Text ${id}`)}"${el.alt ? ` descr="${xmlText(el.alt)}"` : ""}>${relationship(el, linkId)}</p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${transform(el, emu)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function shapeXml(el: ShapeElement, id: number, emu: number, linkId?: string): string {
  const fill = el.fill?.type === "solid" ? `<a:solidFill>${color(el.fill.color, el.opacity)}</a:solidFill>` : "<a:noFill/>";
  const stroke =
    el.stroke && el.stroke.width > 0 ? `<a:ln w="${Math.max(1, Math.round(el.stroke.width * emu))}"><a:solidFill>${color(el.stroke.color, el.opacity)}</a:solidFill></a:ln>` : "";
  const preset = nativeShape(el) ?? "rect";
  const adjustment =
    preset === "roundRect"
      ? Math.round((Math.min(el.radius, Math.min(el.width, el.height) / 2) / Math.min(el.width, el.height)) * 100000)
      : preset.startsWith("star") && el.params?.inner
        ? Math.round(el.params.inner * 100000)
        : null;
  const adjustments = adjustment === null ? "" : `<a:gd name="adj" fmla="val ${adjustment}"/>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlText(el.name || `Shape ${id}`)}"${el.alt ? ` descr="${xmlText(el.alt)}"` : ""}>${relationship(el, linkId)}</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(el, emu)}<a:prstGeom prst="${preset}"><a:avLst>${adjustments}</a:avLst></a:prstGeom>${fill}${stroke}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

export function pptxObjectXml(el: PptxObject, id: number, emu: number, linkId?: string): string {
  return el.type === "text" ? textXml(el, id, emu, linkId) : shapeXml(el, id, emu, linkId);
}

export function pptxObjectLinks(objects: PptxObject[]): Array<{ id: string; url: string }> {
  return objects.flatMap((el, index) => {
    const url = safeLinkUrl(el.link);
    return url ? [{ id: `rId${100 + index}`, url }] : [];
  });
}

/**
 * "Convert to shapes" as an action of the editor: a graphic, or an uploaded picture whose file is an SVG drawing, is replaced
 * by the shapes it is drawn from (src/core/svgImport.ts), so that their points, fills and outlines can be edited. A text box
 * is replaced by the outlines of its letters (text to points, src/render/textOutline.ts). The file of a picture, or the font
 * files of a text, are read first, so the action finishes a moment after it was asked for, and what the person did in that
 * moment wins. Whatever stops it, the page stays as it is and the person is told why.
 */
import { getAsset } from "@/core/assets";
import { locate } from "@/core/ops";
import { getActions, getActivePage, pageOf, useEditor } from "@/core/store";
import { MAX_POINTS, MAX_SHAPES, convertToShapes as shapesInPlaceOf, type ConvertedElement } from "@/core/svgImport";
import type { DesignElement, GraphicElement, ID, ImageElement, TextElement } from "@/core/types";
import type { TextShapes } from "@/render/textOutline";
import { m } from "@/i18n";
import { toast } from "@/ui";
import { keepFocusInEditor } from "./combine";

const ASSET = "asset:";

/**
 * Whether the element is a drawing "Convert to shapes" is offered for: a graphic, or a picture that was uploaded. Whether an
 * upload is a drawing or a photo is only known once its file was read, so the menu offers it for both and the action says which.
 */
const isDrawing = (el: DesignElement | null): el is ImageElement | GraphicElement => el?.type === "graphic" || (el?.type === "image" && !!el.src?.startsWith(ASSET));

const isConvertible = (el: DesignElement | null): el is ImageElement | GraphicElement | TextElement => isDrawing(el) || el?.type === "text";

/** Whether the element may be shown "Convert to shapes" at all (it is switched off while the element is locked). */
export const offersConvertToShapes = isConvertible;

export const canConvertToShapes = (el: DesignElement | null): boolean => isConvertible(el) && !el.locked;

/** The markup to convert: nothing to pass for a graphic, which has its own; null for a picture that is not a drawing. */
async function markupOf(el: ImageElement | GraphicElement): Promise<string | undefined | null> {
  if (el.type === "graphic") return undefined;
  const asset = await getAsset((el.src as string).slice(ASSET.length));
  return asset?.kind === "svg" ? asset.blob.text() : null;
}

/** What the person is told after a conversion. */
const summary = (made: ConvertedElement): string => m.editor.convert.drawingDone(made.count, made.skipped, made.simplified);

/** What the person is told when a drawing was not converted. */
function refusal(problem: NonNullable<ConvertedElement["problem"]>): string {
  if (problem === "not-plain") return m.editor.convert.notPlain;
  if (problem === "unreadable") return m.editor.convert.drawingUnreadable;
  return m.editor.convert.drawingTooLarge(MAX_SHAPES, MAX_POINTS);
}

/**
 * Replaces the element `id` of the open page by the shapes of its drawing: a group of them, or the shape itself when there is
 * one, selected, in one step of undo. Resolves to whether that happened.
 */
export async function convertToShapes(id: ID): Promise<boolean> {
  const page = getActivePage(useEditor.getState());
  const hit = page && locate(page.elements, id);
  if (!page || !hit || !isConvertible(hit.el) || hit.el.locked) return false;
  const el = hit.el;
  if (hit.parent) {
    toast.info(m.editor.convert.inGroup);
    return false;
  }
  if (el.type === "text") return convertText(el, page.id);
  let markup: string | undefined | null;
  try {
    markup = await markupOf(el);
  } catch {
    toast.error(m.editor.convert.pictureUnreadable);
    return false;
  }
  if (markup === null) {
    toast.info(m.editor.convert.pixels);
    return false;
  }
  // an element that was edited since is another object
  if (pageOf(useEditor.getState().design, page.id)?.elements.includes(el) !== true) {
    toast.info(m.editor.convert.pictureChanged);
    return false;
  }
  const made = shapesInPlaceOf(el, markup);
  if (!made.element) {
    toast.info(made.problem ? refusal(made.problem) : m.editor.convert.nothingConverted);
    return false;
  }
  getActions().replaceElements([el.id], made.element, page.id);
  keepFocusInEditor();
  toast.success(summary(made));
  return true;
}

/** What the person is told when a text was not converted. */
function textRefusal(made: TextShapes): string {
  switch (made.problem) {
    case "curved":
      return m.editor.convert.curved;
    case "no-font":
      return m.editor.convert.noFont(made.noFont);
    case "too-large":
      return m.editor.convert.textTooLarge(MAX_SHAPES, MAX_POINTS);
    default:
      return m.editor.convert.noLetters;
  }
}

/** What the person is told after a text was converted. */
function textSummary(made: TextShapes): string {
  return m.editor.convert.textDone(made.count, made.missing, made.effectDropped);
}

/** Replaces the text box by the outlines of its letters, in one step of undo. */
async function convertText(el: TextElement, pageId: ID): Promise<boolean> {
  let made: TextShapes;
  try {
    const { textToShapes } = await import("@/render/textOutline");
    made = await textToShapes(el);
  } catch (error) {
    console.error("Craftly could not convert a text to shapes", error);
    toast.error(m.editor.convert.fontUnreadable);
    return false;
  }
  if (pageOf(useEditor.getState().design, pageId)?.elements.includes(el) !== true) {
    toast.info(m.editor.convert.textChanged);
    return false;
  }
  if (!made.element) {
    toast.info(textRefusal(made));
    return false;
  }
  getActions().replaceElements([el.id], made.element, pageId);
  keepFocusInEditor();
  toast.success(textSummary(made));
  return true;
}

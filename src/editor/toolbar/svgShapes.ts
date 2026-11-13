/**
 * "Convert to shapes" as an action of the editor: a graphic, or an uploaded picture whose file is an SVG drawing, is replaced
 * by the shapes it is drawn from (src/core/svgImport.ts), so that their points, fills and outlines can be edited. The file of
 * a picture is read from the library first, so the action finishes a moment after it was asked for, and what the person did
 * in that moment wins. Whatever stops it, the page stays as it is and the person is told why.
 */
import { getAsset } from "@/core/assets";
import { locate } from "@/core/ops";
import { getActions, getActivePage, pageOf, useEditor } from "@/core/store";
import { MAX_POINTS, MAX_SHAPES, convertToShapes as shapesInPlaceOf, type ConvertedElement } from "@/core/svgImport";
import type { DesignElement, GraphicElement, ID, ImageElement } from "@/core/types";
import { toast } from "@/ui";
import { keepFocusInEditor } from "./combine";

const ASSET = "asset:";

/**
 * Whether the element is one "Convert to shapes" is offered for: a graphic, or a picture that was uploaded. Whether an upload is
 * a drawing or a photo is only known once its file was read, so the menu offers it for both and the action says which it was.
 */
const isDrawing = (el: DesignElement | null): el is ImageElement | GraphicElement => el?.type === "graphic" || (el?.type === "image" && !!el.src?.startsWith(ASSET));

/** Whether the element may be shown "Convert to shapes" at all (it is switched off while the element is locked). */
export const offersConvertToShapes = isDrawing;

export const canConvertToShapes = (el: DesignElement | null): boolean => isDrawing(el) && !el.locked;

/** The markup to convert: nothing to pass for a graphic, which has its own; null for a picture that is not a drawing. */
async function markupOf(el: ImageElement | GraphicElement): Promise<string | undefined | null> {
  if (el.type === "graphic") return undefined;
  const asset = await getAsset((el.src as string).slice(ASSET.length));
  return asset?.kind === "svg" ? asset.blob.text() : null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the person is told after a conversion. */
function summary(made: ConvertedElement): string {
  const parts = [`Converted to ${count(made.count, "shape", "shapes")}.`];
  if (made.skipped) parts.push(`${count(made.skipped, "part could not be converted and was", "parts could not be converted and were")} left out.`);
  if (made.simplified) parts.push(`${count(made.simplified, "part was", "parts were")} made simpler: clipping, masks, effects and patterns are not kept.`);
  return parts.join(" ");
}

const REFUSED: Record<NonNullable<ConvertedElement["problem"]>, string> = {
  "not-plain": "This drawing has parts that cannot become shapes (text, pictures or styles), so it stays as it is.",
  unreadable: "The drawing could not be read, so nothing was changed.",
  "too-large": `This drawing is too large to convert: it has more than ${MAX_SHAPES.toLocaleString("en-US")} shapes or ${MAX_POINTS.toLocaleString("en-US")} points. Nothing was changed.`,
};

/**
 * Replaces the element `id` of the open page by the shapes of its drawing: a group of them, or the shape itself when there is
 * one, selected, in one step of undo. Resolves to whether that happened.
 */
export async function convertToShapes(id: ID): Promise<boolean> {
  const page = getActivePage(useEditor.getState());
  const hit = page && locate(page.elements, id);
  if (!page || !hit || !isDrawing(hit.el) || hit.el.locked) return false;
  const el = hit.el;
  if (hit.parent) {
    toast.info("Take it out of its group first: inside a group it cannot be converted to shapes.");
    return false;
  }
  let markup: string | undefined | null;
  try {
    markup = await markupOf(el);
  } catch {
    toast.error("The picture could not be read, so nothing was changed. Try again.");
    return false;
  }
  if (markup === null) {
    toast.info("Only a picture that is an SVG drawing can be converted to shapes. This one is made of pixels.");
    return false;
  }
  // an element that was edited since is another object
  if (pageOf(useEditor.getState().design, page.id)?.elements.includes(el) !== true) {
    toast.info("The picture changed in the meantime, so nothing was changed.");
    return false;
  }
  const made = shapesInPlaceOf(el, markup);
  if (!made.element) {
    toast.info(made.problem ? REFUSED[made.problem] : "Nothing in this drawing could be converted to shapes, so it stays a picture.");
    return false;
  }
  getActions().replaceElements([el.id], made.element, page.id);
  keepFocusInEditor();
  toast.success(summary(made));
  return true;
}

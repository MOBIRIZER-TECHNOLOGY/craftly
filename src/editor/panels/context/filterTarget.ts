import { clipFilter } from "@/core/factory";
import type { DesignElement, ImageElement, ImageFilter, VideoElement } from "@/core/types";
import { videoPosterKey } from "@/render/images";

/** What the Filters panel works on: a photo, or a clip (its filter is on every frame). */
export type FilterTarget = ImageElement | VideoElement;

/** The filter of a photo or a clip (a clip without one has none: defaultFilter). */
export const filterOf = (el: FilterTarget): ImageFilter => (el.type === "image" ? el.filter : clipFilter(el));

/** The key of the picture that the panel's previews show: the photo, or the clip's frame where it starts playing. */
export const pictureKey = (el: FilterTarget): string => (el.type === "image" ? (el.src as string) : videoPosterKey(el));

/** Gives a photo or a clip the filter `make` makes from its own; anything else is left as it is. */
export function setFilter(el: DesignElement, make: (filter: ImageFilter) => ImageFilter): void {
  if (el.type === "image") el.filter = make(el.filter);
  else if (el.type === "video") el.filter = make(clipFilter(el));
}

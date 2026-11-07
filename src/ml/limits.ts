/** How large a picture the on-device tools may make. One place, so the cut-out and the upscaler agree. */

/** Canva's own upload ceiling. A PNG with transparency above this is too heavy to keep and export. */
export const MAX_OUTPUT_PIXELS = 25_000_000;
/** Browsers refuse canvases wider than this (Safari's limit is the strictest of the big three). */
export const MAX_SIDE = 16_384;

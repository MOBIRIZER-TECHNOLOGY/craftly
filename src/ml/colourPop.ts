/**
 * "Colour pop": takes the colour out of everything behind the main subject of a picture and leaves the subject in colour.
 * Pixel maths only (no DOM, no canvas), so it runs in plain tests, and the work can be done a few rows at a time: the screen
 * stays alive and Cancel works.
 *
 * Every pixel behind the subject goes part of the way to its own grey, and the subject (coverage 1) is never touched, byte
 * for byte. Where the model's outline is soft (coverage between 0 and 1) the pixel is mixed from its colour and its grey in
 * proportion, so the colour fades out over the pixels the mask fades over. Pixels that are not there (transparent) and the
 * opacity of the others are left as they are.
 */
import { checkInputs, coverSampler, type CoverageMask, type Picture } from "./coverage";

export type PopStyle = "black-and-white" | "faded";
export const POP_STYLES: readonly PopStyle[] = ["black-and-white", "faded"];

/** How much of the colour behind the subject goes: all of it, or 60 % of it. */
const AMOUNT: Record<PopStyle, number> = { "black-and-white": 1, faded: 0.6 };

export const popAmount = (style: PopStyle): number => AMOUNT[style];

/** The weights of the CSS `grayscale()` filter, the app's own black and white: the grey of a colour is this mix of its channels. */
const RED = 0.2126;
const GREEN = 0.7152;
const BLUE = 0.0722;

/** A pixel counts as changed when one of its numbers moved by at least this much: less cannot be seen. */
const VISIBLE = 1.5;
/** ... and only when it is at least half there (the faint rim of an anti-aliased edge, turned grey, is not seen either) and on the background side of the outline (the subject's own outline is greyed a little too, but that is no colour taken out of the background). */
const HALF_THERE = 128;

/** Fewer changed pixels than this share of the picture is not worth saving: the background has no colour to take out. */
export const MIN_CHANGED_SHARE = 0.001;

export interface ColourPop {
  /**
   * Takes the colour out of the rows from `from` up to (not including) `to` of the picture, behind the subject. Returns how
   * many pixels of the background changed so that it can be seen (those at least half there, by two levels or more in a channel).
   */
  paintRows(from: number, to: number): number;
}

export function createColourPop(picture: Picture, mask: CoverageMask, amount: number): ColourPop {
  checkInputs(picture, mask);
  const { rgba, width, height } = picture;
  const cover = coverSampler(mask, width, height);
  const coverRow = new Float32Array(width);

  return {
    paintRows(from, to) {
      let changed = 0;
      for (let y = from; y < to; y++) {
        cover(y, coverRow);
        for (let x = 0; x < width; x++) {
          const c = coverRow[x]!;
          if (!(c < 0.999)) continue; // the subject stays exactly as it is (and so does a value that is not a number)
          const p = (y * width + x) * 4;
          const alpha = rgba[p + 3]!;
          if (alpha === 0) continue; // nothing there
          const r = rgba[p]!;
          const g = rgba[p + 1]!;
          const b = rgba[p + 2]!;
          const grey = RED * r + GREEN * g + BLUE * b;
          const k = (1 - c) * amount; // how far this pixel goes from its colour to its grey
          const newR = r * (1 - k) + grey * k;
          const newG = g * (1 - k) + grey * k;
          const newB = b * (1 - k) + grey * k;
          rgba[p] = newR;
          rgba[p + 1] = newG;
          rgba[p + 2] = newB;
          if (c < 0.5 && alpha >= HALF_THERE && (Math.abs(newR - r) >= VISIBLE || Math.abs(newG - g) >= VISIBLE || Math.abs(newB - b) >= VISIBLE)) changed++;
        }
      }
      return changed;
    },
  };
}

/** The whole picture in one call, for callers that do not need to work in pieces. Returns how many pixels changed so that it can be seen. */
export function popColourBehindSubject(picture: Picture, mask: CoverageMask, amount: number): number {
  return createColourPop(picture, mask, amount).paintRows(0, picture.height);
}

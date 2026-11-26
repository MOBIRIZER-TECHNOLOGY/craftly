/**
 * Splitting a page in two at a moment of it (the timeline's Split): the first page lasts until that moment, the second is a copy
 * of the page that goes on from there. A clip is an element that is on its page all the time it lasts, so a clip cannot be cut in
 * two on one page (the second part would cover the first with its first frame while waiting); cutting the page is how a clip is
 * split here, as "Split page" is in other editors.
 *
 * On the second page every clip goes on from where it was: one that had started starts at once from the place it had reached (its
 * trim, its captions and its fade in moved with it), one that had not yet started starts that much sooner, and one that played once
 * and ended holds its last frame. Entrances play on the first page only and exits on the second only, so nothing comes in twice or
 * goes out early. The transition into the page stays with the first page; the second follows it with a cut.
 *
 * A clip that plays over and over starts again from its beginning on the second page: a loop that starts part-way cannot be held
 * in a clip's fields.
 *
 * Pure: no store, no DOM. The second page has the same element ids as the first; the store gives it fresh ones.
 */
import { MIN_PAGE_DURATION, clipCaptions, clipLoopFrom, clipPlayingLength, clipStartAt, pageClipLength, pageDuration } from "./animation";
import { cloneDeep } from "./clone";
import type { DesignElement, Page, VideoElement } from "./types";

/** Seconds are kept to the tenth, as a page length set by hand is. */
const tenth = (s: number) => Math.round(s * 10) / 10;
/** Places in a clip to the millisecond. */
const milli = (s: number) => Math.round(s * 1000) / 1000;
/** The shortest part of a clip that is kept (render/videos.ts: MIN_TRIM). */
const MIN_CLIP = 0.1;

/** The moment, rounded to the tenth, at which `page` can be split, or null when either part would be shorter than a page may be. */
export function splitMoment(page: Pick<Page, "duration" | "elements">, at: number): number | null {
  const t = tenth(at);
  const total = pageDuration(page);
  if (!Number.isFinite(t) || t < MIN_PAGE_DURATION || total - t < MIN_PAGE_DURATION - 1e-9) return null;
  return t;
}

/** A clip as it is on the second page, `at` seconds of its page later. */
function goOn(el: VideoElement, at: number): void {
  const start = clipStartAt(el);
  if (at <= start) {
    // it had not started: it starts that much sooner
    const later = milli(start - at);
    if (later > 0) el.startAt = later;
    else delete el.startAt;
    return;
  }
  delete el.startAt;
  const length = clipPlayingLength(el);
  const played = at - start;
  if (!el.once) {
    // a loop goes on part-way through the play it was in
    const from = milli((clipLoopFrom(el) + played) % length);
    if (from > 0 && from < length) el.loopFrom = from;
    else delete el.loopFrom;
    return;
  }
  const speed = el.speed > 0 ? el.speed : 1;
  if (played >= length - MIN_CLIP / speed) {
    // it had played and holds its last frame: a last tenth of it, silent, held
    el.trimStart = milli(Math.max(el.trimStart, el.trimEnd - MIN_CLIP));
    delete el.captions;
    delete el.fadeIn;
    el.volume = 0;
    return;
  }
  el.trimStart = milli(el.trimStart + played * speed);
  // its sound goes on: it does not rise again from nothing at the cut
  delete el.fadeIn;
  const lines = clipCaptions(el)
    .filter((c) => c.end > played)
    .map((c) => ({ ...c, start: milli(Math.max(0, c.start - played)), end: milli(c.end - played) }));
  if (lines.length) el.captions = lines;
  else delete el.captions;
}

function visit(elements: DesignElement[], change: (el: DesignElement) => void): void {
  for (const el of elements) {
    change(el);
    if (el.type === "group") visit(el.children, change);
  }
}

const withoutAnimation = (el: DesignElement, phase: "in" | "out") => {
  if (!el.animation?.[phase]) return;
  el.animation = { ...el.animation };
  delete el.animation[phase];
};

/**
 * The two pages that `page` becomes when it is split `at` seconds in (see splitMoment), or null when it cannot be. `page` itself is
 * not changed.
 */
export function splitPageAt(page: Page, at: number): { first: Page; second: Page } | null {
  const t = splitMoment(page, at);
  if (t === null) return null;
  const total = pageDuration(page);
  const first: Page = cloneDeep(page);
  const second: Page = cloneDeep(page);

  first.duration = t;
  visit(first.elements, (el) => withoutAnimation(el, "out"));

  second.transition = null;
  delete second.name;
  delete second.notes;
  visit(second.elements, (el) => {
    withoutAnimation(el, "in");
    if (el.type === "video") goOn(el, t);
  });
  // a page that followed its clip goes on following it when the clip still says how long it is; else it keeps the rest of the time
  const follows = !Number.isFinite(page.duration) && pageClipLength(page) !== null;
  const rest = tenth(total - t);
  if (follows && Math.abs(pageDuration({ elements: second.elements }) - rest) < 0.05) delete second.duration;
  else second.duration = Math.max(MIN_PAGE_DURATION, rest);
  return { first, second };
}

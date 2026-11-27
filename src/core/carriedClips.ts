/**
 * Clips that run on under the pages after their own (`VideoElement.runsOn`). Such a clip stays an element of its own page, where
 * it is edited; on each of the next `runsOn` pages it is drawn in the same place, right over that page's background and behind its
 * elements, going on from where it had got to: a copy of it as it is that much later, made with the same step as Split (goOn in
 * splitPage.ts), so every painter, player, caption and sound mix takes it as it takes any clip. A copy keeps the clip's id, so the
 * player of the clip plays on from one page to the next without starting again.
 *
 * "That much later" is the distance between the two pages' own times on the timeline of `pages` (a transition between them
 * counts: the clip has gone on while it ran). `pages` is whatever is played: the design's pages, or the pages chosen for a download.
 *
 * Pure, and kept per list of pages: the same list gives the same copies, so a page painted again does not make them again.
 */
import { cloneDeep } from "./clone";
import { goOn } from "./splitPage";
import { buildTimeline } from "./transition";
import type { DesignElement, Page, VideoElement } from "./types";

/** The most pages after its own that a clip can run on under. */
export const MAX_RUNS_ON = 20;

/** How many pages after its own a clip runs on under, 0 to MAX_RUNS_ON (a value from outside that is not a whole number counts down to one). */
export const clipRunsOn = (el: Pick<VideoElement, "runsOn">): number =>
  typeof el.runsOn === "number" && Number.isFinite(el.runsOn) ? Math.min(MAX_RUNS_ON, Math.max(0, Math.floor(el.runsOn))) : 0;

/** The clips of a page that run on (groups looked into, hidden ones left out), in paint order. */
function runningClips(page: Pick<Page, "elements">): VideoElement[] {
  const out: VideoElement[] = [];
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    if (el.type === "video" && clipRunsOn(el) > 0) out.push(el);
    else if (el.type === "group") el.children.forEach(visit);
  };
  page.elements.forEach(visit);
  return out;
}

const NONE: readonly VideoElement[] = Object.freeze([]);
const kept = new WeakMap<readonly Page[], readonly (readonly VideoElement[])[]>();

/** For every page of `pages`, the clips that run on under it from the pages before, as they are there (back to front). */
export function carriedClipsOf(pages: readonly Page[]): readonly (readonly VideoElement[])[] {
  const known = kept.get(pages);
  if (known) return known;
  const out: VideoElement[][] = pages.map(() => []);
  if (pages.some((p) => runningClips(p).length)) {
    const timeline = buildTimeline(pages);
    pages.forEach((page, i) => {
      for (const el of runningClips(page)) {
        const runs = clipRunsOn(el);
        for (let k = 1; k <= runs && i + k < pages.length; k++) {
          const copy = cloneDeep(el);
          delete copy.runsOn;
          // it is behind the page's own elements, and does not come in again
          delete copy.animation;
          delete copy.locked;
          goOn(copy, (timeline.segments[i + k]?.playStart ?? 0) - (timeline.segments[i]?.playStart ?? 0));
          out[i + k].push(copy);
        }
      }
    });
  }
  const result = out.map((list) => (list.length ? list : NONE));
  kept.set(pages, result);
  return result;
}

/** The clips that run on under `page` (or a page with its id) from the pages before it in `pages` (none when it is not one of them). */
export function carriedClips(pages: readonly Page[] | undefined, page: Page): readonly VideoElement[] {
  if (!pages) return NONE;
  // the page itself, or a copy of it made for painting (Present leaves its exits out): known by its id
  let index = pages.indexOf(page);
  if (index < 0) index = pages.findIndex((p) => p.id === page.id);
  return index < 0 ? NONE : carriedClipsOf(pages)[index];
}

/**
 * Seconds from the start of its own page to the end of the last page a clip runs on under, on the timeline of `pages`: how far its
 * bar reaches. `index` is its page; a clip that does not run on reaches the end of its own page.
 */
export function runEnd(pages: readonly Page[], index: number, el: Pick<VideoElement, "runsOn">, timeline = buildTimeline(pages)): number {
  const last = Math.min(pages.length - 1, index + clipRunsOn(el));
  const own = timeline.segments[index];
  const end = timeline.segments[last];
  return own && end ? end.end - own.playStart : 0;
}

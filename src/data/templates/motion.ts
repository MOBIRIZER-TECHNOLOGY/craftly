/**
 * Motion for the built-in templates: page transitions and staggered entrances, so a deck or a story plays well in
 * Present mode and exports as an animated GIF / video. Only playback is affected; thumbnails, the editor and still
 * exports show every page at rest exactly as designed.
 */
import { animatableElements, getPageAnimationPreset, pageAnimationFor } from "@/core/animation";
import { defaultTransition } from "@/core/transition";
import type { AnimDirection, Page, Template } from "@/core/types";

export interface TemplateMotion {
  /** page animation preset id (see PAGE_ANIMATION_PRESETS) every page's elements enter with */
  entrance: string;
  /** transition preset id into every page but the first (see TRANSITION_PRESETS) */
  transition: string;
  direction?: AnimDirection;
  /** seconds of the transition, when the preset's default does not suit the deck */
  transitionSeconds?: number;
  /** seconds each page stays on screen */
  pageSeconds?: number;
}

/** Returns a copy of the template whose pages move; the original object is left untouched. */
export function withMotion(t: Template, motion: TemplateMotion): Template {
  const preset = getPageAnimationPreset(motion.entrance);
  const design = { width: t.width, height: t.height };
  const pages: Page[] = t.pages.map((page, index) => {
    const targets = new Map(animatableElements(page, design).map((el, i) => [el.id, i]));
    const elements = preset
      ? page.elements.map((el) => {
          const i = targets.get(el.id);
          return i === undefined ? el : { ...el, animation: { ...(el.animation ?? {}), in: pageAnimationFor(preset, i).in } };
        })
      : page.elements;
    const next: Page = { ...page, elements };
    if (motion.pageSeconds) next.duration = motion.pageSeconds;
    if (index > 0) {
      const base = defaultTransition(motion.transition);
      next.transition = { ...base, ...(motion.direction ? { direction: motion.direction } : {}), ...(motion.transitionSeconds ? { duration: motion.transitionSeconds } : {}) };
    }
    return next;
  });
  return { ...t, pages };
}

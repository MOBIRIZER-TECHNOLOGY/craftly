import { memo } from "react";
import { useEditor } from "@/core/store";
import { getTransitionPreset, type TimelineSegment } from "@/core/transition";
import type { Page } from "@/core/types";
import { m } from "@/i18n";
import { IconPlus, IconTransition, cx } from "@/ui";
import { seekTimeline } from "./timelineStore";

/**
 * The join between a page and the one before it, on the timeline: a small button over the join that names the transition into the
 * page ("Dissolve, 0.7 s") or offers one. A click puts the playhead in the middle of the transition (the page area then shows it) and
 * opens the page's transition in the Animate panel, where it is chosen, timed and turned.
 */
export const TransitionJoin = memo(function TransitionJoin({ page, index, seg, x, readOnly }: { page: Page; index: number; seg: TimelineSegment; x: number; readOnly: boolean }) {
  const words = m.editorChrome.timeline;
  const tr = page.transition && page.transition.kind !== "none" ? page.transition : null;
  const name = tr ? (getTransitionPreset(tr.kind)?.label ?? tr.kind) : null;
  const label = tr && name ? words.transitionInto(index + 1, name, words.seconds(seg.transition)) : words.addTransition(index + 1);
  if (!tr && readOnly) return null;
  const open = () => {
    const actions = useEditor.getState().actions;
    seekTimeline(tr ? seg.start + seg.transition / 2 : seg.playStart);
    if (useEditor.getState().activePageId !== page.id) actions.setActivePage(page.id);
    if (readOnly) return;
    actions.openContext({ kind: "animate", tab: "page" });
    // the transition is further down the panel than the page's own animation: bring it into view once the panel has drawn it
    window.setTimeout(() => document.querySelector(`[aria-label="${m.panelsContext.animate.pageTransitions}"]`)?.scrollIntoView({ block: "nearest" }));
  };
  return (
    <button type="button" className={cx("cf-tl__join", tr && "has-transition")} style={{ left: x }} aria-label={label} title={label} onClick={open}>
      {tr ? <IconTransition aria-hidden="true" /> : <IconPlus aria-hidden="true" />}
    </button>
  );
});

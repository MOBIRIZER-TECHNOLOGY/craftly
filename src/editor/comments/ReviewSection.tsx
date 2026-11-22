/**
 * The review at the top of the Comments panel (docs/REVIEW.md): where the design stands (asked for, approved, changes asked for),
 * who set it and when, whether that is about the design as it is now or an earlier version, and the buttons this person's role
 * allows: Request review for whoever may edit, Approve and Request changes for whoever may comment. Shown only while the review
 * is shared with the others (a server that said so in its welcome).
 */
import { useId } from "react";
import { reviewOf } from "@/core/review";
import { useEditor } from "@/core/store";
import type { ReviewState } from "@/core/types";
import { m } from "@/i18n";
import { Button } from "@/ui";
import { myAuthor, when } from "./commentsStore";

/** `mayRequest`: this person may edit (and so ask for a review); `mayDecide`: they may comment (and so approve or ask for changes). */
export function ReviewSection({ mayRequest, mayDecide }: { mayRequest: boolean; mayDecide: boolean }) {
  const design = useEditor((s) => s.design);
  const headingId = useId();
  const found = reviewOf(design);
  const set = (state: ReviewState) => useEditor.getState().actions.setReview(state, myAuthor());
  // a button is offered unless its state is the one the design is in already, about the design as it is now
  const offer = (state: ReviewState) => !(found?.current && found.review.state === state);
  const t = m.editor.review;
  return (
    <section className="cf-review" aria-labelledby={headingId} data-state={found ? found.review.state : "none"}>
      <h3 id={headingId} className="cf-comments-panel__subtitle">
        {t.title}
      </h3>
      <p className="cf-review__state" role="status">
        {found ? t.states[found.review.state](found.review.by.name, when(found.review.at)) : t.none}
      </p>
      {found ? <p className={`cf-review__revision${found.current ? "" : " is-stale"}`}>{found.current ? t.current : t.stale}</p> : null}
      {mayRequest || mayDecide ? (
        <div className="cf-review__actions">
          {mayRequest && offer("requested") ? (
            <Button size="sm" variant="secondary" onClick={() => set("requested")}>
              {t.request}
            </Button>
          ) : null}
          {mayDecide && offer("approved") ? (
            <Button size="sm" variant="primary" onClick={() => set("approved")}>
              {t.approve}
            </Button>
          ) : null}
          {mayDecide && offer("changes") ? (
            <Button size="sm" variant="secondary" onClick={() => set("changes")}>
              {t.requestChanges}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

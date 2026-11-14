/**
 * The comments on the page: a pin for each comment of the open page, numbered as they were made, in the colour of its author, and
 * the small editor of a pin that is being placed. It is a layer above the page, inside the frame that is laid over the page (so
 * it scrolls and zooms with it, as the presence layer does), and it takes no pointer events itself: only the pins and the editor
 * do, and they are marked as controls of their own (`data-cf-ui`), which the canvas leaves alone.
 *
 * A pin is a real button, reached with Tab after the elements of the page, and named by its number, its author and the first words
 * of what they wrote; it opens the thread in the Comments panel. Texts are put into the page as text. The colour of an author is
 * taken from the fixed list of presence colours by its place in it, never from what arrived.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { commentPosition } from "@/core/comments";
import { getActivePage, useEditor } from "@/core/store";
import type { DesignComment, Page } from "@/core/types";
import { Button } from "@/ui";
import { PRESENCE_COLORS } from "../live/presence";
import { firstWords, myAuthor, numbered, rememberMine, useComments } from "./commentsStore";
import "./comments.css";

/** The colour of an author, from its place in the fixed list. */
export const authorColor = (index: number): string => PRESENCE_COLORS[Math.abs(Math.trunc(index)) % PRESENCE_COLORS.length];

/** What a pin is called for a screen reader and in its tooltip. */
export const pinName = (number: number, comment: DesignComment): string =>
  `Comment ${number} by ${comment.author.name}: ${firstWords(comment.text)}${comment.resolved ? " (resolved)" : ""}`;

export function CommentsOverlay() {
  const design = useEditor((s) => s.design);
  const page = useEditor((s) => getActivePage(s));
  const zoom = useEditor((s) => s.zoom);
  const presenting = useEditor((s) => s.presenting);
  const showResolved = useComments((s) => s.showResolved);
  const draft = useComments((s) => s.draft);
  const highlight = useComments((s) => s.highlight);
  if (!page || presenting) return null;
  const pins = numbered(design, page.id).filter(({ comment }) => showResolved || !comment.resolved || comment.id === highlight);
  return (
    <div className="cf-comments-layer">
      {pins.map(({ comment, number }) => (
        <Pin key={comment.id} comment={comment} number={number} page={page} zoom={zoom} highlighted={comment.id === highlight} />
      ))}
      {draft && draft.pageId === page.id ? <DraftEditor zoom={zoom} /> : null}
    </div>
  );
}

function Pin({ comment, number, page, zoom, highlighted }: { comment: DesignComment; number: number; page: Page; zoom: number; highlighted: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const focusPin = useComments((s) => s.focusPin);
  const at = commentPosition(page, comment);
  useEffect(() => {
    if (focusPin !== comment.id) return;
    ref.current?.focus();
    useComments.setState({ focusPin: null });
  }, [focusPin, comment.id]);
  const name = pinName(number, comment);
  return (
    <button
      ref={ref}
      type="button"
      data-cf-ui
      data-comment-id={comment.id}
      className={`cf-comment-pin${comment.resolved ? " is-resolved" : ""}${highlighted ? " is-highlighted" : ""}`}
      style={{ left: at.x * zoom, top: at.y * zoom, "--cf-comment": authorColor(comment.author.colorIndex) } as CSSProperties}
      aria-label={name}
      title={name}
      onClick={() => useComments.setState({ panelOpen: true, focusThread: comment.id, highlight: comment.id })}
    >
      <span aria-hidden="true">{number}</span>
    </button>
  );
}

/** The editor of a pin that is being placed: Enter or Post posts it, Esc or Cancel takes the pin away. */
function DraftEditor({ zoom }: { zoom: number }) {
  const draft = useComments((s) => s.draft)!;
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);

  const close = (posted: string | null) => {
    useComments.setState(posted ? { draft: null, focusPin: posted, highlight: null } : { draft: null });
    // back to the pin that was posted, or to the canvas where the tool is, so that the keyboard is never left nowhere
    if (!posted) document.querySelector<HTMLElement>("[data-cf-workspace]")?.focus({ preventScroll: true });
  };
  const post = () => {
    const id = useEditor.getState().actions.addComment({ ...draft, text, author: myAuthor() });
    if (!id) return;
    rememberMine(id);
    close(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(null);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      post();
    }
  };
  const color = authorColor(myAuthor().colorIndex);
  return (
    <div className="cf-comment-draft" data-cf-ui style={{ left: draft.anchor.x * zoom, top: draft.anchor.y * zoom, "--cf-comment": color } as CSSProperties}>
      <span className="cf-comment-pin cf-comment-pin--draft" aria-hidden="true" />
      <form
        className="cf-comment-draft__box"
        aria-label="New comment"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <textarea
          ref={area}
          className="cf-comment-draft__text"
          aria-label="Comment"
          aria-describedby="cf-comment-draft-hint"
          placeholder="Add a comment"
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span id="cf-comment-draft-hint" className="cf-sr-only">
          Enter posts the comment, Shift and Enter starts a new line, Escape cancels.
        </span>
        <div className="cf-comment-draft__actions">
          <Button size="sm" variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!text.trim()}>
            Post
          </Button>
        </div>
      </form>
    </div>
  );
}

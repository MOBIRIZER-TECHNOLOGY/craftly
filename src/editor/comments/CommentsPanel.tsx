/**
 * The Comments panel: every thread of the design, those of the open page first and then those of the other pages, filtered by
 * Open, Resolved or All. A thread shows its author, when it was written, its text and its replies, a box to answer, Resolve or
 * Reopen, and Edit and Delete for this person's own messages (Delete asks first). "Show on page" goes to the page of the thread
 * and marks its pin. The panel says plainly when comments are not shared (a server from before comments) and when this person may
 * only read them (a link that only lets people look, or the Viewing mode).
 *
 * Everything that people wrote is put into the page as text. The panel is a region of its own beside the page, not a dialog: the
 * keyboard goes in and out of it freely, and Esc or Close puts it back on the Comments button.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { MAX_COMMENT_TEXT } from "@/core/comments";
import { useEditor } from "@/core/store";
import type { CommentAuthor, CommentReply, Design, DesignComment, ID } from "@/core/types";
import { date, m } from "@/i18n";
import { Button, IconButton, IconClose } from "@/ui";
import { useLiveStatus } from "../live/connection";
import { authorColor } from "./CommentsOverlay";
import { isMine, myAuthor, numbered, rememberMine, useComments, type CommentFilter } from "./commentsStore";
import "./comments.css";

const FILTERS: CommentFilter[] = ["open", "resolved", "all"];

const when = (ms: number): string => {
  try {
    return date(ms, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(ms).toISOString();
  }
};

/** The name of the page a thread is on, as the page strip says it. */
const pageLabel = (design: Design, pageId: ID): string => {
  const i = design.pages.findIndex((p) => p.id === pageId);
  const name = design.pages[i]?.name;
  return name ? m.editor.comments.pageNamed(i + 1, name) : m.editor.comments.pageNumber(i + 1);
};

/** Puts the keyboard back on the Comments button when the panel closes. */
const backToButton = () => document.querySelector<HTMLElement>("[data-cf-comments-button]")?.focus();

export function CommentsPanel() {
  const open = useComments((s) => s.panelOpen);
  if (!open) return null;
  return <PanelBody />;
}

function PanelBody() {
  const design = useEditor((s) => s.design);
  const activePageId = useEditor((s) => s.activePageId);
  const mode = useEditor((s) => s.mode);
  const role = useLiveStatus((s) => s.role);
  const sharing = useComments((s) => s.sharing);
  const filter = useComments((s) => s.filter);
  const showResolved = useComments((s) => s.showResolved);
  const headingId = useId();
  const close = () => {
    useComments.setState({ panelOpen: false, highlight: null });
    backToButton();
  };
  if (!design) return null;
  const canWrite = mode === "edit";
  const wanted = (c: DesignComment) => filter === "all" || (filter === "resolved") === c.resolved;
  const here = numbered(design, activePageId).filter(({ comment }) => wanted(comment));
  const elsewhere = design.pages
    .filter((p) => p.id !== activePageId)
    .flatMap((p) => numbered(design, p.id))
    .filter(({ comment }) => wanted(comment));
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };
  const empty = m.editor.comments.empty[filter];
  return (
    <aside className="cf-comments-panel" aria-labelledby={headingId} data-cf-ui onKeyDown={onKeyDown}>
      <div className="cf-comments-panel__head">
        <h2 id={headingId} className="cf-comments-panel__title">
          {m.editor.comments.title}
        </h2>
        <IconButton label={m.editor.comments.close} icon={<IconClose aria-hidden="true" />} size="sm" onClick={close} />
      </div>
      {sharing === "unsupported" ? (
        <p className="cf-comments-panel__note" role="note">
          {m.editor.comments.notShared}
        </p>
      ) : null}
      {!canWrite ? (
        <p className="cf-comments-panel__note" role="note">
          {role === "view" ? m.editor.comments.viewOnlyLink : m.editor.comments.viewing}
        </p>
      ) : (
        <p className="cf-comments-panel__hint">{m.editor.comments.hint}</p>
      )}
      <fieldset className="cf-comments-panel__filter">
        <legend className="cf-sr-only">{m.editor.comments.filterLegend}</legend>
        {FILTERS.map((f) => (
          <label key={f} className={`cf-comments-panel__chip${filter === f ? " is-on" : ""}`}>
            <input type="radio" name="cf-comments-filter" value={f} checked={filter === f} onChange={() => useComments.setState({ filter: f })} />
            {m.editor.comments.filters[f]}
          </label>
        ))}
      </fieldset>
      <label className="cf-comments-panel__check">
        <input type="checkbox" checked={showResolved} onChange={(e) => useComments.setState({ showResolved: e.target.checked })} />
        {m.editor.comments.showResolved}
      </label>
      <div className="cf-comments-panel__list">
        <Section title={m.editor.comments.onThisPage} items={here} design={design} canWrite={canWrite} empty={empty} />
        {elsewhere.length ? <Section title={m.editor.comments.onOtherPages} items={elsewhere} design={design} canWrite={canWrite} withPage /> : null}
      </div>
    </aside>
  );
}

function Section({
  title,
  items,
  design,
  canWrite,
  empty,
  withPage = false,
}: {
  title: string;
  items: Array<{ comment: DesignComment; number: number }>;
  design: Design;
  canWrite: boolean;
  empty?: string;
  withPage?: boolean;
}) {
  return (
    <section className="cf-comments-panel__section">
      <h3 className="cf-comments-panel__subtitle">{title}</h3>
      {items.length ? (
        <ul className="cf-comments-panel__threads">
          {items.map(({ comment, number }) => (
            <li key={comment.id}>
              <Thread comment={comment} number={number} design={design} canWrite={canWrite} page={withPage ? pageLabel(design, comment.pageId) : null} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="cf-comments-panel__empty">{empty}</p>
      )}
    </section>
  );
}

function Byline({ author, at, edited }: { author: CommentAuthor; at: number; edited?: number }) {
  return (
    <span className="cf-comment__byline">
      <span className="cf-comment__dot" style={{ "--cf-comment": authorColor(author.colorIndex) } as CSSProperties} aria-hidden="true" />
      <strong className="cf-comment__author">{author.name}</strong>
      <time className="cf-comment__time" dateTime={new Date(at).toISOString()}>
        {when(at)}
      </time>
      {edited !== undefined ? <span className="cf-comment__edited">{m.editor.comments.edited}</span> : null}
    </span>
  );
}

function Thread({ comment, number, design, canWrite, page }: { comment: DesignComment; number: number; design: Design; canWrite: boolean; page: string | null }) {
  const ref = useRef<HTMLElement>(null);
  const focusThread = useComments((s) => s.focusThread);
  const highlight = useComments((s) => s.highlight);
  const titleId = useId();
  useEffect(() => {
    if (focusThread !== comment.id) return;
    ref.current?.scrollIntoView?.({ block: "nearest" });
    ref.current?.focus();
    useComments.setState({ focusThread: null });
  }, [focusThread, comment.id]);
  const actions = useEditor.getState().actions;
  const show = () => {
    actions.setActivePage(comment.pageId);
    useComments.setState({ highlight: comment.id });
  };
  return (
    <article
      ref={ref}
      tabIndex={-1}
      className={`cf-comment${comment.resolved ? " is-resolved" : ""}${highlight === comment.id ? " is-highlighted" : ""}`}
      aria-labelledby={titleId}
    >
      <h4 id={titleId} className="cf-comment__title">
        {m.editor.comments.thread(number, page)}
        {comment.resolved ? <span className="cf-comment__state">{m.editor.comments.resolvedMark}</span> : null}
      </h4>
      <Message
        author={comment.author}
        at={comment.createdAt}
        edited={comment.editedAt}
        text={comment.text}
        mine={canWrite && isMine(comment.id, design)}
        what="comment"
        onEdit={(text) => actions.editComment(comment.id, text)}
        onDelete={() => actions.deleteComment(comment.id)}
      />
      {comment.replies.length ? (
        <ol className="cf-comment__replies" aria-label={m.editor.comments.replies(number)}>
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <ReplyItem reply={reply} comment={comment} design={design} canWrite={canWrite} />
            </li>
          ))}
        </ol>
      ) : null}
      <div className="cf-comment__actions">
        <Button size="sm" variant="ghost" onClick={show}>
          {m.editor.comments.showOnPage}
        </Button>
        {canWrite ? (
          <Button size="sm" variant="ghost" onClick={() => actions.setCommentResolved(comment.id, !comment.resolved)}>
            {comment.resolved ? m.editor.comments.reopen : m.editor.comments.resolve}
          </Button>
        ) : null}
      </div>
      {canWrite ? <ReplyBox comment={comment} number={number} /> : null}
    </article>
  );
}

function ReplyItem({ reply, comment, design, canWrite }: { reply: CommentReply; comment: DesignComment; design: Design; canWrite: boolean }) {
  const actions = useEditor.getState().actions;
  return (
    <Message
      author={reply.author}
      at={reply.createdAt}
      edited={reply.editedAt}
      text={reply.text}
      mine={canWrite && isMine(reply.id, design)}
      what="reply"
      onEdit={(text) => actions.editComment(comment.id, text, reply.id)}
      onDelete={() => actions.deleteComment(comment.id, reply.id)}
    />
  );
}

/** One message (a comment or a reply): who, when, what; and Edit and Delete for this person's own. Delete asks first. */
function Message({
  author,
  at,
  edited,
  text,
  mine,
  what,
  onEdit,
  onDelete,
}: {
  author: CommentAuthor;
  at: number;
  edited?: number;
  text: string;
  mine: boolean;
  what: "comment" | "reply";
  onEdit(text: string): void;
  onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  // the question takes the keyboard on its safe answer, so that Enter after Delete never deletes by accident
  useEffect(() => {
    if (asking) keepButton.current?.focus();
  }, [asking]);
  let body: ReactNode = <p className="cf-comment__text">{text}</p>;
  if (editing)
    body = (
      <TextForm
        label={m.editor.comments.editYour[what]}
        initial={text}
        submit={m.common.save}
        onSubmit={(value) => {
          onEdit(value);
          setEditing(false);
          requestAnimationFrame(() => editButton.current?.focus());
        }}
        onCancel={() => {
          setEditing(false);
          requestAnimationFrame(() => editButton.current?.focus());
        }}
        takeFocus
      />
    );
  return (
    <div className="cf-comment__message">
      <Byline author={author} at={at} edited={edited} />
      {body}
      {mine && !editing ? (
        asking ? (
          <div className="cf-comment__confirm" role="group" aria-label={m.editor.comments.deleteThis[what]}>
            <span>{m.editor.comments.deleteQuestion[what]}</span>
            <Button size="sm" variant="danger" onClick={onDelete}>
              {m.common.delete}
            </Button>
            <Button
              ref={keepButton}
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsking(false);
                requestAnimationFrame(() => deleteButton.current?.focus());
              }}
            >
              {m.editor.comments.keep}
            </Button>
          </div>
        ) : (
          <div className="cf-comment__own">
            <Button ref={editButton} size="sm" variant="ghost" aria-label={m.editor.comments.editLabel[what]} onClick={() => setEditing(true)}>
              {m.editor.comments.edit}
            </Button>
            <Button ref={deleteButton} size="sm" variant="ghost" aria-label={m.editor.comments.deleteLabel[what]} onClick={() => setAsking(true)}>
              {m.common.delete}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function ReplyBox({ comment, number }: { comment: DesignComment; number: number }) {
  return (
    <TextForm
      label={m.editor.comments.replyTo(number, comment.author.name)}
      placeholder={m.editor.comments.reply}
      initial=""
      submit={m.editor.comments.reply}
      onSubmit={(value) => {
        const id = useEditor.getState().actions.replyToComment(comment.id, value, myAuthor());
        if (id) rememberMine(id);
        return id !== "";
      }}
    />
  );
}

/**
 * A box to write in with a button to send it: Enter sends (Shift and Enter is a new line), Esc cancels an edit. `onSubmit` may
 * answer false to keep what was written (nothing was sent).
 */
function TextForm({
  label,
  initial,
  submit,
  placeholder,
  takeFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submit: string;
  placeholder?: string;
  /** puts the keyboard into the box when it appears (an edit that was asked for) */
  takeFocus?: boolean;
  onSubmit(value: string): boolean | void;
  onCancel?(): void;
}) {
  const [value, setValue] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (takeFocus) area.current?.focus();
  }, [takeFocus]);
  const send = () => {
    if (!value.trim()) return;
    if (onSubmit(value) !== false) setValue("");
  };
  return (
    <form
      className="cf-comment__form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        className="cf-comment__input"
        aria-label={label}
        placeholder={placeholder}
        rows={2}
        maxLength={MAX_COMMENT_TEXT}
        ref={area}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="cf-comment__form-actions">
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {m.common.cancel}
          </Button>
        ) : null}
        <Button size="sm" variant="primary" type="submit">
          {submit}
        </Button>
      </div>
    </form>
  );
}

/** What a screen reader is told when somebody else comments: one polite sentence for each, never the panel's own work. */
export function CommentsAnnouncer() {
  const announcement = useComments((s) => s.announcement);
  return (
    <div className="cf-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement.text ? <span key={announcement.n}>{announcement.text}</span> : null}
    </div>
  );
}

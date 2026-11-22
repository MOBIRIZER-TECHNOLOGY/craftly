/**
 * What a seat of a room may do beyond what its batch looks like (docs/REVIEW.md): the server asks this of every batch it is about
 * to apply, after `checkOps` and with the design before and after it, and refuses the whole batch when it says something.
 *
 * - A seat that may only comment (a team's commenter) sends comment and review operations, nothing else.
 * - In a team's room the server knows each seat's account: what a seat writes is in its own name (the account's id and name), a
 *   comment's or reply's words and pin are changed by their author only, and deleted by their author or an owner of the team.
 *   Resolving and reopening is anybody's who may comment. A comment that comes back with its page (an undo of a page's deletion
 *   brings back the comments that were on it) keeps whoever wrote it, for a seat that may edit, but only when the room had that
 *   very comment, exactly as it was (its text, pin, times, state and replies), and it went (`restorable`: the room remembers what left it); anything else is a new comment,
 *   in the seat's own name.
 * - In a room of a link there is no account to check: nothing changes there, except that nobody may write as an account.
 * - A review is asked for by a seat that may edit, and approved or sent back by one that may comment; it is about the content as
 *   the batch leaves it (`contentRevision`), never about one this seat has not seen.
 *
 * Pure code, no DOM and no Node API: the server bundles this, and the tests run it as it is.
 */
import { contentRevision } from "@/core/review";
import type { CommentAuthor, Design, DesignComment } from "@/core/types";
import { isCommentOp, isReviewOp, type Op } from "./ops";
import { canEdit, type Role } from "./protocol";

/** Who sends a batch: the role of their seat, and their account in a team's room (none in a room of a link). */
export interface Seat {
  role: Role;
  account?: { id: string; name: string; owner: boolean };
}

/** Whether a comment is exactly one the room had and that left it: the same in every field, every reply included. */
export type Restorable = (comment: DesignComment) => boolean;

/**
 * What is wrong with a batch for the seat that sends it, if anything. `before` and `after` are the design without and with it;
 * `restorable` says which comments may come back with their page (none, when it is not given).
 */
export function seatProblem(before: Design, after: Design, ops: readonly Op[], seat: Seat, restorable: Restorable = () => false): string | null {
  if (seat.role === "comment" && ops.some((op) => !isCommentOp(op) && !isReviewOp(op))) return "this seat may only comment";
  if (!ops.some((op) => isCommentOp(op) || isReviewOp(op))) return null;
  const { account } = seat;
  /** Whether something is written in this seat's own name: its account's id and name, or no account at all in a room of a link. */
  const own = (author: CommentAuthor) => (account ? author.id === account.id && author.name === account.name : author.id === undefined);
  /** Whether this seat wrote something that is there: anybody did, as far as a room of a link can tell. */
  const wrote = (author: CommentAuthor | undefined) => !account || author?.id === account.id;
  const owner = account?.owner === true;

  // who wrote each comment and reply, as the design was and as the batch adds them ("comment" and "comment/reply")
  const authors = new Map<string, CommentAuthor>();
  for (const c of before.comments ?? []) {
    authors.set(c.id, c.author);
    for (const r of c.replies) authors.set(`${c.id}/${r.id}`, r.author);
  }
  const pagesAdded = new Set(ops.flatMap((op) => (op.k === "page.add" ? [op.page.id] : [])));

  for (const op of ops) {
    switch (op.k) {
      case "comment.add": {
        const { comment } = op;
        const restored = canEdit(seat.role) && pagesAdded.has(comment.pageId) && restorable(comment);
        if (!restored && (!own(comment.author) || comment.replies.some((r) => !own(r.author)))) return "comment.add: a comment is written in your own name";
        authors.set(comment.id, comment.author);
        for (const r of comment.replies) authors.set(`${comment.id}/${r.id}`, r.author);
        break;
      }
      case "comment.set": {
        const words = op.unset !== undefined || (op.set !== undefined && Object.keys(op.set).some((key) => key !== "resolved"));
        if (words && authors.has(op.id) && !wrote(authors.get(op.id))) return "comment.set: only its author changes a comment";
        break;
      }
      case "comment.del":
        if (authors.has(op.id) && !wrote(authors.get(op.id)) && !owner) return "comment.del: only its author or an owner deletes a comment";
        break;
      case "reply.add":
        if (!own(op.reply.author)) return "reply.add: a reply is written in your own name";
        authors.set(`${op.comment}/${op.reply.id}`, op.reply.author);
        break;
      case "reply.set": {
        const key = `${op.comment}/${op.id}`;
        if (authors.has(key) && !wrote(authors.get(key))) return "reply.set: only its author changes a reply";
        break;
      }
      case "reply.del": {
        const key = `${op.comment}/${op.id}`;
        if (authors.has(key) && !wrote(authors.get(key)) && !owner) return "reply.del: only its author or an owner deletes a reply";
        break;
      }
      case "review.set": {
        const { review } = op;
        if (review.state === "requested" && !canEdit(seat.role)) return "review.set: a review is asked for by somebody who may edit";
        if (!own(review.by)) return "review.set: a review is set in your own name";
        if (review.revision !== contentRevision(after)) return "review.set: the design has changed since; look at it again";
        break;
      }
    }
  }
  return null;
}

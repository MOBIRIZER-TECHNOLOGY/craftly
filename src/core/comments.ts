/**
 * Comments: notes pinned to places of a page (docs/COLLABORATION.md, "Comments"). This is the one check of a comment, beside the
 * one of an element (usableElement.ts), and everything that brings comments in asks it: a project file and a backup
 * (src/export/projectFormat.ts), a design that makes a room or is a welcome, and every comment operation, on the server and in the
 * browser (src/collab/protocol.ts). It is strict: every field has the form it should, an id looks like an id, a number is finite,
 * a text is plain and bounded, and a field that a comment does not have is refused (a file is read more kindly: what is not usable
 * is left out and counted).
 *
 * A text is plain text everywhere. It is put into the page as text, never as markup, and is never used in an address or in CSS;
 * the colour of an author is an index into a fixed list, never a colour. No DOM and no Node API: the server bundles this.
 *
 * Beside the check, the small rules the editor keeps: where a pin is (`commentPosition`), what a step takes with it (a page that
 * goes takes its comments, an element that goes leaves the pins on it where it was: `settleComments`), and what undo leaves alone
 * (`carryComments`: comments are not steps of undo).
 */
import type { CommentAnchor, CommentAuthor, CommentReply, Design, DesignComment, Page } from "./types";

/** The most comments one design may hold. */
export const MAX_COMMENTS = 500;
/** The most replies in the thread of one comment. */
export const MAX_REPLIES = 200;
/** The longest text of a comment or a reply, in UTF-16 units. */
export const MAX_COMMENT_TEXT = 2000;
/** The longest name of an author: the longest name presence lets a person give (src/collab/presence.ts). */
export const MAX_AUTHOR_NAME = 40;
/** How many colours there are to choose an author's from (the presence colours of the editor). */
export const COMMENT_COLORS = 12;
/** The furthest from the corner of a page that a pin may be, in design pixels. */
export const COMMENT_COORD_MAX = 1_000_000;
/** The longest id of a page or an element that a comment may name: ids the design itself uses (src/collab/protocol.ts). */
const REF_MAX = 200;
/** The id of a comment or a reply, which the editor makes (`uid`): letters, digits, `_` and `-`. */
const COMMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What a change of a comment may change (a `comment.set`), and of a reply (`reply.set`). */
export type CommentPatch = Partial<Pick<DesignComment, "text" | "editedAt" | "resolved" | "anchor">>;
export type ReplyPatch = Partial<Pick<CommentReply, "text" | "editedAt">>;

const COMMENT_KEYS = ["id", "pageId", "anchor", "author", "createdAt", "editedAt", "text", "resolved", "replies"];
const REPLY_KEYS = ["id", "author", "createdAt", "editedAt", "text"];
const ANCHOR_KEYS = ["x", "y", "elementId", "dx", "dy"];
const AUTHOR_KEYS = ["name", "colorIndex"];
const COMMENT_PATCH_KEYS = ["text", "editedAt", "resolved", "anchor"];
const REPLY_PATCH_KEYS = ["text", "editedAt"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isTime = (v: unknown): v is number => isFinite(v) && v >= 0;
const isRef = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= REF_MAX;
export const isCommentId = (v: unknown): v is string => typeof v === "string" && COMMENT_ID.test(v);
const isPlace = (v: unknown): v is number => isFinite(v) && Math.abs(v) <= COMMENT_COORD_MAX;

/** The first name of `value` that is not in `allowed`, if any. */
const unknownKey = (value: Record<string, unknown>, allowed: readonly string[]): string | undefined => Object.keys(value).find((key) => !allowed.includes(key));

/**
 * Whether a character has no place in what a person wrote: one that controls a terminal (C0 apart from a tab and a line break,
 * DEL, C1), a line or paragraph separator, and the marks that turn the direction of text around, with which a text could be made
 * to read as another. `name` is stricter: a name is one line.
 */
function unprintable(code: number, name: boolean): boolean {
  if (!name && (code === 0x09 || code === 0x0a)) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x200e || code === 0x200f || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function textProblem(value: unknown, what: string, max: number, name = false): string | null {
  if (typeof value !== "string") return `${what} is text`;
  if (!name && value.length === 0) return `${what} is empty`;
  if (value.length > max) return `${what} that is too long`;
  for (let i = 0; i < value.length; i++) if (unprintable(value.charCodeAt(i), name)) return `${what} with a character that cannot be shown`;
  return null;
}

function readAuthor(value: unknown): CommentAuthor | string {
  if (!isObject(value)) return "an author is an object";
  const extra = unknownKey(value, AUTHOR_KEYS);
  if (extra !== undefined) return `a field that an author does not have (${extra.slice(0, 40)})`;
  const wrong = textProblem(value.name, "a name", MAX_AUTHOR_NAME, true);
  if (wrong) return wrong;
  const index = value.colorIndex;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= COMMENT_COLORS) return "the colour of an author is a place in the list of colours";
  return { name: value.name as string, colorIndex: index };
}

function readAnchor(value: unknown): CommentAnchor | string {
  if (!isObject(value)) return "a pin is a place";
  const extra = unknownKey(value, ANCHOR_KEYS);
  if (extra !== undefined) return `a field that a pin does not have (${extra.slice(0, 40)})`;
  if (!isPlace(value.x) || !isPlace(value.y)) return "a pin is a place (x and y, finite numbers near the page)";
  const onElement = value.elementId !== undefined || value.dx !== undefined || value.dy !== undefined;
  if (!onElement) return { x: value.x, y: value.y };
  if (!isRef(value.elementId) || !isPlace(value.dx) || !isPlace(value.dy)) return "a pin on an element names it and its place on it (dx and dy)";
  return { x: value.x, y: value.y, elementId: value.elementId, dx: value.dx, dy: value.dy };
}

/** A reply, as a fresh object of what a reply is made of, if it has the form it should; otherwise what is wrong with it. */
export function readReply(value: unknown): CommentReply | string {
  if (!isObject(value)) return "a reply is an object";
  const extra = unknownKey(value, REPLY_KEYS);
  if (extra !== undefined) return `a field that a reply does not have (${extra.slice(0, 40)})`;
  if (!isCommentId(value.id)) return "a reply needs an id";
  const author = readAuthor(value.author);
  if (typeof author === "string") return author;
  if (!isTime(value.createdAt)) return "a time is a number";
  if (value.editedAt !== undefined && !isTime(value.editedAt)) return "a time is a number";
  const wrong = textProblem(value.text, "a reply", MAX_COMMENT_TEXT);
  if (wrong) return wrong;
  const reply: CommentReply = { id: value.id, author, createdAt: value.createdAt, text: value.text as string };
  if (value.editedAt !== undefined) reply.editedAt = value.editedAt as number;
  return reply;
}

/** A comment with its thread, as a fresh object of what a comment is made of, if it has the form it should; otherwise what is wrong. */
export function readComment(value: unknown): DesignComment | string {
  if (!isObject(value)) return "a comment is an object";
  const extra = unknownKey(value, COMMENT_KEYS);
  if (extra !== undefined) return `a field that a comment does not have (${extra.slice(0, 40)})`;
  if (!isCommentId(value.id)) return "a comment needs an id";
  if (!isRef(value.pageId)) return "a comment is on a page";
  const anchor = readAnchor(value.anchor);
  if (typeof anchor === "string") return anchor;
  const author = readAuthor(value.author);
  if (typeof author === "string") return author;
  if (!isTime(value.createdAt)) return "a time is a number";
  if (value.editedAt !== undefined && !isTime(value.editedAt)) return "a time is a number";
  const wrong = textProblem(value.text, "a comment", MAX_COMMENT_TEXT);
  if (wrong) return wrong;
  if (typeof value.resolved !== "boolean") return "resolved is true or false";
  if (!Array.isArray(value.replies)) return "the replies are a list";
  if (value.replies.length > MAX_REPLIES) return "too many replies";
  const replies: CommentReply[] = [];
  const ids = new Set<string>();
  for (const raw of value.replies) {
    const reply = readReply(raw);
    if (typeof reply === "string") return reply;
    if (ids.has(reply.id)) return "a reply is there twice";
    ids.add(reply.id);
    replies.push(reply);
  }
  const comment: DesignComment = { id: value.id, pageId: value.pageId, anchor, author, createdAt: value.createdAt, text: value.text as string, resolved: value.resolved, replies };
  if (value.editedAt !== undefined) comment.editedAt = value.editedAt as number;
  return comment;
}

/** What a `comment.set` changes, if it has the form it should: at least one of the text, when it was edited, resolved, the pin. */
export function readCommentPatch(value: unknown): CommentPatch | string {
  if (!isObject(value)) return "a change is an object";
  const extra = unknownKey(value, COMMENT_PATCH_KEYS);
  if (extra !== undefined) return `a change of a comment cannot change ${extra.slice(0, 40)}`;
  if (Object.keys(value).length === 0) return "a change that changes nothing";
  const patch: CommentPatch = {};
  if (value.text !== undefined) {
    const wrong = textProblem(value.text, "a comment", MAX_COMMENT_TEXT);
    if (wrong) return wrong;
    patch.text = value.text as string;
  }
  if (value.editedAt !== undefined) {
    if (!isTime(value.editedAt)) return "a time is a number";
    patch.editedAt = value.editedAt;
  }
  if (value.resolved !== undefined) {
    if (typeof value.resolved !== "boolean") return "resolved is true or false";
    patch.resolved = value.resolved;
  }
  if (value.anchor !== undefined) {
    const anchor = readAnchor(value.anchor);
    if (typeof anchor === "string") return anchor;
    patch.anchor = anchor;
  }
  return patch;
}

/** What a `reply.set` changes, if it has the form it should: the text, when it was edited, or both. */
export function readReplyPatch(value: unknown): ReplyPatch | string {
  if (!isObject(value)) return "a change is an object";
  const extra = unknownKey(value, REPLY_PATCH_KEYS);
  if (extra !== undefined) return `a change of a reply cannot change ${extra.slice(0, 40)}`;
  if (Object.keys(value).length === 0) return "a change that changes nothing";
  const patch: ReplyPatch = {};
  if (value.text !== undefined) {
    const wrong = textProblem(value.text, "a reply", MAX_COMMENT_TEXT);
    if (wrong) return wrong;
    patch.text = value.text as string;
  }
  if (value.editedAt !== undefined) {
    if (!isTime(value.editedAt)) return "a time is a number";
    patch.editedAt = value.editedAt;
  }
  return patch;
}

/** What is wrong with the comments of a design that arrives whole (a room that is made, a welcome), if anything. None is fine. */
export function commentsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "the comments are a list";
  if (value.length > MAX_COMMENTS) return "too many comments";
  const ids = new Set<string>();
  for (const raw of value) {
    const comment = readComment(raw);
    if (typeof comment === "string") return comment;
    if (ids.has(comment.id)) return "a comment is there twice";
    ids.add(comment.id);
  }
  return null;
}

const hold = (n: number): number => Math.max(-COMMENT_COORD_MAX, Math.min(COMMENT_COORD_MAX, n));

/**
 * The comments of a file (a project file, a backup) that can be used: those that are comments, on a page of the design, with an
 * id of their own, at most `MAX_COMMENTS`. A pin that is further away than a pin may be is held at the limit. `report.comments`
 * counts what was left out, for the person to be told.
 */
export function usableComments(value: unknown, pageIds: ReadonlySet<string>, report?: { skipped: number; comments?: number }): DesignComment[] {
  if (!Array.isArray(value)) return [];
  const kept: DesignComment[] = [];
  const ids = new Set<string>();
  let left = 0;
  for (const raw of value) {
    const anchor = isObject(raw) && isObject(raw.anchor) ? raw.anchor : null;
    const held = anchor ? { ...raw, anchor: { ...anchor, ...(isFinite(anchor.x) ? { x: hold(anchor.x) } : {}), ...(isFinite(anchor.y) ? { y: hold(anchor.y) } : {}) } } : raw;
    const comment = readComment(held);
    if (typeof comment === "string" || !pageIds.has(comment.pageId) || ids.has(comment.id) || kept.length >= MAX_COMMENTS) {
      left++;
      continue;
    }
    ids.add(comment.id);
    kept.push(comment);
  }
  if (left && report) report.comments = (report.comments ?? 0) + left;
  return kept;
}

/** What a person typed, as the plain text a comment may hold: without control characters or direction marks, trimmed, cut to the limit. */
export function cleanCommentText(typed: string): string {
  let out = "";
  for (const char of typed.replace(/\r\n?/g, "\n")) if (!unprintable(char.charCodeAt(0), false)) out += char;
  return out.trim().slice(0, MAX_COMMENT_TEXT);
}

/** Where the pin of a comment is on its page: on its element (at the top of the page) while that is there, otherwise its own place. */
export function commentPosition(page: Page, comment: DesignComment): { x: number; y: number } {
  const { anchor } = comment;
  if (anchor.elementId !== undefined) {
    const el = page.elements.find((e) => e.id === anchor.elementId);
    if (el) return { x: el.x + (anchor.dx ?? 0), y: el.y + (anchor.dy ?? 0) };
  }
  return { x: anchor.x, y: anchor.y };
}

/**
 * The comments as a step of the editor leaves them: those of a page that went go with it, and a pin on an element that went stays
 * where that element was. It keeps the element's id and its place on it, so that when undo, redo or a paste of the same element
 * brings it back the pin is on it again; until then commentPosition gives that last place. The same design when nothing needs
 * that, which is nearly always.
 */
export function settleComments(base: Design, next: Design): Design {
  const comments = next.comments;
  if (!comments?.length || base.pages === next.pages) return next;
  const before = new Map(base.pages.map((p) => [p.id, p]));
  const after = new Map(next.pages.map((p) => [p.id, p]));
  let changed = false;
  const kept: DesignComment[] = [];
  for (const comment of comments) {
    const page = after.get(comment.pageId);
    if (!page) {
      changed = true;
      continue;
    }
    const id = comment.anchor.elementId;
    const was = before.get(comment.pageId);
    if (id !== undefined && was && was !== page && !page.elements.some((e) => e.id === id) && was.elements.some((e) => e.id === id)) {
      const at = commentPosition(was, comment);
      kept.push({ ...comment, anchor: { ...comment.anchor, x: at.x, y: at.y } });
      changed = true;
      continue;
    }
    kept.push(comment);
  }
  return changed ? { ...next, comments: kept } : next;
}

/**
 * What undo or redo of a step makes of the comments, which are no steps of undo (they are what people said, and in a shared design
 * what others answered): the comments as they are now, apart from those of a page that the restored design no longer has, and with
 * those of a page that the restored design brings back. The restored design itself when neither has any.
 */
export function carryComments(current: Design, restored: Design): Design {
  if (!current.comments?.length && !restored.comments?.length) return restored;
  const pages = new Set(restored.pages.map((p) => p.id));
  const had = new Set(current.pages.map((p) => p.id));
  const now = (current.comments ?? []).filter((c) => pages.has(c.pageId));
  const ids = new Set(now.map((c) => c.id));
  const back = (restored.comments ?? []).filter((c) => pages.has(c.pageId) && !had.has(c.pageId) && !ids.has(c.id));
  return settleComments(current, { ...restored, comments: [...now, ...back] });
}

/**
 * The comments of a design whose pages were copied with new ids (`clonePageWithIds`, one copy for each page, in the same order):
 * each on the copy of its page, and a pin on an element on the copy of that element (the elements at the top of a page are in the
 * same order in its copy). A comment on a page that has no copy is left out.
 */
export function commentsForCopy(comments: readonly DesignComment[] | undefined, from: readonly Page[], to: readonly Page[]): DesignComment[] {
  const pages = new Map<string, Page>();
  const elements = new Map<string, string>();
  from.forEach((page, i) => {
    const copy = to[i];
    if (!copy) return;
    pages.set(page.id, copy);
    page.elements.forEach((el, j) => {
      const made = copy.elements[j];
      if (made) elements.set(`${page.id}\n${el.id}`, made.id);
    });
  });
  const out: DesignComment[] = [];
  for (const comment of comments ?? []) {
    const page = pages.get(comment.pageId);
    if (!page) continue;
    const { anchor } = comment;
    const elementId = anchor.elementId === undefined ? undefined : elements.get(`${comment.pageId}\n${anchor.elementId}`);
    // (a pin on an element that has no copy stays where it is, on the page)
    const moved: CommentAnchor = elementId === undefined ? { x: anchor.x, y: anchor.y } : { ...anchor, elementId };
    out.push({ ...comment, pageId: page.id, anchor: moved });
  }
  return out;
}

/** The design without its comments: for whoever does not share them (docs/COLLABORATION.md). The same design when it has none. */
export function withoutComments<T extends Design>(design: T): T {
  if (!("comments" in design)) return design;
  const { comments: _comments, ...rest } = design;
  return rest as T;
}

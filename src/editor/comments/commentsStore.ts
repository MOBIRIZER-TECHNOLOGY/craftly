/**
 * The editor's side of comments (src/core/comments.ts has the model and its checks, the store the actions): whether the Comments
 * panel is open and what it shows, the pin that is being placed, the thread to bring into view, whether comments are shared with
 * the others, who this person is as an author, which comments they wrote, and the one sentence a screen reader is told when
 * somebody else comments. None of it belongs to the design.
 */
import { COMMENT_COLORS } from "@/core/comments";
import type { CommentAnchor, CommentAuthor, CommentReply, Design, DesignComment, ID } from "@/core/types";
import { date, m } from "@/i18n";
import { create } from "zustand";
import { myName, shownName, usePresence } from "../live/presence";

export type CommentFilter = "open" | "resolved" | "all";

/**
 * Whether the comments reach the others: `local` without a shared design (they are this person's own), `shared` with a server that
 * said it shares them, `unsupported` with a server from before comments (they stay on this person's copy, and the panel says so).
 */
export type CommentSharing = "local" | "shared" | "unsupported";

/** Who this person is in a team's room (docs/REVIEW.md): their account's id, and whether they are an owner of the team. */
export interface CommentAccount {
  id: string;
  owner: boolean;
}

export interface CommentDraft {
  pageId: ID;
  anchor: CommentAnchor;
}

interface CommentsState {
  panelOpen: boolean;
  filter: CommentFilter;
  /** whether the pins of resolved comments are shown on the page */
  showResolved: boolean;
  /** the pin that is being placed, with its editor open; null when none */
  draft: CommentDraft | null;
  /** the comment whose pin is marked on the page (one chosen in the panel, or one whose pin was clicked) */
  highlight: ID | null;
  /** a thread that the panel brings into view and puts the keyboard into, once */
  focusThread: ID | null;
  /** a pin that takes the keyboard, once (the one just posted) */
  focusPin: ID | null;
  sharing: CommentSharing;
  /** whether the review is shared with the others (a server that said so in its welcome, docs/REVIEW.md) */
  reviews: boolean;
  /** whether this person comments in a design they may not edit (a team's commenter): the Comment tool works in the read-only mode */
  commenting: boolean;
  /** this person's account in a team's room, which what they write is signed with; null anywhere else */
  account: CommentAccount | null;
  /** the last sentence for a screen reader, with a number that changes with each, so that the same words are said again */
  announcement: { text: string; n: number };
}

export const useComments = create<CommentsState>(() => ({
  panelOpen: false,
  filter: "open",
  showResolved: false,
  draft: null,
  highlight: null,
  focusThread: null,
  focusPin: null,
  sharing: "local",
  reviews: false,
  commenting: false,
  account: null,
  announcement: { text: "", n: 0 },
}));

/**
 * Puts away what belongs to the design that is open: the panel, a pin being placed, a marked or focused thread or pin. The
 * editor calls it when a design opens and when it closes, so that a design always starts with the panel closed. The filter and
 * "Show resolved pins" are this person's choices and stay.
 */
export function closeComments(): void {
  useComments.setState({ panelOpen: false, draft: null, highlight: null, focusThread: null, focusPin: null });
}

/** A number for a name, the same on every device, to choose a colour by when there is no number of a connection. */
function nameIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % COMMENT_COLORS;
}

/**
 * This person as the author of a comment: the name they gave for working together (the Share panel), "You" when they gave none
 * outside a shared design and "Guest" with their number inside one; the colour of their presence in a shared design, and one
 * chosen by the name otherwise. Only the place of the colour in the list is kept, never a colour. In a team's room the name is the
 * account's (the server's, from the welcome) and the account's id goes with it: the server takes nothing else (docs/REVIEW.md).
 */
export function myAuthor(): CommentAuthor {
  const presence = usePresence.getState();
  const { me } = presence;
  const account = useComments.getState().account;
  if (me !== null) {
    const author: CommentAuthor = { name: shownName(myName(presence), me), colorIndex: Math.abs(Math.trunc(me)) % COMMENT_COLORS };
    return account ? { ...author, id: account.id } : author;
  }
  const { name } = presence;
  const shown = name || m.editor.comments.you;
  return { name: shown, colorIndex: nameIndex(shown) };
}

/** When something was written, in words of this language. */
export const when = (ms: number): string => {
  try {
    return date(ms, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(ms).toISOString();
  }
};

/* ---------------- which comments are this person's ---------------- */

const MINE_KEY = "craftly.comments.mine";
const MINE_MAX = 2000;
let mine: Set<string> | null = null;

function loadMine(): Set<string> {
  if (mine) return mine;
  mine = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as unknown;
    if (Array.isArray(stored)) for (const id of stored) if (typeof id === "string" && id.length <= 64) mine.add(id);
  } catch {
    /* nothing kept, or not readable: none is known as this person's */
  }
  return mine;
}

/**
 * Notes that this person wrote a comment or a reply, on this device: what lets them edit and delete it in a shared design (there
 * are no accounts, and a name is not a proof of anything). The most recent `MINE_MAX` are kept.
 */
export function rememberMine(id: ID): void {
  const set = loadMine();
  set.add(id);
  while (set.size > MINE_MAX) set.delete(set.values().next().value as string);
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify([...set]));
  } catch {
    /* kept for this visit only */
  }
}

/**
 * Whether this person may edit and delete a comment or reply: their own, and every one in a design that is not shared. In a team's
 * room their own is what carries their account's id, as the server checks it (one without an id is nobody's there).
 */
export function isMine(item: Pick<DesignComment | CommentReply, "id" | "author">, design: Design | null): boolean {
  const account = useComments.getState().account;
  if (account) return item.author.id === account.id;
  return !design?.live || loadMine().has(item.id);
}

/** Whether this person may delete a comment or reply: their own, and anybody's for an owner of the team in its room (moderation). */
export const mayDelete = (item: Pick<DesignComment | CommentReply, "id" | "author">, design: Design | null): boolean =>
  useComments.getState().account?.owner === true || isMine(item, design);

/** Forgets what was read from the storage (the tests start afresh). */
export function resetMine(): void {
  mine = null;
}

/* ---------------- what a screen reader is told ---------------- */

/** The first words of a text, for a name or an announcement: about forty characters, cut at a word. */
export function firstWords(text: string, max = 40): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function announce(text: string): void {
  const { n } = useComments.getState().announcement;
  useComments.setState({ announcement: { text, n: n + 1 } });
}

/**
 * What somebody else added to the comments, between the design before what arrived and after it: one sentence for each new comment
 * or reply, and one for all of them when more than three came at once (a design that comes back after a while). Nothing for what
 * this person wrote.
 */
export function announceArrivals(before: Design | null, after: Design | null): void {
  const known = new Set<string>();
  for (const c of before?.comments ?? []) {
    known.add(c.id);
    for (const r of c.replies) known.add(`${c.id}/${r.id}`);
  }
  const said: string[] = [];
  const kept = loadMine();
  const me = useComments.getState().account?.id;
  const own = (item: DesignComment | CommentReply) => kept.has(item.id) || (me !== undefined && item.author.id === me);
  for (const c of after?.comments ?? []) {
    if (!known.has(c.id) && !own(c)) said.push(m.editor.comments.newFrom(c.author.name, firstWords(c.text)));
    for (const r of c.replies) if (!known.has(`${c.id}/${r.id}`) && !own(r) && known.has(c.id)) said.push(m.editor.comments.newReplyFrom(r.author.name, firstWords(r.text)));
  }
  if (!said.length) return;
  announce(said.length > 3 ? m.editor.comments.manyNew(said.length) : said.join(" "));
}

/**
 * Where the Comment tool was pressed on the page: a pin is placed there and its editor opens. Pressed on an element (the one at
 * the top of the page under the pointer), the pin is on that element and follows it. Outside the page nothing is placed.
 */
export function placeDraft(design: Design, pageId: ID, at: { x: number; y: number }, on: { id: ID; x: number; y: number } | null): boolean {
  if (at.x < 0 || at.y < 0 || at.x > design.width || at.y > design.height) return false;
  const anchor: CommentAnchor = on ? { x: at.x, y: at.y, elementId: on.id, dx: at.x - on.x, dy: at.y - on.y } : { x: at.x, y: at.y };
  useComments.setState({ draft: { pageId, anchor }, highlight: null });
  return true;
}

/** The comments of a page in the order they were made, numbered from 1 as their pins are. */
export function numbered(design: Design | null, pageId: ID): Array<{ comment: DesignComment; number: number }> {
  return (design?.comments ?? []).filter((c) => c.pageId === pageId).map((comment, i) => ({ comment, number: i + 1 }));
}

/** How many comments of the design are open (not resolved): the number on the Comments button. */
export const openCount = (design: Design | null): number => (design?.comments ?? []).filter((c) => !c.resolved).length;

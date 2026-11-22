/**
 * The messages between a browser and the server that holds a shared design, and the checks that everything which arrives over the
 * network passes before it is applied, on both ends: the server checks what a browser sends (`checkOps`), and a browser checks
 * what the server sends (`parseServerMsg`), because a link names the server and anybody can make a link. No DOM and no Node API
 * in here: it runs on both ends.
 *
 * The flow: a client connects to the address of a room and joins by showing its key in its first message (not in the address, which
 * every server and proxy that it passes writes in a log), is answered with the whole design, its
 * revision and the last numbered batch of its own that the server has applied, and then sends its changes as numbered batches
 * of operations (see ops.ts). The server applies each batch in the order it arrives, answers the sender with `ack` and sends the
 * same operations to everyone else. A batch that is applied twice (a client that sends again after a lost connection) does no
 * harm: the server answers `ack` for a number it has already seen, and nearly every operation is the same when repeated.
 */
import { isRemoteImage } from "@/core/imageSources";
import { isBlendMode } from "@/core/blend";
import { isPlainColor } from "@/core/color";
import { svgProblem } from "@/core/svgSafety";
import type { Design, DesignElement } from "@/core/types";
import { commentsProblem, isCommentId, readComment, readCommentPatch, readReply, readReplyPatch } from "@/core/comments";
import { readReview, reviewProblem } from "@/core/review";
import { elementProblem } from "@/core/usableElement";
import type { Op } from "./ops";
import { cleanName, parsePresence, PRESENCE_NAME_MAX, type PresenceHeard, type PresenceSaid } from "./presence";

/**
 * What a seat may do in a room: edit the design, comment on it (comments, replies and the review, never the design: a team's
 * commenter, docs/REVIEW.md), or look.
 */
export type Role = "edit" | "comment" | "view";
export const canEdit = (role: Role): boolean => role === "edit";
export const canComment = (role: Role): boolean => role === "edit" || role === "comment";

/**
 * Why a browser is not let in or is sent away. `invalid` is never sent: it is what a browser says of a server that sent something it cannot use.
 * `server-error` is a server that could not read the room (its disk failed, or the file is damaged), which is not a room that is gone.
 */
export type DeniedReason = "no-access" | "not-found" | "bad-request" | "server-full" | "too-large" | "server-error" | "invalid";
const DENIED_REASONS: ReadonlySet<string> = new Set<DeniedReason>(["no-access", "not-found", "bad-request", "server-full", "too-large", "server-error", "invalid"]);

/** The longest key that a browser may show; the server's are 22 characters, and the editor reads links with keys of up to 100. */
export const MAX_KEY_LENGTH = 200;

/**
 * What one end may say that it understands, beyond what every version does. `comments`: the comment operations (ops.ts) and a design
 * with comments in a welcome. A browser lists what it understands in its join; a server answers in its welcome with those of them
 * that it supports. Neither side sends the other anything of a feature the other did not name (docs/COLLABORATION.md, "Comments").
 */
export const COMMENTS = "comments";
/**
 * `review`: the review operation (`review.set`), a design with its `review` in a welcome, and the role `comment` (docs/REVIEW.md).
 * A browser that did not name it is given `view` where it would be given `comment`: it would refuse a role it does not know.
 */
export const REVIEW = "review";
export const FEATURES = [COMMENTS, REVIEW] as const;
export type Feature = (typeof FEATURES)[number];

/** A session of an account on the server (docs/ACCOUNTS.md): 32 random bytes in base64url. */
export const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * `join` shows the key, in the first message of every connection and never in an address, which every server and proxy that it passes writes in a log.
 * In a room bound to a design of a space (a team's design opened live, docs/ACCOUNTS.md) it shows the member's `session` instead,
 * and the member's role in the team decides; never both. A join from before accounts has a key and no session.
 * `features` says what this browser understands beyond what every version does; a browser from before features sends none.
 * `presence` says where this person is (presence.ts); it is passed on to the others and kept nowhere.
 */
export type JoinMsg = { t: "join"; client: string; features?: Feature[] } & ({ key: string; session?: undefined } | { session: string; key?: undefined });
export type ClientMsg = JoinMsg | { t: "ops"; seq: number; ops: Op[] } | { t: "ping" } | PresenceSaid;

/**
 * What a join shows to be let in: a key of a link (text of 1 to `MAX_KEY_LENGTH` characters), or a session (`SESSION_TOKEN`, and
 * then no key at all). Null for anything else: no key, a key or a session that is not text of that form, or both at once. The
 * server reads this; which of the two a room takes is the server's (a room bound to a design takes sessions only).
 */
export function joinCredential(msg: unknown): { key: string } | { session: string } | null {
  if (!isObject(msg)) return null;
  if (Object.hasOwn(msg, "session")) {
    const session = msg.session;
    return !Object.hasOwn(msg, "key") && typeof session === "string" && SESSION_TOKEN.test(session) ? { session } : null;
  }
  const key = msg.key;
  return typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH ? { key } : null;
}

/**
 * `peer` in a welcome is the number the server gave this connection, under which the others hear of this person. A server from
 * before there was presence sends none, and a browser then says nothing about where it is, to a server that would not pass it on.
 * `features` are those of the join that the server supports; a server from before features sends none, and a browser then sends it
 * nothing of any feature. `name` is the name the others hear for this person whatever their browser says (an account's, for a seat
 * joined with a session): this person is shown under it too. A seat joined with a key gets none, and its person names themselves.
 */
export type ServerMsg =
  | { t: "welcome"; role: Role; rev: number; lastSeq: number; design: Design; peer?: number; features?: Feature[]; name?: string }
  | { t: "ack"; seq: number; rev: number }
  | { t: "rejected"; seq: number; reason: string }
  | { t: "ops"; rev: number; ops: Op[] }
  | { t: "denied"; reason: DeniedReason }
  | { t: "pong" }
  | PresenceHeard;

/** The most operations in one batch; one editor action makes a handful, pasting a page of a template a few hundred. */
export const MAX_OPS_PER_BATCH = 10_000;
const MAX_ID_LENGTH = 200;
const MAX_PROPS = 200;
const MAX_NESTING = 32;
/** What one value of an operation may be: how deep, how long a text, how long a list, how many properties; and how much content one batch may carry in all. */
const MAX_VALUE_DEPTH = 32;
const MAX_STRING = 1_000_000;
const MAX_LIST = 100_000;
const MAX_KEYS = 2_000;
const MAX_CONTENT = 300_000;
/** Names that, set from outside, would change what an object is and not what it holds. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
/** Properties that hold an address: it may point to a picture of the editor, to the web, to mail or a phone, never to code. */
const ADDRESS_KEYS: ReadonlySet<string> = new Set(["src", "originalSrc", "link", "href", "url"]);
/** Of those, the ones that are loaded as a picture when the design is drawn. */
const PICTURE_KEYS: ReadonlySet<string> = new Set(["src", "originalSrc"]);
const SAFE_ADDRESS = /^(asset:|builtin:|https?:\/\/|mailto:|tel:|#|\/(?!\/)|blob:|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,])/i;
/** The deepest a design may be nested when it arrives whole: its pages, groups of at most MAX_NESTING levels, and what an element holds. */
const MAX_DESIGN_DEPTH = 96;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** How much of a value may be looked at: how deep it goes, and how many values in all. */
interface Budget {
  left: number;
  depth: number;
}

/** What is wrong with a value that came from outside, if anything: the limits above, addresses, markup, colours, blend modes, names. */
function checkValue(value: unknown, key: string, depth: number, budget: Budget): string | null {
  if (depth > budget.depth) return "a value nested too deep";
  if (--budget.left < 0) return "more content than one batch may carry";
  // the name of a mode goes to a canvas and into markup as it is: nothing but a mode may be there (nothing at all is Normal)
  if (key === "blend" && value !== undefined && value !== null && !isBlendMode(value)) return "a blend mode that does not exist";
  if (value === undefined || value === null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "a number that is not finite";
  if (typeof value === "string") {
    if (value.length > MAX_STRING) return "a text that is too long";
    if (ADDRESS_KEYS.has(key) && value !== "" && !SAFE_ADDRESS.test(value)) return `${key} is not a safe address`;
    // a link may lead to the web; a picture may not come from there (src/core/imageSources.ts)
    if (PICTURE_KEYS.has(key) && isRemoteImage(value)) return `${key} is a picture from the web`;
    if (key === "svg" && value !== "") {
      const problem = svgProblem(value);
      if (problem) return `markup that is not plain drawing (${problem})`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_LIST) return "a list that is too long";
    for (const item of value) {
      const error = checkValue(item, key, depth + 1, budget);
      if (error) return error;
    }
    return null;
  }
  if (typeof value !== "object") return `a value of type ${typeof value}`;
  const names = Object.keys(value);
  if (names.length > MAX_KEYS) return "too many properties";
  for (const name of names) {
    if (FORBIDDEN_KEYS.has(name)) return `a property called ${name}`;
    const child = (value as Record<string, unknown>)[name];
    // the colours a graphic is drawn in instead of its own go into its markup as they are
    if (name === "colors" && isObject(child) && !Object.values(child).every(isPlainColor)) return "a recolouring that is not made of plain colours";
    const error = checkValue(child, name, depth + 1, budget);
    if (error) return error;
  }
  return null;
}

function checkProps(op: Record<string, unknown>): string | null {
  if (op.set !== undefined) {
    if (!isObject(op.set)) return `${op.k}: set must be an object`;
    if (Object.keys(op.set).length > MAX_PROPS) return `${op.k}: too many properties`;
  }
  if (op.unset !== undefined) {
    if (!Array.isArray(op.unset) || !op.unset.every((k) => typeof k === "string")) return `${op.k}: unset must be a list of names`;
    if (op.unset.length > MAX_PROPS) return `${op.k}: too many names to remove`;
  }
  return null;
}

/**
 * What is wrong with an element that arrives whole (one that is added, alone or with a page, and every element of a design that
 * is a welcome): it needs an id, and everything that an element of a project file needs, by the same table
 * (src/core/usableElement.ts): a place and a size that are numbers, and what its kind cannot be drawn without. Without this an
 * editor could put `x: "a"` or `paragraphs: 5` into the design of everybody in the room, and the renderer would throw for all.
 */
function checkElement(el: unknown, depth = 0): string | null {
  if (!isObject(el) || !isId(el.id)) return "an element needs an id";
  const problem = elementProblem(el);
  if (problem) return problem;
  if (el.type === "group") {
    if (depth >= MAX_NESTING) return "groups nested too deep";
    for (const child of el.children as unknown[]) {
      const error = checkElement(child, depth + 1);
      if (error) return error;
    }
  }
  return null;
}

/** What a list of features may be, in a join or a welcome: a few short names. */
const MAX_FEATURES = 16;
const MAX_FEATURE_NAME = 40;
const isFeatureList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_FEATURES && v.every((name) => typeof name === "string" && name.length > 0 && name.length <= MAX_FEATURE_NAME);

/**
 * What a browser said in its join that it understands (the server reads this; it is not checked otherwise, because a join from
 * before features has none): comments only when `features` is a short list of short names with "comments" in it.
 */
export function joinFeatures(value: unknown): { comments: boolean; review: boolean } {
  const features = isObject(value) ? value.features : undefined;
  const listed = isFeatureList(features);
  return { comments: listed && features.includes(COMMENTS), review: listed && features.includes(REVIEW) };
}

/** The fields of each comment operation, and no other (the other operations are older and are not held to their fields). */
const COMMENT_OP_FIELDS: Record<string, readonly string[]> = {
  "comment.add": ["k", "comment", "index"],
  "comment.set": ["k", "id", "set", "unset"],
  "comment.del": ["k", "id"],
  "reply.add": ["k", "comment", "reply", "index"],
  "reply.set": ["k", "comment", "id", "set", "unset"],
  "reply.del": ["k", "comment", "id"],
  "review.set": ["k", "review"],
};

/** What is wrong with a comment operation, if anything: each touches one comment or reply by its id (src/core/comments.ts reads the rest). */
function checkCommentOp(op: Record<string, unknown>): string | null {
  const extra = Object.keys(op).find((key) => !COMMENT_OP_FIELDS[op.k as string].includes(key));
  if (extra !== undefined) return `a field that this operation does not have (${extra.slice(0, 40)})`;
  const removes = (): string | null =>
    op.unset === undefined || (Array.isArray(op.unset) && op.unset.length === 1 && op.unset[0] === "editedAt") ? null : "only the time of an edit may be taken away";
  switch (op.k) {
    case "comment.add": {
      if (!isIndex(op.index)) return "an addition needs an index";
      const read = readComment(op.comment);
      return typeof read === "string" ? read : null;
    }
    case "comment.set": {
      if (!isCommentId(op.id)) return "a change needs the id of a comment";
      if (op.set === undefined && op.unset === undefined) return "a change that changes nothing";
      const read = op.set === undefined ? null : readCommentPatch(op.set);
      return typeof read === "string" ? read : removes();
    }
    case "comment.del":
      return isCommentId(op.id) ? null : "a deletion needs the id of a comment";
    case "reply.add": {
      if (!isCommentId(op.comment) || !isIndex(op.index)) return "a reply needs the id of its comment and an index";
      const read = readReply(op.reply);
      return typeof read === "string" ? read : null;
    }
    case "reply.set": {
      if (!isCommentId(op.comment) || !isCommentId(op.id)) return "a change of a reply needs its id and that of its comment";
      if (op.set === undefined && op.unset === undefined) return "a change that changes nothing";
      const read = op.set === undefined ? null : readReplyPatch(op.set);
      return typeof read === "string" ? read : removes();
    }
    case "reply.del":
      return isCommentId(op.comment) && isCommentId(op.id) ? null : "a deletion of a reply needs its id and that of its comment";
    default: {
      const read = readReview(op.review);
      return typeof read === "string" ? read : null;
    }
  }
}

/** The operations, if every one of them has the form it should; otherwise what is wrong with the first that has not. */
export function checkOps(value: unknown): Op[] | string {
  if (!Array.isArray(value)) return "a batch is a list of operations";
  if (value.length > MAX_OPS_PER_BATCH) return "too many operations in one batch";
  const budget: Budget = { left: MAX_CONTENT, depth: MAX_VALUE_DEPTH };
  for (const op of value) {
    if (!isObject(op) || typeof op.k !== "string") return "an operation needs a kind";
    let error: string | null = null;
    switch (op.k) {
      case "design":
        error = checkProps(op);
        break;
      case "page.add":
        if (!isObject(op.page) || !isId(op.page.id) || !Array.isArray(op.page.elements) || !isIndex(op.index)) error = "page.add needs a page with elements and an index";
        else for (const el of op.page.elements) error = error ?? checkElement(el);
        break;
      case "page.del":
        if (!isId(op.id)) error = "page.del needs an id";
        break;
      case "page.move":
        if (!isId(op.id) || !isIndex(op.index)) error = "page.move needs an id and an index";
        break;
      case "page.set":
        error = !isId(op.id) ? "page.set needs an id" : checkProps(op);
        break;
      case "el.add":
        if (!isId(op.page) || !(op.parent === null || isId(op.parent)) || !isIndex(op.index)) error = "el.add needs a page, a parent (or null) and an index";
        else error = checkElement(op.el);
        break;
      case "el.del":
        if (!isId(op.page) || !isId(op.id)) error = "el.del needs a page and an id";
        break;
      case "el.move":
        if (!isId(op.page) || !isId(op.id) || !(op.parent === null || isId(op.parent)) || !isIndex(op.index))
          error = "el.move needs a page, an id, a parent (or null) and an index";
        break;
      case "el.set":
        error = !isId(op.page) || !isId(op.id) ? "el.set needs a page and an id" : checkProps(op);
        break;
      default:
        error = Object.hasOwn(COMMENT_OP_FIELDS, op.k) ? checkCommentOp(op) : `unknown operation ${op.k.slice(0, 40)}`;
    }
    // (a comment and a reply are read field by field above; they count towards what one batch may carry like everything else)
    for (const part of [op.set, op.page, op.el, op.comment, op.reply, op.review]) error = error ?? (part === undefined ? null : checkValue(part, "", 0, budget));
    if (error) return `${op.k}: ${error}`;
  }
  return value as Op[];
}

/** Every element of a page by its id, at any depth; the first of an id when a design came with two, which is the one an operation finds. */
function elementsById(design: Design, pageId: string): Map<string, DesignElement> {
  const found = new Map<string, DesignElement>();
  const walk = (list: readonly DesignElement[]) => {
    for (const el of list) {
      if (!found.has(el.id)) found.set(el.id, el);
      if (el.type === "group") walk(el.children);
    }
  };
  const page = design.pages.find((p) => p.id === pageId);
  if (page) walk(page.elements);
  return found;
}

/**
 * What is wrong with what a batch left of the elements whose properties it changed (`el.set`), if anything. `checkOps` cannot
 * know this: an operation names an element by its id and does not say what kind it is, and whether `stroke: null` is fine (a
 * shape) or breaks the renderer (a line) depends on the kind. So the batch is applied to a copy first (`applyOps`, which is safe
 * whatever it is given), and every element it set a property of is then asked the question an element of a project file is asked
 * (src/core/usableElement.ts): are the properties its kind needs still there, and of the right kind? Properties that the table
 * does not name pass as before. What counts is the element as the whole batch leaves it, so the answer does not depend on how a
 * change was cut into operations.
 *
 * An element that was not usable before the batch is not held against it: a room from before this check may hold one, and
 * refusing every later change to it would not mend it. `before` and `after` are the design the batch was applied to and what it
 * gave. The server refuses a batch that fails (`rejected`), and a browser ends its session with a server that sends one.
 */
export function checkSets(before: Design, after: Design, ops: readonly Op[]): string | null {
  // (an index of a page is built once, when the first change to that page asks for it: most batches change one page)
  const indexes = new Map<Design, Map<string, Map<string, DesignElement>>>([
    [before, new Map()],
    [after, new Map()],
  ]);
  const find = (design: Design, pageId: string, id: string): DesignElement | undefined => {
    const pages = indexes.get(design)!;
    let index = pages.get(pageId);
    if (!index) pages.set(pageId, (index = elementsById(design, pageId)));
    return index.get(id);
  };
  const asked = new Map<string, Set<string>>();
  for (const op of ops) {
    if (op.k !== "el.set") continue;
    let onPage = asked.get(op.page);
    if (!onPage) asked.set(op.page, (onPage = new Set()));
    if (onPage.has(op.id)) continue;
    onPage.add(op.id);
    const el = find(after, op.page, op.id);
    if (!el) continue; // it is not there (any more): nothing was changed
    const problem = elementProblem(el);
    if (!problem) continue;
    const was = find(before, op.page, op.id);
    if (was && elementProblem(was) !== null) continue;
    return `el.set: ${problem}`;
  }
  return null;
}

/**
 * What is wrong with a design that arrives whole, as the welcome of a server, if anything: a title and a size, pages with elements
 * that are elements, and the same check of everything in it as for the operations of a batch, but not the limit of what one batch
 * may carry, because a design that many batches have built up can hold more than that.
 */
export function checkDesign(value: unknown): string | null {
  if (!isObject(value)) return "a design is an object";
  if (typeof value.title !== "string") return "a design needs a title";
  for (const size of [value.width, value.height]) if (typeof size !== "number" || size <= 0) return "a design needs a size"; // a size that is not finite is refused by the walk below
  for (const key of ["unit", "typeId"]) if (value[key] !== undefined && typeof value[key] !== "string") return `${key} is text`;
  if (!Array.isArray(value.pages) || value.pages.length < 1) return "a design needs pages";
  for (const page of value.pages) {
    if (!isObject(page) || !isId(page.id) || !Array.isArray(page.elements)) return "a page needs an id and its elements";
    for (const el of page.elements) {
      const error = checkElement(el);
      if (error) return error;
    }
  }
  // the comments, as strictly as a comment operation (src/core/comments.ts); a design from before comments has none
  const comments = commentsProblem(value.comments);
  if (comments) return comments;
  // the review, as strictly as its operation (src/core/review.ts); a design from before reviews has none
  const review = reviewProblem(value.review);
  if (review) return `the review: ${review}`;
  return checkValue(value, "", 0, { left: Infinity, depth: MAX_DESIGN_DEPTH });
}

/**
 * What a server said, if it is a message of this version of the protocol, in the form it should have and with nothing in it that a
 * browser could not safely use: the message itself (only what it is made of), a sentence about what is wrong with it, or null for a
 * kind of message that a newer server may send and this version does not know, which is ignored.
 */
export function parseServerMsg(value: unknown): ServerMsg | string | null {
  if (!isObject(value) || typeof value.t !== "string") return "a message needs a kind";
  switch (value.t) {
    case "welcome": {
      if (value.role !== "edit" && value.role !== "comment" && value.role !== "view") return "welcome: the role is edit, comment or view";
      if (!isCount(value.rev) || !isCount(value.lastSeq)) return "welcome: the revision and the last batch are counts";
      if (value.peer !== undefined && !isCount(value.peer)) return "welcome: the number of a connection is a count";
      if (value.features !== undefined && !isFeatureList(value.features)) return "welcome: the features are a few short names";
      if (value.name !== undefined && (typeof value.name !== "string" || value.name.length > PRESENCE_NAME_MAX)) return "welcome: the name is a short text";
      const problem = checkDesign(value.design);
      if (problem) return `welcome: ${problem}`;
      const welcome: Extract<ServerMsg, { t: "welcome" }> = { t: "welcome", role: value.role, rev: value.rev, lastSeq: value.lastSeq, design: value.design as Design };
      if (value.peer !== undefined) welcome.peer = value.peer;
      // (made into a name presence may say, as any name that is shown; one that is left with nothing is no name)
      const name = typeof value.name === "string" ? cleanName(value.name) : "";
      if (name) welcome.name = name;
      // (a newer server may name features that this version does not know: they are not kept)
      if (value.features !== undefined) welcome.features = value.features.filter((name): name is Feature => (FEATURES as readonly string[]).includes(name));
      return welcome;
    }
    case "presence": {
      const heard = parsePresence(value);
      return typeof heard === "string" ? `presence: ${heard}` : heard;
    }
    case "ack":
      return isCount(value.seq) && isCount(value.rev) ? { t: "ack", seq: value.seq, rev: value.rev } : "ack: a batch and a revision are counts";
    case "rejected":
      return typeof value.seq === "number" && Number.isFinite(value.seq) && typeof value.reason === "string"
        ? { t: "rejected", seq: value.seq, reason: value.reason }
        : "rejected: a batch is a number and a reason is text";
    case "ops": {
      if (!isCount(value.rev)) return "ops: the revision is a count";
      const ops = checkOps(value.ops);
      return typeof ops === "string" ? `ops: ${ops}` : { t: "ops", rev: value.rev, ops };
    }
    case "denied":
      return typeof value.reason === "string" && DENIED_REASONS.has(value.reason) ? { t: "denied", reason: value.reason as DeniedReason } : "denied: a reason that nobody has";
    case "pong":
      return { t: "pong" };
    default:
      return null;
  }
}

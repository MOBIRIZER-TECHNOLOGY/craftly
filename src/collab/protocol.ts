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
import { isBlendMode } from "@/core/blend";
import { isPlainColor } from "@/core/color";
import { svgProblem } from "@/core/svgSafety";
import type { Design, ElementType } from "@/core/types";
import type { Op } from "./ops";

export type Role = "edit" | "view";
export const canEdit = (role: Role): boolean => role === "edit";

/** Why a browser is not let in or is sent away. `invalid` is never sent: it is what a browser says of a server that sent something it cannot use. */
export type DeniedReason = "no-access" | "not-found" | "bad-request" | "server-full" | "too-large" | "invalid";
const DENIED_REASONS: ReadonlySet<string> = new Set<DeniedReason>(["no-access", "not-found", "bad-request", "server-full", "too-large", "invalid"]);

/** The longest key that a browser may show; the server's are 22 characters, and the editor reads links with keys of up to 100. */
export const MAX_KEY_LENGTH = 200;

/** `join` shows the key, in the first message of every connection and never in an address, which every server and proxy that it passes writes in a log. */
export type ClientMsg = { t: "join"; client: string; key: string } | { t: "ops"; seq: number; ops: Op[] } | { t: "ping" };

export type ServerMsg =
  | { t: "welcome"; role: Role; rev: number; lastSeq: number; design: Design }
  | { t: "ack"; seq: number; rev: number }
  | { t: "rejected"; seq: number; reason: string }
  | { t: "ops"; rev: number; ops: Op[] }
  | { t: "denied"; reason: DeniedReason }
  | { t: "pong" };

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
const SAFE_ADDRESS = /^(asset:|builtin:|https?:\/\/|mailto:|tel:|#|\/(?!\/)|blob:|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,])/i;
/** The deepest a design may be nested when it arrives whole: its pages, groups of at most MAX_NESTING levels, and what an element holds. */
const MAX_DESIGN_DEPTH = 96;

const ELEMENT_TYPES: ReadonlySet<string> = new Set<ElementType>(["text", "shape", "line", "image", "graphic", "group", "table", "chart"]);

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

function checkElement(el: unknown, depth = 0): string | null {
  if (!isObject(el) || !isId(el.id)) return "an element needs an id";
  if (typeof el.type !== "string" || !ELEMENT_TYPES.has(el.type)) return "an element needs a kind that exists";
  if (el.type === "group") {
    if (depth >= MAX_NESTING) return "groups nested too deep";
    if (!Array.isArray(el.children)) return "a group needs its children";
    for (const child of el.children) {
      const error = checkElement(child, depth + 1);
      if (error) return error;
    }
  }
  return null;
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
        error = `unknown operation ${op.k.slice(0, 40)}`;
    }
    for (const part of [op.set, op.page, op.el]) error = error ?? (part === undefined ? null : checkValue(part, "", 0, budget));
    if (error) return `${op.k}: ${error}`;
  }
  return value as Op[];
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
      if (value.role !== "edit" && value.role !== "view") return "welcome: the role is edit or view";
      if (!isCount(value.rev) || !isCount(value.lastSeq)) return "welcome: the revision and the last batch are counts";
      const problem = checkDesign(value.design);
      if (problem) return `welcome: ${problem}`;
      return { t: "welcome", role: value.role, rev: value.rev, lastSeq: value.lastSeq, design: value.design as Design };
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

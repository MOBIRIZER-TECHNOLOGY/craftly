/**
 * Presence: what the people in a shared design see of each other while they work. Where a person's pointer is, what they have
 * selected, which text box they are typing in, and the name they gave. It is said many times a second, passed on by the server to
 * the others in the room, and kept nowhere: it is no part of the design, has no revision and no batch number, is never
 * acknowledged, and may be dropped whenever there is too much of it. Whoever misses one hears the next.
 *
 * It is read as strictly as everything else that arrives (protocol.ts), on both ends: the server reads what a browser says
 * (`checkPresence`), and a browser reads what a server passes on (`parsePresence`). A name is plain text of a bounded length and
 * is shown as text. There is no colour on the wire at all: a person's colour is chosen from a fixed list by the number the
 * server gave their connection, so nothing that arrives is ever used as CSS. No DOM and no Node API in here.
 */

/** The longest name a person may give, in UTF-16 units. */
export const PRESENCE_NAME_MAX = 40;
/** The most elements of a selection that are said; a person who selects more shows the first so many. */
export const PRESENCE_SELECTION_MAX = 50;
/** The longest id that is said. The editor's own ids are far shorter; an element with a longer one is not shown as selected. */
export const PRESENCE_ID_MAX = 64;
/** The furthest from the corner of a page that a pointer may be, in design pixels: what is further is held there. */
export const PRESENCE_COORD_MAX = 1_000_000;
/** How long a person who is not heard of still counts: as somebody who is here, and as the one who is typing in a text box. */
export const PRESENCE_STALE_MS = 10_000;

export interface PresenceState {
  /** The name the person gave, or "" for one who gave none (shown as "Guest" with their number). */
  name: string;
  /** The page the person has open, which the pointer and the selection are on. */
  page: string | null;
  /** Where the pointer is, in design pixels from the corner of the page; null when it is not over the canvas. */
  pointer: { x: number; y: number } | null;
  /** The ids of the elements the person has selected. */
  selection: string[];
  /** The id of the text box the person is typing in, or null. */
  editing: string | null;
}

/** What a browser says. */
export type PresenceSaid = { t: "presence" } & PresenceState;

/** What a server passes on: the state of a person under the number it gave their connection, or the word that they have gone. */
export type PresenceHeard = ({ t: "presence"; peer: number } & PresenceState) | { t: "presence"; peer: number; gone: true };

const STATE_KEYS = ["name", "page", "pointer", "selection", "editing"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= PRESENCE_ID_MAX;
const hold = (n: number): number => Math.max(-PRESENCE_COORD_MAX, Math.min(PRESENCE_COORD_MAX, n));

/**
 * Whether a character has no place in a name: one that controls a terminal or a line (C0, DEL, C1), a line or paragraph
 * separator, and the marks that turn the direction of text around, with which a name could be made to read as another.
 */
function unprintable(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x200e || code === 0x200f || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function nameProblem(name: unknown): string | null {
  if (typeof name !== "string") return "a name is text";
  if (name.length > PRESENCE_NAME_MAX) return "a name that is too long";
  for (let i = 0; i < name.length; i++) if (unprintable(name.charCodeAt(i))) return "a name with a character that cannot be shown";
  return null;
}

/** The state in a message, read field by field; `allowed` are the names the message may have, and it may have no other. */
function readState(value: Record<string, unknown>, allowed: readonly string[]): PresenceState | string {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return `a field that presence does not have (${key.slice(0, 40)})`;
  const wrongName = nameProblem(value.name);
  if (wrongName) return wrongName;
  if (value.page !== null && !isId(value.page)) return "a page is an id or nothing";
  let pointer: PresenceState["pointer"] = null;
  if (value.pointer !== null) {
    const p = value.pointer;
    if (!isObject(p) || Object.keys(p).length !== 2 || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return "a pointer is a place (x and y, finite numbers) or nothing";
    }
    pointer = { x: hold(p.x), y: hold(p.y) };
  }
  if (!Array.isArray(value.selection) || value.selection.length > PRESENCE_SELECTION_MAX || !value.selection.every(isId)) return "a selection is a short list of ids";
  if (value.editing !== null && !isId(value.editing)) return "a text being typed in is an id or nothing";
  return { name: value.name as string, page: value.page as string | null, pointer, selection: value.selection as string[], editing: value.editing as string | null };
}

/** What a browser said about where it is, if it has the form it should: the state alone. Otherwise what is wrong with it. */
export function checkPresence(value: unknown): PresenceState | string {
  if (!isObject(value)) return "presence is an object";
  return readState(value, ["t", ...STATE_KEYS]);
}

/** What a server passed on about another person, if it has the form it should; otherwise what is wrong with it. */
export function parsePresence(value: Record<string, unknown>): PresenceHeard | string {
  const peer = value.peer;
  if (typeof peer !== "number" || !Number.isSafeInteger(peer) || peer < 0) return "a person has a number";
  if (value.gone !== undefined) {
    if (value.gone !== true || Object.keys(value).length !== 3) return "gone is said alone";
    return { t: "presence", peer, gone: true };
  }
  const state = readState(value, ["t", "peer", ...STATE_KEYS]);
  return typeof state === "string" ? state : { t: "presence", peer, ...state };
}

/**
 * A name as a person typed it, made into one that may be said: without what cannot be shown, with one space where there was any
 * run of them, nothing around it, and no longer than a name may be (cut between characters, never through one).
 */
export function cleanName(typed: string): string {
  let kept = "";
  for (const char of typed) {
    const code = char.codePointAt(0) as number;
    kept += char === "\n" || char === "\t" || char === "\r" ? " " : unprintable(code) ? "" : char;
  }
  let name = "";
  for (const char of kept.replace(/\s+/g, " ").trim()) {
    if (name.length + char.length > PRESENCE_NAME_MAX) break;
    name += char;
  }
  return name.trimEnd();
}

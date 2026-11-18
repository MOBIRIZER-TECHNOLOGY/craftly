/**
 * The editor's side of presence (src/collab/presence.ts): who else is in the shared design that is open, where their pointers
 * are and what they have selected; the name this person gave, kept on this device; and what is said about this person to the
 * others. None of it belongs to the design: it lives in this small store for as long as the connection does.
 *
 * What is said is said sparingly. A pointer that moves is worth a dozen messages a second and no more; a change of the
 * selection or the page waits for the same slot; starting and stopping to type in a text box is said at once, because the others
 * must not open that box meanwhile. When nothing changes the last word is repeated every few seconds, which is how the others
 * know that this person is still here: somebody who is not heard of for `PRESENCE_STALE_MS` is taken off the list.
 */
import { cleanName, PRESENCE_ID_MAX, PRESENCE_SELECTION_MAX, PRESENCE_STALE_MS, type PresenceHeard, type PresenceState } from "@/collab/presence";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { create } from "zustand";

/**
 * The colours people are shown in. A person's colour is chosen from this list by the number the server gave their connection,
 * so no colour ever comes over the wire. Each is dark enough for white text on it (4.5 to 1 or more: a test holds them to it),
 * and none is the violet of this person's own selection.
 */
export const PRESENCE_COLORS: readonly string[] = [
  "#b42318",
  "#1d4ed8",
  "#15803d",
  "#c2410c",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
  "#a16207",
  "#0f766e",
  "#525252",
  "#9f1239",
  "#1e3a8a",
];

/** The least time between two words about this person: 12 a second at most, under the 15 a second the server passes on. */
export const SAY_EVERY_MS = 80;
/** How often the last word is said again while nothing changes; three of them fit into the time after which a person counts as gone. */
export const REPEAT_EVERY_MS = 3000;

const NAME_KEY = "craftly.live.name";

/** Another person in the design, as last heard. */
export interface Person extends PresenceState {
  peer: number;
  /** The name to show: the one they gave, or "Guest" with their number. */
  name: string;
  color: string;
  /** When they were last heard of, in milliseconds. */
  heard: number;
}

interface PresenceStore {
  /** The number of this person's own connection while they are in a room that passes presence on; null otherwise. */
  me: number | null;
  /** The name this person gave ("" for none). */
  name: string;
  /**
   * The name the server hears this person under whatever this browser says, from its welcome: an account's, for a seat of a team's
   * design joined with a session. Null for none (a seat joined with a key, whose person names themselves) and without a connection.
   */
  fixedName: string | null;
  /** The others, in the order of their numbers. */
  people: Person[];
}

export const colorOf = (peer: number): string => PRESENCE_COLORS[Math.abs(Math.trunc(peer)) % PRESENCE_COLORS.length];

/** The name a person is shown under: the one they gave, or a word and their number. */
export const shownName = (name: string, peer: number): string => name || m.editor.live.guest(peer);

/** The name this person gave on this device, as one that may be said (what is in the storage is not taken for granted either). */
export function savedName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) ?? "");
  } catch {
    return "";
  }
}

export const usePresence = create<PresenceStore>(() => ({ me: null, name: savedName(), fixedName: null, people: [] }));

/** The name this person is shown under to themselves: the one the server hears them under when it fixes one, or the one they gave. */
export const myName = (s: Pick<PresenceStore, "name" | "fixedName">): string => s.fixedName ?? s.name;

/** Takes the name a person typed, keeps it on this device, and gives back what the others will see. */
export function saveName(typed: string): string {
  const name = cleanName(typed);
  usePresence.setState({ name });
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* it is used for this visit and asked for again on the next */
  }
  return name;
}

/** What the server passed on about another person: they are put on the list as they are now, or taken off it. */
export function heardPresence(msg: PresenceHeard, now = Date.now()): void {
  const rest = usePresence.getState().people.filter((p) => p.peer !== msg.peer);
  if ("gone" in msg) {
    if (rest.length !== usePresence.getState().people.length) usePresence.setState({ people: rest });
    return;
  }
  const person: Person = {
    peer: msg.peer,
    name: shownName(msg.name, msg.peer),
    color: colorOf(msg.peer),
    page: msg.page,
    pointer: msg.pointer,
    selection: msg.selection,
    editing: msg.editing,
    heard: now,
  };
  usePresence.setState({ people: [...rest, person].sort((a, b) => a.peer - b.peer) });
}

/** Who of the others is typing in this text box, if anybody. Somebody who was taken off the list no longer is. */
export const typingIn = (id: string): Person | undefined => usePresence.getState().people.find((p) => p.editing === id);

/** Takes the people off the list who have not been heard of for too long: their browser is gone, or their network is. */
export function forgetStale(now: number): void {
  const people = usePresence.getState().people;
  const kept = people.filter((p) => now - p.heard <= PRESENCE_STALE_MS);
  if (kept.length !== people.length) usePresence.setState({ people: kept });
}

/** The connection is gone: nobody is known to be here, and this person has no number. */
export function clearPresence(): void {
  usePresence.setState({ me: null, fixedName: null, people: [] });
}

/* ---------------- what is said about this person ---------------- */

let pointer: { x: number; y: number } | null = null;
const pointerListeners = new Set<() => void>();

/** Where this person's pointer is on the open page, in design pixels, or null when it is not over the canvas (the overlay tells). */
export function setPointer(at: { x: number; y: number } | null): void {
  if (at === null && pointer === null) return;
  pointer = at;
  for (const listener of pointerListeners) listener();
}

/** The page this runs in; none where there is no browser (the tests of the connection run without one). */
const doc: Document | undefined = typeof document === "undefined" ? undefined : document;
/** Where this person's pointer was last said to be. */
export const pointerNow = (): { x: number; y: number } | null => pointer;

const tenth = (n: number): number => Math.round(n * 10) / 10 || 0;
const sayable = (id: string): boolean => id.length > 0 && id.length <= PRESENCE_ID_MAX;

/** Where this person is now, as it is said; null while no design is open. */
function current(): PresenceState | null {
  const s = useEditor.getState();
  if (!s.design) return null;
  return {
    name: usePresence.getState().name,
    page: sayable(s.activePageId) ? s.activePageId : null,
    // a tab that is not looked at has no pointer worth showing
    pointer: pointer && !doc?.hidden ? { x: tenth(pointer.x), y: tenth(pointer.y) } : null,
    selection: s.selection.filter(sayable).slice(0, PRESENCE_SELECTION_MAX),
    editing: s.editingTextId && sayable(s.editingTextId) ? s.editingTextId : null,
  };
}

/**
 * Says where this person is, through `send` (which answers whether it could), from now until the returned function is called.
 * `me` is the number the server gave this connection, and `fixedName` the name the server hears this person under whatever is said
 * here (an account's), if it fixes one.
 */
export function startPresence(send: (state: PresenceState) => boolean, me: number, fixedName: string | null = null): () => void {
  usePresence.setState({ me, fixedName });
  let lastSaid = "";
  let lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Says it now: when it is not what was last said, or (`again`) also when it is. */
  const say = (again: boolean) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const state = current();
    if (!state) return;
    const text = JSON.stringify(state);
    if (!again && text === lastSaid) return;
    // what could not be said is not remembered as said: the next repeat says it
    lastSaid = send(state) ? text : "";
    lastAt = Date.now();
  };
  /** Says it when the next word is due. */
  const soon = () => {
    if (timer) return;
    timer = setTimeout(() => say(false), Math.max(0, lastAt + SAY_EVERY_MS - Date.now()));
  };

  const offEditor = useEditor.subscribe((s, prev) => {
    // typing in a text box is said at once: until the others know, any of them may open the same box
    if (s.editingTextId !== prev.editingTextId) say(false);
    else if (s.selection !== prev.selection || s.activePageId !== prev.activePageId || !s.design !== !prev.design) soon();
  });
  const offName = usePresence.subscribe((s, prev) => {
    if (s.name !== prev.name) soon();
  });
  pointerListeners.add(soon);
  doc?.addEventListener("visibilitychange", soon);
  const repeat = setInterval(() => {
    forgetStale(Date.now());
    say(true);
  }, REPEAT_EVERY_MS);
  say(true);

  return () => {
    if (timer) clearTimeout(timer);
    clearInterval(repeat);
    offEditor();
    offName();
    pointerListeners.delete(soon);
    doc?.removeEventListener("visibilitychange", soon);
    if (usePresence.getState().me === me) usePresence.setState({ me: null, fixedName: null });
  };
}

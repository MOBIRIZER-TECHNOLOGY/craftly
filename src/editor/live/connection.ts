/**
 * The editor's side of a shared design (docs/COLLABORATION.md): starting to share a design that is open, keeping it in step with the
 * server while it is open, stopping, and joining a design that somebody else shares. The store (src/core/store.ts) holds the design
 * and the history; this module owns the connection (src/collab/live.ts) and tells the store what arrives.
 */
import { rememberServer } from "./knownServers";
import { Live, type LiveStatus, type SocketLike } from "@/collab/live";
import { checkOps, COMMENTS, type DeniedReason, type Role } from "@/collab/protocol";
import { announceArrivals, useComments } from "../comments/commentsStore";
import type { Outbox } from "@/collab/session";
import { uid } from "@/core/ids";
import { saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design, LiveLink } from "@/core/types";
import { downloadBlob } from "@/export/download";
import { exportProjectFile, projectFileName } from "@/export/projectFile";
import { m } from "@/i18n";
import { collectAssetIds, portableDesign } from "@/export/projectFormat";
import { toast } from "@/ui";
import { create } from "zustand";
import { apiUrl, normalizeServer, websocketUrl } from "./links";
import { sharedMedia } from "./media";
import { clearPresence, heardPresence, shownName, startPresence, typingIn } from "./presence";

export interface LiveEnv {
  createSocket?: (url: string) => SocketLike;
  fetch?: typeof fetch;
  /** How long to wait for a server when joining, in milliseconds. */
  timeoutMs?: number;
  /** A member's session in place of the link's key: a room bound to a design of their team (docs/ACCOUNTS.md, src/editor/live/teamLive.ts). */
  session?: string;
  /** The server turned this browser away, or the room is gone: the team's room is then asked for again. */
  onDenied?: (reason: DeniedReason | null) => void;
  /**
   * Told when the connection is closed for good, before anything of it is let go: whether it was ever in the room, how many edits of
   * this person the server had not confirmed, and the design as the server last confirmed it (null before its welcome).
   */
  onStop?: (end: { reachedLive: boolean; unsent: number; room: Design | null }) => void;
}

export interface LiveStatusState {
  /** "off" while the open design is not connected to anybody */
  status: "off" | LiveStatus;
  reason: DeniedReason | null;
  /** what the key allows, known once the server has answered */
  role: Role | null;
  /**
   * The owner of a design that this person joined by a link stopped sharing it: the room this person was in is gone. (The server
   * says that the room is not there; for somebody who was in it with a link, that is what it means.)
   */
  stopped: boolean;
}

/** What the top bar and the Share panel show about the connection of the open design. */
export const useLiveStatus = create<LiveStatusState>(() => ({ status: "off", reason: null, role: null, stopped: false }));

const OFF: LiveStatusState = { status: "off", reason: null, role: null, stopped: false };

/** What a person is told about the connection when it ends: the owner stopped sharing, or why it was refused. */
export const endedText = (s: Pick<LiveStatusState, "reason" | "stopped">): string | null => (s.stopped ? m.editor.live.ownerStopped : s.reason ? deniedText(s.reason) : null);

/** What a person is told when the connection ends for this reason. */
export const deniedText = (reason: DeniedReason): string => m.editor.live.denied[reason];

/**
 * Keeps the open design in step with the server for as long as the returned function has not been called: what other people do is
 * shown, what this person does is sent, and the history becomes this person's own steps. A key that only lets people look makes the
 * design read-only.
 */
interface StoredOutbox extends Outbox {
  uploads?: string[];
}

function readOutbox(key: string): StoredOutbox | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as StoredOutbox | null;
    if (!value || !/^[a-f0-9]{16}$/.test(value.client) || !Number.isSafeInteger(value.nextSeq) || !Array.isArray(value.queue)) return;
    if (!value.queue.every((batch) => batch && Number.isSafeInteger(batch.seq) && typeof checkOps(batch.ops) !== "string")) return;
    if (value.uploads && (!Array.isArray(value.uploads) || !value.uploads.every((id) => typeof id === "string"))) return;
    return value;
  } catch {
    return undefined;
  }
}

/** The design as it is now, as a design of its own in the library that is not shared: what a person goes back to for edits that did not get through. */
function recoveryCopy(design: Design, id: string): Design {
  const now = Date.now();
  return { ...portableDesign(design), id, title: m.editor.live.unsentTitle(design.title), createdAt: now, updatedAt: now, trashedAt: null };
}

/** The names in localStorage that start with `prefix`; none where there is no such storage. */
function storedNames(prefix: string): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "").filter((name) => name.startsWith(prefix));
  } catch {
    return [];
  }
}

export function connectLive(link: LiveLink, env: LiveEnv = {}): () => void {
  const actions = () => useEditor.getState().actions;
  let looking = link.role === "view";
  if (looking) actions().setMode("view");
  let closed = false;
  let warned = false;
  const designId = useEditor.getState().design?.id;
  const key = `craftly:outbox:${designId}:${link.server}:${link.room}`;
  const media = sharedMedia(link, env.fetch, env.session);
  const outbox = readOutbox(key);
  const allowedUploads = new Set(outbox?.uploads);

  /**
   * Makes what keeps a recovery copy in the library and says so; when the library cannot take it, the copy is offered as a download
   * (once: the download is of the copy as it was last). `told` is whether the person has been told about this copy already: it is
   * still kept then, without another word.
   */
  const keeper = () => {
    let latest: Design;
    let offered = false;
    return (copy: Design, what: string, told = false) => {
      latest = copy;
      void saveDesign(copy).then(
        () => void (told || toast.error(m.editor.live.recoveryInProjects(what), { duration: 0 })),
        () => {
          if (offered) return;
          offered = true;
          toast.error(m.editor.live.recoveryDownload(what), {
            duration: 0,
            actionLabel: m.editor.recovery.downloadCopy,
            onAction: () =>
              void exportProjectFile(latest)
                .then((blob) => downloadBlob(blob, projectFileName(latest.title)))
                .catch(() => toast.error(m.editor.recovery.downloadFailed)),
          });
        },
      );
    };
  };
  const keepLocal = keeper();
  const keepRefused = keeper();

  // The edits that wait to be confirmed are kept for a reload in sessionStorage, which goes with the tab (and has to: two tabs that
  // shared them would share a name and batch numbers). The design itself is saved in the library with those edits in it, and the
  // welcome of the server replaces it with the server's. So that a tab which was closed with edits waiting does not lose them
  // without a word, each client that has such edits leaves a mark in localStorage, which outlives the tab. A mark of a client
  // other than this tab's own means that the design as it is here may hold edits the server never had: it is kept as a recovery
  // copy, before anything of the server's is shown.
  const marks = `craftly:unsent:${designId}:${link.server}:${link.room}:`;
  let marked = outbox ? marks + outbox.client : null;
  const mark = (client: string | null) => {
    const next = client === null ? null : marks + client;
    if (next === null && marked === null) return;
    try {
      // (a mark that stays is written again each time: another tab that opened this design took it for a mark of a closed tab and
      // removed it, and this tab may still be closed with edits waiting)
      if (marked && marked !== next) localStorage.removeItem(marked);
      if (next) localStorage.setItem(next, "1");
    } catch {
      // without this storage a closed tab loses its unsent edits as it did before there were marks
    }
    marked = next;
  };
  const orphans = storedNames(marks).filter((name) => name !== marked);
  const opened = useEditor.getState().design;
  if (orphans.length && opened) {
    keepLocal(recoveryCopy(opened, uid("d")), m.editor.live.earlierVisit);
    for (const name of orphans) localStorage.removeItem(name);
  }

  // One recovery copy for all the edits that are refused while this tab has the design: a room that is full refuses every edit,
  // and a copy and a message for each would fill the library and the screen.
  const recoveryKey = `craftly:recovery:${designId}`;
  let recoveryId: string | null = null;
  let refusedBefore = false;
  const recoveryIdOnce = (): string => {
    if (recoveryId) return recoveryId;
    try {
      recoveryId = sessionStorage.getItem(recoveryKey) ?? uid("d");
      sessionStorage.setItem(recoveryKey, recoveryId);
    } catch {
      recoveryId ??= uid("d");
    }
    return recoveryId;
  };
  let mediaError = "";
  let reachedLive = false;
  // Seeing each other (presence.ts): from the welcome of a server that passes presence on until the connection is lost, this
  // browser says where its person is, and keeps the list of the others. A connection that comes back starts both anew, under the
  // number the server gives it then.
  let stopPresence: (() => void) | null = null;
  const presenceOff = () => {
    stopPresence?.();
    stopPresence = null;
    clearPresence();
  };
  const showMediaError = (message: string) => {
    if (closed || mediaError === message) return;
    mediaError = message;
    toast.error(message);
  };
  const live = new Live({
    url: websocketUrl(link),
    key: link.key,
    session: env.session,
    createSocket: env.createSocket,
    // this browser understands comments: a server that shares them says so in its welcome (docs/COLLABORATION.md, "Comments")
    features: [COMMENTS],
    outbox,
    onOutbox(outbox) {
      mark(outbox.queue.length ? outbox.client : null);
      try {
        if (outbox.queue.length) sessionStorage.setItem(key, JSON.stringify({ ...outbox, uploads: [...allowedUploads] }));
        else {
          sessionStorage.removeItem(key);
          allowedUploads.clear();
        }
        warned = false;
      } catch {
        if (warned || typeof sessionStorage === "undefined") return;
        warned = true;
        toast.error(m.editor.live.cannotKeepUnsent);
      }
    },
    prepareEdit: (design) => media.upload(design, allowedUploads),
    onSendError: showMediaError,
    onRejected(reason) {
      const design = useEditor.getState().design;
      if (!design) return;
      // the design still has the refused edit in it here: it is taken out right after (onChange)
      keepRefused(recoveryCopy(design, recoveryIdOnce()), m.editor.live.refused(reason), refusedBefore);
      refusedBefore = true;
    },
    onChange: () => {
      const shared = live.design;
      if (!shared) return;
      // Someone else may have deleted the text this person is typing in. The editing box then closes, and without a word the next
      // keys would land on the canvas as shortcuts with nothing to say why.
      const typingIn = useEditor.getState().editingTextId;
      const before = useEditor.getState().design;
      actions().applyShared(shared);
      if (typingIn && !useEditor.getState().editingTextId) toast.info(m.editor.live.textDeleted);
      // a comment or reply of somebody else is said to a screen reader, once (src/editor/comments/commentsStore.ts)
      if (live.sharesComments) announceArrivals(before, useEditor.getState().design);
      if (collectAssetIds(shared, { clips: false }).length)
        void media.download(shared).catch((error: unknown) => showMediaError(error instanceof Error ? error.message : m.editor.live.imagesFailed));
      // the clips and sounds come after, in the background: a big one takes a while, and the design does not wait for it
      media.fetchClips(shared);
    },
    onStatus: (status, reason) => {
      if (status === "live") reachedLive = true;
      // whoever may edit sends the clips and sounds the room has not got yet (a design shared just now, or after a time offline)
      if (status === "live" && live.session.role === "edit" && live.design) media.sendClips(live.design);
      if (status === "live" && live.session.role === "view" && !looking) {
        looking = true;
        actions().setMode("view");
      }
      // A room that is gone for somebody who was in it by a link (not with a session: a team's room, which is asked for again; not
      // its owner, who closed it) is one whose owner stopped sharing it. They are told so in plain words, once.
      const stopped = status === "denied" && reason === "not-found" && reachedLive && !env.session && !link.ownerKey;
      useLiveStatus.setState({ status, reason, role: live.session.role, stopped });
      if (stopped && !closed) toast.info(m.editor.live.ownerStopped, { duration: 0 });
      if (status === "denied") env.onDenied?.(reason);
      // what the welcome said of comments; while the connection is away it stays what it was
      if (status === "live") useComments.setState({ sharing: live.sharesComments ? "shared" : "unsupported" });
      presenceOff();
      const me = live.peer;
      if (me !== null) stopPresence = startPresence((state) => live.present(state), me, live.fixedName);
    },
    onPresence: (heard) => {
      heardPresence(heard);
      // One person at a time types in a text box. The server passes on that somebody types in a box only for the first who said
      // so (src/collab/room.ts), so hearing it of the box this person is typing in means that the other was first: both opened it
      // in the same moment, before either had heard of the other. This one gives way. What was typed here until now has been
      // sent, edit by edit, and stays in the text until the other types on.
      if ("gone" in heard || heard.editing === null || heard.editing !== useEditor.getState().editingTextId) return;
      actions().endTextEdit();
      toast.info(m.editor.live.typedFirst(shownName(heard.name, heard.peer)));
    },
  });
  useLiveStatus.setState({ status: "connecting", reason: null, role: null, stopped: false });
  actions().startLive({
    change(before, after) {
      const known = new Set(collectAssetIds(before, { clips: false }));
      for (const id of collectAssetIds(after, { clips: false })) if (!known.has(id)) allowedUploads.add(id);
      live.edit(before, after);
      // a clip or a sound added here goes to the room beside the edit, not before it
      media.sendClips(after);
    },
    // a text box that somebody else is typing in is not opened here (the store asks before it opens one), and the person is told who has it
    textHolder: (id) => typingIn(id)?.name ?? null,
    textRefused: (_id, holder) => void toast.info(m.editor.live.textTaken(holder)),
    sharesComments: () => live.sharesComments,
  });
  live.start();
  return () => {
    closed = true;
    try {
      env.onStop?.({ reachedLive, unsent: live.session.pending, room: live.session.server });
    } catch {
      // what the caller does with it does not keep the connection open
    }
    presenceOff();
    media.stop();
    live.stop();
    actions().stopLive();
    if (looking) actions().setMode("edit");
    useLiveStatus.setState(OFF);
    useComments.setState({ sharing: "local" });
  };
}

/**
 * The server lets only people with its key for making rooms start to share (`ROOM_CREATE_KEY`, docs/COLLABORATION.md), and none
 * was sent ("needed") or the one that was sent is not the one ("wrong"). The Share panel asks the person for the key when it
 * meets this, where any other refusal is only shown.
 */
export class CreateKeyError extends Error {
  constructor(readonly kind: "needed" | "wrong") {
    super(kind === "needed" ? m.editor.live.keyNeeded : m.editor.live.keyWrong);
    this.name = "CreateKeyError";
  }
}

const CREATE_KEY_CODES: Record<string, "needed" | "wrong"> = { "create-key-needed": "needed", "create-key-wrong": "wrong" };

/** Why the server did not do what it was asked: as an error with a sentence for the person, its own message when it sent one. */
async function problemWith(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    if (typeof body.code === "string" && Object.hasOwn(CREATE_KEY_CODES, body.code)) return new CreateKeyError(CREATE_KEY_CODES[body.code]);
    if (typeof body.error === "string") return new Error(body.error);
  } catch {
    /* not JSON */
  }
  return new Error(m.editor.live.serverAnswered(res.status));
}

/**
 * Makes a room of the design that is open on the server at `typedServer`, and keeps the link (the keys that edit and look) with the
 * design on this device. Rejects with a sentence for the person, and with a `CreateKeyError` when the server asks for its key for
 * making rooms: `createKey` is that key, sent in a header and kept nowhere, not in the link either.
 */
export async function shareDesign(typedServer: string, env: LiveEnv = {}, createKey = ""): Promise<LiveLink> {
  const server = normalizeServer(typedServer);
  if (!server) throw new Error(m.editor.live.notAServer);
  const design = useEditor.getState().design;
  if (!design) throw new Error(m.editor.live.noDesign);
  const { live: _own, ...content } = design;
  const key = createKey.trim();
  // A header carries printable ASCII and nothing else: a browser refuses to send any other, with an error that reads like a
  // server that cannot be reached. No key a server was given looks like that, so it is the wrong key.
  if (/[^\x21-\x7e]/.test(key)) throw new CreateKeyError("wrong");
  let res: Response;
  try {
    res = await (env.fetch ?? fetch)(apiUrl(server, "/api/rooms"), {
      method: "POST",
      body: JSON.stringify({ design: content }),
      ...(key ? { headers: { "x-craftly-create-key": key } } : {}),
    });
  } catch {
    throw new Error(m.editor.live.unreachable);
  }
  if (!res.ok) throw await problemWith(res);
  const made = (await res.json()) as { room: string; editKey: string; viewKey: string; ownerKey: string };
  const link: LiveLink = { server, room: made.room, key: made.editKey, viewKey: made.viewKey, ownerKey: made.ownerKey, role: "edit" };
  // a server this person shares on is one they chose: a link to it does not ask again (knownServers.ts)
  rememberServer(server);
  try {
    if (collectAssetIds(content, { clips: false }).length) await sharedMedia(link, env.fetch).upload(content);
  } catch (error) {
    await (env.fetch ?? fetch)(apiUrl(server, `/api/rooms/${encodeURIComponent(link.room)}`), {
      method: "DELETE",
      headers: { "x-craftly-key": made.ownerKey },
    }).catch(() => undefined);
    throw error;
  }
  useEditor.getState().actions.setLiveLink(link);
  return link;
}

/**
 * The open design is its own again: when its key may stop sharing, the room is closed for everybody (they are sent away); either
 * way the link is taken from the design, which stays on this device. Rejects, and leaves everything as it is, when the server cannot
 * be reached or refuses.
 */
export async function stopSharing(env: LiveEnv = {}): Promise<void> {
  const state = useEditor.getState();
  const link = state.design?.live;
  if (!link) return;
  // Only the owner credential closes the room. An invite holder leaves locally.
  if (link.role === "edit" && link.ownerKey) {
    let res: Response;
    try {
      res = await (env.fetch ?? fetch)(apiUrl(link.server, `/api/rooms/${encodeURIComponent(link.room)}`), { method: "DELETE", headers: { "x-craftly-key": link.ownerKey } });
    } catch {
      throw new Error(m.editor.live.unreachableStop);
    }
    if (!res.ok && res.status !== 404) throw await problemWith(res);
  }
  useEditor.getState().actions.setLiveLink(null);
}

/** Connects with a link that somebody gave, waits for the design, and hands it over with what the key allows. Rejects with a sentence. */
export function joinDesign(link: LiveLink, env: LiveEnv = {}): Promise<{ design: Design; role: Role }> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (then: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      live.stop();
      then();
    };
    const live: Live = new Live({
      url: websocketUrl(link),
      key: link.key,
      createSocket: env.createSocket,
      // the copy that is kept has the comments of a server that shares them, and none of one that does not
      features: [COMMENTS],
      onChange: () => {
        const design = live.design;
        const role = live.session.role;
        if (design && role) finish(() => resolve({ design, role }));
      },
      onStatus: (status, reason) => {
        if (status === "denied") finish(() => reject(new Error(deniedText(reason ?? "no-access"))));
      },
    });
    const timer = setTimeout(() => finish(() => reject(new Error(m.editor.live.unreachableLink))), env.timeoutMs ?? 15_000);
    live.start();
  });
}

/**
 * The editor's side of a shared design (docs/COLLABORATION.md): starting to share a design that is open, keeping it in step with the
 * server while it is open, stopping, and joining a design that somebody else shares. The store (src/core/store.ts) holds the design
 * and the history; this module owns the connection (src/collab/live.ts) and tells the store what arrives.
 */
import { Live, type LiveStatus, type SocketLike } from "@/collab/live";
import { checkOps, type DeniedReason, type Role } from "@/collab/protocol";
import type { Outbox } from "@/collab/session";
import { uid } from "@/core/ids";
import { saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design, LiveLink } from "@/core/types";
import { downloadBlob } from "@/export/download";
import { exportProjectFile, projectFileName } from "@/export/projectFile";
import { collectAssetIds, portableDesign } from "@/export/projectFormat";
import { toast } from "@/ui";
import { create } from "zustand";
import { apiUrl, normalizeServer, websocketUrl } from "./links";
import { sharedMedia } from "./media";

export interface LiveEnv {
  createSocket?: (url: string) => SocketLike;
  fetch?: typeof fetch;
  /** How long to wait for a server when joining, in milliseconds. */
  timeoutMs?: number;
}

export interface LiveStatusState {
  /** "off" while the open design is not connected to anybody */
  status: "off" | LiveStatus;
  reason: DeniedReason | null;
  /** what the key allows, known once the server has answered */
  role: Role | null;
}

/** What the top bar and the Share panel show about the connection of the open design. */
export const useLiveStatus = create<LiveStatusState>(() => ({ status: "off", reason: null, role: null }));

const OFF: LiveStatusState = { status: "off", reason: null, role: null };

const DENIED: Record<DeniedReason, string> = {
  "no-access": "This link is not allowed in: its key is wrong or has been withdrawn.",
  "not-found": "This shared design is no longer there.",
  "bad-request": "The server did not understand this link.",
  "server-full": "The server is full. Try again in a moment.",
  "too-large": "This design is too big for the server.",
  invalid: "The server sent something that Craftly does not accept, so the connection was closed. Only join designs from a server you trust.",
};

/** What a person is told when the connection ends for this reason. */
export const deniedText = (reason: DeniedReason): string => DENIED[reason];

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

export function connectLive(link: LiveLink, env: LiveEnv = {}): () => void {
  const actions = () => useEditor.getState().actions;
  let looking = link.role === "view";
  if (looking) actions().setMode("view");
  let closed = false;
  let warned = false;
  const key = `craftly:outbox:${useEditor.getState().design?.id}:${link.server}:${link.room}`;
  const media = sharedMedia(link, env.fetch);
  const outbox = readOutbox(key);
  const allowedUploads = new Set(outbox?.uploads);
  let mediaError = "";
  const showMediaError = (message: string) => {
    if (closed || mediaError === message) return;
    mediaError = message;
    toast.error(message);
  };
  const live = new Live({
    url: websocketUrl(link),
    key: link.key,
    createSocket: env.createSocket,
    outbox,
    onOutbox(outbox) {
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
        toast.error("Craftly could not keep unsent changes for a reload. Keep this tab open or download a project file.");
      }
    },
    prepareEdit: (design) => media.upload(design, allowedUploads),
    onSendError: showMediaError,
    onRejected(reason) {
      const design = useEditor.getState().design;
      if (!design) return;
      const now = Date.now();
      const copy: Design = { ...portableDesign(design), id: uid("d"), title: `${design.title} (unsent changes)`, createdAt: now, updatedAt: now, trashedAt: null };
      void saveDesign(copy).then(
        () => toast.error(`The server refused an edit: ${reason} A recovery copy is in Projects.`, { duration: 0 }),
        () =>
          toast.error(`The server refused an edit: ${reason} Download a recovery copy.`, {
            duration: 0,
            actionLabel: "Download copy",
            onAction: () =>
              void exportProjectFile(copy)
                .then((blob) => downloadBlob(blob, projectFileName(copy.title)))
                .catch(() => toast.error("Could not download the recovery copy.")),
          }),
      );
    },
    onChange: () => {
      const shared = live.design;
      if (!shared) return;
      // Someone else may have deleted the text this person is typing in. The editing box then closes, and without a word the next
      // keys would land on the canvas as shortcuts with nothing to say why.
      const typingIn = useEditor.getState().editingTextId;
      actions().applyShared(shared);
      if (typingIn && !useEditor.getState().editingTextId) toast.info("Someone else deleted the text you were editing.");
      if (collectAssetIds(shared).length)
        void media.download(shared).catch((error: unknown) => showMediaError(error instanceof Error ? error.message : "Could not load shared images."));
    },
    onStatus: (status, reason) => {
      if (status === "live" && live.session.role === "view" && !looking) {
        looking = true;
        actions().setMode("view");
      }
      useLiveStatus.setState({ status, reason, role: live.session.role });
    },
  });
  useLiveStatus.setState({ status: "connecting", reason: null, role: null });
  actions().startLive({
    change(before, after) {
      const known = new Set(collectAssetIds(before));
      for (const id of collectAssetIds(after)) if (!known.has(id)) allowedUploads.add(id);
      live.edit(before, after);
    },
  });
  live.start();
  return () => {
    closed = true;
    live.stop();
    actions().stopLive();
    if (looking) actions().setMode("edit");
    useLiveStatus.setState(OFF);
  };
}

/** What the server says is wrong, in words; its own message when it sent one. */
async function problemWith(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* not JSON */
  }
  return `The server answered ${res.status}.`;
}

/**
 * Makes a room of the design that is open on the server at `typedServer`, and keeps the link (the keys that edit and look) with the
 * design on this device. Rejects with a sentence for the person.
 */
export async function shareDesign(typedServer: string, env: LiveEnv = {}): Promise<LiveLink> {
  const server = normalizeServer(typedServer);
  if (!server) throw new Error("That is not the address of a server. It looks like https://live.example.com or http://localhost:8787.");
  const design = useEditor.getState().design;
  if (!design) throw new Error("There is no design open.");
  const { live: _own, ...content } = design;
  let res: Response;
  try {
    res = await (env.fetch ?? fetch)(apiUrl(server, "/api/rooms"), { method: "POST", body: JSON.stringify({ design: content }) });
  } catch {
    throw new Error("Couldn't reach the server. Check the address and that the server is running.");
  }
  if (!res.ok) throw new Error(await problemWith(res));
  const made = (await res.json()) as { room: string; editKey: string; viewKey: string; ownerKey: string };
  const link: LiveLink = { server, room: made.room, key: made.editKey, viewKey: made.viewKey, ownerKey: made.ownerKey, role: "edit" };
  try {
    if (collectAssetIds(content).length) await sharedMedia(link, env.fetch).upload(content);
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
      throw new Error("Couldn't reach the server, so sharing could not be stopped. The link is still on this design.");
    }
    if (!res.ok && res.status !== 404) throw new Error(await problemWith(res));
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
      onChange: () => {
        const design = live.design;
        const role = live.session.role;
        if (design && role) finish(() => resolve({ design, role }));
      },
      onStatus: (status, reason) => {
        if (status === "denied") finish(() => reject(new Error(DENIED[reason ?? "no-access"])));
      },
    });
    const timer = setTimeout(() => finish(() => reject(new Error("Couldn't reach the server. Check the link and that the server is running."))), env.timeoutMs ?? 15_000);
    live.start();
  });
}

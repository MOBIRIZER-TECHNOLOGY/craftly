/**
 * The editor's side of a shared design (docs/COLLABORATION.md): starting to share a design that is open, keeping it in step with the
 * server while it is open, stopping, and joining a design that somebody else shares. The store (src/core/store.ts) holds the design
 * and the history; this module owns the connection (src/collab/live.ts) and tells the store what arrives.
 */
import { Live, type LiveStatus, type SocketLike } from "@/collab/live";
import type { DeniedReason, Role } from "@/collab/protocol";
import { useEditor } from "@/core/store";
import type { Design, LiveLink } from "@/core/types";
import { create } from "zustand";
import { apiUrl, normalizeServer, websocketUrl } from "./links";

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
export function connectLive(link: LiveLink, env: LiveEnv = {}): () => void {
  const actions = () => useEditor.getState().actions;
  let looking = false;
  const live = new Live({
    url: websocketUrl(link),
    createSocket: env.createSocket,
    onChange: () => {
      const shared = live.design;
      if (shared) actions().applyShared(shared);
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
  actions().startLive({ change: (before, after) => live.edit(before, after) });
  live.start();
  return () => {
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
  const made = (await res.json()) as { room: string; editKey: string; viewKey: string };
  const link: LiveLink = { server, room: made.room, key: made.editKey, viewKey: made.viewKey, role: "edit" };
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
  // only the person who started sharing (they kept the key that looks) closes the room; somebody who was given a link just leaves it
  if (link.role === "edit" && link.viewKey) {
    let res: Response;
    try {
      res = await (env.fetch ?? fetch)(apiUrl(link.server, `/api/rooms/${encodeURIComponent(link.room)}`), { method: "DELETE", headers: { "x-craftly-key": link.key } });
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

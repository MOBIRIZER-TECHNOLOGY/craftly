/**
 * The addresses of a shared design (docs/COLLABORATION.md). A person types the address of the server; the editor makes of it the one
 * of the server's interface and the one of its socket. The link that is given to other people holds the server, the room, the key and
 * what the key allows in one piece after the `#`, which a browser never sends to a server, so the key does not end up in a log; it
 * comes from outside, so it is read back strictly.
 */
import type { LiveLink } from "@/core/types";

/** What a room is called by the server (src/server/storage.ts): long enough not to be guessed, safe in an address. */
const ROOM = /^[A-Za-z0-9_-]{16,64}$/;
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * The address of a server as the editor keeps it: http or https, no end slash. What a person types may lack the scheme (https is
 * assumed, http for a machine of this network and for localhost), or be a ws or wss address. Null when it is not a server's address.
 */
export function normalizeServer(typed: string): string | null {
  let text = typed.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]+:\d+(\/|$)/.test(text)) return null; // javascript:, data:, mailto: ...
    text = `${/^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(text) ? "http" : "https"}://${text}`;
  }
  text = text.replace(/^ws(s?):\/\//i, "http$1://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
}

/** An address of the server's interface. */
export const apiUrl = (server: string, path: string): string => `${server}${path}`;

/**
 * The address of the socket of a room. The key is not in it: an address is written in the logs of every server and proxy that it
 * passes, so the key is shown in the first message instead (`join`, src/collab/protocol.ts).
 */
export function websocketUrl(link: Pick<LiveLink, "server" | "room">): string {
  const base = link.server.replace(/^http/i, "ws");
  return `${base}/ws?room=${encodeURIComponent(link.room)}`;
}

const toBase64Url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (token: string) => atob(token.replace(/-/g, "+").replace(/_/g, "/"));

/** The part of the link that is given to other people after the #/join/. */
export function joinToken(link: Pick<LiveLink, "server" | "room" | "key" | "role">): string {
  return toBase64Url(JSON.stringify({ s: link.server, r: link.room, k: link.key, v: link.role === "edit" ? "e" : "v" }));
}

/** The link that is given to other people: the address of the editor with the token after the #. */
export function joinUrl(editorAddress: string, link: Pick<LiveLink, "server" | "room" | "key" | "role">): string {
  return `${editorAddress.replace(/#.*$/, "")}#/join/${joinToken(link)}`;
}

/** What a token holds, if it is what this app makes: a server, a room, a key and a role. */
export function parseJoinToken(token: string): LiveLink | null {
  let value: unknown;
  try {
    value = JSON.parse(fromBase64Url(token));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { s, r, k, v } = value as Record<string, unknown>;
  if (typeof s !== "string" || typeof r !== "string" || typeof k !== "string") return null;
  const server = normalizeServer(s);
  if (!server || !ROOM.test(r) || !KEY.test(k) || (v !== "e" && v !== "v")) return null;
  return { server, room: r, key: k, role: v === "e" ? "edit" : "view" };
}

/**
 * The link of an invite to a team (docs/ACCOUNTS.md, "An invite link"): `#/invite/<code>.<server>` of the page that made it, where
 * `<server>` is the account server's address in base64url, as a live link carries its server (src/editor/live/links.ts). All of it
 * is after the `#`, which a browser sends to no server (not in a request, not in a Referer), so the code reaches only the account
 * server it names, when the person joins. It comes from outside, so it is read back strictly: the code as the server makes them,
 * the server as `normalizeAccountServer` takes one, and nothing else. A link of before, `#/invite/<code>`, names no server.
 */
import { normalizeAccountServer } from "./api";
import { CODE } from "./validate";

const SERVER_PART = /^[A-Za-z0-9_-]{1,700}$/;

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (token: string) =>
  new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** The link that is given to the people invited: the address of this page with the code and the server after the #. */
export function inviteUrl(pageAddress: string, code: string, server: string): string {
  return `${pageAddress.replace(/#.*$/, "")}#/invite/${code}.${toBase64Url(server)}`;
}

/**
 * What the part of an invite link after `#/invite/` holds: the code and the server it names (null for a link that names none).
 * Null when it is not an invite this app makes, or names something that is not a server's address.
 */
export function parseInvite(part: string): { code: string; server: string | null } | null {
  const dot = part.indexOf(".");
  const code = dot < 0 ? part : part.slice(0, dot);
  if (!CODE.test(code)) return null;
  if (dot < 0) return { code, server: null };
  const rest = part.slice(dot + 1);
  if (!SERVER_PART.test(rest)) return null;
  let typed: string;
  try {
    typed = fromBase64Url(rest);
  } catch {
    return null;
  }
  const server = normalizeAccountServer(typed);
  return server ? { code, server } : null;
}

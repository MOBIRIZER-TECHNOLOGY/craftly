/**
 * Talking to an account server (docs/ACCOUNTS.md, "Endpoints"): every request carries the session as a bearer token in a header,
 * never in an address and never by the browser on its own; every answer is read strictly (validate.ts); every refusal becomes a
 * `CloudError` with the server's code, which the screens turn into words (`cloudErrorText`). A server that cannot be reached is
 * the code `offline`, an answer that cannot be used `bad-answer`.
 */
import { m } from "@/i18n";
import {
  BadAnswer,
  readChanges,
  readInvite,
  readLive,
  readMe,
  readMissing,
  readNewInvite,
  readRemoteAsset,
  readRemoteDesign,
  readRev,
  readSessions,
  readSignedIn,
  readTeam,
  readTeamPage,
  isObject,
  type Role,
} from "./validate";
import type { Design } from "@/core/types";

/** Where requests go, and as whom. */
export interface Conn {
  server: string;
  token: string | null;
  /** for the tests: another fetch */
  fetch?: typeof fetch;
}

export class CloudError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CloudError";
  }
}

/** The words for a refusal of the server, by its code; the server's own sentence is never shown (it is English, and it is the server's). */
export function cloudErrorText(error: unknown): string {
  const words = m.cloud.errors as Record<string, string>;
  if (error instanceof CloudError) return Object.hasOwn(words, error.code) ? words[error.code] : words.unknown;
  if (error instanceof BadAnswer) return words["bad-answer"];
  return words.unknown;
}

/** The address of the server as it is kept: http or https, no end slash. Null when it is not one. */
export function normalizeAccountServer(typed: string): string | null {
  let value = typed.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null;
    value = `${/^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(value) ? "http" : "https"}://${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password || url.search || url.hash) return null;
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
}

/** The host of a server, as a person is shown it plainly ("accounts.example.org"). */
export const hostOf = (server: string): string => {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
};

const LIMIT = 20 * 1024 * 1024;

/** The response's text, read until the limit rather than after the whole answer has arrived. */
async function responseText(res: Response): Promise<string> {
  if (!res.body) {
    const raw = await res.text();
    if (raw.length > LIMIT) throw new BadAnswer("an answer that is too long");
    return raw;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) {
        await reader.cancel();
        throw new BadAnswer("an answer that is too long");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** One request: JSON in and out. Throws `CloudError` for a refusal or no answer, `BadAnswer` for an answer that is no JSON object. */
export async function request(conn: Conn, method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (conn.token) headers.authorization = `Bearer ${conn.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  const settle = <T>(work: Promise<T>) => Promise.race([work, late]);
  try {
    const res = await settle(
      (conn.fetch ?? fetch)(`${conn.server}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // nothing of an account goes into a cache, and no cookie goes with it
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      }),
    );
    const raw = await settle(responseText(res));
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const code = isObject(parsed) && typeof parsed.code === "string" && /^[a-z-]{1,40}$/.test(parsed.code) ? parsed.code : res.status >= 500 ? "server" : "unknown";
      const extra: Record<string, unknown> = {};
      if (isObject(parsed) && typeof parsed.rev === "number") extra.rev = parsed.rev;
      if (isObject(parsed) && typeof parsed.room === "string") extra.room = parsed.room;
      throw new CloudError(code, res.status, `the server answered ${res.status} ${code}`, extra);
    }
    if (!isObject(parsed)) throw new BadAnswer("an answer that is not JSON");
    return parsed;
  } catch (error) {
    if (error instanceof CloudError || error instanceof BadAnswer) throw error;
    throw new CloudError("offline", 0, "the server could not be reached");
  } finally {
    clearTimeout(timer);
  }
}

const at = (...parts: string[]) => parts.map(encodeURIComponent).join("/");

/* ---------------- people ---------------- */

export const signUp = async (conn: Conn, body: { email: string; password: string; name: string; code?: string }) =>
  readSignedIn(await request(conn, "POST", "/api/auth/signup", body));
export const signIn = async (conn: Conn, body: { email: string; password: string; device: string }) => readSignedIn(await request(conn, "POST", "/api/auth/signin", body));
export const signOut = (conn: Conn) => request(conn, "POST", "/api/auth/signout", undefined, 8000);
export const getMe = async (conn: Conn) => readMe(await request(conn, "GET", "/api/me"));
export const getSessions = async (conn: Conn) => readSessions(await request(conn, "GET", "/api/me/sessions"));
export const endSession = (conn: Conn, id: string) => request(conn, "DELETE", `/api/me/sessions/${at(id)}`);
export const changePassword = (conn: Conn, old: string, next: string) => request(conn, "POST", "/api/me/password", { old, new: next });
export async function resetPassword(conn: Conn, body: { code: string; newPassword: string } | { email: string; recoveryCode: string; newPassword: string }) {
  const answer = await request(conn, "POST", "/api/auth/reset", body);
  return { recoveryCode: typeof answer.recoveryCode === "string" ? answer.recoveryCode : undefined };
}

/* ---------------- teams ---------------- */

export const createTeam = async (conn: Conn, name: string) => readTeam((await request(conn, "POST", "/api/teams", { name })).team);
export const getTeam = async (conn: Conn, team: string) => readTeamPage(await request(conn, "GET", `/api/teams/${at(team)}`));
export const renameTeam = (conn: Conn, team: string, name: string) => request(conn, "PATCH", `/api/teams/${at(team)}`, { name });
export const deleteTeam = (conn: Conn, team: string) => request(conn, "DELETE", `/api/teams/${at(team)}`);
export const setRole = (conn: Conn, team: string, member: string, role: Role) => request(conn, "PUT", `/api/teams/${at(team, "members", member)}`, { role });
export const removeMember = (conn: Conn, team: string, member: string) => request(conn, "DELETE", `/api/teams/${at(team, "members", member)}`);
export const createInvite = async (conn: Conn, team: string, body: { role: Role; uses: number; hours: number }) =>
  readNewInvite(await request(conn, "POST", `/api/teams/${at(team, "invites")}`, body));
export async function listInvites(conn: Conn, team: string) {
  const answer = await request(conn, "GET", `/api/teams/${at(team, "invites")}`);
  if (!Array.isArray(answer.invites)) throw new BadAnswer("invites");
  return answer.invites.map(readInvite);
}
export const revokeInvite = (conn: Conn, team: string, invite: string) => request(conn, "DELETE", `/api/teams/${at(team, "invites", invite)}`);
export const redeemInvite = async (conn: Conn, code: string) => readTeam((await request(conn, "POST", "/api/invites/redeem", { code })).team);

/* ---------------- spaces ---------------- */

export const getChanges = async (conn: Conn, space: string, since: number) =>
  readChanges(await request(conn, "GET", `/api/spaces/${at(space)}/changes?since=${since}&limit=500`), since);
export const getDesign = async (conn: Conn, space: string, id: string) => readRemoteDesign(await request(conn, "GET", `/api/spaces/${at(space, "designs", id)}`), id);
export const putDesign = async (conn: Conn, space: string, design: Design, baseRev: number | null, thumbnail?: string) =>
  readRev(await request(conn, "PUT", `/api/spaces/${at(space, "designs", design.id)}`, { baseRev, design, ...(thumbnail ? { thumbnail } : {}) }, 120_000));
export const patchMeta = (conn: Conn, space: string, id: string, patch: Record<string, unknown>) =>
  request(conn, "PATCH", `/api/spaces/${at(space, "designs", id, "meta")}`, patch);
export const deleteDesign = (conn: Conn, space: string, id: string) => request(conn, "DELETE", `/api/spaces/${at(space, "designs", id)}`);
export const putFolder = (conn: Conn, space: string, id: string, name: string, parentId: string | null) =>
  request(conn, "PUT", `/api/spaces/${at(space, "folders", id)}`, { name, parentId });
export const deleteFolder = (conn: Conn, space: string, id: string) => request(conn, "DELETE", `/api/spaces/${at(space, "folders", id)}`);
export const missingAssets = async (conn: Conn, space: string, ids: string[]) =>
  readMissing(await request(conn, "POST", `/api/spaces/${at(space, "assets", "missing")}`, { ids }), ids);
export const putAsset = (conn: Conn, space: string, id: string, mime: string, base64: string) =>
  request(conn, "PUT", `/api/spaces/${at(space, "assets", id)}`, { mime, base64 }, 120_000);
export const getAsset = async (conn: Conn, space: string, id: string) => readRemoteAsset(await request(conn, "GET", `/api/spaces/${at(space, "assets", id)}`, undefined, 120_000));
export const openLive = async (conn: Conn, space: string, id: string) => readLive(await request(conn, "POST", `/api/spaces/${at(space, "designs", id, "live")}`, {}));

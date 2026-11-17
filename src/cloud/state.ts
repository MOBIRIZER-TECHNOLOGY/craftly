/**
 * Whether a person is signed in to an account server on this device, and which space the dashboard shows (docs/ACCOUNTS.md). The
 * only part of the account code that every page loads: it reads one record (`meta` key `cloudSession`) when the app starts, and
 * while nobody is signed in it does nothing else. No request goes out and no other account code is loaded until somebody signs in.
 *
 * The session is kept in the IndexedDB `meta` store, never in an address or a cookie; a backup leaves it out.
 */
import { create } from "zustand";
import { setNewRecordSpace } from "@/core/library";
import { metaGet, metaSet } from "@/core/persistence";
import type { DesignSummary, Folder } from "@/core/types";

export type Role = "owner" | "editor" | "viewer";
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}
export interface SessionTeam {
  id: string;
  name: string;
  role: Role;
}

/** What is kept under `cloudSession`. */
export interface CloudSession {
  server: string;
  token: string;
  user: SessionUser;
  /** the name this device gave itself when it signed in ("Chrome on Windows") */
  device: string;
  /** the teams, as the server last said; the dashboard lists them while offline */
  teams: SessionTeam[];
  /** the space the dashboard shows: the person's own (their id) or a team's */
  activeSpace: string;
}

export interface CloudState {
  loaded: boolean;
  session: CloudSession | null;
}

export const SESSION_KEY = "cloudSession";
export const CURSORS_KEY = "cloudCursors";
export const FOLDERS_KEY = "cloudFolders";

export const useCloud = create<CloudState>(() => ({ loaded: false, session: null }));

/** The server this build was made for (`VITE_CRAFTLY_ACCOUNT_SERVER`), or "" when a person types one in. */
export const CONFIGURED_SERVER: string = (import.meta.env.VITE_CRAFTLY_ACCOUNT_SERVER ?? "").trim().replace(/\/+$/, "");

const SERVER_ID = /^[A-Za-z0-9_-]{16,64}$/;
const ROLES: readonly string[] = ["owner", "editor", "viewer"];

/** The record as it is read back: anything that is not one is no session (the person signs in again). */
export function readSession(value: unknown): CloudSession | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const user = v.user as Record<string, unknown> | undefined;
  if (typeof v.server !== "string" || !/^https?:\/\//.test(v.server) || typeof v.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(v.token)) return null;
  if (!user || typeof user.id !== "string" || !SERVER_ID.test(user.id) || typeof user.email !== "string" || typeof user.name !== "string") return null;
  const teams = (Array.isArray(v.teams) ? v.teams : []).filter(
    (t): t is SessionTeam => !!t && typeof t.id === "string" && SERVER_ID.test(t.id) && typeof t.name === "string" && ROLES.includes(t.role),
  );
  const active = typeof v.activeSpace === "string" && (v.activeSpace === user.id || teams.some((t) => t.id === v.activeSpace)) ? v.activeSpace : user.id;
  return {
    server: v.server,
    token: v.token,
    user: { id: user.id, email: user.email, name: user.name },
    device: typeof v.device === "string" ? v.device : "",
    teams: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })),
    activeSpace: active,
  };
}

/** The account as the screens show it: the server, the person, their teams and the space the dashboard shows; nulls while nobody is signed in. */
export function useAccount() {
  const session = useCloud((s) => s.session);
  return {
    server: session?.server ?? null,
    user: session?.user ?? null,
    teams: session?.teams ?? [],
    activeSpace: session?.activeSpace ?? null,
    session,
  };
}

/** The role of the signed-in person in a space; null when they are not in it (or nobody is signed in). */
export function roleIn(space: string | undefined, session = useCloud.getState().session): Role | null {
  if (!session || !space) return null;
  if (space === session.user.id) return "owner";
  return session.teams.find((team) => team.id === space)?.role ?? null;
}

/** Where what is made now goes: the space the dashboard shows, when the person may make designs there; else their own. */
function spaceForNew(session: CloudSession | null): string | null {
  if (!session) return null;
  const role = roleIn(session.activeSpace, session);
  return role === "owner" || role === "editor" ? session.activeSpace : session.user.id;
}

/** Makes `session` the state of this tab (and what is made from now on goes into its space). */
export function applySession(session: CloudSession | null): void {
  setNewRecordSpace(spaceForNew(session));
  useCloud.setState({ loaded: true, session });
}

/** Keeps the session and makes it the state of this tab. */
export async function saveSession(session: CloudSession | null): Promise<void> {
  if (session) await metaSet(SESSION_KEY, session);
  else await metaSet(SESSION_KEY, null);
  applySession(session);
}

/** Changes the session as it is kept, and the state; nothing when nobody is signed in. */
export async function updateSession(change: (session: CloudSession) => CloudSession): Promise<void> {
  // as kept (another tab may have changed it), else as this tab has it
  const current = readSession(await metaGet<unknown>(SESSION_KEY, null)) ?? useCloud.getState().session;
  if (!current) return;
  await saveSession(change(current));
}

export const setActiveSpace = (space: string) => updateSession((session) => ({ ...session, activeSpace: roleIn(space, session) ? space : session.user.id }));

/**
 * Whether the dashboard lists a design or a folder: everything while nobody is signed in; in the person's own space, what is in it
 * and what is on this device only; in a team's space, what is in that space.
 */
export function inActiveSpace(record: Pick<DesignSummary | Folder, "space">, session = useCloud.getState().session): boolean {
  if (!session) return true;
  if (session.activeSpace === session.user.id) return !record.space || record.space === session.user.id;
  return record.space === session.activeSpace;
}

let started: Promise<void> | null = null;

/**
 * Reads the session when the app starts. With one, the sync engine is loaded and started (src/cloud/sync.ts); without one,
 * nothing more happens. Safe to call more than once.
 */
export function startCloud(): Promise<void> {
  started ??= (async () => {
    let session: CloudSession | null;
    try {
      session = readSession(await metaGet<unknown>(SESSION_KEY, null));
    } catch {
      session = null;
    }
    applySession(session);
    if (session) await import("./sync").then((sync) => sync.startSync());
  })();
  return started;
}

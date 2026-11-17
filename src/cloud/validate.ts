/**
 * What an account server answers, read strictly (docs/ACCOUNTS.md, "Security"): a server with bad intent sees every design, but
 * what it sends is checked here as a hostile room's is before any of it is stored or shown. A design passes `checkDesign` (the
 * walk that refuses scripts, addresses that are not safe and pictures from the web), is brought to this release's format by
 * `migrateDesign` (one from a newer release is refused), and carries no `live` link; ids are what this app makes (`isSafeId`),
 * spaces what the server makes, a thumbnail a JPEG or PNG data address. Every reader throws `BadAnswer` for anything else.
 */
import { checkDesign } from "@/collab/protocol";
import { MigrationError } from "@/core/schema/migrator";
import { migrateDesign } from "@/core/schema/design";
import type { Design, SyncedMeta } from "@/core/types";
import { isSafeId } from "@/export/backupFormat";

export { checkDesign, isSafeId, migrateDesign };

/** An answer that is not what the server should have said: nothing of it is used. */
export class BadAnswer extends Error {
  constructor(what: string) {
    super(`the account server sent something this app cannot use: ${what}`);
    this.name = "BadAnswer";
  }
}

/** A design from a newer Craftly than this one: kept on the server, not stored here (it would be damaged by this release). */
export class NewerDesign extends Error {
  constructor() {
    super("newer");
    this.name = "NewerDesign";
  }
}

/** The ids of people, teams and spaces that the server makes (src/server/accounts/storage.ts). */
export const SERVER_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** A session token: 32 random bytes in base64url. */
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** A code shown once: an invite, a reset or a recovery code, 128 bits in base64url. */
export const CODE = /^[A-Za-z0-9_-]{22}$/;
/** The id of an upload (src/server/http.ts `ASSET_ID`). */
export const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The id of an invite of a team. */
const INVITE_ID = /^[A-Za-z0-9_-]{12}$/;
export const THUMBNAIL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]*={0,2}$/;
export const MAX_THUMBNAIL = 256 * 1024;
const MAX_TITLE = 200;
const MAX_NAME = 200;
/** An upload's base64 is at most this long (the server takes 9 MiB of bytes). */
const MAX_UPLOAD_BASE64 = 12 * 1024 * 1024;
const PICTURE = /^image\/(png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;
export type Role = "owner" | "editor" | "viewer";
const ROLES: readonly Role[] = ["owner", "editor", "viewer"];

type Obj = Record<string, unknown>;

export const isObject = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const obj = (value: unknown, what: string): Obj => {
  if (!isObject(value)) throw new BadAnswer(`${what} is not an object`);
  return value;
};
const text = (value: unknown, what: string, max = MAX_NAME, min = 0): string => {
  if (typeof value !== "string" || [...value].length > max || [...value].length < min || /\p{Cc}/u.test(value)) throw new BadAnswer(`${what} is not text`);
  return value;
};
/** A design's title: a person's own words, which the server keeps as they were sent (cut at 200). */
const title = (value: unknown): string => {
  if (typeof value !== "string" || value.length > MAX_TITLE * 2) throw new BadAnswer("a title is not text");
  return value;
};
const whole = (value: unknown, what: string, min = 0): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) throw new BadAnswer(`${what} is not a whole number`);
  return value;
};
const time = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new BadAnswer(`${what} is not a time`);
  return value;
};
const timeOrNull = (value: unknown, what: string): number | null => (value === null || value === undefined ? null : time(value, what));
const matching = (value: unknown, pattern: RegExp, what: string): string => {
  if (typeof value !== "string" || !pattern.test(value)) throw new BadAnswer(`${what} is not an id`);
  return value;
};
const safeId = (value: unknown, what: string): string => {
  if (!isSafeId(value)) throw new BadAnswer(`${what} is not an id`);
  return value;
};
const safeIdOrNull = (value: unknown, what: string): string | null => (value === null || value === undefined ? null : safeId(value, what));
const list = (value: unknown, what: string, max = 10_000): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new BadAnswer(`${what} is not a list`);
  return value;
};
const role = (value: unknown): Role => {
  if (!ROLES.includes(value as Role)) throw new BadAnswer("a role is not one this app knows");
  return value as Role;
};

/* ---------------- people, teams, sessions ---------------- */

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}
export interface CloudTeam {
  id: string;
  name: string;
  role: Role;
}

export function readUser(value: unknown): CloudUser {
  const v = obj(value, "a person");
  return { id: matching(v.id, SERVER_ID, "a person's id"), email: text(v.email, "an email", 254, 3), name: text(v.name, "a name", 80) };
}

export function readTeam(value: unknown): CloudTeam {
  const v = obj(value, "a team");
  return { id: matching(v.id, SERVER_ID, "a team's id"), name: text(v.name, "a team's name", 80, 1), role: role(v.role) };
}

/** `POST /api/auth/signup` and `…/signin`. */
export function readSignedIn(value: unknown): { token: string; user: CloudUser; recoveryCode?: string; team?: CloudTeam } {
  const v = obj(value, "the answer");
  const out: { token: string; user: CloudUser; recoveryCode?: string; team?: CloudTeam } = { token: matching(v.token, TOKEN, "a session"), user: readUser(v.user) };
  if (v.recoveryCode !== undefined) out.recoveryCode = matching(v.recoveryCode, CODE, "a recovery code");
  if (v.team !== undefined) out.team = readTeam(v.team);
  return out;
}

/** `GET /api/me`. */
export function readMe(value: unknown): { user: CloudUser; teams: CloudTeam[] } {
  const v = obj(value, "the answer");
  return { user: readUser(v.user), teams: list(v.teams, "teams", 100).map(readTeam) };
}

export interface CloudMember {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface CloudInvite {
  id: string;
  role: Role;
  usesLeft: number;
  expiresAt: number;
  createdAt: number;
}

/** `GET /api/teams/:t`. */
export function readTeamPage(value: unknown): { team: CloudTeam; members: CloudMember[] } {
  const v = obj(value, "the answer");
  const members = list(v.members, "members", 1000).map((item) => {
    const m = obj(item, "a member");
    return { id: matching(m.id, SERVER_ID, "a member's id"), name: text(m.name, "a name", 80), email: text(m.email, "an email", 254), role: role(m.role) };
  });
  return { team: readTeam(v.team), members };
}

export function readInvite(value: unknown): CloudInvite {
  const v = obj(value, "an invite");
  return {
    id: matching(v.id, INVITE_ID, "an invite's id"),
    role: role(v.role),
    usesLeft: whole(v.usesLeft, "uses"),
    expiresAt: time(v.expiresAt, "a time"),
    createdAt: time(v.createdAt, "a time"),
  };
}

export function readSessions(value: unknown): Array<{ id: string; device: string; lastUsedAt: number; current: boolean }> {
  const v = obj(value, "the answer");
  return list(v.sessions, "sessions", 100).map((item) => {
    const s = obj(item, "a session");
    return { id: matching(s.id, SERVER_ID, "a session's id"), device: text(s.device, "a device", 80), lastUsedAt: time(s.lastUsedAt, "a time"), current: s.current === true };
  });
}

/* ---------------- spaces ---------------- */

/** A design in the changes feed: its revision and details, not its content. */
export interface RemoteDesign extends SyncedMeta {
  id: string;
  rev: number;
  seq: number;
  updatedAt: number;
  deletedAt: number | null;
}
export interface RemoteFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  seq: number;
  deletedAt: number | null;
}
export interface Changes {
  cursor: number;
  more: boolean;
  designs: RemoteDesign[];
  folders: RemoteFolder[];
  assets: Array<{ id: string; mime: string }>;
}

/** `GET /api/spaces/:s/changes`: the cursor never goes back from `since`. */
export function readChanges(value: unknown, since: number): Changes {
  const v = obj(value, "the changes");
  const cursor = whole(v.cursor, "the cursor");
  if (cursor < since) throw new BadAnswer("the cursor went back");
  if (typeof v.more !== "boolean") throw new BadAnswer("more is not true or false");
  const designs = list(v.designs, "designs", 500).map((item): RemoteDesign => {
    const d = obj(item, "a design");
    if (typeof d.starred !== "boolean") throw new BadAnswer("starred is not true or false");
    return {
      id: safeId(d.id, "a design's id"),
      rev: whole(d.rev, "a revision", 1),
      seq: whole(d.seq, "a seq", 1),
      title: title(d.title),
      folderId: safeIdOrNull(d.folderId, "a folder"),
      starred: d.starred,
      trashedAt: timeOrNull(d.trashedAt, "a time"),
      updatedAt: time(d.updatedAt, "a time"),
      deletedAt: timeOrNull(d.deletedAt, "a time"),
    };
  });
  const folders = list(v.folders, "folders", 500).map((item): RemoteFolder => {
    const f = obj(item, "a folder");
    return {
      id: safeId(f.id, "a folder's id"),
      name: text(f.name, "a folder's name", MAX_TITLE, 1),
      parentId: safeIdOrNull(f.parentId, "a folder"),
      createdAt: time(f.createdAt, "a time"),
      seq: whole(f.seq, "a seq", 1),
      deletedAt: timeOrNull(f.deletedAt, "a time"),
    };
  });
  const assets = list(v.assets, "uploads", 500).map((item) => {
    const a = obj(item, "an upload");
    const mime = text(a.mime, "a type", 40);
    if (!PICTURE.test(mime)) throw new BadAnswer("an upload is not a picture");
    return { id: matching(a.id, ASSET_ID, "an upload's id"), mime };
  });
  return { cursor, more: v.more, designs, folders, assets };
}

/**
 * `GET /api/spaces/:s/designs/:id`: the design, checked as a hostile room's is and brought to this release's format, its
 * revision and its thumbnail (dropped when it is not a JPEG or PNG data address). `NewerDesign` for one a newer Craftly made.
 */
export function readRemoteDesign(value: unknown, id: string): { design: Design; rev: number; thumbnail: string | undefined } {
  const v = obj(value, "the answer");
  const rev = whole(v.rev, "a revision", 1);
  const given = obj(v.design, "a design");
  if (given.id !== id) throw new BadAnswer("the design is not the one that was asked for");
  // a link to a room is this device's own, never a server's: one that came with a design is refused with it
  if ("live" in given) throw new BadAnswer("a design came with a live link");
  const problem = checkDesign(given);
  if (problem) throw new BadAnswer(problem);
  let design: Design;
  try {
    design = migrateDesign(given).design;
  } catch (error) {
    if (error instanceof MigrationError && error.code === "newer") throw new NewerDesign();
    throw new BadAnswer("a design that cannot be read");
  }
  if (typeof design.createdAt !== "number" || typeof design.updatedAt !== "number" || !Array.isArray(design.pages)) throw new BadAnswer("a design without its dates or pages");
  const thumbnail = typeof v.thumbnail === "string" && v.thumbnail.length <= MAX_THUMBNAIL && THUMBNAIL.test(v.thumbnail) ? v.thumbnail : undefined;
  return { design, rev, thumbnail };
}

/** `PUT …/designs/:id` and `POST …/restore`. */
export const readRev = (value: unknown): number => whole(obj(value, "the answer").rev, "a revision", 1);

/** `GET …/assets/:id`: a picture's type and its bytes as base64, still to be checked as an upload is (`checkUpload`). */
export function readRemoteAsset(value: unknown): { mime: string; base64: string } {
  const v = obj(value, "an upload");
  const mime = text(v.mime, "a type", 40);
  if (!PICTURE.test(mime)) throw new BadAnswer("an upload is not a picture");
  if (typeof v.base64 !== "string" || v.base64.length > MAX_UPLOAD_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64)) throw new BadAnswer("an upload's bytes");
  return { mime, base64: v.base64 };
}

/** `POST …/assets/missing`: only ids that were asked about. */
export function readMissing(value: unknown, asked: readonly string[]): string[] {
  const missing = list(obj(value, "the answer").missing, "missing", 1000);
  const known = new Set(asked);
  return missing.filter((id): id is string => typeof id === "string" && known.has(id));
}

/** `POST /api/spaces/:s/designs/:id/live`: the room, the socket's path on that server, and what the session may do there. */
export function readLive(value: unknown): { room: string; ws: string; role: "edit" | "view" } {
  const v = obj(value, "the answer");
  const room = matching(v.room, /^[A-Za-z0-9_-]{16,64}$/, "a room");
  if (v.ws !== `/ws?room=${room}`) throw new BadAnswer("the address of the room");
  if (v.role !== "edit" && v.role !== "view") throw new BadAnswer("a role in the room");
  return { room, ws: v.ws, role: v.role };
}

/** `POST /api/teams/:t/invites`: the invite with its code, shown once. */
export function readNewInvite(value: unknown): CloudInvite & { code: string } {
  const v = obj(value, "the answer");
  return { ...readInvite(v), code: matching(v.code, CODE, "an invite code") };
}

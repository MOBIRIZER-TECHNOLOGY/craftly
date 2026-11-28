/**
 * What every account route shares: the settings with their defaults, refusals as values that carry their status and code, the
 * strict reading of a body, the session behind a request, the limits per address, and a queue per record so that two requests
 * never read, change and write the same file at once. The routes themselves are in `auth.ts`, `spaces.ts`, `teams.ts` and
 * `admin.ts`; `index.ts` puts them together.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cleanName } from "@/collab/presence";
import { clientAddress, hourlyLimit, knownAddresses, type HourlyLimit } from "../address";
import { readBody, sha256Hex } from "../http";
import { createStaging, type Staging } from "../staging";
import { createHasher, DEFAULT_COST, HASH_CONCURRENCY, type Cost, type Hasher } from "./passwords";
import { SERVER_ID, type AccountStorage, type SessionRecord, type TeamRecord, type UserRecord } from "./storage";
import type { TeamRole } from "./roles";

export type SignupMode = "invite" | "open" | "closed";
export const SIGNUP_MODES: readonly SignupMode[] = ["invite", "open", "closed"];

export interface AccountsOptions {
  storage: AccountStorage;
  /** Who may make an account: with a code (`invite`, the default), anybody (`open`), nobody (`closed`). */
  signup?: SignupMode;
  /** The most accounts the server keeps; none: no limit. */
  maxAccounts?: number;
  /** The most one space may hold, in bytes: designs with their kept revisions, and uploads (as base64). 1 GiB unless set. */
  spaceQuotaBytes?: number;
  /** The largest clip or sound a space keeps, in bytes (100 MiB unless set); it counts towards `spaceQuotaBytes` too. */
  maxMediaBytes?: number;
  maxDesignsPerSpace?: number;
  maxFolders?: number;
  maxTeamsPerPerson?: number;
  maxMembersPerTeam?: number;
  maxOpenInvites?: number;
  /** The cost of new password hashes; the default is N = 2^15, r = 8, p = 1. Tests give a low one. */
  passwordCost?: Cost;
  hashConcurrency?: number;
  /** Per hour; 0 for no limit. */
  limits?: Partial<Limits>;
  /** The time, in milliseconds; a test gives its own. The server's own clock unless set. */
  now?: () => number;
}

export interface Limits {
  /** failed sign-ins from one address */
  signinPerAddress: number;
  /** failed sign-ins for one account from one address */
  signinPerAccountAddress: number;
  /**
   * failed sign-ins for one account from everywhere: so high that one address cannot lock a person out, and it does not hold back
   * an address the person used lately (`known` in createContext), so that many addresses cannot either
   */
  signinPerAccount: number;
  /** sign-ups from one address, every attempt */
  signupPerAddress: number;
  /** wrong invite, sign-up and reset codes and recovery codes from one address */
  codesPerAddress: number;
}

export const DEFAULT_LIMITS: Limits = { signinPerAddress: 20, signinPerAccountAddress: 10, signinPerAccount: 100, signupPerAddress: 5, codesPerAddress: 20 };

const DAY = 24 * 60 * 60 * 1000;
/** A session lasts 30 days from its last use, and 180 days at most. */
export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 180 * DAY;
/** The most sessions one person has; signing in once more ends the oldest. */
export const MAX_SESSIONS = 20;
/** How often the last use of a session is written down: not at every request, which would be a write per request. */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
export const TOMBSTONE_MS = 90 * DAY;
export const RESET_CODE_MS = DAY;
export const MIB = 1024 * 1024;

/**
 * What the live server does for the accounts: the rooms bound to designs of spaces (a team's design opened live by its members,
 * without a link; live.ts). The accounts ask it, and tell it when who may be in such a room may have changed.
 */
export interface LiveHooks {
  /** The id of the room bound to this design while it is in memory (or being made): its design is the room's until written back. */
  liveRoom(space: string, designId: string): string | null;
  /** The room bound to this design, made from `current` (the design as the space holds it now) when there is none. */
  bind(space: string, designId: string, current: () => Promise<{ design: Record<string, unknown>; rev: number }>): Promise<string>;
  /**
   * Who may be in bound rooms may have changed: a member's role in a space (`space` and `userId`), every member of a space
   * (`space`), or a person's sessions (`userId`). Sockets whose session no longer lets them in, or now lets them only look where
   * they edited, are closed.
   */
  recheck(scope: { space?: string; userId?: string }): void;
  /**
   * A space is gone (its team was deleted, or its person): its bound rooms are closed and forgotten, with nothing to write back
   * to, those in memory and those kept on the disk (found by the ids of the designs the space held).
   */
  spaceGone(space: string, designIds: readonly string[]): void;
  /** A design was deleted for good: a bound room of it kept on the disk is dropped (one in memory refused the deletion). */
  designGone(space: string, designId: string): void;
}

/** What the server gives the accounts beyond their own options. */
export interface ServerContext {
  allowOrigin: string | string[] | undefined;
  trustProxy: boolean;
  now: () => number;
  maxDesignBytes: number;
  /** The live server's rooms bound to designs; none in a server without rooms (a test of the accounts alone). */
  live?: LiveHooks;
  /** The clips and sounds on their way in, shared with the rooms (src/server/staging.ts); one of its own when none is given. */
  staging?: Staging;
}

/** A request that is refused: its status, a code the client turns into words, a sentence for whoever reads the raw answer. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "Refusal";
  }
}

export const refuse = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: Record<string, string>) =>
  new Refusal(status, code, message, extra, headers);
export const badRequest = (message: string) => refuse(400, "bad-request", message);
export const notFound = (message = "not found") => refuse(404, "not-found", message);
export const tooMany = (wait: number, message: string) => refuse(429, "rate", message, {}, { "retry-after": String(wait) });

/** A body that was longer than allowed: answered 413, and the connection dropped (`replyTooBig`). */
export class BodyTooBig extends Error {}

/** A random secret of `bytes` bytes as base64url: tokens, codes, ids. */
export const secret = (bytes: number) => randomBytes(bytes).toString("base64url");
export const newServerId = () => secret(16);
/** A code shown once: 128 bits. */
export const CODE = /^[A-Za-z0-9_-]{22}$/;

/** Runs work for one key at a time, in the order asked; work for other keys runs alongside. */
export function keyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const before = tails.get(key) ?? Promise.resolve();
    const run = before.then(work, work);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

/* ---------------- reading what comes in ---------------- */

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** The body as a JSON object, or a refusal: too long (413), not JSON or not an object (400). */
export async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const text = await readBody(req, limit);
  if (text === null) throw new BodyTooBig();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw badRequest("the body is not JSON");
  }
  if (!isPlainObject(value)) throw badRequest("the body is a JSON object");
  return value;
}

/** Refuses a body with a field that is not one of these, or without one of the required ones: every endpoint has an exact shape. */
export function exactly(body: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of Object.keys(body)) if (!required.includes(key) && !optional.includes(key)) throw badRequest(`the body has a field it should not: ${key.slice(0, 40)}`);
  for (const key of required) if (!(key in body)) throw badRequest(`the body needs ${key}`);
}

const CONTROL = /\p{Cc}/u;

/** An email as it is kept and compared: trimmed, NFC, small letters. Never checked by mail: it is a unique name to sign in with. */
export function readEmail(value: unknown): string {
  if (typeof value !== "string") throw badRequest("an email is text");
  const email = value.trim().normalize("NFC").toLowerCase();
  if (email.length < 3 || email.length > 254 || CONTROL.test(email) || !/^[^\s@]+@[^\s@]+$/.test(email)) throw badRequest("that is not an email");
  return email;
}

/** A person's name, made sayable as names in a shared design are (`cleanName`, 40 characters). */
export function readName(value: unknown, what = "a name"): string {
  if (typeof value !== "string") throw badRequest(`${what} is text`);
  const name = cleanName(value);
  if (!name) throw badRequest(`${what} cannot be empty`);
  return name;
}

/** The name of a device, which may be empty. */
export function readDevice(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw badRequest("a device is text");
  return cleanName(value);
}

export function readCount(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw badRequest(`${what} is a whole number from ${min} to ${max}`);
  return value;
}

export function readCode(value: unknown, what = "a code"): string {
  if (typeof value !== "string" || !CODE.test(value)) throw badRequest(`that is not ${what}`);
  return value;
}

/* ---------------- the context ---------------- */

export interface Authed {
  user: UserRecord;
  session: SessionRecord;
  tokenHash: string;
}

export type Ctx = ReturnType<typeof createContext>;

export function createContext(options: AccountsOptions, server: ServerContext) {
  const now = options.now ?? server.now;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const storage = options.storage;
  const serial = keyedQueue();
  const o = {
    signup: options.signup ?? "invite",
    maxAccounts: options.maxAccounts ?? 0,
    spaceQuotaBytes: options.spaceQuotaBytes ?? 1024 * MIB,
    maxMediaBytes: options.maxMediaBytes ?? 100 * MIB,
    maxDesignsPerSpace: options.maxDesignsPerSpace ?? 10_000,
    maxFolders: options.maxFolders ?? 1000,
    maxTeamsPerPerson: options.maxTeamsPerPerson ?? 20,
    maxMembersPerTeam: options.maxMembersPerTeam ?? 100,
    maxOpenInvites: options.maxOpenInvites ?? 50,
    maxDesignBytes: server.maxDesignBytes,
  };
  const hasher: Hasher = createHasher(options.passwordCost ?? DEFAULT_COST, options.hashConcurrency ?? HASH_CONCURRENCY);
  const limiters = {
    signinAddress: hourlyLimit(limits.signinPerAddress, now),
    signinAccountAddress: hourlyLimit(limits.signinPerAccountAddress, now),
    signinAccount: hourlyLimit(limits.signinPerAccount, now),
    signup: hourlyLimit(limits.signupPerAddress, now),
    codes: hourlyLimit(limits.codesPerAddress, now),
  };
  /**
   * The addresses each person used their account from lately (a sign-in, a sign-up, a request with a session). The limit of failed
   * sign-ins for an account from everywhere does not hold these back (`signin`): it is there for guesses spread over many
   * addresses, and without this anybody with a few of them (a block of IPv6 networks costs nothing) could keep a person out of
   * their own account. An address of these still has its own limits.
   */
  const known = knownAddresses(now);

  const addressOf = (req: IncomingMessage) => clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], server.trustProxy);

  /** The first wait of several limits, or 0: a request is refused when any of them says so. */
  const waitOf = (checks: [HourlyLimit, string][]) => Math.max(0, ...checks.map(([limit, name]) => limit.wait(name)));

  /**
   * The person and session behind a request: a bearer token in the `authorization` header and nowhere else, whose session is
   * there, not past its time, still listed by its person (a reset or a sign-out takes it off the list before it removes the
   * file), and whose person is there and not disabled. Anything else is 401 `session`, the same for each, and the browser signs in
   * again. A session in use is noted as used at most once an hour, which slides its end on.
   */
  const authenticate = async (req: IncomingMessage): Promise<Authed> => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "")?.[1];
    const authed = token ? await sessionOf(sha256Hex(token)) : null;
    if (!authed) throw refuse(401, "session", "sign in again");
    known.note(authed.user.id, addressOf(req));
    return authed;
  };

  /** The person and session of a token's hash, by the rules of `authenticate`; null when it lets nobody in. Used as `authenticate` does. */
  const sessionOf = async (tokenHash: string, use = true): Promise<Authed | null> => {
    let session = await storage.loadSession(tokenHash);
    if (!session) return null;
    const at = now();
    if (at >= session.expiresAt || at >= session.createdAt + SESSION_MAX_MS) return null;
    const user = SERVER_ID.test(session.userId) ? await storage.loadUser(session.userId) : null;
    if (!user || user.disabled || user.sessions[session.id] !== tokenHash) return null;
    // (`use` false: a look again at a session already let in, which is not a use of it and does not keep it alive)
    if (use && at - session.lastUsedAt >= SESSION_TOUCH_MS) {
      session = { ...session, lastUsedAt: at, expiresAt: Math.min(session.createdAt + SESSION_MAX_MS, at + SESSION_IDLE_MS) };
      await storage.saveSession(tokenHash, session);
    }
    return { user, session, tokenHash };
  };

  /**
   * The role in a space of whoever holds the session of this token's hash: owner of their own space, their role in a team's;
   * null when the session lets nobody in or its person is not in the space. What a socket of a bound room is let in with (live.ts).
   */
  const roleInSpace = async (tokenHash: string, space: string, use = true): Promise<{ userId: string; name: string; role: TeamRole } | null> => {
    if (!SERVER_ID.test(space)) return null;
    const authed = await sessionOf(tokenHash, use);
    if (!authed) return null;
    const { user } = authed;
    // (the name is what the others in a bound room hear this person as: the account's, not what a browser says)
    if (space === user.id) return { userId: user.id, name: user.name, role: "owner" };
    const team = await storage.loadTeam(space);
    return team && Object.hasOwn(team.members, user.id) ? { userId: user.id, name: user.name, role: team.members[user.id] } : null;
  };

  /** Tells the live server that who may be in its bound rooms may have changed (see `LiveHooks.recheck`). */
  const recheck = (scope: { space?: string; userId?: string }) => server.live?.recheck(scope);

  /**
   * Starts a session for a person and gives its token, which is kept nowhere: the server keeps its SHA-256. A person has at most
   * `MAX_SESSIONS`; past that the oldest goes (one whose file is missing or has expired goes first).
   */
  const startSession = (userId: string, device: string): Promise<string> =>
    serial(`user:${userId}`, async () => {
      const user = await storage.loadUser(userId);
      if (!user) throw refuse(401, "wrong", "that email and password do not match");
      const at = now();
      const ids = Object.keys(user.sessions);
      if (ids.length >= MAX_SESSIONS) {
        const ages: [string, number][] = [];
        for (const id of ids) {
          const session = await storage.loadSession(user.sessions[id]).catch(() => null);
          ages.push([id, session && session.expiresAt > at ? session.createdAt : -1]);
        }
        ages.sort((a, b) => a[1] - b[1]);
        for (const [id] of ages.slice(0, ids.length - MAX_SESSIONS + 1)) {
          const hash = user.sessions[id];
          delete user.sessions[id];
          await storage.saveUser(user);
          await storage.removeSession(hash);
        }
      }
      const token = secret(32);
      const tokenHash = sha256Hex(token);
      const session: SessionRecord = { id: secret(12), userId, device, createdAt: at, lastUsedAt: at, expiresAt: at + SESSION_IDLE_MS };
      // the person's list first: a session file that the list does not name lets nobody in, so a crash between the two is harmless
      user.sessions[session.id] = tokenHash;
      await storage.saveUser(user);
      await storage.saveSession(tokenHash, session);
      return token;
    });

  /** Ends sessions of a person: off the list first (from then on they let nobody in), then their files. Call inside `user:` serial. */
  const endSessions = async (user: UserRecord, keep?: string) => {
    const ending = Object.entries(user.sessions).filter(([id]) => id !== keep);
    for (const [id] of ending) delete user.sessions[id];
    await storage.saveUser(user);
    for (const [, hash] of ending) await storage.removeSession(hash);
    // a socket in a bound room that came in with one of them goes too (a reset, a new password, a disabled account)
    recheck({ userId: user.id });
  };

  /** The teams a person is in, from the teams themselves: the person's own list is an index that may name one they left. */
  const teamsOf = async (user: UserRecord): Promise<{ team: TeamRecord; role: TeamRole }[]> => {
    const found: { team: TeamRecord; role: TeamRole }[] = [];
    for (const id of user.teams) {
      const team = await storage.loadTeam(id);
      const role = team && Object.hasOwn(team.members, user.id) ? team.members[user.id] : undefined;
      if (team && role) found.push({ team, role });
    }
    return found;
  };

  /** What a person may see of themselves and of other members. */
  const publicUser = (user: UserRecord) => ({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt });

  return {
    storage,
    now,
    o,
    staging: server.staging ?? createStaging(Infinity),
    hasher,
    limiters,
    known,
    serial,
    addressOf,
    waitOf,
    authenticate,
    sessionOf,
    roleInSpace,
    recheck,
    startSession,
    endSessions,
    teamsOf,
    publicUser,
    server,
  };
}

/** Turns what a route threw into an answer: a refusal as itself, a body too long as 413, a busy hasher as 503; anything else is not answered here. */
export function isAnswerable(error: unknown): error is Refusal | BodyTooBig {
  return error instanceof Refusal || error instanceof BodyTooBig;
}

export type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;

/**
 * Accounts, teams and sync on the live server (docs/ACCOUNTS.md), switched on with `accounts` in `createLiveServer` (`ACCOUNTS=1`
 * in main.ts). Without it none of this is loaded into the server's handling and the server is what it was.
 *
 * `routes` answers everything under /api/auth/, /api/me, /api/teams, /api/invites/ and /api/spaces/, and says false for any
 * other address. Every answer is JSON, and every refusal is `{ error, code }` with its status: the code is what a browser turns
 * into words. A page of another origin is refused for every method (403 `origin`), GET too, because these answers are a
 * person's own: the token in the header is what says who, and no browser sends it by itself.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { foreign, reply, replyTooBig, type CorsAllowance } from "../http";
import { adminRoute } from "./admin";
import { changePassword, endSession, listSessions, me, reset, signin, signout, signup } from "./auth";
import { BodyTooBig, createContext, Refusal, refuse, type AccountsOptions, type Ctx, type ServerContext } from "./context";
import { HashBusy } from "./passwords";
import {
  changes,
  deleteDesign,
  deleteFolder,
  getAsset,
  getDesign,
  listVersions,
  missingAssets,
  openLive,
  patchMeta,
  putAsset,
  putDesign,
  putFolder,
  restoreVersion,
  writeBack,
} from "./spaces";
import type { TeamRole } from "./roles";
import { createInvite, createTeam, deleteTeam, getTeam, listInvites, redeem, removeMember, renameTeam, revokeInvite, setRole } from "./teams";

export type { AccountsOptions, LiveHooks, SignupMode } from "./context";
export { SIGNUP_MODES } from "./context";

/** What a preflight is told when accounts are on: PATCH, and the `authorization` header that carries the token. */
export const ACCOUNT_CORS: CorsAllowance = {
  methods: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  headers: "content-type, authorization, x-craftly-key, x-craftly-create-key",
};

type Run = (ctx: Ctx, req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void>;
interface Route {
  path: RegExp;
  methods: Partial<Record<string, Run>>;
}

const SEGMENT = "([^/]+)";
const at = (pattern: string) => new RegExp(`^${pattern.replaceAll(":p", SEGMENT)}$`);

const ROUTES: Route[] = [
  { path: at("/api/auth/signup"), methods: { POST: (c, q, r) => signup(c, q, r) } },
  { path: at("/api/auth/signin"), methods: { POST: (c, q, r) => signin(c, q, r) } },
  { path: at("/api/auth/signout"), methods: { POST: (c, q, r) => signout(c, q, r) } },
  { path: at("/api/auth/reset"), methods: { POST: (c, q, r) => reset(c, q, r) } },
  { path: at("/api/me"), methods: { GET: (c, q, r) => me(c, q, r) } },
  { path: at("/api/me/sessions"), methods: { GET: (c, q, r) => listSessions(c, q, r) } },
  { path: at("/api/me/sessions/:p"), methods: { DELETE: (c, q, r, [id]) => endSession(c, q, r, id) } },
  { path: at("/api/me/password"), methods: { POST: (c, q, r) => changePassword(c, q, r) } },
  { path: at("/api/teams"), methods: { POST: (c, q, r) => createTeam(c, q, r) } },
  {
    path: at("/api/teams/:p"),
    methods: { GET: (c, q, r, [t]) => getTeam(c, q, r, t), PATCH: (c, q, r, [t]) => renameTeam(c, q, r, t), DELETE: (c, q, r, [t]) => deleteTeam(c, q, r, t) },
  },
  { path: at("/api/teams/:p/members/:p"), methods: { PUT: (c, q, r, [t, u]) => setRole(c, q, r, t, u), DELETE: (c, q, r, [t, u]) => removeMember(c, q, r, t, u) } },
  { path: at("/api/teams/:p/invites"), methods: { GET: (c, q, r, [t]) => listInvites(c, q, r, t), POST: (c, q, r, [t]) => createInvite(c, q, r, t) } },
  { path: at("/api/teams/:p/invites/:p"), methods: { DELETE: (c, q, r, [t, i]) => revokeInvite(c, q, r, t, i) } },
  { path: at("/api/invites/redeem"), methods: { POST: (c, q, r) => redeem(c, q, r) } },
  { path: at("/api/spaces/:p/changes"), methods: { GET: (c, q, r, [s], u) => changes(c, q, r, s, u) } },
  {
    path: at("/api/spaces/:p/designs/:p"),
    methods: { GET: (c, q, r, [s, d]) => getDesign(c, q, r, s, d), PUT: (c, q, r, [s, d]) => putDesign(c, q, r, s, d), DELETE: (c, q, r, [s, d]) => deleteDesign(c, q, r, s, d) },
  },
  { path: at("/api/spaces/:p/designs/:p/meta"), methods: { PATCH: (c, q, r, [s, d]) => patchMeta(c, q, r, s, d) } },
  { path: at("/api/spaces/:p/designs/:p/versions"), methods: { GET: (c, q, r, [s, d]) => listVersions(c, q, r, s, d) } },
  { path: at("/api/spaces/:p/designs/:p/restore"), methods: { POST: (c, q, r, [s, d]) => restoreVersion(c, q, r, s, d) } },
  { path: at("/api/spaces/:p/designs/:p/live"), methods: { POST: (c, q, r, [s, d]) => openLive(c, q, r, s, d) } },
  { path: at("/api/spaces/:p/assets/missing"), methods: { POST: (c, q, r, [s]) => missingAssets(c, q, r, s) } },
  { path: at("/api/spaces/:p/assets/:p"), methods: { GET: (c, q, r, [s, a]) => getAsset(c, q, r, s, a), PUT: (c, q, r, [s, a]) => putAsset(c, q, r, s, a) } },
  { path: at("/api/spaces/:p/folders/:p"), methods: { PUT: (c, q, r, [s, f]) => putFolder(c, q, r, s, f), DELETE: (c, q, r, [s, f]) => deleteFolder(c, q, r, s, f) } },
];

const PREFIXES = ["/api/auth/", "/api/me/", "/api/teams/", "/api/invites/", "/api/spaces/"];
const ours = (path: string) => path === "/api/me" || path === "/api/teams" || PREFIXES.some((prefix) => path.startsWith(prefix));

/** The parts of a path, decoded; null when one cannot be (a `%` that is no escape). */
const decodeAll = (parts: string[]): string[] | null => {
  try {
    return parts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
};

export interface Accounts {
  /** Answers a request under the accounts' addresses; false for any other address, which the caller answers. */
  routes(req: IncomingMessage, url: URL, res: ServerResponse): Promise<boolean>;
  /** Answers an operator's request under /api/admin/accounts (the caller checked the key); false for any other address. */
  admin(req: IncomingMessage, url: URL, res: ServerResponse): Promise<boolean>;
  /** What the rooms bound to designs of spaces ask of the accounts (live.ts). */
  bound: {
    /** The person behind a session (the SHA-256 of its token, hex) and their role in a space; null when it lets nobody in there. */
    roleInSpace(tokenHash: string, space: string): Promise<{ userId: string; role: TeamRole } | null>;
    /** Writes a room's design back to its space as the next revision (`writeBack` in spaces.ts); throws when it cannot. */
    writeBack(space: string, designId: string, design: Record<string, unknown>, startTitle: string | undefined): Promise<number>;
  };
}

export function createAccounts(options: AccountsOptions, server: ServerContext): Accounts {
  const ctx = createContext(options, server);

  /** What a route threw, as an answer: a refusal as itself; a server problem is written to the log and answered 500 `server`. */
  const answer = (req: IncomingMessage, res: ServerResponse, error: unknown) => {
    if (res.headersSent) return;
    if (error instanceof Refusal) {
      for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
      return reply(res, error.status, { error: error.message, code: error.code, ...error.extra });
    }
    if (error instanceof BodyTooBig) return replyTooBig(req, res, { error: "the body is too big", code: "too-big" });
    if (error instanceof HashBusy) {
      res.setHeader("retry-after", "1");
      return reply(res, 503, { error: "the server is busy checking passwords; try again in a moment", code: "busy" });
    }
    console.error(`Craftly could not answer ${req.method} ${new URL(req.url ?? "/", "http://localhost").pathname}`, error);
    reply(res, 500, { error: "the server has a problem and could not do this; try again later", code: "server" });
  };

  const run = async (req: IncomingMessage, res: ServerResponse, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      answer(req, res, error);
    }
  };

  return {
    async routes(req, url, res) {
      if (!ours(url.pathname)) return false;
      await run(req, res, async () => {
        if (foreign(req, server.allowOrigin)) throw refuse(403, "origin", "this server does not take requests from this origin");
        // (an address may match two routes, `assets/missing` and `assets/:id`: the one that takes the method answers)
        const allowed: string[] = [];
        for (const route of ROUTES) {
          const found = route.path.exec(url.pathname);
          if (!found) continue;
          const handler = req.method ? route.methods[req.method] : undefined;
          if (!handler) {
            allowed.push(...Object.keys(route.methods));
            continue;
          }
          const params = decodeAll(found.slice(1));
          if (!params) throw refuse(400, "bad-request", "the address cannot be read");
          return handler(ctx, req, res, params, url);
        }
        if (allowed.length) throw refuse(405, "method", "this address does not take that method", {}, { allow: [...new Set(allowed)].join(", ") });
        throw refuse(404, "not-found", "not found");
      });
      return true;
    },
    async admin(req, url, res) {
      let handled = true;
      await run(req, res, async () => {
        handled = await adminRoute(ctx, req, url, res);
      });
      return handled;
    },
    bound: {
      roleInSpace: (tokenHash, space) => ctx.roleInSpace(tokenHash, space),
      writeBack: (space, designId, design, startTitle) => writeBack(ctx, space, designId, design, startTitle),
    },
  };
}

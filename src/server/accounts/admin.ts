/**
 * The operator's calls for accounts, under `/api/admin/accounts`, behind the same guard as the rooms' (`operator` in live.ts:
 * `ADMIN_KEY` in `x-craftly-admin-key`, never for a page, ten wrong keys an hour and an address is not listened to). They go
 * through the running server and not to `DATA_DIR` directly, so that they take their turn in the same queues as the requests of
 * people (a reset never meets a sign-in writing the same file), and work where the operator has no shell on the data's volume.
 * `scripts/accounts.mjs` calls them.
 *
 *   GET  /api/admin/accounts                       every account: id, email, name, disabled, made, sessions, teams
 *   POST /api/admin/accounts/signup-codes {uses?, hours?}   a sign-up code, shown once
 *   POST /api/admin/accounts/reset {email}         a reset code, shown once, good for 24 hours; every session ends when it is used
 *   POST /api/admin/accounts/disable {email, disabled?}     disables (or enables again) an account; disabling ends every session
 *   POST /api/admin/accounts/delete {email}        removes an account with its own space; refused while it is a team's last owner
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { reply, sha256Hex } from "../http";
import { makeResetCode } from "./auth";
import { exactly, readCount, readEmail, readJson, refuse, secret, type Ctx } from "./context";
import { SERVER_ID, type UserRecord } from "./storage";
import { removeSpace } from "./teams";

const SMALL_BODY = 4 * 1024;
const HOUR = 60 * 60 * 1000;

async function accountOf(ctx: Ctx, email: string): Promise<UserRecord> {
  const userId = await ctx.storage.emailOwner(email);
  const user = userId && SERVER_ID.test(userId) ? await ctx.storage.loadUser(userId) : null;
  if (!user) throw refuse(404, "not-found", "there is no account with this email");
  return user;
}

async function list(ctx: Ctx, res: ServerResponse) {
  const accounts = [];
  for (const id of (await ctx.storage.listUsers()).sort()) {
    try {
      const user = await ctx.storage.loadUser(id);
      if (!user) continue;
      // a person whose email does not name them was never finished (a sign-up stopped between its two writes): nobody can sign in as them
      if ((await ctx.storage.emailOwner(user.email)) !== user.id) continue;
      accounts.push({
        id,
        email: user.email,
        name: user.name,
        disabled: user.disabled,
        createdAt: user.createdAt,
        sessions: Object.keys(user.sessions).length,
        teams: (await ctx.teamsOf(user)).length,
      });
    } catch (error) {
      console.error(`Craftly could not read the account ${id} for the list of accounts`, error);
      accounts.push({ id, error: "this account cannot be read" });
    }
  }
  reply(res, 200, { accounts });
}

async function signupCode(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req, SMALL_BODY);
  exactly(body, [], ["uses", "hours"]);
  const uses = body.uses === undefined ? 1 : readCount(body.uses, "uses", 1, 1000);
  const hours = body.hours === undefined ? 24 * 7 : readCount(body.hours, "hours", 1, 24 * 90);
  const code = secret(16);
  const at = ctx.now();
  const expiresAt = at + hours * HOUR;
  await ctx.storage.saveCode(sha256Hex(code), { kind: "signup", usesLeft: uses, expiresAt, createdAt: at });
  reply(res, 201, { code, uses, expiresAt });
}

async function resetCode(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["email"]);
  const user = await accountOf(ctx, readEmail(body.email));
  reply(res, 201, await makeResetCode(ctx, user.id));
}

async function disable(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["email"], ["disabled"]);
  if (body.disabled !== undefined && typeof body.disabled !== "boolean") throw refuse(400, "bad-request", "disabled is true or false");
  const disabled = body.disabled ?? true;
  const user = await accountOf(ctx, readEmail(body.email));
  await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    if (!fresh) return;
    fresh.disabled = disabled as boolean;
    if (disabled) await ctx.endSessions(fresh);
    else await ctx.storage.saveUser(fresh);
  });
  reply(res, 200, { ok: true, disabled });
}

/**
 * Removes an account: out of every team (a team where it is the only member goes with it), every session, its own space, its
 * email and its record. While it is the last owner of a team that has other members it is refused, and the teams are named: the
 * operator decides (make someone else an owner, or delete the team) rather than this leaving a team that nobody can manage.
 */
async function remove(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["email"]);
  const user = await accountOf(ctx, readEmail(body.email));
  const teams = await ctx.teamsOf(user);
  const stuck = teams.filter(({ team, role }) => role === "owner" && Object.keys(team.members).length > 1 && Object.values(team.members).filter((r) => r === "owner").length === 1);
  if (stuck.length)
    throw refuse(409, "last-owner", "this account is the last owner of teams with other members", { teams: stuck.map(({ team }) => ({ id: team.id, name: team.name })) });
  for (const { team } of teams) {
    await ctx.serial(`team:${team.id}`, async () => {
      const fresh = await ctx.storage.loadTeam(team.id);
      if (!fresh || !Object.hasOwn(fresh.members, user.id)) return;
      if (Object.keys(fresh.members).length === 1) {
        await ctx.storage.removeTeam(team.id);
        for (const invite of fresh.invites) await ctx.storage.removeCode(invite.hash);
        const designIds = await ctx.serial(`space:${team.id}`, () => removeSpace(ctx, team.id));
        ctx.server.live?.spaceGone(team.id, designIds);
      } else {
        delete fresh.members[user.id];
        await ctx.storage.saveTeam(fresh);
      }
    });
  }
  await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    if (!fresh) return;
    // the sessions first, so that nothing is done in the name of an account that is half gone
    await ctx.endSessions(fresh);
    const designIds = await ctx.serial(`space:${user.id}`, () => removeSpace(ctx, user.id));
    ctx.server.live?.spaceGone(user.id, designIds);
    await ctx.storage.releaseEmail(fresh.email);
    await ctx.storage.removeUser(user.id);
  });
  reply(res, 200, { ok: true });
}

/** Answers an operator's request about accounts; false for an address that is not one of these. The caller checked the key. */
export async function adminRoute(ctx: Ctx, req: IncomingMessage, url: URL, res: ServerResponse): Promise<boolean> {
  const path = url.pathname;
  if (path === "/api/admin/accounts") {
    if (req.method !== "GET") throw refuse(405, "method", "use GET", {}, { allow: "GET" });
    await list(ctx, res);
    return true;
  }
  const action = /^\/api\/admin\/accounts\/(signup-codes|reset|disable|delete)$/.exec(path)?.[1];
  if (!action) return false;
  if (req.method !== "POST") throw refuse(405, "method", "use POST", {}, { allow: "POST" });
  if (action === "signup-codes") await signupCode(ctx, req, res);
  else if (action === "reset") await resetCode(ctx, req, res);
  else if (action === "disable") await disable(ctx, req, res);
  else await remove(ctx, req, res);
  return true;
}

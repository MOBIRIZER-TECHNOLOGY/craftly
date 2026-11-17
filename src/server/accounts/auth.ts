/**
 * Signing up, in and out, the person's own page (`/api/me`), their sessions, changing and resetting a password.
 *
 * Every answer about a password says as little as it can: a sign-in that fails for any reason (no such email, a wrong password,
 * a disabled account) is the same 401 `wrong`, after the same work, because a person who does not exist is checked against a
 * hash of nothing at the same cost (passwords.ts). Sign-up does say that an email is taken: it has to, and codes gate it.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HourlyLimit } from "../address";
import { reply, sha256Hex } from "../http";
import { passwordProblem } from "./passwords";
import { badRequest, exactly, newServerId, readCode, readDevice, readEmail, readJson, readName, refuse, RESET_CODE_MS, secret, tooMany, type Ctx } from "./context";
import { SERVER_ID, type CodeRecord, type UserRecord } from "./storage";
import { joinByInvite, liveInvite } from "./teams";

/** A small body: an email, a password of 256 characters at most, a name, a code. */
const SMALL_BODY = 8 * 1024;

const readPassword = (value: unknown, what = "the password"): string => {
  const problem = passwordProblem(value);
  if (problem) throw badRequest(`${what}: ${problem}`);
  return value as string;
};

/** A code that lets a person make an account: a sign-up code of the operator's, or an invite of a team, still good now. */
async function usableSignupCode(ctx: Ctx, code: string): Promise<{ hash: string; record: CodeRecord } | null> {
  const hash = sha256Hex(code);
  const record = await ctx.storage.loadCode(hash);
  if (!record) return null;
  if (record.kind === "signup") return record.usesLeft > 0 && record.expiresAt > ctx.now() ? { hash, record } : null;
  if (record.kind === "invite") return (await liveInvite(ctx, record)) ? { hash, record } : null;
  return null;
}

const wrongCode = () => refuse(403, "code-wrong", "that code is not good (any more)");

export async function signup(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const address = ctx.addressOf(req);
  // every attempt counts, before anything is read: making an account is a hash and files, and the allowance is what limits it
  const wait = ctx.limiters.signup.take(address);
  if (wait) throw tooMany(wait, "too many accounts were made from this address; try again later");
  if (ctx.o.signup === "closed") throw refuse(403, "signup-closed", "this server does not take new accounts");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["email", "password", "name"], ["code"]);
  const email = readEmail(body.email);
  const password = readPassword(body.password);
  const name = readName(body.name);
  const code = body.code === undefined || body.code === null ? null : readCode(body.code);
  if (ctx.o.signup === "invite" && !code) throw refuse(403, "signup-closed", "this server takes new accounts with an invite or a sign-up code only");
  // the code before the email: whether an email has an account is said only to somebody who may make one
  if (code) {
    const codeWait = ctx.limiters.codes.wait(address);
    if (codeWait) throw tooMany(codeWait, "too many wrong codes from this address; try again later");
    if (!(await usableSignupCode(ctx, code))) {
      ctx.limiters.codes.take(address);
      throw wrongCode();
    }
  }
  if (await ctx.storage.emailOwner(email)) throw refuse(409, "email-taken", "there is an account with this email already");
  const pw = await ctx.hasher.hash(password);
  const recoveryCode = secret(16);

  /** Makes the account; inside the queue of its code, so that a code of one use makes one account. */
  const make = async (): Promise<{ user: UserRecord; team?: { id: string; name: string; role: string } }> => {
    const found = code ? await usableSignupCode(ctx, code) : null;
    if (code && !found) throw wrongCode();
    // one at a time, so that the count of accounts is exact at the limit
    const user = await ctx.serial("signup", async () => {
      if (ctx.o.maxAccounts && (await ctx.storage.listUsers()).length >= ctx.o.maxAccounts) throw refuse(403, "full", "this server holds as many accounts as it may");
      const made: UserRecord = { id: newServerId(), email, name, pw, recoveryHash: sha256Hex(recoveryCode), disabled: false, createdAt: ctx.now(), sessions: {}, teams: [] };
      // The person first and then the email, which the file system gives to one account only: a crash between the two leaves a
      // person nobody can sign in as (and the email free), never an email that names nobody and can never be used again.
      await ctx.storage.saveUser(made);
      if (!(await ctx.storage.claimEmail(email, made.id))) {
        await ctx.storage.removeUser(made.id);
        throw refuse(409, "email-taken", "there is an account with this email already");
      }
      return made;
    });
    if (!found) return { user };
    if (found.record.kind === "signup") {
      const left = found.record.usesLeft - 1;
      if (left > 0) await ctx.storage.saveCode(found.hash, { ...found.record, usesLeft: left });
      else await ctx.storage.removeCode(found.hash);
      return { user };
    }
    if (found.record.kind !== "invite") return { user };
    // the account is made; an invite that stopped being good in this moment leaves a person without the team, not without an account
    const joined = await joinByInvite(ctx, found.hash, found.record, user.id).catch(() => null);
    return { user, team: joined ? { id: joined.team.id, name: joined.team.name, role: joined.role } : undefined };
  };
  const made = code ? await ctx.serial(`code:${sha256Hex(code)}`, make) : await make();
  const token = await ctx.startSession(made.user.id, "");
  reply(res, 201, { token, user: ctx.publicUser(made.user), recoveryCode, ...(made.team ? { team: made.team } : {}) });
}

export async function signin(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["email", "password"], ["device"]);
  const email = readEmail(body.email);
  if (typeof body.password !== "string" || body.password.length > 1024) throw badRequest("a password is text");
  const password = body.password;
  const device = readDevice(body.device);
  const address = ctx.addressOf(req);
  const names: [HourlyLimit, string][] = [
    [ctx.limiters.signinAddress, address],
    [ctx.limiters.signinAccountAddress, `${email}\n${address}`],
    [ctx.limiters.signinAccount, email],
  ];
  const wait = ctx.waitOf(names);
  if (wait) throw tooMany(wait, "too many failed sign-ins; try again later");
  const userId = await ctx.storage.emailOwner(email);
  const user = userId ? await ctx.storage.loadUser(userId) : null;
  // nobody, or a disabled person, is checked against nothing at the cost of a real check, and fails the same way
  const right = await ctx.hasher.verify(password, user && !user.disabled ? user.pw : null);
  if (!right || !user || user.disabled) {
    for (const [limit, name] of names) limit.take(name);
    throw refuse(401, "wrong", "that email and password do not match");
  }
  const token = await ctx.startSession(user.id, device);
  reply(res, 200, { token, user: ctx.publicUser(user) });
}

export async function signout(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const { user, session } = await ctx.authenticate(req);
  await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    if (!fresh) return;
    const hash = fresh.sessions[session.id];
    delete fresh.sessions[session.id];
    await ctx.storage.saveUser(fresh);
    if (hash) await ctx.storage.removeSession(hash);
  });
  ctx.recheck({ userId: user.id });
  reply(res, 200, { ok: true });
}

export async function me(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const { user } = await ctx.authenticate(req);
  const teams = await ctx.teamsOf(user);
  reply(res, 200, {
    user: ctx.publicUser(user),
    teams: teams.map(({ team, role }) => ({ id: team.id, name: team.name, role })),
    spaces: [{ id: user.id, kind: "own", name: user.name, role: "owner" }, ...teams.map(({ team, role }) => ({ id: team.id, kind: "team", name: team.name, role }))],
  });
}

export async function listSessions(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const { user, session: current } = await ctx.authenticate(req);
  const sessions = [];
  const at = ctx.now();
  for (const [id, hash] of Object.entries(user.sessions)) {
    const session = await ctx.storage.loadSession(hash).catch(() => null);
    if (!session || session.expiresAt <= at) continue;
    sessions.push({ id, device: session.device, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt, current: id === current.id });
  }
  sessions.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  reply(res, 200, { sessions });
}

export async function endSession(ctx: Ctx, req: IncomingMessage, res: ServerResponse, id: string) {
  const { user } = await ctx.authenticate(req);
  const ended = await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    if (!fresh || !Object.hasOwn(fresh.sessions, id)) return false;
    const hash = fresh.sessions[id];
    delete fresh.sessions[id];
    await ctx.storage.saveUser(fresh);
    await ctx.storage.removeSession(hash);
    return true;
  });
  if (!ended) throw refuse(404, "not-found", "no such session");
  ctx.recheck({ userId: user.id });
  reply(res, 200, { ok: true });
}

/** A new password for the person who is signed in, with the old one: every other session of theirs ends. */
export async function changePassword(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const { user, session } = await ctx.authenticate(req);
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["old", "new"]);
  if (typeof body.old !== "string" || body.old.length > 1024) throw badRequest("the old password is text");
  const next = readPassword(body.new, "the new password");
  const address = ctx.addressOf(req);
  const names: [HourlyLimit, string][] = [
    [ctx.limiters.signinAccountAddress, `${user.email}\n${address}`],
    [ctx.limiters.signinAccount, user.email],
  ];
  const wait = ctx.waitOf(names);
  if (wait) throw tooMany(wait, "too many wrong passwords; try again later");
  if (!(await ctx.hasher.verify(body.old, user.pw))) {
    for (const [limit, name] of names) limit.take(name);
    throw refuse(401, "wrong", "the old password is not right");
  }
  const pw = await ctx.hasher.hash(next);
  await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    if (!fresh) throw refuse(401, "session", "sign in again");
    fresh.pw = pw;
    await ctx.endSessions(fresh, session.id);
  });
  reply(res, 200, { ok: true });
}

/**
 * A new password without the old one: with a reset code from the operator (`scripts/accounts.mjs reset`), or with the email and
 * the recovery code shown at sign-up, which is then used up and a new one shown. Either way every session of the person ends.
 */
export async function reset(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req, SMALL_BODY);
  const byCode = "code" in body;
  if (byCode) exactly(body, ["code", "newPassword"]);
  else exactly(body, ["email", "recoveryCode", "newPassword"]);
  const password = readPassword(body.newPassword, "the new password");
  const code = byCode ? readCode(body.code) : readCode(body.recoveryCode, "a recovery code");
  const email = byCode ? null : readEmail(body.email);
  const address = ctx.addressOf(req);
  const wait = ctx.limiters.codes.wait(address);
  if (wait) throw tooMany(wait, "too many wrong codes from this address; try again later");
  const wrong = () => {
    ctx.limiters.codes.take(address);
    return refuse(401, "wrong", byCode ? "that reset code is not good (any more)" : "that email and recovery code do not match");
  };

  const codeHash = sha256Hex(code);
  const whose = async (): Promise<string | null> => {
    if (!byCode) return ctx.storage.emailOwner(email as string);
    const record = await ctx.storage.loadCode(codeHash);
    if (!record || record.kind !== "reset" || record.expiresAt <= ctx.now()) throw wrong();
    return record.userId;
  };
  const userId = await whose();
  const user = userId && SERVER_ID.test(userId) ? await ctx.storage.loadUser(userId) : null;
  if (!user || user.disabled) throw wrong();
  if (!byCode && !sameHex(user.recoveryHash, codeHash)) throw wrong();
  const pw = await ctx.hasher.hash(password);
  const recoveryCode = byCode ? null : secret(16);
  const done = await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    // the code was used by a reset that ran meanwhile
    if (!fresh || (byCode ? !(await ctx.storage.loadCode(codeHash)) : !sameHex(fresh.recoveryHash, codeHash))) return false;
    fresh.pw = pw;
    if (recoveryCode) fresh.recoveryHash = sha256Hex(recoveryCode);
    await ctx.endSessions(fresh);
    if (byCode) await ctx.storage.removeCode(codeHash);
    return true;
  });
  if (!done) throw wrong();
  reply(res, 200, recoveryCode ? { ok: true, recoveryCode } : { ok: true });
}

/** Two hex hashes compared in a time that does not depend on where they differ. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A reset code for a person, for the operator: valid for a day, shown once. */
export async function makeResetCode(ctx: Ctx, userId: string): Promise<{ code: string; expiresAt: number }> {
  const code = secret(16);
  const at = ctx.now();
  const expiresAt = at + RESET_CODE_MS;
  await ctx.storage.saveCode(sha256Hex(code), { kind: "reset", userId, expiresAt, createdAt: at });
  return { code, expiresAt };
}

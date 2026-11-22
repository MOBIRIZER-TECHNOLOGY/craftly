/**
 * Teams: making one, renaming and deleting it, roles, removing and leaving, invites and redeeming them.
 *
 * Who may is asked of `can(role, action)` (roles.ts) and nowhere else. A person who is not in a team is told that there is no
 * such team (404), whatever they asked: the id of a team is not theirs to learn about. A team always keeps an owner: the last
 * one can neither leave, nor be removed, nor be made something else (409 `last-owner`); they can delete the team. Only owners
 * change roles, so nobody raises their own.
 *
 * An invite's code is shown once, when it is made, and kept as its SHA-256 twice: in the team's record (to list and revoke the
 * team's invites) and as `codes/<hash>` (to find the team from the code). The team's record decides: a code whose invite is no
 * longer in the team, has no uses left or is past its time is not good.
 *
 * Records are changed one request at a time, in the queue of each (team, then person; never the other way round).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { reply, sha256Hex } from "../http";
import { badRequest, exactly, newServerId, readCode, readCount, readJson, readName, refuse, secret, tooMany, type Ctx } from "./context";
import { can, isTeamRole, type Action, type TeamRole } from "./roles";
import { SERVER_ID, type CodeRecord, type InviteRecord, type TeamRecord } from "./storage";

const SMALL_BODY = 4 * 1024;
const INVITE_ID = /^[A-Za-z0-9_-]{12}$/;
const HOUR = 60 * 60 * 1000;
/** An invite lasts at most 30 days and can be used at most 100 times. */
const MAX_INVITE_HOURS = 720;
const MAX_INVITE_USES = 100;

const noTeam = () => refuse(404, "not-found", "no such team");
const owners = (team: TeamRecord) => Object.values(team.members).filter((role) => role === "owner").length;
const roleIn = (team: TeamRecord, userId: string): TeamRole | null => (Object.hasOwn(team.members, userId) ? team.members[userId] : null);
const liveInvites = (team: TeamRecord, at: number) => team.invites.filter((invite) => invite.usesLeft > 0 && invite.expiresAt > at);
const inviteView = (invite: InviteRecord) => ({ id: invite.id, role: invite.role, usesLeft: invite.usesLeft, expiresAt: invite.expiresAt, createdAt: invite.createdAt });
const teamView = (team: TeamRecord, role: TeamRole) => ({ id: team.id, name: team.name, role });

/** The team and the person's role in it, or 404 when either is missing; 403 when the role may not do the action. */
async function teamFor(ctx: Ctx, teamId: string, userId: string, action: Action): Promise<{ team: TeamRecord; role: TeamRole }> {
  if (!SERVER_ID.test(teamId)) throw noTeam();
  const team = await ctx.storage.loadTeam(teamId);
  const role = team && roleIn(team, userId);
  if (!team || !role) throw noTeam();
  if (!can(role, action)) throw refuse(403, "forbidden", `a team's ${role} cannot do this`);
  return { team, role };
}

/** The invite a code names, if it is still good now: its team is there and still holds it, with a use left, before its time. */
export async function liveInvite(ctx: Ctx, record: Extract<CodeRecord, { kind: "invite" }>): Promise<{ team: TeamRecord; invite: InviteRecord } | null> {
  if (!SERVER_ID.test(record.teamId)) return null;
  const team = await ctx.storage.loadTeam(record.teamId);
  const invite = team?.invites.find((one) => one.id === record.inviteId);
  return team && invite && invite.usesLeft > 0 && invite.expiresAt > ctx.now() ? { team, invite } : null;
}

/**
 * Puts a person into the team of an invite and uses one use of it. Somebody who is in the team already keeps their role and uses
 * nothing. The caller holds the queue of the code. The person's list of teams is written before the team (see `UserRecord.teams`).
 */
export function joinByInvite(ctx: Ctx, codeHash: string, record: Extract<CodeRecord, { kind: "invite" }>, userId: string): Promise<{ team: TeamRecord; role: TeamRole }> {
  return ctx.serial(`team:${record.teamId}`, () => joinInQueue(ctx, codeHash, record, userId));
}

/** 409 `team-full`: a team with as many members as it may (`maxMembersPerTeam`). */
export const teamFull = () => refuse(409, "team-full", "this team has as many members as it may");

/**
 * Whether a team has a place for one more person. A sign-up with an invite asks it before it makes the account, in the team's
 * queue, which it then holds until the person is in: so two sign-ups never both take the last place.
 */
export const hasPlace = (ctx: Ctx, team: TeamRecord) => Object.keys(team.members).length < ctx.o.maxMembersPerTeam;

/** `joinByInvite` for a caller that holds the team's queue already (a sign-up with an invite, auth.ts). */
export async function joinInQueue(ctx: Ctx, codeHash: string, record: Extract<CodeRecord, { kind: "invite" }>, userId: string): Promise<{ team: TeamRecord; role: TeamRole }> {
  const found = await liveInvite(ctx, record);
  if (!found) throw refuse(403, "code-wrong", "that invite is not good (any more)");
  const { team, invite } = found;
  const already = roleIn(team, userId);
  if (already) return { team, role: already };
  if (!hasPlace(ctx, team)) throw teamFull();
  await ctx.serial(`user:${userId}`, async () => {
    const user = await ctx.storage.loadUser(userId);
    if (!user) throw refuse(401, "session", "sign in again");
    if ((await ctx.teamsOf(user)).length >= ctx.o.maxTeamsPerPerson) throw refuse(409, "too-many-teams", "you are in as many teams as one may be");
    if (!user.teams.includes(team.id)) {
      user.teams.push(team.id);
      await ctx.storage.saveUser(user);
    }
  });
  team.members[userId] = invite.role;
  invite.usesLeft--;
  if (invite.usesLeft <= 0) team.invites = team.invites.filter((one) => one !== invite);
  await ctx.storage.saveTeam(team);
  if (invite.usesLeft <= 0) await ctx.storage.removeCode(codeHash);
  return { team, role: invite.role };
}

/** Removes a space with everything in it, and gives the ids of the designs it held (whose bound rooms go too). In the space's queue. */
export async function removeSpace(ctx: Ctx, space: string): Promise<string[]> {
  const ids = Object.keys((await ctx.storage.loadManifest(space)).designs);
  await ctx.storage.removeSpace(space);
  return ids;
}

/** Takes a team off a person's list; the team's own record no longer names them already. */
async function forgetTeam(ctx: Ctx, userId: string, teamId: string) {
  await ctx.serial(`user:${userId}`, async () => {
    const user = await ctx.storage.loadUser(userId);
    if (!user || !user.teams.includes(teamId)) return;
    user.teams = user.teams.filter((id) => id !== teamId);
    await ctx.storage.saveUser(user);
  });
}

export async function createTeam(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const { user } = await ctx.authenticate(req);
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["name"]);
  const name = readName(body.name, "a team's name");
  const team: TeamRecord = { id: newServerId(), name, createdAt: ctx.now(), members: { [user.id]: "owner" }, invites: [] };
  await ctx.serial(`user:${user.id}`, async () => {
    const fresh = await ctx.storage.loadUser(user.id);
    if (!fresh) throw refuse(401, "session", "sign in again");
    if ((await ctx.teamsOf(fresh)).length >= ctx.o.maxTeamsPerPerson) throw refuse(409, "too-many-teams", "you are in as many teams as one may be");
    fresh.teams.push(team.id);
    await ctx.storage.saveUser(fresh);
    await ctx.storage.saveTeam(team);
  });
  reply(res, 201, { team: teamView(team, "owner") });
}

/** The team with its members, for anybody in it. */
export async function getTeam(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string) {
  const { user } = await ctx.authenticate(req);
  const { team, role } = await teamFor(ctx, teamId, user.id, "read");
  const members = [];
  for (const [id, memberRole] of Object.entries(team.members)) {
    const member = SERVER_ID.test(id) ? await ctx.storage.loadUser(id).catch(() => null) : null;
    members.push({ id, role: memberRole, name: member?.name ?? "", email: member?.email ?? "" });
  }
  reply(res, 200, { team: teamView(team, role), members });
}

export async function renameTeam(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string) {
  const { user } = await ctx.authenticate(req);
  await teamFor(ctx, teamId, user.id, "renameTeam");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["name"]);
  const name = readName(body.name, "a team's name");
  const team = await ctx.serial(`team:${teamId}`, async () => {
    const { team: fresh, role } = await teamFor(ctx, teamId, user.id, "renameTeam");
    fresh.name = name;
    await ctx.storage.saveTeam(fresh);
    return teamView(fresh, role);
  });
  reply(res, 200, { team });
}

/** Deletes a team, its space with every design and upload in it, and its invites. Its members are told by the team being gone. */
export async function deleteTeam(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string) {
  const { user } = await ctx.authenticate(req);
  const { team, designIds } = await ctx.serial(`team:${teamId}`, async () => {
    const { team: found } = await teamFor(ctx, teamId, user.id, "deleteTeam");
    // the team first: from then on nobody is in it, and what is left of its space and codes is nobody's
    await ctx.storage.removeTeam(teamId);
    for (const invite of found.invites) await ctx.storage.removeCode(invite.hash);
    const ids = await ctx.serial(`space:${teamId}`, () => removeSpace(ctx, teamId));
    return { team: found, designIds: ids };
  });
  // its bound rooms have no space to go back to: everybody in them is sent away and they are forgotten, on the disk too
  ctx.server.live?.spaceGone(teamId, designIds);
  for (const memberId of Object.keys(team.members)) if (SERVER_ID.test(memberId)) await forgetTeam(ctx, memberId, teamId);
  reply(res, 200, { ok: true });
}

/** Gives a member another role. Only an owner may; the last owner cannot be made something else. */
export async function setRole(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string, memberId: string) {
  const { user } = await ctx.authenticate(req);
  await teamFor(ctx, teamId, user.id, "manageMembers");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["role"]);
  if (!isTeamRole(body.role)) throw badRequest("a role is owner, editor, commenter or viewer");
  const role = body.role;
  await ctx.serial(`team:${teamId}`, async () => {
    const { team } = await teamFor(ctx, teamId, user.id, "manageMembers");
    const was = roleIn(team, memberId);
    if (!was) throw refuse(404, "not-found", "no such member");
    if (was === "owner" && role !== "owner" && owners(team) <= 1) throw refuse(409, "last-owner", "a team keeps at least one owner");
    team.members[memberId] = role;
    await ctx.storage.saveTeam(team);
  });
  // one who edited live and may now only look is sent out of the team's bound rooms (and comes back to look)
  ctx.recheck({ space: teamId, userId: memberId });
  reply(res, 200, { ok: true, role });
}

/** Removes a member (an owner may remove anybody), or the person themselves leaves (anybody may). Never the last owner. */
export async function removeMember(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string, memberId: string) {
  const { user } = await ctx.authenticate(req);
  const leaving = memberId === user.id;
  await ctx.serial(`team:${teamId}`, async () => {
    const { team } = await teamFor(ctx, teamId, user.id, leaving ? "read" : "manageMembers");
    const was = roleIn(team, memberId);
    if (!was) throw refuse(404, "not-found", "no such member");
    if (was === "owner" && owners(team) <= 1) throw refuse(409, "last-owner", "a team keeps at least one owner: make someone else an owner first, or delete the team");
    delete team.members[memberId];
    await ctx.storage.saveTeam(team);
  });
  // removal is immediate, sockets in the team's bound rooms too
  ctx.recheck({ space: teamId, userId: memberId });
  if (SERVER_ID.test(memberId)) await forgetTeam(ctx, memberId, teamId);
  reply(res, 200, { ok: true });
}

export async function createInvite(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string) {
  const { user } = await ctx.authenticate(req);
  await teamFor(ctx, teamId, user.id, "invite");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["role", "uses", "hours"]);
  if (!isTeamRole(body.role)) throw badRequest("a role is owner, editor, commenter or viewer");
  const role = body.role;
  const uses = readCount(body.uses, "uses", 1, MAX_INVITE_USES);
  const hours = readCount(body.hours, "hours", 1, MAX_INVITE_HOURS);
  const code = secret(16);
  const hash = sha256Hex(code);
  const invite = await ctx.serial(`team:${teamId}`, async () => {
    const { team } = await teamFor(ctx, teamId, user.id, "invite");
    const at = ctx.now();
    // invites that are used up or past their time are dropped here, with their codes
    const live = liveInvites(team, at);
    for (const dead of team.invites.filter((one) => !live.includes(one))) await ctx.storage.removeCode(dead.hash);
    if (live.length >= ctx.o.maxOpenInvites) throw refuse(409, "too-many-invites", "this team has as many open invites as it may: revoke one first");
    const made: InviteRecord = { id: secret(9), hash, role, usesLeft: uses, expiresAt: at + hours * HOUR, createdAt: at };
    // the code first: one that names an invite the team does not hold is not good, so a crash between the two is harmless
    await ctx.storage.saveCode(hash, { kind: "invite", teamId, inviteId: made.id });
    team.invites = [...live, made];
    await ctx.storage.saveTeam(team);
    return made;
  });
  reply(res, 201, { ...inviteView(invite), code });
}

export async function listInvites(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string) {
  const { user } = await ctx.authenticate(req);
  const { team } = await teamFor(ctx, teamId, user.id, "invite");
  reply(res, 200, { invites: liveInvites(team, ctx.now()).map(inviteView) });
}

export async function revokeInvite(ctx: Ctx, req: IncomingMessage, res: ServerResponse, teamId: string, inviteId: string) {
  const { user } = await ctx.authenticate(req);
  await teamFor(ctx, teamId, user.id, "invite");
  if (!INVITE_ID.test(inviteId)) throw refuse(404, "not-found", "no such invite");
  await ctx.serial(`team:${teamId}`, async () => {
    const { team } = await teamFor(ctx, teamId, user.id, "invite");
    const invite = team.invites.find((one) => one.id === inviteId);
    if (!invite) throw refuse(404, "not-found", "no such invite");
    team.invites = team.invites.filter((one) => one !== invite);
    await ctx.storage.saveTeam(team);
    await ctx.storage.removeCode(invite.hash);
  });
  reply(res, 200, { ok: true });
}

export async function redeem(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const { user } = await ctx.authenticate(req);
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["code"]);
  const code = readCode(body.code, "an invite");
  const address = ctx.addressOf(req);
  const wait = ctx.limiters.codes.wait(address);
  if (wait) throw tooMany(wait, "too many wrong codes from this address; try again later");
  const hash = sha256Hex(code);
  const joined = await ctx.serial(`code:${hash}`, async () => {
    const record = await ctx.storage.loadCode(hash);
    if (!record || record.kind !== "invite" || !(await liveInvite(ctx, record))) {
      ctx.limiters.codes.take(address);
      throw refuse(403, "code-wrong", "that invite is not good (any more)");
    }
    return joinByInvite(ctx, hash, record, user.id);
  });
  reply(res, 200, { team: teamView(joined.team, joined.role) });
}

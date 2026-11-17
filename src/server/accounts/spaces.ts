/**
 * Spaces: where a person's designs, folders and uploads are kept on the server, and a team's. A space's id is its person's id or
 * its team's id; the code is the same for both, and the role decides (a person is the owner of their own space).
 *
 * What a space holds is its manifest (storage.ts): every design with its revision and details, every folder, every upload, each
 * with the `seq` of its last change. Every change of the space takes the next `seq`, so the changes feed is "everything with a
 * seq after the cursor", and sync works by state: what changed, not a log of what was done.
 *
 *   A design's content is replaced with `PUT` and the revision it was based on (`baseRev`); another revision is a conflict
 *   (409 `conflict` with the server's revision), and making one under an id that is taken is 409 `exists`. A retry of a write
 *   whose answer was lost gets the same answer again instead of a conflict: the content is compared.
 *   A design's details (title, folder, star, trash) are changed with `PATCH …/meta`, field by field, last write wins.
 *   `DELETE` leaves a tombstone: the design is gone from the space, the feed says so, and its revisions are kept for 90 days, in
 *   which an editor can restore one; after that it is purged.
 *   The last 10 revisions before the current one are kept and can be restored (which makes a new revision).
 *
 * Everything that changes a manifest runs in the queue of its space, one at a time; bodies are read and checked before, so a
 * slow upload holds up nobody. Every revision is a file of its own and the manifest is written after it (storage.ts).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkDesign } from "@/collab/protocol";
import { uid } from "@/core/ids";
import { MigrationError } from "@/core/schema/migrator";
import { migrateDesign } from "@/core/schema/design";
import { svgProblem } from "@/core/svgSafety";
import { ASSET_ID, ASSET_LIMIT, checkAsset, readBody, reply } from "../http";
import { badRequest, BodyTooBig, exactly, notFound, readJson, refuse, TOMBSTONE_MS, type Ctx } from "./context";
import { can, type Action, type TeamRole } from "./roles";
import { SERVER_ID, type DesignEntry, type Manifest, type StoredDesign, type UserRecord } from "./storage";

/** The ids the app makes for designs and folders: what `isSafeId` (src/export/backupFormat.ts) allows. */
const SAFE_ID = /^[A-Za-z0-9_:-]{1,128}$/;
const THUMBNAIL = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/;
const MAX_THUMBNAIL = 256 * 1024;
const MAX_TITLE = 200;
const KEPT_VERSIONS = 10;
const FEED_PAGE = 500;
const MAX_MISSING_ASK = 1000;
const SMALL_BODY = 16 * 1024;

/* ---------------- who may ---------------- */

/** Who asks and for what: asked again when a change takes its turn in the space's queue (`change`). */
interface Asker {
  tokenHash: string;
  userId: string;
  action: Action;
}

/** A person's role in a space: owner of their own, their role in a team's; null when they are not in it (or it is not there). */
async function roleIn(ctx: Ctx, user: UserRecord, spaceId: string): Promise<TeamRole | null> {
  if (!SERVER_ID.test(spaceId)) return null;
  if (spaceId === user.id) return "owner";
  const team = await ctx.storage.loadTeam(spaceId);
  return team && Object.hasOwn(team.members, user.id) ? team.members[user.id] : null;
}

/** The person and their role in a space, or 404 for a space they are not in (or that is not there); 403 when the role may not. */
async function access(ctx: Ctx, req: IncomingMessage, spaceId: string, action: Action): Promise<{ user: UserRecord; role: TeamRole; asker: Asker }> {
  const { user, tokenHash } = await ctx.authenticate(req);
  const role = await roleIn(ctx, user, spaceId);
  if (!role) throw notFound("no such space");
  if (!can(role, action)) throw refuse(403, "forbidden", `a ${role} cannot do this here`);
  return { user, role, asker: { tokenHash, userId: user.id, action } };
}

/**
 * Asks again, in the space's queue, what `access` asked before the body was read (which can take minutes for 16 MB): a member
 * removed or lowered meanwhile, a session ended, or a team deleted (whose space is then removed in this same queue) writes
 * nothing. The session is not noted as used for this: the request was, already.
 */
async function stillMay(ctx: Ctx, space: string, asker: Asker): Promise<void> {
  const authed = await ctx.sessionOf(asker.tokenHash, false);
  if (!authed || authed.user.id !== asker.userId) throw refuse(401, "session", "sign in again");
  const role = await roleIn(ctx, authed.user, space);
  if (!role) throw notFound("no such space");
  if (!can(role, asker.action)) throw refuse(403, "forbidden", `a ${role} cannot do this here`);
}

const readId = (raw: string, pattern: RegExp, what: string) => {
  if (!pattern.test(raw)) throw badRequest(`that is not the id of ${what}`);
  return raw;
};

/* ---------------- what a space holds ---------------- */

const designBytes = (entry: DesignEntry) => entry.bytes + entry.versions.reduce((sum, v) => sum + v.bytes, 0);

/** Everything a space takes: its designs with their kept revisions (tombstones too, until they are purged) and its uploads. */
export function spaceBytes(m: Manifest): number {
  let bytes = 0;
  for (const entry of Object.values(m.designs)) bytes += designBytes(entry);
  for (const asset of Object.values(m.assets)) bytes += asset.bytes;
  return bytes;
}

const liveDesigns = (m: Manifest) => Object.values(m.designs).filter((entry) => entry.deletedAt === undefined).length;
const liveFolder = (m: Manifest, id: unknown): id is string => typeof id === "string" && Object.hasOwn(m.folders, id) && m.folders[id].deletedAt === undefined;
const designIn = (m: Manifest, id: string): DesignEntry | undefined => (Object.hasOwn(m.designs, id) ? m.designs[id] : undefined);

/** Takes out what was deleted more than 90 days ago, files and all. Changes the manifest it is given; the caller saves it. */
async function purge(ctx: Ctx, space: string, m: Manifest): Promise<void> {
  const before = ctx.now() - TOMBSTONE_MS;
  for (const [id, entry] of Object.entries(m.designs)) {
    if (entry.deletedAt === undefined || entry.deletedAt > before) continue;
    delete m.designs[id];
    await ctx.storage.removeDesign(space, id);
  }
  for (const [id, folder] of Object.entries(m.folders)) if (folder.deletedAt !== undefined && folder.deletedAt <= before) delete m.folders[id];
}

/**
 * Runs a change of a space in its queue: who asks is asked again first (`stillMay`; null for the server's own write-back of a
 * room, whose people were let in by their sessions), then the manifest as it is (purged), saved when the work says it changed.
 */
function change<T>(ctx: Ctx, space: string, asker: Asker | null, work: (m: Manifest) => Promise<{ value: T; changed: boolean }>): Promise<T> {
  return ctx.serial(`space:${space}`, async () => {
    if (asker) await stillMay(ctx, space, asker);
    const m = await ctx.storage.loadManifest(space);
    const count = Object.keys(m.designs).length + Object.keys(m.folders).length;
    await purge(ctx, space, m);
    const purged = Object.keys(m.designs).length + Object.keys(m.folders).length !== count;
    const { value, changed } = await work(m);
    if (changed || purged) await ctx.storage.saveManifest(space, m);
    return value;
  });
}

const quota = () => refuse(413, "quota", "this space is full");

/* ---------------- designs ---------------- */

/** The text a revision is kept as. The design's own text is put in as it is, not turned into text a second time. */
const revisionText = (rev: number, thumbnail: string | null, designJson: string) => `{"rev":${rev},"thumbnail":${JSON.stringify(thumbnail)},"design":${designJson}}`;

function readThumbnail(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_THUMBNAIL) throw badRequest("a thumbnail is a JPEG or PNG data address of 256 KB at most");
  const parts = THUMBNAIL.exec(value);
  if (!parts || parts[2].length % 4 !== 0 || Buffer.from(parts[2], "base64").toString("base64") !== parts[2]) throw badRequest("a thumbnail is a JPEG or PNG data address");
  return value;
}

/** A design as a browser sent it, checked as a hostile room's would be and brought to the current format; its text, measured. */
function readDesign(ctx: Ctx, value: unknown, id: string): { design: Record<string, unknown>; json: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("a design is an object");
  const given = value as Record<string, unknown>;
  if (given.id !== id) throw badRequest("the design's id is not the id in the address");
  // a design that is shared through a room is the room's; its link and keys are never kept in a space
  if ("live" in given) throw badRequest("a design with a live link cannot be kept in a space");
  const problem = checkDesign(given);
  if (problem) throw badRequest(problem);
  let design: Record<string, unknown>;
  try {
    design = migrateDesign(given).design as unknown as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MigrationError && error.code === "newer") throw refuse(400, "newer", "this design is from a newer Craftly than the server knows");
    throw badRequest("this design cannot be read");
  }
  const json = JSON.stringify(design);
  if (Buffer.byteLength(json) > ctx.o.maxDesignBytes) throw refuse(413, "too-big", "the design is too big");
  return { design, json };
}

/** The details of a new design, from the design: the manifest keeps them from then on, and `PATCH …/meta` changes them. */
function detailsOf(m: Manifest, design: Record<string, unknown>) {
  const trashedAt = design.trashedAt;
  return {
    title: String(design.title).slice(0, MAX_TITLE),
    folderId: liveFolder(m, design.folderId) ? design.folderId : null,
    starred: design.starred === true,
    trashedAt: typeof trashedAt === "number" && Number.isFinite(trashedAt) && trashedAt >= 0 ? trashedAt : null,
  };
}

/**
 * Writes a new revision of a design and makes it current: the file first, then the manifest (by the caller). The revision that
 * was current joins the kept ones, and the oldest beyond ten go (their files after the manifest no longer names them). Refuses
 * when the space would hold more than it may.
 */
async function writeRevision(
  ctx: Ctx,
  space: string,
  m: Manifest,
  id: string,
  entry: DesignEntry | undefined,
  content: { thumbnail: string | null; json: string },
  base: Omit<DesignEntry, "rev" | "seq" | "bytes" | "updatedAt" | "versions">,
) {
  const rev = (entry?.rev ?? 0) + 1;
  const text = revisionText(rev, content.thumbnail, content.json);
  const bytes = Buffer.byteLength(text);
  const versions = entry ? [...entry.versions, { rev: entry.rev, bytes: entry.bytes, at: entry.updatedAt }] : [];
  const dropped = versions.splice(0, Math.max(0, versions.length - KEPT_VERSIONS));
  const held = spaceBytes(m) - (entry ? designBytes(entry) : 0);
  if (held + bytes + versions.reduce((sum, v) => sum + v.bytes, 0) > ctx.o.spaceQuotaBytes) throw quota();
  await ctx.storage.saveVersion(space, id, rev, text);
  m.seq++;
  m.designs[id] = { ...base, rev, seq: m.seq, bytes, updatedAt: ctx.now(), versions };
  return { rev, dropped };
}

const dropVersions = async (ctx: Ctx, space: string, id: string, dropped: { rev: number }[]) => {
  for (const { rev } of dropped) await ctx.storage.removeVersion(space, id, rev);
};

/**
 * Refuses a change of a design's content while a room bound to it is in memory (409 `live` with the room): the room's design is
 * the design until it is written back, and a browser joins the room instead. Asked in the space's queue, which the binding of a
 * room also waits for (live.ts), so that no write slips in between the revision a room is made from and the room.
 */
function notLive(ctx: Ctx, space: string, id: string) {
  const room = ctx.server.live?.liveRoom(space, id);
  if (room) throw refuse(409, "live", "this design is open live: join its room", { room });
}

/** The content of a revision as text, to compare it with what was sent. */
const sameContent = async (ctx: Ctx, space: string, id: string, rev: number, json: string) => {
  const kept = await ctx.storage.loadVersion(space, id, rev);
  return !!kept && JSON.stringify(kept.design) === json;
};

export async function putDesign(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "write");
  const id = readId(rawId, SAFE_ID, "a design");
  const body = await readJson(req, ctx.o.maxDesignBytes + MAX_THUMBNAIL + 16 * 1024);
  exactly(body, ["baseRev", "design"], ["thumbnail"]);
  const baseRev = body.baseRev;
  if (baseRev !== null && (typeof baseRev !== "number" || !Number.isSafeInteger(baseRev) || baseRev < 1))
    throw badRequest("baseRev is the revision the design was based on, or null for a new one");
  const { design, json } = readDesign(ctx, body.design, id);
  const content = { thumbnail: readThumbnail(body.thumbnail), json };

  const answer = await change<{ status: number; rev: number; dropped: { rev: number }[] }>(ctx, space, asker, async (m) => {
    notLive(ctx, space, id);
    const entry = designIn(m, id);
    if (entry?.deletedAt !== undefined) throw refuse(409, "deleted", "this design was deleted; it can be restored or sent as a new design", { rev: entry.rev });
    if (baseRev === null) {
      if (entry) {
        // a retry of the write that made it: the same content is the same design
        if (await sameContent(ctx, space, id, entry.rev, json)) return { value: { status: 200, rev: entry.rev, dropped: [] }, changed: false };
        throw refuse(409, "exists", "there is another design under this id", { rev: entry.rev });
      }
      if (liveDesigns(m) >= ctx.o.maxDesignsPerSpace) throw quota();
      const { rev } = await writeRevision(ctx, space, m, id, undefined, content, { ...detailsOf(m, design), metaSeq: m.seq + 1 });
      return { value: { status: 201, rev, dropped: [] }, changed: true };
    }
    if (!entry) throw refuse(404, "not-found", "there is no such design to change");
    if (baseRev !== entry.rev) {
      // a retry of the write that made the current revision
      if (baseRev === entry.rev - 1 && (await sameContent(ctx, space, id, entry.rev, json))) return { value: { status: 200, rev: entry.rev, dropped: [] }, changed: false };
      throw refuse(409, "conflict", "the design was changed since", { rev: entry.rev });
    }
    const { rev, dropped } = await writeRevision(ctx, space, m, id, entry, content, entry);
    return { value: { status: 200, rev, dropped }, changed: true };
  });
  if (answer.dropped.length) await ctx.serial(`space:${space}`, () => dropVersions(ctx, space, id, answer.dropped));
  reply(res, answer.status, { rev: answer.rev });
}

/** The design with the details the manifest keeps for it, which win over what its content says. */
const withDetails = (stored: StoredDesign, entry: DesignEntry) => ({
  ...stored.design,
  title: entry.title,
  folderId: entry.folderId,
  starred: entry.starred,
  trashedAt: entry.trashedAt,
});

export async function getDesign(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  await access(ctx, req, space, "read");
  const id = readId(rawId, SAFE_ID, "a design");
  const m = await ctx.storage.loadManifest(space);
  const entry = designIn(m, id);
  if (!entry) throw notFound("no such design");
  if (entry.deletedAt !== undefined) throw refuse(404, "deleted", "this design was deleted");
  const stored = await ctx.storage.loadVersion(space, id, entry.rev);
  if (!stored) throw new Error(`the manifest of ${space} names revision ${entry.rev} of a design, and it is not there`);
  reply(res, 200, { design: withDetails(stored, entry), rev: entry.rev, thumbnail: stored.thumbnail });
}

/**
 * `POST …/designs/:id/live`: the room bound to a design, made from its current revision when there is none in memory (or kept on
 * the disk because writing it back failed: its copy is the newer). Making it is for those who may write (owner, editor): while
 * it is in memory the space refuses writes of the design, which is not a viewer's to cause. A viewer is given the room only while
 * it is in memory or being made (somebody who may edit opened it), and 409 `not-live` otherwise; their seat does not keep it in
 * memory either (live.ts). The answer is what a browser joins with: the room, the socket's address on this server (as the address
 * of a link's socket is made from the server's), and the role the member's session will get there. No key: a bound room is
 * joined with the session (protocol.ts, `join`).
 */
export async function openLive(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { role } = await access(ctx, req, space, "read");
  const id = readId(rawId, SAFE_ID, "a design");
  // nothing to say: the body is empty or {}
  const text = await readBody(req, SMALL_BODY);
  if (text === null) throw new BodyTooBig();
  if (text.trim() && text.trim() !== "{}") throw badRequest("this takes no body");
  const live = ctx.server.live;
  if (!live) throw notFound("this server has no rooms");
  if (!can(role, "write")) {
    const open = live.liveRoom(space, id);
    if (!open) throw refuse(409, "not-live", "nobody is editing this design live: open it from the space");
    return reply(res, 200, { room: open, ws: `/ws?room=${open}`, role: "view" });
  }
  const room = await live.bind(space, id, () =>
    // in the space's queue, after any write that was there first: from here on a write is refused with `live` (notLive)
    ctx.serial(`space:${space}`, async () => {
      const entry = designIn(await ctx.storage.loadManifest(space), id);
      if (!entry) throw notFound("no such design");
      if (entry.deletedAt !== undefined) throw refuse(404, "deleted", "this design was deleted");
      const stored = await ctx.storage.loadVersion(space, id, entry.rev);
      if (!stored) throw new Error(`the manifest of ${space} names revision ${entry.rev} of a design, and it is not there`);
      return { design: withDetails(stored, entry), rev: entry.rev };
    }),
  );
  reply(res, 200, { room, ws: `/ws?room=${room}`, role: "edit" });
}

/** What writing a room back did: the revision the space is at, and the id of the copy it made instead (or null); or its design is gone. */
export type WriteBack = { gone: false; rev: number; copy: string | null } | { gone: true };

/** What the title of the copy of a room ends with, when its space moved on and the room's design is kept as a design of its own. */
export const LIVE_COPY = " (edited live)";

/** Whether the space is still somebody's: its team, or its person. */
async function spaceIsThere(ctx: Ctx, space: string): Promise<boolean> {
  if (!SERVER_ID.test(space)) return false;
  return !!((await ctx.storage.loadTeam(space)) ?? (await ctx.storage.loadUser(space)));
}

/**
 * Writes the design of a bound room back to its space as the next revision, when the room leaves memory (live.ts): through the
 * space's queue, checked as a `PUT` is (`checkDesign`, the format, the size) and within the quota. Nothing is written when the
 * content is the current revision's. The details stay the manifest's, except the title when the people in the room changed it
 * (`startTitle` is the title the room was made with).
 *
 * `baseRev` is the revision the room was made from (or last written back as). When the space has moved on since (the room was
 * kept on the disk and the space took writes meanwhile), the room's design never goes over the newer revision: it is kept as a
 * new design, "Title (edited live)", as a browser keeps the loser of a conflict ("Title (edited on Device)"), unless it is the
 * current content already. When the design (or the space) is gone, nothing is written and the room has nowhere to go (`gone`).
 * Throws when it cannot be written (a refusal, a full space), and the caller keeps the room's copy.
 */
export async function writeBack(ctx: Ctx, space: string, id: string, given: Record<string, unknown>, startTitle: string | undefined, baseRev: number): Promise<WriteBack> {
  const { live: _live, ...content } = given;
  const { design, json } = readDesign(ctx, { ...content, id }, id);
  const answer = await change<WriteBack & { dropped?: { rev: number }[] }>(ctx, space, null, async (m) => {
    const entry = designIn(m, id);
    if (!entry || entry.deletedAt !== undefined || !(await spaceIsThere(ctx, space))) return { value: { gone: true }, changed: false };
    if (entry.rev !== baseRev) {
      if (await sameContent(ctx, space, id, entry.rev, json)) return { value: { gone: false, rev: entry.rev, copy: null }, changed: false };
      if (liveDesigns(m) >= ctx.o.maxDesignsPerSpace) throw quota();
      const copyId = uid("d");
      const base = typeof design.title === "string" ? design.title : entry.title;
      const title = `${base.slice(0, MAX_TITLE - LIVE_COPY.length)}${LIVE_COPY}`;
      const copy = readDesign(ctx, { ...design, id: copyId, title }, copyId);
      const details = { ...detailsOf(m, copy.design), folderId: entry.folderId, metaSeq: m.seq + 1 };
      await writeRevision(ctx, space, m, copyId, undefined, { thumbnail: null, json: copy.json }, details);
      return { value: { gone: false, rev: entry.rev, copy: copyId }, changed: true };
    }
    const title = typeof design.title === "string" ? design.title.slice(0, MAX_TITLE) : entry.title;
    const retitled = startTitle !== undefined && title !== startTitle && title !== entry.title;
    if (retitled) {
      entry.title = title;
      entry.metaSeq = entry.seq = ++m.seq;
    }
    if (await sameContent(ctx, space, id, entry.rev, json)) return { value: { gone: false, rev: entry.rev, copy: null }, changed: retitled };
    const kept = await ctx.storage.loadVersion(space, id, entry.rev);
    const { rev, dropped } = await writeRevision(ctx, space, m, id, entry, { thumbnail: kept?.thumbnail ?? null, json }, entry);
    return { value: { gone: false, rev, copy: null, dropped }, changed: true };
  });
  const { dropped, ...done } = answer;
  if (dropped?.length) await ctx.serial(`space:${space}`, () => dropVersions(ctx, space, id, dropped));
  return done;
}

export async function patchMeta(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "write");
  const id = readId(rawId, SAFE_ID, "a design");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, [], ["title", "folderId", "starred", "trashedAt"]);
  if (!Object.keys(body).length) throw badRequest("say what to change: title, folderId, starred or trashedAt");
  if ("title" in body && (typeof body.title !== "string" || [...body.title].length > MAX_TITLE)) throw badRequest(`a title is text of ${MAX_TITLE} characters at most`);
  if ("folderId" in body && body.folderId !== null && (typeof body.folderId !== "string" || !SAFE_ID.test(body.folderId)))
    throw badRequest("a folder is the id of a folder, or null");
  if ("starred" in body && typeof body.starred !== "boolean") throw badRequest("starred is true or false");
  const trashed = body.trashedAt;
  if ("trashedAt" in body && trashed !== null && (typeof trashed !== "number" || !Number.isFinite(trashed) || trashed < 0)) throw badRequest("trashedAt is a time or null");
  const seq = await change(ctx, space, asker, async (m) => {
    const entry = designIn(m, id);
    if (!entry || entry.deletedAt !== undefined) throw notFound("no such design");
    if ("folderId" in body && body.folderId !== null && !liveFolder(m, body.folderId)) throw refuse(404, "not-found", "no such folder");
    m.seq++;
    if ("title" in body) entry.title = body.title as string;
    if ("folderId" in body) entry.folderId = body.folderId as string | null;
    if ("starred" in body) entry.starred = body.starred as boolean;
    if ("trashedAt" in body) entry.trashedAt = trashed as number | null;
    entry.metaSeq = m.seq;
    entry.seq = m.seq;
    return { value: m.seq, changed: true };
  });
  reply(res, 200, { ok: true, metaSeq: seq });
}

/** Deletes a design for good: a tombstone that the feed carries; the revisions stay 90 days, for a restore. */
export async function deleteDesign(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "deleteForever");
  const id = readId(rawId, SAFE_ID, "a design");
  await change(ctx, space, asker, async (m) => {
    const entry = designIn(m, id);
    if (!entry) throw notFound("no such design");
    if (entry.deletedAt !== undefined) return { value: null, changed: false };
    // (the people in its room would write it back over the tombstone: it is deleted once they are done; trashing it is a detail and works)
    notLive(ctx, space, id);
    m.seq++;
    entry.deletedAt = ctx.now();
    entry.seq = m.seq;
    return { value: null, changed: true };
  });
  // a room of the design kept on the disk (its write-back failed) has nowhere to go now: it is dropped
  ctx.server.live?.designGone(space, id);
  reply(res, 200, { ok: true });
}

export async function listVersions(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  await access(ctx, req, space, "read");
  const id = readId(rawId, SAFE_ID, "a design");
  const entry = designIn(await ctx.storage.loadManifest(space), id);
  if (!entry) throw notFound("no such design");
  const versions = [{ rev: entry.rev, bytes: entry.bytes, at: entry.updatedAt }, ...[...entry.versions].reverse()];
  reply(res, 200, { current: entry.rev, deleted: entry.deletedAt !== undefined, versions });
}

/** Makes a kept revision the current one, as a new revision; a deleted design comes back with it. */
export async function restoreVersion(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "write");
  const id = readId(rawId, SAFE_ID, "a design");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["rev"]);
  const wanted = body.rev;
  if (typeof wanted !== "number" || !Number.isSafeInteger(wanted) || wanted < 1) throw badRequest("rev is a revision");
  const answer = await change(ctx, space, asker, async (m) => {
    notLive(ctx, space, id);
    const entry = designIn(m, id);
    if (!entry) throw notFound("no such design");
    if (wanted !== entry.rev && !entry.versions.some((v) => v.rev === wanted)) throw refuse(404, "not-found", "that revision is not kept");
    if (wanted === entry.rev && entry.deletedAt === undefined) return { value: { rev: entry.rev, dropped: [] as { rev: number }[] }, changed: false };
    // a deleted design that comes back counts again
    if (entry.deletedAt !== undefined && liveDesigns(m) >= ctx.o.maxDesignsPerSpace) throw quota();
    const kept = await ctx.storage.loadVersion(space, id, wanted);
    if (!kept) throw new Error(`the manifest of ${space} names revision ${wanted} of a design, and it is not there`);
    const { deletedAt: _gone, ...details } = entry;
    const written = await writeRevision(ctx, space, m, id, entry, { thumbnail: kept.thumbnail, json: JSON.stringify(kept.design) }, details);
    return { value: written, changed: true };
  });
  if (answer.dropped.length) await ctx.serial(`space:${space}`, () => dropVersions(ctx, space, id, answer.dropped));
  reply(res, 200, { rev: answer.rev });
}

/* ---------------- folders ---------------- */

export async function putFolder(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "folders");
  const id = readId(rawId, SAFE_ID, "a folder");
  const body = await readJson(req, SMALL_BODY);
  exactly(body, ["name", "parentId"]);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > MAX_TITLE || /\p{Cc}/u.test(name)) throw badRequest(`a folder's name is text of 1 to ${MAX_TITLE} characters`);
  const parentId = body.parentId;
  if (parentId !== null && (typeof parentId !== "string" || !SAFE_ID.test(parentId))) throw badRequest("a parent is the id of a folder, or null");
  const status = await change(ctx, space, asker, async (m) => {
    const was = Object.hasOwn(m.folders, id) ? m.folders[id] : undefined;
    const isNew = !was || was.deletedAt !== undefined;
    if (isNew && Object.values(m.folders).filter((f) => f.deletedAt === undefined).length >= ctx.o.maxFolders) throw quota();
    if (parentId !== null) {
      if (!liveFolder(m, parentId)) throw refuse(404, "not-found", "no such parent folder");
      // a folder cannot be put inside itself, however deep
      for (let at: string | null = parentId, steps = 0; at !== null && steps <= ctx.o.maxFolders; at = m.folders[at]?.parentId ?? null, steps++) {
        if (at === id) throw badRequest("a folder cannot be inside itself");
      }
    }
    m.seq++;
    m.folders[id] = { name, parentId, createdAt: isNew ? ctx.now() : was.createdAt, seq: m.seq };
    return { value: isNew ? 201 : 200, changed: true };
  });
  reply(res, status, { ok: true });
}

/** Removes a folder (a tombstone); what was in it, designs and folders, is then at the top. */
export async function deleteFolder(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "folders");
  const id = readId(rawId, SAFE_ID, "a folder");
  await change(ctx, space, asker, async (m) => {
    const folder = Object.hasOwn(m.folders, id) ? m.folders[id] : undefined;
    if (!folder) throw notFound("no such folder");
    if (folder.deletedAt !== undefined) return { value: null, changed: false };
    folder.deletedAt = ctx.now();
    folder.seq = ++m.seq;
    for (const entry of Object.values(m.designs)) {
      if (entry.folderId !== id) continue;
      entry.folderId = null;
      entry.metaSeq = entry.seq = ++m.seq;
    }
    for (const child of Object.values(m.folders)) {
      if (child.parentId !== id) continue;
      child.parentId = null;
      child.seq = ++m.seq;
    }
    return { value: null, changed: true };
  });
  reply(res, 200, { ok: true });
}

/* ---------------- uploads ---------------- */

/** Whether the bytes begin the way a picture of that type does. A picture that is not is refused, whatever it says it is. */
export function looksLike(mime: string, bytes: Buffer): boolean {
  const starts = (...b: number[]) => b.every((v, i) => bytes[i] === v);
  const ascii = (at: number, text: string) => bytes.subarray(at, at + text.length).toString("latin1") === text;
  switch (mime) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/bmp":
      return ascii(0, "BM");
    case "image/avif":
      return ascii(4, "ftyp");
    default:
      return false;
  }
}

export async function putAsset(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  const { asker } = await access(ctx, req, space, "upload");
  const id = readId(rawId, ASSET_ID, "an upload");
  const text = await readBody(req, ASSET_LIMIT + 100);
  if (text === null) throw new BodyTooBig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("the body is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => key !== "mime" && key !== "base64")) {
    throw badRequest("send { mime, base64 }");
  }
  // the checks a picture of a room gets (http.ts), and then what is inside: plain drawing for an SVG, a picture's bytes otherwise
  const asset = checkAsset(parsed);
  if (!asset) throw badRequest("invalid image data or format");
  const bytes = Buffer.from(asset.base64, "base64");
  if (asset.mime === "image/svg+xml") {
    const problem = svgProblem(bytes.toString("utf8"));
    if (problem) throw badRequest(`this drawing cannot be kept: ${problem}`);
  } else if (!looksLike(asset.mime, bytes)) throw badRequest(`this is not a ${asset.mime} picture`);
  const status = await change(ctx, space, asker, async (m) => {
    if (Object.hasOwn(m.assets, id)) {
      const have = await ctx.storage.loadAsset(space, id);
      if (have && have.mime === asset.mime && have.base64 === asset.base64) return { value: 200, changed: false };
      if (have) throw refuse(409, "exists", "there is another upload under this id");
    }
    if (spaceBytes(m) + asset.base64.length > ctx.o.spaceQuotaBytes) throw quota();
    await ctx.storage.saveAsset(space, id, asset);
    m.seq++;
    m.assets[id] = { mime: asset.mime, bytes: asset.base64.length, seq: m.seq, createdAt: ctx.now() };
    return { value: 201, changed: true };
  });
  reply(res, status, { ok: true });
}

export async function getAsset(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, rawId: string) {
  await access(ctx, req, space, "read");
  const id = readId(rawId, ASSET_ID, "an upload");
  const m = await ctx.storage.loadManifest(space);
  const asset = Object.hasOwn(m.assets, id) ? await ctx.storage.loadAsset(space, id) : null;
  if (!asset) throw notFound("no such upload");
  reply(res, 200, asset);
}

/** Which of these uploads the space does not hold: what a browser sends before the design that uses them. */
export async function missingAssets(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string) {
  await access(ctx, req, space, "read");
  const body = await readJson(req, 160 * 1024);
  exactly(body, ["ids"]);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length > MAX_MISSING_ASK || !ids.every((id) => typeof id === "string" && ASSET_ID.test(id))) {
    throw badRequest(`ids is a list of at most ${MAX_MISSING_ASK} upload ids`);
  }
  const m = await ctx.storage.loadManifest(space);
  reply(res, 200, { missing: [...new Set(ids as string[])].filter((id) => !Object.hasOwn(m.assets, id)) });
}

/* ---------------- the changes feed ---------------- */

/** Everything of a space that changed after a cursor, in the order it changed, a page at a time. */
export function changesAfter(m: Manifest, since: number, limit: number) {
  type Item = { seq: number; kind: "designs" | "folders" | "assets"; value: Record<string, unknown> };
  const items: Item[] = [];
  for (const [id, e] of Object.entries(m.designs)) {
    if (e.seq <= since) continue;
    const { versions: _versions, bytes: _bytes, ...rest } = e;
    items.push({ seq: e.seq, kind: "designs", value: { id, ...rest, deletedAt: e.deletedAt ?? null } });
  }
  for (const [id, f] of Object.entries(m.folders)) if (f.seq > since) items.push({ seq: f.seq, kind: "folders", value: { id, ...f, deletedAt: f.deletedAt ?? null } });
  for (const [id, a] of Object.entries(m.assets)) if (a.seq > since) items.push({ seq: a.seq, kind: "assets", value: { id, ...a } });
  items.sort((a, b) => a.seq - b.seq);
  const page = items.slice(0, limit);
  const more = items.length > page.length;
  const out = { cursor: more ? page[page.length - 1].seq : Math.max(since, m.seq), more, designs: [] as unknown[], folders: [] as unknown[], assets: [] as unknown[] };
  for (const item of page) out[item.kind].push(item.value);
  return out;
}

export async function changes(ctx: Ctx, req: IncomingMessage, res: ServerResponse, space: string, url: URL) {
  await access(ctx, req, space, "read");
  for (const key of url.searchParams.keys()) if (key !== "since" && key !== "limit") throw badRequest(`the address has a question it should not: ${key.slice(0, 40)}`);
  const since = url.searchParams.get("since") ?? "0";
  const limit = url.searchParams.get("limit") ?? String(FEED_PAGE);
  if (!/^\d{1,15}$/.test(since)) throw badRequest("since is a cursor from an earlier answer, or 0");
  if (!/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > FEED_PAGE) throw badRequest(`limit is from 1 to ${FEED_PAGE}`);
  reply(res, 200, changesAfter(await ctx.storage.loadManifest(space), Number(since), Number(limit)));
}

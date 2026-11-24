/**
 * The sync engine (docs/ACCOUNTS.md, "Sync"): keeps the designs, folders and uploads of each space the signed-in person is in the
 * same on this device and on the account server. One tab syncs at a time (it holds the lock `craftly-sync`); a design open in an
 * editor (the lock `craftly-design-<id>`) is left alone until it is closed. It runs when the browser comes online, when the tab
 * comes into view, 3 s after a save, every 60 s and on Sync now, and backs off to 5 minutes after errors.
 *
 * A run, for each space: the folders changed here are sent; the changes feed is read from the space's cursor; the folders changed
 * there are taken; `planSync` (syncPlan.ts) says what to do with each design and it is done, each in a transaction of its own that
 * checks that the design did not change here meanwhile. What the server sends is checked as a hostile room's is (validate.ts);
 * what the server deletes goes to the Trash here; at most 20 conflict copies are made in a run, and then sync stops and says so.
 */
import { m } from "@/i18n";
import { cacheSharedAsset, getAsset as getLocalAsset, prepareAssetFromFile } from "@/core/assets";
import { getStoredDesign, getSummary, listDesigns, listFolders, notifyLibrary, subscribeLibrary, summarize, type VersionRecord } from "@/core/library";
import { uid } from "@/core/ids";
import { dbDelete, dbGet, dbGetAll, metaGet, metaSet, wrap, writeTransaction } from "@/core/persistence";
import type { Design, DesignSummary, Folder, SyncRecord, SyncedMeta } from "@/core/types";
import { blobToDataUrl } from "@/export/encoding";
import { collectAssetIds, dataUrlToBytes, extensionForMime, portableDesign } from "@/export/projectFormat";
import * as api from "./api";
import { CloudError, type Conn } from "./api";
import { designLock, heldLocks, SYNC_LOCK, tryLock } from "./locks";
import { CURSORS_KEY, FOLDERS_KEY, roleIn, updateSession, useCloud, type CloudSession, type Role } from "./state";
import { setSyncStatus, useSyncStatus } from "./syncStatus";
import { isDirty, changedHere, metaOf, planSync, withLaterChanges, type LocalDesign, type SyncAction } from "./syncPlan";
import { BadAnswer, MAX_THUMBNAIL, NewerDesign, THUMBNAIL, checkDesign, migrateDesign, type Changes } from "./validate";

/** At most this many "(edited on …)" copies in one run; past that sync stops and says so. */
export const MAX_CONFLICT_COPIES = 20;
const EVERY_MS = 60_000;
const AFTER_SAVE_MS = 3_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_FEED_PAGES = 200;

export interface SyncReport {
  pulled: number;
  pushed: number;
  conflicts: number;
  trashed: number;
  forked: number;
  deleted: number;
  skipped: number;
  /**
   * changes that wait because the server has the design open live (409 `live`): its room writes it back when everybody has left,
   * and then this device's change is sent or kept as a copy. Not "synced": the status says they wait for that.
   */
  live: number;
  /** a design or a space that could not be synced, with the words that say why */
  problems: string[];
  /** sync stopped before it was done: too many conflict copies, a full space, or a session that ended */
  stopped: "conflicts" | "session" | null;
}

export interface SyncOptions {
  /** for the tests: another fetch */
  fetch?: typeof fetch;
}

const newReport = (): SyncReport => ({ pulled: 0, pushed: 0, conflicts: 0, trashed: 0, forked: 0, deleted: 0, skipped: 0, live: 0, problems: [], stopped: null });

const connOf = (session: CloudSession, options: SyncOptions): Conn => ({ server: session.server, token: session.token, fetch: options.fetch });

const offline = (error: unknown) => error instanceof CloudError && error.code === "offline";

/* ---------------- what is here ---------------- */

const metaOfSummary = (summary: DesignSummary): SyncedMeta => metaOf(summary);

async function syncRecords(): Promise<SyncRecord[]> {
  return dbGetAll<SyncRecord>("sync");
}

/** Whether a role may change what is in a space. */
const writes = (role: Role | null) => role === "owner" || role === "editor";

/** What waits to be sent: designs of the spaces the person may write to that are dirty (content or details), and deletions. */
export async function countWaiting(session = useCloud.getState().session): Promise<number> {
  if (!session) return 0;
  const [designs, records] = await Promise.all([waitingDesigns(session), syncRecords()]);
  let n = designs.size;
  for (const record of records) if (record.tombstone && writes(roleIn(record.space, session))) n++;
  return n;
}

/** The ids of the designs that wait to be sent (what `countWaiting` counts, without the deletions). */
export async function waitingDesigns(session = useCloud.getState().session): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!session) return ids;
  const [summaries, records] = await Promise.all([listDesigns(), syncRecords()]);
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const summary of summaries) {
    if (!summary.space || !writes(roleIn(summary.space, session))) continue;
    const record = byId.get(summary.id) ?? null;
    if (isDirty({ revision: summary.revision ?? null, record }) || Object.keys(changedHere(metaOfSummary(summary), record?.syncedMeta ?? null)).length) ids.add(summary.id);
  }
  return ids;
}

/* ---------------- uploads ---------------- */

/**
 * Fetches the uploads a design uses that are not here, checked as any picture from outside is (`checkUpload`). A clip of a video
 * element is not among them: an account server keeps pictures only, so a clip stays on the device it was uploaded on.
 */
async function fetchAssets(conn: Conn, space: string, design: Design, report: SyncReport): Promise<void> {
  for (const id of collectAssetIds(design, { clips: false })) {
    if (await getLocalAsset(id)) continue;
    try {
      const { mime, base64 } = await api.getAsset(conn, space, id);
      const decoded = dataUrlToBytes(`data:${mime};base64,${base64}`);
      if (!decoded) throw new BadAnswer("an upload's bytes");
      const file = new File([decoded.bytes as BlobPart], `${m.cloud.sync.uploadName}.${extensionForMime(mime)}`, { type: mime });
      const asset = await prepareAssetFromFile(file, id);
      await cacheSharedAsset({ ...asset, space });
    } catch (error) {
      if (offline(error)) throw error;
      // the design is kept all the same; the picture shows as missing until it can be fetched
      report.problems.push(m.cloud.sync.uploadFailed);
    }
  }
}

/** Sends the pictures a design uses that the space does not have, before the design (not its clips: see `fetchAssets`). */
async function sendAssets(conn: Conn, space: string, design: Design): Promise<void> {
  const ids = collectAssetIds(design, { clips: false });
  if (!ids.length) return;
  const missing = await api.missingAssets(conn, space, ids.slice(0, 1000));
  for (const id of missing) {
    const asset = await getLocalAsset(id);
    if (!asset) continue;
    const url = await blobToDataUrl(asset.blob);
    try {
      await api.putAsset(conn, space, id, asset.mime, url.slice(url.indexOf(",") + 1));
    } catch (error) {
      // another upload under this id, or one the server will not keep: the design goes without it
      if (error instanceof CloudError && (error.code === "exists" || error.code === "bad-request")) continue;
      throw error;
    }
  }
}

/* ---------------- writing here ---------------- */

/**
 * Writes the server's design under its id, with what changed here in its details kept, in one transaction that first checks that
 * the design here is still what was planned for (`expected`: its revision then, undefined for a design that was not here).
 * "changed" when it changed meanwhile: the next run looks again. "foreign" when the design here under that id is not of this space
 * (on this device only, or another space's) and is not to be replaced (`adopt`): it is never written over.
 */
async function writeServers(
  space: string,
  got: { design: Design; rev: number; thumbnail?: string },
  expected: string | null | undefined,
  keep: Partial<SyncedMeta>,
  adopt = false,
): Promise<"written" | "changed" | "foreign"> {
  return writeTransaction(["designs", "summaries", "sync"], async (tx) => {
    const summaries = tx.objectStore("summaries");
    const prev = await wrap<DesignSummary | undefined>(summaries.get(got.design.id));
    if ((prev?.revision ?? (prev ? null : undefined)) !== expected) return "changed";
    if (prev && prev.space !== space && !adopt) return "foreign";
    const design: Design = { ...got.design, ...keep };
    const revision = uid("revision");
    tx.objectStore("designs").put(design);
    summaries.put({ ...summarize(design, got.thumbnail, prev), space, revision });
    const record: SyncRecord = { id: design.id, space, serverRev: got.rev, syncedRevision: revision, syncedMeta: metaOf(got.design) };
    tx.objectStore("sync").put(record);
    return "written";
  });
}

/** The design here as it is sent: at this release's format, without a link to a room. Null when there is none, or a newer release wrote it. */
async function sendable(id: string): Promise<{ design: Design; summary: DesignSummary } | null> {
  const [stored, summaries] = await Promise.all([getStoredDesign(id), listDesigns()]);
  const summary = summaries.find((s) => s.id === id);
  if (!stored || !summary) return null;
  try {
    const design = portableDesign(migrateDesign(stored).design) as Design;
    return { design, summary };
  } catch {
    return null;
  }
}

/** Gives the design here a new id (same space, no record): what the server deleted, or has another design under the id of. */
async function giveNewId(id: string): Promise<string | null> {
  const fresh = uid("d");
  const done = await writeTransaction(["designs", "summaries", "sync", "versions"], async (tx) => {
    const designs = tx.objectStore("designs");
    const summaries = tx.objectStore("summaries");
    const [design, summary] = await Promise.all([wrap<Design | undefined>(designs.get(id)), wrap<DesignSummary | undefined>(summaries.get(id))]);
    if (!design || !summary) return false;
    designs.put({ ...design, id: fresh });
    summaries.put({ ...summary, id: fresh, revision: uid("revision") });
    designs.delete(id);
    summaries.delete(id);
    tx.objectStore("sync").delete(id);
    // the saved versions follow the design
    const versions = tx.objectStore("versions");
    for (const version of await wrap<VersionRecord[]>(versions.getAll())) {
      if (version.designId !== id) continue;
      versions.delete(version.id);
      versions.put({ ...version, id: `${fresh}:${version.createdAt}`, designId: fresh, design: { ...version.design, id: fresh } });
    }
    return true;
  });
  return done ? fresh : null;
}

/** Whether two designs have the same content: their pages, size and comments (not their details or dates). */
function sameContent(a: Design, b: Design): boolean {
  const content = (d: Design) => JSON.stringify([d.width, d.height, d.unit ?? null, d.pages, d.comments ?? []]);
  return content(a) === content(b);
}

/**
 * The copy of a design here is what the server has (or will have): after it was edited live in its team's room, which writes it
 * back to the space itself. Nothing of it is sent again. Only when the content here is the room's (`room`, as the room last had
 * it): anything else (an edit that did not reach the room, a save that came after) stays to be sent, and a design the server never
 * had stays as it is. Whether it was marked.
 */
export async function markInStep(id: string, room: Design): Promise<boolean> {
  return writeTransaction(["designs", "summaries", "sync"], async (tx) => {
    const sync = tx.objectStore("sync");
    const [record, summary, design] = await Promise.all([
      wrap<SyncRecord | undefined>(sync.get(id)),
      wrap<DesignSummary | undefined>(tx.objectStore("summaries").get(id)),
      wrap<Design | undefined>(tx.objectStore("designs").get(id)),
    ]);
    if (!record || record.serverRev === null || !summary || !design || !sameContent(design, room)) return false;
    sync.put({ ...record, syncedRevision: summary.revision ?? null, syncedMeta: metaOfSummary(summary) });
    return true;
  });
}

/**
 * Sends one design now, if it waits, whether or not an editor has it open (the one that asks): before it is opened live with the
 * team, so that the room is made from what was edited here. Whether the content here is then what the server has: "in-step" when
 * it is, or nobody is signed in or the design is no space's (nothing to send); "live" when the server refused it because the design
 * is open live there right now (the caller may keep the edit as a copy, `keepAsCopy`, and join); "unsent" when it could not be sent
 * otherwise (a conflict, which the next sync after the editor closes deals with, a full space, a refusal) or the person may not send it.
 */
export async function sendOne(id: string, options: SyncOptions = {}): Promise<"in-step" | "live" | "unsent"> {
  const session = useCloud.getState().session;
  const summary = (await listDesigns()).find((s) => s.id === id);
  if (!session || !summary?.space) return "in-step";
  const role = roleIn(summary.space, session);
  const record = (await dbGetAll<SyncRecord>("sync")).find((r) => r.id === id) ?? null;
  if (!isDirty({ revision: summary.revision ?? null, record })) return "in-step";
  if (!writes(role)) return "unsent";
  // (the editor that asks holds the design's lock: a conflict or a new id, which need it, are left to the sync after it closes)
  const run: SpaceRun = { conn: connOf(session, options), space: summary.space, role: role as Role, device: session.device, report: newReport(), hold: false, full: false };
  await push(run, id, record?.serverRev ?? null);
  const [after, now] = await Promise.all([getSummary(id), dbGet<SyncRecord>("sync", id)]);
  if (after && !isDirty({ revision: after.revision ?? null, record: now ?? null })) return "in-step";
  return run.report.live ? "live" : "unsent";
}

/**
 * Keeps the design here, as it was last saved, as a design of its own in the same space, "Title (edited on Device)", as a
 * conflict does: for an edit made here that cannot reach the server because the design is open live there (`sendOne` answered
 * "live"). The design under the id is left as it is, for the room to replace when it is joined (and for its lock holder, the
 * editor, to keep saving); the copy has a new id that no room holds, and it is sent at once (or by the next sync when that fails).
 * The copy's title, or null when there is no such design here.
 */
export async function keepAsCopy(id: string, options: SyncOptions = {}): Promise<string | null> {
  const session = useCloud.getState().session;
  if (!session) return null;
  const copyId = uid("d");
  const title = await writeTransaction(["designs", "summaries"], async (tx) => {
    const designs = tx.objectStore("designs");
    const summaries = tx.objectStore("summaries");
    const [mine, summary] = await Promise.all([wrap<Design | undefined>(designs.get(id)), wrap<DesignSummary | undefined>(summaries.get(id))]);
    if (!mine || !summary?.space) return null;
    const now = Date.now();
    const copy: Design = { ...mine, id: copyId, title: m.cloud.sync.editedOn(mine.title, session.device), createdAt: now, updatedAt: now };
    delete copy.live;
    designs.put(copy);
    // (no record of sync: a design the server never had, sent as a new one)
    summaries.put({ ...summarize(copy, summary.thumbnail), space: summary.space, revision: uid("revision") });
    return copy.title;
  });
  if (title === null) return null;
  notifyLibrary();
  const space = (await getSummary(copyId))?.space;
  const role = space ? roleIn(space, session) : null;
  if (space && writes(role)) {
    const run: SpaceRun = { conn: connOf(session, options), space, role: role as Role, device: session.device, report: newReport(), hold: false, full: false };
    // (offline, or refused: the copy waits here and the next sync sends it)
    await push(run, copyId, null).catch(() => undefined);
  }
  return title;
}

/* ---------------- a space ---------------- */

interface SpaceRun {
  conn: Conn;
  space: string;
  role: Role;
  device: string;
  report: SyncReport;
  /** the cursor is kept where it was: something of this feed is still to be done */
  hold: boolean;
  /** the space is full: nothing more is sent to it this run */
  full: boolean;
}

async function pull(run: SpaceRun, id: string, expected: string | null | undefined, keep: Partial<SyncedMeta> = {}): Promise<void> {
  let got;
  try {
    got = await api.getDesign(run.conn, run.space, id);
  } catch (error) {
    if (error instanceof NewerDesign) return void run.report.problems.push(m.cloud.sync.newer);
    if (error instanceof CloudError && (error.code === "not-found" || error.code === "deleted")) return; // gone meanwhile: the feed will say so
    throw error;
  }
  await fetchAssets(run.conn, run.space, got.design, run.report);
  const written = await tryLock(designLock(id), () => writeServers(run.space, got, expected, keep));
  if (written === "written") run.report.pulled++;
  else {
    run.hold = true;
    // (a design of another space under this id is found before the plan, in `claimIds`; this is what came here meanwhile)
    if (written === "foreign") run.report.problems.push(m.cloud.sync.sameId(got.design.title));
  }
}

async function push(run: SpaceRun, id: string, baseRev: number | null): Promise<void> {
  if (run.full) return;
  const found = await sendable(id);
  if (!found) return;
  const { design, summary } = found;
  const problem = checkDesign(design);
  if (problem) return void run.report.problems.push(m.cloud.sync.refused(summary.title));
  const sentRevision = summary.revision ?? null;
  const thumbnail = summary.thumbnail && summary.thumbnail.length <= MAX_THUMBNAIL && THUMBNAIL.test(summary.thumbnail) ? summary.thumbnail : undefined;
  let rev: number;
  try {
    await sendAssets(run.conn, run.space, design);
    rev = await api.putDesign(run.conn, run.space, design, baseRev, thumbnail);
  } catch (error) {
    if (!(error instanceof CloudError)) throw error;
    switch (error.code) {
      case "conflict":
        return conflict(run, id, typeof error.extra.rev === "number" ? error.extra.rev : null);
      case "exists":
      case "deleted":
        return fork(run, id);
      case "live":
        // the design is open live on the server: its room writes it back when it is done, and then this is looked at again (a
        // conflict then keeps this edit as a copy). Meanwhile the status says it waits for that, never "Synced".
        run.report.skipped++;
        run.report.live++;
        return;
      case "quota":
        run.full = true;
        run.report.problems.push(m.cloud.sync.full);
        return;
      case "forbidden":
        return;
      case "offline":
      case "session":
      case "rate":
      case "busy":
      case "server":
        throw error;
      default:
        run.report.problems.push(m.cloud.sync.refused(summary.title));
        return;
    }
  }
  await writeTransaction(["sync", "summaries"], async (tx) => {
    const sync = tx.objectStore("sync");
    const before = await wrap<SyncRecord | undefined>(sync.get(id));
    const now = await wrap<DesignSummary | undefined>(tx.objectStore("summaries").get(id));
    // a new design sent its details with its content; one the server had keeps the details that were in step
    const syncedMeta = baseRev === null || !before?.syncedMeta ? metaOfSummary(summary) : before.syncedMeta;
    // deleted for good while it was being sent (deleteForever takes no lock of the design): the server has it now, so its deletion
    // waits to be sent, as a tombstone; a record without one would have the next run take it back from the feed
    const deleted = now ? {} : { tombstone: true };
    sync.put({ id, space: run.space, serverRev: rev, syncedRevision: now ? sentRevision : null, syncedMeta, ...deleted } satisfies SyncRecord);
  });
  run.report.pushed++;
}

/**
 * Both sides changed the design: the server's is taken under the id, and the edit made here is kept twice, in the version
 * history of the design ("Before sync") and as a design of its own, "Title (edited on Device)", which is sent as a new design.
 */
async function conflict(run: SpaceRun, id: string, rev: number | null): Promise<void> {
  if (run.report.conflicts >= MAX_CONFLICT_COPIES) {
    run.report.stopped = "conflicts";
    return;
  }
  let got;
  try {
    got = await api.getDesign(run.conn, run.space, id);
  } catch (error) {
    if (error instanceof NewerDesign) return void run.report.problems.push(m.cloud.sync.newer);
    if (error instanceof CloudError && (error.code === "not-found" || error.code === "deleted")) return fork(run, id);
    throw error;
  }
  if (rev !== null && got.rev < rev) return; // the feed is ahead of the design: the next run looks again
  await fetchAssets(run.conn, run.space, got.design, run.report);
  const copyId = uid("d");
  const made = await tryLock(designLock(id), () =>
    writeTransaction(["designs", "summaries", "versions", "sync"], async (tx) => {
      const designs = tx.objectStore("designs");
      const summaries = tx.objectStore("summaries");
      const [mine, summary] = await Promise.all([wrap<Design | undefined>(designs.get(id)), wrap<DesignSummary | undefined>(summaries.get(id))]);
      if (!mine || !summary) return false;
      // the same content on both sides (what a room wrote back, an edit made twice): no conflict, only the server's revision
      const same = sameContent(mine, got.design);
      if (!same) {
        const now = Date.now();
        const kept: VersionRecord = { id: `${id}:${now}`, designId: id, createdAt: now, label: "Before sync", design: mine };
        tx.objectStore("versions").put(kept);
        const copy: Design = { ...mine, id: copyId, title: m.cloud.sync.editedOn(mine.title, run.device), updatedAt: now };
        delete copy.live;
        designs.put(copy);
        summaries.put({ ...summarize(copy, summary.thumbnail), space: run.space, revision: uid("revision") });
      }
      const revision = uid("revision");
      designs.put(got.design);
      summaries.put({ ...summarize(got.design, got.thumbnail, summary), space: run.space, revision });
      tx.objectStore("sync").put({ id, space: run.space, serverRev: got.rev, syncedRevision: revision, syncedMeta: metaOf(got.design) } satisfies SyncRecord);
      return same ? "same" : "copied";
    }),
  );
  if (!made) {
    run.hold = true;
    return;
  }
  if (made === "same") {
    run.report.pulled++;
    return;
  }
  run.report.conflicts++;
  await push(run, copyId, null);
}

async function fork(run: SpaceRun, id: string): Promise<void> {
  const fresh = await tryLock(designLock(id), () => giveNewId(id));
  if (!fresh) {
    run.hold = true;
    return;
  }
  run.report.forked++;
  await push(run, fresh, null);
}

/** The server deleted a design that did not change here: it goes to the Trash here, as a design of this device only. */
async function trash(run: SpaceRun, id: string): Promise<void> {
  const done = await tryLock(designLock(id), () =>
    writeTransaction(["designs", "summaries", "sync"], async (tx) => {
      const designs = tx.objectStore("designs");
      const summaries = tx.objectStore("summaries");
      const [design, summary] = await Promise.all([wrap<Design | undefined>(designs.get(id)), wrap<DesignSummary | undefined>(summaries.get(id))]);
      tx.objectStore("sync").delete(id);
      if (!design || !summary) return true;
      const trashedAt = summary.trashedAt ?? Date.now();
      designs.put({ ...design, trashedAt });
      const { space: _space, ...rest } = summary;
      summaries.put({ ...rest, trashedAt, revision: uid("revision") });
      return true;
    }),
  );
  if (done) run.report.trashed++;
  else run.hold = true;
}

async function deleteThere(run: SpaceRun, id: string): Promise<void> {
  try {
    await api.deleteDesign(run.conn, run.space, id);
  } catch (error) {
    if (!(error instanceof CloudError)) throw error;
    if (error.code === "live") return void run.report.live++;
    if (error.code === "forbidden") {
      // only an owner deletes for good: the design stays the team's, and comes back here with the feed read again from the start
      await dbDelete("sync", id);
      const cursors = await metaGet<Record<string, number>>(CURSORS_KEY, {});
      await metaSet(CURSORS_KEY, { ...cursors, [run.space]: 0 });
      run.hold = true;
      return;
    }
    if (error.code !== "not-found" && error.code !== "deleted") throw error;
  }
  await dbDelete("sync", id);
  run.report.deleted++;
}

async function metaPush(run: SpaceRun, id: string, patch: Partial<SyncedMeta>): Promise<void> {
  try {
    await api.patchMeta(run.conn, run.space, id, patch);
  } catch (error) {
    if (error instanceof CloudError && (error.code === "not-found" || error.code === "forbidden")) return;
    throw error;
  }
  await writeTransaction(["sync"], async (tx) => {
    const sync = tx.objectStore("sync");
    const record = await wrap<SyncRecord | undefined>(sync.get(id));
    if (record?.syncedMeta) sync.put({ ...record, syncedMeta: { ...record.syncedMeta, ...patch } });
  });
}

/** Takes the server's details where they did not change here; the content stays in step when it was. */
async function metaPull(run: SpaceRun, id: string, planned: SyncedMeta, remote: SyncedMeta, local: SyncedMeta): Promise<void> {
  const done = await tryLock(designLock(id), () =>
    writeTransaction(["designs", "summaries", "sync"], async (tx) => {
      const designs = tx.objectStore("designs");
      const summaries = tx.objectStore("summaries");
      const sync = tx.objectStore("sync");
      const [design, summary, record] = await Promise.all([
        wrap<Design | undefined>(designs.get(id)),
        wrap<DesignSummary | undefined>(summaries.get(id)),
        wrap<SyncRecord | undefined>(sync.get(id)),
      ]);
      if (!design || !summary || !record) return true;
      // a detail changed here while this run went on (a rename, a star: updateSummary takes no lock of the design) is kept
      const meta = withLaterChanges(planned, local, metaOfSummary(summary));
      const revision = uid("revision");
      designs.put({ ...design, ...meta });
      summaries.put({ ...summary, ...meta, revision });
      const clean = record.syncedRevision !== null && record.syncedRevision === (summary.revision ?? null);
      sync.put({ ...record, syncedMeta: remote, syncedRevision: clean ? revision : record.syncedRevision });
      return true;
    }),
  );
  if (!done) run.hold = true;
}

async function act(run: SpaceRun, action: SyncAction, local: Map<string, LocalDesign>): Promise<void> {
  const here = local.get(action.id);
  const mayWrite = writes(run.role);
  switch (action.kind) {
    case "pull": {
      const record = here?.record ?? null;
      const keep = here && record?.serverRev != null ? changedHere(here.meta, record.syncedMeta) : {};
      return pull(run, action.id, here ? here.revision : undefined, keep);
    }
    case "push":
      if (mayWrite) await push(run, action.id, action.baseRev);
      return;
    case "conflict":
      if (mayWrite) await conflict(run, action.id, action.rev);
      // a viewer's copy here is not kept against the team's: the team's is taken
      else await pull(run, action.id, here?.revision ?? null);
      return;
    case "fork":
      if (mayWrite) await fork(run, action.id);
      else await trash(run, action.id);
      return;
    case "trash":
      return trash(run, action.id);
    case "delete":
      if (mayWrite) await deleteThere(run, action.id);
      else await dbDelete("sync", action.id);
      return;
    case "forget":
      return dbDelete("sync", action.id);
    case "meta-push":
      if (mayWrite) await metaPush(run, action.id, action.patch);
      return;
    case "meta-pull":
      return metaPull(run, action.id, action.meta, action.remote, action.local);
    case "skip":
      run.report.skipped++;
      run.hold = true;
      return;
  }
}

type SyncedFolders = Record<string, Record<string, { name: string; parentId: string | null }>>;

/** Sends the folders of the space that were made, renamed, moved or removed here since they were last in step. */
async function pushFolders(run: SpaceRun): Promise<void> {
  const all = await metaGet<SyncedFolders>(FOLDERS_KEY, {});
  const synced = { ...(all[run.space] ?? {}) };
  const local = (await listFolders()).filter((folder) => folder.space === run.space);
  const ids = new Set(local.map((folder) => folder.id));
  const depth = (folder: Folder): number => {
    let n = 0;
    for (let at = folder.parentId; at && n < 100; at = local.find((f) => f.id === at)?.parentId ?? null) n++;
    return n;
  };
  for (const folder of [...local].sort((a, b) => depth(a) - depth(b))) {
    const parentId = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const was = synced[folder.id];
    if (was && was.name === folder.name && was.parentId === parentId) continue;
    try {
      await api.putFolder(run.conn, run.space, folder.id, folder.name.slice(0, 200), parentId);
      synced[folder.id] = { name: folder.name, parentId };
    } catch (error) {
      if (error instanceof CloudError && (error.code === "bad-request" || error.code === "not-found" || error.code === "quota")) continue;
      throw error;
    }
  }
  for (const id of Object.keys(synced)) {
    if (ids.has(id)) continue;
    try {
      await api.deleteFolder(run.conn, run.space, id);
    } catch (error) {
      if (!(error instanceof CloudError && error.code === "not-found")) throw error;
    }
    delete synced[id];
  }
  await metaSet(FOLDERS_KEY, { ...(await metaGet<SyncedFolders>(FOLDERS_KEY, {})), [run.space]: synced });
}

/** Takes the folders the feed says changed. */
async function pullFolders(run: SpaceRun, folders: Changes["folders"]): Promise<void> {
  if (!folders.length) return;
  const all = await metaGet<SyncedFolders>(FOLDERS_KEY, {});
  const synced = { ...(all[run.space] ?? {}) };
  await writeTransaction(["folders"], async (tx) => {
    const store = tx.objectStore("folders");
    for (const folder of folders) {
      const here = await wrap<Folder | undefined>(store.get(folder.id));
      // a folder of this device under the same id is not the server's to change
      if (here && here.space !== run.space) continue;
      if (folder.deletedAt !== null) {
        if (here) store.delete(folder.id);
        delete synced[folder.id];
        continue;
      }
      store.put({ id: folder.id, name: folder.name, parentId: folder.parentId, createdAt: folder.createdAt, space: run.space } satisfies Folder);
      synced[folder.id] = { name: folder.name, parentId: folder.parentId };
    }
  });
  await metaSet(FOLDERS_KEY, { ...(await metaGet<SyncedFolders>(FOLDERS_KEY, {})), [run.space]: synced });
}

/**
 * The designs of the feed whose id is held here by a design that is not of this space: one on this device only (a backup restored
 * on a new device keeps the ids and drops the space; so does a team left and joined again), or one of another space that the server
 * there never had. With the same content and title it is the same design, and the server's is taken in its place. Otherwise the
 * design here gets a new id (it stays what it was, in its own space or none, with its versions) and the server's comes under the
 * id. A design of another space that its server has (or a deletion of one waiting to be sent) keeps its id: that is said, and this
 * one design of the feed waits. Returns the ids that were dealt with here, which the plan leaves alone.
 */
async function claimIds(run: SpaceRun, entries: readonly Changes["designs"][number][]): Promise<string[]> {
  if (!entries.some((e) => e.deletedAt === null)) return [];
  const [summaries, records] = await Promise.all([listDesigns(), syncRecords()]);
  const summaryOf = new Map(summaries.map((s) => [s.id, s]));
  const recordOf = new Map(records.map((r) => [r.id, r]));
  const claimed: string[] = [];
  for (const entry of entries) {
    if (entry.deletedAt !== null) continue;
    const summary = summaryOf.get(entry.id);
    const record = recordOf.get(entry.id);
    if (summary ? summary.space === run.space : !record || record.space === run.space) continue;
    claimed.push(entry.id);
    if (!summary || (summary.space && record?.serverRev != null)) {
      run.hold = true;
      run.report.problems.push(m.cloud.sync.sameId(entry.title));
      continue;
    }
    try {
      await claim(run, entry.id, summary);
    } catch (error) {
      if (error instanceof CloudError && ["offline", "session", "rate", "busy", "server"].includes(error.code)) throw error;
      run.hold = true;
      run.report.problems.push(error instanceof BadAnswer ? m.cloud.errors["bad-answer"] : api.cloudErrorText(error));
    }
  }
  return claimed;
}

async function claim(run: SpaceRun, id: string, summary: DesignSummary): Promise<void> {
  let got;
  try {
    got = await api.getDesign(run.conn, run.space, id);
  } catch (error) {
    if (error instanceof NewerDesign) {
      run.hold = true;
      return void run.report.problems.push(m.cloud.sync.newer);
    }
    if (error instanceof CloudError && (error.code === "not-found" || error.code === "deleted")) return; // the feed will say so
    throw error;
  }
  await fetchAssets(run.conn, run.space, got.design, run.report);
  const mine = await getStoredDesign(id);
  // (only a design of this device only is taken as the server's: one of another space stays in it, under a new id)
  const same = !summary.space && !!mine && mine.title === got.design.title && sameContent(mine, got.design);
  const written = await tryLock(designLock(id), async () => {
    if (same) return writeServers(run.space, got, summary.revision ?? null, {}, true);
    const fresh = await giveNewId(id);
    if (!fresh) return "changed";
    run.report.forked++;
    return writeServers(run.space, got, undefined, {});
  });
  if (written === "written") run.report.pulled++;
  else if (written === null) {
    // open in an editor: looked at again when it is closed
    run.report.skipped++;
    run.hold = true;
  } else run.hold = true;
}

async function syncSpace(conn: Conn, space: string, role: Role, device: string, report: SyncReport): Promise<void> {
  const run: SpaceRun = { conn, space, role, device, report, hold: false, full: false };
  if (writes(role)) await pushFolders(run);

  const cursors = await metaGet<Record<string, number>>(CURSORS_KEY, {});
  const since = typeof cursors[space] === "number" ? cursors[space] : 0;
  const remote = new Map<string, Changes["designs"][number]>();
  const folders: Changes["folders"] = [];
  let cursor = since;
  for (let page = 0, more = true; more && page < MAX_FEED_PAGES; page++) {
    const changes = await api.getChanges(conn, space, cursor);
    for (const design of changes.designs) remote.set(design.id, design);
    folders.push(...changes.folders);
    cursor = changes.cursor;
    more = changes.more;
  }
  await pullFolders(run, folders);

  const claimed = await claimIds(run, [...remote.values()]);
  for (const id of claimed) remote.delete(id);

  const [summaries, records, held] = await Promise.all([listDesigns(), syncRecords(), heldLocks()]);
  const byId = new Map(records.map((r) => [r.id, r]));
  const local = new Map<string, LocalDesign>();
  for (const summary of summaries) {
    if (summary.space !== space) continue;
    local.set(summary.id, {
      id: summary.id,
      revision: summary.revision ?? null,
      meta: metaOfSummary(summary),
      record: byId.get(summary.id) ?? null,
      locked: held.has(designLock(summary.id)),
    });
  }
  const tombstones = records.filter((r) => r.space === space && r.tombstone && !local.has(r.id));
  const plan = planSync([...local.values()], tombstones, [...remote.values()]);

  for (const action of plan) {
    if (report.stopped) {
      run.hold = true;
      break;
    }
    try {
      await act(run, action, local);
    } catch (error) {
      if (error instanceof CloudError && ["offline", "session", "rate", "busy", "server"].includes(error.code)) throw error;
      // one design that cannot be synced does not hold up the others; it is looked at again in the next run
      run.hold = true;
      report.problems.push(error instanceof BadAnswer ? m.cloud.errors["bad-answer"] : api.cloudErrorText(error));
    }
  }
  if (!run.hold && cursor !== since) {
    const now = await metaGet<Record<string, number>>(CURSORS_KEY, {});
    await metaSet(CURSORS_KEY, { ...now, [space]: cursor });
  }
}

/**
 * The designs of a space the person is no longer in (they left, or were removed): kept here, as designs of this device only. What
 * this device knew of the space (its cursor and its folders as last in step) is forgotten: joined again, the space is read from the
 * start, and the folders kept here are not taken for folders removed here (which would delete them on the server).
 */
async function keepLeftSpaces(spaces: Set<string>): Promise<void> {
  const [cursors, synced] = await Promise.all([metaGet<Record<string, number>>(CURSORS_KEY, {}), metaGet<SyncedFolders>(FOLDERS_KEY, {})]);
  const forget = <T>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([space]) => spaces.has(space)));
  if (Object.keys(cursors).some((space) => !spaces.has(space))) await metaSet(CURSORS_KEY, forget(cursors));
  if (Object.keys(synced).some((space) => !spaces.has(space))) await metaSet(FOLDERS_KEY, forget(synced));
  const [summaries, folders] = await Promise.all([listDesigns(), listFolders()]);
  const gone = summaries.filter((s) => s.space && !spaces.has(s.space));
  const goneFolders = folders.filter((f) => f.space && !spaces.has(f.space));
  if (!gone.length && !goneFolders.length) return;
  await writeTransaction(["summaries", "sync", "folders"], async (tx) => {
    for (const summary of gone) {
      const { space: _space, ...rest } = summary;
      tx.objectStore("summaries").put(rest);
      tx.objectStore("sync").delete(summary.id);
    }
    for (const folder of goneFolders) {
      const { space: _space, ...rest } = folder;
      tx.objectStore("folders").put(rest);
    }
  });
}

let quiet = false;

/** One run of sync, now. Null when nobody is signed in or another tab is syncing. */
export async function syncOnce(options: SyncOptions = {}): Promise<SyncReport | null> {
  const session = useCloud.getState().session;
  if (!session) return null;
  return tryLock(SYNC_LOCK, () => runSync(session, options));
}

async function runSync(session: CloudSession, options: SyncOptions): Promise<SyncReport> {
  const report = newReport();
  const conn = connOf(session, options);
  setSyncStatus({ state: "syncing", problem: null });
  try {
    const me = await api.getMe(conn);
    // the teams and the name as the server says them now
    await updateSession((kept) => ({ ...kept, user: me.user, teams: me.teams.map((t) => ({ id: t.id, name: t.name, role: t.role })) }));
    const spaces: Array<{ id: string; role: Role }> = [{ id: me.user.id, role: "owner" }, ...me.teams.map((t) => ({ id: t.id, role: t.role }))];
    await keepLeftSpaces(new Set(spaces.map((s) => s.id)));
    for (const space of spaces) {
      await syncSpace(conn, space.id, space.role, session.device, report);
      if (report.stopped) break;
    }
  } catch (error) {
    if (error instanceof CloudError && error.code === "session") {
      report.stopped = "session";
      setSyncStatus({ state: "problem", problem: m.cloud.sync.signInAgain, waiting: await countWaiting(session) });
      return report;
    }
    const waiting = await countWaiting(session).catch(() => 0);
    if (offline(error)) setSyncStatus({ state: "offline", problem: null, waiting });
    else setSyncStatus({ state: "problem", problem: error instanceof BadAnswer ? m.cloud.errors["bad-answer"] : api.cloudErrorText(error), waiting });
    throw error;
  } finally {
    quiet = true;
    try {
      notifyLibrary();
    } finally {
      quiet = false;
    }
  }
  const waiting = await countWaiting(session);
  if (report.stopped === "conflicts") setSyncStatus({ state: "problem", problem: m.cloud.sync.tooManyConflicts(MAX_CONFLICT_COPIES), waiting });
  else if (report.problems.length) setSyncStatus({ state: "problem", problem: report.problems[0], waiting });
  // what waits for a room on the server is not in step: no "Synced", and no new "Last synced" either
  else if (report.live && waiting) setSyncStatus({ state: "live", problem: null, waiting });
  else setSyncStatus({ state: "synced", problem: null, waiting, lastSyncedAt: Date.now() });
  return report;
}

/* ---------------- running by itself ---------------- */

let stopRunning: (() => void) | null = null;
let kick: (() => void) | null = null;
let soon: (() => void) | null = null;

/** Asks the engine, when it runs, for a run in a moment (after designs were moved in, a team joined). Nothing when it does not run. */
export const requestSync = () => soon?.();

/** Syncs now, as the "Sync now" button does; resolves when the run is over (with null when another tab syncs). */
export async function syncNow(options: SyncOptions = {}): Promise<SyncReport | null> {
  try {
    return await syncOnce(options);
  } finally {
    kick?.();
  }
}

/**
 * Starts syncing by itself: now, when the browser comes online, when the tab comes into view, 3 s after a save, every 60 s; after
 * an error it waits twice as long each time, 5 minutes at most. Safe to call twice.
 */
export function startSync(options: SyncOptions = {}): () => void {
  if (stopRunning) return stopRunning;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let running = false;
  let again = false;
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  };
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const report = await syncOnce(options);
      failures = report && report.problems.length ? failures + 1 : 0;
    } catch {
      failures++;
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      schedule(AFTER_SAVE_MS);
    } else schedule(failures ? Math.min(MAX_BACKOFF_MS, EVERY_MS * 2 ** (failures - 1)) : EVERY_MS);
  };
  const online = () => void run();
  const visible = () => {
    if (document.visibilityState === "visible") void run();
  };
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visible);
  const unsubscribe = subscribeLibrary(() => {
    if (!quiet) schedule(AFTER_SAVE_MS);
  });
  kick = () => {
    if (!running) schedule(EVERY_MS);
  };
  soon = () => schedule(200);
  void countWaiting()
    .then((waiting) => useSyncStatus.setState({ waiting }))
    .catch(() => undefined);
  schedule(0);
  stopRunning = () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
    unsubscribe();
    stopRunning = null;
    kick = null;
    soon = null;
    setSyncStatus({ state: "off", waiting: 0, problem: null });
  };
  return stopRunning;
}

export const stopSync = () => stopRunning?.();

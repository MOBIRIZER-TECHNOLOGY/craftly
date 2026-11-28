/**
 * What to do with each design of a space, from what this device has and what the server says changed (docs/ACCOUNTS.md, "Sync").
 * Pure: no store, no clock, no network; `sync.ts` does what it says.
 *
 * Sync works by state. A design here is dirty when its summary's `revision` is not the record's `syncedRevision` (a design the
 * server never had is dirty), its details when they are not the record's `syncedMeta`. A design there changed when its `rev` is
 * past the record's `serverRev`.
 *
 *   here \ there      | not in the feed / same rev | changed (rev past serverRev) | tombstone
 *   clean             | nothing                    | pull                         | trash (moved to the Trash here, never deleted)
 *   dirty             | push (baseRev serverRev)   | conflict                     | fork (kept, pushed as a new design)
 *   deleted here      | delete on the server       | pull (it comes back)         | forget
 *   not here          | (nothing to know)          | pull                         | nothing
 *
 * Details go apart from the content, field by field: a field changed here is sent (`meta-push`), any other field takes the
 * server's value (`meta-pull`). A design held by the editor (`locked`) is left alone this time (`skip`).
 */
import type { SyncedMeta, SyncRecord } from "@/core/types";

export interface LocalDesign {
  id: string;
  /** the summary's revision; null for a summary from before revisions were kept */
  revision: string | null;
  meta: SyncedMeta;
  record: SyncRecord | null;
  /** open in an editor (it holds the lock `craftly-design-<id>`) */
  locked?: boolean;
}

export interface RemoteEntry extends SyncedMeta {
  id: string;
  rev: number;
  deletedAt: number | null;
}

export type SyncAction =
  | { kind: "pull"; id: string; rev: number }
  | { kind: "push"; id: string; baseRev: number | null }
  | { kind: "conflict"; id: string; rev: number }
  | { kind: "trash"; id: string }
  | { kind: "fork"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "forget"; id: string }
  | { kind: "meta-push"; id: string; patch: Partial<SyncedMeta> }
  /**
   * `meta` is what the details become here (what changed here stays), `remote` the server's, which is then what is in step, and
   * `local` what they were here when the plan was made (a detail changed after that stays too: `withLaterChanges`)
   */
  | { kind: "meta-pull"; id: string; meta: SyncedMeta; remote: SyncedMeta; local: SyncedMeta }
  | { kind: "skip"; id: string };

const FIELDS = ["title", "folderId", "starred", "trashedAt"] as const;

export const metaOf = (value: SyncedMeta): SyncedMeta => ({ title: value.title, folderId: value.folderId, starred: value.starred, trashedAt: value.trashedAt });

/** Whether the content here is not what the server has. */
export const isDirty = (local: Pick<LocalDesign, "revision" | "record">): boolean =>
  !local.record || local.record.serverRev === null || local.record.syncedRevision !== local.revision;

/** The fields of the details changed here since the last sync (every field of a design the server never had). */
export function changedHere(meta: SyncedMeta, synced: SyncedMeta | null): Partial<SyncedMeta> {
  const out: Partial<SyncedMeta> = {};
  for (const field of FIELDS) if (!synced || meta[field] !== synced[field]) (out as Record<string, unknown>)[field] = meta[field];
  return out;
}

/**
 * The details as a `meta-pull` writes them: `meta` as it was planned, but for a field that changed here since the plan was made
 * (`local` is what the details were then, `now` what they are), which keeps its new value. A rename or a star made while the
 * run went on is not taken back; it is not in step with the server's either, so the next run sends it.
 */
export function withLaterChanges(meta: SyncedMeta, local: SyncedMeta, now: SyncedMeta): SyncedMeta {
  const next = { ...meta };
  for (const field of FIELDS) if (now[field] !== local[field]) (next as Record<string, unknown>)[field] = now[field];
  return next;
}

/** The details after the server's are taken for every field not changed here; null when nothing would change here. */
function takenFromServer(local: SyncedMeta, synced: SyncedMeta | null, remote: SyncedMeta): SyncedMeta | null {
  const here = changedHere(local, synced);
  const next = { ...local };
  let changed = false;
  for (const field of FIELDS) {
    if (field in here || local[field] === remote[field]) continue;
    (next as Record<string, unknown>)[field] = remote[field];
    changed = true;
  }
  return changed ? next : null;
}

/**
 * The actions for one space. `local` is every design here of that space, `tombstones` every record of a design deleted here for
 * good whose deletion the server has not had, `remote` what the feed said changed (the last word for each design).
 */
export function planSync(local: readonly LocalDesign[], tombstones: readonly SyncRecord[], remote: readonly RemoteEntry[]): SyncAction[] {
  const actions: SyncAction[] = [];
  const there = new Map<string, RemoteEntry>();
  for (const entry of remote) there.set(entry.id, entry);
  const here = new Set<string>();

  for (const design of local) {
    here.add(design.id);
    const entry = there.get(design.id);
    if (design.locked) {
      actions.push({ kind: "skip", id: design.id });
      continue;
    }
    const record = design.record;
    const dirty = isDirty(design);
    const known = record?.serverRev ?? null;
    if (entry && entry.deletedAt !== null) {
      // never pushed before, under an id the server has a tombstone of: a design of its own all the same
      actions.push(dirty ? { kind: "fork", id: design.id } : { kind: "trash", id: design.id });
      continue;
    }
    const changedThere = !!entry && (known === null || entry.rev > known);
    if (changedThere && entry) {
      if (dirty && known !== null) actions.push({ kind: "conflict", id: design.id, rev: entry.rev });
      else if (dirty) actions.push({ kind: "push", id: design.id, baseRev: null });
      else actions.push({ kind: "pull", id: design.id, rev: entry.rev });
    } else if (dirty) actions.push({ kind: "push", id: design.id, baseRev: known });

    // the details: a design that is pulled takes the server's (and keeps what changed here, which is then sent); a design the
    // server never had sends them with its content
    if (known === null) continue;
    const patch = changedHere(design.meta, record?.syncedMeta ?? null);
    if (Object.keys(patch).length) actions.push({ kind: "meta-push", id: design.id, patch });
    if (entry && !changedThere) {
      const taken = takenFromServer(design.meta, record?.syncedMeta ?? null, entry);
      if (taken) actions.push({ kind: "meta-pull", id: design.id, meta: taken, remote: metaOf(entry), local: metaOf(design.meta) });
    }
  }

  for (const record of tombstones) {
    if (here.has(record.id)) continue;
    here.add(record.id);
    const entry = there.get(record.id);
    if (entry && entry.deletedAt !== null) actions.push({ kind: "forget", id: record.id });
    else if (entry && record.serverRev !== null && entry.rev > record.serverRev) actions.push({ kind: "pull", id: record.id, rev: entry.rev });
    else actions.push({ kind: "delete", id: record.id });
  }

  for (const entry of there.values()) {
    if (here.has(entry.id) || entry.deletedAt !== null) continue;
    actions.push({ kind: "pull", id: entry.id, rev: entry.rev });
  }
  return actions;
}

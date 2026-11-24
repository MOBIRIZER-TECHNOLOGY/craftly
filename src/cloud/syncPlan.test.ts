import { describe, expect, it } from "vitest";
import type { SyncedMeta, SyncRecord } from "@/core/types";
import { changedHere, isDirty, planSync, withLaterChanges, type LocalDesign, type RemoteEntry } from "./syncPlan";

const META: SyncedMeta = { title: "Poster", folderId: null, starred: false, trashedAt: null };
const SPACE = "space_of_ann_000001";

/** A design here: in step with revision 3 of the server unless the test says otherwise. */
function here(
  id: string,
  options: { revision?: string; rev?: number | null; meta?: Partial<SyncedMeta>; synced?: Partial<SyncedMeta> | null; record?: boolean; locked?: boolean } = {},
): LocalDesign {
  const rev = options.rev === undefined ? 3 : options.rev;
  const record: SyncRecord | null =
    options.record === false
      ? null
      : { id, space: SPACE, serverRev: rev, syncedRevision: rev === null ? null : "r-synced", syncedMeta: options.synced === null ? null : { ...META, ...options.synced } };
  return { id, revision: options.revision ?? "r-synced", meta: { ...META, ...options.meta }, record, locked: options.locked };
}
const there = (id: string, rev: number, extra: Partial<RemoteEntry> = {}): RemoteEntry => ({ id, rev, deletedAt: null, ...META, ...extra });
const gone = (id: string, rev = 3): RemoteEntry => there(id, rev, { deletedAt: 1000 });
const tomb = (id: string, serverRev = 3): SyncRecord => ({ id, space: SPACE, serverRev, syncedRevision: "r-synced", syncedMeta: META, tombstone: true });

describe("whether a design is dirty", () => {
  it("is by its revision against the one last in step, and a design the server never had is dirty", () => {
    expect(isDirty(here("a"))).toBe(false);
    expect(isDirty(here("a", { revision: "r-edited" }))).toBe(true);
    expect(isDirty(here("a", { record: false }))).toBe(true);
    expect(isDirty(here("a", { rev: null }))).toBe(true);
  });

  it("is apart for the details, field by field", () => {
    expect(changedHere(META, META)).toEqual({});
    expect(changedHere({ ...META, starred: true, title: "New" }, META)).toEqual({ starred: true, title: "New" });
    expect(changedHere(META, null)).toEqual(META);
  });
});

describe("a clean design here", () => {
  it("against the same revision there: nothing to do", () => {
    expect(planSync([here("a")], [], [there("a", 3)])).toEqual([]);
    expect(planSync([here("a")], [], [])).toEqual([]);
  });

  it("against a newer revision there: the server's is taken", () => {
    expect(planSync([here("a")], [], [there("a", 5)])).toEqual([{ kind: "pull", id: "a", rev: 5 }]);
  });

  it("against a tombstone there: it goes to the Trash here, never deleted", () => {
    expect(planSync([here("a")], [], [gone("a")])).toEqual([{ kind: "trash", id: "a" }]);
  });
});

describe("a dirty design here", () => {
  it("against the same revision there, or none in the feed: it is sent, on the revision it was based on", () => {
    expect(planSync([here("a", { revision: "r-edited" })], [], [there("a", 3)])).toEqual([{ kind: "push", id: "a", baseRev: 3 }]);
    expect(planSync([here("a", { revision: "r-edited" })], [], [])).toEqual([{ kind: "push", id: "a", baseRev: 3 }]);
  });

  it("that the server never had: it is sent as a new design (no baseRev, no details apart)", () => {
    expect(planSync([here("n", { record: false })], [], [])).toEqual([{ kind: "push", id: "n", baseRev: null }]);
    expect(planSync([here("n", { rev: null, synced: null })], [], [])).toEqual([{ kind: "push", id: "n", baseRev: null }]);
  });

  it("against a newer revision there: a conflict", () => {
    expect(planSync([here("a", { revision: "r-edited" })], [], [there("a", 4)])).toEqual([{ kind: "conflict", id: "a", rev: 4 }]);
  });

  it("against a tombstone there: kept, and sent as a new design", () => {
    expect(planSync([here("a", { revision: "r-edited" })], [], [gone("a")])).toEqual([{ kind: "fork", id: "a" }]);
  });

  it("that the server never had, under an id the server has a design of: sent as new, the server says whether it is the same", () => {
    expect(planSync([here("n", { record: false })], [], [there("n", 2)])).toEqual([{ kind: "push", id: "n", baseRev: null }]);
  });
});

describe("a design deleted here for good", () => {
  it("against the same revision there: deleted on the server", () => {
    expect(planSync([], [tomb("a")], [there("a", 3)])).toEqual([{ kind: "delete", id: "a" }]);
    expect(planSync([], [tomb("a")], [])).toEqual([{ kind: "delete", id: "a" }]);
  });

  it("against a newer revision there: somebody else's work is not deleted, it comes back", () => {
    expect(planSync([], [tomb("a")], [there("a", 6)])).toEqual([{ kind: "pull", id: "a", rev: 6 }]);
  });

  it("against a tombstone there: there is nothing left to do but forget it", () => {
    expect(planSync([], [tomb("a")], [gone("a")])).toEqual([{ kind: "forget", id: "a" }]);
  });
});

describe("a design that is only there", () => {
  it("is taken, unless it was deleted", () => {
    expect(planSync([], [], [there("b", 1)])).toEqual([{ kind: "pull", id: "b", rev: 1 }]);
    expect(planSync([], [], [gone("b")])).toEqual([]);
  });
});

describe("the details", () => {
  it("changed here are sent, field by field", () => {
    expect(planSync([here("a", { meta: { starred: true } })], [], [])).toEqual([{ kind: "meta-push", id: "a", patch: { starred: true } }]);
  });

  it("changed there are taken where they were not changed here; what changed here wins", () => {
    const remote = there("a", 3, { title: "Renamed there", starred: true });
    expect(planSync([here("a")], [], [remote])).toEqual([
      { kind: "meta-pull", id: "a", meta: { ...META, title: "Renamed there", starred: true }, remote: { ...META, title: "Renamed there", starred: true }, local: META },
    ]);
    expect(planSync([here("a", { meta: { title: "Renamed here" } })], [], [remote])).toEqual([
      { kind: "meta-push", id: "a", patch: { title: "Renamed here" } },
      {
        kind: "meta-pull",
        id: "a",
        meta: { ...META, title: "Renamed here", starred: true },
        remote: { ...META, title: "Renamed there", starred: true },
        local: { ...META, title: "Renamed here" },
      },
    ]);
  });

  it("taken from the server keep a detail that was changed here after the plan was made", () => {
    const planned = { ...META, title: "Renamed there", starred: true };
    // nothing changed since the plan: the plan stands
    expect(withLaterChanges(planned, META, META)).toEqual(planned);
    // renamed while the run went on: the new name stays, the star is still taken from the server
    expect(withLaterChanges(planned, META, { ...META, title: "Renamed meanwhile" })).toEqual({ ...planned, title: "Renamed meanwhile" });
    // a detail kept because it was changed here, changed again: the newest value stays
    const local = { ...META, folderId: "f1" };
    expect(withLaterChanges({ ...planned, folderId: "f1" }, local, { ...local, folderId: "f2" })).toEqual({ ...planned, folderId: "f2" });
  });

  it("go with a pull: the content is the server's, and a detail changed here is still sent", () => {
    expect(planSync([here("a", { meta: { starred: true } })], [], [there("a", 5)])).toEqual([
      { kind: "pull", id: "a", rev: 5 },
      { kind: "meta-push", id: "a", patch: { starred: true } },
    ]);
  });
});

describe("a design open in the editor", () => {
  it("is left alone, whatever happened on either side", () => {
    expect(planSync([here("a", { locked: true, revision: "r-edited" })], [], [there("a", 9)])).toEqual([{ kind: "skip", id: "a" }]);
    expect(planSync([here("a", { locked: true })], [], [gone("a")])).toEqual([{ kind: "skip", id: "a" }]);
  });
});

describe("a space with many designs", () => {
  it("plans each on its own, and in the order: here, deleted here, only there", () => {
    const plan = planSync([here("clean"), here("edited", { revision: "x" }), here("theirs")], [tomb("deleted")], [there("theirs", 7), there("new", 1), gone("old")]);
    expect(plan).toEqual([
      { kind: "push", id: "edited", baseRev: 3 },
      { kind: "pull", id: "theirs", rev: 7 },
      { kind: "delete", id: "deleted" },
      { kind: "pull", id: "new", rev: 1 },
    ]);
  });
});

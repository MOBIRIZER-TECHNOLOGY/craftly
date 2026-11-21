/**
 * The sync engine against a real account server on a port of its own (src/server/accounts/testServer.ts), with the library in a
 * fake IndexedDB. "The other device" is the same person signed in a second time, talking to the server directly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAssetFromFile, getAsset, listAssets } from "@/core/assets";
import { createDesign, createImage, createPage, createShape } from "@/core/factory";
import {
  getDesign,
  getSummary,
  listDesigns,
  listFolders,
  listVersions,
  moveToTrash,
  saveDesign,
  setStarred,
  renameDesign,
  deleteForever,
  createFolder,
  getDesignForEditing,
} from "@/core/library";
import { dbGet, dbGetAll, dbPut, metaGet } from "@/core/persistence";
import type { Design, SyncRecord } from "@/core/types";
import { boot, call, closeAll, PASSWORD, PNG, signUp, type Booted } from "@/server/accounts/testServer";
import { wipeDatabase } from "@/test/logicDb";
import { moveIntoAccount, signOutAccount, signInAccount } from "./account";
import { designLock, holdLock } from "./locks";
import { saveSession, useCloud, type CloudSession } from "./state";
import { countWaiting, markInStep, MAX_CONFLICT_COPIES, stopSync, syncOnce } from "./sync";
import { useSyncStatus } from "./syncStatus";

let b: Booted;
let person: Awaited<ReturnType<typeof signUp>>;
/** the same person on another device */
let other: string;

async function signedIn(extra: Partial<CloudSession> = {}) {
  await saveSession({ server: b.base, token: person.token, user: person.user, device: "Test laptop", teams: [], activeSpace: person.user.id, ...extra });
}

const space = () => person.user.id;
const remote = (id: string, token = other, sp = space()) => call(b, "GET", `/api/spaces/${sp}/designs/${id}`, { token });

/** A design saved here, in the person's space. */
async function local(title: string, extra: Partial<Design> = {}): Promise<Design> {
  const design = { ...createDesign({ title, width: 300, height: 200, pages: [createPage({ elements: [createShape("rect")] })] }), ...extra };
  await saveDesign(design);
  return design;
}

/** An edit made here, as the editor saves it. */
async function edit(id: string, change: (d: Design) => Design) {
  const open = await getDesignForEditing(id);
  if (!open) throw new Error("no such design");
  await saveDesign(change(open.design), undefined, open.revision);
}

const run = async () => {
  const report = await syncOnce();
  if (!report) throw new Error("sync did not run");
  return report;
};

beforeEach(async () => {
  await wipeDatabase();
  b = await boot();
  person = await signUp(b, { name: "Ann" });
  const second = await call(b, "POST", "/api/auth/signin", { body: { email: person.email, password: PASSWORD, device: "Phone" } });
  other = second.body.token;
  await signedIn();
});

afterEach(async () => {
  stopSync();
  await saveSession(null);
  await closeAll();
});

describe("moving designs in and sending them", () => {
  it("sends a design that was moved into the account, its details with it, and is then in step", async () => {
    await saveSession(null);
    const design = await local("Moved in", { starred: true });
    await signedIn();
    expect((await getSummary(design.id))?.space).toBeUndefined();
    await moveIntoAccount([design.id]);
    stopSync();
    expect((await getSummary(design.id))?.space).toBe(space());
    expect(await countWaiting()).toBe(1);
    const report = await run();
    expect(report.pushed).toBe(1);
    const there = await remote(design.id);
    expect(there.status).toBe(200);
    expect(there.body.design.title).toBe("Moved in");
    expect(there.body.design.starred).toBe(true);
    expect(await countWaiting()).toBe(0);
    expect(useSyncStatus.getState().state).toBe("synced");
    const record = await dbGet<SyncRecord>("sync", design.id);
    expect(record).toMatchObject({ space: space(), serverRev: 1 });
  });

  it("makes new designs in the person's space while they are signed in, and sends edits on the revision they were based on", async () => {
    const design = await local("Poster");
    expect((await getSummary(design.id))?.space).toBe(space());
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    expect(await countWaiting()).toBe(1);
    await run();
    const there = await remote(design.id);
    expect(there.body.rev).toBe(2);
    expect(there.body.design.pages).toHaveLength(2);
  });

  it("sends the uploads a design uses before the design", async () => {
    const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    const asset = await addAssetFromFile(new File([bytes], "dot.png", { type: "image/png" }));
    // (the fake database cannot keep a Blob: the upload is stored with its bytes, as WebKit stores it)
    await dbPut("assets", { ...asset, blob: { bytes: bytes.buffer, type: "image/png" } });
    const design = await local("With a picture", { pages: [createPage({ elements: [createImage({ src: `asset:${asset.id}` })] })] });
    await run();
    const picture = await call(b, "GET", `/api/spaces/${space()}/assets/${asset.id}`, { token: other });
    expect(picture.status).toBe(200);
    expect(picture.body.mime).toBe("image/png");
    expect((await remote(design.id)).status).toBe(200);
  });

  it("sends a folder before the designs in it, and a design that a different design holds the id of as a copy", async () => {
    const folder = await createFolder("Work");
    expect(folder.space).toBe(space());
    const design = await local("In a folder", { folderId: folder.id });
    // the other device sent a different design under the same id first
    await call(b, "PUT", `/api/spaces/${space()}/designs/${design.id}`, { token: other, body: { baseRev: null, design: { ...design, title: "Theirs", pages: [createPage()] } } });
    const report = await run();
    expect(report.forked).toBe(1);
    const mine = (await listDesigns()).find((d) => d.title === "In a folder");
    expect(mine?.id).not.toBe(design.id);
    const there = await remote(mine!.id);
    expect(there.body.design.folderId).toBe(folder.id);
    expect((await remote(design.id)).body.design.title).toBe("Theirs");
  });
});

describe("taking what changed on another device", () => {
  it("takes a new design, a newer revision and new details", async () => {
    const made = createDesign({ title: "From the phone", width: 100, height: 100 });
    await call(b, "PUT", `/api/spaces/${space()}/designs/${made.id}`, { token: other, body: { baseRev: null, design: made } });
    const first = await run();
    expect(first.pulled).toBe(1);
    expect((await getSummary(made.id))?.space).toBe(space());
    await call(b, "PUT", `/api/spaces/${space()}/designs/${made.id}`, { token: other, body: { baseRev: 1, design: { ...made, pages: [createPage(), createPage()] } } });
    await call(b, "PATCH", `/api/spaces/${space()}/designs/${made.id}/meta`, { token: other, body: { starred: true, title: "Renamed on the phone" } });
    await run();
    const here = await getDesign(made.id);
    expect(here?.pages).toHaveLength(2);
    expect(await getSummary(made.id)).toMatchObject({ starred: true, title: "Renamed on the phone" });
    // and is then in step: nothing waits, nothing is sent back
    expect(await countWaiting()).toBe(0);
    const again = await run();
    expect(again).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0 });
  });

  it("keeps a detail changed here and sends it, while the content is the other device's", async () => {
    const design = await local("Shared");
    await run();
    await setStarred(design.id, true);
    await call(b, "PATCH", `/api/spaces/${space()}/designs/${design.id}/meta`, { token: other, body: { title: "Renamed there" } });
    const report = await run();
    expect(report.conflicts).toBe(0);
    expect(await getSummary(design.id)).toMatchObject({ starred: true, title: "Renamed there" });
    expect((await remote(design.id)).body.design).toMatchObject({ starred: true, title: "Renamed there" });
    // a detail is no edit of the content: the server still has revision 1
    expect((await remote(design.id)).body.rev).toBe(1);
  });

  it("keeps a rename made here while the details were being synced, and sends it next time", async () => {
    const design = await local("Shared");
    await run();
    await setStarred(design.id, true);
    await call(b, "PATCH", `/api/spaces/${space()}/designs/${design.id}/meta`, { token: other, body: { title: "Renamed there" } });
    // the person renames the design while the star is being sent, after the run has made its plan
    const during: typeof fetch = async (input, init) => {
      if (init?.method === "PATCH" && String(input).includes(`/designs/${design.id}/meta`)) await renameDesign(design.id, "Renamed meanwhile");
      return fetch(input, init);
    };
    await syncOnce({ fetch: during });
    expect(await getSummary(design.id)).toMatchObject({ starred: true, title: "Renamed meanwhile" });
    expect(await countWaiting()).toBe(1);
    await run();
    expect((await remote(design.id)).body.design).toMatchObject({ starred: true, title: "Renamed meanwhile" });
  });

  it("moves a design the other device deleted to the Trash, never deleting it", async () => {
    const design = await local("Deleted there");
    await run();
    await call(b, "DELETE", `/api/spaces/${space()}/designs/${design.id}`, { token: other });
    const report = await run();
    expect(report.trashed).toBe(1);
    const summary = await getSummary(design.id);
    expect(summary?.trashedAt).toBeGreaterThan(0);
    expect(summary?.space).toBeUndefined();
    expect(await getDesign(design.id)).not.toBeNull();
  });

  it("keeps a design edited here that the other device deleted, as a new design", async () => {
    const design = await local("Edited here, deleted there");
    await run();
    await edit(design.id, (d) => ({ ...d, title: "Edited here, deleted there", pages: [...d.pages, createPage()] }));
    await call(b, "DELETE", `/api/spaces/${space()}/designs/${design.id}`, { token: other });
    const report = await run();
    expect(report.forked).toBe(1);
    const kept = (await listDesigns()).find((d) => d.title === "Edited here, deleted there");
    expect(kept && kept.id !== design.id).toBe(true);
    expect((await remote(kept!.id)).body.design.pages).toHaveLength(2);
  });

  it("sends a deletion made here, and a design in the Trash is a detail", async () => {
    const design = await local("To go");
    await run();
    await moveToTrash(design.id);
    await run();
    expect((await remote(design.id)).body.design.trashedAt).toBeGreaterThan(0);
    await deleteForever(design.id);
    expect(await dbGet<SyncRecord>("sync", design.id)).toMatchObject({ tombstone: true });
    const report = await run();
    expect(report.deleted).toBe(1);
    expect((await remote(design.id)).body.code).toBe("deleted");
    expect(await dbGet<SyncRecord>("sync", design.id)).toBeUndefined();
  });

  it("keeps a deletion made while the design was being sent, and sends it, rather than taking the design back", async () => {
    const design = await local("Gone on the way");
    // the person deletes it for good while its upload is under way
    const during: typeof fetch = async (input, init) => {
      if (init?.method === "PUT" && String(input).includes(`/designs/${design.id}`)) await deleteForever(design.id);
      return fetch(input, init);
    };
    const first = await syncOnce({ fetch: during });
    expect(first?.pushed).toBe(1);
    expect(await dbGet<SyncRecord>("sync", design.id)).toMatchObject({ tombstone: true });
    const report = await run();
    expect(report.deleted).toBe(1);
    expect((await remote(design.id)).body.code).toBe("deleted");
    expect(await getSummary(design.id)).toBeNull();
  });
});

describe("a conflict", () => {
  it("keeps the server's design under its id, and the edit made here in the history and as a copy that is sent", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage(), createPage()] }));
    await call(b, "PUT", `/api/spaces/${space()}/designs/${design.id}`, { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage()] } } });
    const report = await run();
    expect(report.conflicts).toBe(1);
    expect((await getDesign(design.id))?.pages).toHaveLength(1);
    expect((await listVersions(design.id)).map((v) => v.label)).toContain("Before sync");
    const copy = (await listDesigns()).find((d) => d.title === "Poster (edited on Test laptop)");
    expect(copy?.space).toBe(space());
    expect((await remote(copy!.id)).body.design.pages).toHaveLength(3);
    expect(await countWaiting()).toBe(0);
  });

  it(`stops after ${MAX_CONFLICT_COPIES} copies in a run and says so`, async () => {
    const designs: Design[] = [];
    for (let i = 0; i < MAX_CONFLICT_COPIES + 2; i++) designs.push(await local(`Design ${i}`));
    await run();
    for (const design of designs) {
      await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
      await call(b, "PUT", `/api/spaces/${space()}/designs/${design.id}`, {
        token: other,
        body: { baseRev: 1, design: { ...design, title: design.title, pages: [createPage(), createPage(), createPage()] } },
      });
    }
    const report = await run();
    expect(report.conflicts).toBe(MAX_CONFLICT_COPIES);
    expect(report.stopped).toBe("conflicts");
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem" });
    expect(useSyncStatus.getState().problem).toContain(String(MAX_CONFLICT_COPIES));
    expect((await listDesigns()).filter((d) => d.title.includes("(edited on")).length).toBe(MAX_CONFLICT_COPIES);
  }, 120_000);
});

describe("a design open in the editor", () => {
  it("is left alone while it is open, and taken when it is closed", async () => {
    const design = await local("Open");
    await run();
    await call(b, "PUT", `/api/spaces/${space()}/designs/${design.id}`, {
      token: other,
      body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } },
    });
    const release = holdLock(designLock(design.id));
    const held = await run();
    expect(held.skipped).toBe(1);
    expect((await getDesign(design.id))?.pages).toHaveLength(1);
    release();
    await run();
    expect((await getDesign(design.id))?.pages).toHaveLength(3);
  });
});

describe("after editing live with the team", () => {
  it("marks the copy here in step only when its content is what the room had", async () => {
    const design = await local("Live");
    await run();
    const room = (await getDesign(design.id))!;
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    // an edit that did not reach the room stays to be sent
    expect(await markInStep(design.id, room)).toBe(false);
    expect(await countWaiting()).toBe(1);
    expect(await markInStep(design.id, (await getDesign(design.id))!)).toBe(true);
    expect(await countWaiting()).toBe(0);
  });
});

describe("a team", () => {
  it("brings the team's designs into the team's space, and a viewer sends nothing", async () => {
    const team = (await call(b, "POST", "/api/teams", { token: other, body: { name: "Studio" } })).body.team;
    const bob = await signUp(b, { name: "Bob" });
    const invite = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: other, body: { role: "viewer", uses: 1, hours: 1 } })).body;
    await call(b, "POST", "/api/invites/redeem", { token: bob.token, body: { code: invite.code } });
    const shared = createDesign({ title: "Team flyer", width: 100, height: 100 });
    await call(b, "PUT", `/api/spaces/${team.id}/designs/${shared.id}`, { token: other, body: { baseRev: null, design: shared } });

    await saveSession({ server: b.base, token: bob.token, user: bob.user, device: "Bob's laptop", teams: [], activeSpace: bob.user.id });
    await run();
    expect(useCloud.getState().session?.teams).toEqual([{ id: team.id, name: "Studio", role: "viewer" }]);
    const summary = await getSummary(shared.id);
    expect(summary?.space).toBe(team.id);
    // a viewer's edit here stays here: it is not sent, and is not counted as waiting
    await edit(shared.id, (d) => ({ ...d, pages: [] }));
    await run();
    expect((await remote(shared.id, other, team.id)).body.rev).toBe(1);
    expect(await countWaiting()).toBe(0);

    // removed from the team: the copy stays on this device, as a design of its own
    await call(b, "DELETE", `/api/teams/${team.id}/members/${bob.user.id}`, { token: other });
    await run();
    expect((await getSummary(shared.id))?.space).toBeUndefined();
  });
});

describe("a design here under the id of one of the server", () => {
  /** A design on this device only (a backup restored on a new device keeps the ids and drops the space), saved while signed out. */
  async function onlyHere(id: string, title: string, pages = 1): Promise<Design> {
    await saveSession(null);
    const design = { ...createDesign({ title, width: 300, height: 200, pages: Array.from({ length: pages }, () => createPage({ elements: [createShape("rect")] })) }), id };
    await saveDesign(design);
    await signedIn();
    return design;
  }

  it("keeps the design here under a new id and takes the server's, and the space's sync goes on", async () => {
    const id = "d_restored_from_backup";
    const theirs = createDesign({ title: "Server copy", width: 100, height: 100 });
    expect((await call(b, "PUT", `/api/spaces/${space()}/designs/${id}`, { token: other, body: { baseRev: null, design: { ...theirs, id } } })).status).toBe(201);
    await onlyHere(id, "Local copy", 2);

    const report = await run();
    expect(report.problems).toEqual([]);
    expect(await getSummary(id)).toMatchObject({ space: space(), title: "Server copy" });
    const kept = (await listDesigns()).find((d) => d.title === "Local copy");
    expect(kept && kept.id !== id).toBe(true);
    // the design here stays this device's own, with its content
    expect(kept?.space).toBeUndefined();
    expect((await getDesign(kept!.id))?.pages).toHaveLength(2);
    // the cursor moved on: the next run downloads nothing again
    expect(await metaGet<Record<string, number>>("cloudCursors", {})).toHaveProperty(space());
    expect(await run()).toMatchObject({ pulled: 0, problems: [] });
    expect(useSyncStatus.getState().state).toBe("synced");
  });

  it("takes the server's design in place of one here with the same content and title, without a copy", async () => {
    const id = "d_same_on_both";
    const mine = await onlyHere(id, "Same");
    expect((await call(b, "PUT", `/api/spaces/${space()}/designs/${id}`, { token: other, body: { baseRev: null, design: mine } })).status).toBe(201);
    const report = await run();
    expect(report).toMatchObject({ pulled: 1, forked: 0, problems: [] });
    expect((await listDesigns()).map((d) => [d.id, d.space])).toEqual([[id, space()]]);
    expect(await countWaiting()).toBe(0);
  });

  it("says so, rather than holding the space silently, when the design here is another space's on the server", async () => {
    const team = (await call(b, "POST", "/api/teams", { token: person.token, body: { name: "Studio" } })).body.team.id as string;
    const shared = createDesign({ title: "In the team", width: 100, height: 100 });
    await call(b, "PUT", `/api/spaces/${team}/designs/${shared.id}`, { token: other, body: { baseRev: null, design: shared } });
    await run();
    expect((await getSummary(shared.id))?.space).toBe(team);
    // the same id in the person's own space, sent by another device
    const put = await call(b, "PUT", `/api/spaces/${space()}/designs/${shared.id}`, {
      token: other,
      body: { baseRev: null, design: { ...shared, title: "Mine", pages: [createPage()] } },
    });
    expect(put.status).toBe(201);
    const report = await run();
    expect(report.problems.length).toBe(1);
    expect(useSyncStatus.getState().state).toBe("problem");
    expect(await getSummary(shared.id)).toMatchObject({ space: team, title: "In the team" });
  });
});

describe("leaving a team and joining it again", () => {
  it("forgets the team's cursor and folders, so that nothing of the team is deleted on the server and its designs come again", async () => {
    const owner = await signUp(b, { name: "Owner" });
    const team = (await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Studio" } })).body.team.id as string;
    expect((await call(b, "PUT", `/api/spaces/${team}/folders/f_team_1`, { token: owner.token, body: { name: "Brand", parentId: null } })).status).toBe(201);
    const shared = createDesign({ title: "Team flyer", width: 100, height: 100 });
    await call(b, "PUT", `/api/spaces/${team}/designs/${shared.id}`, { token: owner.token, body: { baseRev: null, design: shared } });
    const invite = async () => (await call(b, "POST", `/api/teams/${team}/invites`, { token: owner.token, body: { role: "editor", uses: 1, hours: 1 } })).body.code;
    expect((await call(b, "POST", "/api/invites/redeem", { token: person.token, body: { code: await invite() } })).status).toBe(200);
    await run();
    expect((await listFolders()).find((f) => f.id === "f_team_1")?.space).toBe(team);

    expect((await call(b, "DELETE", `/api/teams/${team}/members/${person.user.id}`, { token: owner.token })).status).toBe(200);
    await run();
    expect(await metaGet<Record<string, number>>("cloudCursors", {})).not.toHaveProperty(team);
    expect(await metaGet<Record<string, unknown>>("cloudFolders", {})).not.toHaveProperty(team);

    expect((await call(b, "POST", "/api/invites/redeem", { token: person.token, body: { code: await invite() } })).status).toBe(200);
    await run();
    const feed = await call(b, "GET", `/api/spaces/${team}/changes?since=0`, { token: owner.token });
    expect(feed.body.folders.map((f: { id: string; deletedAt: number | null }) => [f.id, f.deletedAt])).toEqual([["f_team_1", null]]);
    // the team's design is the team's here again (the copy kept on leaving had the same content and title)
    expect((await getSummary(shared.id))?.space).toBe(team);
  });
});

describe("signing in and out", () => {
  it("removes the account's designs and keeps the ones that were never moved in", async () => {
    await saveSession(null);
    const mine = await local("Only here");
    await signInAccount(b.base, person.email, PASSWORD);
    stopSync();
    const synced = await local("In the account");
    await run();
    expect((await getSummary(synced.id))?.space).toBe(space());
    await signOutAccount({ keepCopies: false });
    expect(useCloud.getState().session).toBeNull();
    const left = await listDesigns();
    expect(left.map((d) => d.id)).toEqual([mine.id]);
    expect(await dbGetAll("sync")).toEqual([]);
    expect((await remote(synced.id)).status).toBe(200);
  });

  it("keeps copies on the device when asked, as designs of this device only", async () => {
    const synced = await local("Kept");
    await createFolder("Folder");
    await run();
    await signOutAccount({ keepCopies: true });
    expect((await getSummary(synced.id))?.space).toBeUndefined();
    expect((await listFolders()).every((f) => !f.space)).toBe(true);
  });

  it("keeps a design whose edit could not be sent (open in an editor) as a design of this device, when the account's are removed", async () => {
    const sent = await local("Sent");
    const open = await local("Open with an edit");
    await run();
    await edit(open.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    // the editor has it: sync leaves it alone, so the edit is still here only when the dialog signs out
    const release = holdLock(designLock(open.id));
    try {
      expect(await signOutAccount({ keepCopies: false })).toEqual({ kept: 1 });
    } finally {
      release();
    }
    expect(useCloud.getState().session).toBeNull();
    expect(await getSummary(sent.id)).toBeNull();
    expect(await getSummary(open.id)).toMatchObject({ title: "Open with an edit" });
    expect((await getSummary(open.id))?.space).toBeUndefined();
    expect((await getDesign(open.id))?.pages).toHaveLength(2);
  });

  it("fetches the uploads a design of the server uses, checked as an upload", async () => {
    const made = createDesign({ title: "Picture there", width: 100, height: 100 });
    const assetId = "a_from_phone";
    await call(b, "PUT", `/api/spaces/${space()}/assets/${assetId}`, { token: other, body: { mime: "image/png", base64: PNG } });
    made.pages = [createPage({ elements: [createImage({ src: `asset:${assetId}` })] })];
    await call(b, "PUT", `/api/spaces/${space()}/designs/${made.id}`, { token: other, body: { baseRev: null, design: made } });
    await run();
    const asset = await getAsset(assetId);
    expect(asset?.mime).toBe("image/png");
    expect((await listAssets()).find((a) => a.id === assetId)?.space).toBe(space());
  });
});

describe("when the server cannot be reached", () => {
  it("says offline with what waits, and sends it when the server is back", async () => {
    const design = await local("Waiting");
    const base = b.base;
    await saveSession({ server: "http://127.0.0.1:9", token: person.token, user: person.user, device: "Test laptop", teams: [], activeSpace: person.user.id });
    await expect(syncOnce()).rejects.toThrow();
    expect(useSyncStatus.getState()).toMatchObject({ state: "offline", waiting: 1 });
    await saveSession({ server: base, token: person.token, user: person.user, device: "Test laptop", teams: [], activeSpace: person.user.id });
    await run();
    expect((await remote(design.id)).status).toBe(200);
  });

  it("says to sign in again when the session was ended elsewhere, and keeps everything", async () => {
    const design = await local("Still here");
    await call(b, "POST", "/api/auth/signout", { token: person.token });
    const report = await run();
    expect(report.stopped).toBe("session");
    expect(useSyncStatus.getState().state).toBe("problem");
    expect(await getSummary(design.id)).not.toBeNull();
  });
});

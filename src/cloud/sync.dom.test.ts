/**
 * The sync engine against a real account server on a port of its own (src/server/accounts/testServer.ts), with the library in a
 * fake IndexedDB. "The other device" is the same person signed in a second time, talking to the server directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "@/i18n";
import { addAssetFromFile, getAsset, listAssets, prepareAssetFromFile } from "@/core/assets";
import { createDesign, createImage, createPage, createShape, createVideo } from "@/core/factory";
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
  deleteFolder,
  getDesignForEditing,
  saveVersion,
} from "@/core/library";
import { dbGet, dbGetAll, dbPut, metaGet } from "@/core/persistence";
import type { Design, DesignSummary, SyncRecord } from "@/core/types";
import { boot, call, closeAll, PASSWORD, PNG, signUp, type Booted } from "@/server/accounts/testServer";
import { wipeDatabase } from "@/test/logicDb";
import { moveIntoAccount, redeemInvite, signOutAccount, signInAccount } from "./account";
import { CloudError, cloudErrorText } from "./api";
import { designLock, holdLock, SYNC_LOCK } from "./locks";
import { saveSession, useCloud, type CloudSession } from "./state";
import { countWaiting, keepAsCopy, markInStep, MAX_CONFLICT_COPIES, requestSync, sendOne, startSync, stopSync, syncNow, syncOnce, waitingDesigns } from "./sync";
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

const run = async (options: Parameters<typeof syncOnce>[0] = {}) => {
  const report = await syncOnce(options);
  if (!report) throw new Error("sync did not run");
  return report;
};

/** Where a design of a space is on the server. */
const designAt = (id: string, sp = space()) => `/api/spaces/${sp}/designs/${id}`;

/**
 * What the server answers in place of the real one: a status and a JSON body, no answer at all (the connection drops), or the real
 * answer changed into something else (a function of its JSON).
 */
type Instead = { status: number; body?: unknown } | "unreachable" | ((real: Record<string, unknown>) => unknown);

/**
 * A fetch that goes to the real server, but for the requests that `instead` gives an answer for, which it answers itself: as a
 * server would that refuses them, answers in another shape, or cannot be reached. `instead` may also do something first (an edit
 * made on this device while the request is under way) and give no answer. `seen` lists every request as "METHOD /path".
 */
function serverThat(instead: (method: string, path: string) => Instead | undefined | Promise<Instead | undefined>) {
  const seen: string[] = [];
  const bodies = new Map<string, unknown>();
  const fake: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(input)).pathname;
    seen.push(`${method} ${path}`);
    if (typeof init?.body === "string") bodies.set(`${method} ${path}`, JSON.parse(init.body));
    const answer = await instead(method, path);
    if (answer === undefined) return fetch(input, init);
    if (answer === "unreachable") throw new TypeError("fetch failed");
    if (typeof answer === "function") {
      const real = await fetch(input, init);
      return new Response(JSON.stringify(answer(await real.json())), { status: real.status });
    }
    return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
  };
  return { fetch: fake, seen, bodies };
}

/** A picture added on this device, stored with its bytes (the fake database cannot keep a Blob, as WebKit stores it). */
async function localPicture() {
  const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  const asset = await addAssetFromFile(new File([bytes], "dot.png", { type: "image/png" }));
  await dbPut("assets", { ...asset, blob: { bytes: bytes.buffer, type: "image/png" } });
  return asset;
}

/** A design the other device made in the person's space. */
async function fromThePhone(title: string, extra: Partial<Design> = {}): Promise<Design> {
  const made = { ...createDesign({ title, width: 100, height: 100 }), ...extra };
  expect((await call(b, "PUT", designAt(made.id), { token: other, body: { baseRev: null, design: made } })).status).toBe(201);
  return made;
}

/** The ids of the folders the server has in the person's space, with what it knows of them. */
async function foldersThere(): Promise<Array<{ id: string; parentId: string | null; deletedAt: number | null }>> {
  return (await call(b, "GET", `/api/spaces/${space()}/changes?since=0`, { token: other })).body.folders;
}

/**
 * A team that another person owns, with the person of these tests in it as `role`, and one design of the team's, which this
 * device has taken.
 */
async function inTeam(role: "editor" | "viewer") {
  const owner = await signUp(b, { name: "Owner" });
  const team = (await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Studio" } })).body.team.id as string;
  const code = (await call(b, "POST", `/api/teams/${team}/invites`, { token: owner.token, body: { role, uses: 1, hours: 1 } })).body.code;
  expect((await call(b, "POST", "/api/invites/redeem", { token: person.token, body: { code } })).status).toBe(200);
  const shared = createDesign({ title: "Team flyer", width: 100, height: 100, pages: [createPage({ elements: [createShape("rect")] })] });
  expect((await call(b, "PUT", designAt(shared.id, team), { token: owner.token, body: { baseRev: null, design: shared } })).status).toBe(201);
  await run();
  expect((await getSummary(shared.id))?.space).toBe(team);
  return { team, owner: owner.token, shared };
}

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

  it("never marks in step a design the server never had, even when its content is the room's", async () => {
    const design = await local("Never sent");
    expect(await markInStep(design.id, (await getDesign(design.id))!)).toBe(false);
    expect(await markInStep("d_not_here", design)).toBe(false);
    expect(await countWaiting()).toBe(1);
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

  it("leaves the design here alone while an editor has it open, and gives it a new id once it is closed", async () => {
    const id = "d_open_while_claimed";
    await call(b, "PUT", designAt(id), { token: other, body: { baseRev: null, design: { ...createDesign({ title: "Server copy", width: 100, height: 100 }), id } } });
    await onlyHere(id, "Local copy", 2);
    const release = holdLock(designLock(id));
    const held = await run();
    expect(held).toMatchObject({ skipped: 1, pulled: 0, forked: 0 });
    expect(await getSummary(id)).toMatchObject({ title: "Local copy" });
    expect((await getSummary(id))?.space).toBeUndefined();
    release();
    // the feed was kept where it was: the next run looks at the design again
    expect(await run()).toMatchObject({ pulled: 1, forked: 1 });
    expect(await getSummary(id)).toMatchObject({ title: "Server copy", space: space() });
    expect((await listDesigns()).find((d) => d.title === "Local copy")?.id).not.toBe(id);
  });

  it("keeps the design here, and says why, when the server's under its id is from a newer Craftly", async () => {
    const id = "d_claimed_from_the_future";
    await call(b, "PUT", designAt(id), { token: other, body: { baseRev: null, design: { ...createDesign({ title: "Server copy", width: 100, height: 100 }), id } } });
    await onlyHere(id, "Local copy");
    const future = serverThat((method, path) =>
      method === "GET" && path === designAt(id) ? (real) => ({ ...real, design: { ...(real.design as object), version: 99 } }) : undefined,
    );
    const report = await run({ fetch: future.fetch });
    expect(report.problems).toEqual([m.cloud.sync.newer]);
    expect(await getSummary(id)).toMatchObject({ title: "Local copy" });
    expect((await getSummary(id))?.space).toBeUndefined();
  });

  it("keeps the design here, and says the answer could not be used, when the server's under its id is nonsense", async () => {
    const id = "d_claimed_nonsense";
    await call(b, "PUT", designAt(id), { token: other, body: { baseRev: null, design: { ...createDesign({ title: "Server copy", width: 100, height: 100 }), id } } });
    await onlyHere(id, "Local copy");
    const nonsense = serverThat((method, path) => (method === "GET" && path === designAt(id) ? { status: 200, body: { rev: 1, design: { id: "d_another" } } } : undefined));
    const report = await run({ fetch: nonsense.fetch });
    expect(report.problems).toEqual([m.cloud.errors["bad-answer"]]);
    expect(await getSummary(id)).toMatchObject({ title: "Local copy" });
    // and it is taken once the server answers properly
    expect(await run()).toMatchObject({ pulled: 1, forked: 1, problems: [] });
  });

  it("stops the run when the server fails while the design under the id is downloaded, and changes nothing here", async () => {
    const id = "d_claimed_while_failing";
    await call(b, "PUT", designAt(id), { token: other, body: { baseRev: null, design: { ...createDesign({ title: "Server copy", width: 100, height: 100 }), id } } });
    await onlyHere(id, "Local copy");
    const failing = serverThat((method, path) => (method === "GET" && path === designAt(id) ? { status: 503, body: { code: "busy" } } : undefined));
    await expect(syncOnce({ fetch: failing.fetch })).rejects.toMatchObject({ code: "busy" });
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.errors.busy });
    expect(await getSummary(id)).toMatchObject({ title: "Local copy" });
  });

  it("goes on without the server's design when it was deleted between the feed and the download", async () => {
    const id = "d_claimed_then_deleted";
    await call(b, "PUT", designAt(id), { token: other, body: { baseRev: null, design: { ...createDesign({ title: "Server copy", width: 100, height: 100 }), id } } });
    await onlyHere(id, "Local copy");
    const gone = serverThat((method, path) => (method === "GET" && path === designAt(id) ? { status: 404, body: { code: "not-found" } } : undefined));
    const report = await run({ fetch: gone.fetch });
    expect(report).toMatchObject({ pulled: 0, forked: 0, problems: [] });
    expect(await getSummary(id)).toMatchObject({ title: "Local copy" });
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

  it("keeps the folders of a design whose edit was not sent, and their parents, and removes the account's other folders, versions and uploads", async () => {
    const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    const upload = async (id: string) => {
      const asset = await prepareAssetFromFile(new File([bytes], "dot.png", { type: "image/png" }), id);
      // (stored with its bytes: the fake database cannot keep a Blob)
      await dbPut("assets", { ...asset, space: space(), blob: { bytes: bytes.buffer, type: "image/png" } });
      return asset.id;
    };
    const keptPicture = await upload("a_of_the_kept_design");
    const gonePicture = await upload("a_of_the_sent_design");
    const parent = await createFolder("Parent");
    const child = await createFolder("Child", parent.id);
    const elsewhere = await createFolder("Elsewhere");
    const ownFolder = { id: "f_of_this_device", name: "Of this device", parentId: null, createdAt: Date.now() };
    await dbPut("folders", ownFolder);
    const picture = (id: string) => [createPage({ elements: [createImage({ src: `asset:${id}` })] })];
    const open = await local("Open with an edit", { folderId: child.id, pages: picture(keptPicture) });
    const sent = await local("Sent", { folderId: elsewhere.id, pages: picture(gonePicture) });
    expect((await run()).pushed).toBe(2);
    await saveVersion((await getDesign(sent.id))!, "A version");
    await edit(open.id, (d) => ({ ...d, title: "Open with an edit", pages: [...d.pages, createPage()] }));
    const release = holdLock(designLock(open.id));
    try {
      expect(await signOutAccount({ keepCopies: false })).toEqual({ kept: 1 });
    } finally {
      release();
    }
    const folders = await listFolders();
    expect(folders.map((f) => [f.id, f.space]).sort()).toEqual(
      [
        [child.id, undefined],
        [parent.id, undefined],
        [ownFolder.id, undefined],
      ].sort(),
    );
    expect(await getSummary(sent.id)).toBeNull();
    expect(await listVersions(sent.id)).toEqual([]);
    expect((await getAsset(keptPicture))?.space).toBeUndefined();
    expect(await getAsset(keptPicture)).not.toBeNull();
    expect(await getAsset(gonePicture)).toBeNull();
    expect(await metaGet("cloudCursors", null)).toEqual({});
  });

  it("signs nobody out while nobody is signed in, and moves nothing in", async () => {
    await saveSession(null);
    const mine = await local("Only here");
    expect(await signOutAccount({ keepCopies: false })).toEqual({ kept: 0 });
    await moveIntoAccount([mine.id]);
    expect((await getSummary(mine.id))?.space).toBeUndefined();
    await expect(redeemInvite("ABCD-EFGH")).rejects.toMatchObject({ code: "session" });
    await signedIn();
    await moveIntoAccount([]);
    expect((await getSummary(mine.id))?.space).toBeUndefined();
    stopSync();
  });

  it("moves the folders of a design into the account with it, up to a folder that is in the account already", async () => {
    const inAccount = await createFolder("In the account");
    await saveSession(null);
    // a folder of this device only inside one of the account (a folder made while signed out, moved there)
    const outer = "f_outer_here";
    await dbPut("folders", { id: outer, name: "Outer", parentId: inAccount.id, createdAt: Date.now() });
    const inner = await createFolder("Inner", outer);
    const lost = await local("In a folder that is gone", { folderId: "f_not_here" });
    const nested = await local("Nested", { folderId: inner.id });
    const leftAlone = await local("Not asked for");
    await signedIn();
    await moveIntoAccount([nested.id, lost.id]);
    expect((await getSummary(leftAlone.id))?.space).toBeUndefined();
    stopSync();
    const folders = new Map((await listFolders()).map((f) => [f.id, f]));
    expect(folders.get(inner.id)?.space).toBe(space());
    expect(folders.get(outer)?.space).toBe(space());
    expect(folders.get(inAccount.id)?.space).toBe(space());
    expect((await getSummary(nested.id))?.space).toBe(space());
    expect((await getSummary(lost.id))?.space).toBe(space());
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

describe("a server that refuses a design that is sent", () => {
  const refusing = (id: string, status: number, body: unknown) => serverThat((method, path) => (method === "PUT" && path === designAt(id) ? { status, body } : undefined));

  it("waits, and says it waits for the room, when the server has the design open live", async () => {
    const design = await local("Open live there");
    const report = await run({ fetch: refusing(design.id, 409, { code: "live" }).fetch });
    expect(report).toMatchObject({ pushed: 0, live: 1, skipped: 1, problems: [] });
    expect(useSyncStatus.getState()).toMatchObject({ state: "live", problem: null, waiting: 1 });
    expect((await remote(design.id)).status).not.toBe(200);
    // the room is done with it: the next run sends it, and then it is in step
    expect((await run()).pushed).toBe(1);
    expect(useSyncStatus.getState()).toMatchObject({ state: "synced", waiting: 0 });
  });

  it("stops sending to a space that is full, says so, and keeps everything waiting", async () => {
    await local("First");
    await local("Second");
    const full = serverThat((method, path) => (method === "PUT" && path.includes("/designs/") ? { status: 413, body: { code: "quota" } } : undefined));
    const report = await run({ fetch: full.fetch });
    // the second design is not even tried
    expect(full.seen.filter((r) => r.startsWith("PUT ") && r.includes("/designs/"))).toHaveLength(1);
    expect(report).toMatchObject({ pushed: 0, problems: [m.cloud.sync.full] });
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.sync.full, waiting: 2 });
  });

  it("sends nothing and says nothing when the server forbids the change, and the design still waits", async () => {
    const design = await local("Forbidden");
    const report = await run({ fetch: refusing(design.id, 403, { code: "forbidden" }).fetch });
    expect(report).toMatchObject({ pushed: 0, problems: [] });
    expect(await countWaiting()).toBe(1);
    expect((await remote(design.id)).status).not.toBe(200);
  });

  it("says a design was refused for a refusal it does not know, and still sends the others", async () => {
    const odd = await local("Odd one");
    const fine = await local("Fine");
    const report = await run({ fetch: refusing(odd.id, 422, { code: "too-strange" }).fetch });
    expect(report.pushed).toBe(1);
    expect(report.problems).toEqual([m.cloud.sync.refused("Odd one")]);
    expect((await remote(fine.id)).status).toBe(200);
    expect(await waitingDesigns()).toEqual(new Set([odd.id]));
  });

  it("takes an answer to an upload without a revision as a bad answer, for that design only, and sends it again next run", async () => {
    const odd = await local("Answered oddly");
    const fine = await local("Fine");
    const report = await run({ fetch: refusing(odd.id, 200, { saved: "yes" }).fetch });
    expect(report.pushed).toBe(1);
    expect(report.problems).toEqual([m.cloud.errors["bad-answer"]]);
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.errors["bad-answer"] });
    expect((await remote(fine.id)).status).toBe(200);
    expect((await run()).pushed).toBe(1);
    expect((await remote(odd.id)).status).toBe(200);
  });

  it("does not send a design the server would refuse (a picture from the web), and says so", async () => {
    const design = await local("From the web", { pages: [createPage({ elements: [createImage({ src: "https://example.org/picture.png" })] })] });
    const watched = serverThat(() => undefined);
    const report = await run({ fetch: watched.fetch });
    expect(report.problems).toEqual([m.cloud.sync.refused("From the web")]);
    expect(watched.seen).not.toContain(`PUT ${designAt(design.id)}`);
  });

  it("sends the thumbnail with a design only when it is a PNG or JPEG data address", async () => {
    const png = await local("With a PNG");
    await saveDesign(png, `data:image/png;base64,${PNG}`);
    const svg = await local("With an SVG");
    await saveDesign(svg, "data:image/svg+xml;base64,PHN2Zy8+");
    const watched = serverThat(() => undefined);
    await run({ fetch: watched.fetch });
    expect(watched.bodies.get(`PUT ${designAt(png.id)}`)).toHaveProperty("thumbnail", `data:image/png;base64,${PNG}`);
    expect(watched.bodies.get(`PUT ${designAt(svg.id)}`)).not.toHaveProperty("thumbnail");
  });

  it.each([
    ["rate", 429],
    ["busy", 503],
    ["server", 500],
  ] as const)("stops the run when the server answers %s while a design is sent, says so, and the design still waits", async (code, status) => {
    const design = await local("Stopped");
    await expect(syncOnce({ fetch: refusing(design.id, status, { code }).fetch })).rejects.toMatchObject({ code });
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.errors[code], waiting: 1 });
  });

  it("says offline when the connection drops while a design is sent, and sends it once the server is back", async () => {
    const design = await local("Dropped");
    const dropping = serverThat((method, path) => (method === "PUT" && path === designAt(design.id) ? "unreachable" : undefined));
    await expect(syncOnce({ fetch: dropping.fetch })).rejects.toMatchObject({ code: "offline" });
    expect(useSyncStatus.getState()).toMatchObject({ state: "offline", problem: null, waiting: 1 });
    expect((await run()).pushed).toBe(1);
    expect((await remote(design.id)).status).toBe(200);
  });

  it("stops and asks to sign in again when the session ends while a design is sent", async () => {
    const design = await local("Signed out meanwhile");
    const report = await run({ fetch: refusing(design.id, 401, { code: "session" }).fetch });
    expect(report.stopped).toBe("session");
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.sync.signInAgain, waiting: 1 });
  });
});

describe("a conflict found while sending", () => {
  it("keeps the edit here as a copy when the other device's edit reaches the server after the feed was read", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    // the other device sends its edit just after this run has read the feed: the plan says push, the server says conflict
    const late = serverThat(async (method, path) => {
      if (method === "GET" && path.endsWith("/changes"))
        await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } } });
      return undefined;
    });
    const report = await run({ fetch: late.fetch });
    expect(report.conflicts).toBe(1);
    expect((await getDesign(design.id))?.pages).toHaveLength(3);
    const copy = (await listDesigns()).find((d) => d.title === "Poster (edited on Test laptop)");
    expect((await remote(copy!.id)).body.design.pages).toHaveLength(2);
    expect(await countWaiting()).toBe(0);
  });

  it("keeps the edit here as a copy all the same when the server says conflict without its revision", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    const vague = serverThat((method, path) => (method === "PUT" && path === designAt(design.id) ? { status: 409, body: { code: "conflict" } } : undefined));
    const report = await run({ fetch: vague.fetch });
    expect(report.conflicts).toBe(1);
    expect((await getDesign(design.id))?.pages).toHaveLength(1);
    expect((await listVersions(design.id)).map((v) => v.label)).toContain("Before sync");
    expect((await listDesigns()).some((d) => d.title === "Poster (edited on Test laptop)")).toBe(true);
  });

  it("leaves the design for the next run when the server gives an older design than the conflict said", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    const ahead = serverThat((method, path) => (method === "PUT" && path === designAt(design.id) ? { status: 409, body: { code: "conflict", rev: 7 } } : undefined));
    const report = await run({ fetch: ahead.fetch });
    expect(report).toMatchObject({ conflicts: 0, pushed: 0, problems: [] });
    expect((await getDesign(design.id))?.pages).toHaveLength(2);
    expect(await countWaiting()).toBe(1);
    expect((await listDesigns()).some((d) => d.title.includes("(edited on"))).toBe(false);
  });

  it("takes the server's revision without a copy when both sides made the same edit", async () => {
    const design = await local("Same edit");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    const edited = (await getDesign(design.id))!;
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: edited } });
    const report = await run();
    expect(report).toMatchObject({ conflicts: 0, pulled: 1 });
    expect((await listDesigns()).some((d) => d.title.includes("(edited on"))).toBe(false);
    expect((await listVersions(design.id)).map((v) => v.label)).not.toContain("Before sync");
    expect(await countWaiting()).toBe(0);
  });

  it("keeps the edit here as a new design when the other device deletes the design while the conflict is looked at", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } } });
    const deleting = serverThat(async (method, path) => {
      if (method === "GET" && path === designAt(design.id)) await call(b, "DELETE", designAt(design.id), { token: other });
      return undefined;
    });
    const report = await run({ fetch: deleting.fetch });
    expect(report).toMatchObject({ conflicts: 0, forked: 1 });
    expect(await getSummary(design.id)).toBeNull();
    const kept = (await listDesigns()).find((d) => d.title === "Poster");
    expect((await remote(kept!.id)).body.design.pages).toHaveLength(2);
  });

  it("says the server's design is from a newer Craftly, and keeps the edit here, in a conflict", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } } });
    const future = serverThat((method, path) =>
      method === "GET" && path === designAt(design.id) ? (real) => ({ ...real, design: { ...(real.design as object), version: 99 } }) : undefined,
    );
    const report = await run({ fetch: future.fetch });
    expect(report).toMatchObject({ conflicts: 0, problems: [m.cloud.sync.newer] });
    expect((await getDesign(design.id))?.pages).toHaveLength(2);
  });

  it("gives a design edited here that the other device deleted a new id, and its saved versions go with it", async () => {
    const design = await local("With history");
    await run();
    await saveVersion((await getDesign(design.id))!, "A version");
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    await call(b, "DELETE", designAt(design.id), { token: other });
    expect((await run()).forked).toBe(1);
    const kept = (await listDesigns()).find((d) => d.title === "With history")!;
    expect(kept.id).not.toBe(design.id);
    expect(await listVersions(design.id)).toEqual([]);
    expect((await listVersions(kept.id)).map((v) => v.label)).toEqual(["A version"]);
  });
});

describe("taking designs from a server that answers unexpectedly", () => {
  it("says a design is from a newer Craftly and leaves it on the server", async () => {
    const made = await fromThePhone("From the future");
    const future = serverThat((method, path) =>
      method === "GET" && path === designAt(made.id) ? (real) => ({ ...real, design: { ...(real.design as object), version: 99 } }) : undefined,
    );
    const report = await run({ fetch: future.fetch });
    expect(report).toMatchObject({ pulled: 0, problems: [m.cloud.sync.newer] });
    expect(await getSummary(made.id)).toBeNull();
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.sync.newer });
  });

  it.each([
    ["not-found", 404],
    ["deleted", 410],
  ] as const)("goes on without a design the server answers %s for between the feed and the download", async (code, status) => {
    const made = await fromThePhone("Gone meanwhile");
    const gone = serverThat((method, path) => (method === "GET" && path === designAt(made.id) ? { status, body: { code } } : undefined));
    const report = await run({ fetch: gone.fetch });
    expect(report).toMatchObject({ pulled: 0, problems: [] });
    expect(await getSummary(made.id)).toBeNull();
  });

  it("says what was wrong with a design the server answers nonsense for, takes the others, and takes it next run", async () => {
    const odd = await fromThePhone("Odd one");
    const fine = await fromThePhone("Fine");
    const nonsense = serverThat((method, path) => (method === "GET" && path === designAt(odd.id) ? { status: 200, body: { rev: 1, design: { id: fine.id } } } : undefined));
    const report = await run({ fetch: nonsense.fetch });
    expect(report).toMatchObject({ pulled: 1, problems: [m.cloud.errors["bad-answer"]] });
    expect(await getSummary(odd.id)).toBeNull();
    expect(await getSummary(fine.id)).not.toBeNull();
    // the cursor stayed where it was: the feed is read again, and the design is taken
    expect(await run()).toMatchObject({ pulled: 1, problems: [] });
    expect(await getSummary(odd.id)).toMatchObject({ title: "Odd one", space: space() });
  });

  it("keeps a design whose picture the server does not have, and says the picture is missing", async () => {
    const made = await fromThePhone("Picture missing", { pages: [createPage({ elements: [createImage({ src: "asset:a_never_sent" })] })] });
    const report = await run();
    expect(report).toMatchObject({ pulled: 1, problems: [m.cloud.sync.uploadFailed] });
    expect(await getSummary(made.id)).not.toBeNull();
    expect(await getAsset("a_never_sent")).toBeNull();
  });

  it("stops as offline when the connection drops while a picture is fetched, and takes the design once the server is back", async () => {
    await call(b, "PUT", `/api/spaces/${space()}/assets/a_dropped`, { token: other, body: { mime: "image/png", base64: PNG } });
    const made = await fromThePhone("Picture dropped", { pages: [createPage({ elements: [createImage({ src: "asset:a_dropped" })] })] });
    const dropping = serverThat((method, path) => (method === "GET" && path.endsWith("/assets/a_dropped") ? "unreachable" : undefined));
    await expect(syncOnce({ fetch: dropping.fetch })).rejects.toMatchObject({ code: "offline" });
    expect(useSyncStatus.getState().state).toBe("offline");
    expect(await getSummary(made.id)).toBeNull();
    expect((await run()).pulled).toBe(1);
    expect((await getAsset("a_dropped"))?.mime).toBe("image/png");
  });

  it("does not fetch again a picture that is already here", async () => {
    await call(b, "PUT", `/api/spaces/${space()}/assets/a_once`, { token: other, body: { mime: "image/png", base64: PNG } });
    const pages = [createPage({ elements: [createImage({ src: "asset:a_once" })] })];
    const made = await fromThePhone("Picture once", { pages });
    await run();
    expect(await getAsset("a_once")).not.toBeNull();
    await call(b, "PUT", designAt(made.id), { token: other, body: { baseRev: 1, design: { ...made, pages: [...pages, createPage()] } } });
    const watched = serverThat(() => undefined);
    expect((await run({ fetch: watched.fetch })).pulled).toBe(1);
    expect(watched.seen.filter((r) => r.includes("/assets/"))).toEqual([]);
    expect((await getDesign(made.id))?.pages).toHaveLength(2);
  });
});

describe("sending the pictures of a design", () => {
  it("sends a design whose picture is not on this device without it", async () => {
    const design = await local("Picture lost here", { pages: [createPage({ elements: [createImage({ src: "asset:a_lost_here" })] })] });
    const watched = serverThat(() => undefined);
    expect((await run({ fetch: watched.fetch })).pushed).toBe(1);
    expect(watched.seen.filter((r) => r.startsWith("PUT ") && r.includes("/assets/"))).toEqual([]);
    expect((await remote(design.id)).status).toBe(200);
  });

  it.each([
    ["exists", 409],
    ["bad-request", 400],
  ] as const)("sends the design without a picture the server answers %s for", async (code, status) => {
    const asset = await localPicture();
    const design = await local("Picture refused", { pages: [createPage({ elements: [createImage({ src: `asset:${asset.id}` })] })] });
    const refusing = serverThat((method, path) => (method === "PUT" && path.endsWith(`/assets/${asset.id}`) ? { status, body: { code } } : undefined));
    const report = await run({ fetch: refusing.fetch });
    expect(report).toMatchObject({ pushed: 1, problems: [] });
    expect((await remote(design.id)).status).toBe(200);
    expect((await call(b, "GET", `/api/spaces/${space()}/assets/${asset.id}`, { token: other })).status).not.toBe(200);
  });

  it("stops the run when the server fails while a picture is sent, and sends neither until it can", async () => {
    const asset = await localPicture();
    const design = await local("Picture failed", { pages: [createPage({ elements: [createImage({ src: `asset:${asset.id}` })] })] });
    const failing = serverThat((method, path) => (method === "PUT" && path.endsWith(`/assets/${asset.id}`) ? { status: 500, body: { code: "server" } } : undefined));
    await expect(syncOnce({ fetch: failing.fetch })).rejects.toMatchObject({ code: "server" });
    expect((await remote(design.id)).status).not.toBe(200);
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.errors.server, waiting: 1 });
    expect((await run()).pushed).toBe(1);
    expect((await call(b, "GET", `/api/spaces/${space()}/assets/${asset.id}`, { token: other })).status).toBe(200);
  });

  it("sends the picture of a design and never its clip, which stays on this device", async () => {
    const asset = await localPicture();
    const elements = [createImage({ src: `asset:${asset.id}` }), createVideo({ src: "asset:a_clip_here" })];
    const design = await local("Picture and clip", { pages: [createPage({ elements })] });
    const watched = serverThat(() => undefined);
    expect(await run({ fetch: watched.fetch })).toMatchObject({ pushed: 1, problems: [] });
    // the server is asked only whether it has the picture, and only the picture is sent
    expect(watched.bodies.get(`POST /api/spaces/${space()}/assets/missing`)).toEqual({ ids: [asset.id] });
    expect(watched.seen.filter((r) => r.includes("/assets/") && !r.endsWith("/missing"))).toEqual([`PUT /api/spaces/${space()}/assets/${asset.id}`]);
    // the design itself goes with its video element in it
    expect((await remote(design.id)).body.design.pages[0].elements[1]).toMatchObject({ type: "video", src: "asset:a_clip_here" });
  });

  it("fetches the picture of a design from the server and never asks for its clip", async () => {
    await call(b, "PUT", `/api/spaces/${space()}/assets/a_pic_there`, { token: other, body: { mime: "image/png", base64: PNG } });
    const elements = [createImage({ src: "asset:a_pic_there" }), createVideo({ src: "asset:a_clip_there" })];
    const made = await fromThePhone("Picture and clip there", { pages: [createPage({ elements })] });
    const watched = serverThat(() => undefined);
    // a clip that is not here is no missing upload: nothing is said about it
    expect(await run({ fetch: watched.fetch })).toMatchObject({ pulled: 1, problems: [] });
    expect(watched.seen.filter((r) => r.includes("/assets/"))).toEqual([`GET /api/spaces/${space()}/assets/a_pic_there`]);
    expect((await getAsset("a_pic_there"))?.mime).toBe("image/png");
    expect(await getAsset("a_clip_there")).toBeNull();
    expect(await getSummary(made.id)).not.toBeNull();
  });
});

describe("a design that changes here while the server's is downloaded", () => {
  it("keeps an edit made here meanwhile, and makes it a conflict in the next run rather than writing over it", async () => {
    const design = await local("Busy");
    await run();
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } } });
    let edited = false;
    const meanwhile = serverThat(async (method, path) => {
      if (method === "GET" && path === designAt(design.id) && !edited) {
        edited = true;
        await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
      }
      return undefined;
    });
    const report = await run({ fetch: meanwhile.fetch });
    expect(report.pulled).toBe(0);
    expect((await getDesign(design.id))?.pages).toHaveLength(2);
    // the feed was kept: the next run finds both sides changed
    expect((await run()).conflicts).toBe(1);
    expect((await getDesign(design.id))?.pages).toHaveLength(3);
    const copy = (await listDesigns()).find((d) => d.title === "Busy (edited on Test laptop)");
    expect((await getDesign(copy!.id))?.pages).toHaveLength(2);
  });

  it("never writes over a design that became this device's own meanwhile, and says so", async () => {
    const design = await local("Kept here");
    await run();
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } } });
    // another tab signs out keeping copies while the design is downloaded: the design here is this device's own, same revision
    const meanwhile = serverThat(async (method, path) => {
      if (method === "GET" && path === designAt(design.id)) {
        const { space: _space, ...rest } = (await getSummary(design.id))!;
        await dbPut("summaries", rest satisfies DesignSummary);
      }
      return undefined;
    });
    const report = await run({ fetch: meanwhile.fetch });
    expect(report).toMatchObject({ pulled: 0, problems: [m.cloud.sync.sameId("Kept here")] });
    expect((await getDesign(design.id))?.pages).toHaveLength(1);
    expect((await getSummary(design.id))?.space).toBeUndefined();
  });
});

describe("deleting on the server", () => {
  it("keeps a deletion to send later while the design is open live on the server", async () => {
    const design = await local("Live elsewhere");
    await run();
    await deleteForever(design.id);
    const live = serverThat((method, path) => (method === "DELETE" && path === designAt(design.id) ? { status: 409, body: { code: "live" } } : undefined));
    const report = await run({ fetch: live.fetch });
    expect(report).toMatchObject({ deleted: 0, live: 1 });
    expect(await dbGet<SyncRecord>("sync", design.id)).toMatchObject({ tombstone: true });
    expect(useSyncStatus.getState()).toMatchObject({ state: "live", waiting: 1 });
    expect((await run()).deleted).toBe(1);
    expect((await remote(design.id)).body.code).toBe("deleted");
  });

  it("counts a deletion as done when the server no longer has the design", async () => {
    const design = await local("Already gone");
    await run();
    await deleteForever(design.id);
    const gone = serverThat((method, path) => (method === "DELETE" && path === designAt(design.id) ? { status: 404, body: { code: "not-found" } } : undefined));
    expect((await run({ fetch: gone.fetch })).deleted).toBe(1);
    expect(await dbGet<SyncRecord>("sync", design.id)).toBeUndefined();
    expect(await countWaiting()).toBe(0);
  });

  it("keeps a deletion the server refuses, says so, and sends it again next run", async () => {
    const design = await local("Refused deletion");
    await run();
    await deleteForever(design.id);
    const refusing = serverThat((method, path) => (method === "DELETE" && path === designAt(design.id) ? { status: 400, body: { code: "bad-request" } } : undefined));
    const report = await run({ fetch: refusing.fetch });
    expect(report).toMatchObject({ deleted: 0, problems: [cloudErrorText(new CloudError("bad-request", 400, ""))] });
    expect(await dbGet<SyncRecord>("sync", design.id)).toMatchObject({ tombstone: true });
    expect((await run()).deleted).toBe(1);
  });

  it("keeps a deletion whose answer cannot be used, and says so", async () => {
    const design = await local("Answered oddly");
    await run();
    await deleteForever(design.id);
    const odd = serverThat((method, path) => (method === "DELETE" && path === designAt(design.id) ? { status: 200, body: ["deleted"] } : undefined));
    const report = await run({ fetch: odd.fetch });
    expect(report).toMatchObject({ deleted: 0, problems: [m.cloud.errors["bad-answer"]] });
    expect(await dbGet<SyncRecord>("sync", design.id)).toMatchObject({ tombstone: true });
  });

  it("forgets a deletion here of a design the other device deleted too, sending nothing", async () => {
    const design = await local("Deleted twice");
    await run();
    await deleteForever(design.id);
    await call(b, "DELETE", designAt(design.id), { token: other });
    const watched = serverThat(() => undefined);
    const report = await run({ fetch: watched.fetch });
    expect(report).toMatchObject({ deleted: 0, trashed: 0, pulled: 0 });
    expect(watched.seen.filter((r) => r.startsWith("DELETE "))).toEqual([]);
    expect(await dbGet<SyncRecord>("sync", design.id)).toBeUndefined();
    expect(await getSummary(design.id)).toBeNull();
  });

  it("brings back a design a team's editor deleted here, which only an owner deletes on the server, reading the team's feed again", async () => {
    const { team, shared } = await inTeam("editor");
    await deleteForever(shared.id);
    expect(await countWaiting()).toBe(1);
    const report = await run();
    expect(report.deleted).toBe(0);
    expect(await dbGet<SyncRecord>("sync", shared.id)).toBeUndefined();
    expect((await metaGet<Record<string, number>>("cloudCursors", {}))[team]).toBe(0);
    await run();
    expect(await getSummary(shared.id)).toMatchObject({ space: team, title: "Team flyer" });
    expect(await countWaiting()).toBe(0);
  });
});

describe("sending details", () => {
  it("keeps a detail the server forbids to change waiting, and sends it next run", async () => {
    const design = await local("Starred");
    await run();
    await setStarred(design.id, true);
    const forbidding = serverThat((method, path) => (method === "PATCH" && path === `${designAt(design.id)}/meta` ? { status: 403, body: { code: "forbidden" } } : undefined));
    expect((await run({ fetch: forbidding.fetch })).problems).toEqual([]);
    expect(await countWaiting()).toBe(1);
    expect((await remote(design.id)).body.design.starred).toBe(false);
    await run();
    expect((await remote(design.id)).body.design.starred).toBe(true);
    expect(await countWaiting()).toBe(0);
  });

  it("stops the run when the server fails while a detail is sent, and the detail still waits", async () => {
    const design = await local("Renamed");
    await run();
    await renameDesign(design.id, "Renamed here");
    const failing = serverThat((method, path) => (method === "PATCH" && path === `${designAt(design.id)}/meta` ? { status: 500, body: { code: "server" } } : undefined));
    await expect(syncOnce({ fetch: failing.fetch })).rejects.toMatchObject({ code: "server" });
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", waiting: 1 });
  });
});

describe("folders", () => {
  it("sends a folder before the folders in it, and one inside a folder of this device only at the top of the space", async () => {
    await saveSession(null);
    const mine = await createFolder("On this device only");
    await signedIn();
    const top = await createFolder("Top");
    const middle = await createFolder("Middle", top.id);
    const inner = await createFolder("Inner", middle.id);
    const underMine = await createFolder("Under a folder of this device", mine.id);
    const watched = serverThat(() => undefined);
    await run({ fetch: watched.fetch });
    const sent = watched.seen.filter((r) => r.startsWith("PUT ") && r.includes("/folders/")).map((r) => r.slice(r.lastIndexOf("/") + 1));
    // (listed by name, Inner comes before Middle and Top)
    expect(sent.indexOf(top.id)).toBeLessThan(sent.indexOf(middle.id));
    expect(sent.indexOf(middle.id)).toBeLessThan(sent.indexOf(inner.id));
    expect(sent).not.toContain(mine.id);
    const there = await foldersThere();
    expect(there.find((f) => f.id === inner.id)?.parentId).toBe(middle.id);
    expect(there.find((f) => f.id === underMine.id)?.parentId).toBeNull();
  });

  it("goes on when the server refuses a folder, and sends it again next run", async () => {
    const refused = await createFolder("Refused");
    const fine = await createFolder("Fine");
    const full = serverThat((method, path) => (method === "PUT" && path.endsWith(`/folders/${refused.id}`) ? { status: 413, body: { code: "quota" } } : undefined));
    expect((await run({ fetch: full.fetch })).problems).toEqual([]);
    expect((await foldersThere()).map((f) => f.id)).toEqual([fine.id]);
    await run();
    expect((await foldersThere()).map((f) => f.id).sort()).toEqual([fine.id, refused.id].sort());
  });

  it("stops the run when the server fails while a folder is sent", async () => {
    const folder = await createFolder("Failing");
    const failing = serverThat((method, path) => (method === "PUT" && path.endsWith(`/folders/${folder.id}`) ? { status: 503, body: { code: "busy" } } : undefined));
    await expect(syncOnce({ fetch: failing.fetch })).rejects.toMatchObject({ code: "busy" });
    expect(await foldersThere()).toEqual([]);
    await run();
    expect((await foldersThere()).map((f) => f.id)).toEqual([folder.id]);
  });

  it("forgets a folder removed here that the server no longer has, and asks nothing of it again", async () => {
    const folder = await createFolder("Gone");
    await run();
    await deleteFolder(folder.id);
    const gone = serverThat((method, path) => (method === "DELETE" && path.endsWith(`/folders/${folder.id}`) ? { status: 404, body: { code: "not-found" } } : undefined));
    await run({ fetch: gone.fetch });
    expect(await metaGet("cloudFolders", {})).toEqual({ [space()]: {} });
    const watched = serverThat(() => undefined);
    await run({ fetch: watched.fetch });
    expect(watched.seen.filter((r) => r.includes("/folders/"))).toEqual([]);
  });

  it("keeps a folder removed here to remove on the server when the server fails, and removes it next run", async () => {
    const folder = await createFolder("To remove");
    await run();
    await deleteFolder(folder.id);
    const failing = serverThat((method, path) => (method === "DELETE" && path.endsWith(`/folders/${folder.id}`) ? { status: 500, body: { code: "server" } } : undefined));
    await expect(syncOnce({ fetch: failing.fetch })).rejects.toMatchObject({ code: "server" });
    expect((await foldersThere()).find((f) => f.id === folder.id)?.deletedAt).toBeNull();
    await run();
    expect((await foldersThere()).find((f) => f.id === folder.id)?.deletedAt).toBeGreaterThan(0);
  });

  it("removes a folder the other device removed, and leaves alone a folder of this device only under the id of one of the server", async () => {
    await call(b, "PUT", `/api/spaces/${space()}/folders/f_theirs`, { token: other, body: { name: "Theirs", parentId: null } });
    await run();
    expect((await listFolders()).find((f) => f.id === "f_theirs")?.space).toBe(space());
    await call(b, "DELETE", `/api/spaces/${space()}/folders/f_theirs`, { token: other });
    const mine = { id: "f_same_id", name: "Mine", parentId: null, createdAt: Date.now() };
    await dbPut("folders", mine);
    await call(b, "PUT", `/api/spaces/${space()}/folders/f_same_id`, { token: other, body: { name: "The server's", parentId: null } });
    await run();
    const here = await listFolders();
    expect(here.find((f) => f.id === "f_theirs")).toBeUndefined();
    expect(here.find((f) => f.id === "f_same_id")).toEqual(mine);
  });
});

describe("a viewer of a team", () => {
  it("takes the team's design in place of an edit made here, keeping no copy", async () => {
    const { team, owner, shared } = await inTeam("viewer");
    await edit(shared.id, (d) => ({ ...d, pages: [] }));
    await call(b, "PUT", designAt(shared.id, team), { token: owner, body: { baseRev: 1, design: { ...shared, pages: [createPage(), createPage()] } } });
    const report = await run();
    expect(report).toMatchObject({ conflicts: 0, pulled: 1 });
    expect((await getDesign(shared.id))?.pages).toHaveLength(2);
    expect((await listDesigns()).some((d) => d.title.includes("(edited on"))).toBe(false);
    expect((await remote(shared.id, owner, team)).body.rev).toBe(2);
  });

  it("moves a design edited here that the team deleted to the Trash here, sending nothing", async () => {
    const { team, owner, shared } = await inTeam("viewer");
    await edit(shared.id, (d) => ({ ...d, pages: [] }));
    await call(b, "DELETE", designAt(shared.id, team), { token: owner });
    const report = await run();
    expect(report).toMatchObject({ trashed: 1, forked: 0, pushed: 0 });
    const summary = await getSummary(shared.id);
    expect(summary?.trashedAt).toBeGreaterThan(0);
    expect(summary?.space).toBeUndefined();
  });

  it("forgets a deletion made here without sending it: the team keeps the design", async () => {
    const { team, owner, shared } = await inTeam("viewer");
    await deleteForever(shared.id);
    expect(await countWaiting()).toBe(0);
    const watched = serverThat(() => undefined);
    expect((await run({ fetch: watched.fetch })).deleted).toBe(0);
    expect(watched.seen.filter((r) => r.startsWith("DELETE "))).toEqual([]);
    expect(await dbGet<SyncRecord>("sync", shared.id)).toBeUndefined();
    expect((await remote(shared.id, owner, team)).status).toBe(200);
  });
});

describe("sending one design before it is edited live", () => {
  it("answers in step, sending nothing, while nobody is signed in, for a design of this device only and for one already sent", async () => {
    const sent = await local("Sent");
    await run();
    expect(await sendOne(sent.id)).toBe("in-step");
    await saveSession(null);
    const mine = await local("Only here");
    expect(await sendOne(mine.id)).toBe("in-step");
    await signedIn();
    expect(await sendOne(mine.id)).toBe("in-step");
    expect(await sendOne("d_not_here")).toBe("in-step");
    expect((await remote(mine.id)).status).not.toBe(200);
  });

  it("sends a design that waits, and an edit of it on the revision the server had, and answers in step", async () => {
    const design = await local("Waits");
    expect(await sendOne(design.id)).toBe("in-step");
    expect((await remote(design.id)).body.rev).toBe(1);
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    expect(await sendOne(design.id)).toBe("in-step");
    expect((await remote(design.id)).body).toMatchObject({ rev: 2 });
    expect(await countWaiting()).toBe(0);
  });

  it("answers live, and keeps the edit waiting, when the server has the design open live", async () => {
    const design = await local("Live there");
    const live = serverThat((method, path) => (method === "PUT" && path === designAt(design.id) ? { status: 409, body: { code: "live" } } : undefined));
    expect(await sendOne(design.id, { fetch: live.fetch })).toBe("live");
    expect(await countWaiting()).toBe(1);
  });

  it("answers unsent, and sends nothing, for a viewer of the team", async () => {
    const { team, owner, shared } = await inTeam("viewer");
    await edit(shared.id, (d) => ({ ...d, pages: [] }));
    expect(await sendOne(shared.id)).toBe("unsent");
    expect((await remote(shared.id, owner, team)).body.rev).toBe(1);
  });

  it("answers unsent on a conflict while the editor holds the design, and leaves it for the sync after the editor closes", async () => {
    const design = await local("Held");
    await run();
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: 1, design: { ...design, pages: [createPage(), createPage(), createPage()] } } });
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    const release = holdLock(designLock(design.id));
    try {
      expect(await sendOne(design.id)).toBe("unsent");
    } finally {
      release();
    }
    expect((await getDesign(design.id))?.pages).toHaveLength(2);
    expect((await listDesigns()).some((d) => d.title.includes("(edited on"))).toBe(false);
    expect((await run()).conflicts).toBe(1);
  });

  it("answers unsent, keeping the id, when the server has another design under it while the editor holds the design", async () => {
    const design = await local("Taken id");
    await call(b, "PUT", designAt(design.id), { token: other, body: { baseRev: null, design: { ...design, title: "Theirs", pages: [createPage()] } } });
    const release = holdLock(designLock(design.id));
    try {
      expect(await sendOne(design.id)).toBe("unsent");
    } finally {
      release();
    }
    expect(await getSummary(design.id)).toMatchObject({ title: "Taken id" });
    expect((await remote(design.id)).body.design.title).toBe("Theirs");
  });
});

describe("keeping an edit as a copy", () => {
  it("keeps the design as a design of its own in the same space, sends it at once, and leaves the design under the id as it is", async () => {
    const design = await local("Poster");
    await run();
    await edit(design.id, (d) => ({ ...d, pages: [...d.pages, createPage()] }));
    const title = await keepAsCopy(design.id);
    expect(title).toBe("Poster (edited on Test laptop)");
    const copy = (await listDesigns()).find((d) => d.title === title)!;
    expect(copy.space).toBe(space());
    expect(copy.id).not.toBe(design.id);
    expect((await remote(copy.id)).body.design.pages).toHaveLength(2);
    expect((await getDesign(design.id))?.pages).toHaveLength(2);
    expect(await waitingDesigns()).toEqual(new Set([design.id]));
  });

  it("keeps the copy here to send with the next sync when the server cannot be reached", async () => {
    const design = await local("Poster");
    await run();
    const title = await keepAsCopy(design.id, { fetch: serverThat(() => "unreachable").fetch });
    const copy = (await listDesigns()).find((d) => d.title === title)!;
    expect(await waitingDesigns()).toEqual(new Set([copy.id]));
    expect((await run()).pushed).toBe(1);
    expect((await remote(copy.id)).status).toBe(200);
  });

  it("makes no copy of a design that is not here or is of no space, or while nobody is signed in", async () => {
    const design = await local("Poster");
    expect(await keepAsCopy("d_not_here")).toBeNull();
    await saveSession(null);
    const mine = await local("Only here");
    expect(await keepAsCopy(design.id)).toBeNull();
    await signedIn();
    expect(await keepAsCopy(mine.id)).toBeNull();
    expect((await listDesigns()).map((d) => d.title).sort()).toEqual(["Only here", "Poster"]);
  });
});

describe("a run", () => {
  it("does not run while nobody is signed in, nor while another tab syncs, and nothing waits while nobody is signed in", async () => {
    await local("Waits");
    const release = holdLock(SYNC_LOCK);
    try {
      expect(await syncOnce()).toBeNull();
    } finally {
      release();
    }
    await saveSession(null);
    expect(await syncOnce()).toBeNull();
    expect(await countWaiting()).toBe(0);
    expect(await waitingDesigns()).toEqual(new Set());
  });

  it("says the server's answer could not be used when it answers who is signed in with nonsense, and keeps everything", async () => {
    const design = await local("Kept");
    const nonsense = serverThat((method, path) => (method === "GET" && path === "/api/me" ? { status: 200, body: { hello: "world" } } : undefined));
    await expect(syncOnce({ fetch: nonsense.fetch })).rejects.toThrow();
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.errors["bad-answer"], waiting: 1 });
    expect(await getSummary(design.id)).not.toBeNull();
  });
});

describe("running by itself", () => {
  /**
   * The waits the engine set before a next run, those `at` picks (by default all but the run at once when it starts): the timers
   * whose callback starts a run (requests and the network code set timers of their own).
   */
  const waits = (spy: { mock: { calls: unknown[][] } }, at = (ms: number) => ms > 0) =>
    spy.mock.calls
      .filter((c) => /^\(\) => void run\(\)$/.test(String(c[0])))
      .map((c) => c[1])
      .filter((ms): ms is number => typeof ms === "number" && at(ms));

  let visibility: DocumentVisibilityState = "visible";
  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
  });

  it("runs at once and when the browser comes online, waits twice as long after each failure up to five minutes, and a minute after a run that worked", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    let down = true;
    const stop = startSync({ fetch: (input, init) => (down ? Promise.reject(new TypeError("fetch failed")) : fetch(input, init)) });
    // (safe to call twice)
    expect(startSync()).toBe(stop);
    await vi.waitFor(() => expect(waits(spy)).toHaveLength(1));
    for (let n = 2; n <= 5; n++) {
      window.dispatchEvent(new Event("online"));
      await vi.waitFor(() => expect(waits(spy)).toHaveLength(n));
    }
    expect(waits(spy)).toEqual([60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(useSyncStatus.getState().state).toBe("offline");

    // a tab that is hidden does not run; one that comes into view does
    down = false;
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(waits(spy)).toHaveLength(6));
    expect(waits(spy)[5]).toBe(60_000);
    expect(useSyncStatus.getState().state).toBe("synced");

    stop();
    expect(useSyncStatus.getState()).toMatchObject({ state: "off", waiting: 0, problem: null });
  });

  it("runs 3 s after a save, soon when asked to, and in a minute after Sync now, but not after what a run writes itself", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    startSync();
    await vi.waitFor(() => expect(useSyncStatus.getState().state).toBe("synced"));
    // what a run writes (a design from the other device) does not make another run
    const made = await fromThePhone("From the phone");
    spy.mockClear();
    requestSync();
    expect(waits(spy, (ms) => ms === 200)).toEqual([200]);
    await vi.waitFor(async () => expect(await getSummary(made.id)).not.toBeNull());
    await vi.waitFor(() => expect(useSyncStatus.getState().state).toBe("synced"));
    expect(waits(spy, (ms) => ms === 3_000)).toEqual([]);

    spy.mockClear();
    const design = await local("Saved");
    expect(waits(spy, (ms) => ms === 3_000)).toEqual([3_000]);

    spy.mockClear();
    expect((await syncNow())?.pushed).toBe(1);
    expect(waits(spy, (ms) => ms === 60_000)).toEqual([60_000]);
    expect((await remote(design.id)).status).toBe(200);
  });

  it("waits longer after a run that ended with a problem, as after one that failed", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const design = await local("Refused every time");
    const refusing = serverThat((method, path) => (method === "PUT" && path === designAt(design.id) ? { status: 422, body: { code: "too-strange" } } : undefined));
    startSync({ fetch: refusing.fetch });
    await vi.waitFor(() => expect(waits(spy)).toEqual([60_000]));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(waits(spy)).toEqual([60_000, 120_000]));
    expect(useSyncStatus.getState()).toMatchObject({ state: "problem", problem: m.cloud.sync.refused("Refused every time") });
  });

  it("runs again 3 s after a run when it was asked for one while it ran", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (letGo = resolve));
    let asked = false;
    startSync({
      fetch: async (input, init) => {
        if (!asked && String(input).endsWith("/api/me")) {
          asked = true;
          await held;
        }
        return fetch(input, init);
      },
    });
    await vi.waitFor(() => expect(asked).toBe(true));
    window.dispatchEvent(new Event("online"));
    spy.mockClear();
    letGo();
    await vi.waitFor(() => expect(waits(spy, (ms) => ms === 3_000 || ms === 60_000)).toEqual([3_000]));
  });
});

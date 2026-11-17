/**
 * Spaces through the real server, over real HTTP: designs (making, changing on a revision, conflicts, `exists`, retries that
 * lost their answer), details last-write-wins, tombstones and their purge after 90 days, revisions and restoring, uploads with
 * the checks of a room's pictures and `svgProblem`, folders, the changes feed with its cursor, quotas, who may reach a space,
 * and everything kept across a restart with `FileAccounts` in a temporary folder.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPage, createShape } from "@/core/factory";
import { ASSET_LIMIT } from "../http";
import { FileAccounts } from "./storage";
import { boot, call, closeAll, DAY, design, makeClock, PASSWORD, PNG, sendTooMuch, signUp, THUMB, type Booted } from "./testServer";

const dirs: string[] = [];
afterEach(async () => {
  await closeAll();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function person(b: Booted) {
  const { token, user } = await signUp(b);
  const space = `/api/spaces/${user.id}`;
  return {
    token,
    user,
    space,
    put: (id: string, baseRev: number | null, d: unknown = design(id), thumbnail?: unknown) =>
      call(b, "PUT", `${space}/designs/${id}`, { token, body: { baseRev, design: d, ...(thumbnail === undefined ? {} : { thumbnail }) } }),
    get: (path: string) => call(b, "GET", `${space}${path}`, { token }),
    send: (method: string, path: string, body?: unknown) => call(b, method, `${space}${path}`, { token, body }),
  };
}

describe("designs", () => {
  it("are made with baseRev null, read back with their revision and thumbnail, and changed on the revision they were based on", async () => {
    const b = await boot();
    const p = await person(b);
    const made = await p.put("d1", null, design("d1", "First"), THUMB);
    expect(made.status).toBe(201);
    expect(made.body).toEqual({ rev: 1 });
    const read = await p.get("/designs/d1");
    expect(read.status).toBe(200);
    expect(read.body.rev).toBe(1);
    expect(read.body.thumbnail).toBe(THUMB);
    expect(read.body.design).toMatchObject({ id: "d1", title: "First", pages: [{ id: "p" }] });
    const changed = await p.put("d1", 1, design("d1", "Second"));
    expect(changed.body).toEqual({ rev: 2 });
    expect((await p.get("/designs/d1")).body.thumbnail).toBeNull();
    // the details stay what the manifest says: a PUT changes the content, PATCH …/meta the details
    expect((await p.get("/designs/d1")).body.design.title).toBe("First");
  });

  it("answer a change based on an older revision with 409 conflict and the server's revision", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null);
    await p.put("d1", 1, design("d1", "A"));
    const late = await p.put("d1", 1, design("d1", "B"));
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: "conflict", rev: 2 });
    expect((await p.put("d1", 7, design("d1", "B"))).body).toMatchObject({ code: "conflict", rev: 2 });
  });

  it("answer a retry whose first answer was lost with the same answer, not a conflict", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null, design("d1", "X"));
    expect(await p.put("d1", null, design("d1", "X"))).toMatchObject({ status: 200, body: { rev: 1 } });
    await p.put("d1", 1, design("d1", "Y"));
    expect(await p.put("d1", 1, design("d1", "Y"))).toMatchObject({ status: 200, body: { rev: 2 } });
  });

  it("refuse a new design under an id that holds another one (409 exists), and a change of one that is not there (404)", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null, design("d1", "Mine"));
    const taken = await p.put("d1", null, design("d1", "Another"));
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "exists", rev: 1 });
    expect((await p.put("d2", 1)).status).toBe(404);
    expect((await p.get("/designs/d2")).status).toBe(404);
  });

  it("refuse what is not a design they may keep, with 400 (or 400 newer for a design of a newer Craftly)", async () => {
    const b = await boot();
    const p = await person(b);
    const bad: [string, unknown, unknown?][] = [
      ["another id", design("other")],
      ["a live link", { ...design("d1"), live: { server: "x", room: "y", key: "z" } }],
      ["no pages", { ...design("d1"), pages: [] }],
      ["not an object", "design"],
      ["a page that is not one", { ...design("d1"), pages: [{ elements: 1 }] }],
      ["a thumbnail that is not a picture", design("d1"), "data:text/html;base64,PGI+"],
      ["a thumbnail that is no data address", design("d1"), "https://example.org/x.png"],
      ["a thumbnail with broken base64", design("d1"), "data:image/png;base64,abc"],
      ["a thumbnail too big", design("d1"), `data:image/png;base64,${"A".repeat(300_000)}`],
    ];
    for (const [what, d, thumbnail] of bad) {
      const answer = await p.put("d1", null, d, thumbnail);
      expect(answer.status, what).toBe(400);
    }
    const newer = await p.put("d1", null, { ...design("d1"), version: 99 });
    expect(newer.status).toBe(400);
    expect(newer.body.code).toBe("newer");
    for (const body of [
      { design: design("d1") },
      { baseRev: 0, design: design("d1") },
      { baseRev: "1", design: design("d1") },
      { baseRev: null, design: design("d1"), extra: 1 },
    ]) {
      expect((await p.send("PUT", "/designs/d1", body)).status).toBe(400);
    }
    expect((await p.send("PUT", "/designs/bad%2Fid", { baseRev: null, design: design("bad/id") })).status).toBe(400);
    expect((await p.send("PUT", `/designs/${"x".repeat(129)}`, { baseRev: null, design: design("x".repeat(129)) })).status).toBe(400);
    expect((await p.send("POST", "/designs/d1", {})).status).toBe(405);
  });

  it("are refused when too big: a design over maxDesignBytes, and a body far over the limit (413 too-big)", async () => {
    const b = await boot({}, { maxDesignBytes: 4000 });
    const p = await person(b);
    const shapes = Array.from({ length: 40 }, (_, i) => createShape("rect", { id: `s${i}` }));
    const big = await p.put("d1", null, design("d1", "Big", { pages: [createPage({ id: "p", elements: shapes })] }));
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("too-big");
    // the limit of the body is the design, a thumbnail of 256 KB and 16 KB for the rest
    expect(await sendTooMuch(b, "PUT", `${p.space}/designs/d1`, p.token, 4000 + 256 * 1024 + 16 * 1024 + 1)).toBe(413);
  });

  it("keep the last 10 revisions before the current one, and restore one as a new revision", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null, design("d1", "v1"));
    for (let rev = 1; rev < 13; rev++) await p.put("d1", rev, { ...design("d1", `v${rev + 1}`), width: 800 + rev });
    const versions = await p.get("/designs/d1/versions");
    expect(versions.body.current).toBe(13);
    expect(versions.body.versions.map((v: { rev: number }) => v.rev)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect((await p.send("POST", "/designs/d1/restore", { rev: 2 })).status).toBe(404);
    const restored = await p.send("POST", "/designs/d1/restore", { rev: 5 });
    expect(restored.body).toEqual({ rev: 14 });
    expect((await p.get("/designs/d1")).body.design.width).toBe(804);
    expect((await p.send("POST", "/designs/d1/restore", { rev: 14 })).body).toEqual({ rev: 14 });
    expect((await p.send("POST", "/designs/d1/restore", { rev: "5" })).status).toBe(400);
    expect((await p.get("/designs/d1/versions")).body.versions).toHaveLength(11);
  });
});

describe("details", () => {
  it("change field by field, last write wins, and never conflict with the content", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null);
    await p.send("PUT", "/folders/f1", { name: "Work", parentId: null });
    expect((await p.send("PATCH", "/designs/d1/meta", { title: "Renamed" })).status).toBe(200);
    expect((await p.send("PATCH", "/designs/d1/meta", { starred: true, folderId: "f1", trashedAt: 123 })).status).toBe(200);
    // the content moves on meanwhile, and the details stay
    await p.put("d1", 1, design("d1", "content title"));
    const read = (await p.get("/designs/d1")).body.design;
    expect(read).toMatchObject({ title: "Renamed", starred: true, folderId: "f1", trashedAt: 123 });
    expect((await p.send("PATCH", "/designs/d1/meta", { trashedAt: null })).status).toBe(200);
    expect((await p.get("/designs/d1")).body.design.trashedAt).toBeNull();
  });

  it("refuse what they cannot be: an empty change, a field that is not one, a folder that is not there, a design that is not there", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null);
    for (const body of [{}, { title: 5 }, { title: "x".repeat(201) }, { starred: "yes" }, { trashedAt: -1 }, { folderId: "../x" }, { owner: "me" }]) {
      expect((await p.send("PATCH", "/designs/d1/meta", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await p.send("PATCH", "/designs/d1/meta", { folderId: "nowhere" })).status).toBe(404);
    expect((await p.send("PATCH", "/designs/d9/meta", { title: "x" })).status).toBe(404);
  });
});

describe("deleting", () => {
  it("leaves a tombstone: gone for reading and writing, in the feed, restorable for 90 days, then purged", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null);
    await p.put("d1", 1, design("d1", "second"));
    expect((await p.send("DELETE", "/designs/d1")).status).toBe(200);
    expect((await p.send("DELETE", "/designs/d1")).status).toBe(200);
    expect((await p.send("DELETE", "/designs/d9")).status).toBe(404);
    const read = await p.get("/designs/d1");
    expect(read.status).toBe(404);
    expect(read.body.code).toBe("deleted");
    const put = await p.put("d1", 2, design("d1", "third"));
    expect(put.status).toBe(409);
    expect(put.body.code).toBe("deleted");
    expect((await p.send("PATCH", "/designs/d1/meta", { title: "x" })).status).toBe(404);
    const feed = await p.get("/changes?since=0");
    expect(feed.body.designs).toEqual([expect.objectContaining({ id: "d1", deletedAt: b.clock.now(), rev: 2 })]);
    expect((await p.get("/designs/d1/versions")).body.deleted).toBe(true);
    expect((await p.send("POST", "/designs/d1/restore", { rev: 2 })).body).toEqual({ rev: 3 });
    expect((await p.get("/designs/d1")).status).toBe(200);
    // deleted again, and 90 days later it is purged with every revision
    await p.send("DELETE", "/designs/d1");
    // (the session is used every few weeks, so that it lasts the 90 days)
    for (let day = 0; day < 90; day += 18) {
      b.clock.advance(18 * DAY);
      // reading does not purge: only a change of the space does
      expect((await p.get("/designs/d1/versions")).status).toBe(200);
    }
    await p.put("d2", null); // any change of the space purges
    expect((await p.get("/designs/d1/versions")).status).toBe(404);
    expect((await p.get("/changes")).body.designs.map((d: { id: string }) => d.id)).toEqual(["d2"]);
    expect((await p.put("d1", null)).status).toBe(201);
  });
});

describe("folders", () => {
  it("are made, renamed, nested, and removed with what was in them moved to the top", async () => {
    const b = await boot();
    const p = await person(b);
    expect((await p.send("PUT", "/folders/f1", { name: "Work", parentId: null })).status).toBe(201);
    expect((await p.send("PUT", "/folders/f2", { name: "Inner", parentId: "f1" })).status).toBe(201);
    expect((await p.send("PUT", "/folders/f1", { name: "Renamed", parentId: null })).status).toBe(200);
    expect((await p.send("PUT", "/folders/f1", { name: "Loop", parentId: "f2" })).status).toBe(400);
    expect((await p.send("PUT", "/folders/f3", { name: "Lost", parentId: "nowhere" })).status).toBe(404);
    for (const body of [
      { name: "", parentId: null },
      { name: "x".repeat(201), parentId: null },
      { name: "A" },
      { name: "A", parentId: null, color: 1 },
      { name: "a\u0000b", parentId: null },
    ]) {
      expect((await p.send("PUT", "/folders/f4", body)).status).toBe(400);
    }
    await p.put("d1", null, design("d1", "In f1", { folderId: "f1" }));
    expect((await p.get("/designs/d1")).body.design.folderId).toBe("f1");
    expect((await p.send("DELETE", "/folders/f1")).status).toBe(200);
    expect((await p.send("DELETE", "/folders/nowhere")).status).toBe(404);
    expect((await p.get("/designs/d1")).body.design.folderId).toBeNull();
    const feed = (await p.get("/changes")).body;
    expect(feed.folders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "f1", deletedAt: b.clock.now() }), expect.objectContaining({ id: "f2", parentId: null, deletedAt: null })]),
    );
    expect((await p.send("GET", "/folders/f1")).status).toBe(405);
  });

  it("are at most maxFolders a space (413 quota)", async () => {
    const b = await boot({ maxFolders: 2 });
    const p = await person(b);
    await p.send("PUT", "/folders/f1", { name: "1", parentId: null });
    await p.send("PUT", "/folders/f2", { name: "2", parentId: null });
    const third = await p.send("PUT", "/folders/f3", { name: "3", parentId: null });
    expect(third.status).toBe(413);
    expect(third.body.code).toBe("quota");
    expect((await p.send("PUT", "/folders/f2", { name: "renamed", parentId: null })).status).toBe(200);
  });
});

describe("uploads", () => {
  const svg = (markup: string) => ({ mime: "image/svg+xml", base64: Buffer.from(markup).toString("base64") });

  it("are kept once, given back, and an id that holds another upload is 409 exists", async () => {
    const b = await boot();
    const p = await person(b);
    const picture = { mime: "image/png", base64: PNG };
    expect((await p.send("PUT", "/assets/a1", picture)).status).toBe(201);
    expect((await p.send("PUT", "/assets/a1", picture)).status).toBe(200);
    const other = await p.send("PUT", "/assets/a1", svg('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("exists");
    expect((await p.get("/assets/a1")).body).toEqual(picture);
    expect((await p.get("/assets/a2")).status).toBe(404);
    const missing = await p.send("POST", "/assets/missing", { ids: ["a1", "a2", "a2", "a3"] });
    expect(missing.body).toEqual({ missing: ["a2", "a3"] });
    expect((await p.send("GET", "/assets/missing")).status).toBe(404); // an upload that may be called "missing"
    for (const body of [{ ids: "a1" }, { ids: ["../x"] }, { ids: Array(1001).fill("a") }, {}]) expect((await p.send("POST", "/assets/missing", body)).status).toBe(400);
  });

  it("get the checks of a room's pictures, and a drawing must be plain drawing (svgProblem); the bytes must be the type they say", async () => {
    const b = await boot();
    const p = await person(b);
    expect((await p.send("PUT", "/assets/s1", svg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'))).status).toBe(201);
    const bad: [string, unknown][] = [
      ["a script in a drawing", svg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      ["a handler in a drawing", svg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ["a page", { mime: "text/html", base64: Buffer.from("<b>x</b>").toString("base64") }],
      ["a PNG that is not one", { mime: "image/png", base64: Buffer.from("<html>not a picture</html>").toString("base64") }],
      ["base64 that is not", { mime: "image/png", base64: "!!!!" }],
      ["base64 written two ways", { mime: "image/png", base64: `${PNG.slice(0, -2)}h=` }],
      ["another field", { mime: "image/png", base64: PNG, name: "x" }],
      ["nothing", {}],
    ];
    for (const [what, body] of bad) expect((await p.send("PUT", "/assets/x1", body)).status, what).toBe(400);
    expect((await call(b, "PUT", `${p.space}/assets/x1`, { token: p.token, raw: "{" })).status).toBe(400);
    expect((await p.send("PUT", "/assets/bad.id", { mime: "image/png", base64: PNG })).status).toBe(400);
  });

  it("are refused over 9 MiB (413 too-big)", async () => {
    const b = await boot();
    const p = await person(b);
    expect(await sendTooMuch(b, "PUT", `${p.space}/assets/big`, p.token, ASSET_LIMIT + 101)).toBe(413);
  });
});

describe("the changes feed", () => {
  it("gives what changed after a cursor in the order it changed, a page at a time", async () => {
    const b = await boot();
    const p = await person(b);
    await p.put("d1", null);
    await p.send("PUT", "/folders/f1", { name: "F", parentId: null });
    await p.send("PUT", "/assets/a1", { mime: "image/png", base64: PNG });
    await p.put("d2", null);
    const all = await p.get("/changes");
    expect(all.body).toMatchObject({ cursor: 4, more: false });
    expect(all.body.designs.map((d: { id: string }) => d.id)).toEqual(["d1", "d2"]);
    expect(all.body.designs[0]).toEqual({
      id: "d1",
      rev: 1,
      metaSeq: 1,
      seq: 1,
      title: "Poster",
      folderId: null,
      starred: false,
      trashedAt: null,
      deletedAt: null,
      updatedAt: b.clock.now(),
    });
    expect(all.body.assets).toEqual([{ id: "a1", mime: "image/png", bytes: PNG.length, seq: 3, createdAt: b.clock.now() }]);
    const first = await p.get("/changes?since=0&limit=2");
    expect(first.body).toMatchObject({ cursor: 2, more: true });
    const second = await p.get(`/changes?since=${first.body.cursor}&limit=2`);
    expect(second.body).toMatchObject({ cursor: 4, more: false, assets: [{ id: "a1" }], designs: [{ id: "d2" }] });
    expect((await p.get("/changes?since=4")).body).toEqual({ cursor: 4, more: false, designs: [], folders: [], assets: [] });
    // a change of the details moves the design to the end of the feed
    await p.send("PATCH", "/designs/d1/meta", { title: "T" });
    expect((await p.get("/changes?since=4")).body.designs).toEqual([expect.objectContaining({ id: "d1", title: "T", metaSeq: 5, seq: 5 })]);
    for (const query of ["since=-1", "since=x", "limit=0", "limit=501", "since=1&other=2"]) expect((await p.get(`/changes?${query}`)).status, query).toBe(400);
  });
});

describe("quotas", () => {
  it("refuse a design or an upload that would take a space past its bytes, and designs past their number (413 quota)", async () => {
    const b = await boot({ spaceQuotaBytes: 6000, maxDesignsPerSpace: 2 });
    const p = await person(b);
    expect((await p.put("d1", null)).status).toBe(201);
    expect((await p.put("d2", null)).status).toBe(201);
    const third = await p.put("d3", null);
    expect(third.status).toBe(413);
    expect(third.body.code).toBe("quota");
    // bytes: revisions count too
    let rev = 1;
    let answer = await p.put("d1", rev, design("d1", "a".repeat(100)));
    while (answer.status === 200) answer = await p.put("d1", ++rev, design("d1", "a".repeat(100 + rev)));
    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe("quota");
    const bigPicture = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(6000)]).toString("base64");
    expect((await p.send("PUT", "/assets/a1", { mime: "image/png", base64: bigPicture })).status).toBe(413);
    // a deleted design still counts until it is purged
    await p.send("DELETE", "/designs/d2");
    expect((await p.put("d3", null)).status).toBe(413);
  });
});

describe("who may reach a space", () => {
  it("only its person (or team): another person's space and one that is not there are both 404, without a session 401", async () => {
    const b = await boot();
    const ann = await person(b);
    const bob = await person(b);
    await ann.put("d1", null);
    for (const [method, path] of [
      ["GET", "/changes"],
      ["GET", "/designs/d1"],
      ["PUT", "/folders/f1"],
      ["POST", "/assets/missing"],
    ]) {
      const theirs = await call(b, method, `${ann.space}${path}`, { token: bob.token, body: method === "GET" ? undefined : {} });
      expect(theirs.status, `${method} ${path}`).toBe(404);
      expect(theirs.body.code).toBe("not-found");
    }
    expect((await call(b, "GET", "/api/spaces/nothing-like-an-id/changes", { token: bob.token })).status).toBe(404);
    expect((await call(b, "GET", `${ann.space}/changes`)).status).toBe(401);
    expect((await call(b, "GET", `${ann.space}/nothing`, { token: ann.token })).status).toBe(404);
  });
});

describe("a restart", () => {
  it("keeps everything with FileAccounts: people, sessions, designs and revisions, uploads, folders, teams and invites", async () => {
    const dir = await mkdtemp(join(tmpdir(), "craftly-restart-"));
    dirs.push(dir);
    const clock = makeClock();
    const first = await boot({}, {}, { storage: new FileAccounts(dir), clock });
    const p = await person(first);
    await p.put("d1", null, design("d1", "Kept"), THUMB);
    await p.put("d1", 1, design("d1", "Kept 2"));
    await p.send("PUT", "/folders/f1", { name: "F", parentId: null });
    await p.send("PUT", "/assets/a1", { mime: "image/png", base64: PNG });
    const team = (await call(first, "POST", "/api/teams", { token: p.token, body: { name: "Team" } })).body.team;
    const invite = (await call(first, "POST", `/api/teams/${team.id}/invites`, { token: p.token, body: { role: "viewer", uses: 2, hours: 24 } })).body;
    await first.server.close();

    const second = await boot({}, {}, { storage: new FileAccounts(dir), clock });
    const me = await call(second, "GET", "/api/me", { token: p.token });
    expect(me.status).toBe(200);
    expect(me.body.teams).toEqual([{ id: team.id, name: "Team", role: "owner" }]);
    const read = await call(second, "GET", `${p.space}/designs/d1`, { token: p.token });
    expect(read.body).toMatchObject({ rev: 2, thumbnail: null, design: { title: "Kept" } });
    expect((await call(second, "GET", `${p.space}/designs/d1/versions`, { token: p.token })).body.versions).toHaveLength(2);
    expect((await call(second, "GET", `${p.space}/assets/a1`, { token: p.token })).body.base64).toBe(PNG);
    expect((await call(second, "GET", `${p.space}/changes`, { token: p.token })).body.folders).toHaveLength(1);
    const joiner = await signUp(second);
    const joined = await call(second, "POST", "/api/invites/redeem", { token: joiner.token, body: { code: invite.code } });
    expect(joined.body.team).toEqual({ id: team.id, name: "Team", role: "viewer" });
    expect((await call(second, "POST", "/api/auth/signin", { body: { email: (await second.storage.loadUser(p.user.id))!.email, password: PASSWORD } })).status).toBe(200);
  });
});

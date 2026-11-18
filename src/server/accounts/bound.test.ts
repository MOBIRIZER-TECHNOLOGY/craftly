/**
 * Team designs opened live by their members, without links (docs/ACCOUNTS.md, step 14), through the real server with real
 * WebSockets: `POST …/live` and the room bound to the design, joining with a session (and never with a key), the member's role
 * deciding, `PUT` answered 409 `live` while the room is in memory, the design written back as the next revision when the room
 * leaves memory or the server stops (and kept when that fails), and sockets sent away when a member is removed or lowered, the
 * team deleted, the account disabled or its sessions ended.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { joinCredential, SESSION_TOKEN, type ServerMsg } from "@/collab/protocol";
import { createPage, createShape } from "@/core/factory";
import type { DesignComment } from "@/core/types";
import { parseMetrics } from "../metricsText";
import { FileStorage, MemoryStorage, ROOM_ID, type LiveStorage } from "../storage";
import { FileAccounts, MemoryAccounts } from "./storage";
import { boot, call, closeAll, DAY, design, ORIGIN, PASSWORD, signUp, type Booted } from "./testServer";

const sockets: WebSocket[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await closeAll();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ADMIN_KEY = "an operator key of some length";
const METRICS_KEY = "a metrics key of some length";
/** A room with nobody in it leaves memory (and is written back) this soon in these tests. */
const IDLE = 60;

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`waited for ${what}`);
}

const tempDir = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `craftly-${name}-`));
  dirs.push(dir);
  return dir;
};

/** A team with its owner, a design in its space, and members of the roles asked for (each signed up with an invite). */
async function teamWith(b: Booted, roles: ("editor" | "viewer" | "owner")[] = []) {
  const owner = await signUp(b, { name: "Owner" });
  const made = await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Studio" } });
  expect(made.status).toBe(201);
  const teamId = made.body.team.id as string;
  const members = [];
  for (const role of roles) {
    const invite = await call(b, "POST", `/api/teams/${teamId}/invites`, { token: owner.token, body: { role, uses: 1, hours: 1 } });
    expect(invite.status).toBe(201);
    members.push(await signUp(b, { code: invite.body.code, name: role === "viewer" ? "Vee" : "Eddie" }));
  }
  const put = await call(b, "PUT", `/api/spaces/${teamId}/designs/d1`, { token: owner.token, body: { baseRev: null, design: design() } });
  expect(put.status).toBe(201);
  return { owner, teamId, members };
}

const openLive = (b: Booted, token: string, space: string, id = "d1") => call(b, "POST", `/api/spaces/${space}/designs/${id}/live`, { token });

/** A bare socket to a room: what it heard, and how it was closed. */
async function socket(b: Booted, room: string) {
  const ws = new WebSocket(`${b.base.replace(/^http/, "ws")}/ws?room=${encodeURIComponent(room)}`);
  sockets.push(ws);
  const heard: ServerMsg[] = [];
  let closed: number | null = null;
  ws.on("message", (d) => heard.push(JSON.parse(d.toString()) as ServerMsg));
  ws.on("close", (code) => (closed = code));
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  const say = (m: unknown) => ws.send(JSON.stringify(m));
  const welcome = () => heard.find((m): m is Extract<ServerMsg, { t: "welcome" }> => m.t === "welcome");
  const denied = () => heard.find((m): m is Extract<ServerMsg, { t: "denied" }> => m.t === "denied");
  return { ws, heard, say, welcome, denied, closed: () => closed };
}
type Sock = Awaited<ReturnType<typeof socket>>;

/** A socket that joins a room with a session, and waits for its welcome. */
async function member(b: Booted, room: string, session: string, client: string, features?: string[]) {
  const s = await socket(b, room);
  s.say({ t: "join", client, session, ...(features ? { features } : {}) });
  await until(`${client} to be welcomed`, () => !!s.welcome() || s.closed() !== null);
  return s;
}

/** A socket that joins and is turned away: what it was told, and the code of its close. */
async function refused(b: Booted, room: string, join: Record<string, unknown>) {
  const s = await socket(b, room);
  s.say({ t: "join", client: "x", ...join });
  await until("the refusal", () => s.closed() !== null);
  return { denied: s.denied()?.reason, code: s.closed(), welcomed: !!s.welcome() };
}

let seq = 0;
/** Sends one batch of operations and waits for its answer. */
async function edit(s: Sock, ops: unknown[]): Promise<Extract<ServerMsg, { t: "ack" | "rejected" }>> {
  const n = ++seq;
  s.say({ t: "ops", seq: n, ops });
  let answer: Extract<ServerMsg, { t: "ack" | "rejected" }> | undefined;
  await until(`the answer to batch ${n}`, () => {
    answer = s.heard.find((m): m is Extract<ServerMsg, { t: "ack" | "rejected" }> => (m.t === "ack" || m.t === "rejected") && m.seq === n);
    return !!answer;
  });
  return answer!;
}
const moveA = (x: number) => [{ k: "el.set", page: "p", id: "a", set: { x } }];

const comment = (id: string): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author: { name: "Ann", colorIndex: 3 },
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
});

const xOf = (d: { pages: { elements: { id: string; x: number }[] }[] }) => d.pages[0].elements.find((e) => e.id === "a")?.x;
/** The design of 	eamWith with its shape at x. */
const withX = (x: number) => design("d1", "Poster", { pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x })] })] });

async function metrics(b: Booted) {
  const res = await fetch(`${b.base}/metrics`, { headers: { authorization: `Bearer ${METRICS_KEY}` } });
  const { samples, problems } = parseMetrics(await res.text());
  expect(problems).toEqual([]);
  return (name: string) => samples.get(`craftly_live_${name}`);
}

describe("the join message", () => {
  it("takes a key, or a session and then no key, and nothing else", () => {
    const session = "s".repeat(43);
    expect(SESSION_TOKEN.test(session)).toBe(true);
    expect(joinCredential({ t: "join", client: "c", key: "k" })).toEqual({ key: "k" });
    expect(joinCredential({ t: "join", client: "c", session })).toEqual({ session });
    for (const bad of [
      { t: "join", client: "c" },
      { t: "join", client: "c", key: "" },
      { t: "join", client: "c", key: 5 },
      { t: "join", client: "c", key: "k".repeat(201) },
      { t: "join", client: "c", session: "short" },
      { t: "join", client: "c", session: `${session}=` },
      { t: "join", client: "c", session: "s".repeat(44) },
      { t: "join", client: "c", session: null },
      { t: "join", client: "c", session: 43 },
      { t: "join", client: "c", session, key: "k" },
      { t: "join", client: "c", session, key: undefined },
      null,
      "join",
    ]) {
      expect(joinCredential(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("opening a team design live", () => {
  it("gives a member the room bound to the design, the socket's address and their role; the same room every time", async () => {
    const b = await boot({}, { metricsKey: METRICS_KEY });
    const { owner, teamId, members } = await teamWith(b, ["editor", "viewer"]);
    const first = await openLive(b, members[0].token, teamId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ room: expect.stringMatching(ROOM_ID), ws: `/ws?room=${first.body.room}`, role: "edit" });
    expect((await openLive(b, owner.token, teamId)).body).toEqual({ ...first.body, role: "edit" });
    expect((await openLive(b, members[1].token, teamId)).body).toEqual({ ...first.body, role: "view" });
    const now = await metrics(b);
    expect(now("bound_rooms_made_total")).toBe(1);
    expect(now("bound_rooms_in_memory")).toBe(1);
  });

  it("is refused to anybody outside the space, for a design that is not there, and without a session", async () => {
    const b = await boot();
    const { teamId } = await teamWith(b);
    const outsider = await signUp(b);
    expect((await openLive(b, outsider.token, teamId)).body.code).toBe("not-found");
    expect((await call(b, "POST", `/api/spaces/${teamId}/designs/d1/live`)).status).toBe(401);
    const { owner } = await teamWith(b);
    expect((await openLive(b, owner.token, owner.user.id, "nothing")).body.code).toBe("not-found");
    expect((await call(b, "POST", `/api/spaces/${teamId}/designs/d1/live`, { token: owner.token, body: { x: 1 } })).status).toBe(404);
  });
});

describe("joining a bound room", () => {
  it("lets a member in with their session, to edit; a viewer to look and not touch", async () => {
    const b = await boot({}, { metricsKey: METRICS_KEY });
    const { teamId, members } = await teamWith(b, ["editor", "viewer"]);
    const { room } = (await openLive(b, members[0].token, teamId)).body;
    const editor = await member(b, room, members[0].token, "eddie");
    expect(editor.welcome()).toMatchObject({ role: "edit", rev: 0, design: { id: "d1", title: "Poster" } });
    expect((await edit(editor, moveA(42))).t).toBe("ack");
    const viewer = await member(b, room, members[1].token, "vee");
    expect(viewer.welcome()).toMatchObject({ role: "view" });
    expect(xOf(viewer.welcome()!.design as never)).toBe(42);
    expect(await edit(viewer, moveA(7))).toMatchObject({ t: "rejected" });
    const now = await metrics(b);
    expect(now("session_joins_total")).toBe(2);
  });

  it("turns away an outsider, a removed member, an expired, signed-out or malformed session, and a session with a key", async () => {
    const b = await boot({}, { metricsKey: METRICS_KEY });
    const { owner, teamId, members } = await teamWith(b, ["editor", "editor", "editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const outsider = await signUp(b);
    expect(await refused(b, room, { session: outsider.token })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    expect((await call(b, "DELETE", `/api/teams/${teamId}/members/${members[0].user.id}`, { token: owner.token })).status).toBe(200);
    expect(await refused(b, room, { session: members[0].token })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    expect((await call(b, "POST", "/api/auth/signout", { token: members[1].token })).status).toBe(200);
    expect(await refused(b, room, { session: members[1].token })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    expect(await refused(b, room, { session: "x".repeat(43) })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    expect(await refused(b, room, { session: "too short" })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    expect(await refused(b, room, { session: members[2].token, key: "k" })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    // the session of a member who stayed away for longer than a session lasts
    b.clock.advance(31 * DAY);
    expect(await refused(b, room, { session: members[2].token })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    expect((await metrics(b))("session_joins_refused_total")).toBe(5);
  });

  it("cannot be joined with a key, guessed or not, and its pictures are for members' sessions only", async () => {
    const b = await boot();
    const { owner, teamId, members } = await teamWith(b, ["viewer"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    for (const key of ["AAAAAAAAAAAAAAAAAAAAAA", "k", "a".repeat(200)]) {
      expect(await refused(b, room, { key })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
    }
    const picture = `/api/rooms/${room}/assets/img1`;
    expect((await call(b, "GET", picture, { headers: { "x-craftly-key": "AAAAAAAAAAAAAAAAAAAAAA" } })).status).toBe(403);
    expect((await call(b, "GET", picture, { token: (await signUp(b)).token })).status).toBe(403);
    expect((await call(b, "GET", picture, { token: members[0].token })).status).toBe(404); // in, and there is no such picture
    const png = { mime: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
    expect((await call(b, "PUT", picture, { token: members[0].token, body: png })).status).toBe(403); // a viewer
    expect((await call(b, "PUT", picture, { token: owner.token, body: png })).status).toBe(201);
    expect((await call(b, "GET", picture, { token: members[0].token })).body).toEqual(png);
  });

  it("leaves rooms of links as they were: a key lets in, a session does not", async () => {
    const b = await boot();
    const { owner } = await teamWith(b);
    const made = await call(b, "POST", "/api/rooms", { body: { design: design() } });
    expect(made.status).toBe(201);
    const s = await socket(b, made.body.room);
    s.say({ t: "join", client: "old", key: made.body.editKey });
    await until("the welcome", () => !!s.welcome());
    expect(s.welcome()).toMatchObject({ role: "edit" });
    expect((await edit(s, moveA(9))).t).toBe("ack");
    expect(await refused(b, made.body.room, { session: owner.token })).toEqual({ denied: "no-access", code: 4003, welcomed: false });
  });

  it("lets two members edit together, each seeing the other's edits", async () => {
    const b = await boot({}, { idleCloseMs: IDLE });
    const { owner, teamId, members } = await teamWith(b, ["editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const ann = await member(b, room, owner.token, "ann");
    const bob = await member(b, room, members[0].token, "bob");
    expect((await edit(ann, moveA(11))).t).toBe("ack");
    expect((await edit(bob, [{ k: "el.set", page: "p", id: "a", set: { y: 22 } }])).t).toBe("ack");
    await until("each to hear the other", () => bob.heard.some((m) => m.t === "ops") && ann.heard.some((m) => m.t === "ops"));
    ann.ws.close();
    bob.ws.close();
    await until("the design to be written back", async () => (await call(b, "GET", `/api/spaces/${teamId}/designs/d1`, { token: owner.token })).body.rev === 2);
    const back = (await call(b, "GET", `/api/spaces/${teamId}/designs/d1`, { token: owner.token })).body;
    expect(back.design.pages[0].elements[0]).toMatchObject({ id: "a", x: 11, y: 22 });
  });

  it("names each member to the others by their account, not by what their browser says", async () => {
    const b = await boot({}, { idleCloseMs: IDLE });
    const { owner, teamId, members } = await teamWith(b, ["editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const ann = await member(b, room, owner.token, "ann");
    const bob = await member(b, room, members[0].token, "bob");
    const where = { page: "p", pointer: { x: 1, y: 1 }, selection: [], editing: null };
    // a browser that gives no name (shown as "Guest 1" before), and one that claims another person's
    ann.say({ t: "presence", name: "", ...where });
    bob.say({ t: "presence", name: "Owner", ...where });
    const nameHeard = (s: Sock) => s.heard.flatMap((m) => (m.t === "presence" && "name" in m ? [m.name] : []));
    await until("each to hear the other", () => nameHeard(ann).length > 0 && nameHeard(bob).length > 0);
    expect(nameHeard(bob)).toEqual(["Owner"]);
    expect(nameHeard(ann)).toEqual(["Eddie"]);
    // and each is told, in their welcome, the name the others hear for them: they are shown to themselves under it (B4)
    expect(ann.welcome()).toMatchObject({ name: "Owner" });
    expect(bob.welcome()).toMatchObject({ name: "Eddie" });
  });
});

describe("while a bound room is in memory", () => {
  it("answers PUT, restore and delete of its design with 409 live; its details can still be changed", async () => {
    const b = await boot();
    const { owner, teamId } = await teamWith(b);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const path = `/api/spaces/${teamId}/designs/d1`;
    const put = await call(b, "PUT", path, { token: owner.token, body: { baseRev: 1, design: design("d1", "Other") } });
    expect(put.status).toBe(409);
    expect(put.body).toMatchObject({ code: "live", room });
    expect((await call(b, "POST", `${path}/restore`, { token: owner.token, body: { rev: 1 } })).body).toMatchObject({ code: "live", room });
    expect((await call(b, "DELETE", path, { token: owner.token })).body).toMatchObject({ code: "live", room });
    const meta = await call(b, "PATCH", `${path}/meta`, { token: owner.token, body: { starred: true, title: "Renamed" } });
    expect(meta.status).toBe(200);
    // another design of the space is not held up
    expect((await call(b, "PUT", `/api/spaces/${teamId}/designs/d2`, { token: owner.token, body: { baseRev: null, design: design("d2") } })).status).toBe(201);
  });
});

describe("writing back", () => {
  it("makes the room's design the next revision, comments too, when the last person leaves; then the room is made again from it", async () => {
    const b = await boot({}, { idleCloseMs: IDLE, metricsKey: METRICS_KEY });
    const { owner, teamId, members } = await teamWith(b, ["editor"]);
    const { room } = (await openLive(b, members[0].token, teamId)).body;
    const s = await member(b, room, members[0].token, "eddie", ["comments"]);
    expect((await edit(s, moveA(42))).t).toBe("ack");
    expect((await edit(s, [{ k: "comment.add", comment: comment("c1"), index: 0 }])).t).toBe("ack");
    expect((await edit(s, [{ k: "design", set: { title: "Renamed live" } }])).t).toBe("ack");
    s.ws.close();
    const path = `/api/spaces/${teamId}/designs/d1`;
    await until("the design to be written back", async () => (await call(b, "GET", path, { token: owner.token })).body.rev === 2);
    const back = (await call(b, "GET", path, { token: owner.token })).body;
    expect(xOf(back.design)).toBe(42);
    expect(back.design.comments.map((c: DesignComment) => c.id)).toEqual(["c1"]);
    expect(back.design.title).toBe("Renamed live");
    await until("the room to leave memory", () => b.server.rooms() === 0);
    // the space is the design's again
    const next = design("d1", "Renamed live", { pages: back.design.pages });
    expect((await call(b, "PUT", path, { token: owner.token, body: { baseRev: 2, design: next } })).status).toBe(200);
    const again = (await openLive(b, owner.token, teamId)).body.room;
    expect(again).toBe(room);
    const t = await member(b, again, owner.token, "owner");
    expect(t.welcome()).toMatchObject({ rev: 0 });
    expect(xOf(t.welcome()!.design as never)).toBe(42);
    const now = await metrics(b);
    expect(now("write_backs_total")).toBe(1);
    expect(now("write_back_failures_total")).toBe(0);
  });

  it("writes nothing when nothing changed", async () => {
    const b = await boot({}, { idleCloseMs: IDLE });
    const { owner, teamId } = await teamWith(b);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    (await member(b, room, owner.token, "owner")).ws.close();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    expect((await call(b, "GET", `/api/spaces/${teamId}/designs/d1/versions`, { token: owner.token })).body.current).toBe(1);
  });

  it("writes back when the server stops, and the revision is there after a restart (FileAccounts)", async () => {
    const accountsDir = tempDir("accounts");
    const roomsDir = tempDir("rooms");
    const first = await boot({ storage: new FileAccounts(accountsDir) }, { storage: new FileStorage(roomsDir) });
    const { owner, teamId } = await teamWith(first);
    const { room } = (await openLive(first, owner.token, teamId)).body;
    const s = await member(first, room, owner.token, "owner");
    expect((await edit(s, moveA(77))).t).toBe("ack");
    await closeAll();
    expect(await new FileStorage(roomsDir).load(room)).toBeNull(); // written back, so the room is not kept

    const second = await boot({ storage: new FileAccounts(accountsDir) }, { storage: new FileStorage(roomsDir) }, { clock: first.clock });
    const back = await call(second, "GET", `/api/spaces/${teamId}/designs/d1`, { token: owner.token });
    expect(back.body.rev).toBe(2);
    expect(xOf(back.body.design)).toBe(77);
  });

  it("keeps the room's copy when it cannot be written back, and the room comes back with it", async () => {
    const roomStorage: LiveStorage = new MemoryStorage();
    const b = await boot({ spaceQuotaBytes: 40_000 }, { idleCloseMs: IDLE, metricsKey: METRICS_KEY, storage: roomStorage });
    const { owner, teamId } = await teamWith(b);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const s = await member(b, room, owner.token, "owner");
    // more than the space may hold beside the revision before it
    expect((await edit(s, [{ k: "el.set", page: "p", id: "a", set: { name: "n".repeat(50_000) } }])).t).toBe("ack");
    s.ws.close();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    expect((await metrics(b))("write_back_failures_total")).toBe(1);
    expect((await roomStorage.load(room))?.design.pages[0].elements[0]).toMatchObject({ name: "n".repeat(50_000) });
    expect((await call(b, "GET", `/api/spaces/${teamId}/designs/d1`, { token: owner.token })).body.rev).toBe(1);
    // the space takes writes again (the room is not in memory), and opening it live again brings back the room's copy
    expect((await openLive(b, owner.token, teamId)).body.room).toBe(room);
    const t = await member(b, room, owner.token, "owner");
    expect(t.welcome()!.design.pages[0].elements[0]).toMatchObject({ name: "n".repeat(50_000) });
  });
});

describe("who may stay", () => {
  it("sends away an editor lowered to viewer (who comes back to look), and a removed member (who cannot come back)", async () => {
    const b = await boot({}, { metricsKey: METRICS_KEY });
    const { owner, teamId, members } = await teamWith(b, ["editor", "editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const [lowered, removed, stays] = [await member(b, room, members[0].token, "one"), await member(b, room, members[1].token, "two"), await member(b, room, owner.token, "own")];
    expect((await call(b, "PUT", `/api/teams/${teamId}/members/${members[0].user.id}`, { token: owner.token, body: { role: "viewer" } })).status).toBe(200);
    await until("the lowered editor to be sent away", () => lowered.closed() === 4003);
    expect(lowered.denied()?.reason).toBe("no-access");
    const back = await member(b, room, members[0].token, "one");
    expect(back.welcome()).toMatchObject({ role: "view" });
    expect((await call(b, "DELETE", `/api/teams/${teamId}/members/${members[1].user.id}`, { token: owner.token })).status).toBe(200);
    await until("the removed member to be sent away", () => removed.closed() === 4003);
    expect(await refused(b, room, { session: members[1].token })).toMatchObject({ denied: "no-access", code: 4003 });
    // a raise sends nobody away
    expect((await call(b, "PUT", `/api/teams/${teamId}/members/${members[0].user.id}`, { token: owner.token, body: { role: "editor" } })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(back.closed()).toBeNull();
    expect(stays.closed()).toBeNull();
    expect((await edit(stays, moveA(5))).t).toBe("ack");
    expect((await metrics(b))('connections_closed_total{reason="revoked"}')).toBe(2);
  });

  it("sends everybody away when the team is deleted, and the room is gone", async () => {
    const roomStorage = new MemoryStorage();
    const b = await boot({}, { storage: roomStorage });
    const { owner, teamId, members } = await teamWith(b, ["editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const [one, two] = [await member(b, room, owner.token, "own"), await member(b, room, members[0].token, "ed")];
    expect((await call(b, "DELETE", `/api/teams/${teamId}`, { token: owner.token })).status).toBe(200);
    await until("both to be sent away", () => one.closed() === 4003 && two.closed() === 4003);
    expect(await roomStorage.load(room)).toBeNull();
  });

  it("sends away a person whose account is disabled, or whose sessions end with a reset or a new password", async () => {
    const b = await boot({}, { adminKey: ADMIN_KEY });
    const { owner, teamId, members } = await teamWith(b, ["editor", "editor", "editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const [disabled, reset, changed, own] = [
      await member(b, room, members[0].token, "a"),
      await member(b, room, members[1].token, "b"),
      await member(b, room, members[2].token, "c"),
      await member(b, room, owner.token, "o"),
    ];
    const admin = await call(b, "POST", "/api/admin/accounts/disable", { origin: null, headers: { "x-craftly-admin-key": ADMIN_KEY }, body: { email: members[0].email } });
    expect(admin.status).toBe(200);
    await until("the disabled person to be sent away", () => disabled.closed() === 4003);
    const byRecovery = await call(b, "POST", "/api/auth/reset", { body: { email: members[1].email, recoveryCode: members[1].recoveryCode, newPassword: "another long password" } });
    expect(byRecovery.status).toBe(200);
    await until("the person who reset to be sent away", () => reset.closed() === 4003);
    // a new password ends every other session: this one signs in elsewhere and changes it there
    const elsewhere = await call(b, "POST", "/api/auth/signin", { body: { email: members[2].email, password: PASSWORD } });
    expect((await call(b, "POST", "/api/me/password", { token: elsewhere.body.token, body: { old: PASSWORD, new: "another long password" } })).status).toBe(200);
    await until("the old session to be sent away", () => changed.closed() === 4003);
    expect(own.closed()).toBeNull();
  });
});

describe("a bound room left on the disk", () => {
  /**
   * A team's design opened live and edited (x = 77), and a server started again on what the disk held at that moment: the room's
   * record with its copy (not written back: the server stopped without closing) and the space still at revision 1.
   */
  async function crashed() {
    const accounts = new MemoryAccounts();
    const rooms = new MemoryStorage();
    const first = await boot({}, { storage: rooms, idleCloseMs: 60_000 }, { storage: accounts });
    const { owner, teamId } = await teamWith(first);
    const { room } = (await openLive(first, owner.token, teamId)).body;
    const s = await member(first, room, owner.token, "owner");
    expect((await edit(s, moveA(77))).t).toBe("ack");
    const record = structuredClone(await rooms.load(room));
    const accountsThen = new MemoryAccounts();
    for (const key of accounts.rawKeys()) accountsThen.setRawText(key, accounts.rawText(key)!);
    s.ws.terminate();
    await closeAll();
    const roomsThen = new MemoryStorage();
    await roomsThen.save(room, record!);
    const b = await boot({}, { storage: roomsThen, idleCloseMs: IDLE }, { storage: accountsThen, clock: first.clock });
    return { b, owner, teamId, room, rooms: roomsThen, path: `/api/spaces/${teamId}/designs/d1` };
  }
  /** The copy that a room whose space moved on was kept as: "Poster (edited live)", read from the space. */
  async function liveCopy(b: Booted, token: string, space: string) {
    const feed = (await call(b, "GET", `/api/spaces/${space}/changes`, { token })).body;
    const found = feed.designs.find((d: { title: string }) => d.title === "Poster (edited live)");
    expect(found, JSON.stringify(feed.designs.map((d: { title: string }) => d.title))).toBeTruthy();
    return (await call(b, "GET", `/api/spaces/${space}/designs/${found.id}`, { token })).body;
  }

  it("never overwrites a newer revision: opened again, the room is made from the space, and its copy is kept as a new design", async () => {
    const { b, owner, teamId, room, path } = await crashed();
    // a browser's sync: the room is not in memory, so the space takes the write
    expect((await call(b, "PUT", path, { token: owner.token, body: { baseRev: 1, design: withX(5) } })).body).toEqual({ rev: 2 });
    expect((await openLive(b, owner.token, teamId)).body.room).toBe(room);
    const t = await member(b, room, owner.token, "owner");
    expect(xOf(t.welcome()!.design as never)).toBe(5);
    t.ws.close();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    const now = (await call(b, "GET", path, { token: owner.token })).body;
    expect(now.rev).toBe(2);
    expect(xOf(now.design)).toBe(5);
    expect(xOf((await liveCopy(b, owner.token, teamId)).design)).toBe(77);
  });

  it("joined straight by its id after its space moved on, writes its copy back as a new design, not over the newer revision", async () => {
    const { b, owner, teamId, room, path, rooms } = await crashed();
    expect((await call(b, "PUT", path, { token: owner.token, body: { baseRev: 1, design: withX(5) } })).body).toEqual({ rev: 2 });
    const t = await member(b, room, owner.token, "owner");
    expect(xOf(t.welcome()!.design as never)).toBe(77);
    expect((await edit(t, moveA(88))).t).toBe("ack");
    t.ws.close();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    const now = (await call(b, "GET", path, { token: owner.token })).body;
    expect(now.rev).toBe(2);
    expect(xOf(now.design)).toBe(5);
    expect(xOf((await liveCopy(b, owner.token, teamId)).design)).toBe(88);
    expect(await rooms.load(room)).toBeNull();
  });

  /** A room whose write-back failed (the space is full), kept on the disk with its copy. */
  async function keptOnDisk(b: Booted, rooms: LiveStorage, token: string, teamId: string, id = "d1") {
    const { room } = (await openLive(b, token, teamId, id)).body;
    const s = await member(b, room, token, "owner");
    expect((await edit(s, [{ k: "el.set", page: "p", id: "a", set: { name: "n".repeat(50_000) } }])).t).toBe("ack");
    s.ws.close();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    expect(await rooms.load(room)).not.toBeNull();
    return room;
  }

  it("is dropped when its design is deleted, and no longer counts towards the rooms a server may hold", async () => {
    const rooms = new MemoryStorage();
    const b = await boot({ spaceQuotaBytes: 40_000 }, { idleCloseMs: IDLE, storage: rooms, maxRooms: 1 });
    const { owner, teamId } = await teamWith(b);
    const room = await keptOnDisk(b, rooms, owner.token, teamId);
    expect((await call(b, "DELETE", `/api/spaces/${teamId}/designs/d1`, { token: owner.token })).status).toBe(200);
    await until("the room to be dropped", async () => (await rooms.load(room)) === null);
    expect((await call(b, "PUT", `/api/spaces/${teamId}/designs/d2`, { token: owner.token, body: { baseRev: null, design: design("d2") } })).status).toBe(201);
    expect((await openLive(b, owner.token, teamId, "d2")).status).toBe(200);
  });

  it("is dropped when its team is deleted, and no longer counts towards the rooms a server may hold", async () => {
    const rooms = new MemoryStorage();
    const b = await boot({ spaceQuotaBytes: 40_000 }, { idleCloseMs: IDLE, storage: rooms, maxRooms: 1 });
    const { owner, teamId } = await teamWith(b);
    const room = await keptOnDisk(b, rooms, owner.token, teamId);
    expect((await call(b, "DELETE", `/api/teams/${teamId}`, { token: owner.token })).status).toBe(200);
    await until("the room to be dropped", async () => (await rooms.load(room)) === null);
    const other = await teamWith(b);
    expect((await openLive(b, other.owner.token, other.teamId)).status).toBe(200);
  });

  it("is dropped, not kept for ever, when it leaves memory and its design is gone", async () => {
    const { b, owner, teamId, room, rooms } = await crashed();
    // the design deleted for good on a server that did not know of the room (no hook told it): the room has nowhere to go
    const m = JSON.parse((b.storage as MemoryAccounts).rawText(`spaces/${teamId}/manifest.json`) ?? "null");
    expect(m, "the manifest's key").not.toBeNull();
    m.designs.d1.deletedAt = b.clock.now();
    (b.storage as MemoryAccounts).setRawText(`spaces/${teamId}/manifest.json`, JSON.stringify(m));
    const t = await member(b, room, owner.token, "owner");
    expect((await edit(t, moveA(3))).t).toBe("ack");
    t.ws.close();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    expect(await rooms.load(room)).toBeNull();
  });
});

describe("a viewer", () => {
  it("cannot open a design live that no editor has open, and their seat does not keep the room in memory", async () => {
    const b = await boot({}, { idleCloseMs: IDLE });
    const { owner, teamId, members } = await teamWith(b, ["viewer"]);
    const alone = await openLive(b, members[0].token, teamId);
    expect(alone.status).toBe(409);
    expect(alone.body.code).toBe("not-live");
    expect(b.server.rooms()).toBe(0);
    const path = `/api/spaces/${teamId}/designs/d1`;
    expect((await call(b, "PUT", path, { token: owner.token, body: { baseRev: 1, design: withX(1) } })).status).toBe(200);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const ed = await member(b, room, owner.token, "own");
    expect((await openLive(b, members[0].token, teamId)).body).toMatchObject({ room, role: "view" });
    const vee = await member(b, room, members[0].token, "vee");
    expect((await edit(ed, moveA(31))).t).toBe("ack");
    ed.ws.close();
    // the editors are gone: the room goes back to its space, and the viewer with it
    await until("the viewer to be sent away", () => vee.closed() !== null);
    expect(vee.closed()).toBe(4004);
    expect(vee.denied()?.reason).toBe("not-found");
    await until("the design to be written back", async () => (await call(b, "GET", path, { token: owner.token })).body.rev === 3);
    expect((await call(b, "PUT", path, { token: owner.token, body: { baseRev: 3, design: withX(2) } })).status).toBe(200);
  });
});

describe("a session that runs out by its time", () => {
  it("sends its socket away from a bound room; a session in use stays, and looking it up again does not keep it alive", async () => {
    const b = await boot({}, { seatCheckEveryMs: 40 });
    const { owner, teamId, members } = await teamWith(b, ["editor"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const ed = await member(b, room, members[0].token, "ed");
    const own = await member(b, room, owner.token, "own");
    b.clock.advance(29 * DAY);
    await new Promise((r) => setTimeout(r, 200));
    expect(ed.closed()).toBeNull();
    // the owner's browser is used meanwhile (sync), the editor's is not
    expect((await call(b, "GET", "/api/me", { token: owner.token })).status).toBe(200);
    b.clock.advance(2 * DAY);
    await until("the expired session to be sent away", () => ed.closed() !== null);
    expect(ed.closed()).toBe(4003);
    expect(ed.denied()?.reason).toBe("no-access");
    await new Promise((r) => setTimeout(r, 200));
    expect(own.closed()).toBeNull();
  });
});

describe("the origin of a page", () => {
  it("is asked of POST …/live as of every request of the accounts", async () => {
    const b = await boot();
    const { owner, teamId } = await teamWith(b);
    expect((await call(b, "POST", `/api/spaces/${teamId}/designs/d1/live`, { token: owner.token, origin: "http://evil.example" })).body.code).toBe("origin");
    expect((await call(b, "POST", `/api/spaces/${teamId}/designs/d1/live`, { token: owner.token, origin: ORIGIN })).status).toBe(200);
  });
});

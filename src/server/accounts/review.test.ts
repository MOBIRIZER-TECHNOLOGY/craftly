/**
 * Review and approval in a team's room (docs/REVIEW.md), through the real server with real WebSockets: the commenter role, who
 * opens the room, comments and approves and may change nothing else; comments that only their author changes and an owner
 * deletes; an approval tied to the content it was given for; what is written back to the space; and seats sent away when a role
 * goes down.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMsg } from "@/collab/protocol";
import { contentRevision } from "@/core/review";
import type { CommentAuthor, Design, DesignComment } from "@/core/types";
import { boot, call, closeAll, design, signUp, type Booted } from "./testServer";

const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await closeAll();
});

const IDLE = 60;
const BOTH = ["comments", "review"];

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`waited for ${what}`);
}

/** A team with its owner, a design in its space, and one member of each role asked for. */
async function teamWith(b: Booted, roles: string[]) {
  const owner = await signUp(b, { name: "Owner" });
  const teamId = (await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Studio" } })).body.team.id as string;
  const members = [];
  for (const role of roles) {
    const invite = await call(b, "POST", `/api/teams/${teamId}/invites`, { token: owner.token, body: { role, uses: 1, hours: 1 } });
    expect(invite.status).toBe(201);
    members.push(await signUp(b, { code: invite.body.code, name: role === "commenter" ? "Cora" : "Eddie" }));
  }
  expect((await call(b, "PUT", `/api/spaces/${teamId}/designs/d1`, { token: owner.token, body: { baseRev: null, design: design() } })).status).toBe(201);
  return { owner, teamId, members };
}

const openLive = (b: Booted, token: string, space: string) => call(b, "POST", `/api/spaces/${space}/designs/d1/live`, { token });

async function member(b: Booted, room: string, session: string, client: string, features: string[] = BOTH) {
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
  ws.send(JSON.stringify({ t: "join", client, session, features }));
  const welcome = () => heard.find((m): m is Extract<ServerMsg, { t: "welcome" }> => m.t === "welcome");
  await until(`${client} to be welcomed`, () => !!welcome() || closed !== null);
  return { ws, heard, welcome, closed: () => closed };
}
type Sock = Awaited<ReturnType<typeof member>>;

let seq = 0;
async function send(s: Sock, ops: unknown[]): Promise<Extract<ServerMsg, { t: "ack" | "rejected" }>> {
  const n = ++seq;
  s.ws.send(JSON.stringify({ t: "ops", seq: n, ops }));
  let answer: Extract<ServerMsg, { t: "ack" | "rejected" }> | undefined;
  await until(`the answer to batch ${n}`, () => {
    answer = s.heard.find((m): m is Extract<ServerMsg, { t: "ack" | "rejected" }> => (m.t === "ack" || m.t === "rejected") && m.seq === n);
    return !!answer;
  });
  return answer!;
}

const as = (who: { user: { id: string; name: string } }): CommentAuthor => ({ name: who.user.name, colorIndex: 4, id: who.user.id });
const comment = (id: string, author: CommentAuthor): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author,
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
});
const approve = (by: CommentAuthor, d: Design, state = "approved") => [{ k: "review.set", review: { v: 1, state, revision: contentRevision(d), by, at: 5 } }];

describe("a commenter of a team", () => {
  it("is a role like any other: invited, set and listed", async () => {
    const b = await boot();
    const { owner, teamId, members } = await teamWith(b, ["commenter", "editor"]);
    const team = (await call(b, "GET", `/api/teams/${teamId}`, { token: owner.token })).body;
    expect(team.members.map((m: { role: string }) => m.role).sort()).toEqual(["commenter", "editor", "owner"]);
    expect((await call(b, "PUT", `/api/teams/${teamId}/members/${members[1].user.id}`, { token: owner.token, body: { role: "commenter" } })).status).toBe(200);
    const wrong = await call(b, "PUT", `/api/teams/${teamId}/members/${members[1].user.id}`, { token: owner.token, body: { role: "reviewer" } });
    expect(wrong.body.error).toBe("a role is owner, editor, commenter or viewer");
    // the space is read, never written, by a commenter
    expect((await call(b, "GET", `/api/spaces/${teamId}/designs/d1`, { token: members[0].token })).status).toBe(200);
    const put = await call(b, "PUT", `/api/spaces/${teamId}/designs/d1`, { token: members[0].token, body: { baseRev: 1, design: design() } });
    expect([put.status, put.body.code]).toEqual([403, "forbidden"]);
  });

  it("opens the room with nobody else in it, comments in their own name and approves; nothing else of theirs is taken", async () => {
    const b = await boot({}, { idleCloseMs: IDLE });
    const { owner, teamId, members } = await teamWith(b, ["commenter"]);
    const [cora] = members;
    const live = (await openLive(b, cora.token, teamId)).body;
    expect(live.role).toBe("comment");
    const s = await member(b, live.room, cora.token, "cora");
    expect(s.welcome()).toMatchObject({ role: "comment", features: BOTH, name: "Cora" });
    const d = s.welcome()!.design;
    expect(await send(s, [{ k: "el.set", page: "p", id: "a", set: { x: 9 } }])).toMatchObject({ t: "rejected", reason: "this seat may only comment" });
    expect(await send(s, [{ k: "comment.add", comment: comment("c1", as(owner)), index: 0 }])).toMatchObject({ t: "rejected" });
    expect((await send(s, [{ k: "comment.add", comment: comment("c1", as(cora)), index: 0 }])).t).toBe("ack");
    expect(await send(s, approve(as(cora), d, "requested"))).toMatchObject({ reason: "review.set: a review is asked for by somebody who may edit" });
    expect((await send(s, approve(as(cora), d))).t).toBe("ack");
    // the commenter's seat keeps the room in memory, as an editor's does: the space takes no write of the design meanwhile
    expect((await call(b, "PUT", `/api/spaces/${teamId}/designs/d1`, { token: owner.token, body: { baseRev: 1, design: design() } })).body.code).toBe("live");
    s.ws.close();
    await until("the room to be written back", async () => (await call(b, "GET", `/api/spaces/${teamId}/designs/d1`, { token: owner.token })).body.rev === 2);
    const back = (await call(b, "GET", `/api/spaces/${teamId}/designs/d1`, { token: owner.token })).body.design as Design;
    expect(back.comments?.map((c) => c.author)).toEqual([as(cora)]);
    expect(back.review).toMatchObject({ state: "approved", by: as(cora), revision: contentRevision(back) });
  });

  it("with a browser from before reviews only looks", async () => {
    const b = await boot();
    const { owner, teamId, members } = await teamWith(b, ["commenter"]);
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const old = await member(b, room, members[0].token, "old", ["comments"]);
    expect(old.welcome()).toMatchObject({ role: "view", features: ["comments"] });
    expect(old.welcome()!.design.review).toBeUndefined();
  });
});

describe("comments in a team's room", () => {
  it("are changed by their author only, deleted by their author or an owner, and resolved by anybody who may comment", async () => {
    const b = await boot();
    const { owner, teamId, members } = await teamWith(b, ["commenter", "editor"]);
    const [cora, eddie] = members;
    const { room } = (await openLive(b, eddie.token, teamId)).body;
    const [c, e, o] = [await member(b, room, cora.token, "c"), await member(b, room, eddie.token, "e"), await member(b, room, owner.token, "o")];
    expect((await send(c, [{ k: "comment.add", comment: comment("c1", as(cora)), index: 0 }])).t).toBe("ack");
    expect(await send(e, [{ k: "comment.set", id: "c1", set: { text: "my words now" } }])).toMatchObject({ reason: "comment.set: only its author changes a comment" });
    expect(await send(o, [{ k: "comment.set", id: "c1", set: { text: "the owner's words" } }])).toMatchObject({ t: "rejected" });
    expect((await send(e, [{ k: "comment.set", id: "c1", set: { resolved: true } }])).t).toBe("ack");
    expect((await send(c, [{ k: "comment.set", id: "c1", set: { text: "clearer", editedAt: 9 } }])).t).toBe("ack");
    expect(await send(e, [{ k: "comment.del", id: "c1" }])).toMatchObject({ reason: "comment.del: only its author or an owner deletes a comment" });
    expect((await send(o, [{ k: "comment.del", id: "c1" }])).t).toBe("ack");
  });

  it("are never written as an account in a room of a link", async () => {
    const b = await boot();
    const made = (await call(b, "POST", "/api/rooms", { body: { design: design("shared") } })).body;
    const ws = new WebSocket(`${b.base.replace(/^http/, "ws")}/ws?room=${encodeURIComponent(made.room)}`);
    sockets.push(ws);
    const heard: ServerMsg[] = [];
    ws.on("message", (raw) => heard.push(JSON.parse(raw.toString()) as ServerMsg));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ t: "join", client: "l", key: made.editKey, features: BOTH }));
    await until("the welcome", () => heard.some((m) => m.t === "welcome"));
    const s = { ws, heard, welcome: () => undefined, closed: () => null } as unknown as Sock;
    expect(await send(s, [{ k: "comment.add", comment: comment("c1", { name: "Ann", colorIndex: 1, id: "u_0123456789abcdef" }), index: 0 }])).toMatchObject({ t: "rejected" });
    expect((await send(s, [{ k: "comment.add", comment: comment("c1", { name: "Ann", colorIndex: 1 }), index: 0 }])).t).toBe("ack");
  });
});

describe("an approval in a team's room", () => {
  it("is of the content the server holds: one made before an edit it had not seen is refused", async () => {
    const b = await boot();
    const { teamId, members } = await teamWith(b, ["commenter", "editor"]);
    const [cora, eddie] = members;
    const { room } = (await openLive(b, eddie.token, teamId)).body;
    const [c, e] = [await member(b, room, cora.token, "c"), await member(b, room, eddie.token, "e")];
    const seen = c.welcome()!.design;
    expect((await send(e, approve(as(eddie), seen, "requested"))).t).toBe("ack");
    expect((await send(e, [{ k: "el.set", page: "p", id: "a", set: { x: 77 } }])).t).toBe("ack");
    expect(await send(c, approve(as(cora), seen))).toMatchObject({ reason: "review.set: the design has changed since; look at it again" });
  });
});

describe("a role that goes down", () => {
  it("sends the seat away: editor to commenter and commenter to viewer; a raise sends nobody away", async () => {
    const b = await boot();
    const { owner, teamId, members } = await teamWith(b, ["editor", "commenter"]);
    const [eddie, cora] = members;
    const { room } = (await openLive(b, owner.token, teamId)).body;
    const [e, c] = [await member(b, room, eddie.token, "e"), await member(b, room, cora.token, "c")];
    const setRole = (who: { user: { id: string } }, role: string) => call(b, "PUT", `/api/teams/${teamId}/members/${who.user.id}`, { token: owner.token, body: { role } });
    expect((await setRole(eddie, "commenter")).status).toBe(200);
    await until("the lowered editor to be sent away", () => e.closed() === 4003);
    expect((await member(b, room, eddie.token, "e")).welcome()).toMatchObject({ role: "comment" });
    expect((await setRole(cora, "viewer")).status).toBe(200);
    await until("the lowered commenter to be sent away", () => c.closed() === 4003);
    const back = await member(b, room, cora.token, "c");
    expect(back.welcome()).toMatchObject({ role: "view" });
    expect((await setRole(cora, "commenter")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(back.closed()).toBeNull();
  });
});

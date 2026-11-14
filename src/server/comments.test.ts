/**
 * Comments through the real server, with real WebSockets: the server says it shares them only to a browser that said it
 * understands them, passes comment operations on only to such browsers (an older browser in the same room is sent the batch
 * without them, and is not ended), keeps comments with the design of the room, and counts them against its size.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import type { Op } from "@/collab/ops";
import type { ServerMsg } from "@/collab/protocol";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design, DesignComment } from "@/core/types";
import { createLiveServer, type LiveServer, type LiveServerOptions } from "./live";
import { MemoryStorage } from "./storage";

const comment = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author: { name: "Ann", colorIndex: 3 },
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
  ...extra,
});
const design = (comments?: DesignComment[]): Design => {
  const made = createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });
  return comments ? { ...made, comments } : made;
};

const servers: LiveServer[] = [];
const sockets: WebSocket[] = [];
const lives: Live[] = [];
afterEach(async () => {
  for (const l of lives.splice(0)) l.stop();
  for (const s of sockets.splice(0)) s.terminate();
  for (const server of servers.splice(0)) await server.close();
});

async function boot(start: Design = design(), options: Partial<LiveServerOptions> = {}) {
  const storage = new MemoryStorage();
  const server = createLiveServer({ storage, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  const http = `http://127.0.0.1:${port}`;
  const res = await fetch(`${http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: start }) });
  const made = (await res.json()) as { room: string; editKey: string; viewKey: string };
  return { storage, made, http, ws: `ws://127.0.0.1:${port}/ws?room=${made.room}` };
}
type Booted = Awaited<ReturnType<typeof boot>>;

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

/** A raw connection that joins with `features` (none: a browser from before comments) and keeps what it heard. */
async function raw(b: Booted, client: string, features?: unknown) {
  const ws = new WebSocket(b.ws);
  sockets.push(ws);
  const heard: ServerMsg[] = [];
  let closed: number | null = null;
  ws.on("message", (d) => heard.push(JSON.parse(d.toString()) as ServerMsg));
  ws.on("close", (code) => (closed = code));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  const say = (m: unknown) => ws.send(JSON.stringify(m));
  say({ t: "join", client, key: b.made.editKey, ...(features === undefined ? {} : { features }) });
  await until(`${client} to be let in`, () => heard.some((m) => m.t === "welcome"));
  const welcome = heard.find((m) => m.t === "welcome") as Extract<ServerMsg, { t: "welcome" }>;
  return { ws, heard, say, welcome, closed: () => closed, ops: () => heard.filter((m): m is Extract<ServerMsg, { t: "ops" }> => m.t === "ops").map((m) => m.ops) };
}

/** A browser of this version: `Live` with comments, as the editor makes it. */
function browser(b: Booted, client: string) {
  const live = new Live({
    url: b.ws,
    key: b.made.editKey,
    client,
    features: ["comments"],
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    onChange: () => undefined,
  });
  lives.push(live);
  live.start();
  return live;
}

describe("comments through the server", () => {
  it("are shared between two browsers of this version that comment at the same moment, and kept with the room", async () => {
    const b = await boot();
    const [ann, bob] = [browser(b, "ann"), browser(b, "bob")];
    await until("both to be in", () => ann.status === "live" && bob.status === "live");
    expect(ann.sharesComments).toBe(true);
    const base = ann.design!;
    ann.edit(base, { ...base, comments: [comment("from-ann")] });
    bob.edit(base, { ...base, comments: [comment("from-bob", { author: { name: "Bob", colorIndex: 1 } })] });
    await until("both to have both", () => [ann, bob].every((l) => (l.design?.comments ?? []).length === 2 && l.session.pending === 0));
    const saved = await b.storage.load(b.made.room);
    expect((saved!.design.comments ?? []).map((c) => c.id).sort()).toEqual(["from-ann", "from-bob"]);
  });

  it("are in the design that makes the room, and a browser of this version is welcomed with them and told they are shared", async () => {
    const b = await boot(design([comment("c")]));
    const ann = await raw(b, "ann", ["comments"]);
    expect(ann.welcome.features).toEqual(["comments"]);
    expect(ann.welcome.design.comments).toEqual([comment("c")]);
  });

  it("never reach a browser from before comments: its welcome has none, it is sent the batch without them, and it is not closed", async () => {
    const b = await boot(design([comment("c")]));
    const old = await raw(b, "old");
    expect(old.welcome.features).toBeUndefined();
    expect("comments" in old.welcome.design).toBe(false);
    const ann = await raw(b, "ann", ["comments"]);
    ann.say({ t: "ops", seq: 1, ops: [{ k: "comment.add", comment: comment("d"), index: 1 }] });
    ann.say({
      t: "ops",
      seq: 2,
      ops: [
        { k: "comment.set", id: "c", set: { resolved: true } },
        { k: "el.set", page: "p", id: "a", set: { x: 7 } },
      ],
    });
    await until("the old one to hear both batches", () => old.ops().length === 2);
    expect(old.ops()).toEqual([[], [{ k: "el.set", page: "p", id: "a", set: { x: 7 } }] as Op[]]);
    expect(old.closed()).toBeNull();
    const saved = await b.storage.load(b.made.room);
    expect(saved!.design.comments!.map((c) => [c.id, c.resolved])).toEqual([
      ["c", true],
      ["d", false],
    ]);
  });

  it("are not sent to a browser whose join names features in a form they cannot have", async () => {
    const b = await boot(design([comment("c")]));
    const odd = await raw(b, "odd", "comments");
    expect(odd.welcome.features).toBeUndefined();
    expect("comments" in odd.welcome.design).toBe(false);
  });

  it("refuse a room whose design brings comments that are not comments", async () => {
    const b = await boot();
    const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design([{ ...comment("c"), text: "x".repeat(2001) }]) }) });
    expect(res.status).toBe(400);
  });

  it("count against the size of a room: a comment that would take it past the limit is refused", async () => {
    const start = design();
    const b = await boot(start, { maxDesignBytes: JSON.stringify(start).length + 2500 });
    const ann = await raw(b, "ann", ["comments"]);
    ann.say({ t: "ops", seq: 1, ops: [{ k: "comment.add", comment: comment("big", { text: "x".repeat(2000) }), index: 0 }] });
    ann.say({ t: "ops", seq: 2, ops: [{ k: "comment.add", comment: comment("big2", { text: "y".repeat(2000) }), index: 0 }] });
    await until("both answers", () => ann.heard.filter((m) => m.t === "ack" || m.t === "rejected").length === 2);
    expect(ann.heard.filter((m) => m.t === "ack" || m.t === "rejected").map((m) => m.t)).toEqual(["ack", "rejected"]);
  });
});

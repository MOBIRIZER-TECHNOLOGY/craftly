/**
 * Presence through the real server, with real WebSockets: what one connection says about where its person is reaches the others
 * in the room under the number the server gave that connection, is saved nowhere, and has an allowance of its own, so that a
 * pointer that moves never costs a person their edits and a flood of it still ends the connection.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { PresenceHeard, PresenceState } from "@/collab/presence";
import type { ServerMsg } from "@/collab/protocol";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { createLiveServer, type LiveServer, type LiveServerOptions } from "./live";
import { parseMetrics } from "./metricsText";
import { MemoryStorage } from "./storage";

const design = (): Design =>
  createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 })] })] });
const METRICS_KEY = "a-key-for-the-scraper";

const servers: LiveServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const server of servers.splice(0)) await server.close();
});

/** A storage that counts how often a room is written. */
class Counting extends MemoryStorage {
  saves = 0;
  override async save(...args: Parameters<MemoryStorage["save"]>) {
    this.saves++;
    return super.save(...args);
  }
}

async function boot(options: Partial<LiveServerOptions> = {}) {
  const storage = new Counting();
  const server = createLiveServer({ storage, metricsKey: METRICS_KEY, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  const http = `http://127.0.0.1:${port}`;
  const res = await fetch(`${http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design() }) });
  const made = (await res.json()) as { room: string; editKey: string; viewKey: string };
  const metric = async (name: string) => {
    const text = await (await fetch(`${http}/metrics`, { headers: { authorization: `Bearer ${METRICS_KEY}` } })).text();
    return parseMetrics(text).samples.get(`craftly_live_${name}`);
  };
  return { storage, made, metric, ws: `ws://127.0.0.1:${port}/ws?room=${made.room}` };
}
type Booted = Awaited<ReturnType<typeof boot>>;

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

/** A connection that has joined, and what it heard since. */
async function joined(b: Booted, client: string, key = b.made.editKey) {
  const ws = new WebSocket(b.ws);
  sockets.push(ws);
  const heard: ServerMsg[] = [];
  let closed: number | null = null;
  ws.on("message", (d) => heard.push(JSON.parse(d.toString()) as ServerMsg));
  ws.on("close", (code) => (closed = code));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  const say = (m: unknown) => ws.send(JSON.stringify(m));
  say({ t: "join", client, key });
  await until(`${client} to be let in`, () => heard.some((m) => m.t === "welcome"));
  const welcome = heard.find((m) => m.t === "welcome") as Extract<ServerMsg, { t: "welcome" }>;
  return { ws, heard, say, number: welcome.peer as number, closed: () => closed, presences: () => heard.filter((m): m is PresenceHeard => m.t === "presence") };
}

const here = (over: Partial<PresenceState> = {}): PresenceState => ({ name: "Ana", page: "p", pointer: { x: 3, y: 4 }, selection: ["a"], editing: null, ...over });
const move = (seq: number, x: number) => ({ t: "ops", seq, ops: [{ k: "el.set", page: "p", id: "a", set: { x } }] });
/** Every message of a connection is handled in the order it was sent, so the answer to a ping says that all before it were. */
const settled = async (who: Awaited<ReturnType<typeof joined>>) => {
  const before = who.heard.filter((m) => m.t === "pong").length;
  who.say({ t: "ping" });
  await until("the server to have read everything", () => who.heard.filter((m) => m.t === "pong").length > before);
};

describe("presence through the server", () => {
  it("reaches the others under the number of the connection that said it, not the one who said it, and is saved nowhere", async () => {
    const b = await boot();
    const [ana, bob, cat] = [await joined(b, "ana"), await joined(b, "bob"), await joined(b, "cat", b.made.viewKey)];
    expect(new Set([ana.number, bob.number, cat.number]).size).toBe(3);
    const saves = b.storage.saves;
    ana.say({ t: "presence", ...here() });
    const told = { t: "presence", peer: ana.number, ...here() };
    await until("the others to hear where Ana is", () => bob.presences().length === 1 && cat.presences().length === 1);
    expect(bob.presences()).toEqual([told]);
    expect(cat.presences()).toEqual([told]); // somebody who only looks sees the others too
    await settled(ana);
    expect(ana.heard.map((m) => m.t)).toEqual(["welcome", "pong"]);
    expect(b.storage.saves).toBe(saves);
    expect((await b.storage.load(b.made.room))?.rev).toBe(0);
    expect(JSON.stringify(await b.storage.load(b.made.room))).not.toContain("Ana");
  });

  it("lets nobody speak for another: a number in what a browser says is not believed, and the message is not passed on", async () => {
    const b = await boot();
    const [ana, bob, cat] = [await joined(b, "ana"), await joined(b, "bob"), await joined(b, "cat")];
    ana.say({ t: "presence", ...here({ name: "Bob" }), peer: bob.number });
    ana.say({ t: "presence", ...here({ name: "Really Ana" }) });
    await until("Cat to hear of Ana", () => cat.presences().length > 0);
    expect(cat.presences()).toEqual([{ t: "presence", peer: ana.number, ...here({ name: "Really Ana" }) }]);
    expect(bob.presences()).toHaveLength(1);
  });

  it("passes on the pointer of somebody who only looks, without a selection or a text they type in", async () => {
    const b = await boot();
    const [viewer, ana] = [await joined(b, "viewer", b.made.viewKey), await joined(b, "ana")];
    viewer.say({ t: "presence", ...here({ name: "Vi", selection: ["a"], editing: "a" }) });
    await until("Ana to hear of the viewer", () => ana.presences().length === 1);
    expect(ana.presences()[0]).toEqual({ t: "presence", peer: viewer.number, ...here({ name: "Vi", selection: [], editing: null }) });
  });

  it("tells the others that somebody has gone when their connection closes", async () => {
    const b = await boot();
    const [ana, bob] = [await joined(b, "ana"), await joined(b, "bob")];
    ana.say({ t: "presence", ...here() });
    await until("Bob to hear of Ana", () => bob.presences().length === 1);
    ana.ws.close();
    await until("Bob to hear that Ana went", () => bob.presences().length === 2);
    expect(bob.presences()[1]).toEqual({ t: "presence", peer: ana.number, gone: true });
  });

  it("is not listened to before the key has been shown", async () => {
    const b = await boot();
    const bob = await joined(b, "bob");
    const stranger = new WebSocket(b.ws);
    sockets.push(stranger);
    await new Promise<void>((resolve) => stranger.on("open", () => resolve()));
    stranger.send(JSON.stringify({ t: "presence", ...here() }));
    const ana = await joined(b, "ana");
    ana.say({ t: "presence", ...here() });
    await until("Bob to hear of Ana", () => bob.presences().length > 0);
    expect(bob.presences()).toEqual([{ t: "presence", peer: ana.number, ...here() }]);
  });
});

describe("how much presence a connection may send", () => {
  it("drops what is more than its allowance without a word: the connection stays, the others hear only so much, and it is counted", async () => {
    const b = await boot({ presenceRate: { burst: 10, perSecond: 0.001 } });
    const [ana, bob] = [await joined(b, "ana"), await joined(b, "bob")];
    for (let i = 0; i < 50; i++) ana.say({ t: "presence", ...here({ pointer: { x: i, y: 0 } }) });
    await settled(ana);
    expect(ana.closed()).toBeNull();
    await until("Bob to hear the ten that were allowed", () => bob.presences().length === 10);
    await settled(bob);
    expect(bob.presences()).toHaveLength(10);
    expect(bob.presences().at(-1)).toMatchObject({ pointer: { x: 9, y: 0 } });
    expect(await b.metric("presence_dropped_total")).toBe(40);
    // and an edit of the same connection still goes through
    ana.say(move(1, 5));
    await until("the edit to be acknowledged", () => ana.heard.some((m) => m.t === "ack"));
  });

  it("does not take from what a connection may send in edits: a pointer that moves never costs a person their typing", async () => {
    // four messages are all this connection may send besides presence; its allowance of presence is its own
    const b = await boot({ rate: { burst: 4, perSecond: 0.001 }, presenceRate: { burst: 100, perSecond: 0.001 } });
    const [ana, bob] = [await joined(b, "ana"), await joined(b, "bob")]; // (the join was the first of the four)
    for (let i = 0; i < 60; i++) ana.say({ t: "presence", ...here({ pointer: { x: i, y: 0 } }) });
    ana.say(move(1, 1));
    ana.say(move(2, 2));
    ana.say(move(3, 3));
    await until("all three edits to be acknowledged", () => ana.heard.filter((m) => m.t === "ack").length === 3);
    expect(ana.closed()).toBeNull();
    await until("Bob to hear all of it", () => bob.presences().length === 60 && bob.heard.filter((m) => m.t === "ops").length === 3);
    expect(await b.metric("presence_dropped_total")).toBe(0);
  });

  it("still ends a connection that floods it: what is over the allowance counts as messages like any other", async () => {
    const b = await boot({ rate: { burst: 20, perSecond: 0.001 }, presenceRate: { burst: 5, perSecond: 0.001 } });
    const [ana, bob] = [await joined(b, "ana"), await joined(b, "bob")];
    for (let i = 0; i < 200; i++) ana.say({ t: "presence", ...here({ pointer: { x: i, y: 0 } }) });
    await until("the server to close the connection", () => ana.closed() !== null);
    expect(ana.closed()).toBe(1008);
    expect(bob.presences().filter((m) => !("gone" in m))).toHaveLength(5);
    expect(await b.metric('connections_closed_total{reason="rate"}')).toBe(1);
  });

  it("counts presence that is not well formed against the allowance too, and passes none of it on", async () => {
    const b = await boot({ presenceRate: { burst: 3, perSecond: 0.001 } });
    const [ana, bob] = [await joined(b, "ana"), await joined(b, "bob")];
    for (let i = 0; i < 3; i++) ana.say({ t: "presence", ...here(), color: "red" });
    ana.say({ t: "presence", ...here() });
    await settled(ana);
    await settled(bob);
    expect(bob.presences()).toEqual([]);
    expect(await b.metric("presence_dropped_total")).toBe(1);
    expect(ana.closed()).toBeNull();
  });
});

describe("a kind of message that the server does not know", () => {
  it("is ignored, as presence was by a server from before it: the connection stays and the next edit is applied", async () => {
    const b = await boot();
    const ana = await joined(b, "ana");
    ana.say({ t: "something-newer", with: ["anything"] });
    ana.say(move(1, 42));
    await until("the edit to be acknowledged", () => ana.heard.some((m) => m.t === "ack"));
    expect(ana.closed()).toBeNull();
    expect(ana.heard.map((m) => m.t)).toEqual(["welcome", "ack"]);
    expect((await b.storage.load(b.made.room))?.design.pages[0].elements[0].x).toBe(42);
  });
});

/**
 * The server for shared designs, with a real HTTP server and real WebSockets on a port of its own: making a room, getting in with
 * a key, what a viewer may and may not do, two browsers editing at once through it, a room that survives a restart, and the limits
 * that keep one visitor from using the server up.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import { designsEqual } from "@/collab/ops";
import type { ClientMsg, ServerMsg } from "@/collab/protocol";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import { closeWithin, createLiveServer, type LiveServer, type LiveServerOptions } from "./live";
import { FileStorage, MemoryStorage, ROOM_ID, type LiveStorage } from "./storage";

const design = (): Design =>
  createDesign({
    title: "Shared",
    width: 1000,
    height: 600,
    pages: [
      createPage({
        id: "p",
        elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 }), createShape("rect", { id: "b", x: 300, y: 0, width: 100, height: 50 })],
      }),
    ],
  });

const servers: LiveServer[] = [];
const lives: Live[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const live of lives.splice(0)) live.stop();
  for (const s of sockets.splice(0)) s.terminate();
  for (const server of servers.splice(0)) await server.close();
  vi.restoreAllMocks();
});

/** What the server writes to its log from here on, kept and not printed. */
const logged = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

async function boot(options: Partial<LiveServerOptions> = {}, storage: LiveStorage = new MemoryStorage()) {
  const server = createLiveServer({ storage, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  return { server, storage, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

type Booted = Awaited<ReturnType<typeof boot>>;
type Made = { room: string; editKey: string; viewKey: string; ownerKey: string };

async function makeRoom(b: Booted, d: Design = design()): Promise<Made> {
  const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: d }) });
  expect(res.status).toBe(201);
  return (await res.json()) as Made;
}

function join(b: Booted, room: string, key: string, client?: string) {
  const live = new Live({
    url: `${b.ws}?room=${encodeURIComponent(room)}`,
    key,
    client,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    onChange: () => undefined,
  });
  lives.push(live);
  live.start();
  return live;
}

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

/** A bare socket, to say what a page of this app would never say. Its address names the room only, as a page's does; `join` shows the key. */
function raw(b: Booted, room: string, key: string, address = `${b.ws}?room=${encodeURIComponent(room)}`) {
  const ws = new WebSocket(address);
  sockets.push(ws);
  const heard: ServerMsg[] = [];
  let closed: number | null = null;
  ws.on("message", (d) => heard.push(JSON.parse(d.toString()) as ServerMsg));
  ws.on("close", (code) => (closed = code));
  const opened = new Promise<void>((resolve) => ws.on("open", () => resolve()));
  const say = (m: unknown) => ws.send(typeof m === "string" ? m : JSON.stringify(m));
  return { ws, heard, opened, closed: () => closed, say, join: (client: string) => say({ t: "join", client, key }) };
}

const rename = (d: Design, title: string): Design => ({ ...d, title });
const addShape = (d: Design, id: string): Design => ({
  ...d,
  pages: d.pages.map((p) => ({ ...p, elements: [...p.elements, createShape("rect", { id, x: 5, y: 5, width: 10, height: 10 })] })),
});

describe("making a room", () => {
  it("answers with a room and two keys, and keeps only hashes of the keys", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect(made.room).toMatch(ROOM_ID);
    expect(made.editKey).not.toBe(made.viewKey);
    const record = (await b.storage.load(made.room))!;
    expect(record.rev).toBe(0);
    expect(JSON.stringify(record)).not.toContain(made.editKey);
    expect(JSON.stringify(record)).not.toContain(made.viewKey);
    expect(record.design.id).toBe(made.room); // not the id of the library it came from
  });

  it("makes a different room every time", async () => {
    const b = await boot();
    const [x, y] = [await makeRoom(b), await makeRoom(b)];
    expect(x.room).not.toBe(y.room);
    expect(x.editKey).not.toBe(y.editKey);
  });

  it.each([
    ["a body that is not JSON", "not json", 400],
    ["no design", JSON.stringify({}), 400],
    ["a design with no pages", JSON.stringify({ design: { ...design(), pages: [] } }), 400],
    [
      "a design with a picture that is a script",
      JSON.stringify({ design: { ...design(), pages: [{ id: "p", background: { type: "image", src: "javascript:1" }, elements: [] }] } }),
      400,
    ],
    ["a design with no title", JSON.stringify({ design: { ...design(), title: 5 } }), 400],
    [
      "a design with a graphic that carries code after a slash",
      JSON.stringify({
        design: { ...design(), pages: [{ id: "p", background: { type: "solid", color: "#fff" }, elements: [{ id: "g", type: "graphic", svg: '<svg/onload="alert(1)"/>' }] }] },
      }),
      400,
    ],
    [
      "a design with a graphic that links out of the drawing",
      JSON.stringify({
        design: {
          ...design(),
          pages: [{ id: "p", background: { type: "solid", color: "#fff" }, elements: [{ id: "g", type: "graphic", svg: '<svg><a href="https://evil.test/"><rect/></a></svg>' }] }],
        },
      }),
      400,
    ],
  ])("refuses %s", async (_what, body, status) => {
    const b = await boot();
    const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body });
    expect(res.status).toBe(status);
    expect(await b.storage.count()).toBe(0);
  });

  it("takes a design that holds more than one batch may carry: its size in bytes is the limit, and it can be joined", async () => {
    const b = await boot();
    // four elements with 90,000 numbers each: more values than a batch of operations may carry
    const heavy = {
      ...design(),
      pages: [createPage({ id: "p", elements: ["a", "b", "c", "d"].map((id) => ({ ...createShape("rect", { id }), numbers: Array<number>(90_000).fill(1) })) })],
    };
    const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: heavy }) });
    expect(res.status).toBe(201);
    const made = (await res.json()) as Made;
    const live = join(b, made.room, made.editKey);
    await until("the big design to arrive", () => live.status === "live");
    expect(live.design?.pages[0].elements).toHaveLength(4);
  });

  it("refuses a design that is bigger than it may be, and an unknown address", async () => {
    const b = await boot({ maxDesignBytes: 2000 });
    const big = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design(), padding: "x".repeat(5000) }) });
    expect(big.status).toBe(413);
    expect((await fetch(`${b.http}/api/nothing`)).status).toBe(404);
    expect((await fetch(`${b.http}/api/health`)).status).toBe(200);
  });

  it("holds no more rooms than it may", async () => {
    const b = await boot({ maxRooms: 2 });
    await makeRoom(b);
    await makeRoom(b);
    const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design() }) });
    expect(res.status).toBe(503);
  });

  it("lets a page of another origin call it only when it is told to", async () => {
    const open = await boot({ allowOrigin: "*" });
    expect((await fetch(`${open.http}/api/health`)).headers.get("access-control-allow-origin")).toBe("*");
    const one = await boot({ allowOrigin: ["https://app.example.test"] });
    const yes = await fetch(`${one.http}/api/health`, { headers: { origin: "https://app.example.test" } });
    expect(yes.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    const no = await fetch(`${one.http}/api/health`, { headers: { origin: "https://evil.example.test" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
    const closed = await boot();
    expect((await fetch(`${closed.http}/api/health`)).headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(`${open.http}/api/rooms`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("getting in", () => {
  it("lets in a browser with the edit key, and with the view key, and refuses any other key, room or name", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const editor = join(b, made.room, made.editKey);
    const viewer = join(b, made.room, made.viewKey);
    const stranger = join(b, made.room, "wrong-key");
    const nowhere = join(b, "A".repeat(22), made.editKey);
    const odd = join(b, "../../etc/passwd", made.editKey);
    await until("the editor", () => editor.status === "live");
    await until("the viewer", () => viewer.status === "live");
    await until("the stranger", () => stranger.status === "denied");
    await until("the missing room", () => nowhere.status === "denied");
    await until("the odd room", () => odd.status === "denied");
    expect(editor.session.role).toBe("edit");
    expect(viewer.session.role).toBe("view");
    expect(stranger.denied).toBe("no-access");
    expect(nowhere.denied).toBe("not-found");
    expect(odd.denied).toBe("not-found");
  });

  it("turns away a client with a name that cannot be one, and one more than the room holds", async () => {
    const b = await boot({ maxPeersPerRoom: 2 });
    const made = await makeRoom(b);
    const bad = raw(b, made.room, made.editKey);
    await bad.opened;
    bad.join("../x");
    await until("the refusal", () => bad.heard.some((m) => m.t === "denied"));
    expect(bad.heard.find((m) => m.t === "denied")).toEqual({ t: "denied", reason: "bad-request" });
    const [one, two, three] = [join(b, made.room, made.editKey), join(b, made.room, made.editKey), join(b, made.room, made.editKey)];
    await until("the third", () => [one, two, three].filter((l) => l.status === "denied").length === 1);
    expect([one, two, three].find((l) => l.status === "denied")?.denied).toBe("server-full");
  });

  it("takes the key from the first message and not from the address: a key in the address lets nobody in", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey, `${b.ws}?room=${made.room}&key=${made.editKey}`);
    await s.opened;
    s.say({ t: "join", client: "no-key" }); // the address holds the key, the message does not
    await until("the refusal", () => s.closed() === 4003);
    expect(s.heard).toEqual([{ t: "denied", reason: "no-access" }]);
  });

  it.each<[string, unknown]>([
    ["no key", undefined],
    ["a key that is empty", ""],
    ["a key that is not a text", 5],
    ["a key that is a list", ["x"]],
    ["a key that is far too long", "k".repeat(5000)],
  ])("turns away a join with %s", async (_what, key) => {
    const b = await boot();
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.say({ t: "join", client: "odd", key });
    await until("the refusal", () => s.closed() === 4003);
    expect(s.heard).toEqual([{ t: "denied", reason: "no-access" }]);
  });

  it("sends away a connection that does not show its key soon enough, and leaves alone one that does", async () => {
    const b = await boot({ joinWaitMs: 60 });
    const made = await makeRoom(b);
    const silent = raw(b, made.room, made.editKey);
    const prompt = raw(b, made.room, made.editKey);
    await Promise.all([silent.opened, prompt.opened]);
    prompt.join("on-time");
    await until("the silent one to be sent away", () => silent.closed() === 4003);
    expect(silent.heard).toEqual([{ t: "denied", reason: "bad-request" }]);
    await until("the welcome", () => prompt.heard.some((m) => m.t === "welcome"));
    await new Promise((r) => setTimeout(r, 150)); // the wait is over for both, and well past
    expect(prompt.closed()).toBeNull();
  });

  it("does not count those who wait for a place against those who have one", async () => {
    const b = await boot({ maxPeersPerRoom: 1 });
    const made = await makeRoom(b);
    const waiting = raw(b, made.room, made.editKey);
    await waiting.opened;
    const guest = join(b, made.room, made.editKey);
    await until("a place for the guest", () => guest.status === "live");
    expect(waiting.closed()).toBeNull();
  });

  it("gives a place back when a person leaves", async () => {
    const b = await boot({ maxPeersPerRoom: 2 });
    const made = await makeRoom(b);
    const [one, two] = [join(b, made.room, made.editKey), join(b, made.room, made.editKey)];
    await until("both in", () => one.status === "live" && two.status === "live");
    const third = join(b, made.room, made.editKey);
    await until("the third to be turned away", () => third.status === "denied");
    expect(third.denied).toBe("server-full");
    one.stop();
    await until("a place to come free", async () => {
      const next = join(b, made.room, made.editKey);
      await until("an answer", () => next.status === "live" || next.status === "denied");
      return next.status === "live";
    });
  });

  it("ignores what is said before the client has joined", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const early = raw(b, made.room, made.editKey);
    await early.opened;
    early.say({ t: "ops", seq: 1, ops: [{ k: "el.del", page: "p", id: "a" }] });
    early.say("this is not json {");
    early.say({ t: "ping" }); // nobody is answered before the key has been shown
    early.join("early");
    await until("the welcome", () => early.heard.some((m) => m.t === "welcome"));
    const welcome = early.heard.find((m) => m.t === "welcome") as Extract<ServerMsg, { t: "welcome" }>;
    expect(welcome.rev).toBe(0);
    expect(early.heard.map((m) => m.t)).toEqual(["welcome"]);
    expect(welcome.design.pages[0].elements.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("editing together", () => {
  it("shows what one browser changes to the other, in both directions, and the server saves it", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    const bob = join(b, made.room, made.editKey);
    await until("both live", () => ann.status === "live" && bob.status === "live");
    const d0 = ann.design!;
    const d1 = addShape(rename(d0, "Annie's"), "from-ann");
    ann.edit(d0, d1);
    await until("Bob to see it", () => bob.design?.title === "Annie's" && bob.design.pages[0].elements.some((e) => e.id === "from-ann"));
    const e0 = bob.design!;
    bob.edit(e0, { ...e0, pages: e0.pages.map((p) => ({ ...p, elements: p.elements.map((e) => (e.id === "a" ? { ...e, x: 77, fill: solid("#0000ff") } : e)) })) });
    await until("Ann to see it", () => ann.design?.pages[0].elements[0].x === 77);
    await until("the server to save it", async () => (await b.storage.load(made.room))?.rev === 2);
    const saved = (await b.storage.load(made.room))!;
    expect(designsEqual(saved.design, ann.design!)).toBe(true);
    expect(designsEqual(ann.design!, bob.design!)).toBe(true);
    expect(Object.keys(saved.seqs).length).toBe(2);
  });

  it("keeps both changes when two browsers change different things at the same moment", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    const bob = join(b, made.room, made.editKey);
    await until("both live", () => ann.status === "live" && bob.status === "live");
    const [a0, b0] = [ann.design!, bob.design!];
    ann.edit(a0, rename(a0, "Title"));
    bob.edit(b0, addShape(b0, "extra"));
    await until(
      "to agree",
      () =>
        ann.session.pending === 0 &&
        bob.session.pending === 0 &&
        designsEqual(ann.design!, bob.design!) &&
        ann.design!.title === "Title" &&
        ann.design!.pages[0].elements.length === 3,
    );
  });

  it("lets a viewer look and not touch", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const editor = join(b, made.room, made.editKey);
    const viewer = join(b, made.room, made.viewKey);
    await until("both live", () => editor.status === "live" && viewer.status === "live");
    const d0 = editor.design!;
    editor.edit(d0, rename(d0, "Changed"));
    await until("the viewer to see it", () => viewer.design?.title === "Changed");
    // the page does not even try; something that is not the page does, and is refused
    const v0 = viewer.design!;
    viewer.edit(v0, rename(v0, "Vandalised"));
    expect(viewer.session.pending).toBe(0);
    const sneaky = raw(b, made.room, made.viewKey);
    await sneaky.opened;
    sneaky.join("sneaky");
    await until("the welcome", () => sneaky.heard.some((m) => m.t === "welcome"));
    sneaky.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "Vandalised" } }] } satisfies ClientMsg);
    await until("the refusal", () => sneaky.heard.some((m) => m.t === "rejected"));
    expect((await b.storage.load(made.room))?.design.title).not.toBe("Vandalised");
    expect(editor.design?.title).toBe("Changed");
  });

  it("closes the old connection of a client that comes back on a new one", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const first = raw(b, made.room, made.editKey);
    await first.opened;
    first.join("same-client");
    await until("the first welcome", () => first.heard.some((m) => m.t === "welcome"));
    const second = raw(b, made.room, made.editKey);
    await second.opened;
    second.join("same-client");
    await until("the old one to be closed", () => first.closed() === 4000);
    await until("the second welcome", () => second.heard.some((m) => m.t === "welcome"));
  });

  it("does not let two tabs that start under one name take each other's place for good: both stay, and the changes of both arrive", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    let welcomes = 0;
    const tab = () => {
      const live = new Live({
        url: `${b.ws}?room=${encodeURIComponent(made.room)}`,
        key: made.editKey,
        client: "0123456789abcdef", // a duplicated tab starts with the name of the tab it was copied from
        createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        onChange: () => undefined,
        onStatus: (status) => void (status === "live" && welcomes++),
      });
      lives.push(live);
      live.start();
      return live;
    };
    const one = tab();
    await until("the first tab to be live", () => one.status === "live");
    const two = tab();
    await until("both tabs to be live", () => one.status === "live" && two.status === "live" && welcomes === 3);
    await new Promise((r) => setTimeout(r, 1500)); // under one name each would have replaced the other about every half second
    expect(welcomes).toBe(3); // the first, the second, and the first again under a name of its own
    one.edit(one.design!, rename(one.design!, "From one"));
    two.edit(two.design!, addShape(two.design!, "from-two"));
    await until("both changes to be saved", async () => {
      const saved = (await b.storage.load(made.room))!.design;
      return saved.title === "From one" && saved.pages[0].elements.some((e) => e.id === "from-two");
    });
    expect(Object.keys((await b.storage.load(made.room))!.seqs)).toHaveLength(2);
  });
});

describe("a room that outlives the server", () => {
  it("comes back from its saved state with the revision and the batch numbers, and takes up where it left off", async () => {
    const storage = new MemoryStorage();
    const one = await boot({}, storage);
    const made = await makeRoom(one);
    const ann = join(one, made.room, made.editKey, "ann");
    await until("live", () => ann.status === "live");
    const d0 = ann.design!;
    ann.edit(d0, rename(d0, "Before the restart"));
    await until("confirmed", () => ann.session.pending === 0);
    ann.stop();
    await one.server.close();
    servers.length = 0;
    expect((await storage.load(made.room))?.rev).toBe(1);
    const two = await boot({}, storage);
    const again = join(two, made.room, made.editKey, "ann");
    await until("live again", () => again.status === "live");
    expect(again.design?.title).toBe("Before the restart");
    expect(again.session.rev).toBe(1);
    const d1 = again.design!;
    again.edit(d1, rename(d1, "After"));
    await until("confirmed", () => again.session.pending === 0);
    expect((await storage.load(made.room))?.design.title).toBe("After");
  });

  it("does not keep a room in memory for a visitor who was turned away or who never joined", async () => {
    const b = await boot({ idleCloseMs: 20, joinWaitMs: 60 });
    const made = await makeRoom(b);
    const stranger = join(b, made.room, "wrong-key");
    await until("the stranger to be sent away", () => stranger.status === "denied");
    const silent = raw(b, made.room, made.editKey);
    await silent.opened;
    await until("the silent one to be sent away", () => silent.closed() === 4003);
    await until("the room to leave memory", () => b.server.rooms() === 0);
  });

  it("leaves memory when nobody is in it, and is loaded again for the next visitor", async () => {
    const b = await boot({ idleCloseMs: 20 });
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    expect(b.server.rooms()).toBe(1);
    ann.stop();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    const bob = join(b, made.room, made.viewKey);
    await until("live again", () => bob.status === "live");
    expect(b.server.rooms()).toBe(1);
  });
});

describe("stopping to share", () => {
  it("sends away a connection that has not shown its key yet, as well as the people who are in", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    const waiting = raw(b, made.room, made.editKey);
    await waiting.opened;
    const ok = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } });
    expect(ok.status).toBe(200);
    await until("the waiting connection to be sent away", () => waiting.closed() === 4004);
    expect(waiting.heard).toEqual([{ t: "denied", reason: "not-found" }]);
  });

  it("needs the key that edits, sends everybody away, and forgets the design", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    const wrong = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.viewKey } });
    expect(wrong.status).toBe(403);
    expect((await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE" })).status).toBe(403);
    expect((await fetch(`${b.http}/api/rooms/${"B".repeat(22)}`, { method: "DELETE", headers: { "x-craftly-key": "x" } })).status).toBe(404);
    expect(ann.status).toBe("live");
    const ok = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } });
    expect(ok.status).toBe(200);
    await until("Ann to be sent away", () => ann.status === "denied");
    expect(await b.storage.load(made.room)).toBeNull();
    const late = join(b, made.room, made.editKey);
    await until("a late visitor to be refused", () => late.status === "denied");
    expect(late.denied).toBe("not-found");
  });
});

describe("a store that cannot be read", () => {
  it("does not let a visitor with a room id that is a path, or a store that fails, bring the server down", async () => {
    const failing = {
      load: async () => {
        throw new Error("the disk is gone");
      },
      save: async () => undefined,
      remove: async () => undefined,
      count: async () => 0,
      checkWritable: async () => {
        throw new Error("the disk is gone");
      },
    };
    const log = logged();
    const b = await boot({}, failing);
    const lives = [join(b, "A".repeat(22), "k".repeat(12)), join(b, "../../etc/passwd", "k".repeat(12))];
    await until("both to be sent away", () => lives.every((l) => l.status === "denied"));
    // the store was asked for the first and failed, which is not the same as a room that is not there; it was never asked for the second
    expect(lives.map((l) => l.denied)).toEqual(["server-error", "not-found"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect((await fetch(`${b.http}/api/health`)).status).toBe(503);
  });

  it.each<[string, (file: string) => void]>([
    ["is damaged", (file) => writeFileSync(file, '{"design": {"pages": [')],
    ["holds something that is not a room", (file) => writeFileSync(file, JSON.stringify({ rev: 1 }))],
    [
      "cannot be read",
      (file) => {
        rmSync(file);
        mkdirSync(file); // a folder where the file should be: reading it fails, and not with "there is no such file"
      },
    ],
  ])("says that the server has a problem, and writes it down, when the file of a room %s: the design is not gone", async (_what, spoil) => {
    const dir = mkdtempSync(join2(tmpdir(), "craftly-live-test-"));
    try {
      const storage = new FileStorage(dir);
      const b = await boot({}, storage);
      const made = await makeRoom(b);
      const file = join2(dir, `${made.room}.json`);
      spoil(file);
      const log = logged();
      const visitor = join(b, made.room, made.editKey);
      await until("the visitor to be sent away", () => visitor.status === "denied");
      expect(visitor.denied).toBe("server-error");
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain(made.room);
      // over HTTP it is an error of the server too, which a browser asks again later, and not a 404, which it takes as final
      const stop = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } });
      expect(stop.status).toBe(500);
      expect(((await stop.json()) as { error: string }).error).toMatch(/the server has a problem/);
      const image = await fetch(`${b.http}/api/rooms/${made.room}/assets/img-1`, { headers: { "x-craftly-key": made.editKey } });
      expect(image.status).toBe(500);
      expect(log).toHaveBeenCalledTimes(3);
      await expect(storage.load(made.room)).rejects.toThrow();
      expect(existsSync(file)).toBe(true); // nothing is thrown away: the operator may be able to mend it
      // a room that was never there is still just that, and nothing is written down for it
      const nowhere = join(b, "A".repeat(22), made.editKey);
      await until("the other visitor to be sent away", () => nowhere.status === "denied");
      expect(nowhere.denied).toBe("not-found");
      expect(await storage.load("A".repeat(22))).toBeNull();
      expect(log).toHaveBeenCalledTimes(3);
      expect(b.server.rooms()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with files on a disk, turns away a room id that would lead out of the folder", async () => {
    const dir = mkdtempSync(join2(tmpdir(), "craftly-live-test-"));
    try {
      const b = await boot({}, new FileStorage(dir));
      const made = await makeRoom(b);
      const good = join(b, made.room, made.editKey);
      const bad = join(b, "..%2F..%2Fetc%2Fpasswd", made.editKey);
      await until("the good one live and the bad one refused", () => good.status === "live" && bad.status === "denied");
      expect(bad.denied).toBe("not-found");
      expect((await fetch(`${b.http}/api/rooms/..%2F..%2Fsomething`, { method: "DELETE", headers: { "x-craftly-key": "k" } })).status).toBe(404);
      expect(readdirSync(dir).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what it will not stand for", () => {
  it("drops a connection that sends a message bigger than it may", async () => {
    const b = await boot({ maxMessageBytes: 2000 });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("big");
    await until("the welcome", () => s.heard.some((m) => m.t === "welcome"));
    s.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "x".repeat(5000) } }] });
    await until("the connection to be closed", () => s.closed() === 1009);
  });

  it("drops a connection that sends too many messages too fast", async () => {
    const b = await boot({ rate: { burst: 5, perSecond: 1 } });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("fast");
    for (let i = 0; i < 20; i++) s.say({ t: "ping" });
    await until("the connection to be closed", () => s.closed() === 1008);
  });

  it("answers a batch it cannot accept with a refusal, and goes on", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("odd");
    await until("the welcome", () => s.heard.some((m) => m.t === "welcome"));
    s.say({ t: "ops", seq: 1, ops: [{ k: "el.set", page: "p", id: "a", set: { src: "javascript:alert(1)" } }] });
    await until("the refusal", () => s.heard.some((m) => m.t === "rejected"));
    s.say({ t: "ops", seq: 2, ops: [{ k: "design", set: { title: "Fine" } }] });
    await until("the ack", () => s.heard.some((m) => m.t === "ack"));
    await until("the save", async () => (await b.storage.load(made.room))?.design.title === "Fine");
    expect(s.heard.filter((m) => m.t === "rejected")).toHaveLength(1);
  });

  it("refuses markup that only a browser reads as code, however it is written, and keeps the design as it was", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("odd");
    await until("the welcome", () => s.heard.some((m) => m.t === "welcome"));
    const markup = ['<svg/onload="alert(1)"/>', "<svg><g onclick=alert(1)></g></svg>", '<svg><g ONCLICK="x"/></svg>', '<svg><linearGradient href="&#106;avascript:x"/></svg>'];
    markup.forEach((svg, i) => s.say({ t: "ops", seq: i + 1, ops: [{ k: "el.add", page: "p", parent: null, index: 0, el: { id: `g${i}`, type: "graphic", svg } }] }));
    await until("every refusal", () => s.heard.filter((m) => m.t === "rejected").length === markup.length);
    expect(s.heard.some((m) => m.t === "ack")).toBe(false);
    expect(JSON.stringify((await b.storage.load(made.room))!.design)).not.toContain("onload");
  });
});

describe("production regressions", () => {
  it("survives malformed HTTP and upgrade request targets", async () => {
    const b = await boot();
    for (const upgrade of [false, true]) {
      const result = await new Promise<string>((resolve, reject) => {
        const socket = connect(Number(new URL(b.http).port), "127.0.0.1");
        let response = "";
        socket.setTimeout(2000, () => socket.destroy(new Error("request timed out")));
        socket.on("data", (chunk) => {
          response += chunk.toString();
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(response));
        socket.on("connect", () => {
          const headers = upgrade ? "Connection: Upgrade\r\nUpgrade: websocket" : "Connection: close";
          socket.write(`GET //% HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n\r\n`);
        });
      });
      if (!upgrade) expect(result).toContain("400 Bad Request");
      expect((await fetch(`${b.http}/api/health`)).status).toBe(200);
    }
  });

  it("preserves the room limit when startup passes unset options", async () => {
    const storage = new MemoryStorage();
    storage.count = async () => 1000;
    const b = await boot({ maxRooms: undefined, maxPeersPerRoom: undefined }, storage);
    const response = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design() }) });
    expect(response.status).toBe(503);
  });

  it("preserves the default peer limit when startup supplies undefined", async () => {
    const b = await boot({ maxPeersPerRoom: undefined });
    const made = await makeRoom(b);
    const guests = Array.from({ length: 50 }, (_, i) => join(b, made.room, made.viewKey, `guest-${i}`));
    await until("the 50 default slots to fill", () => guests.every((guest) => guest.status === "live"));
    const extra = join(b, made.room, made.viewKey, "extra");
    await until("the 51st viewer to be refused", () => extra.status === "denied");
    expect(extra.denied).toBe("server-full");
  });

  it("returns 503 when FileStorage points to an unwritable location", async () => {
    const dir = mkdtempSync(join2(tmpdir(), "craftly-health-"));
    const file = join2(dir, "not-a-directory");
    try {
      writeFileSync(file, "");
      const b = await boot({}, new FileStorage(file));
      const response = await fetch(`${b.http}/api/health`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses deletion with edit and view invites and accepts the owner key", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const remove = (key: string) => fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": key } });
    expect((await remove(made.editKey)).status).toBe(403);
    expect((await remove(made.viewKey)).status).toBe(403);
    expect((await remove(made.ownerKey)).status).toBe(200);
  });

  it("acknowledges only after storage succeeds and rejects a failed write without publishing it", async () => {
    const storage = new MemoryStorage();
    const persist = storage.save.bind(storage);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    storage.save = async (id, record) => {
      if (record.rev === 1) {
        entered();
        await gate;
      }
      if (record.rev === 2) throw new Error("disk full");
      await persist(id, record);
    };
    const b = await boot({}, storage);
    const made = await makeRoom(b);
    const client = raw(b, made.room, made.editKey);
    await client.opened;
    client.join("editor");
    await until("welcome", () => client.heard.some((msg) => msg.t === "welcome"));
    client.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "Durable" } }] });
    await writing;
    try {
      expect(client.heard.some((msg) => msg.t === "ack")).toBe(false);
      expect((await storage.load(made.room))?.rev).toBe(0);
    } finally {
      release();
    }
    await until("first acknowledgement", () => client.heard.some((msg) => msg.t === "ack" && msg.seq === 1));
    expect((await storage.load(made.room))?.design.title).toBe("Durable");
    client.say({ t: "ops", seq: 2, ops: [{ k: "design", set: { title: "Lost" } }] });
    await until("storage rejection", () => client.heard.some((msg) => msg.t === "rejected" && msg.seq === 2));
    expect((await storage.load(made.room))?.design.title).toBe("Durable");
  });
});

describe("connections over time", () => {
  it("keeps a connection that answers the server's pings", async () => {
    // A round is long enough for an answer to arrive on a machine that is busy with other things: with 40 ms this test failed
    // once because a pong took longer than a round. It still proves what it is for: a server that did not hear the answers
    // would drop the connection at the second round, after 300 ms.
    const b = await boot({ heartbeatMs: 150 });
    const made = await makeRoom(b);
    const client = raw(b, made.room, made.editKey);
    await client.opened;
    client.join("tab-1");
    await until("welcome", () => client.heard.some((msg) => msg.t === "welcome"));
    // several rounds of the heartbeat: a connection that answers each ping is still there after them
    await new Promise((r) => setTimeout(r, 700));
    expect(client.closed()).toBeNull();
    expect(client.ws.readyState).toBe(client.ws.OPEN);
  });

  it("lets a room leave memory when its only connection went away while the room was being read", async () => {
    let hold = false;
    let release = () => undefined as void;
    let started = () => undefined as void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const reading = new Promise<void>((resolve) => (started = resolve));
    class SlowStorage extends MemoryStorage {
      override async load(id: string) {
        if (hold) {
          started();
          await held;
        }
        return super.load(id);
      }
    }
    const b = await boot({ idleCloseMs: 20 }, new SlowStorage());
    const made = await makeRoom(b);
    await until("the room to leave memory after it was made", () => b.server.rooms() === 0);
    hold = true;
    const client = raw(b, made.room, made.editKey);
    await client.opened;
    await reading;
    client.ws.terminate();
    await until("the connection to be gone", () => client.closed() !== null);
    await new Promise((r) => setTimeout(r, 30));
    release();
    await until("the room to be in memory", () => b.server.rooms() === 1);
    await until("the room to leave memory again", () => b.server.rooms() === 0, 1500);
  });
});

describe("admission: what one visitor may cost the server", () => {
  const welcomes = (heard: ServerMsg[]) => heard.filter((m) => m.t === "welcome").length;

  it("drops a connection that does not read what it is sent, before what waits for it fills the memory", async () => {
    // a design of 300 kB, asked for again and again by a connection that reads nothing: what the server holds for it may not grow past the limit
    const b = await boot({ maxBufferedBytes: 1024 * 1024, joinRate: { burst: 1000 }, rate: { burst: 1000, perSecond: 100 }, idleCloseMs: 20 });
    const made = await makeRoom(b, { ...design(), title: "x".repeat(300_000) });
    const s = raw(b, made.room, made.viewKey);
    await s.opened;
    s.join("deaf");
    await until("the welcome", () => welcomes(s.heard) === 1);
    expect(b.server.rooms()).toBe(1);
    s.ws.pause();
    for (let i = 0; i < 300; i++) s.join("deaf");
    // the room has nobody else in it, so it leaves memory when the server has dropped the connection
    await until("the server to drop the connection", () => b.server.rooms() === 0, 8000);
    s.ws.resume();
    await until("the browser to notice", () => s.closed() !== null);
    expect(welcomes(s.heard)).toBeLessThan(300);
  });

  it("lets a connection ask for the design again a few times, and drops one that keeps asking", async () => {
    const b = await boot({ joinRate: { burst: 3, perSecond: 0.001 } });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.viewKey);
    await s.opened;
    for (let i = 0; i < 3; i++) s.join("again");
    await until("three welcomes", () => welcomes(s.heard) === 3);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.closed()).toBeNull();
    s.join("again");
    await until("the connection to be closed", () => s.closed() === 1008);
    expect(welcomes(s.heard)).toBe(3);
  });

  it("allows a join every two seconds after a burst of four, unless it is told otherwise", async () => {
    // (as the start-up passes them when the environment sets none: a setting that is undefined is not a limit of nothing)
    const b = await boot({ joinRate: { burst: undefined, perSecond: undefined }, byteRate: { burst: undefined, perSecond: undefined } });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.viewKey);
    await s.opened;
    for (let i = 0; i < 5; i++) s.join("again");
    await until("the connection to be closed", () => s.closed() === 1008);
    expect(welcomes(s.heard)).toBe(4);
  });

  it("counts the bytes a connection sends as well as its messages", async () => {
    const b = await boot({ byteRate: { burst: 5000, perSecond: 1 } });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("heavy");
    const batch = (seq: number) => ({ t: "ops", seq, ops: [{ k: "design", set: { title: `${seq}`.padEnd(2000, "x") } }] });
    s.say(batch(1));
    s.say(batch(2));
    await until("two batches to be taken", () => s.heard.filter((m) => m.t === "ack").length === 2);
    expect(s.closed()).toBeNull();
    s.say(batch(3)); // 6 kB in all, of 5 kB allowed
    await until("the connection to be closed", () => s.closed() === 1008);
    expect((await b.storage.load(made.room))?.rev).toBe(2);
  });

  it("does not read a big message from a connection that has not shown its key, and reads one from a connection that has", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const stranger = raw(b, made.room, made.editKey);
    await stranger.opened;
    // a join with the right key, and 20 kB that a join has no use for
    stranger.say({ t: "join", client: "big", key: made.editKey, padding: "x".repeat(20_000) });
    await until("the connection to be closed", () => stranger.closed() === 1009);
    expect(stranger.heard).toEqual([]);
    const member = raw(b, made.room, made.editKey);
    await member.opened;
    member.join("member");
    member.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "x".repeat(20_000) } }] });
    await until("the ack", () => member.heard.some((m) => m.t === "ack"));
  });

  it("takes the limit for a message before the key from its options", async () => {
    const b = await boot({ maxUnjoinedMessageBytes: 60 });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("a-name-that-makes-the-join-longer-than-sixty-bytes");
    await until("the connection to be closed", () => s.closed() === 1009);
  });

  /** A connection that may be refused before it is one: what the server answered the request with, or that it opened. */
  const knock = (b: Booted, room: string) =>
    new Promise<number | "open">((resolve) => {
      const ws = new WebSocket(`${b.ws}?room=${room}`);
      sockets.push(ws);
      ws.on("open", () => resolve("open"));
      ws.on("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      ws.on("error", () => undefined);
    });

  it("holds no more connections than it may, whatever room they are for, and takes the next when one has gone", async () => {
    const b = await boot({ maxConnections: 2 });
    const [one, two] = [await makeRoom(b), await makeRoom(b)];
    const first = raw(b, one.room, one.editKey);
    const second = raw(b, two.room, two.editKey);
    await Promise.all([first.opened, second.opened]);
    expect(await knock(b, one.room)).toBe(503);
    expect(first.closed()).toBeNull();
    first.ws.close();
    await until("a place to come free", async () => (await knock(b, one.room)) === "open");
  });

  it("lets only so many wait at the door of one room without a key, and asks the next to come back later", async () => {
    const b = await boot({ maxWaitingPerRoom: 2 });
    const [made, other] = [await makeRoom(b), await makeRoom(b)];
    const [one, two] = [raw(b, made.room, made.editKey), raw(b, made.room, made.editKey)];
    await Promise.all([one.opened, two.opened]);
    const third = raw(b, made.room, made.editKey);
    await until("the third to be asked to come back", () => third.closed() === 1013);
    expect(third.heard).toEqual([]); // not turned away for good: a browser tries again by itself
    // another room has a door of its own, and who has shown a key no longer waits
    const elsewhere = raw(b, other.room, other.editKey);
    await elsewhere.opened;
    one.join("one");
    await until("the welcome", () => welcomes(one.heard) === 1);
    const fourth = raw(b, made.room, made.editKey);
    await fourth.opened;
    fourth.join("fourth");
    await until("the welcome of the fourth", () => welcomes(fourth.heard) === 1);
    expect(elsewhere.closed()).toBeNull();
    expect(two.closed()).toBeNull();
  });
});

describe("an image that takes its time to arrive", () => {
  const image = JSON.stringify({ mime: "image/png", base64: Buffer.from("a picture, as far as the server can tell").toString("base64") });

  /** An upload whose first half has been sent and whose second half waits for `finish`; `status` is what the server answers in the end. */
  function slowUpload(b: Booted, made: Made, id: string) {
    const req = request(`${b.http}/api/rooms/${made.room}/assets/${id}`, {
      method: "PUT",
      headers: { "x-craftly-key": made.editKey, "content-length": Buffer.byteLength(image) },
    });
    const status = new Promise<number>((resolve, reject) => {
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
    });
    status.catch(() => undefined); // an upload that is given up has no answer, and nobody waits for one
    req.write(image.slice(0, 20));
    return { status, finish: () => void req.end(image.slice(20)), giveUp: () => void req.destroy() };
  }
  /** Long enough for a room with nobody in it to leave memory, where `idleCloseMs` is 20. */
  const aWhile = () => new Promise((r) => setTimeout(r, 200));

  it("does not put the room back as it was when the upload began: an edit made meanwhile stays", async () => {
    const b = await boot({ idleCloseMs: 20 });
    const made = await makeRoom(b);
    const upload = slowUpload(b, made, "img-1");
    await aWhile();
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    ann.edit(ann.design!, rename(ann.design!, "Changed while the image was on its way"));
    await until("confirmed", () => ann.session.pending === 0);
    ann.stop();
    await aWhile();
    upload.finish();
    expect(await upload.status).toBe(201);
    const saved = (await b.storage.load(made.room))!;
    expect(saved.design.title).toBe("Changed while the image was on its way");
    expect(saved.rev).toBe(1);
    expect(Object.keys(saved.assets ?? {})).toEqual(["img-1"]);
    // and a browser that comes now is shown the edit
    const bob = join(b, made.room, made.viewKey);
    await until("live", () => bob.status === "live");
    expect(bob.design?.title).toBe("Changed while the image was on its way");
  });

  it("does not bring back a room that its owner stopped sharing while the image was on its way", async () => {
    const b = await boot({ idleCloseMs: 20 });
    const made = await makeRoom(b);
    const upload = slowUpload(b, made, "img-1");
    await aWhile();
    const stopped = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } });
    expect(stopped.status).toBe(200);
    upload.finish();
    expect(await upload.status).toBe(404);
    expect(await b.storage.load(made.room)).toBeNull();
    const late = join(b, made.room, made.editKey);
    await until("a late visitor to be refused", () => late.status === "denied");
    expect(late.denied).toBe("not-found");
  });

  it("keeps the room in memory for as long as the image is on its way, and lets it go after: when it has arrived, and when it never does", async () => {
    const b = await boot({ idleCloseMs: 20 });
    const made = await makeRoom(b);
    const upload = slowUpload(b, made, "img-1");
    await until("the room to be read", () => b.server.rooms() === 1);
    await aWhile();
    expect(b.server.rooms()).toBe(1);
    upload.finish();
    expect(await upload.status).toBe(201);
    await until("the room to leave memory", () => b.server.rooms() === 0);
    const lost = slowUpload(b, made, "img-2");
    await until("the room to be read again", () => b.server.rooms() === 1);
    lost.giveUp();
    await until("the room to leave memory again", () => b.server.rooms() === 0);
    expect(Object.keys((await b.storage.load(made.room))!.assets ?? {})).toEqual(["img-1"]);
  });

  it("lets a room go after a request for an image that was refused or only read", async () => {
    const b = await boot({ idleCloseMs: 20 });
    const made = await makeRoom(b);
    const at = `${b.http}/api/rooms/${made.room}/assets/img-1`;
    expect((await fetch(at, { headers: { "x-craftly-key": "wrong" } })).status).toBe(403);
    expect((await fetch(at, { headers: { "x-craftly-key": made.viewKey } })).status).toBe(404);
    expect((await fetch(at, { method: "PUT", headers: { "x-craftly-key": made.editKey }, body: "not json" })).status).toBe(400);
    await until("the room to leave memory", () => b.server.rooms() === 0);
  });
});

describe("looking after itself", () => {
  it("does not write to the disk for every question about its health: the answer is kept for a while, a bad one too", async () => {
    let checks = 0;
    let broken = false;
    class Counted extends MemoryStorage {
      override async checkWritable() {
        checks++;
        if (broken) throw new Error("the disk is gone");
      }
    }
    const b = await boot({ healthCacheMs: 150 }, new Counted());
    const ask = async () => (await fetch(`${b.http}/api/health`)).status;
    expect(await Promise.all([ask(), ask(), ask()])).toEqual([200, 200, 200]);
    expect(await ask()).toBe(200);
    expect(checks).toBe(1);
    broken = true;
    await new Promise((r) => setTimeout(r, 200));
    expect(await ask()).toBe(503);
    expect(await ask()).toBe(503);
    expect(checks).toBe(2);
    broken = false;
    await new Promise((r) => setTimeout(r, 200));
    expect(await ask()).toBe(200);
    expect(checks).toBe(3);
  });

  it("keeps the answer about its health for five seconds unless it is told otherwise", async () => {
    let checks = 0;
    class Counted extends MemoryStorage {
      override async checkWritable() {
        checks++;
      }
    }
    const b = await boot({ healthCacheMs: undefined }, new Counted());
    for (let i = 0; i < 3; i++) {
      expect((await fetch(`${b.http}/api/health`)).status).toBe(200);
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(checks).toBe(1);
  });

  it("writes down what went wrong when it answers a request with an error of its own", async () => {
    const storage = new MemoryStorage();
    storage.save = async () => {
      throw new Error("disk full");
    };
    const log = logged();
    const b = await boot({}, storage);
    const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design() }) });
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][1])).toContain("disk full");
  });

  it("waits for a server to close, but no longer than it is told to", async () => {
    const closes = (how: () => Promise<void>) => ({ close: how });
    expect(
      await closeWithin(
        closes(async () => undefined),
        1000,
      ),
    ).toBe(true);
    const started = Date.now();
    expect(
      await closeWithin(
        closes(() => new Promise<void>(() => undefined)),
        60,
      ),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    await expect(
      closeWithin(
        closes(() => Promise.reject(new Error("could not save"))),
        1000,
      ),
    ).rejects.toThrow("could not save");
    // and a real one, with nothing left to do, closes in time
    const b = await boot();
    servers.length = 0;
    expect(await closeWithin(b.server, 2000)).toBe(true);
  });
});

describe("who may ask, and how often an address may make a room", () => {
  const HOME = "https://app.example.test";
  const post = (b: Booted, headers: Record<string, string> = {}) => fetch(`${b.http}/api/rooms`, { method: "POST", headers, body: JSON.stringify({ design: design() }) });
  const picture = JSON.stringify({ mime: "image/png", base64: Buffer.from("a picture").toString("base64") });
  /** A connection that says which page it comes from, as a browser does: whether it opened, or what the server answered instead. */
  const knockFrom = (b: Booted, room: string, origin?: string) =>
    new Promise<number | "open">((resolve) => {
      const ws = new WebSocket(`${b.ws}?room=${room}`, origin === undefined ? {} : { origin });
      sockets.push(ws);
      ws.on("open", () => resolve("open"));
      ws.on("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      ws.on("error", () => undefined);
    });

  it("refuses to make, change or remove anything for a page of an origin that is not on its list, and takes the same from a page that is", async () => {
    const b = await boot({ allowOrigin: [HOME, "https://other.example.test"] });
    const refused = await post(b, { origin: "https://evil.example.test" });
    expect(refused.status).toBe(403);
    expect(await b.storage.count()).toBe(0);
    const res = await post(b, { origin: HOME });
    expect(res.status).toBe(201);
    const made = (await res.json()) as Made;
    const image = `${b.http}/api/rooms/${made.room}/assets/img-1`;
    const room = `${b.http}/api/rooms/${made.room}`;
    for (const origin of ["https://evil.example.test", "null", "https://app.example.test.evil.test", "http://app.example.test"]) {
      expect((await fetch(image, { method: "PUT", headers: { origin, "x-craftly-key": made.editKey }, body: picture })).status).toBe(403);
      expect((await fetch(room, { method: "DELETE", headers: { origin, "x-craftly-key": made.ownerKey } })).status).toBe(403);
    }
    expect((await b.storage.load(made.room))?.assets).toBeUndefined();
    // looking is not refused here: a page of another origin cannot read the answer (it is sent no permission), and it has no key
    expect((await fetch(`${b.http}/api/health`, { headers: { origin: "https://evil.example.test" } })).status).toBe(200);
    expect((await fetch(image, { method: "PUT", headers: { origin: "https://other.example.test", "x-craftly-key": made.editKey }, body: picture })).status).toBe(201);
    expect((await fetch(room, { method: "DELETE", headers: { origin: HOME, "x-craftly-key": made.ownerKey } })).status).toBe(200);
  });

  it("refuses a connection from a page of an origin that is not on its list, before it is a connection", async () => {
    const b = await boot({ allowOrigin: [HOME] });
    const made = await makeRoom(b);
    expect(await knockFrom(b, made.room, "https://evil.example.test")).toBe(403);
    expect(await knockFrom(b, made.room, "null")).toBe(403);
    expect(b.server.rooms()).toBe(0); // the room was not even read for them
    expect(await knockFrom(b, made.room, HOME)).toBe("open");
  });

  it("does not refuse a request that names no origin, which is no page: a list of origins is about browsers", async () => {
    const b = await boot({ allowOrigin: [HOME] });
    const made = await makeRoom(b); // no Origin header
    expect(await knockFrom(b, made.room)).toBe("open");
    expect((await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } })).status).toBe(200);
  });

  it("takes a single origin given as a text as a list of one", async () => {
    const b = await boot({ allowOrigin: HOME });
    expect((await post(b, { origin: "https://evil.example.test" })).status).toBe(403);
    expect((await post(b, { origin: HOME })).status).toBe(201);
  });

  it.each<[string, Partial<LiveServerOptions>]>([
    ["is told that any origin may", { allowOrigin: "*" }],
    ["is told nothing about origins", {}],
  ])("asks no page where it comes from when it %s", async (_what, options) => {
    const b = await boot(options);
    const res = await post(b, { origin: "https://anywhere.example.test" });
    expect(res.status).toBe(201);
    const made = (await res.json()) as Made;
    expect(await knockFrom(b, made.room, "https://anywhere.example.test")).toBe("open");
  });

  it("lets one address make only so many rooms in an hour, and says when to come back", async () => {
    let at = Date.now();
    const b = await boot({ roomCreatePerHour: 2, now: () => at });
    expect((await post(b)).status).toBe(201);
    at += 20 * 60_000;
    expect((await post(b)).status).toBe(201);
    const refused = await post(b);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("2400");
    expect(((await refused.json()) as { error: string }).error).toMatch(/too many/);
    expect(await b.storage.count()).toBe(2);
    at += 39 * 60_000;
    expect((await post(b)).headers.get("retry-after")).toBe("60");
    at += 60_000;
    expect((await post(b)).status).toBe(201);
    expect((await post(b)).status).toBe(429);
    // only making rooms is counted: the rest of the server answers this address as before
    expect((await fetch(`${b.http}/api/health`)).status).toBe(200);
  });

  it("answers an address that has made too many rooms before it reads what it sent", async () => {
    const b = await boot({ roomCreatePerHour: 1 });
    await makeRoom(b);
    // a body that is not even a design: were it read, the answer would be 400
    expect((await fetch(`${b.http}/api/rooms`, { method: "POST", body: "not json" })).status).toBe(429);
  });

  it("allows ten rooms an hour from one address unless it is told otherwise, and any number when the limit is 0", async () => {
    const standard = await boot({ roomCreatePerHour: undefined });
    for (let i = 0; i < 10; i++) expect((await post(standard)).status).toBe(201);
    expect((await post(standard)).status).toBe(429);
    const open = await boot({ roomCreatePerHour: 0 });
    for (let i = 0; i < 12; i++) expect((await post(open)).status).toBe(201);
  });

  it("does not believe X-Forwarded-For unless it is told that a proxy is in front of it", async () => {
    const b = await boot({ roomCreatePerHour: 1 });
    expect((await post(b, { "x-forwarded-for": "198.51.100.1" })).status).toBe(201);
    // the same connection's address, whatever the header claims
    expect((await post(b, { "x-forwarded-for": "198.51.100.2" })).status).toBe(429);
  });

  it("behind a proxy, counts the address the proxy wrote last in X-Forwarded-For, and nothing a visitor wrote before it", async () => {
    const b = await boot({ roomCreatePerHour: 1, trustProxy: true });
    expect((await post(b, { "x-forwarded-for": "198.51.100.1" })).status).toBe(201);
    expect((await post(b, { "x-forwarded-for": "198.51.100.1" })).status).toBe(429);
    expect((await post(b, { "x-forwarded-for": "198.51.100.2" })).status).toBe(201);
    // a visitor who writes the header himself gains nothing: the proxy adds the address it saw at the end
    expect((await post(b, { "x-forwarded-for": "203.0.113.50, 198.51.100.2" })).status).toBe(429);
    expect((await post(b, { "x-forwarded-for": "198.51.100.2, 203.0.113.50" })).status).toBe(201);
    // without a header that can be used it is the proxy's own address that is counted
    expect((await post(b)).status).toBe(201);
    expect((await post(b, { "x-forwarded-for": "nonsense" })).status).toBe(429);
  });
});

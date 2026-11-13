/**
 * The server for shared designs, with a real HTTP server and real WebSockets on a port of its own: making a room, getting in with
 * a key, what a viewer may and may not do, two browsers editing at once through it, a room that survives a restart, and the limits
 * that keep one visitor from using the server up.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { FileStorage, MemoryStorage, ROOM_ID, type LiveStorage, type RoomRecord, type SharedAsset } from "./storage";

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
      list: async () => [],
      touch: async () => undefined,
      loadAsset: async () => null,
      saveAsset: async () => undefined,
      assetBytes: async () => 0,
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
    expect(await b.storage.loadAsset(made.room, "img-1")).not.toBeNull();
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
    expect(await b.storage.loadAsset(made.room, "img-1")).not.toBeNull();
    expect(await b.storage.loadAsset(made.room, "img-2")).toBeNull();
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
    expect(await b.storage.loadAsset(made.room, "img-1")).toBeNull();
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

describe("a room that nobody uses any more", () => {
  const DAY = 24 * 60 * 60 * 1000;
  /** A clock that a test moves, for the server and for a store in memory alike. */
  const clock = () => {
    let at = Date.now();
    return { now: () => at, pass: (ms: number) => void (at += ms) };
  };
  /** Long enough for several rounds of a sweep that runs every 20 ms. */
  const someSweeps = () => new Promise((r) => setTimeout(r, 150));
  /** A store in memory that counts what the server asks of it. */
  class Watched extends MemoryStorage {
    lists = 0;
    touches: string[] = [];
    override async list() {
      this.lists++;
      return super.list();
    }
    override async touch(id: string, at: number) {
      this.touches.push(id);
      return super.touch(id, at);
    }
  }

  it("is removed when it was last used longer ago than rooms may live, and one that was joined since is kept", async () => {
    const time = clock();
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, idleCloseMs: 20, now: time.now }, new MemoryStorage(time.now));
    const [old, visited] = [await makeRoom(b), await makeRoom(b)];
    time.pass(6 * DAY);
    const viewer = join(b, visited.room, visited.viewKey); // looking is using
    await until("live", () => viewer.status === "live");
    viewer.stop();
    await until("the room to leave memory", () => b.server.rooms() === 0);
    time.pass(5 * DAY); // eleven days for the one, five for the other
    await until("the old room to be removed", async () => (await b.storage.load(old.room)) === null);
    await someSweeps();
    expect(await b.storage.load(visited.room)).not.toBeNull();
    expect(await b.storage.count()).toBe(1);
    const late = join(b, old.room, old.editKey);
    await until("a late visitor to be refused", () => late.status === "denied");
    expect(late.denied).toBe("not-found");
    // and the other goes too when its time has come
    time.pass(6 * DAY);
    await until("the second room to be removed", async () => (await b.storage.count()) === 0);
  });

  it("keeps a room that was edited since: saving is using", async () => {
    const time = clock();
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, now: time.now }, new MemoryStorage(time.now));
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    time.pass(9 * DAY);
    ann.edit(ann.design!, rename(ann.design!, "Still in use"));
    await until("confirmed", () => ann.session.pending === 0);
    ann.stop();
    time.pass(9 * DAY);
    await someSweeps();
    expect((await b.storage.load(made.room))?.design.title).toBe("Still in use");
  });

  it("is never removed while somebody is in it, and has been used when the sweep finds it so", async () => {
    const time = clock();
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, now: time.now }, new MemoryStorage(time.now));
    const made = await makeRoom(b);
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    time.pass(30 * DAY);
    await someSweeps();
    expect(ann.status).toBe("live");
    expect(await b.storage.load(made.room)).not.toBeNull();
    // she leaves after thirty days: the room was in use until now, and is not removed on the spot
    ann.stop();
    time.pass(9 * DAY);
    await someSweeps();
    expect(await b.storage.load(made.room)).not.toBeNull();
    // it is still in memory (nobody has been gone for a minute), and goes from there too when its time has come
    expect(b.server.rooms()).toBe(1);
    time.pass(2 * DAY);
    await until("the room to be removed", async () => (await b.storage.load(made.room)) === null);
    await until("the room to leave memory", () => b.server.rooms() === 0);
  });

  it("is not removed while an image for it is on its way", async () => {
    const time = clock();
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, now: time.now }, new MemoryStorage(time.now));
    const made = await makeRoom(b);
    const image = JSON.stringify({ mime: "image/png", base64: Buffer.from("a picture").toString("base64") });
    const req = request(`${b.http}/api/rooms/${made.room}/assets/img-1`, {
      method: "PUT",
      headers: { "x-craftly-key": made.editKey, "content-length": Buffer.byteLength(image) },
    });
    const status = new Promise<number>((resolve) => req.on("response", (res) => resolve(res.resume().statusCode ?? 0)));
    req.write(image.slice(0, 20));
    await until("the room to be read", () => b.server.rooms() === 1);
    time.pass(11 * DAY);
    await someSweeps();
    req.end(image.slice(20));
    expect(await status).toBe(201);
    expect(await b.storage.loadAsset(made.room, "img-1")).not.toBeNull();
  });

  it("sends away whoever came to a room while it was being removed", async () => {
    const time = clock();
    let release = () => undefined as void;
    let started = () => undefined as void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const removing = new Promise<void>((resolve) => (started = resolve));
    class Slow extends MemoryStorage {
      override async remove(id: string) {
        started();
        await held;
        return super.remove(id);
      }
    }
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, now: time.now }, new Slow(time.now));
    const made = await makeRoom(b);
    time.pass(11 * DAY);
    await removing;
    const late = raw(b, made.room, made.editKey);
    await late.opened;
    await new Promise((r) => setTimeout(r, 50)); // it has found the room, which is still there
    release();
    await until("the late one to be sent away", () => late.closed() === 4004);
    expect(late.heard).toEqual([{ t: "denied", reason: "not-found" }]);
    expect(await b.storage.load(made.room)).toBeNull();
  });

  it("notes that a room was used when somebody joins, but not more often than once a day", async () => {
    const time = clock();
    const storage = new Watched(time.now);
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, now: time.now }, storage);
    const made = await makeRoom(b);
    const visit = async () => {
      const visitor = join(b, made.room, made.viewKey);
      await until("live", () => visitor.status === "live");
      visitor.stop();
    };
    await visit(); // the room was made a moment ago
    expect(storage.touches).toEqual([]);
    time.pass(2 * DAY);
    await visit();
    await until("the note", () => storage.touches.length === 1);
    time.pass(DAY - 1000);
    await visit();
    await visit();
    expect(storage.touches).toHaveLength(1);
    time.pass(1000);
    await visit();
    await until("the second note", () => storage.touches.length === 2);
    expect(storage.touches).toEqual([made.room, made.room]);
  });

  it("notes it more often when rooms live for less than four days, so that a room in use does not expire between two notes", async () => {
    const time = clock();
    const storage = new Watched(time.now);
    const b = await boot({ roomTtlMs: DAY, sweepEveryMs: 20, now: time.now }, storage);
    const made = await makeRoom(b);
    time.pass(DAY / 4);
    const visitor = join(b, made.room, made.viewKey);
    await until("live", () => visitor.status === "live");
    await until("the note", () => storage.touches.length === 1);
  });

  it("removes nothing, and does not even look, unless it is told how long rooms may live", async () => {
    const time = clock();
    for (const roomTtlMs of [undefined, 0]) {
      const storage = new Watched(time.now);
      const b = await boot({ roomTtlMs, sweepEveryMs: 20, now: time.now }, storage);
      const made = await makeRoom(b);
      time.pass(3650 * DAY);
      await someSweeps();
      expect(await storage.load(made.room)).not.toBeNull();
      expect(storage.lists).toBe(0);
    }
  });

  it("looks once when it starts, and then every hour unless it is told otherwise", async () => {
    const time = clock();
    const storage = new Watched(time.now);
    const before = await boot({ now: time.now }, storage);
    const made = await makeRoom(before);
    await before.server.close();
    servers.length = 0;
    time.pass(11 * DAY);
    const b = await boot({ roomTtlMs: 10 * DAY, now: time.now }, storage);
    await until("the room to be removed", async () => (await b.storage.load(made.room)) === null);
    await someSweeps();
    expect(storage.lists).toBe(1);
  });

  it("writes down a room it could not remove or a list it could not get, and goes on with the others and with the next round", async () => {
    const time = clock();
    let broken = true;
    class Faulty extends MemoryStorage {
      override async list() {
        if (broken) throw new Error("the disk is gone");
        return super.list();
      }
      override async remove(id: string) {
        if (id === stubborn.room) throw new Error("cannot be removed");
        return super.remove(id);
      }
    }
    const log = logged();
    const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20, idleCloseMs: 20, now: time.now }, new Faulty(time.now));
    const stubborn = await makeRoom(b);
    const other = await makeRoom(b);
    time.pass(11 * DAY);
    await until("the failure to be written down", () => log.mock.calls.length > 0);
    expect(String(log.mock.calls[0][1])).toContain("the disk is gone");
    expect(await b.storage.count()).toBe(2);
    broken = false;
    await until("the other room to be removed", async () => (await b.storage.load(other.room)) === null);
    expect(await b.storage.load(stubborn.room)).not.toBeNull();
    expect(log.mock.calls.some((call) => String(call[0]).includes(stubborn.room))).toBe(true);
    // a room that could not be removed is still a room: its people get in
    const ann = join(b, stubborn.room, stubborn.editKey);
    await until("live", () => ann.status === "live");
  });

  it("does not let a join fail because the note of it could not be written", async () => {
    const time = clock();
    class Faulty extends MemoryStorage {
      override async touch(): Promise<void> {
        throw new Error("cannot be touched");
      }
    }
    const log = logged();
    const b = await boot({ now: time.now }, new Faulty(time.now));
    const made = await makeRoom(b);
    time.pass(2 * DAY);
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    await until("the failure to be written down", () => log.mock.calls.length === 1);
    ann.edit(ann.design!, rename(ann.design!, "Works"));
    await until("confirmed", () => ann.session.pending === 0);
  });

  describe("with files on a disk", () => {
    const folder = () => mkdtempSync(join2(tmpdir(), "craftly-live-test-"));

    it("takes the time of a room's file as the time it was last used, and sets it without reading or writing the room", async () => {
      const dir = folder();
      try {
        const storage = new FileStorage(dir);
        expect(await storage.list()).toEqual([]); // the folder is not even there yet
        const b = await boot({}, storage);
        const [one, two] = [await makeRoom(b), await makeRoom(b)];
        // what is in the folder and is not a room is not listed
        writeFileSync(join2(dir, "notes.json"), "{}");
        writeFileSync(join2(dir, `${one.room}.json.abc123.tmp`), "{}");
        mkdirSync(join2(dir, "a-folder"));
        const listed = await storage.list();
        expect(listed.map((room) => room.id).sort()).toEqual([one.room, two.room].sort());
        for (const room of listed) expect(Math.abs(room.usedAt - Date.now())).toBeLessThan(60_000);
        const before = readFileSync(join2(dir, `${one.room}.json`), "utf8");
        const then = Date.now() - 40 * DAY;
        await storage.touch(one.room, then);
        const again = await storage.list();
        expect(Math.abs(again.find((room) => room.id === one.room)!.usedAt - then)).toBeLessThan(2000);
        expect(Math.abs(again.find((room) => room.id === two.room)!.usedAt - Date.now())).toBeLessThan(60_000);
        expect(readFileSync(join2(dir, `${one.room}.json`), "utf8")).toBe(before);
        // a room that is not there is not made by noting that it was used
        await storage.touch("A".repeat(22), then);
        expect(await storage.count()).toBe(3); // the two rooms and the notes
        expect(existsSync(join2(dir, `${"A".repeat(22)}.json`))).toBe(false);
        await expect(storage.touch("../outside", then)).rejects.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("removes the file of a room that has expired, and leaves a damaged one where it is with a line in the log", async () => {
      const dir = folder();
      try {
        const storage = new FileStorage(dir);
        const before = await boot({}, storage);
        const [old, damaged, fresh] = [await makeRoom(before), await makeRoom(before), await makeRoom(before)];
        await before.server.close();
        servers.length = 0;
        writeFileSync(join2(dir, `${damaged.room}.json`), '{"design": {"pages": [');
        const longAgo = Date.now() - 11 * DAY;
        await storage.touch(old.room, longAgo);
        await storage.touch(damaged.room, longAgo);
        const log = logged();
        const b = await boot({ roomTtlMs: 10 * DAY, sweepEveryMs: 20 }, storage);
        await until("the old room to be removed", () => !existsSync(join2(dir, `${old.room}.json`)));
        await until("the damaged one to be written down", () => log.mock.calls.some((call) => String(call[0]).includes(damaged.room)));
        expect(existsSync(join2(dir, `${damaged.room}.json`))).toBe(true);
        expect(existsSync(join2(dir, `${fresh.room}.json`))).toBe(true);
        const ann = join(b, fresh.room, fresh.editKey);
        await until("live", () => ann.status === "live");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("the images of a room", () => {
  const picture = (text: string): SharedAsset => ({ mime: "image/png", base64: Buffer.from(text).toString("base64") });
  const at = (b: Booted, made: Made, id: string) => `${b.http}/api/rooms/${made.room}/assets/${id}`;
  const put = (b: Booted, made: Made, id: string, image: SharedAsset) =>
    fetch(at(b, made, id), { method: "PUT", headers: { "x-craftly-key": made.editKey }, body: JSON.stringify(image) });
  const get = (b: Booted, made: Made, id: string) => fetch(at(b, made, id), { headers: { "x-craftly-key": made.viewKey } });
  /** A room as a server before this change kept it: its images inside its record. */
  const withImagesInside = async (b: Booted, made: Made, images: Record<string, SharedAsset>) => {
    const record = (await b.storage.load(made.room))!;
    await b.storage.save(made.room, { ...record, assets: images });
  };
  /** A store in memory that remembers what it was asked to write. */
  class Watched extends MemoryStorage {
    records: RoomRecord[] = [];
    images: string[] = [];
    override async save(id: string, record: RoomRecord, designJson?: string) {
      this.records.push(record);
      return super.save(id, record, designJson);
    }
    override async saveAsset(id: string, assetId: string, asset: SharedAsset) {
      this.images.push(assetId);
      return super.saveAsset(id, assetId, asset);
    }
  }
  const edit = async (b: Booted, made: Made, title: string) => {
    const ann = join(b, made.room, made.editKey);
    await until("live", () => ann.status === "live");
    ann.edit(ann.design!, rename(ann.design!, title));
    await until("confirmed", () => ann.session.pending === 0);
    ann.stop();
  };

  it("are kept one by one beside the record of the room, not in it: an upload does not write the design again, and an edit does not write the images again", async () => {
    const storage = new Watched();
    const b = await boot({}, storage);
    const made = await makeRoom(b);
    storage.records.length = 0;
    const image = picture("the first picture");
    expect((await put(b, made, "img-1", image)).status).toBe(201);
    expect(storage.records).toHaveLength(0);
    expect(storage.images).toEqual(["img-1"]);
    expect(await storage.loadAsset(made.room, "img-1")).toEqual(image);
    await edit(b, made, "Edited");
    await edit(b, made, "Edited twice");
    expect(storage.images).toEqual(["img-1"]);
    expect(storage.records).toHaveLength(2);
    for (const record of storage.records) expect(JSON.stringify(record)).not.toContain(image.base64);
    expect((await storage.load(made.room))?.assets).toBeUndefined();
    // and the people of the room are given it as before
    const res = await get(b, made, "img-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(image);
    expect((await get(b, made, "img-2")).status).toBe(404);
  });

  it("takes the same image a second time without a word, and refuses another image under a name that is taken", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect((await put(b, made, "img-1", picture("one"))).status).toBe(201);
    expect((await put(b, made, "img-1", picture("one"))).status).toBe(200);
    expect((await put(b, made, "img-1", picture("another"))).status).toBe(409);
    expect((await put(b, made, "img-1", { ...picture("one"), mime: "image/jpeg" })).status).toBe(409);
    expect(await b.storage.loadAsset(made.room, "img-1")).toEqual(picture("one"));
  });

  it("holds no more images for a room than it may, counted over all of its files", async () => {
    const b = await boot({ maxRoomAssetBytes: 3000 });
    const made = await makeRoom(b);
    const big = (letter: string) => picture(letter.repeat(900)); // 1200 characters each
    expect((await put(b, made, "img-1", big("a"))).status).toBe(201);
    expect((await put(b, made, "img-2", big("b"))).status).toBe(201);
    const third = await put(b, made, "img-3", big("c"));
    expect(third.status).toBe(413);
    expect(((await third.json()) as { error: string }).error).toMatch(/image storage limit/);
    expect(await b.storage.loadAsset(made.room, "img-3")).toBeNull();
    expect((await put(b, made, "img-3", picture("small"))).status).toBe(201);
    // another room has an allowance of its own
    const other = await makeRoom(b);
    expect((await put(b, other, "img-1", big("d"))).status).toBe(201);
  });

  it("allows a room 48 MiB of images unless it is told otherwise", async () => {
    class Full extends MemoryStorage {
      override async assetBytes() {
        return 48 * 1024 * 1024 - 100;
      }
    }
    const b = await boot({ maxRoomAssetBytes: undefined }, new Full());
    const made = await makeRoom(b);
    expect((await put(b, made, "img-1", picture("x".repeat(30)))).status).toBe(201);
    expect((await put(b, made, "img-2", picture("x".repeat(90)))).status).toBe(413);
  });

  it("forgets the images with the room", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect((await put(b, made, "img-1", picture("one"))).status).toBe(201);
    expect((await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } })).status).toBe(200);
    expect(await b.storage.loadAsset(made.room, "img-1")).toBeNull();
    expect(await b.storage.assetBytes(made.room)).toBe(0);
  });

  describe("of a room that an older server saved with its images inside its record", () => {
    const old = { "img-old": picture("kept inside the record"), "img-two": picture("another one inside") };

    it("are given to the people of the room as they are, before anything is saved", async () => {
      const b = await boot();
      const made = await makeRoom(b);
      await withImagesInside(b, made, old);
      const res = await get(b, made, "img-old");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(old["img-old"]);
      expect((await get(b, made, "img-none")).status).toBe(404);
      expect((await b.storage.load(made.room))?.assets).toEqual(old); // looking moves nothing
    });

    it("are moved out, each into a file of its own, with the first edit that is saved, and are still given after that and after a restart", async () => {
      const storage = new Watched();
      const b = await boot({}, storage);
      const made = await makeRoom(b);
      await withImagesInside(b, made, old);
      await edit(b, made, "Edited by a newer server");
      const record = (await storage.load(made.room))!;
      expect(record.assets).toBeUndefined();
      expect(record.design.title).toBe("Edited by a newer server");
      expect(record.rev).toBe(1);
      expect(storage.images.sort()).toEqual(["img-old", "img-two"]);
      expect(await storage.loadAsset(made.room, "img-old")).toEqual(old["img-old"]);
      expect(await storage.loadAsset(made.room, "img-two")).toEqual(old["img-two"]);
      await edit(b, made, "Edited again");
      expect(storage.images).toHaveLength(2); // moved once
      await b.server.close();
      servers.length = 0;
      const again = await boot({}, storage);
      const res = await get(again, made, "img-two");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(old["img-two"]);
    });

    it("are moved out with the first upload too, count towards what the room may hold, and keep their names taken", async () => {
      const b = await boot({ maxRoomAssetBytes: 200 });
      const made = await makeRoom(b);
      await withImagesInside(b, made, old); // 32 and 24 characters
      expect((await put(b, made, "img-old", old["img-old"])).status).toBe(200);
      expect((await put(b, made, "img-old", picture("something else"))).status).toBe(409);
      expect((await b.storage.load(made.room))?.assets).toEqual(old); // nothing was saved yet
      expect((await put(b, made, "img-big", picture("x".repeat(120)))).status).toBe(413); // 160 more would be too much
      expect((await put(b, made, "img-new", picture("x".repeat(30)))).status).toBe(201);
      expect((await b.storage.load(made.room))?.assets).toBeUndefined();
      for (const [id, image] of Object.entries({ ...old, "img-new": picture("x".repeat(30)) })) expect(await b.storage.loadAsset(made.room, id)).toEqual(image);
      expect((await put(b, made, "img-old", old["img-old"])).status).toBe(200);
      expect((await put(b, made, "img-big", picture("x".repeat(120)))).status).toBe(413);
    });

    it("stay inside the record when they could not be moved out, and the edit is refused, so that no image is lost", async () => {
      class Faulty extends MemoryStorage {
        override async saveAsset(): Promise<void> {
          throw new Error("disk full");
        }
      }
      const log = logged();
      const b = await boot({}, new Faulty());
      const made = await makeRoom(b);
      await withImagesInside(b, made, old);
      const s = raw(b, made.room, made.editKey);
      await s.opened;
      s.join("editor");
      s.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "Lost" } }] });
      await until("the refusal", () => s.heard.some((m) => m.t === "rejected"));
      expect(log).toHaveBeenCalled();
      const record = (await b.storage.load(made.room))!;
      expect(record.assets).toEqual(old);
      expect(record.rev).toBe(0);
      expect((await get(b, made, "img-old")).status).toBe(200);
    });
  });

  describe("with files on a disk", () => {
    const folder = () => mkdtempSync(join2(tmpdir(), "craftly-live-test-"));

    it("are files in a folder of the room, whatever their names are, and go when the room goes", async () => {
      const dir = folder();
      try {
        const storage = new FileStorage(dir);
        const b = await boot({}, storage);
        const made = await makeRoom(b);
        expect(await storage.assetBytes(made.room)).toBe(0);
        expect(await storage.loadAsset(made.room, "img-1")).toBeNull();
        // names that differ only in capitals, and names that some systems do not allow for a file
        const names = ["img-1", "IMG-1", "CON", "nul", "a".repeat(128)];
        for (const name of names) expect((await put(b, made, name, picture(`the picture called ${name}`))).status).toBe(201);
        for (const name of names) expect(await (await get(b, made, name)).json()).toEqual(picture(`the picture called ${name}`));
        const images = join2(dir, `${made.room}.assets`);
        expect(readdirSync(images)).toHaveLength(names.length);
        expect(await storage.assetBytes(made.room)).toBeGreaterThan(names.length * 30);
        // the record of the room holds none of them, and the folder of the images is not taken for a room
        expect(readFileSync(join2(dir, `${made.room}.json`), "utf8")).not.toContain(picture("the picture called CON").base64);
        expect(await storage.count()).toBe(1);
        expect((await storage.list()).map((room) => room.id)).toEqual([made.room]);
        await edit(b, made, "Edited");
        expect(readdirSync(images)).toHaveLength(names.length);
        expect((await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } })).status).toBe(200);
        expect(existsSync(images)).toBe(false);
        expect(readdirSync(dir)).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("says that the server has a problem when the file of an image is damaged, and not that the image is gone", async () => {
      const dir = folder();
      try {
        const storage = new FileStorage(dir);
        const b = await boot({}, storage);
        const made = await makeRoom(b);
        expect((await put(b, made, "img-1", picture("one"))).status).toBe(201);
        expect((await put(b, made, "img-2", picture("two"))).status).toBe(201);
        const images = join2(dir, `${made.room}.assets`);
        const [first, second] = readdirSync(images);
        writeFileSync(join2(images, first), '{"mime": "image/png", "base');
        writeFileSync(join2(images, second), JSON.stringify({ mime: 5 }));
        const log = logged();
        expect((await get(b, made, "img-1")).status).toBe(500);
        expect((await get(b, made, "img-2")).status).toBe(500);
        expect(log).toHaveBeenCalledTimes(2);
        await expect(storage.loadAsset("../outside", "img-1")).rejects.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("moves the images of an older room out of its file with the first edit", async () => {
      const dir = folder();
      try {
        const storage = new FileStorage(dir);
        const b = await boot({}, storage);
        const made = await makeRoom(b);
        const image = picture("kept inside the file of the room");
        await withImagesInside(b, made, { "img-old": image });
        expect(readFileSync(join2(dir, `${made.room}.json`), "utf8")).toContain(image.base64);
        await edit(b, made, "Edited");
        const text = readFileSync(join2(dir, `${made.room}.json`), "utf8");
        expect(text).not.toContain(image.base64);
        expect((JSON.parse(text) as RoomRecord).design.title).toBe("Edited");
        expect(await storage.loadAsset(made.room, "img-old")).toEqual(image);
        expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("saving an edit", () => {
  it.each<[string, () => { storage: LiveStorage; done: () => void }]>([
    ["in memory", () => ({ storage: new MemoryStorage(), done: () => undefined })],
    [
      "on a disk",
      () => {
        const dir = mkdtempSync(join2(tmpdir(), "craftly-live-test-"));
        return { storage: new FileStorage(dir), done: () => rmSync(dir, { recursive: true, force: true }) };
      },
    ],
  ])("turns the design into text once, not once to measure it and once more to write it (%s)", async (_where, make) => {
    const { storage, done } = make();
    try {
      const b = await boot({}, storage);
      const mark = "a-title-that-is-nowhere-else";
      const made = await makeRoom(b, { ...design(), title: mark });
      const s = raw(b, made.room, made.editKey);
      await s.opened;
      s.join("editor");
      await until("the welcome", () => s.heard.some((m) => m.t === "welcome"));
      const stringify = vi.spyOn(JSON, "stringify");
      const texts = () => stringify.mock.results.filter((result) => typeof result.value === "string" && result.value.includes(mark)).length;
      s.say({ t: "ops", seq: 1, ops: [{ k: "page.set", id: "p", set: { name: "Renamed" } }] });
      await until("the ack", () => s.heard.some((m) => m.t === "ack"));
      expect(texts()).toBe(1);
      stringify.mockRestore();
      // and what was written is the room, whole
      const saved = (await storage.load(made.room))!;
      expect(saved.rev).toBe(1);
      expect(saved.design.title).toBe(mark);
      expect(saved.design.pages[0]).toMatchObject({ name: "Renamed" });
      expect(saved.seqs).toEqual({ editor: 1 });
      expect(saved.editHash).toMatch(/^[0-9a-f]{64}$/);
      expect(saved.createdAt).toBeGreaterThan(0);
    } finally {
      done();
    }
  });

  it("still refuses an edit that makes the design bigger than a room may be", async () => {
    const b = await boot({ maxDesignBytes: 3000 });
    const made = await makeRoom(b);
    const log = logged();
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.join("editor");
    s.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "x".repeat(4000) } }] });
    await until("the refusal", () => s.heard.some((m) => m.t === "rejected"));
    expect(log).toHaveBeenCalled();
    expect((await b.storage.load(made.room))?.rev).toBe(0);
  });
});

describe("a key for making rooms", () => {
  const CREATE_KEY = "a-key-the-operator-gave-out";
  const post = (b: Booted, headers: Record<string, string> = {}, path = "/api/rooms") =>
    fetch(`${b.http}${path}`, { method: "POST", headers, body: JSON.stringify({ design: design() }) });

  it("asks for nothing unless the server was given one", async () => {
    const b = await boot();
    expect((await post(b)).status).toBe(201);
    // and a key that nobody asked for does no harm
    expect((await post(b, { "x-craftly-create-key": "whatever" })).status).toBe(201);
  });

  it("makes no room without the key, and says that one is needed", async () => {
    const b = await boot({ roomCreateKey: CREATE_KEY });
    const res = await post(b);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/asks for a key/), code: "create-key-needed" });
    expect(await b.storage.count()).toBe(0);
  });

  it("makes no room with a wrong key, and says that it is wrong", async () => {
    const b = await boot({ roomCreateKey: CREATE_KEY });
    for (const wrong of ["nope", CREATE_KEY + "x", CREATE_KEY.slice(1), "", "x".repeat(5000)]) {
      const res = await post(b, { "x-craftly-create-key": wrong });
      // (a header that is there and empty is a key that was not given)
      expect(res.status).toBe(wrong ? 403 : 401);
      expect(((await res.json()) as { code: string }).code).toBe(wrong ? "create-key-wrong" : "create-key-needed");
    }
    expect(await b.storage.count()).toBe(0);
  });

  it("makes a room with the key, which is then of no use to anybody: joining, editing and stopping do not ask for it", async () => {
    const b = await boot({ roomCreateKey: CREATE_KEY });
    const res = await post(b, { "x-craftly-create-key": CREATE_KEY });
    expect(res.status).toBe(201);
    const made = (await res.json()) as Made;
    const editor = join(b, made.room, made.editKey);
    const viewer = join(b, made.room, made.viewKey);
    await until("both in", () => editor.status === "live" && viewer.status === "live");
    editor.edit(editor.design!, rename(editor.design!, "Renamed"));
    await until("the edit to arrive", () => viewer.design?.title === "Renamed");
    const stop = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } });
    expect(stop.status).toBe(200);
  });

  it("does not take the key from the address", async () => {
    const b = await boot({ roomCreateKey: CREATE_KEY });
    for (const name of ["key", "createKey", "x-craftly-create-key"]) {
      expect((await post(b, {}, `/api/rooms?${name}=${CREATE_KEY}`)).status).toBe(401);
    }
  });

  it("is asked before the design is read, and every attempt counts for the address", async () => {
    const b = await boot({ roomCreateKey: CREATE_KEY, roomCreatePerHour: 3 });
    // no body worth reading: with the right key this would be 400, without it the body is never looked at
    const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: "not json" });
    expect(res.status).toBe(401);
    expect((await post(b, { "x-craftly-create-key": "guess-1" })).status).toBe(403);
    expect((await post(b, { "x-craftly-create-key": "guess-2" })).status).toBe(403);
    // the allowance of the hour is used up, also for the right key
    const late = await post(b, { "x-craftly-create-key": CREATE_KEY });
    expect(late.status).toBe(429);
  });

  it("never writes the key to the log", async () => {
    const out = [logged(), vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const b = await boot({ roomCreateKey: CREATE_KEY });
    await post(b, { "x-craftly-create-key": "a-wrong-key-of-somebody" });
    await post(b, { "x-craftly-create-key": CREATE_KEY });
    const written = JSON.stringify(out.flatMap((spy) => spy.mock.calls));
    expect(written).not.toContain(CREATE_KEY);
    expect(written).not.toContain("a-wrong-key-of-somebody");
  });

  it("lets a page of an allowed origin send the key: the answer to the question beforehand names the header", async () => {
    const b = await boot({ roomCreateKey: CREATE_KEY, allowOrigin: ["https://app.example.test"] });
    const pre = await fetch(`${b.http}/api/rooms`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example.test", "access-control-request-method": "POST", "access-control-request-headers": "x-craftly-create-key" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase().split(/,\s*/)).toContain("x-craftly-create-key");
    const res = await post(b, { origin: "https://app.example.test", "x-craftly-create-key": CREATE_KEY });
    expect(res.status).toBe(201);
    // a page of another origin is turned away before the key is looked at
    expect((await post(b, { origin: "https://evil.example.test", "x-craftly-create-key": CREATE_KEY })).status).toBe(403);
  });
});

describe("the operator's tools", () => {
  const ADMIN_KEY = "the-operators-own-key-0123456789";
  const admin = (b: Booted, path: string, init: RequestInit = {}, key: string | null = ADMIN_KEY) =>
    fetch(`${b.http}/api/admin${path}`, { ...init, headers: { ...(key === null ? {} : { "x-craftly-admin-key": key }), ...(init.headers as Record<string, string>) } });
  type Listed = { id: string; title?: string; createdAt?: number; usedAt: number; designBytes?: number; imageBytes?: number; people: number; error?: string };
  type Listing = { rooms: Listed[]; total: number; next: string | null };
  const png = { mime: "image/png", base64: Buffer.from("not really a picture, but long enough to weigh something").toString("base64") };

  it("does not exist unless the server was given a key for it", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    for (const key of [null, "", "anything"]) {
      expect((await admin(b, "/rooms", {}, key)).status).toBe(404);
      expect((await admin(b, `/rooms/${made.room}`, { method: "DELETE" }, key)).status).toBe(404);
    }
    expect(await b.storage.count()).toBe(1);
  });

  it("lists the rooms: what each is called, when it was made and last used, how much it holds and who is in it now, and no key of any", async () => {
    let at = 1_700_000_000_000;
    const b = await boot({ adminKey: ADMIN_KEY, now: () => at }, new MemoryStorage(() => at));
    const first = await makeRoom(b, { ...design(), title: "The first" });
    at += 60_000;
    const second = await makeRoom(b, { ...design(), title: "The second" });
    const put = await fetch(`${b.http}/api/rooms/${second.room}/assets/picture-1`, { method: "PUT", headers: { "x-craftly-key": second.editKey }, body: JSON.stringify(png) });
    expect(put.status).toBe(201);
    const [editor, viewer] = [join(b, second.room, second.editKey), join(b, second.room, second.viewKey)];
    const waiting = raw(b, second.room, second.editKey); // at the door, key not shown: not one of the people in the room
    await waiting.opened;
    await until("both in", () => editor.status === "live" && viewer.status === "live");

    const res = await admin(b, "/rooms");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const listing = JSON.parse(text) as Listing;
    expect(listing.total).toBe(2);
    expect(listing.next).toBeNull();
    const byId = new Map(listing.rooms.map((room) => [room.id, room]));
    expect([...byId.keys()].sort()).toEqual([first.room, second.room].sort());
    expect(listing.rooms.map((room) => room.id)).toEqual([...byId.keys()].sort()); // in the order of their ids, which is what pages go by
    const record = (await b.storage.load(first.room))!;
    expect(byId.get(first.room)).toEqual({
      id: first.room,
      title: "The first",
      createdAt: 1_700_000_000_000,
      usedAt: 1_700_000_000_000,
      designBytes: Buffer.byteLength(JSON.stringify(record.design)),
      imageBytes: 0,
      people: 0,
    });
    expect(byId.get(second.room)).toMatchObject({ title: "The second", createdAt: 1_700_000_060_000, people: 2 });
    expect(byId.get(second.room)!.imageBytes).toBe(await b.storage.assetBytes(second.room));
    expect(byId.get(second.room)!.imageBytes).toBeGreaterThan(png.base64.length);
    // nothing that lets anybody in: no key (the server has none) and no hash of one
    for (const secret of [first.editKey, first.viewKey, first.ownerKey, record.editHash, record.viewHash, record.ownerHash!, "Hash", "Key"]) expect(text).not.toContain(secret);
  });

  it("counts what an older server left inside a record as the images of that room", async () => {
    const b = await boot({ adminKey: ADMIN_KEY });
    const made = await makeRoom(b);
    await b.storage.save(made.room, { ...(await b.storage.load(made.room))!, assets: { old: png } });
    const listing = (await (await admin(b, "/rooms")).json()) as Listing;
    expect(listing.rooms[0].imageBytes).toBe(png.base64.length);
  });

  it("hands the rooms out in pages", async () => {
    const b = await boot({ adminKey: ADMIN_KEY, roomCreatePerHour: 0 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await makeRoom(b)).room);
    ids.sort();
    const seen: string[] = [];
    let after = "";
    for (let page = 0; page < 3; page++) {
      const listing = (await (await admin(b, `/rooms?limit=2${after ? `&after=${after}` : ""}`)).json()) as Listing;
      expect(listing.total).toBe(5);
      seen.push(...listing.rooms.map((room) => room.id));
      expect(listing.next).toBe(page < 2 ? seen[seen.length - 1] : null);
      after = listing.next ?? "";
    }
    expect(seen).toEqual(ids);
    // a page is never more than 500 rooms, and a size that is none is the usual one
    for (const limit of ["0", "-3", "x", "1.5", "100000"]) {
      const res = await admin(b, `/rooms?limit=${limit}`);
      expect(res.status).toBe(limit === "100000" ? 200 : 400);
    }
    expect((await admin(b, "/rooms?after=../../etc")).status).toBe(400);
  });

  it("lists a room that cannot be read as one that cannot be read, and the others with it", async () => {
    const dir = mkdtempSync(join2(tmpdir(), "craftly-live-test-"));
    try {
      const b = await boot({ adminKey: ADMIN_KEY }, new FileStorage(dir));
      const [good, bad] = [await makeRoom(b), await makeRoom(b)];
      writeFileSync(join2(dir, `${bad.room}.json`), "{ not a room");
      const log = logged();
      const listing = (await (await admin(b, "/rooms")).json()) as Listing;
      expect(listing.total).toBe(2);
      const byId = new Map(listing.rooms.map((room) => [room.id, room]));
      expect(byId.get(good.room)).toMatchObject({ title: "Shared", people: 0 });
      expect(byId.get(bad.room)).toEqual({ id: bad.room, usedAt: expect.any(Number), people: 0, error: "this room cannot be read" });
      expect(log).toHaveBeenCalled();
      // and such a room can be removed, which nothing else can do
      expect((await admin(b, `/rooms/${bad.room}`, { method: "DELETE" })).status).toBe(200);
      expect(existsSync(join2(dir, `${bad.room}.json`))).toBe(false);
      expect(((await (await admin(b, "/rooms")).json()) as Listing).total).toBe(1);
    } finally {
      for (const server of servers.splice(0)) await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes a room the way its owner would: everybody in it is sent away, its images go, and its links are of no use", async () => {
    const b = await boot({ adminKey: ADMIN_KEY });
    const made = await makeRoom(b);
    const other = await makeRoom(b);
    await fetch(`${b.http}/api/rooms/${made.room}/assets/picture-1`, { method: "PUT", headers: { "x-craftly-key": made.editKey }, body: JSON.stringify(png) });
    const editor = join(b, made.room, made.editKey);
    const waiting = raw(b, made.room, made.editKey);
    await waiting.opened;
    await until("the editor", () => editor.status === "live");
    const res = await admin(b, `/rooms/${made.room}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await until("everybody to be sent away", () => editor.status === "denied" && waiting.closed() === 4004);
    expect(editor.denied).toBe("not-found");
    expect(await b.storage.load(made.room)).toBeNull();
    expect(await b.storage.assetBytes(made.room)).toBe(0);
    expect(b.server.rooms()).toBe(0);
    const late = join(b, made.room, made.editKey);
    await until("the late one", () => late.status === "denied");
    // the other room is as it was, and a room that is not there is said to be not there
    expect(await b.storage.load(other.room)).not.toBeNull();
    expect((await admin(b, `/rooms/${made.room}`, { method: "DELETE" })).status).toBe(404);
    expect((await admin(b, "/rooms/..%2F..%2Fetc", { method: "DELETE" })).status).toBe(404);
  });

  it("does nothing without the key or with another one, and takes the key from its header only", async () => {
    const b = await boot({ adminKey: ADMIN_KEY });
    const made = await makeRoom(b);
    for (const key of [null, "", "wrong", ADMIN_KEY + "x", ADMIN_KEY.slice(0, -1), made.ownerKey]) {
      const list = await admin(b, "/rooms", {}, key);
      expect(list.status).toBe(401);
      expect(JSON.stringify(await list.json())).not.toContain(made.room);
    }
    expect((await admin(b, `/rooms?key=${ADMIN_KEY}&adminKey=${ADMIN_KEY}`, {}, null)).status).toBe(401);
    expect((await admin(b, `/rooms/${made.room}`, { method: "DELETE" }, null)).status).toBe(401);
    expect((await fetch(`${b.http}/api/admin/rooms`, { headers: { "x-craftly-key": ADMIN_KEY, authorization: `Bearer ${ADMIN_KEY}` } })).status).toBe(401);
    expect(await b.storage.count()).toBe(1);
    // what is not part of it is not there, also with the key
    expect((await admin(b, "/nothing")).status).toBe(404);
    expect((await admin(b, "/rooms", { method: "POST" })).status).toBe(404);
  });

  it("stops listening to an address that guesses: after ten wrong keys in an hour the right one is refused too", async () => {
    let at = 1_700_000_000_000;
    const b = await boot({ adminKey: ADMIN_KEY, now: () => at });
    for (let i = 0; i < 10; i++) expect((await admin(b, "/rooms", {}, `guess-${i}`)).status).toBe(401);
    const blocked = await admin(b, "/rooms");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBe(3600);
    expect((await admin(b, "/rooms", {}, "one-more")).status).toBe(429);
    at += 61 * 60 * 1000;
    expect((await admin(b, "/rooms")).status).toBe(200);
    // the right key is not counted: an operator may ask as often as they like
    for (let i = 0; i < 30; i++) expect((await admin(b, "/rooms")).status).toBe(200);
  });

  it("counts guesses by the address the proxy names when one is trusted", async () => {
    const b = await boot({ adminKey: ADMIN_KEY, trustProxy: true });
    for (let i = 0; i < 10; i++) await admin(b, "/rooms", { headers: { "x-forwarded-for": "203.0.113.9" } }, "guess");
    expect((await admin(b, "/rooms", { headers: { "x-forwarded-for": "203.0.113.9" } })).status).toBe(429);
    expect((await admin(b, "/rooms", { headers: { "x-forwarded-for": "198.51.100.1" } })).status).toBe(200);
  });

  it("is not for pages: a request that names an origin is refused, whatever the origin and whatever the server allows, and gets no CORS headers", async () => {
    for (const allowOrigin of [undefined, "*", ["https://app.example.test"]] as const) {
      const b = await boot({ adminKey: ADMIN_KEY, allowOrigin: allowOrigin as LiveServerOptions["allowOrigin"] });
      const made = await makeRoom(b);
      for (const init of [{}, { method: "DELETE" }, { method: "OPTIONS" }]) {
        const res = await admin(b, init.method === "DELETE" ? `/rooms/${made.room}` : "/rooms", { ...init, headers: { origin: "https://app.example.test" } });
        expect(res.status).toBe(403);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        expect(res.headers.get("access-control-allow-headers")).toBeNull();
        expect(JSON.stringify(await res.json())).not.toContain(made.room);
      }
      expect(await b.storage.count()).toBe(1);
      // a question beforehand without an origin (no browser sends one) is no part of it either
      const pre = await admin(b, "/rooms", { method: "OPTIONS" });
      expect(pre.status).toBe(404);
      expect(pre.headers.get("access-control-allow-headers")).toBeNull();
    }
  });

  it("never writes the key to the log", async () => {
    const out = [logged(), vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const b = await boot({ adminKey: ADMIN_KEY });
    await admin(b, "/rooms");
    await admin(b, "/rooms", {}, "a-wrong-key-of-somebody");
    await admin(b, `/rooms/${"A".repeat(22)}`, { method: "DELETE" });
    const written = JSON.stringify(out.flatMap((spy) => spy.mock.calls));
    expect(written).not.toContain(ADMIN_KEY);
    expect(written).not.toContain("a-wrong-key-of-somebody");
  });

  it("answers 500 and writes it down when the storage cannot say which rooms there are", async () => {
    class Faulty extends MemoryStorage {
      async list(): Promise<never> {
        throw new Error("the disk is gone");
      }
    }
    const log = logged();
    const b = await boot({ adminKey: ADMIN_KEY }, new Faulty());
    expect((await admin(b, "/rooms")).status).toBe(500);
    expect(log).toHaveBeenCalled();
  });
});

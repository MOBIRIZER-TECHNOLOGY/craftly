/**
 * The server for shared designs, with a real HTTP server and real WebSockets on a port of its own: making a room, getting in with
 * a key, what a viewer may and may not do, two browsers editing at once through it, a room that survives a restart, and the limits
 * that keep one visitor from using the server up.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import { designsEqual } from "@/collab/ops";
import type { ClientMsg, ServerMsg } from "@/collab/protocol";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import { createLiveServer, type LiveServer, type LiveServerOptions } from "./live";
import { FileStorage, MemoryStorage, ROOM_ID } from "./storage";

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
});

async function boot(options: Partial<LiveServerOptions> = {}, storage = new MemoryStorage()) {
  const server = createLiveServer({ storage, saveDelayMs: 5, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  return { server, storage, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

type Booted = Awaited<ReturnType<typeof boot>>;
type Made = { room: string; editKey: string; viewKey: string };

async function makeRoom(b: Booted, d: Design = design()): Promise<Made> {
  const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: d }) });
  expect(res.status).toBe(201);
  return (await res.json()) as Made;
}

function join(b: Booted, room: string, key: string, client?: string) {
  const live = new Live({
    url: `${b.ws}?room=${encodeURIComponent(room)}&key=${encodeURIComponent(key)}`,
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

/** A bare socket, to say what a page of this app would never say. */
function raw(b: Booted, room: string, key: string) {
  const ws = new WebSocket(`${b.ws}?room=${room}&key=${key}`);
  sockets.push(ws);
  const heard: ServerMsg[] = [];
  let closed: number | null = null;
  ws.on("message", (d) => heard.push(JSON.parse(d.toString()) as ServerMsg));
  ws.on("close", (code) => (closed = code));
  const opened = new Promise<void>((resolve) => ws.on("open", () => resolve()));
  return { ws, heard, opened, closed: () => closed, say: (m: unknown) => ws.send(typeof m === "string" ? m : JSON.stringify(m)) };
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
    bad.say({ t: "join", client: "../x" });
    await until("the refusal", () => bad.heard.some((m) => m.t === "denied"));
    expect(bad.heard.find((m) => m.t === "denied")).toEqual({ t: "denied", reason: "bad-request" });
    const [one, two, three] = [join(b, made.room, made.editKey), join(b, made.room, made.editKey), join(b, made.room, made.editKey)];
    await until("the third", () => [one, two, three].filter((l) => l.status === "denied").length === 1);
    expect([one, two, three].find((l) => l.status === "denied")?.denied).toBe("server-full");
  });

  it("ignores what is said before the client has joined", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const early = raw(b, made.room, made.editKey);
    await early.opened;
    early.say({ t: "ops", seq: 1, ops: [{ k: "el.del", page: "p", id: "a" }] });
    early.say("this is not json {");
    early.say({ t: "join", client: "early" });
    await until("the welcome", () => early.heard.some((m) => m.t === "welcome"));
    const welcome = early.heard.find((m) => m.t === "welcome") as Extract<ServerMsg, { t: "welcome" }>;
    expect(welcome.rev).toBe(0);
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
    sneaky.say({ t: "join", client: "sneaky" });
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
    first.say({ t: "join", client: "same-client" });
    await until("the first welcome", () => first.heard.some((m) => m.t === "welcome"));
    const second = raw(b, made.room, made.editKey);
    await second.opened;
    second.say({ t: "join", client: "same-client" });
    await until("the old one to be closed", () => first.closed() === 4000);
    await until("the second welcome", () => second.heard.some((m) => m.t === "welcome"));
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
    const ok = await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.editKey } });
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
    };
    const b = await boot({}, failing as never);
    const lives = [join(b, "A".repeat(22), "k".repeat(12)), join(b, "../../etc/passwd", "k".repeat(12))];
    await until("both to be sent away", () => lives.every((l) => l.status === "denied"));
    expect(lives.every((l) => l.denied === "not-found")).toBe(true);
    expect((await fetch(`${b.http}/api/health`)).status).toBe(200);
  });

  it("with files on a disk, turns away a room id that would lead out of the folder", async () => {
    const dir = mkdtempSync(join2(tmpdir(), "craftly-live-test-"));
    try {
      const b = await boot({}, new FileStorage(dir) as never);
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
    s.say({ t: "join", client: "big" });
    await until("the welcome", () => s.heard.some((m) => m.t === "welcome"));
    s.say({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "x".repeat(5000) } }] });
    await until("the connection to be closed", () => s.closed() === 1009);
  });

  it("drops a connection that sends too many messages too fast", async () => {
    const b = await boot({ rate: { burst: 5, perSecond: 1 } });
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.say({ t: "join", client: "fast" });
    for (let i = 0; i < 20; i++) s.say({ t: "ping" });
    await until("the connection to be closed", () => s.closed() === 1008);
  });

  it("answers a batch it cannot accept with a refusal, and goes on", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const s = raw(b, made.room, made.editKey);
    await s.opened;
    s.say({ t: "join", client: "odd" });
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
    s.say({ t: "join", client: "odd" });
    await until("the welcome", () => s.heard.some((m) => m.t === "welcome"));
    const markup = ['<svg/onload="alert(1)"/>', "<svg><g onclick=alert(1)></g></svg>", '<svg><g ONCLICK="x"/></svg>', '<svg><linearGradient href="&#106;avascript:x"/></svg>'];
    markup.forEach((svg, i) => s.say({ t: "ops", seq: i + 1, ops: [{ k: "el.add", page: "p", parent: null, index: 0, el: { id: `g${i}`, type: "graphic", svg } }] }));
    await until("every refusal", () => s.heard.filter((m) => m.t === "rejected").length === markup.length);
    expect(s.heard.some((m) => m.t === "ack")).toBe(false);
    expect(JSON.stringify((await b.storage.load(made.room))!.design)).not.toContain("onload");
  });
});

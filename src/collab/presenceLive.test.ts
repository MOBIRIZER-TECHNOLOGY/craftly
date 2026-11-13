/**
 * Presence on the browser's side of the connection: it says where this person is only to a server that passes it on, only while
 * it is in the room, and never in the way of an edit; what the server passes on about the others is handed over once it has
 * been read; and neither end is broken by a peer that knows nothing of presence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { Live, type LiveStatus, type SocketLike } from "./live";
import type { PresenceHeard, PresenceState } from "./presence";
import type { ClientMsg, ServerMsg } from "./protocol";
import { Room, type Peer } from "./room";
import { Session } from "./session";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMsg[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }
  close(code?: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const base = (): Design =>
  createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 })] })] });
const welcome = (peer?: number) => ({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: base(), ...(peer === undefined ? {} : { peer }) });
const here = (over: Partial<PresenceState> = {}): PresenceState => ({ name: "Ana", page: "p", pointer: { x: 3, y: 4 }, selection: ["a"], editing: null, ...over });
const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let sockets: FakeSocket[];
let heard: PresenceHeard[];
let statuses: Array<[LiveStatus, string | null]>;
const make = (extra: Partial<ConstructorParameters<typeof Live>[0]> = {}) =>
  new Live({
    url: "ws://server.test/ws?room=r",
    key: "k",
    client: "me",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onChange: () => undefined,
    onStatus: (status, reason) => statuses.push([status, reason]),
    onPresence: (msg) => heard.push(msg),
    ...extra,
  });
const presences = (s: FakeSocket) => s.sent.filter((m) => m.t === "presence");

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  heard = [];
  statuses = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("saying where this person is", () => {
  it("goes out at once to a server that gave this connection a number, and the join is still the first thing said", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(4));
    expect(live.peer).toBe(4);
    expect(live.present(here())).toBe(true);
    expect(sockets[0].sent).toEqual([
      { t: "join", client: "me", key: "k" },
      { t: "presence", ...here() },
    ]);
  });

  it("is not said before the server has let this browser in", () => {
    const live = make();
    live.start();
    expect(live.present(here())).toBe(false);
    sockets[0].open();
    expect(live.present(here())).toBe(false);
    expect(presences(sockets[0])).toEqual([]);
  });

  it("is not said to a server from before there was presence, which gives no number: it would count the messages and pass none on", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome());
    expect(live.status).toBe("live");
    expect(live.peer).toBeNull();
    expect(live.present(here())).toBe(false);
    expect(presences(sockets[0])).toEqual([]);
  });

  it("is not said once the connection is lost, and is said again under the number of the next connection", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(4));
    sockets[0].close();
    expect(live.peer).toBeNull();
    expect(live.present(here())).toBe(false);
    vi.advanceTimersByTime(20_000);
    sockets[1].open();
    sockets[1].say(welcome(9));
    expect(live.peer).toBe(9);
    expect(live.present(here())).toBe(true);
    expect(presences(sockets[1])).toHaveLength(1);
  });

  it("does not wait behind an edit whose image is still being uploaded", async () => {
    let uploaded!: () => void;
    const live = make({ prepareEdit: () => new Promise<void>((resolve) => (uploaded = resolve)) });
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(1));
    live.edit(base(), { ...base(), title: "Renamed" });
    await vi.advanceTimersByTimeAsync(0);
    live.present(here());
    expect(sockets[0].sent.map((m) => m.t)).toEqual(["join", "presence"]);
    uploaded();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].sent.map((m) => m.t)).toEqual(["join", "presence", "ops"]);
  });
});

describe("hearing where the others are", () => {
  it("hands over what the server passed on, as it was read, and the design is not touched", () => {
    let changes = 0;
    const live = make({ onChange: () => void changes++ });
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(1));
    changes = 0;
    sockets[0].say({ t: "presence", peer: 2, ...here(), pointer: { x: 1e9, y: 0 } });
    sockets[0].say({ t: "presence", peer: 2, gone: true });
    expect(heard).toEqual([
      { t: "presence", peer: 2, ...here(), pointer: { x: 1_000_000, y: 0 } },
      { t: "presence", peer: 2, gone: true },
    ]);
    expect(changes).toBe(0);
    expect(live.session.rev).toBe(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a colour to use", { color: "red;background:url(https://evil.test/x)" }],
    ["a name that is not text", { name: { toString: "x" } }],
    ["a pointer that is no place", { pointer: "everywhere" }],
    ["an address to load", { src: "https://evil.test/pixel.png" }],
  ])("ends the session with a server whose presence carries %s, and hands none of it over", (_what, wrong) => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(1));
    sockets[0].say({ t: "presence", peer: 2, ...here(), ...wrong });
    expect(heard).toEqual([]);
    expect(live.status).toBe("denied");
    expect(statuses.at(-1)).toEqual(["denied", "invalid"]);
  });

  it("hears nothing more from a session that has ended", () => {
    const sent: ClientMsg[] = [];
    const session = new Session({ client: "me", key: "k", send: (m) => sent.push(m) });
    session.open();
    session.receive(welcome(1));
    session.receive({ t: "ack" });
    expect(session.status).toBe("ended");
    expect(session.receive({ t: "presence", peer: 2, gone: true })).toEqual({ changed: false, ended: null });
  });
});

describe("a peer that knows nothing of presence", () => {
  it("an older browser in a room with newer ones goes on: its session ignores a kind of message it does not know", () => {
    // what `parseServerMsg` of an older browser did with a kind it did not know is what this version does with one it does not know
    const sent: ClientMsg[] = [];
    const session = new Session({ client: "old", key: "k", send: (m) => sent.push(m) });
    session.open();
    session.receive(welcome(3));
    expect(session.receive({ t: "something-newer", peer: 2 })).toEqual({ changed: false, ended: null });
    expect(session.status).toBe("live");
  });

  it("a browser that never says where it is still edits, is still told of edits, and the others are simply not told of it", () => {
    const room = new Room(base());
    const wire = (name: string) => {
      const down: ServerMsg[] = [];
      const peer: Peer = { send: (m) => down.push(overTheWire(m)) };
      room.join(peer, name, "edit");
      return { peer, down };
    };
    const [old, fresh] = [wire("old"), wire("new")];
    void room.receive(fresh.peer, { t: "presence", ...here() });
    void room.receive(old.peer, { t: "ops", seq: 1, ops: [{ k: "el.set", page: "p", id: "a", set: { x: 7 } }] });
    expect(old.down.map((m) => m.t)).toEqual(["welcome", "presence", "ack"]);
    expect(fresh.down.map((m) => m.t)).toEqual(["welcome", "ops"]);
    room.leave(old.peer);
    expect(fresh.down.map((m) => m.t)).toEqual(["welcome", "ops"]); // nobody heard of it, so nobody is told that it went
  });
});

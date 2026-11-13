/**
 * Two things a room does beyond passing batches on (sync.test.ts has those). It refuses a batch that leaves an element which the
 * renderer cannot draw. And it does not remember every client that ever edited: what it knows of clients that stayed away is
 * forgotten after a while, in a way that can never make a batch count twice.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createLine, createPage, createShape, createText } from "@/core/factory";
import type { Design } from "@/core/types";
import type { Op } from "./ops";
import type { ClientMsg, ServerMsg } from "./protocol";
import { CLIENTS_KEPT, CLIENTS_KEPT_MS, Room, type ClientMemory, type Peer } from "./room";
import { Session, type Outbox } from "./session";

const start = (): Design =>
  createDesign({
    title: "Shared",
    width: 1000,
    height: 600,
    pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 0 }), createText({ id: "t", text: "Hello" }), createLine({ id: "l" })] })],
  });
const DAY = 24 * 60 * 60 * 1000;
const clock = (at = 1_700_000_000_000) => ({ now: () => at, pass: (ms: number) => void (at += ms) });
const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function peer() {
  const heard: ServerMsg[] = [];
  const p: Peer = { send: (msg) => heard.push(overTheWire(msg)) };
  return { peer: p, heard, last: () => heard[heard.length - 1] };
}

/** A client on a connection of its own, which says what it is told to say. */
function client(room: Room, name: string, role: "edit" | "view" = "edit") {
  const c = peer();
  room.join(c.peer, name, role);
  const welcome = c.last() as Extract<ServerMsg, { t: "welcome" }>;
  return { ...c, welcome, say: (seq: number, ops: Op[]) => room.receive(c.peer, { t: "ops", seq, ops: overTheWire(ops) }), leave: () => room.leave(c.peer) };
}
const move = (x: number): Op[] => [{ k: "el.set", page: "p", id: "a", set: { x } }];
const xOf = (room: Room) => room.design.pages[0].elements[0].x;

describe("a batch that would leave an element that cannot be drawn", () => {
  it.each<[string, Op[]]>([
    ["a place that is text", [{ k: "el.set", page: "p", id: "a", set: { x: "a" } }]],
    ["paragraphs that are a number", [{ k: "el.set", page: "p", id: "t", set: { paragraphs: 5 } }]],
    ["a size that is taken away", [{ k: "el.set", page: "p", id: "a", unset: ["width"] }]],
    ["a line that loses its stroke", [{ k: "el.set", page: "p", id: "l", set: { stroke: null } }]],
    [
      "one such change among good ones",
      [
        { k: "design", set: { title: "Renamed" } },
        { k: "el.set", page: "p", id: "a", set: { x: 5 } },
        { k: "el.set", page: "p", id: "t", set: { fontSize: "huge" } },
      ],
    ],
  ])("is refused as a whole, for %s: nothing of it is applied, saved or passed on", async (_what, ops) => {
    const room = new Room(start());
    const saved: number[] = [];
    room.commit = async (_design, rev) => void saved.push(rev);
    const [editor, other] = [client(room, "editor"), client(room, "other")];
    const before = room.design;
    await editor.say(1, ops);
    expect(editor.last()).toMatchObject({ t: "rejected", seq: 1, reason: expect.stringMatching(/^el\.set: /) });
    expect(room.design).toBe(before);
    expect(room.rev).toBe(0);
    expect(saved).toEqual([]);
    expect(other.heard.filter((m) => m.t === "ops")).toEqual([]);
    // the number was not used up, and the next batch of the same client goes through
    await editor.say(2, move(9));
    expect(editor.last()).toMatchObject({ t: "ack", seq: 2, rev: 1 });
    expect(xOf(room)).toBe(9);
  });

  it("is not held against a change to another property of an element that was not usable before", () => {
    const design = start();
    const old = { ...design, pages: [{ ...design.pages[0], elements: [...design.pages[0].elements, { id: "old", type: "shape" } as never] }] };
    const room = new Room(old);
    const editor = client(room, "editor");
    void editor.say(1, [{ k: "el.set", page: "p", id: "old", set: { name: "Still here" } }]);
    expect(editor.last()).toMatchObject({ t: "ack", seq: 1 });
  });
});

describe("what a room remembers of the clients that edited it", () => {
  it("answers a batch it has seen without applying it again, as long as it remembers the client", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const editor = client(room, "editor");
    void editor.say(1, move(10));
    editor.leave();
    time.pass(CLIENTS_KEPT_MS - 1000);
    const back = client(room, "editor");
    expect(back.welcome.lastSeq).toBe(1);
    void back.say(1, move(99));
    expect(back.last()).toMatchObject({ t: "ack", seq: 1 });
    expect(xOf(room)).toBe(10);
    expect(room.seqs()).toEqual({ editor: 1 });
    expect(room.memory()).toEqual({ seen: { editor: time.now() }, floor: 0 }); // coming back is being seen
  });

  it("forgets a client that stayed away for longer than it keeps one, when the next batch is applied", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const old = client(room, "old");
    void old.say(1, move(1));
    void old.say(2, move(2));
    void old.say(3, move(3));
    old.leave();
    const steady = client(room, "steady");
    void steady.say(1, move(4));
    time.pass(CLIENTS_KEPT_MS + 1000);
    expect(Object.keys(room.seqs()).sort()).toEqual(["old", "steady"]); // nothing is forgotten by time alone
    void steady.say(2, move(5));
    expect(room.seqs()).toEqual({ steady: 2 });
    expect(room.memory().floor).toBe(3);
    expect(Object.keys(room.memory().seen)).toEqual(["steady"]);
  });

  it("never applies a batch of a forgotten client a second time: what it sends again is answered and not applied", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const old = client(room, "old");
    void old.say(1, move(1));
    void old.say(2, [{ k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: "added-once" }) }]);
    old.leave(); // the answer to its second batch never reached it
    const steady = client(room, "steady");
    void steady.say(1, [{ k: "el.del", page: "p", id: "added-once" }]);
    time.pass(CLIENTS_KEPT_MS + 1000);
    void steady.say(2, move(50));
    expect(room.seqs()).toEqual({ steady: 2 });

    const back = client(room, "old");
    expect(back.welcome.lastSeq).toBe(2); // the room no longer knows this client, and says so in the only way that is safe
    const rev = room.rev;
    void back.say(2, [{ k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: "added-once" }) }]);
    expect(back.last()).toMatchObject({ t: "ack", seq: 2 });
    void back.say(1, move(1));
    expect(room.rev).toBe(rev);
    expect(room.design.pages[0].elements.some((el) => el.id === "added-once")).toBe(false); // what was deleted stays deleted
    expect(xOf(room)).toBe(50);
    // what it makes from now on counts
    void back.say(3, move(60));
    expect(back.last()).toMatchObject({ t: "ack", seq: 3 });
    expect(xOf(room)).toBe(60);
    expect(room.seqs()).toEqual({ steady: 2, old: 3 });
  });

  it("starts a client it has never seen above the numbers of those it forgot, which is where a session then counts from", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const old = client(room, "old");
    for (let seq = 1; seq <= 7; seq++) void old.say(seq, move(seq));
    old.leave();
    const steady = client(room, "steady");
    time.pass(CLIENTS_KEPT_MS + 1000);
    void steady.say(1, move(20));
    expect(room.memory().floor).toBe(7);
    expect(client(room, "new").welcome.lastSeq).toBe(7);
    expect(client(room, "viewer", "view").welcome.lastSeq).toBe(7);
    expect(client(room, "steady").welcome.lastSeq).toBe(1); // one it knows is told its own number
  });

  it("does not forget a client that is in the room, however long ago it last edited", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const quiet = client(room, "quiet");
    void quiet.say(1, move(1));
    const steady = client(room, "steady");
    time.pass(3 * CLIENTS_KEPT_MS);
    void steady.say(1, move(2));
    expect(room.seqs()).toEqual({ quiet: 1, steady: 1 });
    expect(room.memory().floor).toBe(0);
    // and its next batch is its next batch
    void quiet.say(2, move(3));
    expect(xOf(room)).toBe(3);
  });

  it("counts a client as seen when it joins, also when it only looks in", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const visitor = client(room, "visitor");
    void visitor.say(1, move(1));
    visitor.leave();
    time.pass(CLIENTS_KEPT_MS - DAY);
    client(room, "visitor").leave();
    time.pass(2 * DAY);
    const steady = client(room, "steady");
    void steady.say(1, move(2));
    expect(Object.keys(room.seqs()).sort()).toEqual(["steady", "visitor"]);
  });

  it("keeps no more clients than it may: those that were seen longest ago go first, and never one that is in the room", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now, keepMost: 3 });
    const stays = client(room, "stays");
    void stays.say(1, move(1));
    for (const name of ["b", "c", "d", "e"]) {
      time.pass(1000);
      const c = client(room, name);
      // (a client counts from what its welcome says: above the floor, once the room has forgotten somebody)
      void c.say(c.welcome.lastSeq + 1, move(2));
      void c.say(c.welcome.lastSeq + 2, move(3));
      c.leave();
    }
    expect(Object.keys(room.seqs()).sort()).toEqual(["d", "e", "stays"]);
    expect(room.memory().floor).toBe(2);
    expect(Object.keys(room.memory().seen).sort()).toEqual(["d", "e", "stays"]);
  });

  it("remembers more clients than it may when all of them are in the room, and takes a floor and times that are none for none", () => {
    const room = new Room(start(), 0, { a: 1 }, { keepMost: 1, floor: -3, seen: { a: Number.NaN } });
    const [a, b, c] = [client(room, "a"), client(room, "b"), client(room, "c")];
    expect(b.welcome.lastSeq).toBe(0);
    void a.say(2, move(1));
    void b.say(1, move(2));
    void c.say(1, move(3));
    expect(room.seqs()).toEqual({ a: 2, b: 1, c: 1 });
    expect(room.memory().floor).toBe(0);
    b.leave();
    void c.say(2, move(4));
    expect(room.seqs()).toEqual({ a: 2, c: 2 });
    expect(room.memory().floor).toBe(1);
  });

  it("holds a bounded number of clients after ten thousand page loads have each made an edit", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    for (let i = 0; i < 10_000; i++) {
      time.pass(60_000);
      const c = client(room, `load-${i}`);
      void c.say(c.welcome.lastSeq + 1, move(i));
      c.leave();
    }
    expect(Object.keys(room.seqs()).length).toBe(CLIENTS_KEPT);
    expect(Object.keys(room.memory().seen).length).toBe(CLIENTS_KEPT);
    expect(room.seqs()["load-9999"]).toBe(room.memory().floor + 1);
    expect(room.seqs()["load-8999"]).toBeUndefined();
    expect(xOf(room)).toBe(9999); // every one of the edits was applied
    expect(room.rev).toBe(10_000);
  });

  it("hands what it remembers to the host with every save, and takes it back from a record", async () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const saves: Array<{ seqs: Record<string, number>; memory: Required<ClientMemory> }> = [];
    room.commit = async (_design, _rev, seqs, memory) => void saves.push(overTheWire({ seqs, memory }));
    const old = client(room, "old");
    await old.say(1, move(1));
    await old.say(2, move(2));
    old.leave();
    time.pass(CLIENTS_KEPT_MS + 1000);
    const steady = client(room, "steady");
    await steady.say(1, move(3));
    const last = saves[saves.length - 1];
    expect(last).toEqual({ seqs: { steady: 1 }, memory: { seen: { steady: time.now() }, floor: 2 } });
    // a server that starts again knows what the one before forgot
    const again = new Room(room.design, room.rev, last.seqs, { ...last.memory, now: time.now });
    const back = client(again, "old");
    expect(back.welcome.lastSeq).toBe(2);
    await back.say(2, move(77));
    expect(xOf(again)).toBe(3);
  });

  it("takes a record from before it kept times: such a client counts as seen when the room is opened", () => {
    const time = clock();
    const room = new Room(start(), 4, { early: 4 }, { now: time.now });
    expect(room.memory()).toEqual({ seen: { early: time.now() }, floor: 0 });
    time.pass(CLIENTS_KEPT_MS - 1000);
    const steady = client(room, "steady");
    void steady.say(1, move(1));
    expect(Object.keys(room.seqs()).sort()).toEqual(["early", "steady"]);
    time.pass(2000);
    void steady.say(2, move(2));
    expect(room.seqs()).toEqual({ steady: 2 });
    expect(room.memory().floor).toBe(4);
  });

  it("forgets nothing when the save fails: the room is as it was", async () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const old = client(room, "old");
    void old.say(1, move(1));
    old.leave();
    time.pass(CLIENTS_KEPT_MS + 1000);
    room.commit = async () => {
      throw new Error("the disk is full");
    };
    const steady = client(room, "steady");
    await expect(steady.say(1, move(2))).rejects.toThrow("the disk is full");
    expect(room.seqs()).toEqual({ old: 1 });
    expect(room.memory().floor).toBe(0);
    expect(xOf(room)).toBe(1);
  });

  it("keeps a client that came back while the save that forgets it was running: it was told its own number, and that number holds", async () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const other = client(room, "other");
    for (let seq = 1; seq <= 5; seq++) void other.say(seq, move(seq));
    other.leave();
    const old = client(room, "old");
    void old.say(1, move(1));
    old.leave();
    time.pass(CLIENTS_KEPT_MS + 1000);
    let saved!: () => void;
    room.commit = () => new Promise<void>((resolve) => (saved = resolve));
    const steady = client(room, "steady");
    const saving = steady.say(1, move(2)); // forgets "old" and "other": the floor will be 5
    const back = client(room, "old");
    expect(back.welcome.lastSeq).toBe(1);
    saved();
    await saving;
    expect(room.memory().floor).toBe(5);
    expect(room.seqs()).toEqual({ steady: 1, old: 1 });
    room.commit = undefined;
    void back.say(2, move(42)); // below the floor, and still its next batch
    expect(back.last()).toMatchObject({ t: "ack", seq: 2 });
    expect(xOf(room)).toBe(42);
  });
});

describe("a browser in a room that has forgotten clients", () => {
  /** A session wired to a room: messages go over a wire each way, one after the other, until nothing is on its way. */
  function wired(room: Room, name: string, outbox?: Outbox) {
    const kept: { outbox?: Outbox } = { outbox };
    const sent: ClientMsg[] = [];
    const toRoom: ClientMsg[] = [];
    const toMe: ServerMsg[] = [];
    let connected = false;
    const p: Peer = { send: (msg) => void toMe.push(overTheWire(msg)) };
    const session: Session = new Session({
      client: outbox?.client ?? name,
      key: "k",
      outbox,
      onOutbox: (o) => (kept.outbox = overTheWire(o)),
      send: (msg) => {
        sent.push(msg);
        if (connected) toRoom.push(overTheWire(msg));
      },
    });
    const deliver = () => {
      while (toRoom.length || toMe.length) {
        const out = toRoom.shift();
        if (out?.t === "join") room.join(p, out.client, "edit");
        else if (out) void room.receive(p, out);
        const back = toMe.shift();
        if (back) session.receive(back);
      }
    };
    return {
      session,
      sent,
      kept,
      connect: () => {
        connected = true;
        session.open();
        deliver();
      },
      drop: () => {
        connected = false;
        room.leave(p);
        session.close();
      },
      /** This person moves the box. */
      edit: (x: number) => {
        const before = session.design!;
        session.edit(before, { ...before, pages: [{ ...before.pages[0], elements: before.pages[0].elements.map((el) => (el.id === "a" ? { ...el, x } : el)) }] });
        deliver();
      },
    };
  }
  /** A room whose floor is 7: a client made seven batches and was forgotten. */
  function roomWithFloor() {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const old = client(room, "old");
    for (let seq = 1; seq <= 7; seq++) void old.say(seq, move(seq));
    old.leave();
    time.pass(CLIENTS_KEPT_MS + 1000);
    const steady = client(room, "steady");
    void steady.say(1, move(100));
    steady.leave();
    expect(room.memory().floor).toBe(7);
    return room;
  }

  it("numbers its batches from where the room says, and they are applied", () => {
    const room = roomWithFloor();
    const me = wired(room, "fresh");
    me.connect();
    me.edit(200);
    expect(me.sent[me.sent.length - 1]).toMatchObject({ t: "ops", seq: 8 });
    expect(xOf(room)).toBe(200);
    expect(me.session.pending).toBe(0);
  });

  it("loses nothing of what a person made before the room first answered: batches that were never sent get numbers the room takes", () => {
    const room = roomWithFloor();
    // the design was open from the library and the server was away: two edits wait, numbered 1 and 2, and were never sent
    const waiting: Outbox = {
      client: "fresh",
      nextSeq: 3,
      sent: 0,
      queue: [
        { seq: 1, ops: move(300) },
        { seq: 2, ops: [{ k: "design", set: { title: "Made offline" } }] },
      ],
    };
    const me = wired(room, "fresh", waiting);
    me.connect();
    expect(me.sent.filter((m) => m.t === "ops").map((m) => (m as { seq: number }).seq)).toEqual([8, 9]);
    expect(xOf(room)).toBe(300);
    expect(room.design.title).toBe("Made offline");
    expect(me.session.pending).toBe(0);
    expect(room.seqs().fresh).toBe(9);
    me.edit(301);
    expect(me.sent[me.sent.length - 1]).toMatchObject({ t: "ops", seq: 10 });
    expect(me.kept.outbox).toMatchObject({ nextSeq: 11, sent: 10, queue: [] });
  });

  it("gives up what it did send and the room may have applied: that is the batch that must not count twice", () => {
    const room = roomWithFloor();
    // this is the forgotten client itself: batch 7 was sent and applied, its answer was lost; batch 8 was made later and never sent
    const stale: Outbox = {
      client: "old",
      nextSeq: 9,
      sent: 7,
      queue: [
        { seq: 7, ops: move(7) },
        { seq: 8, ops: move(800) },
      ],
    };
    const me = wired(room, "old", stale);
    const rev = room.rev;
    me.connect();
    expect(me.sent.filter((m) => m.t === "ops")).toEqual([{ t: "ops", seq: 8, ops: move(800) }]);
    expect(room.rev).toBe(rev + 1);
    expect(xOf(room)).toBe(800);
  });

  it("treats what an older version kept for a reload, which does not say what was sent, as sent: nothing can count twice", () => {
    const room = roomWithFloor();
    const kept: Outbox = { client: "older", nextSeq: 3, queue: [{ seq: 2, ops: move(555) }] };
    const me = wired(room, "older", kept);
    me.connect();
    expect(me.sent.filter((m) => m.t === "ops")).toEqual([]);
    expect(xOf(room)).toBe(100);
    me.edit(556);
    expect(me.sent[me.sent.length - 1]).toMatchObject({ t: "ops", seq: 8 });
  });

  it("goes on under another name without losing what waits: none of it was sent under that name", () => {
    const room = roomWithFloor();
    const me = wired(room, "first");
    me.connect();
    me.edit(400); // batch 8, applied
    me.drop();
    me.edit(401); // batch 9 waits
    me.edit(402); // batch 10 waits
    me.session.rename("second");
    expect(me.kept.outbox).toMatchObject({ client: "second", sent: 0 });
    me.connect();
    // the room has never seen "second" and answers with its floor, 7: both batches are above it and keep their numbers
    expect(me.sent.filter((m) => m.t === "ops").map((m) => (m as { seq: number }).seq)).toEqual([8, 9, 10]);
    expect(xOf(room)).toBe(402);
    expect(room.seqs()).toMatchObject({ first: 8, second: 10 });
  });

  it("renumbers every waiting batch when it goes on under another name and they sit at or below the floor", () => {
    const room = roomWithFloor();
    const waiting: Outbox = {
      client: "first",
      nextSeq: 4,
      sent: 3,
      queue: [
        { seq: 2, ops: move(21) },
        { seq: 3, ops: move(22) },
      ],
    };
    const me = wired(room, "first", waiting);
    me.session.rename("second");
    me.connect();
    expect(me.sent.filter((m) => m.t === "ops").map((m) => (m as { seq: number }).seq)).toEqual([8, 9]);
    expect(xOf(room)).toBe(22);
    expect(me.session.pending).toBe(0);
  });

  it("works as before with a room that has forgotten nobody, and with a server that never forgets", () => {
    const room = new Room(start());
    const waiting: Outbox = {
      client: "fresh",
      nextSeq: 3,
      sent: 0,
      queue: [
        { seq: 1, ops: move(1) },
        { seq: 2, ops: move(2) },
      ],
    };
    const me = wired(room, "fresh", waiting);
    me.connect();
    expect(me.sent.filter((m) => m.t === "ops").map((m) => (m as { seq: number }).seq)).toEqual([1, 2]);
    expect(xOf(room)).toBe(2);
  });
});

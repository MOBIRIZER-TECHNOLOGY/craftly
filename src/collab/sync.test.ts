/**
 * A room and the browsers that edit its design, wired together by hand: what a person sees while their change is on its way,
 * what happens when two people change the same thing, a refused change, a lost connection, a batch that is sent twice, and a
 * message that went missing. (The same machinery under random delays, drops and edits is in sync.sim.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createShape, solid } from "@/core/factory";
import type { Design, DesignElement } from "@/core/types";
import { designsEqual } from "./ops";
import type { ClientMsg, Role, ServerMsg } from "./protocol";
import { Room, type Peer } from "./room";
import { Session, withShared } from "./session";

const rect = (id: string, x = 0, y = 0, extra: Partial<DesignElement> = {}) => createShape("rect", { id, x, y, width: 100, height: 50, ...extra });
const start = (): Design => createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [rect("a", 0, 0), rect("b", 300, 0)] })] });
const withEls = (d: Design, fn: (els: DesignElement[]) => DesignElement[]): Design => ({ ...d, pages: d.pages.map((p) => ({ ...p, elements: fn(p.elements) })) });
const ids = (d: Design | null) => d!.pages[0].elements.map((e) => e.id);
const x = (d: Design | null, id: string) => d!.pages[0].elements.find((e) => e.id === id)!.x;

/** A browser with a manual wire: nothing is delivered until `flush`. */
class Browser {
  session: Session;
  /** what the person sees, the way the store holds it */
  shown: Design;
  up: ClientMsg[] = [];
  down: ServerMsg[] = [];
  peer: Peer = { send: (m) => this.down.push(m) };
  constructor(
    readonly room: Room,
    readonly id: string,
    readonly role: Role = "edit",
  ) {
    this.session = new Session({ client: id, send: (m) => this.up.push(m) });
    this.shown = room.design;
    this.connect();
    this.flush();
  }
  connect() {
    this.session.open();
  }
  /** one step of this person's work */
  edit(fn: (d: Design) => Design) {
    const next = fn(this.shown);
    this.session.edit(this.shown, next);
    this.shown = next;
  }
  /** deliver what is waiting, both ways, until nothing is */
  flush() {
    for (let guard = 0; guard < 100 && (this.up.length || this.down.length); guard++) {
      while (this.up.length) {
        const m = this.up.shift()!;
        if (m.t === "join") this.room.join(this.peer, this.id, this.role);
        else this.room.receive(this.peer, m);
      }
      while (this.down.length) {
        const out = this.session.receive(this.down.shift()!);
        if (out.changed) this.shown = withShared(this.shown, this.session.design!);
      }
    }
  }
  /** the connection drops: whatever was on its way is lost */
  drop() {
    this.up = [];
    this.down = [];
    this.room.leave(this.peer);
    this.session.close();
  }
}

describe("a room and one browser", () => {
  it("welcomes a browser with the design, and the browser shows it", () => {
    const room = new Room(start(), 7);
    const me = new Browser(room, "me");
    expect(me.session.status).toBe("live");
    expect(me.session.rev).toBe(7);
    expect(designsEqual(me.session.design!, room.design)).toBe(true);
  });

  it("shows a change at once, and the server has it after the round trip", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    me.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 40 } : e))));
    expect(x(me.session.design, "a")).toBe(40);
    expect(me.session.pending).toBe(1);
    expect(x(room.design, "a")).toBe(0); // not sent yet: the wire is manual
    me.flush();
    expect(x(room.design, "a")).toBe(40);
    expect(me.session.pending).toBe(0);
    expect(room.rev).toBe(1);
    expect(me.session.rev).toBe(1);
  });

  it("does not send a step that changed nothing", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    me.edit((d) => ({ ...d, updatedAt: d.updatedAt + 10, starred: true }));
    expect(me.up).toEqual([]);
    expect(me.session.pending).toBe(0);
  });
});

describe("two browsers", () => {
  it("see each other's changes", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) => withEls(d, (els) => [...els, rect("n", 5, 5)]));
    ann.flush();
    bob.flush();
    expect(ids(bob.shown)).toEqual(["a", "b", "n"]);
    expect(ids(room.design)).toEqual(["a", "b", "n"]);
  });

  it("keep both changes when they changed different properties of the same element", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 50 } : e))));
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, fill: solid("#0000ff") } : e))));
    ann.flush();
    bob.flush();
    ann.flush();
    for (const who of [ann, bob]) expect(who.shown.pages[0].elements[0]).toMatchObject({ x: 50, fill: solid("#0000ff") });
    expect(designsEqual(ann.shown, room.design)).toBe(true);
    expect(designsEqual(bob.shown, room.design)).toBe(true);
  });

  it("agree on one value when they changed the same property: the batch that reached the server last", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 11 } : e))));
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 22 } : e))));
    // Ann's batch reaches the server first, then Bob's
    for (const [who, other] of [
      [ann, bob],
      [bob, ann],
    ]) {
      while (who.up.length) room.receive(who.peer, who.up.shift() as ClientMsg);
      who.flush();
      other.flush();
    }
    ann.flush();
    bob.flush();
    expect(x(room.design, "a")).toBe(22);
    expect(x(ann.shown, "a")).toBe(22);
    expect(x(bob.shown, "a")).toBe(22);
  });

  it("keep their own unconfirmed change on screen while someone else's change arrives in the middle of it", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "b" ? { ...e, x: 999 } : e))));
    bob.flush();
    ann.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 77 } : e)))); // not sent yet
    ann.flush(); // Bob's change arrives first, then Ann's goes
    expect(x(ann.shown, "b")).toBe(999);
    expect(x(ann.shown, "a")).toBe(77);
    // while Ann's is still unconfirmed, a third change arrives
    ann.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 78 } : e))));
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "b" ? { ...e, x: 1000 } : e))));
    bob.flush();
    ann.flush();
    expect(x(ann.shown, "a")).toBe(78);
    expect(x(ann.shown, "b")).toBe(1000);
    bob.flush();
    expect(designsEqual(ann.shown, room.design)).toBe(true);
    expect(designsEqual(bob.shown, room.design)).toBe(true);
  });

  it("a deleted element stays deleted for the one who changed it at the same time", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) => withEls(d, (els) => els.filter((e) => e.id !== "a")));
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 5 } : e))));
    ann.flush();
    bob.flush();
    ann.flush();
    expect(ids(room.design)).toEqual(["b"]);
    expect(ids(bob.shown)).toEqual(["b"]);
  });
});

describe("a refused change", () => {
  it("disappears from the screen of the one who made it, and the rest of their work stays", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    me.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 5 } : e))));
    // a batch that is not an operation at all: as if a bug or an attacker sent it
    me.up.push({ t: "ops", seq: 2, ops: [{ k: "page.explode" }] as never });
    me.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "b" ? { ...e, x: 6 } : e))));
    me.flush();
    expect(x(room.design, "a")).toBe(5);
    expect(x(room.design, "b")).toBe(6);
    expect(designsEqual(me.shown, room.design)).toBe(true);
  });

  it("makes a change that the server refuses disappear from the screen, and goes on with the next", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    // a change that this page accepts but the server does not: an element of a kind that does not exist
    me.edit((d) => withEls(d, (els) => [...els, { ...rect("odd"), type: "script" } as never]));
    expect(ids(me.shown)).toEqual(["a", "b", "odd"]);
    expect(ids(me.session.design)).toEqual(["a", "b", "odd"]); // the session has worked out what to show
    me.flush();
    expect(ids(me.shown)).toEqual(["a", "b"]);
    expect(ids(me.session.design)).toEqual(["a", "b"]);
    expect(me.session.pending).toBe(0);
    expect(room.rev).toBe(0);
    me.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 9 } : e))));
    me.flush();
    expect(x(room.design, "a")).toBe(9);
  });

  it("refuses a batch whose number is not a whole number from one up", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    for (const seq of [0, -1, 1.5, Number.NaN, "x" as never]) {
      room.receive(me.peer, { t: "ops", seq, ops: [{ k: "el.del", page: "p", id: "a" }] });
    }
    expect(me.down.map((m) => m.t)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
    expect(room.rev).toBe(0);
    expect(ids(room.design)).toEqual(["a", "b"]);
  });

  it("sends the design again to a browser that asks for it on the connection it has", () => {
    const room = new Room(start(), 3);
    const me = new Browser(room, "me", "view");
    me.down = [];
    room.receive(me.peer, { t: "join", client: "me" });
    expect(me.down).toEqual([{ t: "welcome", role: "view", rev: 3, lastSeq: 0, design: room.design }]);
  });

  it("is what a link that only lets people look gives to every change", () => {
    const room = new Room(start());
    const viewer = new Browser(room, "viewer", "view");
    expect(viewer.session.role).toBe("view");
    viewer.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 5 } : e))));
    expect(viewer.up).toEqual([]); // not even sent
    viewer.up.push({ t: "ops", seq: 1, ops: [{ k: "el.del", page: "p", id: "a" }] }); // sent by something that is not this page
    viewer.flush();
    expect(ids(room.design)).toEqual(["a", "b"]);
    expect(room.rev).toBe(0);
  });
});

describe("a lost connection", () => {
  it("keeps what was changed meanwhile and sends it when the browser is back, without changing anything twice", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 1 } : e))));
    ann.drop(); // the batch was on its way and is lost
    ann.edit((d) => withEls(d, (els) => [...els, rect("offline", 9, 9)]));
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "b" ? { ...e, x: 2 } : e))));
    bob.flush();
    expect(ann.session.status).toBe("offline");
    expect(ids(ann.session.design)).toEqual(["a", "b", "offline"]);
    ann.connect();
    ann.flush();
    bob.flush();
    expect(x(room.design, "a")).toBe(1);
    expect(x(room.design, "b")).toBe(2);
    expect(ids(room.design)).toEqual(["a", "b", "offline"]);
    expect(designsEqual(ann.shown, room.design)).toBe(true);
    expect(designsEqual(bob.shown, room.design)).toBe(true);
    expect(ann.session.pending).toBe(0);
  });

  it("does not send again what the server has applied although its answer was lost", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    me.edit((d) => withEls(d, (els) => [...els, rect("n")]));
    while (me.up.length) room.receive(me.peer, me.up.shift() as ClientMsg); // the server applies it ...
    const rev = room.rev;
    me.down = []; // ... and the answer is lost with the connection
    me.drop();
    me.connect();
    me.flush();
    expect(room.rev).toBe(rev); // not applied a second time
    expect(me.session.pending).toBe(0);
    expect(ids(me.shown)).toEqual(["a", "b", "n"]);
  });

  it("answers a batch with a number it has seen without applying it again", () => {
    const room = new Room(start());
    const me = new Browser(room, "me");
    me.edit((d) => withEls(d, (els) => [...els, rect("n")]));
    const sent = me.up[0];
    me.flush();
    const rev = room.rev;
    room.receive(me.peer, sent);
    expect(room.rev).toBe(rev);
    expect(me.down).toEqual([{ t: "ack", seq: 1, rev }]);
  });

  it("asks for the design again when a message went missing, and ends up the same", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) => withEls(d, (els) => [...els, rect("one")]));
    ann.flush();
    ann.edit((d) => withEls(d, (els) => [...els, rect("two")]));
    ann.flush();
    expect(bob.down).toHaveLength(2);
    bob.down.shift(); // the first of the two is lost on the way
    bob.flush();
    expect(ids(bob.shown)).toEqual(["a", "b", "one", "two"]);
    expect(designsEqual(bob.shown, room.design)).toBe(true);
    expect(bob.session.rev).toBe(room.rev);
  });
});

describe("a client that comes back on another connection", () => {
  it("replaces the old connection: the room tells the host which to close, and says nothing more to it", () => {
    const room = new Room(start());
    const heard: ServerMsg[][] = [[], []];
    const peers: Peer[] = [{ send: (m) => heard[0].push(m) }, { send: (m) => heard[1].push(m) }];
    const other: Peer = { send: () => undefined };
    expect(room.join(peers[0], "me", "edit")).toEqual([]);
    room.join(other, "someone else", "edit");
    expect(room.size).toBe(2);
    expect(room.join(peers[1], "me", "edit")).toEqual([peers[0]]);
    expect(room.size).toBe(2);
    room.receive(other, { t: "ops", seq: 1, ops: [{ k: "el.del", page: "p", id: "a" }] });
    expect(heard[0].map((m) => m.t)).toEqual(["welcome"]); // nothing after it was replaced
    expect(heard[1].map((m) => m.t)).toEqual(["welcome", "ops"]);
    // joining again on the same connection (the design asked for again) replaces nothing
    expect(room.join(peers[1], "me", "edit")).toEqual([]);
    expect(room.peers()).toHaveLength(2);
  });
});

describe("a session that has heard more than it should", () => {
  const live = () => {
    const room = new Room(start(), 5);
    const sent: ClientMsg[] = [];
    const session = new Session({ client: "me", send: (m) => sent.push(m) });
    session.open();
    session.receive({ t: "welcome", role: "edit", rev: 5, lastSeq: 0, design: room.design });
    sent.length = 0;
    return { session, sent, room };
  };

  it("takes no notice of an announcement that it has heard already, and does not ask for the design again", () => {
    const { session, sent } = live();
    expect(session.receive({ t: "ops", rev: 6, ops: [{ k: "el.del", page: "p", id: "a" }] }).changed).toBe(true);
    expect(session.receive({ t: "ops", rev: 6, ops: [{ k: "el.del", page: "p", id: "a" }] })).toEqual({ changed: false, ended: null });
    expect(session.receive({ t: "ops", rev: 3, ops: [] })).toEqual({ changed: false, ended: null });
    expect(sent).toEqual([]);
    expect(session.rev).toBe(6);
  });

  it("asks for the design again when an answer is not the next in line, or is for what it did not send", () => {
    const { session, sent } = live();
    const d = start();
    session.edit(
      d,
      withEls(d, (els) => els.slice(1)),
    );
    expect(sent).toEqual([{ t: "ops", seq: 1, ops: [{ k: "el.del", page: "p", id: "a" }] }]);
    sent.length = 0;
    session.receive({ t: "ack", seq: 1, rev: 9 }); // revisions 6 to 8 went missing
    expect(sent).toEqual([{ t: "join", client: "me" }]);
    expect(session.status).toBe("joining");
    // while it waits for the design, what else arrives is of no use, and does not make it ask again
    expect(session.receive({ t: "ops", rev: 10, ops: [] })).toEqual({ changed: false, ended: null });
    expect(session.receive({ t: "ack", seq: 7, rev: 4 })).toEqual({ changed: false, ended: null });
    expect(session.receive({ t: "rejected", seq: 1, reason: "x" })).toEqual({ changed: false, ended: null });
    expect(sent).toEqual([{ t: "join", client: "me" }]);
    expect(session.pending).toBe(1);
  });

  it("ignores an answer for something it no longer waits for", () => {
    const { session, sent } = live();
    expect(session.receive({ t: "ack", seq: 4, rev: 5 })).toEqual({ changed: false, ended: null });
    expect(session.receive({ t: "rejected", seq: 4, reason: "x" })).toEqual({ changed: false, ended: null });
    expect(sent).toEqual([]);
  });

  it("numbers its changes after the last one the server has seen from a browser of the same name, so that none is taken for a repeat", () => {
    const room = new Room(start(), 0, { me: 5 });
    const sent: ClientMsg[] = [];
    const session = new Session({ client: "me", send: (m) => sent.push(m) });
    const peer: Peer = { send: (m) => void session.receive(m) };
    session.open();
    room.join(peer, "me", "edit");
    const d = session.design!;
    session.edit(
      d,
      withEls(d, (els) => els.slice(1)),
    );
    expect(sent.at(-1)).toMatchObject({ t: "ops", seq: 6 });
  });
});

describe("a browser that is turned away", () => {
  it("is told why, and does nothing more", () => {
    const session = new Session({ client: "x", send: () => undefined });
    expect(session.receive({ t: "denied", reason: "no-access" })).toEqual({ changed: false, ended: "no-access" });
    expect(session.status).toBe("ended");
    session.open();
    expect(session.status).toBe("ended");
    const d = start();
    session.edit(
      d,
      withEls(d, (els) => els.slice(1)),
    );
    expect(session.pending).toBe(0);
  });

  it("ignores a pong and what arrives before the design", () => {
    const sent: ClientMsg[] = [];
    const session = new Session({ client: "x", send: (m) => sent.push(m) });
    expect(session.receive({ t: "pong" })).toEqual({ changed: false, ended: null });
    expect(session.receive({ t: "ops", rev: 1, ops: [] })).toEqual({ changed: false, ended: null });
    expect(session.design).toBeNull();
    session.open();
    expect(sent).toEqual([{ t: "join", client: "x" }]);
  });
});

describe("withShared", () => {
  it("lays the shared parts of a design on one that belongs to this person's library", () => {
    const mine = { ...start(), id: "mine", folderId: "f", starred: true, guides: { vertical: [1], horizontal: [] } };
    const shared = { ...start(), title: "Renamed", width: 1200, id: "theirs", folderId: null, starred: false };
    const out = withShared(mine, shared);
    expect(out).toMatchObject({ id: "mine", folderId: "f", starred: true, title: "Renamed", width: 1200 });
    expect(out.pages).toBe(shared.pages);
    expect(out.guides).toBeUndefined();
    expect(withShared(out, { ...shared, guides: { vertical: [], horizontal: [4] } }).guides).toEqual({ vertical: [], horizontal: [4] });
  });

  it("gives back the same object when there is nothing to lay on it", () => {
    const d = start();
    expect(withShared(d, d)).toBe(d);
    expect(withShared(d, { ...d, id: "other", folderId: "x" })).toBe(d);
  });
});

describe("groups across browsers", () => {
  it("one browser groups two elements while another moves one of them: both changes survive", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit((d) =>
      withEls(d, (els) => [
        createGroup(
          els.map((e) => ({ ...e })),
          { id: "g", x: 0, y: 0, width: 400, height: 50 },
        ),
      ]),
    );
    bob.edit((d) => withEls(d, (els) => els.map((e) => (e.id === "a" ? { ...e, x: 33 } : e))));
    ann.flush();
    bob.flush();
    ann.flush();
    expect(designsEqual(ann.shown, room.design)).toBe(true);
    expect(designsEqual(bob.shown, room.design)).toBe(true);
    const g = room.design.pages[0].elements[0];
    expect(g.type).toBe("group");
  });
});

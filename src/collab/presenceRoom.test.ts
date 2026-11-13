/**
 * Presence in a room: the server gives each connection a number, passes on what one person says about where they are to the
 * others under that number, keeps none of it with the design, says when somebody has gone, and lets one person at a time be the
 * one who types in a text box.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createText } from "@/core/factory";
import { PRESENCE_STALE_MS, type PresenceHeard, type PresenceState } from "./presence";
import type { ServerMsg } from "./protocol";
import { Room, type Peer } from "./room";

const start = () => createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createText({ id: "t", text: "Hello" })] })] });
const clock = (at = 1_700_000_000_000) => ({ now: () => at, pass: (ms: number) => void (at += ms) });
const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const state = (over: Partial<PresenceState> = {}): PresenceState => ({ name: "Ana", page: "p", pointer: { x: 1, y: 2 }, selection: [], editing: null, ...over });

function person(room: Room, name: string, role: "edit" | "view" = "edit") {
  const heard: ServerMsg[] = [];
  const peer: Peer = { send: (msg) => heard.push(overTheWire(msg)) };
  room.join(peer, name, role);
  const welcome = heard[0] as Extract<ServerMsg, { t: "welcome" }>;
  return {
    peer,
    heard,
    number: welcome.peer as number,
    presences: () => heard.filter((m): m is PresenceHeard => m.t === "presence"),
    say: (over: Partial<PresenceState> = {}, extra: Record<string, unknown> = {}) => room.receive(peer, { t: "presence", ...state({ name, ...over }), ...extra } as never),
    leave: () => room.leave(peer),
  };
}

describe("the number a room gives a connection", () => {
  it("is in the welcome, and is another for everybody", () => {
    const room = new Room(start());
    const [ana, bob] = [person(room, "ana"), person(room, "bob")];
    expect(Number.isSafeInteger(ana.number)).toBe(true);
    expect(bob.number).not.toBe(ana.number);
  });

  it("stays the same when the same connection asks for the design again", () => {
    const room = new Room(start());
    const ana = person(room, "ana");
    void room.receive(ana.peer, { t: "join", client: "ana", key: "k" });
    expect(ana.heard[1]).toMatchObject({ t: "welcome", peer: ana.number });
  });
});

describe("what one person says about where they are", () => {
  it("is passed on to the others under the number of the one who said it, and not back", () => {
    const room = new Room(start());
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ selection: ["t"] });
    const told = { t: "presence", peer: ana.number, ...state({ name: "ana", selection: ["t"] }) };
    expect(bob.presences()).toEqual([told]);
    expect(cat.presences()).toEqual([told]);
    expect(ana.presences()).toEqual([]);
  });

  it("is no part of the design: no revision, nothing saved, nothing acknowledged", () => {
    const room = new Room(start());
    let saves = 0;
    room.commit = async () => void saves++;
    const ana = person(room, "ana");
    const before = room.design;
    const said = ana.say();
    expect(said).toBeUndefined(); // nothing to wait for
    expect(room.rev).toBe(0);
    expect(room.design).toBe(before);
    expect(saves).toBe(0);
    expect(ana.heard).toHaveLength(1); // the welcome, and no answer
  });

  it("cannot be said for somebody else: a message that names a number is not passed on at all", () => {
    const room = new Room(start());
    const [ana, bob] = [person(room, "ana"), person(room, "bob")];
    void ana.say({}, { peer: bob.number });
    expect(bob.presences()).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a name that is far too long", { name: "x".repeat(500) }],
    ["a pointer that is no place", { pointer: { x: "left", y: 0 } }],
    ["a colour of its own", { color: "red" }],
    ["a selection of thousands", { selection: Array.from({ length: 5000 }, (_, i) => `e${i}`) }],
  ])("is dropped without a word when it has %s", (_what, wrong) => {
    const room = new Room(start());
    const [ana, bob] = [person(room, "ana"), person(room, "bob")];
    void ana.say({}, wrong);
    expect(bob.presences()).toEqual([]);
    expect(ana.heard).toHaveLength(1);
  });

  it("is not listened to from a connection that has not joined", () => {
    const room = new Room(start());
    const bob = person(room, "bob");
    const stranger: Peer = { send: () => undefined };
    void room.receive(stranger, { t: "presence", ...state() });
    expect(bob.presences()).toEqual([]);
  });

  it("is told to somebody who comes in later, right after their welcome, as it was last said", () => {
    const room = new Room(start());
    const [ana, quiet] = [person(room, "ana"), person(room, "quiet")];
    void ana.say({ pointer: { x: 1, y: 1 } });
    void ana.say({ pointer: { x: 5, y: 6 } });
    const late = person(room, "late");
    expect(late.heard.map((m) => m.t)).toEqual(["welcome", "presence"]); // (nothing about the one who never said where they are)
    expect(late.presences()).toEqual([{ t: "presence", peer: ana.number, ...state({ name: "ana", pointer: { x: 5, y: 6 } }) }]);
    expect(quiet.presences()).toHaveLength(2);
  });

  it("of somebody who only looks is their name and pointer: a viewer has no selection and types in nothing", () => {
    const room = new Room(start());
    const [viewer, ana] = [person(room, "viewer", "view"), person(room, "ana")];
    void viewer.say({ selection: ["t"], editing: "t" });
    expect(ana.presences()).toEqual([{ t: "presence", peer: viewer.number, ...state({ name: "viewer", selection: [], editing: null }) }]);
    // and it does not keep an editor from typing in that text
    const bob = person(room, "bob");
    void ana.say({ editing: "t" });
    expect(bob.presences().at(-1)).toMatchObject({ peer: ana.number, editing: "t" });
  });
});

describe("somebody who goes", () => {
  it("is said to the others, once, under their number", () => {
    const room = new Room(start());
    const [ana, bob] = [person(room, "ana"), person(room, "bob")];
    void ana.say();
    ana.leave();
    ana.leave();
    expect(bob.presences().at(-1)).toEqual({ t: "presence", peer: ana.number, gone: true });
    expect(bob.presences()).toHaveLength(2);
  });

  it("is not said of somebody the others never heard of", () => {
    const room = new Room(start());
    const [ana, bob] = [person(room, "ana"), person(room, "bob")];
    ana.leave();
    expect(bob.presences()).toEqual([]);
  });

  it("is said of the old connection of a client that comes back on a new one, which gets a number of its own", () => {
    const room = new Room(start());
    const [ana, bob] = [person(room, "ana"), person(room, "bob")];
    void ana.say();
    const again = person(room, "ana");
    expect(again.number).not.toBe(ana.number);
    expect(bob.presences().at(-1)).toEqual({ t: "presence", peer: ana.number, gone: true });
    // the connection that was replaced is told nothing more
    void bob.say();
    expect(ana.presences()).toEqual([]);
    expect(again.presences()).toHaveLength(1);
  });
});

describe("one person at a time types in a text box", () => {
  const typingIn = (who: ReturnType<typeof person>, of: ReturnType<typeof person>) =>
    (
      who
        .presences()
        .filter((m) => m.peer === of.number && !("gone" in m))
        .at(-1) as PresenceState | undefined
    )?.editing;

  it("the first whose word arrives is the one: the second is passed on as somebody who types in nothing", () => {
    const room = new Room(start());
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ editing: "t" });
    void bob.say({ editing: "t" });
    expect(typingIn(cat, ana)).toBe("t");
    expect(typingIn(cat, bob)).toBeNull();
    // each of the two hears of the other what everybody hears: the second that the first types there, the first that the second does not
    expect(typingIn(bob, ana)).toBe("t");
    expect(typingIn(ana, bob)).toBeNull();
  });

  it("stays with the first while they keep saying so, however often the second asks", () => {
    const room = new Room(start());
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ editing: "t" });
    for (let i = 0; i < 3; i++) {
      void bob.say({ editing: "t" });
      void ana.say({ editing: "t" });
    }
    expect(typingIn(cat, ana)).toBe("t");
    expect(typingIn(cat, bob)).toBeNull();
  });

  it("another text box is free at the same time", () => {
    const room = new Room(start());
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ editing: "t" });
    void bob.say({ editing: "u" });
    expect(typingIn(cat, bob)).toBe("u");
  });

  it("is free again when the first closes the box", () => {
    const room = new Room(start());
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ editing: "t" });
    void ana.say({ editing: null });
    void bob.say({ editing: "t" });
    expect(typingIn(cat, bob)).toBe("t");
  });

  it("is free again when the first leaves", () => {
    const room = new Room(start());
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ editing: "t" });
    ana.leave();
    void bob.say({ editing: "t" });
    expect(typingIn(cat, bob)).toBe("t");
  });

  it("cannot get stuck: somebody who has not been heard of for a while no longer holds it, and gives way when they are heard again", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const [ana, bob, cat] = [person(room, "ana"), person(room, "bob"), person(room, "cat")];
    void ana.say({ editing: "t" });
    time.pass(PRESENCE_STALE_MS - 1);
    void bob.say({ editing: "t" });
    expect(typingIn(cat, bob)).toBeNull();
    time.pass(2);
    void bob.say({ editing: "t" });
    expect(typingIn(cat, bob)).toBe("t");
    void ana.say({ editing: "t" });
    expect(typingIn(cat, ana)).toBeNull();
    // somebody who comes in then is not told that the one who fell silent types there
    time.pass(PRESENCE_STALE_MS + 1);
    const late = person(room, "late");
    expect(late.presences().every((m) => "gone" in m || m.editing === null)).toBe(true);
  });
});

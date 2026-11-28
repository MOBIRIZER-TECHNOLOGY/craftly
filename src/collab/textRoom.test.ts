/**
 * Text typed into one box by two people at once, between the room and the browsers (docs/COLLABORATION.md, "Two people typing in
 * one text box"): who is told that text is merged, what goes up (a splice) and what comes down (the text it made), both people's
 * letters kept, a browser from before this beside one that merges, who may type in a box that somebody types in, and what a
 * splice that comes from outside may be.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createText } from "@/core/factory";
import type { Design, TextElement } from "@/core/types";
import { applyOps, designsEqual, type Op } from "./ops";
import { PRESENCE_STALE_MS, type PresenceHeard, type PresenceState } from "./presence";
import { checkOps, joinFeatures, parseServerMsg, TEXT, type ClientMsg, type Feature, type ServerMsg } from "./protocol";
import { Room, type Peer } from "./room";
import { Session, withShared } from "./session";
import { MARK } from "./text";

const start = (words = "Hello world"): Design =>
  createDesign({
    title: "Shared",
    width: 1000,
    height: 600,
    pages: [createPage({ id: "p", elements: [createText({ id: "t", text: words }), createText({ id: "u", text: "Other" })] })],
  });
const wordsOf = (d: Design | null, id = "t") => (d!.pages[0].elements.find((e) => e.id === id) as TextElement).paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
const typed = (d: Design, words: string, id = "t"): Design => ({
  ...d,
  pages: d.pages.map((p) => ({
    ...p,
    elements: p.elements.map((e) => (e.id === id ? { ...e, paragraphs: words.split("\n").map((line) => ({ runs: [{ text: line }] })) } : e)),
  })),
});
const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A browser with a manual wire (nothing is delivered until `flush`), that says in its join what it understands. */
class Browser {
  session: Session;
  shown: Design;
  up: ClientMsg[] = [];
  down: ServerMsg[] = [];
  peer: Peer = { send: (m) => this.down.push(overTheWire(m)) };
  constructor(
    readonly room: Room,
    readonly id: string,
    readonly features: Feature[] = [TEXT],
  ) {
    this.session = new Session({ client: id, key: "k", send: (m) => this.up.push(overTheWire(m)), features });
    this.shown = room.design;
    this.session.open();
    this.flush();
  }
  edit(fn: (d: Design) => Design) {
    const next = fn(this.shown);
    this.session.edit(this.shown, next);
    this.shown = next;
  }
  /** sends what waits to go up, one message, or all */
  send(all = true) {
    while (this.up.length) {
      const m = this.up.shift()!;
      if (m.t === "join") this.room.join(this.peer, this.id, "edit", joinFeatures(m));
      else void this.room.receive(this.peer, m);
      if (!all) return;
    }
  }
  /** takes in what came down */
  hear() {
    while (this.down.length) {
      const out = this.session.receive(this.down.shift()!);
      if (out.changed) this.shown = withShared(this.shown, this.session.design!);
    }
  }
  flush() {
    for (let guard = 0; guard < 100 && (this.up.length || this.down.length); guard++) {
      this.send();
      this.hear();
    }
  }
  /** the operations of the batches that came down from others (not acknowledgements), as they were sent */
  opsHeard(): Op[] {
    return this.down.flatMap((m) => (m.t === "ops" ? m.ops : []));
  }
}

describe("saying that text is merged", () => {
  it("is in the welcome of a browser that said so in its join, and of no other", () => {
    const room = new Room(start());
    const merges = new Browser(room, "a");
    const older = new Browser(room, "b", []);
    expect(merges.session.sharesText).toBe(true);
    expect(older.session.sharesText).toBe(false);
    expect(joinFeatures({ t: "join", features: ["comments", "text"] })).toEqual({ comments: true, text: true });
  });
});

describe("a change to the characters of a text", () => {
  it("goes up as a splice on the text it was made on, and comes down to the others as the text it made", () => {
    const room = new Room(start());
    const [ana, ben] = [new Browser(room, "ana"), new Browser(room, "ben", [])];
    ana.edit((d) => typed(d, "Hello world!"));
    expect(ana.up).toEqual([{ t: "ops", seq: 1, ops: [{ k: "el.text", page: "p", id: "t", base: `${MARK}Hello world`, at: 12, del: 0, ins: [{ text: "!" }] }] }]);
    ana.send();
    // nobody is sent the splice: every browser understands the text it made
    expect(ben.opsHeard()).toEqual([{ k: "el.set", page: "p", id: "t", set: { paragraphs: [{ runs: [{ text: "Hello world!" }] }] } }]);
    ana.flush();
    ben.flush();
    expect(wordsOf(room.design)).toBe("Hello world!");
    expect(wordsOf(ben.shown)).toBe("Hello world!");
    expect(wordsOf(ana.shown)).toBe("Hello world!");
  });

  it("from two people at the same moment keeps the letters of both, and everybody ends with the same text", () => {
    const room = new Room(start());
    const [ana, ben, cat] = [new Browser(room, "ana"), new Browser(room, "ben"), new Browser(room, "cat", [])];
    ana.edit((d) => typed(d, "Oh, Hello world"));
    ben.edit((d) => typed(d, "Hello world, friends"));
    ana.send();
    ben.send();
    for (const b of [ana, ben, cat]) b.flush();
    expect(wordsOf(room.design)).toBe("Oh, Hello world, friends");
    for (const b of [ana, ben, cat]) expect(wordsOf(b.shown)).toBe("Oh, Hello world, friends");
  });

  it("shows this person's letters at once among the other's, while they wait to be confirmed", () => {
    const room = new Room(start());
    const [ana, ben] = [new Browser(room, "ana"), new Browser(room, "ben")];
    ben.edit((d) => typed(d, "Hello world, friends"));
    ana.edit((d) => typed(d, "Oh, Hello world"));
    ana.edit((d) => typed(d, "Oh, Hello world"));
    ben.send();
    // Ana hears Ben's letters before her own are confirmed: she sees both
    ana.hear();
    expect(wordsOf(ana.shown)).toBe("Oh, Hello world, friends");
    ana.flush();
    ben.flush();
    expect(wordsOf(room.design)).toBe("Oh, Hello world, friends");
  });

  it("goes as the text it makes to a server from before merged text, also when it was made before the welcome", () => {
    // made before the welcome, which is from a server that does not say it merges
    const sent: ClientMsg[] = [];
    const later = new Session({ client: "y", key: "k", send: (m) => sent.push(m), features: [TEXT] });
    later.edit(start(), typed(start(), "Hello there"));
    later.open();
    later.receive({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: start(), peer: 1 });
    expect(sent.at(-1)).toEqual({ t: "ops", seq: 1, ops: [{ k: "el.set", page: "p", id: "t", set: { paragraphs: [{ runs: [{ text: "Hello there" }] }] } }] });
    // and live, to such a server, the paragraphs are set whole from the start
    later.edit(typed(start(), "Hello there"), typed(start(), "Hello there!"));
    expect((sent.at(-1) as Extract<ClientMsg, { t: "ops" }>).ops[0].k).toBe("el.set");
  });

  it("ends the same for everybody, whatever three people type into one box and however their messages cross", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed;
      const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
      const room = new Room(start("The shared words of three people"));
      const people = [new Browser(room, "a"), new Browser(room, "b"), new Browser(room, "c", seed % 3 === 0 ? [] : [TEXT])];
      for (let step = 0; step < 60; step++) {
        const b = people[Math.floor(rnd() * 3)];
        const r = rnd();
        if (r < 0.5) {
          b.edit((d) => {
            const words = wordsOf(d);
            const at = Math.floor(rnd() * (words.length + 1));
            const kind = rnd();
            const next =
              kind < 0.6
                ? words.slice(0, at) + "xyz"[Math.floor(rnd() * 3)] + words.slice(at)
                : kind < 0.9
                  ? words.slice(0, at) + words.slice(at + 2)
                  : words.slice(0, at) + "\n" + words.slice(at);
            return typed(d, next);
          });
        } else if (r < 0.8) b.send(false);
        else b.hear();
      }
      for (let i = 0; i < 3; i++) for (const b of people) b.flush();
      for (const b of people) {
        expect(b.session.pending).toBe(0);
        expect(designsEqual(b.session.design!, room.design)).toBe(true);
        expect(wordsOf(b.shown)).toBe(wordsOf(room.design));
      }
    }
  });
});

describe("who may type in a box that somebody types in", () => {
  const clock = (at = 1_700_000_000_000) => ({ now: () => at, pass: (ms: number) => void (at += ms) });
  const state = (over: Partial<PresenceState> = {}): PresenceState => ({ name: "", page: "p", pointer: null, selection: [], editing: null, ...over });
  function person(room: Room, client: string, features: Feature[]) {
    const heard: ServerMsg[] = [];
    const peer: Peer = { send: (msg) => heard.push(overTheWire(msg)) };
    room.join(peer, client, "edit", joinFeatures({ features }));
    const number = (heard[0] as Extract<ServerMsg, { t: "welcome" }>).peer as number;
    return {
      heard,
      number,
      typingOf: (who: number) =>
        heard.filter((m): m is Extract<PresenceHeard, { editing: string | null }> => m.t === "presence" && m.peer === who && "editing" in m).at(-1)?.editing ?? null,
      taken: () => heard.filter((m) => m.t === "taken"),
      say: (editing: string | null) => void room.receive(peer, { t: "presence", ...state({ name: client, editing }) }),
    };
  }

  it("is everybody whose browser merges, beside another that does", () => {
    const room = new Room(start());
    const [ana, ben, cat] = [person(room, "ana", [TEXT]), person(room, "ben", [TEXT]), person(room, "cat", [TEXT])];
    ana.say("t");
    ben.say("t");
    expect(cat.typingOf(ana.number)).toBe("t");
    expect(cat.typingOf(ben.number)).toBe("t");
    expect(ana.typingOf(ben.number)).toBe("t");
    expect(ben.taken()).toEqual([]);
  });

  it("is nobody else where one of the two types alone: the one who merges is told in words, every time they ask", () => {
    const room = new Room(start());
    const [old, ana, cat] = [person(room, "old", []), person(room, "ana", [TEXT]), person(room, "cat", [TEXT])];
    old.say("t");
    ana.say("t");
    ana.say("t");
    expect(cat.typingOf(ana.number)).toBeNull();
    expect(old.typingOf(ana.number)).toBeNull();
    expect(ana.taken()).toEqual([
      { t: "taken", id: "t", peer: old.number },
      { t: "taken", id: "t", peer: old.number },
    ]);
    // another box is free, and the older browser is told nothing new: it is the one that types
    ana.say("u");
    expect(cat.typingOf(ana.number)).toBe("u");
    expect(old.taken()).toEqual([]);
  });

  it("is nobody else where the first types in a box that merges and the second does not: the older browser closes its own, as before", () => {
    const room = new Room(start());
    const [ana, old, cat] = [person(room, "ana", [TEXT]), person(room, "old", []), person(room, "cat", [TEXT])];
    ana.say("t");
    old.say("t");
    expect(cat.typingOf(old.number)).toBeNull();
    // (a browser from before does not know `taken`: it is not sent one)
    expect(old.taken()).toEqual([]);
    expect(old.typingOf(ana.number)).toBe("t");
  });

  it("is free again when the older browser's person falls silent", () => {
    const time = clock();
    const room = new Room(start(), 0, {}, { now: time.now });
    const [old, ana] = [person(room, "old", []), person(room, "ana", [TEXT])];
    old.say("t");
    time.pass(PRESENCE_STALE_MS + 1);
    ana.say("t");
    expect(ana.taken()).toEqual([]);
    expect(old.typingOf(ana.number)).toBe("t");
  });
});

describe("a splice that comes from outside", () => {
  const op = (over: Record<string, unknown> = {}) => ({ k: "el.text", page: "p", id: "t", base: `${MARK}Hello`, at: 1, del: 2, ins: [{ text: "J" }], ...over });

  it("has its fields, and no others, in the form they should have", () => {
    expect(checkOps([op()])).toEqual([op()]);
    expect(checkOps([op({ ins: [{ para: { align: "center" } }, { text: "x", bold: true }] })])).not.toBeTypeOf("string");
    for (const [wrong, why] of [
      [{ extra: 1 }, /a field that this operation does not have/],
      [{ page: "" }, /a page and an id/],
      [{ base: 5 }, /the text it was made on/],
      [{ at: -1 }, /counts within its text/],
      [{ at: 1.5 }, /counts within its text/],
      [{ at: 4, del: 3 }, /counts within its text/],
      [{ ins: "J" }, /a list of pieces/],
      [{ ins: [5] }, /a piece is an object/],
      [{ ins: [{ para: { align: "left" }, text: "x" }] }, /its paragraph alone/],
      [{ ins: [{ para: { runs: [] } }] }, /an alignment and a list/],
      [{ ins: [{ bold: true }] }, /has its text/],
      [{ ins: [{ text: "x", src: "javascript:alert(1)" }] }, /not a safe address/],
    ] as const) {
      const checked = checkOps([JSON.parse(JSON.stringify(op(wrong as Record<string, unknown>)))]);
      expect(checked).toMatch(why);
    }
  });

  it("is applied and acknowledged, and passed on to nobody as it came", () => {
    const room = new Room(start());
    const heard: ServerMsg[] = [];
    const peer: Peer = { send: (m) => heard.push(m) };
    room.join(peer, "x", "edit", { text: true });
    void room.receive(peer, { t: "ops", seq: 1, ops: [op({ ins: [{ text: "ok" }], at: 1, del: 0 }) as Op] });
    expect(heard.at(-1)).toEqual({ t: "ack", seq: 1, rev: 1 });
    expect(wordsOf(room.design)).toBe("okHello world");
  });

  it("on a text that is not a text, or is not there, changes nothing", () => {
    const d = start();
    expect(applyOps(d, [op({ id: "nothing" }) as Op])).toBe(d);
    const shape = { ...d, pages: [{ ...d.pages[0], elements: [{ ...d.pages[0].elements[0], type: "shape" } as never] }] } as Design;
    expect(applyOps(shape, [op() as Op])).toBe(shape);
  });

  it("made on a text that has nothing in common with the room's, of a million characters, takes little time and stays within the work a batch may take", () => {
    const big = "b".repeat(900_000);
    const room = new Room(start(big));
    const heard: ServerMsg[] = [];
    const peer: Peer = { send: (m) => heard.push(m) };
    room.join(peer, "x", "edit", { text: true });
    const t = performance.now();
    void room.receive(peer, { t: "ops", seq: 1, ops: [op({ base: MARK + "a".repeat(900_000), at: 450_000, del: 10, ins: [{ text: "!" }] }) as Op] });
    expect(performance.now() - t).toBeLessThan(3000);
    expect(heard.at(-1)).toMatchObject({ t: "ack" });
    expect(wordsOf(room.design)).toHaveLength(900_001);
  });

  it("many of them in one batch are stopped at the work a batch may take", () => {
    const room = new Room(start("c".repeat(200_000)));
    const heard: ServerMsg[] = [];
    const peer: Peer = { send: (m) => heard.push(m) };
    room.join(peer, "x", "edit", { text: true });
    const base = MARK + "d".repeat(200_000);
    const ops = Array.from({ length: 400 }, () => op({ base, at: 5, del: 0, ins: [{ text: "!" }] }) as Op);
    void room.receive(peer, { t: "ops", seq: 1, ops });
    expect(heard.at(-1)).toMatchObject({ t: "rejected" });
    expect(wordsOf(room.design)).toHaveLength(200_000);
  });

  it("taken, from a server, names a text and a person", () => {
    expect(parseServerMsg({ t: "taken", id: "t", peer: 3 })).toEqual({ t: "taken", id: "t", peer: 3 });
    expect(parseServerMsg({ t: "taken", id: "", peer: 3 })).toMatch(/a text and a person/);
    expect(parseServerMsg({ t: "taken", id: "t", peer: -1 })).toMatch(/a text and a person/);
  });
});

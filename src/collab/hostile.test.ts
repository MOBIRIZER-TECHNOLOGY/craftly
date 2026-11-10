/**
 * A server that cannot be trusted. A link names the server, and anybody can make a link, so the browser takes nothing for granted
 * that comes back: everything that arrives is checked the way the server checks what arrives from a browser. What fails the check is
 * not used, and the connection is closed for good (a server that sends such a thing once will send it again).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { Live, type LiveStatus, type SocketLike } from "./live";
import type { ClientMsg } from "./protocol";
import { Session } from "./session";

const base = (): Design =>
  createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 })] })] });
const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const welcome = (design: unknown = overTheWire(base()), rev = 0) => ({ t: "welcome", role: "edit", rev, lastSeq: 0, design });
const withGraphic = (svg: string) => ({
  ...overTheWire(base()),
  pages: [{ id: "p", background: { type: "solid", color: "#ffffff" }, elements: [{ id: "g", type: "graphic", svg }] }],
});
const code = [{ k: "el.set", page: "p", id: "a", set: { src: "javascript:alert(1)" } }];

function start() {
  const sent: ClientMsg[] = [];
  const session = new Session({ client: "me", key: "k", send: (m) => sent.push(m) });
  session.open();
  return { session, sent };
}
function joined() {
  const made = start();
  expect(made.session.receive(welcome())).toEqual({ changed: true, ended: null, joined: true });
  return made;
}
const x = (d: Design | null) => d!.pages[0].elements[0].x;

describe("a welcome that cannot be trusted", () => {
  it.each<[string, () => unknown]>([
    ["markup that runs code after a slash", () => withGraphic('<svg/onload="alert(1)"/>')],
    ["markup with a script", () => withGraphic("<svg><script>alert(1)</script></svg>")],
    ["a picture that is code", () => ({ ...overTheWire(base()), pages: [{ id: "p", elements: [{ id: "a", type: "image", src: "javascript:alert(1)" }] }] })],
    ["a property called __proto__", () => JSON.parse('{"__proto__":{"x":1},"title":"t","width":1,"height":1,"pages":[{"id":"p","elements":[]}]}')],
    ["something that is not a design", () => 5],
    ["a design with a title that is not text", () => ({ ...overTheWire(base()), title: { a: 1 } })],
  ])("ends the session at %s and uses none of it", (_what, make) => {
    const { session, sent } = start();
    expect(session.receive(welcome(make()))).toEqual({ changed: false, ended: "invalid" });
    expect(session.status).toBe("ended");
    expect(session.server).toBeNull();
    expect(session.design).toBeNull();
    expect(session.role).toBeNull();
    expect(sent).toEqual([{ t: "join", client: "me", key: "k" }]);
  });

  it("does not send what a person made while it was away to a server that has shown what it is", () => {
    const { session, sent } = start();
    session.receive(welcome(withGraphic("<svg><script/></svg>")));
    session.edit(base(), { ...base(), title: "Changed" });
    session.open();
    expect(sent).toEqual([{ t: "join", client: "me", key: "k" }]);
    expect(session.status).toBe("ended");
  });
});

describe("a session that has ended", () => {
  it("is not believed again once the server has been found out: a good welcome that comes after a bad message changes nothing", () => {
    const { session } = start();
    session.receive(welcome(withGraphic("<svg><script/></svg>")));
    expect(session.receive(welcome())).toEqual({ changed: false, ended: null });
    expect(session.status).toBe("ended");
    expect(session.design).toBeNull();
    expect(session.role).toBeNull();
  });

  it("is not let in by a welcome that comes after the browser was turned away", () => {
    const { session } = start();
    expect(session.receive({ t: "denied", reason: "no-access" })).toEqual({ changed: false, ended: "no-access" });
    expect(session.receive(welcome())).toEqual({ changed: false, ended: null });
    expect(session.status).toBe("ended");
    expect(session.design).toBeNull();
  });
});

describe("operations that cannot be trusted", () => {
  it("end the session and leave the design as it was", () => {
    const { session } = joined();
    const shown = session.design;
    expect(session.receive({ t: "ops", rev: 1, ops: code })).toEqual({ changed: false, ended: "invalid" });
    expect(session.status).toBe("ended");
    expect(session.design).toBe(shown);
    expect(session.rev).toBe(0);
  });

  it("do not let the good operations of the same batch through", () => {
    const { session } = joined();
    const ops = [{ k: "el.set", page: "p", id: "a", set: { x: 55 } }, ...code];
    session.receive({ t: "ops", rev: 1, ops });
    expect(x(session.design)).toBe(0);
  });

  it("do not let a property called __proto__ near the design", () => {
    const { session } = joined();
    const ops = JSON.parse('[{"k":"el.set","page":"p","id":"a","set":{"__proto__":{"polluted":true}}}]') as unknown[];
    expect(session.receive({ t: "ops", rev: 1, ops })).toEqual({ changed: false, ended: "invalid" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((session.design!.pages[0].elements[0] as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("are not applied after the session has ended, whatever they hold", () => {
    const { session } = joined();
    session.receive({ t: "ops", rev: 1, ops: code });
    expect(session.receive({ t: "ops", rev: 1, ops: [{ k: "el.set", page: "p", id: "a", set: { x: 9 } }] })).toEqual({ changed: false, ended: null });
    expect(x(session.design)).toBe(0);
  });

  it("are checked in a batch that comes after an acknowledgement as well as in one that comes alone", () => {
    const { session } = joined();
    session.edit(base(), { ...base(), title: "Mine" });
    expect(session.receive({ t: "ack", seq: 1, rev: 1 })).toEqual({ changed: false, ended: null });
    expect(session.receive({ t: "ops", rev: 2, ops: code })).toEqual({ changed: false, ended: "invalid" });
    expect(session.design!.title).toBe("Mine");
  });
});

describe("messages of the wrong form", () => {
  it.each<[string, unknown]>([
    ["a number where a text is", { t: "ack", seq: "1", rev: 1 }],
    ["a revision that is not a number", { t: "ops", rev: "1", ops: [] }],
    ["operations that are not a list", { t: "ops", rev: 1, ops: "x" }],
    ["nothing at all", null],
    ["a list", []],
    ["a reason to be turned away that nobody has", { t: "denied", reason: "because" }],
  ])("end the session at %s", (_what, msg) => {
    const { session } = joined();
    expect(session.receive(msg)).toEqual({ changed: false, ended: "invalid" });
    expect(session.status).toBe("ended");
  });

  it("go on at a kind of message that a newer server may send", () => {
    const { session } = joined();
    expect(session.receive({ t: "presence", who: ["ana"] })).toEqual({ changed: false, ended: null });
    expect(session.status).toBe("live");
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: ClientMsg[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe("the connection to a server that cannot be trusted", () => {
  let sockets: FakeSocket[];
  let changes: number;
  let statuses: Array<[LiveStatus, string | null]>;
  const make = () =>
    new Live({
      url: "ws://server.test/ws?room=r",
      key: "k",
      client: "me",
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      onChange: () => void changes++,
      onStatus: (status, reason) => statuses.push([status, reason]),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sockets = [];
    changes = 0;
    statuses = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is closed for good at the first design it cannot use: the person is told, nothing is shown, nothing is tried again", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(withGraphic('<svg><g onclick="x()"/></svg>')));
    expect(live.status).toBe("denied");
    expect(live.denied).toBe("invalid");
    expect(statuses).toEqual([["denied", "invalid"]]);
    expect(changes).toBe(0);
    expect(live.design).toBeNull();
    expect(sockets[0].readyState).toBe(3);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([{ t: "join", client: "me", key: "k" }]); // no ping, nothing more
  });

  it("is closed for good at operations it cannot use, and what was shown stays", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome());
    expect(changes).toBe(1);
    sockets[0].say({ t: "ops", rev: 1, ops: code });
    expect(live.status).toBe("denied");
    expect(live.denied).toBe("invalid");
    expect(changes).toBe(1);
    expect(x(live.design)).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("takes nothing from what the server says in the same breath after it was found out", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome(withGraphic("<svg><script/></svg>")));
    sockets[0].say(welcome()); // the socket is closing, but messages that were on their way still arrive
    sockets[0].say({ t: "ops", rev: 1, ops: [{ k: "el.set", page: "p", id: "a", set: { x: 7 } }] });
    expect(live.status).toBe("denied");
    expect(live.denied).toBe("invalid");
    expect(changes).toBe(0);
    expect(live.design).toBeNull();
    expect(statuses).toEqual([["denied", "invalid"]]);
  });

  it("goes on at a kind of message it does not know, and at a server that is simply honest", () => {
    const live = make();
    live.start();
    sockets[0].open();
    sockets[0].say(welcome());
    sockets[0].say({ t: "presence", who: [] });
    sockets[0].say({ t: "ops", rev: 1, ops: [{ k: "el.set", page: "p", id: "a", set: { x: 7 } }] });
    expect(live.status).toBe("live");
    expect(x(live.design)).toBe(7);
    expect(changes).toBe(2);
  });
});

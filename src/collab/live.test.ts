/**
 * The browser's connection to a shared design: the socket, joining, sending what the person changes, and coming back after the
 * connection is lost, with time and the socket made up so that the waits can be checked exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { Live, PermanentSendError, type LiveStatus, type SocketLike } from "./live";
import type { ClientMsg, ServerMsg } from "./protocol";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMsg[] = [];
  closedWith: number | undefined;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  /** the server's side */
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(msg: ServerMsg | string) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  lose(code?: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const base = (): Design =>
  createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 })] })] });
const welcome = (rev = 0, lastSeq = 0, design = base()): ServerMsg => ({ t: "welcome", role: "edit", rev, lastSeq, design });

const KEY = "s3cret-key";
let sockets: FakeSocket[];
let changes: number;
let statuses: Array<[LiveStatus, string | null]>;
const make = (extra: Partial<ConstructorParameters<typeof Live>[0]> = {}) =>
  new Live({
    url: "ws://server.test/ws?room=r",
    key: KEY,
    client: "me",
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    onChange: () => void changes++,
    onStatus: (status, reason) => statuses.push([status, reason]),
    ...extra,
  });
const last = () => sockets[sockets.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: the waits are exact
  sockets = [];
  changes = 0;
  statuses = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connecting", () => {
  it("opens a socket to the address, joins as soon as it is open, and is live when the design has arrived", () => {
    const live = make();
    live.start();
    expect(sockets).toHaveLength(1);
    expect(last().url).toBe("ws://server.test/ws?room=r");
    expect(live.status).toBe("connecting");
    last().open();
    expect(last().sent).toEqual([{ t: "join", client: "me", key: KEY }]);
    last().say(welcome(4));
    expect(live.status).toBe("live");
    expect(live.session.rev).toBe(4);
    expect(live.design?.title).toBe("Shared");
    expect(changes).toBe(1);
    expect(statuses).toEqual([["live", null]]);
  });

  it("shows the key in the first message of every connection and in no address", () => {
    const live = make();
    live.start();
    last().open();
    last().say(welcome());
    last().lose();
    vi.advanceTimersByTime(500);
    last().open();
    expect(sockets).toHaveLength(2);
    for (const socket of sockets) {
      expect(socket.sent).toEqual([{ t: "join", client: "me", key: KEY }]);
      expect(socket.url).not.toContain(KEY);
    }
  });

  it("does not open a second socket when it is started twice", () => {
    const live = make();
    live.start();
    live.start();
    expect(sockets).toHaveLength(1);
  });

  it("names itself when it is not given a name, differently every time", () => {
    const [a, b] = [make({ client: undefined }), make({ client: undefined })];
    a.start();
    b.start();
    sockets[0].open();
    sockets[1].open();
    const names = sockets.map((s) => (s.sent[0] as { client: string }).client);
    expect(names[0]).toMatch(/^[a-z0-9]{8,}$/);
    expect(names[0]).not.toBe(names[1]);
  });

  it("ignores what is not JSON, and a socket that cannot be made is tried again later", () => {
    const live = make();
    live.start();
    last().open();
    last().say("not json {{{");
    expect(live.status).toBe("connecting");
    let tries = 0;
    const failing = make({
      createSocket: () => {
        tries++;
        throw new Error("no sockets here");
      },
    });
    failing.start();
    expect(tries).toBe(1);
    vi.advanceTimersByTime(500);
    expect(tries).toBe(2);
  });
});

describe("sending", () => {
  it("sends a change at once when it is live, and holds it until the design has arrived when it is not", () => {
    const live = make();
    live.start();
    last().open();
    const before = base();
    const after = { ...before, title: "Renamed" };
    live.edit(before, after); // the design has not arrived: queued
    expect(last().sent).toEqual([{ t: "join", client: "me", key: KEY }]);
    last().say(welcome(0, 0, before));
    expect(last().sent.at(-1)).toMatchObject({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "Renamed" } }] });
    live.edit(after, { ...after, title: "Again" });
    expect(last().sent.at(-1)).toMatchObject({ t: "ops", seq: 2 });
    expect(live.session.pending).toBe(2);
    last().say({ t: "ack", seq: 1, rev: 1 });
    last().say({ t: "ack", seq: 2, rev: 2 });
    expect(live.session.pending).toBe(0);
  });

  it("keeps what is changed while the connection is down, and sends it after the next welcome, in order", () => {
    const live = make();
    live.start();
    last().open();
    last().say(welcome());
    const d0 = live.design!;
    last().lose();
    expect(live.status).toBe("reconnecting");
    const d1 = { ...d0, title: "One" };
    live.edit(d0, d1);
    live.edit(d1, { ...d1, title: "Two" });
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    last().open();
    last().say(welcome(0, 0, base()));
    const ops = last().sent.filter((m) => m.t === "ops") as Array<Extract<ClientMsg, { t: "ops" }>>;
    expect(ops.map((m) => m.seq)).toEqual([1, 2]);
    expect(live.status).toBe("live");
  });
});

describe("an edit that has to be prepared before it is sent (its images are uploaded)", () => {
  const opsSent = (socket: FakeSocket) => (socket.sent.filter((m) => m.t === "ops") as Array<Extract<ClientMsg, { t: "ops" }>>).map((m) => m.seq);
  const withBad = (d: Design): Design => ({ ...d, pages: d.pages.map((p) => ({ ...p, elements: [...p.elements, createShape("rect", { id: "bad" })] })) });
  const hasBad = (d: Design) => d.pages[0].elements.some((e) => e.id === "bad");
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it("waits longer each time while the same edit cannot be prepared, although the server welcomes it every time, and starts over once it has gone", async () => {
    let failing = true;
    const errors: string[] = [];
    const live = make({
      prepareEdit: async () => {
        if (failing) throw new Error("the upload did not get through");
      },
      onSendError: (reason) => errors.push(reason),
    });
    live.start();
    last().open();
    last().say(welcome());
    const d0 = live.design!;
    live.edit(d0, { ...d0, title: "Renamed" });
    await settle();
    expect(errors).toEqual(["the upload did not get through"]);
    expect(last().readyState).toBe(3);
    expect(live.status).toBe("reconnecting");
    expect(live.session.pending).toBe(1); // the edit is kept and tried again
    for (const wait of [500, 1000, 2000]) {
      const count = sockets.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(sockets).toHaveLength(count); // a welcome in between does not bring the wait back to the shortest
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(count + 1);
      if (wait === 2000) failing = false;
      last().open();
      last().say(welcome());
      await settle();
    }
    expect(opsSent(last())).toEqual([1]);
    expect(live.status).toBe("live");
    last().lose();
    vi.advanceTimersByTime(500); // the edit got through: back to the shortest wait
    expect(sockets).toHaveLength(5);
  });

  it("says something even when what went wrong while preparing is not an error with a message", async () => {
    const errors: string[] = [];
    const live = make({ prepareEdit: () => Promise.reject("nope"), onSendError: (reason) => errors.push(reason) });
    live.start();
    last().open();
    last().say(welcome());
    live.edit(live.design!, { ...live.design!, title: "Renamed" });
    await settle();
    expect(errors).toEqual(["Could not send a shared image."]);
  });

  it("gives up an edit that can never be prepared as if the server had refused it, stays connected, and sends the edits before and behind it", async () => {
    const refusals: string[] = [];
    const errors: string[] = [];
    const live = make({
      prepareEdit: async (design) => {
        if (hasBad(design)) throw new PermanentSendError("the image is too big for this room");
      },
      onRejected: (reason) => refusals.push(reason),
      onSendError: (reason) => errors.push(reason),
    });
    live.start();
    last().open();
    // three edits made before the design has arrived: they are sent together after the welcome
    const d0 = base();
    const d1 = { ...d0, title: "One" };
    const d2 = withBad(d1);
    live.edit(d0, d1);
    live.edit(d1, d2);
    live.edit(d2, { ...d2, title: "Three" });
    last().say(welcome(0, 0, d0));
    const before = changes;
    await settle();
    expect(opsSent(last())).toEqual([1, 3]);
    expect(refusals).toEqual(["the image is too big for this room"]);
    expect(errors).toEqual([]);
    expect(changes).toBe(before + 1);
    expect(sockets).toHaveLength(1);
    expect(live.status).toBe("live");
    expect(live.session.pending).toBe(2);
    expect(hasBad(live.design!)).toBe(false);
    expect(live.design!.title).toBe("Three");
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(1); // nothing is tried again
  });

  it("does not send an edit that left the queue while the one before it was being prepared", async () => {
    const waiting: Array<() => void> = [];
    const live = make({ prepareEdit: () => new Promise<void>((resolve) => waiting.push(resolve)) });
    live.start();
    last().open();
    last().say(welcome());
    const d0 = live.design!;
    const d1 = { ...d0, title: "One" };
    live.edit(d0, d1);
    live.edit(d1, { ...d1, title: "Two" });
    await settle();
    last().say({ t: "rejected", seq: 2, reason: "no" });
    waiting.shift()?.();
    await settle();
    waiting.shift()?.(); // were the second prepared all the same, it would go out here
    await settle();
    expect(opsSent(last())).toEqual([1]);
  });
});

describe("another tab with the same name (a duplicated tab copies what a reload keeps)", () => {
  it("takes another name when the server says another connection took its place, and sends what was not confirmed under that name", async () => {
    const kept: Array<{ client: string; seqs: number[] }> = [];
    const live = make({ onOutbox: (outbox) => kept.push({ client: outbox.client, seqs: outbox.queue.map((b) => b.seq) }) });
    live.start();
    last().open();
    last().say(welcome());
    const d0 = live.design!;
    live.edit(d0, { ...d0, title: "Renamed" });
    last().lose(4000); // the other tab joined with the same name
    expect(live.status).toBe("reconnecting");
    vi.advanceTimersByTime(500);
    last().open();
    const join = last().sent[0] as Extract<ClientMsg, { t: "join" }>;
    expect(join.client).toMatch(/^[a-f0-9]{16}$/);
    expect(kept.at(-1)).toEqual({ client: join.client, seqs: [1] }); // what a reload keeps goes by the new name too
    last().say(welcome());
    expect(last().sent.at(-1)).toMatchObject({ t: "ops", seq: 1, ops: [{ k: "design", set: { title: "Renamed" } }] });
    expect(live.session.pending).toBe(1);
  });
});

describe("coming back", () => {
  it("tries again after the wait, which doubles each time up to ten seconds, and starts over once it is back", () => {
    const live = make();
    live.start();
    last().lose(); // never got through: 500 ms
    expect(live.status).toBe("connecting");
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().lose(); // 1,000 ms
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    for (let i = 0; i < 6; i++) {
      last().lose();
      vi.advanceTimersByTime(10_000);
    }
    const count = sockets.length;
    last().lose();
    vi.advanceTimersByTime(9_999);
    expect(sockets).toHaveLength(count); // never more than ten seconds, and not less either
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(count + 1);
    last().open();
    last().say(welcome());
    last().lose();
    expect(live.status).toBe("reconnecting");
    vi.advanceTimersByTime(500); // back to the shortest wait
    expect(sockets).toHaveLength(count + 2);
  });

  it("does not try to come back after it has been stopped, and closes the socket", () => {
    const live = make();
    live.start();
    last().open();
    live.stop();
    expect(last().readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(live.status).toBe("closed");
    live.edit(base(), { ...base(), title: "x" });
    expect(last().sent).toEqual([{ t: "join", client: "me", key: KEY }]);
  });

  it("is told it is not wanted, and stops trying", () => {
    const live = make();
    live.start();
    last().open();
    last().say({ t: "denied", reason: "no-access" });
    expect(live.status).toBe("denied");
    expect(live.denied).toBe("no-access");
    expect(statuses.at(-1)).toEqual(["denied", "no-access"]);
    last().lose();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});

describe("keeping the connection alive", () => {
  it("pings every fifteen seconds while connected, and answers to the pong are taken in silence", () => {
    const live = make();
    live.start();
    last().open();
    last().say(welcome());
    vi.advanceTimersByTime(15_000);
    expect(last().sent.at(-1)).toEqual({ t: "ping" });
    last().say({ t: "pong" });
    vi.advanceTimersByTime(15_000);
    expect(last().sent.filter((m) => m.t === "ping")).toHaveLength(2);
    expect(live.status).toBe("live");
  });

  it("gives up on a connection that has said nothing for 45 seconds, and comes back", () => {
    const live = make();
    live.start();
    last().open();
    last().say(welcome());
    vi.advanceTimersByTime(45_000); // pings go out, nothing comes back
    vi.advanceTimersByTime(15_000);
    expect(last().readyState).toBe(3);
    expect(live.status).toBe("reconnecting");
    vi.advanceTimersByTime(500);
    expect(sockets.length).toBe(2);
  });

  it("stops pinging when the connection is gone", () => {
    const live = make();
    live.start();
    last().open();
    last().say(welcome());
    const first = last();
    first.lose();
    vi.advanceTimersByTime(14_000);
    expect(first.sent.filter((m) => m.t === "ping")).toHaveLength(0);
  });
});

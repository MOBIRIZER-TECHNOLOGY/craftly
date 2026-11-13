/**
 * One person at a time types in a text box of a shared design, end to end: the real store, the browser's connection, the real
 * server, and other people on connections of their own. A box that somebody types in stays closed for the others, who are told
 * who has it; when two open the same box at the same moment the server's order decides, the same for everybody, and the one who
 * gives way is told and loses nothing they had typed until then.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import type { PresenceHeard, PresenceState } from "@/collab/presence";
import { createDesign, createPage, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, LiveLink, TextElement } from "@/core/types";
import { createLiveServer, type LiveServer } from "@/server/live";
import { MemoryStorage } from "@/server/storage";
import { toast } from "@/ui";
import { connectLive, shareDesign, useLiveStatus } from "./connection";
import { websocketUrl } from "./links";
import { clearPresence, setPointer, usePresence } from "./presence";

/**
 * This browser's socket, with a door on what arrives: while it is shut, what the server says waits outside. That is how a test
 * makes the moment in which this person has not heard yet that somebody else started typing.
 */
let waiting: Array<() => void> | null = null;
const env = {
  createSocket: (url: string): SocketLike => {
    const ws = new WebSocket(url);
    const like: SocketLike = {
      get readyState() {
        return ws.readyState;
      },
      send: (data) => ws.send(data),
      close: (code) => ws.close(code),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };
    ws.on("open", () => like.onopen?.({}));
    ws.on("close", (code) => like.onclose?.({ code }));
    ws.on("error", () => like.onerror?.({}));
    ws.on("message", (data) => {
      const deliver = () => like.onmessage?.({ data: data.toString() });
      if (waiting) waiting.push(deliver);
      else deliver();
    });
    return like;
  },
};
const shutTheDoor = () => void (waiting = []);
const openTheDoor = () => {
  const held = waiting ?? [];
  waiting = null;
  for (const deliver of held) deliver();
};

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const design = (): Design =>
  createDesign({
    title: "Together",
    width: 1000,
    height: 600,
    pages: [createPage({ id: "p", elements: [createText({ id: "t", text: "Hello" }), createText({ id: "u", text: "World" })] })],
  });

let server: LiveServer;
let storage: MemoryStorage;
let address: string;
let told: MockInstance<typeof toast.info>;
const stops: Array<() => void> = [];
const others: Live[] = [];

beforeEach(async () => {
  storage = new MemoryStorage();
  server = createLiveServer({ storage });
  address = `http://127.0.0.1:${(await server.listen(0)).port}`;
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(design());
  useLiveStatus.setState({ status: "off", reason: null, role: null });
  clearPresence();
  usePresence.setState({ name: "Me" });
  setPointer(null);
  waiting = null;
  told = vi.spyOn(toast, "info").mockReturnValue(0);
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const live of others.splice(0)) live.stop();
  await server.close();
  vi.restoreAllMocks();
});

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

/** another person, on a plain connection of their own, and what they last heard of each of the others */
async function person(link: LiveLink, name: string) {
  const heard = new Map<number, PresenceState>();
  const live = new Live({
    url: websocketUrl(link),
    key: link.key,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    onChange: () => undefined,
    onPresence: (msg: PresenceHeard) => void ("gone" in msg ? heard.delete(msg.peer) : heard.set(msg.peer, msg)),
  });
  others.push(live);
  live.start();
  await until(`${name} to be in`, () => live.status === "live");
  const say = (editing: string | null) => live.present({ name, page: "p", pointer: null, selection: editing ? [editing] : [], editing });
  say(null);
  return { live, heard, say, typingOf: (peer: number | null) => heard.get(peer as number)?.editing ?? null };
}

async function shared() {
  const link = await shareDesign(address, env);
  stops.push(connectLive(link, env));
  await until("this browser to be in", () => useLiveStatus.getState().status === "live");
  return link;
}
const me = () => usePresence.getState().me;
const typingHere = (peer: number | null) => usePresence.getState().people.find((p) => p.peer === peer)?.editing ?? null;
const textOnServer = async (room: string) => ((await storage.load(room))?.design.pages[0].elements[0] as TextElement).paragraphs[0].runs[0].text;

describe("a text box that somebody else is typing in", () => {
  it("stays closed here, the person is told who is typing, and another box opens as always", async () => {
    const link = await shared();
    const bo = await person(link, "Bo");
    bo.say("t");
    await until("this browser to know that Bo types", () => typingHere(bo.live.peer) === "t");
    a().startTextEdit("t");
    expect(s().editingTextId).toBeNull();
    expect(told).toHaveBeenCalledTimes(1);
    expect(told.mock.calls[0][0]).toMatch(/^Bo is typing in this text/);
    a().startTextEdit("u");
    expect(s().editingTextId).toBe("u");
  });

  it("opens here once the other has closed it", async () => {
    const link = await shared();
    const bo = await person(link, "Bo");
    bo.say("t");
    await until("this browser to know that Bo types", () => typingHere(bo.live.peer) === "t");
    bo.say(null);
    await until("this browser to know that Bo stopped", () => typingHere(bo.live.peer) === null);
    a().startTextEdit("t");
    expect(s().editingTextId).toBe("t");
    expect(told).not.toHaveBeenCalled();
    await until("Bo to hear that this person types there now", () => bo.typingOf(me()) === "t");
  });

  it("opens here once the other has left, without a word from them", async () => {
    const link = await shared();
    const bo = await person(link, "Bo");
    bo.say("t");
    await until("this browser to know that Bo types", () => typingHere(bo.live.peer) === "t");
    bo.live.stop();
    await until("Bo to be off the list", () => usePresence.getState().people.length === 0);
    a().startTextEdit("t");
    expect(s().editingTextId).toBe("t");
  });

  it("is named with a word for a person who gave no name", async () => {
    const link = await shared();
    const bo = await person(link, "");
    bo.say("t");
    await until("this browser to know that they type", () => typingHere(bo.live.peer) === "t");
    a().startTextEdit("t");
    expect(told.mock.calls[0][0]).toMatch(new RegExp(`^Guest ${bo.live.peer} is typing in this text`));
  });
});

describe("two people who open the same text box at the same moment", () => {
  it("the one whose word reached the server first keeps it; this person, the second, is closed out, told why, and keeps what they typed until then", async () => {
    const link = await shared();
    const [bo, cat] = [await person(link, "Bo"), await person(link, "Cat")];
    await until("everybody to know everybody", () => cat.heard.size === 2 && bo.heard.size === 2);
    shutTheDoor(); // from here on this browser hears nothing
    bo.say("t");
    await until("the server to have passed on that Bo types", () => cat.typingOf(bo.live.peer) === "t");
    // this person does not know, opens the same box and types
    a().startTextEdit("t");
    expect(s().editingTextId).toBe("t");
    a().setTextParagraphs("t", [{ runs: [{ text: "Hello from me" }] }]);
    await until("what this person typed to be on the server", async () => (await textOnServer(link.room)) === "Hello from me");
    // nobody was ever told that this person types there: the server heard Bo first
    expect(cat.typingOf(me())).toBeNull();
    expect(bo.typingOf(me())).toBeNull();
    openTheDoor();
    await until("this person's box to be closed", () => s().editingTextId === null);
    expect(told).toHaveBeenCalledTimes(1);
    expect(told.mock.calls[0][0]).toMatch(/^Bo started typing in this text a moment before you/);
    // what was typed until then was the last write, and is still there
    expect(await textOnServer(link.room)).toBe("Hello from me");
    expect((s().design?.pages[0].elements[0] as TextElement).paragraphs[0].runs[0].text).toBe("Hello from me");
    expect(s().design?.pages[0].elements.map((e) => e.id)).toEqual(["t", "u"]);
    // and it stays Bo's: asking again is refused like any box that is taken
    a().startTextEdit("t");
    expect(s().editingTextId).toBeNull();
    expect(cat.typingOf(bo.live.peer)).toBe("t");
  });

  it("this person, the first, keeps it and never hears of the other's attempt; the other hears that it is taken", async () => {
    const link = await shared();
    const [bo, cat] = [await person(link, "Bo"), await person(link, "Cat")];
    a().startTextEdit("t");
    await until("the server to have passed on that this person types", () => cat.typingOf(me()) === "t");
    bo.say("t"); // Bo's browser would not ask, having heard; a browser that had not heard yet would
    bo.say("t");
    await until("Cat to have heard Bo's last word", () => cat.heard.get(bo.live.peer as number)?.selection.length === 1);
    expect(cat.typingOf(bo.live.peer)).toBeNull();
    expect(typingHere(bo.live.peer)).toBeNull();
    expect(bo.typingOf(me())).toBe("t");
    expect(s().editingTextId).toBe("t");
    expect(told).not.toHaveBeenCalled();
  });
});

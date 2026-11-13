/**
 * The editor's side of a shared design, end to end: the real store, the browser's connection, the real server on a port of its own,
 * and another person on a connection of their own. A person starts sharing, the other joins with the link, and what either does
 * shows up for the other, while undo takes back only the person's own steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import { getAsset } from "@/core/assets";
import { createDesign, createImage, createPage, createShape, createText } from "@/core/factory";
import { saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design, LiveLink } from "@/core/types";
import { createLiveServer, type LiveServer } from "@/server/live";
import { MemoryStorage } from "@/server/storage";
import { connectLive, joinDesign, shareDesign, stopSharing, useLiveStatus } from "./connection";
import { toast } from "@/ui";
import { joinToken, parseJoinToken, websocketUrl } from "./links";
import { downloadBlob } from "@/export/download";
import { exportProjectFile } from "@/export/projectFile";

// The library, the images and the download need a browser. What the connection asks of them is what is checked here.
vi.mock("@/core/library", async (original) => ({ ...(await original<typeof import("@/core/library")>()), saveDesign: vi.fn() }));
vi.mock("@/core/assets", async (original) => ({ ...(await original<typeof import("@/core/assets")>()), getAsset: vi.fn() }));
vi.mock("@/export/projectFile", async (original) => ({ ...(await original<typeof import("@/export/projectFile")>()), exportProjectFile: vi.fn() }));
vi.mock("@/export/download", async (original) => ({ ...(await original<typeof import("@/export/download")>()), downloadBlob: vi.fn() }));

/** every address that a socket was opened with */
const addresses: string[] = [];
const env = {
  createSocket: (url: string) => {
    addresses.push(url);
    return new WebSocket(url) as unknown as SocketLike;
  },
};
const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const el = (id: string) => s().design!.pages[0].elements.find((e) => e.id === id)!;

const design = (): Design =>
  createDesign({
    title: "Together",
    width: 1000,
    height: 600,
    pages: [
      createPage({
        id: "p",
        elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 }), createShape("rect", { id: "b", x: 300, y: 0, width: 100, height: 50 })],
      }),
    ],
  });

let server: LiveServer;
let address: string;
let storage: MemoryStorage;
const stops: Array<() => void> = [];
const others: Live[] = [];

beforeEach(async () => {
  addresses.length = 0;
  storage = new MemoryStorage();
  server = createLiveServer({ storage });
  const { port } = await server.listen(0);
  address = `http://127.0.0.1:${port}`;
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(design());
  useLiveStatus.setState({ status: "off", reason: null, role: null });
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const live of others.splice(0)) live.stop();
  await server.close();
});

async function until(what: string, check: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

/** another person, on a connection of their own */
function person(link: LiveLink) {
  const live = new Live({ url: websocketUrl(link), key: link.key, createSocket: env.createSocket, onChange: () => undefined });
  others.push(live);
  live.start();
  return live;
}

describe("starting to share", () => {
  it("makes a room of the design that is open, keeps the link with the design on this device, and is not a step of undo", async () => {
    a().updateElements(["a"], { x: 5 });
    const link = await shareDesign(address, env);
    expect(link.server).toBe(address);
    expect(link.role).toBe("edit");
    expect(link.viewKey).toBeTruthy();
    expect(link.viewKey).not.toBe(link.key);
    expect(s().design!.live).toEqual(link);
    const record = (await storage.load(link.room))!;
    expect(record.design.pages[0].elements.find((e) => e.id === "a")?.x).toBe(5); // what was open is what was shared
    expect(JSON.stringify(record.design)).not.toContain(link.key); // the link stays on this device
    expect(JSON.stringify(record.design)).not.toContain('"live"');
  });

  it("does not send the link of an earlier session along with the design", async () => {
    a().setLiveLink({ server: "https://old.example.test", room: "OLDROOMOLDROOMOLDROOM", key: "OLDKEYOLDKEY", role: "edit", viewKey: "OLDVIEWKEY" });
    const link = await shareDesign(address, env);
    const record = await storage.load(link.room);
    expect(JSON.stringify(record)).not.toContain("OLDKEY");
    expect(JSON.stringify(record)).not.toContain("OLDROOM");
    expect(s().design!.live).toEqual(link);
  });

  it("says what went wrong in words when the server does not answer, refuses, or is not a server at all", async () => {
    await expect(shareDesign("http://127.0.0.1:9", env)).rejects.toThrow(/reach/i);
    await expect(shareDesign("not a server", env)).rejects.toThrow(/not the address of a server/i);
    const small = createLiveServer({ storage: new MemoryStorage(), maxDesignBytes: 100 });
    const { port } = await small.listen(0);
    await expect(shareDesign(`http://127.0.0.1:${port}`, env)).rejects.toThrow(/too big/i);
    await small.close();
    await expect(shareDesign(`${address}/nothing-here`, env)).rejects.toThrow();
  });
});

describe("the key", () => {
  it("travels in the first message and in no address of a socket: not the owner's, a guest's, one who only looks, or the one who joins with a link", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive(link, env));
    await until("this person to be live", () => useLiveStatus.getState().status === "live");
    const looker = person({ ...link, key: link.viewKey!, role: "view" });
    const guest = person(link);
    await until("both to be live", () => looker.status === "live" && guest.status === "live");
    const joined = await joinDesign(parseJoinToken(joinToken(link))!, env);
    expect(joined.role).toBe("edit");
    expect(addresses).toHaveLength(4);
    for (const url of addresses) {
      expect(url).toContain(link.room);
      expect(url).not.toContain(link.key);
      expect(url).not.toContain(link.viewKey!);
    }
  });
});

describe("working together", () => {
  it("shows what the other person does, tells them what this person does, and undo takes back only this person's steps", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive(link, env));
    await until("this person to be live", () => useLiveStatus.getState().status === "live");
    expect(s().live).toBe(true);
    expect(s().canUndo).toBe(false);

    const other = person({ ...link, key: link.viewKey!, role: "view" }); // someone who only looks
    const editor = person(link); // the same key as the owner's, another person
    await until("both to be live", () => other.status === "live" && editor.status === "live");

    // theirs arrives
    const e0 = editor.design!;
    editor.edit(e0, { ...e0, pages: e0.pages.map((p) => ({ ...p, elements: p.elements.map((x) => (x.id === "b" ? { ...x, x: 777 } : x)) })) });
    await until("their change to arrive", () => el("b").x === 777);
    expect(s().canUndo).toBe(false); // not a step of this person's own
    expect(s().saveState).toBe("unsaved");

    // mine goes out
    a().updateElements(["a"], { x: 40 });
    await until("my change to reach them", () => editor.design?.pages[0].elements[0].x === 40 && other.design?.pages[0].elements[0].x === 40);
    expect(s().canUndo).toBe(true);

    // undo takes back mine and leaves theirs
    a().undo();
    await until("the undo to reach them", () => editor.design?.pages[0].elements[0].x === 0);
    expect(el("a").x).toBe(0);
    expect(el("b").x).toBe(777);
    a().redo();
    await until("the redo to reach them", () => other.design?.pages[0].elements[0].x === 40);
  });

  it("says so when someone else deletes the text this person is typing in, and not for any other change of theirs", async () => {
    const info = vi.spyOn(toast, "info");
    const id = a().addElement(createText({ id: "words", text: "Typing here", fontSize: 30 }));
    const link = await shareDesign(address, env);
    stops.push(connectLive(link, env));
    const editor = person(link);
    await until("both to be live", () => useLiveStatus.getState().status === "live" && editor.status === "live" && !!editor.design?.pages[0].elements.some((x) => x.id === id));
    a().startTextEdit(id);
    expect(s().editingTextId).toBe(id);

    // they move a shape: the text is still being edited and nothing is said
    const e0 = editor.design!;
    editor.edit(e0, { ...e0, pages: e0.pages.map((p) => ({ ...p, elements: p.elements.map((x) => (x.id === "b" ? { ...x, x: 555 } : x)) })) });
    await until("their move to arrive", () => el("b").x === 555);
    expect(s().editingTextId).toBe(id);
    expect(info).not.toHaveBeenCalled();

    // they delete the text
    const e1 = editor.design!;
    editor.edit(e1, { ...e1, pages: e1.pages.map((p) => ({ ...p, elements: p.elements.filter((x) => x.id !== id) })) });
    await until("the text to be gone here", () => !s().design!.pages[0].elements.some((x) => x.id === id));
    expect(s().editingTextId).toBeNull();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("Someone else deleted the text you were editing.");
    info.mockRestore();
  });

  it("keeps working on what was changed while the connection was lost, and lets the others have it afterwards", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive(link, env));
    await until("live", () => useLiveStatus.getState().status === "live");
    const editor = person(link);
    await until("the other to be live", () => editor.status === "live");
    await server.close();
    await until("this person to notice", () => useLiveStatus.getState().status === "reconnecting");
    a().updateElements(["a"], { x: 99 }); // the server is gone: it waits
    expect(el("a").x).toBe(99);
    expect(s().design!.live).toEqual(link);
    server = createLiveServer({ storage });
    const { port } = await server.listen(Number(new URL(address).port));
    expect(port).toBe(Number(new URL(address).port));
    await until("this person to be back", () => useLiveStatus.getState().status === "live", 20_000);
    await until("the change made meanwhile to reach the other", () => editor.design?.pages[0].elements[0].x === 99, 20_000);
  }, 40_000);

  it("looks and does not touch when the key only lets it look", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive({ ...link, key: link.viewKey!, role: "view" }, env));
    await until("live", () => useLiveStatus.getState().status === "live");
    expect(s().mode).toBe("view");
    expect(useLiveStatus.getState().role).toBe("view");
    a().updateElements(["a"], { x: 5 });
    expect(el("a").x).toBe(0);
  });

  it("says so when the room is not there or the key is wrong, and leaves the design as it is", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive({ ...link, key: "wrong-key-wrong-key" }, env));
    await until("the refusal", () => useLiveStatus.getState().status === "denied");
    expect(useLiveStatus.getState().reason).toBe("no-access");
    stops.push(connectLive({ ...link, room: "A".repeat(22) }, env));
    await until("the other refusal", () => useLiveStatus.getState().reason === "not-found");
    expect(el("a").x).toBe(0);
  });

  it("makes a design that was only looked at editable again when the connection is closed", async () => {
    const link = await shareDesign(address, env);
    const stop = connectLive({ ...link, key: link.viewKey!, role: "view" }, env);
    await until("live", () => useLiveStatus.getState().status === "live");
    expect(s().mode).toBe("view");
    stop();
    expect(s().mode).toBe("edit");
  });

  it("lets go cleanly: the design is the person's own again", async () => {
    const link = await shareDesign(address, env);
    const stop = connectLive(link, env);
    await until("live", () => useLiveStatus.getState().status === "live");
    stop();
    expect(useLiveStatus.getState()).toMatchObject({ status: "off", reason: null, role: null });
    expect(s().live).toBe(false);
    expect(s().design!.live).toEqual(link); // the link stays with the design until sharing is stopped
    a().updateElements(["a"], { x: 3 });
    expect(s().canUndo).toBe(true); // an ordinary history again
  });
});

describe("stopping to share", () => {
  it("closes the room for everybody, forgets the link, and the design stays on this device", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive(link, env));
    await until("live", () => useLiveStatus.getState().status === "live");
    const editor = person(link);
    await until("the other to be live", () => editor.status === "live");
    await stopSharing(env);
    expect(s().design!.live).toBeUndefined();
    await until("the other to be sent away", () => editor.status === "denied");
    expect(await storage.load(link.room)).toBeNull();
    expect(el("a")).toBeTruthy();
  });

  it("forgets the link of a room that the server no longer has, says why when the server refuses, and keeps the link when it cannot be reached", async () => {
    const link = await shareDesign(address, env);
    const reply = (status: number) => ({ ok: status < 400, status, json: async () => ({ error: "the server says no" }) }) as unknown as Response;
    await expect(stopSharing({ fetch: async () => reply(403) })).rejects.toThrow("the server says no");
    expect(s().design!.live).toEqual(link);
    await expect(
      stopSharing({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).rejects.toThrow(/Couldn't reach the server/);
    expect(s().design!.live).toEqual(link);
    await stopSharing({ fetch: async () => reply(404) }); // the room is gone already: there is nothing to close
    expect(s().design!.live).toBeUndefined();
  });

  it("only forgets the link of a design that was joined with a key that cannot stop it", async () => {
    const link = await shareDesign(address, env);
    a().setLiveLink({ ...link, key: link.viewKey!, role: "view", viewKey: undefined });
    await stopSharing(env);
    expect(s().design!.live).toBeUndefined();
    expect(await storage.load(link.room)).not.toBeNull(); // somebody else's room is not ours to close
  });
});

describe("leaving a design that was joined with a key that edits", () => {
  it("only forgets the link: the room is not the one who joined's to close", async () => {
    const link = await shareDesign(address, env);
    a().setLiveLink({ server: link.server, room: link.room, key: link.key, role: "edit" }); // given the link, not the one who started it
    await stopSharing(env);
    expect(s().design!.live).toBeUndefined();
    expect(await storage.load(link.room)).not.toBeNull();
  });
});

describe("joining with a link that leads to a server that never answers", () => {
  it("gives up after fifteen seconds, and not before", async () => {
    vi.useFakeTimers();
    try {
      const silent = { createSocket: () => ({ readyState: 0, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }) as unknown as SocketLike };
      const link = { server: address, room: "A".repeat(22), key: "k".repeat(12), role: "edit" as const };
      const attempt = joinDesign(link, silent);
      const settled = vi.fn();
      void attempt.catch(settled);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await expect(attempt).rejects.toThrow(/Couldn't reach the server/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("joining with a link", () => {
  it("gets the design as it is now and what the key allows, and refuses a link that leads nowhere", async () => {
    const link = await shareDesign(address, env);
    a().updateElements(["a"], { x: 11 });
    const joined = await joinDesign(parseJoinToken(joinToken(link))!, env);
    expect(joined.role).toBe("edit");
    expect(joined.design.title).toBe("Together");
    await expect(joinDesign({ ...link, key: "wrong-key-wrong-key" }, env)).rejects.toThrow(/not allowed|no access|key/i);
    await expect(joinDesign({ ...link, room: "A".repeat(22) }, env)).rejects.toThrow(/no longer|not there|found/i);
    await expect(joinDesign({ ...link, server: "http://127.0.0.1:9" }, { ...env, timeoutMs: 400 })).rejects.toThrow(/reach/i);
  });
});

/** A server that says what it is told to say as soon as a browser joins: the way to meet one that cannot be trusted. */
function scripted(replies: () => unknown[]): SocketLike {
  const socket = {
    readyState: 0,
    onopen: null as ((e: unknown) => void) | null,
    onclose: null as ((e: unknown) => void) | null,
    onerror: null,
    onmessage: null as ((e: { data: unknown }) => void) | null,
    send(data: string) {
      if ((JSON.parse(data) as { t: string }).t === "join") for (const reply of replies()) queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify(reply) }));
    },
    close() {
      socket.readyState = 3;
      socket.onclose?.({});
    },
  };
  queueMicrotask(() => {
    socket.readyState = 1;
    socket.onopen?.({});
  });
  return socket as unknown as SocketLike;
}

/** What a browser keeps under names, made up: the tests run where there is none. */
function fakeStorage(): Storage {
  const kept = new Map<string, string>();
  return {
    get length() {
      return kept.size;
    },
    key: (i: number) => [...kept.keys()][i] ?? null,
    getItem: (name: string) => kept.get(name) ?? null,
    setItem: (name: string, value: string) => void kept.set(name, String(value)),
    removeItem: (name: string) => void kept.delete(name),
    clear: () => kept.clear(),
  };
}
const names = (storage: Storage, prefix: string) => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter((name) => name.startsWith(prefix));

describe("edits that do not get through", () => {
  const save = vi.mocked(saveDesign);
  const copies = () => save.mock.calls.map(([copy]) => copy);
  const xOf = (d: Design, id: string) => d.pages[0].elements.find((e) => e.id === id)?.x;
  const fake = { server: "https://full.example.test", room: "A".repeat(22), key: "k".repeat(12), role: "edit" as const };
  const told = () => error.mock.calls.map(([message]) => String(message));
  let error: MockInstance<typeof toast.error>;
  /** every socket of `refusing` and `deaf`, so that a test can close one the way a server does */
  let made: Array<{ onclose: ((e: unknown) => void) | null; readyState: number }>;

  /** A server that lets a browser in with the design it has open, and then refuses every edit (as one whose room is full does) or says nothing. */
  function answering(edit: (seq: number) => unknown[]): SocketLike {
    const first = JSON.parse(JSON.stringify(s().design)) as Design;
    const socket = {
      readyState: 0,
      onopen: null as ((e: unknown) => void) | null,
      onclose: null as ((e: unknown) => void) | null,
      onerror: null,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      send(data: string) {
        const msg = JSON.parse(data) as { t: string; seq: number };
        const replies = msg.t === "join" ? [{ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: first }] : msg.t === "ops" ? edit(msg.seq) : [];
        for (const reply of replies) queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify(reply) }));
      },
      close() {
        socket.readyState = 3;
        socket.onclose?.({});
      },
    };
    made.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.onopen?.({});
    });
    return socket as unknown as SocketLike;
  }
  const refusing = { createSocket: () => answering((seq) => [{ t: "rejected", seq, reason: "This shared design exceeds the room size limit." }]) };
  const deaf = { createSocket: () => answering(() => []) };

  beforeEach(() => {
    made = [];
    save.mockReset();
    save.mockResolvedValue("revision");
    vi.mocked(getAsset).mockReset();
    vi.mocked(getAsset).mockResolvedValue(null);
    vi.mocked(exportProjectFile).mockReset();
    vi.mocked(downloadBlob).mockReset();
    vi.stubGlobal("sessionStorage", fakeStorage());
    vi.stubGlobal("localStorage", fakeStorage());
    error = vi.spyOn(toast, "error").mockReturnValue(0); // the real one needs a window
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop(); // while the storage is still there
    vi.unstubAllGlobals();
    error.mockRestore();
  });

  it("keeps one recovery copy and says so once when the server refuses one edit after another, also after a reload of the tab", async () => {
    const stop = connectLive(fake, refusing);
    await until("live", () => useLiveStatus.getState().status === "live");
    a().updateElements(["a"], { x: 11 });
    await until("the first copy", () => save.mock.calls.length === 1);
    await until("the refused edit to be taken back", () => el("a").x === 0);
    a().updateElements(["a"], { x: 22 });
    await until("the second copy", () => save.mock.calls.length === 2);
    const [first, second] = copies();
    expect(first).toMatchObject({ title: "Together (unsent changes)", trashedAt: null });
    expect(first.id).not.toBe(s().design!.id);
    expect(first.live).toBeUndefined(); // the copy is the person's own: opening it connects to nobody
    expect(xOf(first, "a")).toBe(11);
    expect(second.id).toBe(first.id); // the same copy, as it is now
    expect(xOf(second, "a")).toBe(22);
    expect(told()).toEqual(["The server refused an edit: This shared design exceeds the room size limit. A recovery copy is in Projects."]);

    // the tab is loaded again: what it keeps for a reload says which copy is this design's
    stop();
    stops.push(connectLive(fake, refusing));
    await until("live again", () => useLiveStatus.getState().status === "live");
    a().updateElements(["a"], { x: 33 });
    await until("the third copy", () => save.mock.calls.length === 3);
    expect(copies()[2].id).toBe(first.id);
  });

  it("offers the copy as it was last as a download, once, when the library cannot keep it", async () => {
    save.mockRejectedValue(new Error("the disk is full"));
    vi.mocked(exportProjectFile).mockResolvedValue(new Blob(["file"]));
    stops.push(connectLive(fake, refusing));
    await until("live", () => useLiveStatus.getState().status === "live");
    a().updateElements(["a"], { x: 11 });
    await until("the first refusal to be told", () => error.mock.calls.length === 1);
    await until("the refused edit to be taken back", () => el("a").x === 0);
    a().updateElements(["a"], { x: 22 });
    await until("the second copy to fail", () => save.mock.calls.length === 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(error).toHaveBeenCalledTimes(1);
    const [message, options] = error.mock.calls[0];
    expect(message).toBe("The server refused an edit: This shared design exceeds the room size limit. Download a recovery copy.");
    expect(options).toMatchObject({ duration: 0, actionLabel: "Download copy" });
    options!.onAction!();
    await until("the download", () => vi.mocked(downloadBlob).mock.calls.length === 1);
    expect(xOf(vi.mocked(exportProjectFile).mock.calls[0][0], "a")).toBe(22);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/unsent changes/);

    // and says so when even that fails
    vi.mocked(exportProjectFile).mockRejectedValue(new Error("no"));
    options!.onAction!();
    await until("the failure to be told", () => told().includes("Could not download the recovery copy."));
  });

  it("gives up an edit whose image the server will never have, keeps a recovery copy, stays connected and sends the next edit", async () => {
    const link = await shareDesign(address, env);
    // the image is not on this device and the room does not have it either
    const noImages = { ...env, fetch: (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch };
    stops.push(connectLive(link, noImages));
    const editor = person(link);
    await until("both to be live", () => useLiveStatus.getState().status === "live" && editor.status === "live");
    const pic = a().addElement(createImage({ src: "asset:gone", width: 10, height: 10 }));
    await until("the copy", () => save.mock.calls.length === 1);
    expect(copies()[0].pages[0].elements.some((e) => e.id === pic)).toBe(true);
    await until("the image to be taken back", () => !s().design!.pages[0].elements.some((e) => e.id === pic));
    expect(told()).toEqual(["The server refused an edit: An uploaded image is missing. Replace it to sync this design. A recovery copy is in Projects."]);
    expect(useLiveStatus.getState().status).toBe("live");
    a().updateElements(["a"], { x: 77 });
    await until("the next edit to reach the other", () => editor.design?.pages[0].elements[0].x === 77);
    expect(editor.design!.pages[0].elements.some((e) => e.id === pic)).toBe(false);
  });

  it("keeps a recovery copy of the design as it is here, and says so, when it is opened with edits that a tab which is gone never got to the server", async () => {
    const link = await shareDesign(address, env);
    const stop = connectLive(link, env);
    await until("live", () => useLiveStatus.getState().status === "live");
    await server.close();
    await until("this person to notice", () => useLiveStatus.getState().status === "reconnecting");
    a().updateElements(["a"], { x: 99 }); // waits for the server, and is saved with the design on this device
    expect(names(localStorage, "craftly:unsent:")).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();

    // the tab is closed, and the design is opened in another one later: what a tab keeps for a reload is not there
    stop();
    sessionStorage.clear();
    server = createLiveServer({ storage });
    await server.listen(Number(new URL(address).port));
    stops.push(connectLive(link, env));
    expect(save).toHaveBeenCalledTimes(1); // before the server has said anything
    const copy = copies()[0];
    expect(copy).toMatchObject({ title: "Together (unsent changes)", trashedAt: null });
    expect(copy.id).not.toBe(s().design!.id);
    expect(copy.live).toBeUndefined();
    expect(xOf(copy, "a")).toBe(99);
    await until("the server's version to be shown", () => el("a").x === 0);
    expect(told()).toEqual(["This design has changes from an earlier visit that never reached the server. The shared version is shown now. A recovery copy is in Projects."]);
    expect(names(localStorage, "craftly:unsent:")).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  }, 40_000);

  it("makes no copy when the tab that made the edits comes back with them (a reload): they are sent, and the mark goes when the server has them", async () => {
    const link = await shareDesign(address, env);
    const stop = connectLive(link, env);
    await until("live", () => useLiveStatus.getState().status === "live");
    await server.close();
    await until("this person to notice", () => useLiveStatus.getState().status === "reconnecting");
    a().updateElements(["a"], { x: 99 });
    stop();
    server = createLiveServer({ storage });
    await server.listen(Number(new URL(address).port));
    stops.push(connectLive(link, env));
    await until("the edit to reach the server", async () => (await storage.load(link.room))!.design.pages[0].elements[0].x === 99);
    await until("the mark to go", () => names(localStorage, "craftly:unsent:").length === 0);
    expect(save).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(el("a").x).toBe(99);
  }, 40_000);

  it("moves its mark when it goes on under another name, so that the tab it was copied from is not taken for one that is gone", async () => {
    stops.push(connectLive(fake, deaf));
    await until("live", () => useLiveStatus.getState().status === "live");
    a().updateElements(["a"], { x: 5 }); // never confirmed
    const before = names(localStorage, "craftly:unsent:");
    expect(before).toHaveLength(1);
    made[0].readyState = 3;
    made[0].onclose?.({ code: 4000 }); // another tab joined under the same name
    const after = names(localStorage, "craftly:unsent:");
    expect(after).toHaveLength(1);
    expect(after).not.toEqual(before);
    const kept = JSON.parse(sessionStorage.getItem(names(sessionStorage, "craftly:outbox:")[0])!) as { client: string };
    expect(after[0].endsWith(`:${kept.client}`)).toBe(true);
  });

  it("writes its mark again with the next edit when another tab that opened the design has removed it", async () => {
    stops.push(connectLive(fake, deaf));
    await until("live", () => useLiveStatus.getState().status === "live");
    a().updateElements(["a"], { x: 5 }); // never confirmed
    const [mine] = names(localStorage, "craftly:unsent:");
    localStorage.removeItem(mine); // what a second tab does with a mark that is not its own
    a().updateElements(["a"], { x: 6 });
    expect(names(localStorage, "craftly:unsent:")).toEqual([mine]);
  });
});

describe("a server that cannot be trusted (a link can lead to any server)", () => {
  const link = { server: "https://evil.example.test", room: "A".repeat(22), key: "k".repeat(12), role: "edit" as const };
  const open = () => JSON.parse(JSON.stringify(s().design)) as Design;
  const welcome = (design: unknown) => ({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design });
  const withGraphic = (svg: string) => ({ ...open(), pages: [{ ...open().pages[0], elements: [{ id: "g", type: "graphic", svg }] }] });

  it("is not joined when the design it sends carries code, and the person is told in words", async () => {
    await expect(joinDesign(link, { createSocket: () => scripted(() => [welcome(withGraphic('<svg/onload="alert(1)"/>'))]) })).rejects.toThrow(/does not accept/i);
  });

  it("is left at the first operations that carry code: the open design stays as it was and the status says why", async () => {
    const ops = [{ k: "el.set", page: "p", id: "a", set: { x: 99, src: "javascript:alert(1)" } }];
    stops.push(connectLive({ ...link }, { createSocket: () => scripted(() => [welcome(open()), { t: "ops", rev: 1, ops }]) }));
    await until("the connection to be refused", () => useLiveStatus.getState().status === "denied");
    expect(useLiveStatus.getState().reason).toBe("invalid");
    expect(el("a").x).toBe(0);
  });

  it("shows nothing of a design that carries code, and keeps the one that is open", async () => {
    stops.push(connectLive({ ...link }, { createSocket: () => scripted(() => [welcome(withGraphic("<svg><script>alert(1)</script></svg>"))]) }));
    await until("the connection to be refused", () => useLiveStatus.getState().status === "denied");
    expect(s().design!.pages[0].elements.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("is believed when it is honest: the same script without the code shows what it sent", async () => {
    const moved = open();
    moved.pages[0].elements[0] = { ...moved.pages[0].elements[0], x: 123 };
    stops.push(connectLive({ ...link }, { createSocket: () => scripted(() => [welcome(moved)]) }));
    await until("the design to arrive", () => el("a").x === 123);
    expect(useLiveStatus.getState().status).toBe("live");
  });
});

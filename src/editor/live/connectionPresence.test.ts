/**
 * Seeing each other in a shared design, end to end: the real store, the browser's connection, the real server on a port of its
 * own, and another person on a connection of their own. Where one is shows up for the other, and nothing of it stays behind when
 * a connection ends.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import type { PresenceHeard, PresenceState } from "@/collab/presence";
import { createDesign, createPage, createShape, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, LiveLink } from "@/core/types";
import { createLiveServer, type LiveServer } from "@/server/live";
import { MemoryStorage } from "@/server/storage";
import { connectLive, shareDesign, useLiveStatus } from "./connection";
import { websocketUrl } from "./links";
import { clearPresence, colorOf, saveName, setPointer, usePresence } from "./presence";

const env = { createSocket: (url: string) => new WebSocket(url) as unknown as SocketLike };
const a = () => useEditor.getState().actions;

const design = (): Design =>
  createDesign({
    title: "Together",
    width: 1000,
    height: 600,
    pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 }), createText({ id: "t", text: "Hello" })] })],
  });

let server: LiveServer;
let address: string;
const stops: Array<() => void> = [];
const others: Live[] = [];

beforeEach(async () => {
  server = createLiveServer({ storage: new MemoryStorage() });
  address = `http://127.0.0.1:${(await server.listen(0)).port}`;
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(design());
  useLiveStatus.setState({ status: "off", reason: null, role: null });
  clearPresence();
  usePresence.setState({ name: "" });
  setPointer(null);
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const live of others.splice(0)) live.stop();
  await server.close();
});

async function until(what: string, check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

/** another person, on a connection of their own, and what they hear of the others */
async function person(link: LiveLink) {
  const heard: PresenceHeard[] = [];
  const live = new Live({ url: websocketUrl(link), key: link.key, createSocket: env.createSocket, onChange: () => undefined, onPresence: (msg) => heard.push(msg) });
  others.push(live);
  live.start();
  await until("the other person to be in", () => live.status === "live");
  const last = () => heard.filter((m): m is Extract<PresenceHeard, { name: string }> => !("gone" in m)).at(-1);
  return { live, heard, last };
}
const here = (over: Partial<PresenceState> = {}): PresenceState => ({ name: "Bo", page: "p", pointer: { x: 30, y: 40 }, selection: ["a"], editing: null, ...over });

async function shared() {
  const link = await shareDesign(address, env);
  stops.push(connectLive(link, env));
  await until("this browser to be in", () => useLiveStatus.getState().status === "live");
  return link;
}

describe("seeing each other", () => {
  it("this person has a number while they are in, and the other person hears their name, their page and what they select", async () => {
    saveName("Ana");
    const link = await shared();
    const me = usePresence.getState().me;
    expect(me).not.toBeNull();
    const bo = await person(link);
    await until("Bo to hear of Ana", () => bo.last() !== undefined);
    expect(bo.last()).toMatchObject({ peer: me, name: "Ana", page: "p", pointer: null, selection: [], editing: null });
    a().select(["a"]);
    setPointer({ x: 12.34, y: 56.78 });
    await until("Bo to hear what Ana selected and where her pointer is", () => bo.last()?.selection.length === 1 && bo.last()?.pointer !== null);
    expect(bo.last()).toMatchObject({ selection: ["a"], pointer: { x: 12.3, y: 56.8 } });
    a().startTextEdit("t");
    await until("Bo to hear that Ana types", () => bo.last()?.editing === "t");
  });

  it("the other person shows up on the list with a colour of their own, as they move, and is off it when they leave", async () => {
    const link = await shared();
    const bo = await person(link);
    bo.live.present(here());
    await until("Bo to be on the list", () => usePresence.getState().people.length === 1);
    const [seen] = usePresence.getState().people;
    expect(seen).toMatchObject({ peer: bo.live.peer, name: "Bo", color: colorOf(bo.live.peer as number), page: "p", pointer: { x: 30, y: 40 }, selection: ["a"] });
    expect(seen.peer).not.toBe(usePresence.getState().me);
    bo.live.present(here({ pointer: { x: 31, y: 41 }, name: "" }));
    await until("Bo to have moved", () => usePresence.getState().people[0]?.pointer?.x === 31);
    expect(usePresence.getState().people[0].name).toBe(`Guest ${bo.live.peer}`);
    bo.live.stop();
    await until("Bo to be off the list", () => usePresence.getState().people.length === 0);
  });

  it("is no part of the design: what the others see of each other is never a step of undo and never a change", async () => {
    const link = await shared();
    const bo = await person(link);
    const before = useEditor.getState().design;
    bo.live.present(here());
    await until("Bo to be on the list", () => usePresence.getState().people.length === 1);
    expect(useEditor.getState().design).toBe(before);
    expect(useEditor.getState().canUndo).toBe(false);
  });

  it("somebody who only looks is seen too, and sees the others", async () => {
    const link = await shared();
    const viewer = await person({ ...link, key: link.viewKey as string, role: "view" });
    viewer.live.present(here({ name: "Vi", selection: ["a"], editing: "t" }));
    await until("the viewer to be on the list", () => usePresence.getState().people.length === 1);
    expect(usePresence.getState().people[0]).toMatchObject({ name: "Vi", pointer: { x: 30, y: 40 }, selection: [], editing: null });
    await until("the viewer to hear of this person", () => viewer.last() !== undefined);
  });

  it("nobody is left on the list, and this person has no number, once the connection is closed", async () => {
    const link = await shared();
    const bo = await person(link);
    bo.live.present(here());
    await until("Bo to be on the list", () => usePresence.getState().people.length === 1);
    stops.splice(0).forEach((stop) => stop());
    expect(usePresence.getState()).toMatchObject({ me: null, people: [] });
    // and Bo is told that this person went
    await until("Bo to hear that this person went", () => bo.heard.some((m) => "gone" in m));
  });

  it("the list is emptied when the connection is lost: who is there is asked anew when it is back", async () => {
    const link = await shared();
    const bo = await person(link);
    bo.live.present(here());
    await until("Bo to be on the list", () => usePresence.getState().people.length === 1);
    await server.close();
    server = createLiveServer({ storage: new MemoryStorage() }); // (something for afterEach to close)
    await until("this browser to notice", () => useLiveStatus.getState().status === "reconnecting");
    expect(usePresence.getState()).toMatchObject({ me: null, people: [] });
  });
});

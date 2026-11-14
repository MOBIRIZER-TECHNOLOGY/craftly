/**
 * Comments in a shared design, end to end: the real store, the browser's connection and the real server on a port of its own, with
 * another person on a connection of their own. What one writes reaches the other; with a server from before comments (one that
 * ignores what a join says it understands) they stay on this person's copy; and somebody else's comment is said once.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import { Room } from "@/collab/room";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, DesignComment, LiveLink } from "@/core/types";
import { createLiveServer, type LiveServer } from "@/server/live";
import { MemoryStorage } from "@/server/storage";
import { useComments } from "../comments/commentsStore";
import { connectLive, joinDesign, shareDesign, useLiveStatus } from "./connection";
import { websocketUrl } from "./links";

const env = { createSocket: (url: string) => new WebSocket(url) as unknown as SocketLike };
const a = () => useEditor.getState().actions;
const ann = { name: "Ann", colorIndex: 1 };
const design = (): Design => createDesign({ title: "Together", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });
const theirs = (id: string): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author: { name: "Bo", colorIndex: 4 },
  createdAt: 1,
  text: `From Bo ${id}`,
  resolved: false,
  replies: [],
});

let server: LiveServer;
let address: string;
const stops: Array<() => void> = [];
const others: Live[] = [];
const join = Room.prototype.join;

beforeEach(async () => {
  server = createLiveServer({ storage: new MemoryStorage() });
  address = `http://127.0.0.1:${(await server.listen(0)).port}`;
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(design());
  useLiveStatus.setState({ status: "off", reason: null, role: null });
  useComments.setState(useComments.getInitialState(), true);
});
afterEach(async () => {
  Room.prototype.join = join;
  for (const stop of stops.splice(0)) stop();
  for (const live of others.splice(0)) live.stop();
  await server.close();
});

async function until(what: string, check: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waited for ${what}`);
}

async function person(link: LiveLink) {
  const live = new Live({ url: websocketUrl(link), key: link.key, createSocket: env.createSocket, features: ["comments"], onChange: () => undefined });
  others.push(live);
  live.start();
  await until("the other person to be in", () => live.status === "live");
  return live;
}

async function shared() {
  const link = await shareDesign(address, env);
  stops.push(connectLive(link, env));
  await until("this browser to be in", () => useLiveStatus.getState().status === "live");
  return link;
}

describe("comments in a shared design", () => {
  it("reach the other person both ways, and somebody else's is said once to a screen reader", async () => {
    const link = await shared();
    expect(useComments.getState().sharing).toBe("shared");
    const bo = await person(link);
    a().addComment({ pageId: "p", anchor: { x: 5, y: 5 }, text: "From Ann", author: ann });
    await until("Bo to have Ann's comment", () => (bo.design?.comments ?? []).some((c) => c.text === "From Ann"));
    const base = bo.design!;
    bo.edit(base, { ...base, comments: [...(base.comments ?? []), theirs("c_bo")] });
    await until("Ann to have Bo's comment", () => (useEditor.getState().design!.comments ?? []).some((c) => c.id === "c_bo"));
    expect(useComments.getState().announcement.text).toBe("New comment from Bo: From Bo c_bo");
    expect(useEditor.getState().canUndo).toBe(false);
  });

  it("are in the copy kept by somebody who joins with a link", async () => {
    a().addComment({ pageId: "p", anchor: { x: 5, y: 5 }, text: "Made before sharing", author: ann });
    const link = await shareDesign(address, env);
    const { design: joined } = await joinDesign({ ...link }, env);
    expect(joined.comments!.map((c) => c.text)).toEqual(["Made before sharing"]);
  });

  it("stay on this person's copy with a server from before comments, which the panel is told, and are no longer so after", async () => {
    // a server from before comments: its rooms take no notice of what a join says it understands
    Room.prototype.join = function (this: Room, peer, client, role) {
      return join.call(this, peer, client, role);
    };
    const link = await shared();
    expect(useComments.getState().sharing).toBe("unsupported");
    const bo = await person(link);
    a().addComment({ pageId: "p", anchor: { x: 5, y: 5 }, text: "Only mine", author: ann });
    a().updateElements(["a"], { x: 77 });
    await until("Bo to have the move", () => bo.design?.pages[0].elements[0].x === 77);
    expect(bo.design!.comments ?? []).toEqual([]);
    expect(useEditor.getState().design!.comments!.map((c) => c.text)).toEqual(["Only mine"]);
    stops.pop()!();
    expect(useComments.getState().sharing).toBe("local");
  });
});

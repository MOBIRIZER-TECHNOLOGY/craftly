/**
 * The review and the commenter's seat in a shared design, end to end (docs/REVIEW.md): the real store, the browser's connection
 * and the real server on a port of its own, with another person on a connection of their own. The review reaches the other; a
 * seat that may only comment is read-only and comments; an approval that came after an edit it had not seen is refused in words,
 * without a recovery copy; and a server from before reviews shares none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { Live, type SocketLike } from "@/collab/live";
import { Room } from "@/collab/room";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, LiveLink } from "@/core/types";
import { createLiveServer, type LiveServer } from "@/server/live";
import { MemoryStorage } from "@/server/storage";
import { toast } from "@/ui";
import { myAuthor, useComments } from "../comments/commentsStore";
import { connectLive, shareDesign, useLiveStatus } from "./connection";
import { websocketUrl } from "./links";

const env = { createSocket: (url: string) => new WebSocket(url) as unknown as SocketLike };
const a = () => useEditor.getState().actions;
const design = (): Design => createDesign({ title: "Together", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });

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
  vi.restoreAllMocks();
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
  const live = new Live({ url: websocketUrl(link), key: link.key, createSocket: env.createSocket, features: ["comments", "review"], onChange: () => undefined });
  others.push(live);
  live.start();
  await until("the other person to be in", () => live.status === "live");
  return live;
}

describe("the review in a shared design", () => {
  it("is shared with a server that shares it, and reaches the other person", async () => {
    const link = await shareDesign(address, env);
    stops.push(connectLive(link, env));
    await until("this browser to be in", () => useLiveStatus.getState().status === "live");
    expect(useComments.getState()).toMatchObject({ reviews: true, commenting: false, account: null });
    const bo = await person(link);
    expect(a().setReview("requested", myAuthor())).toBe(true);
    await until("Bo to have the review", () => bo.design?.review?.state === "requested");
    // leaving the room forgets what it said
    stops.pop()!();
    expect(useComments.getState()).toMatchObject({ reviews: false, commenting: false, account: null, sharing: "local" });
  });

  it("is not shared with a server from before reviews", async () => {
    const link = await shareDesign(address, env);
    Room.prototype.join = function (peer, client, role, features, name, account) {
      return join.call(this, peer, client, role, features ? { comments: features.comments } : undefined, name, account);
    };
    stops.push(connectLive(link, env));
    await until("this browser to be in", () => useLiveStatus.getState().status === "live");
    expect(useComments.getState().reviews).toBe(false);
  });
});

describe("a seat that may only comment", () => {
  it("is read-only, comments, and is told in words when an approval came after an edit it had not seen", async () => {
    const link = await shareDesign(address, env);
    const bo = await person(link);
    // this browser is let in as a commenter would be (a team's room gives the role; a link's key edits or looks)
    Room.prototype.join = function (peer, client, _role, features, name, account) {
      return join.call(this, peer, client, "comment", features, name, account);
    };
    // what this browser hears can be held back, so that it approves before it hears of somebody else's edit
    let holding = false;
    const held: Array<() => void> = [];
    const holdingEnv = {
      createSocket: (url: string) => {
        const ws = new WebSocket(url) as unknown as SocketLike;
        return new Proxy(ws, {
          get: (target, key) => {
            const value = Reflect.get(target, key) as unknown;
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
          set: (target, key, value) => {
            if (key !== "onmessage" || typeof value !== "function") return Reflect.set(target, key, value);
            const hear = value as (e: { data: unknown }) => void;
            target.onmessage = (e) => (holding ? held.push(() => hear(e)) : hear(e));
            return true;
          },
        });
      },
    };
    stops.push(connectLive({ ...link, role: "edit" }, holdingEnv));
    await until("this browser to be in", () => useLiveStatus.getState().status === "live");
    expect(useLiveStatus.getState().role).toBe("comment");
    expect(useEditor.getState().mode).toBe("view");
    expect(useComments.getState().commenting).toBe(true);
    expect(a().addComment({ pageId: "p", anchor: { x: 5, y: 5 }, text: "Looks good", author: myAuthor() })).not.toBe("");
    await until("Bo to have the comment", () => (bo.design?.comments ?? []).some((c) => c.text === "Looks good"));

    const error = vi.spyOn(toast, "error").mockReturnValue(0);
    // Bo moves the shape; this browser approves before it hears of it
    const base = bo.design!;
    const el = base.pages[0].elements[0];
    holding = true;
    bo.edit(base, { ...base, pages: [{ ...base.pages[0], elements: [{ ...el, x: el.x + 40 }] }] });
    await until("Bo's edit to be confirmed", () => bo.session.pending === 0);
    Room.prototype.join = join;
    a().setReview("approved", myAuthor());
    holding = false;
    for (const hear of held.splice(0)) hear();
    await until("the refusal to be said", () => error.mock.calls.length > 0);
    expect(error.mock.calls[0][0]).toMatch(/^The design changed just before that reached the server/);
    expect(bo.design?.review).toBeUndefined();
  });
});

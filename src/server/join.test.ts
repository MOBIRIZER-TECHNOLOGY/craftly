/**
 * What each person joining a room is sent: the design as it is, written as text once for everybody who joins between two edits,
 * and written again after an edit. With comments and without, as each browser asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { COMMENTS } from "@/collab/protocol";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { createLiveServer, type LiveServer } from "./live";
import { MemoryStorage } from "./storage";

const servers: LiveServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const server of servers.splice(0)) await server.close();
});

const design = (elements: number): Design => ({
  ...createDesign({
    title: "Joined",
    width: 800,
    height: 600,
    pages: [createPage({ id: "p", elements: Array.from({ length: elements }, (_, i) => createShape("rect", { id: `e${i}`, name: "n".repeat(100) })) })],
  }),
  comments: [{ id: "c1", pageId: "p", anchor: { x: 1, y: 1 }, author: { name: "Ann", colorIndex: 1 }, createdAt: 1, text: "a note", resolved: false, replies: [] }],
});

async function boot(elements = 3) {
  const server = createLiveServer({ storage: new MemoryStorage() });
  servers.push(server);
  const { port } = await server.listen(0);
  const res = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST", body: JSON.stringify({ design: design(elements) }) });
  const made = (await res.json()) as { room: string; editKey: string };
  return { url: `ws://127.0.0.1:${port}/ws?room=${made.room}`, key: made.editKey };
}

/** Joins and gives the welcome as it came, its text and what it says, and a way to send a batch. */
async function join(b: { url: string; key: string }, client: string, comments: boolean) {
  const ws = new WebSocket(b.url);
  sockets.push(ws);
  const texts: string[] = [];
  ws.on("message", (d) => texts.push(d.toString()));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.send(JSON.stringify({ t: "join", client, key: b.key, ...(comments ? { features: [COMMENTS] } : {}) }));
  const end = Date.now() + 10_000;
  while (!texts.some((t) => t.startsWith('{"t":"welcome"')) && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  const text = texts.find((t) => t.startsWith('{"t":"welcome"'))!;
  const acked = async (seq: number) => {
    while (!texts.some((t) => t.includes('"t":"ack"') && t.includes(`"seq":${seq}`)) && Date.now() < end + 10_000) await new Promise((r) => setTimeout(r, 10));
  };
  return { text, msg: JSON.parse(text) as { rev: number; design: Design; features?: string[] }, ws, acked };
}

const designPart = (text: string) => text.slice(text.indexOf('"design":'));

describe("what a join is sent", () => {
  it("is the design as it is, with its comments for a browser that understands them and without for one that does not", async () => {
    const b = await boot();
    const knows = await join(b, "ann", true);
    const old = await join(b, "bob", false);
    expect(knows.msg).toMatchObject({ t: "welcome", rev: 0, features: [COMMENTS] });
    expect(knows.msg.design.comments).toHaveLength(1);
    expect(knows.msg.design.pages[0].elements).toHaveLength(3);
    expect(old.msg.design.comments ?? []).toHaveLength(0);
    expect(old.msg.design.pages[0].elements).toHaveLength(3);
    expect(old.msg.features).toBeUndefined();
  });

  it("is the same text for everybody between two edits, and the new design after one", async () => {
    const b = await boot();
    const first = await join(b, "ann", true);
    const second = await join(b, "bob", true);
    expect(designPart(second.text)).toBe(designPart(first.text));
    first.ws.send(JSON.stringify({ t: "ops", seq: 1, ops: [{ k: "el.set", page: "p", id: "e1", set: { x: 42 } }] }));
    await first.acked(1);
    const third = await join(b, "cy", true);
    expect(third.msg.rev).toBe(1);
    expect(third.msg.design.pages[0].elements[1].x).toBe(42);
    const fourth = await join(b, "dee", false);
    expect(fourth.msg.design.pages[0].elements[1].x).toBe(42);
    expect(fourth.msg.design.comments ?? []).toHaveLength(0);
  });

  it("writes the design as text once for everybody who joins between two edits", async () => {
    const b = await boot();
    const stringify = vi.spyOn(JSON, "stringify");
    const designsWritten = () => stringify.mock.calls.filter(([v]) => typeof v === "object" && v !== null && "pages" in v).length;
    await join(b, "first", true);
    const afterOne = designsWritten();
    await Promise.all(Array.from({ length: 5 }, (_, i) => join(b, `p${i}`, true)));
    const afterSix = designsWritten();
    stringify.mockRestore();
    // (the first join may write it more than once on its way, as the room is loaded; the five after it write it not at all)
    expect(afterOne).toBeGreaterThan(0);
    expect(afterSix).toBe(afterOne);
  });
});

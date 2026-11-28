/**
 * The work a batch of edits may take on the server (MAX_BATCH_WORK a batch, `workRate` a connection): a batch that would hold
 * the server still is refused whole, with its reason, and changes nothing; the connection stays, and so does everybody else.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMsg } from "@/collab/protocol";
import { TOO_MUCH_WORK } from "@/collab/room";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { createLiveServer, type LiveServer, type LiveServerOptions } from "./live";
import { MemoryStorage } from "./storage";

const N = 20_000;
const big = (): Design =>
  createDesign({
    title: "Big",
    width: 1920,
    height: 1080,
    pages: [createPage({ id: "p", elements: Array.from({ length: N }, (_, i) => createShape("rect", { id: `e${i}`, x: 0, y: 0, width: 1, height: 1 })) })],
  });

const servers: LiveServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const server of servers.splice(0)) await server.close();
});

async function boot(options: Partial<LiveServerOptions> = {}) {
  const storage = new MemoryStorage();
  const server = createLiveServer({ storage, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  const http = `http://127.0.0.1:${port}`;
  const res = await fetch(`${http}/api/rooms`, { method: "POST", body: JSON.stringify({ design: big() }) });
  const made = (await res.json()) as { room: string; editKey: string };
  return { storage, ws: `ws://127.0.0.1:${port}/ws?room=${made.room}`, room: made.room, key: made.editKey };
}

/** A connection that has joined, what it heard, and the answer to a batch of a number. */
async function person(b: Awaited<ReturnType<typeof boot>>, client: string) {
  const ws = new WebSocket(b.ws);
  sockets.push(ws);
  const heard: ServerMsg[] = [];
  ws.on("message", (d) => heard.push(JSON.parse(d.toString()) as ServerMsg));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.send(JSON.stringify({ t: "join", client, key: b.key }));
  await until(() => heard.some((m) => m.t === "welcome"));
  const answer = async (seq: number) => {
    await until(() => heard.some((m) => (m.t === "ack" || m.t === "rejected") && m.seq === seq), 15_000);
    return heard.find((m) => (m.t === "ack" || m.t === "rejected") && m.seq === seq)!;
  };
  return { ws, heard, answer, send: (seq: number, ops: unknown[]) => ws.send(JSON.stringify({ t: "ops", seq, ops })) };
}

async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waited too long");
}

describe("the work a batch of edits may take", () => {
  it("refuses a batch that moves an element back and forth across a big page, changes nothing, and keeps the connection", async () => {
    const b = await boot();
    const ann = await person(b, "ann");
    const bob = await person(b, "bob");
    const moves = Array.from({ length: 2000 }, (_, i) => ({ k: "el.move", page: "p", id: `e${N - 1}`, parent: null, index: i % 2 ? 0 : N }));
    const t = Date.now();
    ann.send(1, moves);
    const said = await ann.answer(1);
    expect(said).toMatchObject({ t: "rejected", reason: TOO_MUCH_WORK });
    // it was stopped at its limit, long before the seconds the whole batch takes
    expect(Date.now() - t).toBeLessThan(1500);
    expect((await b.storage.load(b.room))!.rev).toBe(0);
    // the connection is still there, and an ordinary edit after it goes through, for both of them
    ann.send(2, [{ k: "el.set", page: "p", id: "e1", set: { x: 5 } }]);
    expect(await ann.answer(2)).toMatchObject({ t: "ack" });
    await until(() => bob.heard.some((m) => m.t === "ops"));
    expect(ann.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("applies a whole selection dragged on that page, one change for each element, at once", async () => {
    const b = await boot();
    const ann = await person(b, "ann");
    ann.send(
      1,
      Array.from({ length: 5000 }, (_, i) => ({ k: "el.set", page: "p", id: `e${i * 4}`, set: { x: 10 } })),
    );
    expect(await ann.answer(1)).toMatchObject({ t: "ack" });
  });

  it("refuses the batches of a connection that has used up its allowance, until it has some again", async () => {
    // each addition at the front of the page copies it: about 40,000 units a batch here
    // it gets back 50,000 a second: about one batch's worth, so the batches outrun it unless each took most of a second
    const b = await boot({ workRate: { burst: 200_000, perSecond: 50_000 } });
    const ann = await person(b, "ann");
    const add = (i: number) => [{ k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: `n${i}` }) }];
    const answers: string[] = [];
    for (let seq = 1; seq <= 8; seq++) {
      ann.send(seq, add(seq));
      answers.push((await ann.answer(seq)).t);
    }
    expect(answers.slice(0, 3)).toEqual(["ack", "ack", "ack"]);
    expect(answers).toContain("rejected");
    // two and a half seconds later it has more than a batch's worth again
    await new Promise((r) => setTimeout(r, 2500));
    ann.send(9, add(9));
    expect(await ann.answer(9)).toMatchObject({ t: "ack" });
  }, 30_000);
});

/**
 * Two limits that keep many connections from using the server up: how many one address may have open at once
 * (`maxConnectionsPerAddress`), and how much may wait to be sent to all of them together (`maxTotalBufferedBytes`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createDesign, createPage, createShape } from "@/core/factory";
import { createLiveServer, overBudget, type LiveServer, type LiveServerOptions } from "./live";
import { MemoryStorage } from "./storage";

const servers: LiveServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const server of servers.splice(0)) await server.close();
});

const METRICS_KEY = "metrics-key-for-the-test";

async function boot(options: Partial<LiveServerOptions>, elements = 1) {
  const server = createLiveServer({ storage: new MemoryStorage(), metricsKey: METRICS_KEY, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  const design = createDesign({
    title: "Room",
    width: 800,
    height: 600,
    pages: [createPage({ id: "p", elements: Array.from({ length: elements }, (_, i) => createShape("rect", { id: `e${i}`, name: "x".repeat(200) })) })],
  });
  const res = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST", body: JSON.stringify({ design }) });
  const made = (await res.json()) as { room: string; editKey: string };
  const gauge = async (name: string) => {
    const text = await (await fetch(`http://127.0.0.1:${port}/metrics`, { headers: { authorization: `Bearer ${METRICS_KEY}` } })).text();
    const line = text.split("\n").find((l) => l.startsWith(`craftly_live_${name} `));
    return line ? Number(line.split(" ")[1]) : NaN;
  };
  return { url: `ws://127.0.0.1:${port}/ws?room=${made.room}`, key: made.editKey, gauge };
}

/** Opens a connection: "open" when it was let in, the status when the upgrade was refused. */
function open(url: string): Promise<{ ws: WebSocket; outcome: string }> {
  const ws = new WebSocket(url);
  sockets.push(ws);
  return new Promise((resolve) => {
    ws.on("open", () => resolve({ ws, outcome: "open" }));
    ws.on("unexpected-response", (_req, res) => resolve({ ws, outcome: String(res.statusCode) }));
    ws.on("error", () => undefined);
  });
}

describe("connections from one address", () => {
  it("are let in up to the limit, the next is refused before it is a connection, and a place that is given back can be taken", async () => {
    const b = await boot({ maxConnectionsPerAddress: 2 });
    const first = await open(b.url);
    const second = await open(b.url);
    expect([first.outcome, second.outcome]).toEqual(["open", "open"]);
    expect((await open(b.url)).outcome).toBe("503");
    first.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect((await open(b.url)).outcome).toBe("open");
  });
});

describe("what waits to be sent to all connections together", () => {
  it("is brought under its limit by dropping those with the most waiting, and no more", () => {
    const c = (bufferedAmount: number) => ({ bufferedAmount });
    const [a, b, d, e] = [c(500), c(100), c(300), c(0)];
    expect(overBudget([a, b, d, e], 1000)).toEqual([]);
    expect(overBudget([a, b, d, e], 850)).toEqual([a]);
    expect(overBudget([a, b, d, e], 50)).toEqual([a, d, b]);
    expect(overBudget([e, c(0)], 0)).toEqual([]);
  });

  // On Windows the system takes in everything a socket on the same machine is sent, so nothing waits in the server to be counted;
  // on Linux (CI) the system's buffers fill and the rest waits in the server.
  it.skipIf(process.platform === "win32")("is kept under its limit by dropping the connections that read nothing", async () => {
    // a design of about 9 MB, which each join is sent whole: more than the system's own buffers take in for a socket
    const b = await boot({ maxTotalBufferedBytes: 1024 * 1024, maxBufferedBytes: 64 * 1024 * 1024 }, 30_000);
    const slow: WebSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const { ws } = await open(b.url);
      // reads nothing more from here on, so that what the server sends it waits in the server's memory
      (ws as unknown as { _socket: { pause(): void } })._socket.pause();
      ws.send(JSON.stringify({ t: "join", client: `slow-${i}`, key: b.key }));
      slow.push(ws);
    }
    // those with the most waiting go first, until what waits is under the limit (a paused reader does not hear that it was
    // dropped: the server says it, in its numbers)
    const end = Date.now() + 5000;
    let left = await b.gauge("connections");
    while (left === 4 && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 200));
      left = await b.gauge("connections");
    }
    expect(left).toBeLessThan(4);
    expect(await b.gauge("send_buffer_bytes")).toBeLessThanOrEqual(1024 * 1024);
  });
});

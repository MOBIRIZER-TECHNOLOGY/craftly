/*
 * A load test of the live server: many rooms, several people in each, everybody editing and moving their pointer at once.
 *
 *   node scripts/live-load.mjs http://127.0.0.1:8787 --rooms 100 --peers 5 --duration 120
 *
 * Each room is made from a small design; each person joins with the edit key, adds a shape of their own, then for the rest
 * of the run moves it (one batch of edits every --edit-ms) and says where their pointer is (--presence-hz times a second,
 * as a browser does while the mouse moves). It reports how long the server took to acknowledge an edit (p50, p95, p99,
 * the slowest), the presence messages that went out to the others, and every refusal and close, by reason.
 *
 * The server must let one address make that many rooms and open that many connections: start it with
 * ROOM_CREATE_PER_HOUR=0 and MAX_CONNECTIONS_PER_ADDRESS above rooms x peers (and without ROOM_CREATE_KEY, or pass --create-key). Run it against a test server, never one people use: it makes and removes rooms.
 * The machine that runs this is part of what is measured: on one machine with the server, its own CPU limits it first.
 *
 * Options: --rooms (20), --peers per room (5), --duration in seconds (60), --ramp in seconds over which people arrive (20),
 * --edit-ms between one person's edits (500), --presence-hz (10), --origin, --create-key, --ca (as live-check.mjs).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/live-load.mjs <http(s)://server> [--rooms n] [--peers n] [--duration s] [--ramp s] [--edit-ms ms] [--presence-hz n]");
  process.exit(2);
}
const ca = flag("--ca");
if (ca && process.env.NODE_EXTRA_CA_CERTS !== ca) {
  const again = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } });
  process.exit(again.status ?? 1);
}

const server = base.replace(/\/$/, "");
const ROOMS = Number(flag("--rooms", "20"));
const PEERS = Number(flag("--peers", "5"));
const DURATION = Number(flag("--duration", "60")) * 1000;
const RAMP = Number(flag("--ramp", "20")) * 1000;
const EDIT_MS = Number(flag("--edit-ms", "500"));
const PRESENCE_HZ = Number(flag("--presence-hz", "10"));
const origin = flag("--origin");
const createKey = flag("--create-key");
const headers = (more = {}) => ({ ...(origin ? { origin } : {}), ...more });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const design = (n) => ({
  id: "d-load-" + n,
  title: "Load " + n,
  typeId: "custom",
  width: 1920,
  height: 1080,
  unit: "px",
  pages: [{ id: "p1", background: { type: "solid", color: "#ffffff" }, elements: [] }],
  createdAt: 0,
  updatedAt: 0,
  folderId: null,
  starred: false,
  trashedAt: null,
  version: 1,
});
const shape = (id) => ({
  id,
  x: 10,
  y: 10,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  type: "shape",
  shape: "rect",
  fill: { type: "solid", color: "#0e1318" },
  stroke: null,
  radius: 0,
});

const stats = {
  joined: 0,
  joinFailed: 0,
  edits: 0,
  acks: 0,
  rejected: {},
  denied: {},
  closed: {},
  presenceOut: 0,
  presenceIn: 0,
  opsIn: 0,
  latencies: [],
  errors: {},
};
const bump = (bag, key) => (bag[key] = (bag[key] || 0) + 1);
let stopping = false;

/** One person in a room, for the length of the run. */
async function person(room, key, n) {
  const ws = new WebSocket(server.replace(/^http/, "ws") + "/ws?room=" + encodeURIComponent(room.room), { headers: headers() });
  const sent = new Map();
  let seq = 0;
  let joined = false;
  const id = "el-" + n + "-" + randomBytes(3).toString("hex");
  const timers = [];
  const edit = (ops) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    seq++;
    sent.set(seq, performance.now());
    stats.edits++;
    ws.send(JSON.stringify({ t: "ops", seq, ops }));
  };
  await new Promise((resolve) => {
    ws.on("open", () => ws.send(JSON.stringify({ t: "join", client: "load-" + n + "-" + randomBytes(4).toString("hex"), key })));
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === "welcome") {
        joined = true;
        stats.joined++;
        seq = m.lastSeq;
        edit([{ k: "el.add", page: "p1", parent: null, index: 0, el: shape(id) }]);
        let x = 10;
        timers.push(
          setInterval(() => {
            x = (x + 7) % 1700;
            edit([{ k: "el.set", page: "p1", id, set: { x, y: 10 + (x % 900) } }]);
          }, EDIT_MS),
        );
        if (PRESENCE_HZ > 0)
          timers.push(
            setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN) return;
              stats.presenceOut++;
              ws.send(
                JSON.stringify({ t: "presence", name: "Load " + n, page: "p1", pointer: { x: Math.random() * 1920, y: Math.random() * 1080 }, selection: [id], editing: null }),
              );
            }, 1000 / PRESENCE_HZ),
          );
        resolve();
      } else if (m.t === "ack") {
        const t = sent.get(m.seq);
        if (t !== undefined) {
          stats.latencies.push(performance.now() - t);
          sent.delete(m.seq);
        }
        stats.acks++;
      } else if (m.t === "rejected") bump(stats.rejected, m.reason);
      else if (m.t === "denied") {
        bump(stats.denied, m.reason);
        resolve();
      } else if (m.t === "presence") stats.presenceIn++;
      else if (m.t === "ops") stats.opsIn++;
    });
    ws.on("error", (e) => {
      bump(stats.errors, e.code || e.message.slice(0, 40));
      resolve();
    });
    ws.on("close", (code) => {
      for (const t of timers) clearInterval(t);
      if (!stopping) bump(stats.closed, String(code));
      if (!joined) stats.joinFailed++;
      resolve();
    });
  });
  return () => {
    for (const t of timers) clearInterval(t);
    ws.close();
  };
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);
const ms = (v) => (Number.isFinite(v) ? v.toFixed(1) + " ms" : "-");

console.log(
  `${ROOMS} rooms x ${PEERS} people = ${ROOMS * PEERS} connections; an edit every ${EDIT_MS} ms and ${PRESENCE_HZ} pointer moves a second each; ${DURATION / 1000} s after a ramp of ${RAMP / 1000} s`,
);
const rooms = [];
for (let i = 0; i < ROOMS; i++) {
  const res = await fetch(server + "/api/rooms", {
    method: "POST",
    headers: headers({ "content-type": "application/json", ...(createKey ? { "x-craftly-create-key": createKey } : {}) }),
    body: JSON.stringify({ design: design(i) }),
  });
  if (res.status !== 201) {
    console.error(`making room ${i + 1} was answered ${res.status}: ${(await res.text()).slice(0, 160)} (ROOM_CREATE_PER_HOUR=0 on the server?)`);
    process.exit(1);
  }
  rooms.push(await res.json());
}

const stops = [];
const started = performance.now();
const arrivals = [];
for (let p = 0; p < ROOMS * PEERS; p++) {
  const room = rooms[p % ROOMS];
  const at = (RAMP * p) / (ROOMS * PEERS);
  arrivals.push(
    sleep(at)
      .then(() => person(room, room.editKey, p))
      .then((stop) => stops.push(stop)),
  );
}
await Promise.all(arrivals);
console.log(`ramp done in ${((performance.now() - started) / 1000).toFixed(1)} s: ${stats.joined} joined, ${stats.joinFailed} could not`);
// what was measured during the ramp is dropped: the steady state is what counts
stats.latencies.length = 0;
const steady = { edits: stats.edits, acks: stats.acks, presenceIn: stats.presenceIn, at: performance.now() };
const tick = setInterval(() => {
  const s = [...stats.latencies].sort((a, b) => a - b);
  console.log(`  ${((performance.now() - steady.at) / 1000).toFixed(0)} s: ${stats.acks - steady.acks} acks, p95 ${ms(pct(s, 95))}, closes ${JSON.stringify(stats.closed)}`);
}, 15000);
await sleep(DURATION);
clearInterval(tick);
stopping = true;
const seconds = (performance.now() - steady.at) / 1000;
for (const stop of stops) stop();
await sleep(1000);
for (const r of rooms) await fetch(`${server}/api/rooms/${r.room}`, { method: "DELETE", headers: headers({ "x-craftly-key": r.ownerKey }) }).catch(() => undefined);

const sorted = stats.latencies.sort((a, b) => a - b);
const lost = stats.edits - steady.edits - (stats.acks - steady.acks);
console.log(
  [
    `steady state, ${seconds.toFixed(0)} s:`,
    `  edits sent ${stats.edits - steady.edits} (${((stats.edits - steady.edits) / seconds).toFixed(0)}/s), acknowledged ${stats.acks - steady.acks}, not acknowledged at the end ${lost}`,
    `  time to acknowledge: p50 ${ms(pct(sorted, 50))}, p95 ${ms(pct(sorted, 95))}, p99 ${ms(pct(sorted, 99))}, slowest ${ms(sorted[sorted.length - 1])}`,
    `  pointer moves sent ${stats.presenceOut}, received by the others ${stats.presenceIn - steady.presenceIn} in the steady state`,
    `  refused edits ${JSON.stringify(stats.rejected)}, denied joins ${JSON.stringify(stats.denied)}, closes ${JSON.stringify(stats.closed)}, errors ${JSON.stringify(stats.errors)}`,
  ].join("\n"),
);
process.exitCode = stats.joinFailed || Object.keys(stats.rejected).length || Object.keys(stats.closed).length ? 1 : 0;

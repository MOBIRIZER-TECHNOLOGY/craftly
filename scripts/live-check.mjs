/*
 * Checks a running live server from outside, the way a browser reaches it: through whatever proxy is in front of it.
 *
 *   node scripts/live-check.mjs https://live.example.org --origin https://editor.example.org
 *
 * What it does, in order, and what it leaves behind (nothing: the room it makes is removed at the end):
 *   1. GET /api/health answers 200.
 *   2. POST /api/rooms with a small design answers 201 with a room and its keys, and names the origin in
 *      Access-Control-Allow-Origin (when --origin is given; the server is then expected to list it in ALLOW_ORIGIN).
 *   3. Two WebSocket connections join the room, one with the edit key and one with the view key; an edit from the first is
 *      acknowledged and reaches the second.
 *   4. A clip of --media-mb MiB (random bytes, sent as video/mp4) is uploaded with PUT and read back whole, byte for byte.
 *   5. Both connections stay idle for --idle seconds (70 by default, past nginx's default of 60), then another edit still
 *      goes through: the proxy keeps quiet connections open.
 *   6. DELETE /api/rooms/:id with the owner key removes the room, and the connections are sent away.
 *
 * Options:
 *   --origin <url>       the editor's origin, sent as Origin on every request (default: none, as curl sends)
 *   --create-key <key>   the server's ROOM_CREATE_KEY, if it has one
 *   --ca <file>          a certificate to trust besides the system's (a test proxy with its own authority)
 *   --media-mb <n>       the size of the clip (default 20; 0 skips step 4)
 *   --idle <seconds>     how long to stay idle in step 5 (default 70; 0 skips it)
 * Exit code 0 when every step passed, 1 otherwise; each step prints one line.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/live-check.mjs <https://server> [--origin <url>] [--create-key <key>] [--ca <file>] [--media-mb <n>] [--idle <s>]");
  process.exit(2);
}

// Node reads extra certificates only as it starts: run again with them
const ca = flag("--ca");
if (ca && process.env.NODE_EXTRA_CA_CERTS !== ca) {
  const again = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } });
  process.exit(again.status ?? 1);
}

const server = base.replace(/\/$/, "");
const origin = flag("--origin");
const createKey = flag("--create-key");
const mediaMb = Number(flag("--media-mb", "20"));
const idleS = Number(flag("--idle", "70"));
const headers = (more = {}) => ({ ...(origin ? { origin } : {}), ...more });
const wsUrl = (room) => server.replace(/^http/, "ws") + "/ws?room=" + encodeURIComponent(room);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    const said = await fn();
    console.log(`PASS ${name}  ${said ?? ""} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    return true;
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}  -> ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/** A connection to a room that has joined: its welcome, and a way to wait for the next message of a kind. */
function join(room, key) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(room), { headers: headers() });
    const waiting = [];
    const inbox = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      const i = waiting.findIndex((w) => w.t === msg.t);
      if (i >= 0) waiting.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    const next = (t, ms = 10_000) => {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const w = { t, resolve: (m) => (clearTimeout(timer), res(m)) };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(w), 1);
          rej(new Error(`no "${t}" within ${ms / 1000} s`));
        }, ms);
        waiting.push(w);
      });
    };
    const closed = new Promise((res) => ws.on("close", (code) => res(code)));
    ws.on("error", reject);
    ws.on("unexpected-response", (_req, res) => reject(new Error(`the upgrade was answered ${res.statusCode}`)));
    ws.on("open", async () => {
      ws.send(JSON.stringify({ t: "join", client: "live-check-" + randomBytes(4).toString("hex"), key }));
      const first = await Promise.race([next("welcome"), next("denied")]).catch(reject);
      if (!first) return;
      if (first.t === "denied") return reject(new Error("the join was denied: " + first.reason));
      resolve({ ws, welcome: first, next, closed, send: (m) => ws.send(JSON.stringify(m)) });
    });
  });
}

const design = {
  id: "d-live-check",
  title: "Live check",
  typeId: "custom",
  width: 800,
  height: 600,
  unit: "px",
  pages: [{ id: "p-live-check", background: { type: "solid", color: "#ffffff" }, elements: [] }],
  createdAt: 0,
  updatedAt: 0,
  folderId: null,
  starred: false,
  trashedAt: null,
  version: 1,
};

let room = null;
let editor = null;
let viewer = null;
let seq = 0;
async function edit(title) {
  const n = ++seq;
  editor.send({ t: "ops", seq: n, ops: [{ k: "design", set: { title } }] });
  const ack = await editor.next("ack");
  if (ack.seq !== n) throw new Error(`acknowledged batch ${ack.seq}, sent ${n}`);
  const seen = await viewer.next("ops");
  const got = seen.ops.find((op) => op.k === "design")?.set?.title;
  if (got !== title) throw new Error(`the viewer saw "${got}", not "${title}"`);
  return ack.rev;
}

try {
  await step("health answers 200", async () => {
    const res = await fetch(server + "/api/health", { headers: headers() });
    if (res.status !== 200) throw new Error(`answered ${res.status}`);
    return (await res.text()).slice(0, 60);
  });

  const made = await step("a room is made", async () => {
    const res = await fetch(server + "/api/rooms", {
      method: "POST",
      headers: headers({ "content-type": "application/json", ...(createKey ? { "x-craftly-create-key": createKey } : {}) }),
      body: JSON.stringify({ design }),
    });
    if (res.status !== 201) throw new Error(`answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
    room = await res.json();
    if (origin) {
      const allowed = res.headers.get("access-control-allow-origin");
      if (allowed !== origin && allowed !== "*") throw new Error(`Access-Control-Allow-Origin is ${allowed}, not ${origin}: add it to ALLOW_ORIGIN`);
    }
    return `room ${room.room.slice(0, 6)}…`;
  });
  if (!made) throw new Error("stopped: no room to go on with");

  await step("an editor and a viewer join over WebSocket, and an edit reaches the viewer", async () => {
    editor = await join(room.room, room.editKey);
    viewer = await join(room.room, room.viewKey);
    if (editor.welcome.role !== "edit" || viewer.welcome.role !== "view") throw new Error(`roles ${editor.welcome.role} and ${viewer.welcome.role}`);
    const rev = await edit("Live check, edited");
    return `revision ${rev}`;
  });

  if (mediaMb > 0)
    await step(`a clip of ${mediaMb} MiB goes up and comes back whole`, async () => {
      const bytes = randomBytes(Math.round(mediaMb * 1024 * 1024));
      const sum = createHash("sha256").update(bytes).digest("hex");
      const id = "live-check-" + sum.slice(0, 16);
      const up = await fetch(`${server}/api/rooms/${room.room}/media/${id}`, {
        method: "PUT",
        headers: headers({ "content-type": "video/mp4", "x-craftly-key": room.editKey, "content-length": String(bytes.length) }),
        body: bytes,
      });
      if (up.status !== 201) throw new Error(`the upload was answered ${up.status}: ${(await up.text()).slice(0, 160)}`);
      const down = await fetch(`${server}/api/rooms/${room.room}/media/${id}`, { headers: headers({ "x-craftly-key": room.viewKey }) });
      if (down.status !== 200) throw new Error(`reading it back was answered ${down.status}`);
      const back = Buffer.from(await down.arrayBuffer());
      if (createHash("sha256").update(back).digest("hex") !== sum) throw new Error(`${back.length} bytes came back, not the ${bytes.length} sent`);
      return `${bytes.length} bytes, same sha256`;
    });

  if (idleS > 0)
    await step(`both connections stay open through ${idleS} s of quiet`, async () => {
      await sleep(idleS * 1000);
      if (editor.ws.readyState !== WebSocket.OPEN || viewer.ws.readyState !== WebSocket.OPEN) throw new Error("a connection was closed while idle");
      const rev = await edit("Live check, after the quiet");
      return `edit acknowledged at revision ${rev}`;
    });
} finally {
  if (room)
    await step("the room is removed with the owner key, and its connections are sent away", async () => {
      const res = await fetch(`${server}/api/rooms/${room.room}`, { method: "DELETE", headers: headers({ "x-craftly-key": room.ownerKey }) });
      if (res.status !== 200 && res.status !== 204) throw new Error(`answered ${res.status}`);
      const codes = await Promise.race([Promise.all([editor?.closed, viewer?.closed].filter(Boolean)), sleep(5000).then(() => null)]);
      if (codes === null) throw new Error("a connection was still open 5 s later");
      return `closed with ${[...new Set(codes)].join(", ") || "nothing open"}`;
    });
  for (const c of [editor, viewer]) c?.ws.terminate();
}
console.log(failed ? `${failed} step(s) failed` : "Every step passed.");
process.exitCode = failed ? 1 : 0;

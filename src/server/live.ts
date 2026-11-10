/**
 * The server for shared designs (optional: the editor works without it). It holds one `Room` per shared design, lets people in
 * with a key (one key lets them edit, another only look), keeps what the rooms say to each connection ordered, saves a room a
 * moment after it changes, and refuses what it cannot afford: a message or a body that is too big, a connection that sends too
 * many messages, too many people in a room, too many rooms.
 *
 * HTTP:  POST /api/rooms {design}        makes a room from a design: { room, editKey, viewKey } (the keys are shown once)
 *        DELETE /api/rooms/:id           with the edit key in `x-craftly-key`: stops sharing and sends everyone away
 *        GET /api/health
 * WebSocket: /ws?room=<id>               then a join with the key as the first message, then the rest of src/collab/protocol.ts
 *
 * The keys are random and only their hashes are stored. The room's id is random too: a link with an id and a key is all it takes to
 * get in, so a link is a secret. The key is never in an address, which every server and proxy that it passes writes in a log: a browser
 * shows it in its first message, soon after it has connected, and a connection that does not is sent away.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { diffDesign } from "@/collab/ops";
import { checkOps, MAX_KEY_LENGTH, type ClientMsg, type DeniedReason, type Role, type ServerMsg } from "@/collab/protocol";
import { Room, type Peer } from "@/collab/room";
import type { Design } from "@/core/types";
import { ROOM_ID, type LiveStorage, type RoomRecord } from "./storage";

export interface LiveServerOptions {
  storage: LiveStorage;
  /** The origins that may call the HTTP interface from a page: "*", or a list (the page's own origin). None: no CORS headers. */
  allowOrigin?: string | string[];
  maxRooms?: number;
  maxPeersPerRoom?: number;
  /** The most a message from a browser may be, in bytes. */
  maxMessageBytes?: number;
  /** The most the design that makes a room may be, in bytes. */
  maxDesignBytes?: number;
  /** How long after a change a room is saved. */
  saveDelayMs?: number;
  /** How long a room with nobody in it stays in memory. */
  idleCloseMs?: number;
  /** How long a connection may take to show its key (its first message) before it is sent away. */
  joinWaitMs?: number;
  /** Messages a connection may send: a burst, then so many a second. */
  rate?: { burst: number; perSecond: number };
}

export interface LiveServer {
  readonly http: Server;
  listen(port: number, host?: string): Promise<AddressInfo>;
  /** Saves every room and closes every connection. */
  close(): Promise<void>;
  /** The rooms that are in memory now. */
  rooms(): number;
}

const DEFAULTS = {
  maxRooms: 1000,
  maxPeersPerRoom: 50,
  maxMessageBytes: 4 * 1024 * 1024,
  maxDesignBytes: 16 * 1024 * 1024,
  saveDelayMs: 300,
  idleCloseMs: 60_000,
  joinWaitMs: 10_000,
  rate: { burst: 200, perSecond: 100 },
};

const CLIENT_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const sha256 = (text: string) => createHash("sha256").update(text).digest();
const token = () => randomBytes(16).toString("base64url");
const sameHash = (hex: string, key: string) => {
  const a = Buffer.from(hex, "hex");
  const b = sha256(key);
  return a.length === b.length && timingSafeEqual(a, b);
};

interface Loaded {
  id: string;
  room: Room;
  record: RoomRecord;
  /** Every connection that found the room, whether or not it has shown its key yet. */
  sockets: Set<WebSocket>;
  /** The connections that have shown a key: the people in the room. */
  members: Set<WebSocket>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createLiveServer(options: LiveServerOptions): LiveServer {
  const o = { ...DEFAULTS, ...options, rate: { ...DEFAULTS.rate, ...options.rate } };
  const loaded = new Map<string, Loaded>();
  const loading = new Map<string, Promise<Loaded | null>>();
  const sockets = new Set<WebSocket>();

  /* ---------------- rooms ---------------- */

  const save = async (l: Loaded) => {
    if (l.saveTimer) clearTimeout(l.saveTimer);
    l.saveTimer = null;
    l.record = { ...l.record, design: l.room.design, rev: l.room.rev, seqs: l.room.seqs(), updatedAt: Date.now() };
    await o.storage.save(l.id, l.record);
  };

  const open = (id: string, record: RoomRecord): Loaded => {
    const l: Loaded = { id, room: new Room(record.design, record.rev, record.seqs), record, sockets: new Set(), members: new Set(), saveTimer: null, idleTimer: null };
    l.room.onChange = () => {
      if (!l.saveTimer) l.saveTimer = setTimeout(() => void save(l).catch(() => undefined), o.saveDelayMs);
    };
    loaded.set(id, l);
    return l;
  };

  const find = async (id: string): Promise<Loaded | null> => {
    if (!ROOM_ID.test(id)) return null;
    const have = loaded.get(id);
    if (have) {
      if (have.idleTimer) clearTimeout(have.idleTimer);
      have.idleTimer = null;
      return have;
    }
    const pending = loading.get(id);
    if (pending) return pending;
    const job = (async () => {
      const record = await o.storage.load(id);
      return record ? (loaded.get(id) ?? open(id, record)) : null;
    })().finally(() => loading.delete(id));
    loading.set(id, job);
    return job;
  };

  const unloadLater = (l: Loaded) => {
    if (l.sockets.size || l.idleTimer) return;
    l.idleTimer = setTimeout(() => {
      l.idleTimer = null;
      if (l.sockets.size) return;
      void save(l)
        .catch(() => undefined)
        .then(() => {
          if (!l.sockets.size) loaded.delete(l.id);
        });
    }, o.idleCloseMs);
  };

  /* ---------------- HTTP ---------------- */

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const allow = o.allowOrigin;
    if (!allow) return;
    const origin = req.headers.origin;
    if (allow === "*") res.setHeader("access-control-allow-origin", "*");
    else if (origin && (Array.isArray(allow) ? allow : [allow]).includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-craftly-key");
    res.setHeader("access-control-max-age", "600");
  };

  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };

  /** The body of a request as text, or null when it is longer than allowed (the request is then dropped). */
  const readBody = (req: IncomingMessage, limit: number): Promise<string | null> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit)
          resolve(null); // the rest is read and thrown away until the answer has gone, then the connection is dropped
        else chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => resolve(null));
    });

  const createRoom = async (req: IncomingMessage, res: ServerResponse) => {
    const text = await readBody(req, o.maxDesignBytes);
    if (text === null) {
      res.setHeader("connection", "close");
      reply(res, 413, { error: "the design is too big" });
      res.once("finish", () => req.socket.destroy());
      return;
    }
    let body: { design?: Design };
    try {
      body = JSON.parse(text) as { design?: Design };
    } catch {
      return reply(res, 400, { error: "the body is not JSON" });
    }
    const design = body.design;
    if (!design || typeof design !== "object" || !Array.isArray(design.pages) || design.pages.length < 1 || design.pages.length > 500) {
      return reply(res, 400, { error: "send { design } with at least one page" });
    }
    // a design is acceptable when it could be added, page by page, to an empty one: the same check as for every batch
    const blank = { ...design, pages: [{ id: "-", background: { type: "solid", color: "#ffffff" }, elements: [] }] } as unknown as Design;
    const checked = checkOps(JSON.parse(JSON.stringify(diffDesign(blank, design))));
    if (typeof checked === "string") return reply(res, 400, { error: checked });
    if (typeof design.title !== "string" || typeof design.width !== "number" || typeof design.height !== "number")
      return reply(res, 400, { error: "a design needs a title and a size" });
    if ((await o.storage.count()) >= o.maxRooms) return reply(res, 503, { error: "this server holds as many shared designs as it may" });
    const id = randomBytes(16).toString("base64url");
    const editKey = token();
    const viewKey = token();
    const now = Date.now();
    const shared: Design = { ...design, id, createdAt: now, updatedAt: now, folderId: null, starred: false, trashedAt: null };
    await o.storage.save(id, {
      design: shared,
      rev: 0,
      seqs: {},
      editHash: sha256(editKey).toString("hex"),
      viewHash: sha256(viewKey).toString("hex"),
      createdAt: now,
      updatedAt: now,
    });
    reply(res, 201, { room: id, editKey, viewKey });
  };

  const deleteRoom = async (id: string, req: IncomingMessage, res: ServerResponse) => {
    const l = await find(id);
    const key = req.headers["x-craftly-key"];
    if (!l) return reply(res, 404, { error: "no such shared design" });
    if (typeof key !== "string" || !sameHash(l.record.editHash, key)) return reply(res, 403, { error: "only the key that edits can stop sharing" });
    for (const s of l.sockets) {
      send(s, { t: "denied", reason: "not-found" });
      s.close(4004, "gone");
    }
    if (l.saveTimer) clearTimeout(l.saveTimer);
    if (l.idleTimer) clearTimeout(l.idleTimer);
    loaded.delete(id);
    await o.storage.remove(id);
    reply(res, 200, { ok: true });
  };

  const http = createServer((req, res) => {
    cors(req, res);
    const url = new URL(req.url ?? "/", "http://localhost");
    void (async () => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        return void res.end();
      }
      if (req.method === "GET" && url.pathname === "/api/health") return reply(res, 200, { ok: true, rooms: loaded.size });
      if (req.method === "POST" && url.pathname === "/api/rooms") return await createRoom(req, res);
      const del = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
      if (req.method === "DELETE" && del) return await deleteRoom(del[1], req, res);
      reply(res, 404, { error: "not found" });
    })().catch(() => {
      if (!res.headersSent) reply(res, 500, { error: "something went wrong" });
    });
  });

  /* ---------------- WebSocket ---------------- */

  const wss = new WebSocketServer({ noServer: true, maxPayload: o.maxMessageBytes });
  /** The connection that each joined peer speaks through, to close the old one of a client that has come back. */
  const peerSockets = new WeakMap<Peer, WebSocket>();

  const send = (ws: WebSocket, msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const deny = (ws: WebSocket, reason: DeniedReason) => {
    send(ws, { t: "denied", reason });
    ws.close(4003, reason);
  };

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => void connection(ws, url.searchParams.get("room") ?? ""));
  });

  /** What a key allows in a room: editing, looking, or (null) nothing. A key that is no text, or too long to be one, allows nothing. */
  const roleOf = (l: Loaded, key: unknown): Role | null => {
    if (typeof key !== "string" || key.length > MAX_KEY_LENGTH) return null;
    return sameHash(l.record.editHash, key) ? "edit" : sameHash(l.record.viewHash, key) ? "view" : null;
  };

  const connection = async (ws: WebSocket, roomId: string) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("error", () => undefined);
    // what arrives while the room is being loaded waits here
    const early: RawData[] = [];
    let handle: ((data: RawData) => void) | null = null;
    ws.on("message", (data) => (handle ? handle(data) : early.push(data)));

    let l: Loaded | null;
    try {
      l = await find(roomId);
    } catch {
      l = null; // a room that cannot be read is a room that is not there; the server goes on
    }
    if (ws.readyState !== ws.OPEN) return;
    if (!l) return deny(ws, "not-found");
    // Nothing in the address lets anybody in: the key comes in the first message, a join, soon after the connection is made. Until it has, the
    // connection belongs to the room (which stays in memory for it, and sends it away with everybody else) but is not one of the people in it.
    l.sockets.add(ws);
    const peer: Peer = { send: (msg) => send(ws, msg) };
    const silent = setTimeout(() => deny(ws, "bad-request"), o.joinWaitMs);
    let tokens = o.rate.burst;
    let refilled = Date.now();
    ws.on("close", () => {
      clearTimeout(silent);
      l.room.leave(peer);
      l.sockets.delete(ws);
      l.members.delete(ws);
      unloadLater(l);
    });

    handle = (data) => {
      const now = Date.now();
      tokens = Math.min(o.rate.burst, tokens + ((now - refilled) / 1000) * o.rate.perSecond);
      refilled = now;
      if (--tokens < 0) return void ws.close(1008, "slow down");
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "join") {
        const role = roleOf(l, msg.key);
        if (!role) return void deny(ws, "no-access");
        if (typeof msg.client !== "string" || !CLIENT_NAME.test(msg.client)) return void deny(ws, "bad-request");
        if (!l.members.has(ws)) {
          if (l.members.size >= o.maxPeersPerRoom) return void deny(ws, "server-full");
          l.members.add(ws);
          clearTimeout(silent);
        }
        for (const old of l.room.join(peer, msg.client, role)) {
          const other = peerSockets.get(old);
          if (other && other !== ws) other.close(4000, "replaced");
        }
        peerSockets.set(peer, ws);
      } else l.room.receive(peer, msg); // a connection that has not joined is not in the room, which ignores it and answers it nothing
    };
    for (const data of early.splice(0)) handle(data);
  };

  // a connection that stopped answering is dropped (the browser's own pings keep a live one busy as well)
  const answered = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (answered.get(ws) === false) ws.terminate();
      else {
        answered.set(ws, false);
        ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();
  wss.on("connection", (ws) => ws.on("pong", () => answered.set(ws, true)));

  return {
    http,
    listen: (port, host = "127.0.0.1") =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => resolve(http.address() as AddressInfo));
      }),
    async close() {
      clearInterval(heartbeat);
      for (const l of loaded.values()) {
        if (l.idleTimer) clearTimeout(l.idleTimer);
        await save(l).catch(() => undefined);
      }
      for (const ws of sockets) ws.close(1001, "the server is going away");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    rooms: () => loaded.size,
  };
}

/**
 * The server for shared designs (optional: the editor works without it). It holds one `Room` per shared design, lets people in
 * with a key (one key lets them edit, another only look), keeps what the rooms say to each connection ordered, saves a room
 * before acknowledging a change, and refuses what it cannot afford: a message or a body that is too big, a connection that sends too
 * many messages or too many bytes, or asks for the design too often, or does not read what it is sent; too many people in a room or
 * waiting at its door, too many connections, too many rooms.
 *
 * HTTP:  POST /api/rooms {design}        makes a room from a design: { room, editKey, viewKey, ownerKey } (the keys are shown once)
 *        DELETE /api/rooms/:id           with the owner key in `x-craftly-key`: stops sharing and sends everyone away
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
import { checkDesign, MAX_KEY_LENGTH, type ClientMsg, type DeniedReason, type Role, type ServerMsg } from "@/collab/protocol";
import { Room, type Peer } from "@/collab/room";
import type { Design } from "@/core/types";
import { ROOM_ID, type LiveStorage, type RoomRecord, type SharedAsset } from "./storage";

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
  /** How long a room with nobody in it stays in memory. */
  idleCloseMs?: number;
  /** How long a connection may take to show its key (its first message) before it is sent away. */
  joinWaitMs?: number;
  /** How often every connection is pinged; one that has not answered by the next round is dropped. */
  heartbeatMs?: number;
  /** Messages a connection may send: a burst, then so many a second. */
  rate?: { burst: number; perSecond: number };
  /** Bytes a connection may send, beside the count of its messages: a burst, then so many a second. */
  byteRate?: { burst?: number; perSecond?: number };
  /** How often a connection may join, each of which sends it the whole design: a burst, then so many a second. */
  joinRate?: { burst?: number; perSecond?: number };
  /** The most a message may be before the connection has shown its key, in bytes; a join is tiny. A bigger one is not read. */
  maxUnjoinedMessageBytes?: number;
  /** The most that may wait to be sent to one connection, in bytes: one that reads slower than that is dropped. Twice `maxDesignBytes` unless set. */
  maxBufferedBytes?: number;
  /** The most connections at one time, to all rooms together. */
  maxConnections?: number;
  /** The most connections to one room that have not shown their key yet. */
  maxWaitingPerRoom?: number;
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
  idleCloseMs: 60_000,
  joinWaitMs: 10_000,
  heartbeatMs: 30_000,
  rate: { burst: 200, perSecond: 100 },
  byteRate: { burst: 8 * 1024 * 1024, perSecond: 1024 * 1024 },
  joinRate: { burst: 4, perSecond: 0.5 },
  maxUnjoinedMessageBytes: 8 * 1024,
  maxConnections: 5000,
  maxWaitingPerRoom: 20,
};

/** A burst and a rate, with what was not given (or given as undefined, as a setting that is not set is) taken from the default. */
const bucket = (given: { burst?: number; perSecond?: number } | undefined, standard: { burst: number; perSecond: number }) => ({
  burst: given?.burst ?? standard.burst,
  perSecond: given?.perSecond ?? standard.perSecond,
});

const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;
const ASSET_LIMIT = 12 * 1024 * 1024; // base64 for up to 9 MiB
const ROOM_ASSET_LIMIT = 48 * 1024 * 1024;

const CLIENT_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const sha256 = (text: string) => createHash("sha256").update(text).digest();
const token = () => randomBytes(16).toString("base64url");
/** The size of a message in bytes: `ws` hands every message over as one Buffer (its `binaryType` is left as it comes, "nodebuffer"). */
const sizeOf = (data: RawData) => (data as Buffer).length;
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
  /**
   * How many HTTP requests are at work on the room now. Such a request keeps this object over a wait (the body of an upload may
   * take minutes to arrive), so the room stays in memory until it is done: were it to leave and be read again meanwhile, the request
   * would go on with a copy that is no longer the room, and save it over what happened since.
   */
  pins: number;
  work: Promise<void>;
  removed: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createLiveServer(options: LiveServerOptions): LiveServer {
  const o = {
    ...options,
    maxRooms: options.maxRooms ?? DEFAULTS.maxRooms,
    maxPeersPerRoom: options.maxPeersPerRoom ?? DEFAULTS.maxPeersPerRoom,
    maxMessageBytes: options.maxMessageBytes ?? DEFAULTS.maxMessageBytes,
    maxDesignBytes: options.maxDesignBytes ?? DEFAULTS.maxDesignBytes,
    idleCloseMs: options.idleCloseMs ?? DEFAULTS.idleCloseMs,
    joinWaitMs: options.joinWaitMs ?? DEFAULTS.joinWaitMs,
    heartbeatMs: options.heartbeatMs ?? DEFAULTS.heartbeatMs,
    rate: { ...DEFAULTS.rate, ...options.rate },
    byteRate: bucket(options.byteRate, DEFAULTS.byteRate),
    joinRate: bucket(options.joinRate, DEFAULTS.joinRate),
    maxUnjoinedMessageBytes: options.maxUnjoinedMessageBytes ?? DEFAULTS.maxUnjoinedMessageBytes,
    maxBufferedBytes: options.maxBufferedBytes ?? 2 * (options.maxDesignBytes ?? DEFAULTS.maxDesignBytes),
    maxConnections: options.maxConnections ?? DEFAULTS.maxConnections,
    maxWaitingPerRoom: options.maxWaitingPerRoom ?? DEFAULTS.maxWaitingPerRoom,
  };
  const loaded = new Map<string, Loaded>();
  const loading = new Map<string, Promise<Loaded | null>>();
  const sockets = new Set<WebSocket>();

  let roomCreation = Promise.resolve();
  let closing = false;

  /* ---------------- rooms ---------------- */

  const enqueue = (l: Loaded, work: () => void | Promise<void>) => {
    const next = l.work.then(work);
    l.work = next.catch(() => undefined);
    return next;
  };

  const open = (id: string, record: RoomRecord): Loaded => {
    const l: Loaded = {
      id,
      room: new Room(record.design, record.rev, record.seqs),
      record,
      sockets: new Set(),
      members: new Set(),
      pins: 0,
      work: Promise.resolve(),
      removed: false,
      idleTimer: null,
    };
    l.room.commit = async (design, rev, seqs) => {
      if (Buffer.byteLength(JSON.stringify(design)) > o.maxDesignBytes) throw new Error("This shared design exceeds the room size limit.");
      const next = { ...l.record, design, rev, seqs, updatedAt: Date.now() };
      await o.storage.save(id, next);
      l.record = next;
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
    if (closing || l.removed || l.sockets.size || l.pins || l.idleTimer) return;
    l.idleTimer = setTimeout(() => {
      l.idleTimer = null;
      if (l.sockets.size || l.pins) return;
      void enqueue(l, () => {
        if (!l.sockets.size && !l.pins && loaded.get(l.id) === l) loaded.delete(l.id);
      });
    }, o.idleCloseMs);
  };

  /** Runs what an HTTP request does with a room, which stays in memory for as long as that takes and may leave it afterwards. */
  const pinned = async (l: Loaded, work: () => Promise<void>) => {
    l.pins++;
    try {
      await work();
    } finally {
      l.pins--;
      unloadLater(l);
    }
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
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
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
    const design = body?.design;
    if (!design || typeof design !== "object" || !Array.isArray(design.pages) || design.pages.length < 1 || design.pages.length > 500) {
      return reply(res, 400, { error: "send { design } with at least one page" });
    }
    // A design is acceptable when a browser would accept it as a welcome: the same check of everything in it as for a batch, but not
    // the limit of what one batch may carry, which a design that many batches built up can exceed. Its size in bytes bounds it.
    const problem = checkDesign(design);
    if (problem) return reply(res, 400, { error: problem });
    const previous = roomCreation;
    let release!: () => void;
    roomCreation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (closing || (await o.storage.count()) >= o.maxRooms) return reply(res, 503, { error: "this server holds as many shared designs as it may" });
      const id = randomBytes(16).toString("base64url");
      const editKey = token();
      const viewKey = token();
      const ownerKey = token();
      const { live: _live, ...content } = design;
      const now = Date.now();
      const shared: Design = { ...content, id, createdAt: now, updatedAt: now, folderId: null, starred: false, trashedAt: null };
      await o.storage.save(id, {
        design: shared,
        rev: 0,
        seqs: {},
        editHash: sha256(editKey).toString("hex"),
        viewHash: sha256(viewKey).toString("hex"),
        ownerHash: sha256(ownerKey).toString("hex"),
        createdAt: now,
        updatedAt: now,
      });
      reply(res, 201, { room: id, editKey, viewKey, ownerKey });
    } finally {
      release();
    }
  };

  const deleteRoom = async (id: string, req: IncomingMessage, res: ServerResponse) => {
    const l = await find(id);
    const key = req.headers["x-craftly-key"];
    if (!l) return reply(res, 404, { error: "no such shared design" });
    if (typeof key !== "string" || !l.record.ownerHash || !sameHash(l.record.ownerHash, key)) {
      unloadLater(l);
      return reply(res, 403, { error: "only the owner can stop sharing" });
    }
    await enqueue(l, async () => {
      if (l.removed) return reply(res, 404, { error: "no such shared design" });
      await o.storage.remove(id);
      l.removed = true;
      if (l.idleTimer) clearTimeout(l.idleTimer);
      loaded.delete(id);
      for (const s of l.sockets) {
        send(s, { t: "denied", reason: "not-found" });
        s.close(4004, "gone");
      }
      reply(res, 200, { ok: true });
    });
  };

  const roomAsset = async (id: string, assetId: string, req: IncomingMessage, res: ServerResponse) => {
    const l = await find(id);
    if (!l || l.removed) return reply(res, 404, { error: "no such shared design" });
    await pinned(l, () => roomAssetIn(l, assetId, req, res));
  };

  const roomAssetIn = async (l: Loaded, assetId: string, req: IncomingMessage, res: ServerResponse) => {
    const id = l.id;
    const role = roleOf(l, req.headers["x-craftly-key"]);
    if (!role || (req.method === "PUT" && role !== "edit")) return reply(res, 403, { error: "this link cannot access the requested image" });
    if (!ASSET_ID.test(assetId)) return reply(res, 400, { error: "invalid image id" });
    const existing = () => (l.record.assets && Object.hasOwn(l.record.assets, assetId) ? l.record.assets[assetId] : undefined);
    if (req.method === "GET") {
      const asset = existing();
      return asset ? reply(res, 200, asset) : reply(res, 404, { error: "no such shared image" });
    }
    const body = await readBody(req, ASSET_LIMIT + 100);
    if (body === null) return reply(res, 413, { error: "this shared image is too large" });
    let asset: Partial<SharedAsset> | null;
    try {
      asset = JSON.parse(body) as Partial<SharedAsset> | null;
    } catch {
      return reply(res, 400, { error: "invalid image data" });
    }
    const mime = asset?.mime;
    const base64 = asset?.base64;
    if (
      typeof mime !== "string" ||
      !IMAGE_TYPE.test(mime) ||
      typeof base64 !== "string" ||
      !base64 ||
      base64.length > ASSET_LIMIT ||
      base64.length % 4 ||
      /[^A-Za-z0-9+/=]/.test(base64) ||
      Buffer.from(base64, "base64").toString("base64") !== base64
    ) {
      return reply(res, 400, { error: "invalid image data or format" });
    }
    await enqueue(l, async () => {
      // The body may have taken minutes. Only the room that is in memory now may be saved: not one that was stopped meanwhile, and
      // not a copy that memory let go of (which being pinned rules out; it is asked all the same, because saving such a copy would
      // undo every edit since, and bring a deleted room back with its keys).
      if (l.removed || loaded.get(id) !== l) return reply(res, 404, { error: "no such shared design" });
      const have = existing();
      if (have) return have.mime === mime && have.base64 === base64 ? reply(res, 200, { ok: true }) : reply(res, 409, { error: "image id already in use" });
      const size = Object.values(l.record.assets ?? {}).reduce((sum, image) => sum + image.base64.length, base64.length);
      if (size > ROOM_ASSET_LIMIT) return reply(res, 413, { error: "this room has reached its image storage limit" });
      const next = { ...l.record, assets: { ...l.record.assets, [assetId]: { mime, base64 } } };
      await o.storage.save(id, next);
      l.record = next;
      reply(res, 201, { ok: true });
    });
  };

  const target = (req: IncomingMessage): URL | null => {
    const raw = req.url ?? "";
    if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
    try {
      return new URL(raw, "http://localhost");
    } catch {
      return null;
    }
  };

  const http = createServer((req, res) => {
    cors(req, res);
    const url = target(req);
    if (!url) return reply(res, 400, { error: "invalid request target" });
    void (async () => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        return void res.end();
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        try {
          await o.storage.checkWritable();
          return reply(res, 200, { ok: true, rooms: loaded.size });
        } catch {
          return reply(res, 503, { ok: false, error: "room storage is unavailable" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/rooms") return await createRoom(req, res);
      const asset = /^\/api\/rooms\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
      if (asset && (req.method === "GET" || req.method === "PUT")) return await roomAsset(asset[1], asset[2], req, res);
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
  /** Whether each connection has answered the last ping of the heartbeat (nothing yet: it has not been pinged). */
  const answered = new WeakMap<WebSocket, boolean>();

  const send = (ws: WebSocket, msg: ServerMsg) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(msg));
    // What a connection does not read waits here, in memory, and a connection that reads nothing would have it grow for as long as
    // the room has something to say. Past the limit it is dropped at once (a polite close would wait behind everything else that
    // waits); a browser that was only slow comes back by itself and is sent the design as it is then.
    if (ws.bufferedAmount > o.maxBufferedBytes) ws.terminate();
  };
  const deny = (ws: WebSocket, reason: DeniedReason) => {
    send(ws, { t: "denied", reason });
    ws.close(4003, reason);
  };

  http.on("upgrade", (req, socket, head) => {
    const url = target(req);
    if (!url || url.pathname !== "/ws" || closing) {
      socket.destroy();
      return;
    }
    if (sockets.size >= o.maxConnections) {
      // refused before it is a connection; a browser sees a connection that failed and tries again later
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
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
    // the answer to a ping of the heartbeat below (asked for here: an upgrade handled by hand never reaches the "connection" event of `wss`)
    ws.on("pong", () => answered.set(ws, true));
    // what arrives while the room is being loaded waits here
    const early: RawData[] = [];
    let handle: ((data: RawData) => void) | null = null;
    let shownKey = false;
    ws.on("message", (data) => {
      // Until the key has been shown the only message with a use is a join, which is tiny. Anything bigger is not read: parsing
      // megabytes for whoever asks is work that a stranger could have the server do.
      if (!shownKey && sizeOf(data) > o.maxUnjoinedMessageBytes) return void ws.close(1009, "too big before the key");
      if (handle) handle(data);
      else early.push(data);
    });

    let l: Loaded | null;
    try {
      l = await find(roomId);
    } catch {
      l = null; // a room that cannot be read is a room that is not there; the server goes on
    }
    if (ws.readyState !== ws.OPEN) {
      // it went away while the room was being read: nobody is left to send the room out of memory on leaving, so that is asked for here
      if (l) unloadLater(l);
      return;
    }
    if (!l || l.removed) return deny(ws, "not-found");
    // Nothing in the address lets anybody in: the key comes in the first message, a join, soon after the connection is made. Until it has, the
    // connection belongs to the room (which stays in memory for it, and sends it away with everybody else) but is not one of the people in it.
    // Only so many may stand at the door of one room. This one is not turned away for good (a browser takes `denied` as final): it is
    // asked to come back, and it does by itself, with waits that grow.
    if (l.sockets.size - l.members.size >= o.maxWaitingPerRoom) return void ws.close(1013, "try again later");
    l.sockets.add(ws);
    const peer: Peer = { send: (msg) => send(ws, msg) };
    const silent = setTimeout(() => deny(ws, "bad-request"), o.joinWaitMs);
    let tokens = o.rate.burst;
    let bytes = o.byteRate.burst;
    let joins = o.joinRate.burst;
    let refilled = Date.now();
    ws.on("close", () => {
      clearTimeout(silent);
      l.room.leave(peer);
      l.sockets.delete(ws);
      l.members.delete(ws);
      unloadLater(l);
    });

    handle = (data) => {
      if (l.removed || closing || ws.readyState !== ws.OPEN) return;
      const now = Date.now();
      const seconds = (now - refilled) / 1000;
      tokens = Math.min(o.rate.burst, tokens + seconds * o.rate.perSecond);
      bytes = Math.min(o.byteRate.burst, bytes + seconds * o.byteRate.perSecond) - sizeOf(data);
      joins = Math.min(o.joinRate.burst, joins + seconds * o.joinRate.perSecond);
      refilled = now;
      if (--tokens < 0 || bytes < 0) return void ws.close(1008, "slow down");
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "join") {
        // every join is answered with the whole design, megabytes of it for a few bytes, so it has a small allowance of its own
        if (--joins < 0) return void ws.close(1008, "slow down");
        const role = roleOf(l, msg.key);
        if (!role) return void deny(ws, "no-access");
        if (typeof msg.client !== "string" || !CLIENT_NAME.test(msg.client)) return void deny(ws, "bad-request");
        if (!l.members.has(ws)) {
          if (l.members.size >= o.maxPeersPerRoom) return void deny(ws, "server-full");
          l.members.add(ws);
          shownKey = true;
          clearTimeout(silent);
        }
        for (const old of l.room.join(peer, msg.client, role)) {
          const other = peerSockets.get(old);
          if (other && other !== ws) other.close(4000, "replaced");
        }
        peerSockets.set(peer, ws);
      } else if (msg.t === "ops" && l.members.has(ws)) {
        void enqueue(l, async () => {
          if (l.removed) return;
          try {
            await l.room.receive(peer, msg);
          } catch (error) {
            console.error("Craftly could not persist a shared edit", error);
            send(ws, { t: "rejected", seq: msg.seq, reason: "The server could not save this edit." });
          }
        });
      } else if (msg.t === "ping") void l.room.receive(peer, msg);
    };
    for (const data of early.splice(0)) handle(data);
  };

  // a connection that stopped answering is dropped (the browser's own pings keep a live one busy as well)
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (answered.get(ws) === false) ws.terminate();
      else {
        answered.set(ws, false);
        ws.ping();
      }
    }
  }, o.heartbeatMs);
  heartbeat.unref();

  return {
    http,
    listen: (port, host = "127.0.0.1") =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => resolve(http.address() as AddressInfo));
      }),
    async close() {
      closing = true;
      clearInterval(heartbeat);
      for (const l of loaded.values()) if (l.idleTimer) clearTimeout(l.idleTimer);
      await Promise.all([roomCreation, ...[...loaded.values()].map((l) => l.work)]);
      for (const ws of sockets) ws.close(1001, "the server is going away");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    rooms: () => loaded.size,
  };
}

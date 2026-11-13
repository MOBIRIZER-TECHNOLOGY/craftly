/**
 * The server for shared designs (optional: the editor works without it). It holds one `Room` per shared design, lets people in
 * with a key (one key lets them edit, another only look), keeps what the rooms say to each connection ordered, saves a room
 * before acknowledging a change, and refuses what it cannot afford: a message or a body that is too big, a connection that sends too
 * many messages or too many bytes, or asks for the design too often, or does not read what it is sent; too many people in a room or
 * waiting at its door, too many connections, too many rooms, too many rooms made from one address in an hour. When it is given a
 * list of origins, it also refuses a page of any other origin that wants to connect or to change something.
 *
 * HTTP:  POST /api/rooms {design}        makes a room from a design: { room, editKey, viewKey, ownerKey } (the keys are shown once)
 *                                        (with `roomCreateKey` set, only for whoever shows that key in `x-craftly-create-key`)
 *        DELETE /api/rooms/:id           with the owner key in `x-craftly-key`: stops sharing and sends everyone away
 *        GET /api/health
 *        GET /metrics                    counters for a scraper, in the text format of Prometheus, and only when the server was given
 *                                        `metricsKey` (shown as `Authorization: Bearer ...`). Never for a page.
 *        GET /api/admin/rooms            for the operator, and only when the server was given `adminKey` (shown in
 *        DELETE /api/admin/rooms/:id     `x-craftly-admin-key`): which rooms there are, and removing one. Never for a page.
 *
 * A room lives until its owner stops sharing, or, when the server is told how long rooms may live (`roomTtlMs`), until nobody has
 * used it for that long: a sweep looks through the storage from time to time and removes such rooms the way "stop sharing" does.
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
import { clientAddress, hourlyLimit } from "./address";
import { createMetrics, METRICS_CONTENT_TYPE, type LabelOf } from "./metrics";
import { ROOM_ID, type LiveStorage, type RoomRecord, type SharedAsset } from "./storage";

export interface LiveServerOptions {
  storage: LiveStorage;
  /**
   * The origins that may call the HTTP interface from a page: "*", or a list (the page's own origin). None: no CORS headers.
   * A list is also a refusal: a request that makes, changes or removes something (POST, PUT, DELETE) and a WebSocket connection
   * are turned away when they name an origin that is not on it. A request that names no origin is not a page and is not refused.
   */
  allowOrigin?: string | string[];
  /**
   * A key that whoever makes a room must show, in the header `x-craftly-create-key` of `POST /api/rooms`. Not set (or empty):
   * anybody who reaches the server may make rooms. It is one shared secret for everybody the operator lets share, not an account;
   * joining a room, editing it and stopping it never ask for it.
   */
  roomCreateKey?: string;
  /**
   * The operator's key. Only with it is there anything under `/api/admin/`: a list of the rooms and the removal of one, for a
   * request that shows the key in the header `x-craftly-admin-key`. Not set (or empty): those addresses answer 404 like any other
   * that does not exist.
   */
  adminKey?: string;
  /**
   * The key of whatever collects the server's numbers. Only with it does `GET /metrics` answer, in the text format of
   * Prometheus, for a request that shows the key as `Authorization: Bearer <key>`. Not set (or empty): 404. The numbers name no
   * room and no person, but they say how much a server is used, and whoever may ask every second is given work to do.
   */
  metricsKey?: string;
  /** How many wrong operator keys one address may show in an hour; after that it is not listened to, also not with the right key. 0 for no limit. */
  wrongKeysPerHour?: number;
  /** How many rooms one address may make in an hour (every attempt counts); 0 for no limit. */
  roomCreatePerHour?: number;
  /**
   * Whether exactly one reverse proxy stands in front of the server. Only then is the address of a visitor taken from the last
   * entry of `X-Forwarded-For` (see `clientAddress`); otherwise the header is never read.
   */
  trustProxy?: boolean;
  /** The time, in milliseconds; a test gives its own clock. */
  now?: () => number;
  /**
   * How long a room may go unused before it is removed, in milliseconds. Not set, or 0: rooms are never removed for their age.
   * A room is used when it is saved (an edit, an image) and when somebody joins it; a room with somebody at it is never removed.
   */
  roomTtlMs?: number;
  /** How often the storage is looked through for rooms that have expired (and once when the server starts to listen). */
  sweepEveryMs?: number;
  /** The most the images of one room may take in the storage, in bytes (they are kept as base64: 48 MiB hold 36 MiB of images). */
  maxRoomAssetBytes?: number;
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
  /** How long an answer about the health of the storage is kept, so that not every `GET /api/health` writes to the disk. */
  healthCacheMs?: number;
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
  healthCacheMs: 5000,
  roomCreatePerHour: 10,
  wrongKeysPerHour: 10,
  sweepEveryMs: 60 * 60 * 1000,
  maxRoomAssetBytes: 48 * 1024 * 1024,
};
const DAY = 24 * 60 * 60 * 1000;
/** The rooms in one answer to the operator: so many unless asked otherwise, and never more than the second. */
const ADMIN_PAGE = 100;
const ADMIN_PAGE_MAX = 500;

/** A burst and a rate, with what was not given (or given as undefined, as a setting that is not set is) taken from the default. */
const bucket = (given: { burst?: number; perSecond?: number } | undefined, standard: { burst: number; perSecond: number }) => ({
  burst: given?.burst ?? standard.burst,
  perSecond: given?.perSecond ?? standard.perSecond,
});

const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;
const ASSET_LIMIT = 12 * 1024 * 1024; // base64 for up to 9 MiB

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
/**
 * Whether what was shown is the secret, in a time that does not depend on how much of it is right. Both are hashed first, so that
 * they are compared at one length whatever was sent; that the secret has a length is no secret.
 */
const sameSecret = (secret: string, shown: unknown): boolean => typeof shown === "string" && timingSafeEqual(sha256(secret), sha256(shown));

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
  /** When the storage was last told that the room is in use: by a save, or by a note of a join (which is not written for every join). */
  usedAt: number;
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
    healthCacheMs: options.healthCacheMs ?? DEFAULTS.healthCacheMs,
    roomCreatePerHour: options.roomCreatePerHour ?? DEFAULTS.roomCreatePerHour,
    wrongKeysPerHour: options.wrongKeysPerHour ?? DEFAULTS.wrongKeysPerHour,
    trustProxy: options.trustProxy ?? false,
    roomTtlMs: options.roomTtlMs ?? 0,
    sweepEveryMs: options.sweepEveryMs ?? DEFAULTS.sweepEveryMs,
    maxRoomAssetBytes: options.maxRoomAssetBytes ?? DEFAULTS.maxRoomAssetBytes,
  };
  const now = options.now ?? Date.now;
  const roomsMade = hourlyLimit(o.roomCreatePerHour, now);
  const wrongKeys = hourlyLimit(o.wrongKeysPerHour, now);
  // what the server counts about itself (always counted: a few additions; shown only to whoever has the key for it)
  const metrics = createMetrics();
  // A join is noted in the storage at most this often for a room, so that looking at a design does not write to the disk every
  // time: once a day, and more often when rooms live for less than four days, so that a room in use cannot expire between two notes.
  const noteUseEvery = o.roomTtlMs ? Math.min(DAY, o.roomTtlMs / 4) : DAY;
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

  /**
   * Saves the record of a room. A room that an older server saved has its images inside its record; they are moved out first,
   * each into a place of its own, and the record is then written without them. Should the server stop between the two, the record
   * still holds them and the next save moves them again, over the same files: an image is in the record or beside it at every
   * moment, and when moving fails nothing is saved and the record is as it was.
   */
  const persist = async (l: Loaded, next: RoomRecord, designJson?: string) => {
    const { assets, ...record } = next;
    if (assets) for (const [assetId, asset] of Object.entries(assets)) await o.storage.saveAsset(l.id, assetId, asset);
    await saveRecord(l.id, record, designJson);
    l.record = record;
  };

  /** Writes the record of a room, and counts it: that it was written or could not be, and how long that took either way. */
  const saveRecord = async (id: string, record: RoomRecord, designJson?: string) => {
    const started = performance.now();
    try {
      await o.storage.save(id, record, designJson);
      metrics.count("saves_total");
    } catch (error) {
      metrics.count("save_failures_total");
      throw error;
    } finally {
      metrics.saveTook((performance.now() - started) / 1000);
    }
  };

  const open = (id: string, record: RoomRecord): Loaded => {
    const l: Loaded = {
      id,
      room: new Room(record.design, record.rev, record.seqs, { seen: record.seqSeen, floor: record.seqFloor, now }),
      record,
      sockets: new Set(),
      members: new Set(),
      pins: 0,
      usedAt: Number(record.updatedAt) || 0,
      work: Promise.resolve(),
      removed: false,
      idleTimer: null,
    };
    l.room.commit = async (design, rev, seqs, memory) => {
      // the design is turned into text once: to be measured here, and the same text is what the storage writes
      const designJson = JSON.stringify(design);
      if (Buffer.byteLength(designJson) > o.maxDesignBytes) throw new Error("This shared design exceeds the room size limit.");
      // (with the numbers of the clients goes what lets the room forget those that stayed away: src/collab/room.ts)
      const next = { ...l.record, design, rev, seqs, seqSeen: memory.seen, seqFloor: memory.floor, updatedAt: now() };
      await persist(l, next, designJson);
      l.usedAt = next.updatedAt;
    };
    l.room.onChange = () => metrics.count("batches_applied_total");
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

  /**
   * Notes in the storage that the room is in use now, which is what keeps it from expiring. The storage keeps the time with the
   * room (the time of its file) and does not read or write the room for it. It takes its turn in the room's queue, so that it never
   * meets a save of the same file, and a failure is written down and is nobody's problem but the operator's.
   */
  const noteUse = (l: Loaded) => {
    l.usedAt = now();
    enqueue(l, () => (l.removed ? undefined : o.storage.touch(l.id, l.usedAt))).catch((error: unknown) => {
      console.error(`Craftly could not note that the shared design ${l.id} is in use`, error);
    });
  };

  /**
   * Forgets a room and sends away whoever is at it: what "stop sharing" does, and what happens to a room that has expired. It runs
   * in the room's queue. When the storage cannot remove the room this throws, and the room is as it was.
   */
  const forget = async (l: Loaded, why: "rooms_removed_total" | "rooms_expired_total") => {
    await o.storage.remove(l.id);
    metrics.count(why);
    l.removed = true;
    if (l.idleTimer) clearTimeout(l.idleTimer);
    loaded.delete(l.id);
    for (const s of l.sockets) {
      send(s, { t: "denied", reason: "not-found" });
      s.close(4004, "gone");
    }
  };

  /* ---------------- expiry ---------------- */

  /**
   * Removes the rooms that nobody has used for longer than rooms may live. The storage says when each was last used without
   * reading it; only a room that has expired is read, once, because it is removed the way a person would remove it: through
   * `find` and its queue, so that somebody who arrives at the same moment meets either the room or its absence, and never half
   * of each. A room with somebody at it (a connection, a request at work) has not expired whatever the storage says: it is noted
   * as used now. A room that cannot be read or removed is written down and left; the next round tries again.
   */
  const sweep = async () => {
    const before = now() - o.roomTtlMs;
    for (const { id, usedAt } of await o.storage.list()) {
      if (closing) return;
      if (usedAt > before) continue;
      try {
        const l = await find(id);
        if (!l) continue; // removed since the list was made
        await enqueue(l, async () => {
          if (l.removed) return;
          if (l.sockets.size || l.pins) {
            l.usedAt = now();
            await o.storage.touch(id, l.usedAt);
          } else await forget(l, "rooms_expired_total");
        });
        unloadLater(l);
      } catch (error) {
        console.error(`Craftly could not remove the expired shared design ${id}`, error);
      }
    }
  };
  let sweeping: Promise<void> | null = null;
  const sweepNow = () => {
    if (!o.roomTtlMs || sweeping || closing) return;
    sweeping = sweep()
      .catch((error: unknown) => console.error("Craftly could not look for shared designs that have expired", error))
      .finally(() => {
        sweeping = null;
      });
  };
  const sweeper = setInterval(sweepNow, o.sweepEveryMs);
  sweeper.unref();

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
    res.setHeader("access-control-allow-headers", "content-type, x-craftly-key, x-craftly-create-key");
    res.setHeader("access-control-max-age", "600");
  };

  /**
   * Whether a request comes from a page that may not use this server: the server was given a list of origins, the request names
   * its origin, as every browser does for a WebSocket and for anything that is not a plain GET, and that origin is not on the list.
   * The CORS headers above do not do this. They stop a page from reading an answer, not from sending the request: making a room
   * needs no permission beforehand (its body has no content type that would), and a WebSocket is not subject to CORS at all.
   * It keeps the pages of other sites out, not a program, which names whatever origin it likes or none.
   */
  const foreign = (req: IncomingMessage): boolean => {
    const allow = o.allowOrigin;
    if (!allow || allow === "*") return false;
    const origin = req.headers.origin;
    return origin !== undefined && !(Array.isArray(allow) ? allow : [allow]).includes(origin);
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
    // Asked before the body is read: reading and checking up to 16 MiB is the work that an address with no allowance left is not
    // given. Every attempt counts, also one that is then refused for another reason.
    const wait = roomsMade.take(clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], o.trustProxy));
    if (wait) {
      res.setHeader("retry-after", String(wait));
      return reply(res, 429, { error: "too many shared designs were started from this address; try again later" });
    }
    // The key for making rooms, when the server has one, is asked for here: after the count above, so that guessing it is limited
    // to the rooms an address may make in an hour, and before the body, which nobody without the key has the server read. It is
    // taken from its header only (an address ends up in the logs of every proxy), compared in constant time, and never written
    // anywhere. The two answers have a `code`, by which the editor knows to ask the person for the key.
    if (o.roomCreateKey) {
      const shown = req.headers["x-craftly-create-key"];
      if (!shown) return reply(res, 401, { error: "this server asks for a key to start sharing", code: "create-key-needed" });
      if (!sameSecret(o.roomCreateKey, shown)) return reply(res, 403, { error: "that key to start sharing is not right", code: "create-key-wrong" });
    }
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
      const at = now();
      const shared: Design = { ...content, id, createdAt: at, updatedAt: at, folderId: null, starred: false, trashedAt: null };
      await saveRecord(id, {
        design: shared,
        rev: 0,
        seqs: {},
        editHash: sha256(editKey).toString("hex"),
        viewHash: sha256(viewKey).toString("hex"),
        ownerHash: sha256(ownerKey).toString("hex"),
        createdAt: at,
        updatedAt: at,
      });
      metrics.count("rooms_created_total");
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
      await forget(l, "rooms_removed_total");
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
    // an image is beside the record of its room, or still inside the record of a room that an older server saved
    const inside = () => (l.record.assets && Object.hasOwn(l.record.assets, assetId) ? l.record.assets[assetId] : undefined);
    const existing = async () => inside() ?? (await o.storage.loadAsset(id, assetId));
    if (req.method === "GET") {
      const asset = await existing();
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
      const have = await existing();
      if (have) return have.mime === mime && have.base64 === base64 ? reply(res, 200, { ok: true }) : reply(res, 409, { error: "image id already in use" });
      // what the room holds already: its files, and what an older server left inside its record
      const held = Object.values(l.record.assets ?? {}).reduce((sum, image) => sum + image.base64.length, await o.storage.assetBytes(id));
      if (held + base64.length > o.maxRoomAssetBytes) return reply(res, 413, { error: "this room has reached its image storage limit" });
      // the record is written only when it still holds images of its own, to move them out; otherwise an upload is one new file
      if (l.record.assets) await persist(l, l.record);
      await o.storage.saveAsset(id, assetId, { mime, base64 });
      reply(res, 201, { ok: true });
      // an image is use of the room, which the time of the room's file says; the image did not write that file
      noteUse(l);
    });
  };

  /* ---------------- the operator ---------------- */

  /**
   * Whether a request may use something that is the operator's: it shows the secret. Otherwise the request is answered here.
   * Without a secret on the server there is no such thing (404). A request that names an origin comes from a page, and these
   * are for a terminal: it is refused whatever the origin, and no CORS header is ever sent, so no page can read an answer either.
   * An address that showed a wrong secret ten times in an hour is not listened to for the rest of it, not with the right one
   * either, or guessing would only be slowed down for the guesses that fail. A right secret is not counted.
   */
  const operator = (req: IncomingMessage, res: ServerResponse, secret: string | undefined, shown: unknown): boolean => {
    const refuse = (status: number, error: string) => {
      reply(res, status, { error });
      return false;
    };
    if (!secret) return refuse(404, "not found");
    if (req.headers.origin !== undefined) return refuse(403, "this is not for a page: ask from a terminal, without an Origin header");
    const address = clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], o.trustProxy);
    const wait = wrongKeys.wait(address);
    if (wait) {
      res.setHeader("retry-after", String(wait));
      return refuse(429, "too many wrong keys from this address; try again later");
    }
    if (!sameSecret(secret, shown)) {
      wrongKeys.take(address);
      return refuse(401, "this needs the operator's key");
    }
    return true;
  };

  /**
   * The rooms, in the order of their ids, a page at a time (`limit`, and `after` with the id the page before ended on). For each:
   * its title, when it was made and last used, how many bytes its design and its images take, and how many people are in it now.
   * Nothing that lets anybody in is listed: the server has no keys, and their hashes stay where they are. Each room of the page
   * is read for this (the storage knows ids and times only), so a page is work; a room that cannot be read is listed as such.
   */
  const adminList = async (url: URL, res: ServerResponse) => {
    const asked = url.searchParams.get("limit");
    const limit = asked === null ? ADMIN_PAGE : Number(asked);
    const after = url.searchParams.get("after") ?? "";
    if (!Number.isSafeInteger(limit) || limit < 1) return reply(res, 400, { error: "limit is a whole number, 1 or more" });
    if (after && !ROOM_ID.test(after)) return reply(res, 400, { error: "after is the id of a room" });
    const all = (await o.storage.list()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rest = all.filter((room) => room.id > after);
    const page = rest.slice(0, Math.min(limit, ADMIN_PAGE_MAX));
    const rooms: unknown[] = [];
    for (const { id, usedAt } of page) {
      const l = loaded.get(id);
      const people = l?.members.size ?? 0;
      try {
        const record = l ? l.record : await o.storage.load(id);
        if (!record) continue; // removed since the storage was asked
        const inside = Object.values(record.assets ?? {}).reduce((sum, image) => sum + image.base64.length, 0);
        rooms.push({
          id,
          title: String(record.design.title),
          createdAt: record.createdAt,
          usedAt: Math.max(usedAt, l?.usedAt ?? 0),
          designBytes: Buffer.byteLength(JSON.stringify(record.design)),
          imageBytes: inside + (await o.storage.assetBytes(id)),
          people,
        });
      } catch (error) {
        console.error(`Craftly could not read the shared design ${id} for the list of rooms`, error);
        rooms.push({ id, usedAt, people, error: "this room cannot be read" });
      }
    }
    reply(res, 200, { rooms, total: all.length, next: rest.length > page.length ? page[page.length - 1].id : null });
  };

  /**
   * Removes a room for the operator, the way "stop sharing" does for its owner: through the room's queue, and everybody at it is
   * sent away. A room that cannot be read cannot be reached that way, and nobody can be in it: its files are removed as they are,
   * which is the one way to be rid of a damaged room short of going to the disk.
   */
  const adminRemove = async (id: string, res: ServerResponse) => {
    if (!ROOM_ID.test(id)) return reply(res, 404, { error: "no such shared design" });
    let l: Loaded | null;
    try {
      l = await find(id);
    } catch (error) {
      console.error(`Craftly removes the shared design ${id}, which cannot be read, for the operator`, error);
      await o.storage.remove(id);
      metrics.count("rooms_removed_total");
      return reply(res, 200, { ok: true });
    }
    if (!l) return reply(res, 404, { error: "no such shared design" });
    await enqueue(l, async () => {
      if (l.removed) return reply(res, 404, { error: "no such shared design" });
      await forget(l, "rooms_removed_total");
      reply(res, 200, { ok: true });
    });
  };

  const admin = async (req: IncomingMessage, url: URL, res: ServerResponse) => {
    if (!operator(req, res, o.adminKey, req.headers["x-craftly-admin-key"])) return;
    if (req.method === "GET" && url.pathname === "/api/admin/rooms") return adminList(url, res);
    const room = /^\/api\/admin\/rooms\/([^/]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && room) return adminRemove(room[1], res);
    reply(res, 404, { error: "not found" });
  };

  /**
   * How many rooms the storage holds, asked at most once in `healthCacheMs` however often the numbers are scraped (counting reads
   * a folder). When the storage cannot say, the number of the last time it could is given, and none when it never could.
   */
  let stored: { at: number; count: Promise<number | undefined> } | null = null;
  let storedBefore: number | undefined;
  const roomsStored = (): Promise<number | undefined> => {
    const at = Date.now();
    if (!stored || at - stored.at >= o.healthCacheMs) {
      stored = {
        at,
        count: o.storage.count().then(
          (count) => (storedBefore = count),
          () => storedBefore,
        ),
      };
    }
    return stored.count;
  };

  /**
   * The server's numbers for a scraper (`metrics.ts` says which, and why no label ever names a room). Guarded like the operator's
   * interface, by a key of its own shown as a bearer token, which is how a scraper is told to authenticate: there is nothing
   * here unless the server was given that key, a request of a page is refused, and no CORS header is sent.
   */
  const metricsAnswer = async (req: IncomingMessage, res: ServerResponse) => {
    const shown = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!operator(req, res, o.metricsKey, shown)) return;
    if (req.method !== "GET") return reply(res, 404, { error: "not found" });
    let joined = 0;
    for (const l of loaded.values()) joined += l.members.size;
    const text = metrics.text({
      uptime_seconds: process.uptime(),
      rooms_in_memory: loaded.size,
      rooms_stored: await roomsStored(),
      connections: sockets.size,
      peers_joined: joined,
    });
    res.statusCode = 200;
    res.setHeader("content-type", METRICS_CONTENT_TYPE);
    res.setHeader("cache-control", "no-store");
    res.end(text);
  };

  /**
   * Whether the storage can be written to, asked at most once in `healthCacheMs`. The check writes a file and waits for the disk,
   * and anybody may ask for `/api/health` as often as they like: the answer of a moment ago is given to all who ask meanwhile.
   */
  let health: { at: number; writable: Promise<boolean> } | null = null;
  const storageWritable = (): Promise<boolean> => {
    const at = Date.now();
    if (!health || at - health.at >= o.healthCacheMs) {
      health = {
        at,
        writable: o.storage.checkWritable().then(
          () => true,
          () => false,
        ),
      };
    }
    return health.writable;
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
    const url = target(req);
    // The storage failed, or a room that is there could not be read. It is written down for the operator, and answered as a
    // problem of the server: a browser asks again later after a 500, where it takes a 404 to mean that the design is gone.
    const failed = (error: unknown) => {
      console.error(`Craftly could not answer ${req.method} ${url?.pathname}`, error);
      if (!res.headersSent) reply(res, 500, { error: "the server has a problem and could not do this; try again later" });
    };
    res.once("finish", () => metrics.countBy("http_responses_total", `${Math.floor(res.statusCode / 100)}xx` as LabelOf<"http_responses_total">));
    // what is the operator's is no part of what pages may call: it is answered before, and without, the CORS headers
    if (url?.pathname.startsWith("/api/admin/")) return void admin(req, url, res).catch(failed);
    if (url?.pathname === "/metrics") return void metricsAnswer(req, res).catch(failed);
    cors(req, res);
    if (!url) return reply(res, 400, { error: "invalid request target" });
    void (async () => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        return void res.end();
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        if (await storageWritable()) return reply(res, 200, { ok: true, rooms: loaded.size });
        return reply(res, 503, { ok: false, error: "room storage is unavailable" });
      }
      if ((req.method === "POST" || req.method === "PUT" || req.method === "DELETE") && foreign(req)) {
        return reply(res, 403, { error: "this server does not take requests from this origin" });
      }
      if (req.method === "POST" && url.pathname === "/api/rooms") return await createRoom(req, res);
      const asset = /^\/api\/rooms\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
      if (asset && (req.method === "GET" || req.method === "PUT")) return await roomAsset(asset[1], asset[2], req, res);
      const del = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
      if (req.method === "DELETE" && del) return await deleteRoom(del[1], req, res);
      reply(res, 404, { error: "not found" });
    })().catch(failed);
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
    if (ws.bufferedAmount > o.maxBufferedBytes) {
      metrics.countBy("connections_closed_total", "slow_reader");
      ws.terminate();
    }
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
    if (foreign(req)) {
      // a page of another site: refused before it is a connection, and before a room is read for it
      metrics.countBy("upgrades_refused_total", "origin");
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (sockets.size >= o.maxConnections) {
      // refused before it is a connection; a browser sees a connection that failed and tries again later
      metrics.countBy("upgrades_refused_total", "connections");
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
    // (a message longer than `maxMessageBytes` is not handed over: `ws` closes the connection with 1009 and says so here)
    ws.on("error", (error: Error & { code?: string }) => {
      if (error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") metrics.countBy("connections_closed_total", "size");
    });
    // the answer to a ping of the heartbeat below (asked for here: an upgrade handled by hand never reaches the "connection" event of `wss`)
    ws.on("pong", () => answered.set(ws, true));
    // what arrives while the room is being loaded waits here
    const early: RawData[] = [];
    let handle: ((data: RawData) => void) | null = null;
    let shownKey = false;
    ws.on("message", (data) => {
      metrics.count("messages_received_total");
      metrics.count("bytes_received_total", sizeOf(data));
      // Until the key has been shown the only message with a use is a join, which is tiny. Anything bigger is not read: parsing
      // megabytes for whoever asks is work that a stranger could have the server do.
      if (!shownKey && sizeOf(data) > o.maxUnjoinedMessageBytes) {
        metrics.countBy("connections_closed_total", "size");
        return void ws.close(1009, "too big before the key");
      }
      if (handle) handle(data);
      else early.push(data);
    });

    let l: Loaded | null;
    try {
      l = await find(roomId);
    } catch (error) {
      // A room that cannot be read is not a room that is gone, and the person is not told that it is: the reason says that the
      // server has a problem. It is written down for the operator, and the server goes on.
      console.error(`Craftly could not read the shared design ${roomId}`, error);
      return deny(ws, "server-error");
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
    if (l.sockets.size - l.members.size >= o.maxWaitingPerRoom) {
      metrics.countBy("connections_closed_total", "waiting");
      return void ws.close(1013, "try again later");
    }
    l.sockets.add(ws);
    const peer: Peer = {
      send: (msg) => {
        if (msg.t === "rejected") metrics.count("batches_rejected_total");
        send(ws, msg);
      },
    };
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
      const at = Date.now();
      const seconds = (at - refilled) / 1000;
      tokens = Math.min(o.rate.burst, tokens + seconds * o.rate.perSecond);
      bytes = Math.min(o.byteRate.burst, bytes + seconds * o.byteRate.perSecond) - sizeOf(data);
      joins = Math.min(o.joinRate.burst, joins + seconds * o.joinRate.perSecond);
      refilled = at;
      if (--tokens < 0 || bytes < 0) {
        metrics.countBy("connections_closed_total", "rate");
        return void ws.close(1008, "slow down");
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "join") {
        // every join is answered with the whole design, megabytes of it for a few bytes, so it has a small allowance of its own
        if (--joins < 0) {
          metrics.countBy("connections_closed_total", "join_rate");
          return void ws.close(1008, "slow down");
        }
        const role = roleOf(l, msg.key);
        if (!role) return void deny(ws, "no-access");
        if (typeof msg.client !== "string" || !CLIENT_NAME.test(msg.client)) return void deny(ws, "bad-request");
        if (!l.members.has(ws)) {
          if (l.members.size >= o.maxPeersPerRoom) return void deny(ws, "server-full");
          l.members.add(ws);
          shownKey = true;
          clearTimeout(silent);
          if (now() - l.usedAt >= noteUseEvery) noteUse(l);
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
            peer.send({ t: "rejected", seq: msg.seq, reason: "The server could not save this edit." });
          }
        });
      } else if (msg.t === "ping") void l.room.receive(peer, msg);
    };
    for (const data of early.splice(0)) handle(data);
  };

  // a connection that stopped answering is dropped (the browser's own pings keep a live one busy as well)
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (answered.get(ws) === false) {
        metrics.countBy("connections_closed_total", "silent");
        ws.terminate();
      } else {
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
        http.listen(port, host, () => {
          sweepNow();
          resolve(http.address() as AddressInfo);
        });
      }),
    async close() {
      closing = true;
      clearInterval(heartbeat);
      clearInterval(sweeper);
      await sweeping;
      for (const l of loaded.values()) if (l.idleTimer) clearTimeout(l.idleTimer);
      await Promise.all([roomCreation, ...[...loaded.values()].map((l) => l.work)]);
      for (const ws of sockets) ws.close(1001, "the server is going away");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    rooms: () => loaded.size,
  };
}

/**
 * Closes a server and waits for that no longer than `ms`: whether it closed in time. Closing waits for every save and every
 * request that is at work, and one of those may hang (a disk that does not answer, an upload that never ends), so whoever stops
 * the process needs an end to the wait. Nothing that was acknowledged is lost by not waiting: an edit is saved before it is
 * acknowledged. Rejects when closing fails.
 */
export function closeWithin(server: Pick<LiveServer, "close">, ms: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const late = setTimeout(() => resolve(false), ms);
    server
      .close()
      .then(() => resolve(true), reject)
      .finally(() => clearTimeout(late));
  });
}

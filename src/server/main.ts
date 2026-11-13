/**
 * Starts the server for shared designs: `npm run server` (it builds `dist-server/live.mjs` first), or `node dist-server/live.mjs`.
 * Settings come from the environment: PORT (8787), HOST (127.0.0.1; 0.0.0.0 to be reachable from other machines), DATA_DIR
 * (live-data), ALLOW_ORIGIN (the origin of the editor, a comma separated list, or *; none by default), MAX_ROOMS, MAX_PEERS_PER_ROOM,
 * and what one visitor may cost: MAX_CONNECTIONS, MAX_WAITING_PER_ROOM, MAX_BUFFERED_BYTES, MAX_UNJOINED_MESSAGE_BYTES, BYTE_BURST,
 * BYTES_PER_SECOND, JOIN_BURST, JOIN_EVERY_MS. What is not set keeps the default of `createLiveServer`. See docs/COLLABORATION.md.
 */
import { createLiveServer } from "./live";
import { FileStorage } from "./storage";

const env = process.env;
const number = (name: string, min: number, max: number) => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected an integer between ${min} and ${max}.`);
  return value;
};
const origins = env.ALLOW_ORIGIN?.split(",").map((s) => s.trim());
const joinEveryMs = number("JOIN_EVERY_MS", 1, Number.MAX_SAFE_INTEGER);

const server = createLiveServer({
  storage: new FileStorage(env.DATA_DIR ?? "live-data"),
  allowOrigin: origins?.includes("*") ? "*" : origins,
  maxRooms: number("MAX_ROOMS", 1, Number.MAX_SAFE_INTEGER),
  maxPeersPerRoom: number("MAX_PEERS_PER_ROOM", 1, Number.MAX_SAFE_INTEGER),
  maxConnections: number("MAX_CONNECTIONS", 1, Number.MAX_SAFE_INTEGER),
  maxWaitingPerRoom: number("MAX_WAITING_PER_ROOM", 1, Number.MAX_SAFE_INTEGER),
  maxBufferedBytes: number("MAX_BUFFERED_BYTES", 1024, Number.MAX_SAFE_INTEGER),
  maxUnjoinedMessageBytes: number("MAX_UNJOINED_MESSAGE_BYTES", 256, Number.MAX_SAFE_INTEGER),
  byteRate: { burst: number("BYTE_BURST", 1024, Number.MAX_SAFE_INTEGER), perSecond: number("BYTES_PER_SECOND", 1, Number.MAX_SAFE_INTEGER) },
  // one join every so many milliseconds, once the burst is used up
  joinRate: { burst: number("JOIN_BURST", 1, Number.MAX_SAFE_INTEGER), perSecond: joinEveryMs === undefined ? undefined : 1000 / joinEveryMs },
});

const host = env.HOST ?? "127.0.0.1";
const address = await server.listen(number("PORT", 0, 65535) ?? 8787, host);
console.log(`Craftly live server on http://${host}:${address.port} (rooms are kept in ${env.DATA_DIR ?? "live-data"})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}

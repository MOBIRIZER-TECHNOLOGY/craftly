/**
 * Starts the server for shared designs: `npm run server` (it builds `dist-server/live.mjs` first), or `node dist-server/live.mjs`.
 * Settings come from the environment: PORT (8787), HOST (127.0.0.1; 0.0.0.0 to be reachable from other machines), DATA_DIR
 * (live-data), ALLOW_ORIGIN (the origin of the editor, a comma separated list, or *; none by default), MAX_ROOMS, MAX_PEERS_PER_ROOM,
 * and what one visitor may cost: MAX_CONNECTIONS, MAX_WAITING_PER_ROOM, MAX_BUFFERED_BYTES, MAX_UNJOINED_MESSAGE_BYTES, BYTE_BURST,
 * BYTES_PER_SECOND, JOIN_BURST, JOIN_EVERY_MS. What is not set keeps the default of `createLiveServer`. SHUTDOWN_TIMEOUT_MS (10000)
 * is how long the server may take to close when it is told to stop. See docs/COLLABORATION.md.
 */
import { closeWithin, createLiveServer } from "./live";
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

// Told to stop, the server saves what is at work and closes every connection. That may hang (a disk that does not answer, an
// upload that never ends) or fail, and a process that then stays for ever is killed by whatever runs it, without a word in the
// log. So the wait has an end, a failure is written down, and both leave with a code that says it did not go well. A second
// signal does not wait at all.
const shutdownMs = number("SHUTDOWN_TIMEOUT_MS", 0, 600_000) ?? 10_000;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) {
      console.error(`Craftly live server: ${signal} again, leaving at once`);
      process.exit(1);
    }
    stopping = true;
    closeWithin(server, shutdownMs).then(
      (closed) => {
        if (!closed) console.error(`Craftly live server did not close within ${shutdownMs} ms (a save or a request was still at work); leaving anyway`);
        process.exit(closed ? 0 : 1);
      },
      (error: unknown) => {
        console.error("Craftly live server could not close cleanly", error);
        process.exit(1);
      },
    );
  });
}

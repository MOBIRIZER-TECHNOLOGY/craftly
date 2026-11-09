/**
 * Starts the server for shared designs: `npm run server` (it builds `dist-server/live.mjs` first), or `node dist-server/live.mjs`.
 * Settings come from the environment: PORT (8787), HOST (127.0.0.1; 0.0.0.0 to be reachable from other machines), DATA_DIR
 * (live-data), ALLOW_ORIGIN (the origin of the editor, a comma separated list, or *; none by default), MAX_ROOMS, MAX_PEERS_PER_ROOM.
 * See docs/COLLABORATION.md.
 */
import { createLiveServer } from "./live";
import { FileStorage } from "./storage";

const env = process.env;
const number = (value: string | undefined) => (value && Number.isFinite(Number(value)) ? Number(value) : undefined);
const origins = env.ALLOW_ORIGIN?.split(",").map((s) => s.trim());

const server = createLiveServer({
  storage: new FileStorage(env.DATA_DIR ?? "live-data"),
  allowOrigin: origins?.includes("*") ? "*" : origins,
  maxRooms: number(env.MAX_ROOMS),
  maxPeersPerRoom: number(env.MAX_PEERS_PER_ROOM),
});

const host = env.HOST ?? "127.0.0.1";
const address = await server.listen(number(env.PORT) ?? 8787, host);
console.log(`Craftly live server on http://${host}:${address.port} (rooms are kept in ${env.DATA_DIR ?? "live-data"})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}

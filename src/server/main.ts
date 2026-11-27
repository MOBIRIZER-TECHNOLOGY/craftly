/**
 * Starts the server for shared designs: `npm run server` (it builds `dist-server/live.mjs` first), or `node dist-server/live.mjs`.
 * Settings come from the environment: PORT (8787), HOST (127.0.0.1; 0.0.0.0 to be reachable from other machines), DATA_DIR
 * (live-data), ALLOW_ORIGIN (the origin of the editor, a comma separated list, or *; none by default), MAX_ROOMS, MAX_PEERS_PER_ROOM,
 * and what one visitor may cost: MAX_CONNECTIONS, MAX_WAITING_PER_ROOM, MAX_QUEUED_BATCHES, MAX_QUEUED_BYTES, MAX_GROUP, MAX_BUFFERED_BYTES, MAX_UNJOINED_MESSAGE_BYTES, BYTE_BURST,
 * BYTES_PER_SECOND, JOIN_BURST, JOIN_EVERY_MS, PRESENCE_BURST, PRESENCE_PER_SECOND (how often a connection may say where its (rooms one address may make in an hour; 0 for no limit) and
 * TRUST_PROXY (1 when exactly one reverse proxy stands in front: the address of a visitor is then read from X-Forwarded-For), and
 * ROOM_TTL_DAYS (a room that nobody has used for so many days is removed; not set or 0: never), and ROOM_CREATE_KEY (a secret that
 * whoever starts to share must show; not set: anybody may), and ADMIN_KEY (the operator's key for listing and removing rooms,
 * scripts/rooms.mjs; not set: there is no such interface), and METRICS_KEY (the key of a scraper for GET /metrics; not set: the
 * server shows no numbers), and ACCOUNTS (1 for accounts, teams and sync; off by default) with SIGNUP (invite, open or closed;
 * invite), MAX_ACCOUNTS (no limit) and SPACE_QUOTA_MB (1024), and MAX_MEDIA_MB (100) and MAX_ROOM_MEDIA_MB (500), the largest clip or
 * sound a shared design carries and the most one room keeps (0: none). What is not set keeps the default
 * of `createLiveServer`. SHUTDOWN_TIMEOUT_MS (10000) is how long the server may take to close when it
 * is told to stop. See docs/COLLABORATION.md and docs/DEPLOY.md.
 */
import { join } from "node:path";
import { SIGNUP_MODES, type SignupMode } from "./accounts";
import { FileAccounts } from "./accounts/storage";
import { closeWithin, createLiveServer } from "./live";
import { removeLeftovers } from "./leftovers";
import { listenWarning } from "./listenWarning";
import { FileStorage } from "./storage";

const env = process.env;

// What the server writes is for the server alone: rooms, uploads, and with ACCOUNTS=1 emails and password hashes. Files are
// made 600 and folders 700, also in a folder of the host mounted into a container, where other users of that machine could
// otherwise read them. A backup must run as the same user (or root). Before anything is written.
process.umask(0o077);
const number = (name: string, min: number, max: number) => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected an integer between ${min} and ${max}.`);
  return value;
};

/** A size given in MiB, as bytes; 0 lets no clip or sound be shared. */
const megabytes = (name: string) => {
  const value = number(name, 0, 1024 * 1024);
  return value === undefined ? undefined : value * 1024 * 1024;
};
/** A setting that is on or off: 1 or true, 0 or false. Not set is off. */
const flag = (name: string) => {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (raw === "" || raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  throw new Error(`Invalid ${name}: expected 1 or 0.`);
};
/**
 * A secret of the operator's. Not set, or set to nothing, is no secret (the feature it guards is then as the table in
 * docs/DEPLOY.md says). One that is short, or that a header cannot carry, stops the server: it would be guessed, or never matched.
 * The message names the variable and never the value.
 */
const secret = (name: string, minLength: number) => {
  const raw = (env[name] ?? "").trim();
  if (raw === "") return undefined;
  if (raw.length < minLength || /[^\x21-\x7e]/.test(raw)) {
    throw new Error(`Invalid ${name}: expected at least ${minLength} characters, letters, digits and signs without spaces.`);
  }
  return raw;
};
// a variable that is set to nothing is a variable that is not set: it must not become a list that holds no origin and refuses every page
const named = (env.ALLOW_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const origins = named.length ? named : undefined;
const joinEveryMs = number("JOIN_EVERY_MS", 1, Number.MAX_SAFE_INTEGER);
const roomTtlDays = number("ROOM_TTL_DAYS", 0, 36_500);
const dataDir = env.DATA_DIR ?? "live-data";

/**
 * Accounts, teams and sync (docs/ACCOUNTS.md), off unless ACCOUNTS=1: off, the server is exactly what it was, and the other
 * account settings are not read. They are kept in DATA_DIR/accounts, beside the rooms.
 */
const accountsOn = flag("ACCOUNTS");
const signupMode = (): SignupMode => {
  const raw = (env.SIGNUP ?? "").trim().toLowerCase();
  if (raw === "") return "invite";
  if (!(SIGNUP_MODES as readonly string[]).includes(raw)) throw new Error(`Invalid SIGNUP: expected ${SIGNUP_MODES.join(", ")}.`);
  return raw as SignupMode;
};
const accounts = accountsOn
  ? {
      storage: new FileAccounts(join(dataDir, "accounts")),
      signup: signupMode(),
      // none: no limit on the number of accounts
      maxAccounts: number("MAX_ACCOUNTS", 1, Number.MAX_SAFE_INTEGER),
      spaceQuotaBytes: (number("SPACE_QUOTA_MB", 1, 1024 * 1024) ?? 1024) * 1024 * 1024,
      // the largest clip or sound of a space: the same setting as for a shared design's
      maxMediaBytes: megabytes("MAX_MEDIA_MB"),
    }
  : undefined;

const server = createLiveServer({
  storage: new FileStorage(dataDir),
  allowOrigin: origins?.includes("*") ? "*" : origins,
  maxRooms: number("MAX_ROOMS", 1, Number.MAX_SAFE_INTEGER),
  // the clips and sounds of shared designs, in MiB: the largest one, and the most one room keeps
  maxMediaBytes: megabytes("MAX_MEDIA_MB"),
  maxRoomMediaBytes: megabytes("MAX_ROOM_MEDIA_MB"),
  maxPeersPerRoom: number("MAX_PEERS_PER_ROOM", 1, Number.MAX_SAFE_INTEGER),
  maxConnections: number("MAX_CONNECTIONS", 1, Number.MAX_SAFE_INTEGER),
  maxWaitingPerRoom: number("MAX_WAITING_PER_ROOM", 1, Number.MAX_SAFE_INTEGER),
  // edits that may wait in one room to be saved, and how many one write saves (group commit)
  maxQueuedBatches: number("MAX_QUEUED_BATCHES", 1, Number.MAX_SAFE_INTEGER),
  maxQueuedBytes: number("MAX_QUEUED_BYTES", 1024, Number.MAX_SAFE_INTEGER),
  maxGroup: number("MAX_GROUP", 1, 100_000),
  maxBufferedBytes: number("MAX_BUFFERED_BYTES", 1024, Number.MAX_SAFE_INTEGER),
  maxUnjoinedMessageBytes: number("MAX_UNJOINED_MESSAGE_BYTES", 256, Number.MAX_SAFE_INTEGER),
  byteRate: { burst: number("BYTE_BURST", 1024, Number.MAX_SAFE_INTEGER), perSecond: number("BYTES_PER_SECOND", 1, Number.MAX_SAFE_INTEGER) },
  // one join every so many milliseconds, once the burst is used up
  joinRate: { burst: number("JOIN_BURST", 1, Number.MAX_SAFE_INTEGER), perSecond: joinEveryMs === undefined ? undefined : 1000 / joinEveryMs },
  // how often one connection may say where its person's pointer is; what is more is dropped, and the connection stays
  presenceRate: { burst: number("PRESENCE_BURST", 1, Number.MAX_SAFE_INTEGER), perSecond: number("PRESENCE_PER_SECOND", 1, Number.MAX_SAFE_INTEGER) },
  roomCreatePerHour: number("ROOM_CREATE_PER_HOUR", 0, 100_000),
  // Exactly one proxy is trusted (the one that connects to this server), so the setting is on or off and not a number of proxies.
  trustProxy: flag("TRUST_PROXY"),
  // off unless it is set: rooms are then kept until their owners stop sharing
  roomTtlMs: roomTtlDays === undefined ? undefined : roomTtlDays * 24 * 60 * 60 * 1000,
  // off unless it is set: anybody who reaches the server may then make rooms
  roomCreateKey: secret("ROOM_CREATE_KEY", 8),
  // off unless it is set: nothing answers under /api/admin/ then
  adminKey: secret("ADMIN_KEY", 16),
  // off unless it is set: /metrics answers 404 then
  metricsKey: secret("METRICS_KEY", 16),
  accounts,
});

// what an earlier run left half-written (a clip being received when it was stopped): nothing is at work yet
const left = await removeLeftovers(dataDir);
if (left.files) console.log(`Removed ${left.files} half-written file${left.files === 1 ? "" : "s"} (${Math.ceil(left.bytes / 1024)} KiB) that an earlier run left in ${dataDir}`);

const host = env.HOST ?? "127.0.0.1";
const address = await server.listen(number("PORT", 0, 65535) ?? 8787, host);
console.log(`Craftly live server on http://${host}:${address.port} (rooms are kept in ${dataDir}${accounts ? `; accounts are on, sign-up is ${accounts.signup}` : ""})`);
// Reachable from other machines, the server needs a proxy with TLS in front of it, and says so (src/server/listenWarning.ts).
const warning = listenWarning(host);
if (warning) console.warn(warning);

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

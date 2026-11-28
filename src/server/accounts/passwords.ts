/**
 * Passwords: what one may be, and how it is kept. A password is kept as an scrypt hash with the parameters in front of it
 * (`scrypt$15$8$1$<salt>$<hash>`, the cost as a power of two), so that the cost can be raised later and an old hash still read.
 * Hashing is slow on purpose and takes 32 MiB of memory at the default cost, so only a few may run at once. What waits for a
 * place is shared out so that a flood cannot keep the people it is not from out (`createHasher`). Nothing here touches a socket
 * or a file.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** The cost of a new hash: N = 2^15, r = 8, p = 1 (docs/ACCOUNTS.md, "Passwords"). */
export const DEFAULT_COST = { logN: 15, r: 8, p: 1 } as const;
export type Cost = { logN: number; r: number; p: number };
/** How many hashes may run at the same time; more wait for a place, for a while (`createHasher`). */
export const HASH_CONCURRENCY = 4;
/** The most hashes that may wait for a place, from everywhere together; one more is refused with `HashBusy` (503). */
export const HASH_WAITING = 64;
/** How long a hash may wait for a place before it is refused with `HashBusy`, in milliseconds. */
export const HASH_WAIT_MS = 3000;
/** The most hashes one address may have at work or waiting at once; one more is refused with `HashBusy`. */
export const HASH_PER_ADDRESS = 2;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/** Node's default of 32 MiB is not enough for N = 2^15 and r = 8, which need exactly that and a little more. */
const MAX_MEM = 64 * 1024 * 1024;
/**
 * The most a stored hash may ask for. A hash is read from a file, and a damaged or planted one must not make the server spend
 * minutes or gigabytes on one sign-in: anything above these is refused as not a hash.
 */
const LIMITS = { logN: [10, 20], r: [1, 32], p: [1, 16] } as const;
const STORED = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;

/** Too many hashes are at work; try again in a moment. */
export class HashBusy extends Error {
  constructor() {
    super("too many passwords are being checked at once");
    this.name = "HashBusy";
  }
}

/** A password as it is compared: NFC, so that the same letters typed on two systems are the same password. */
export const normalizePassword = (password: string) => password.normalize("NFC");

/** What is wrong with a password that is to be set, or null. The length is counted in characters, not in UTF-16 units. */
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string") return "a password is text";
  const length = [...normalizePassword(value)].length;
  if (length < PASSWORD_MIN) return `a password has at least ${PASSWORD_MIN} characters`;
  if (length > PASSWORD_MAX) return `a password has at most ${PASSWORD_MAX} characters`;
  return null;
}

const within = (cost: Cost) =>
  cost.logN >= LIMITS.logN[0] && cost.logN <= LIMITS.logN[1] && cost.r >= LIMITS.r[0] && cost.r <= LIMITS.r[1] && cost.p >= LIMITS.p[0] && cost.p <= LIMITS.p[1];

/** The parts of a stored hash, or null when it is not one this code can (or may) check. */
export function parseStored(stored: string): { cost: Cost; salt: Buffer; hash: Buffer } | null {
  const parts = STORED.exec(stored);
  if (!parts) return null;
  const cost = { logN: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (!within(cost)) return null;
  return { cost, salt: Buffer.from(parts[4], "base64url"), hash: Buffer.from(parts[5], "base64url") };
}

const derive = (password: string, salt: Buffer, cost: Cost) =>
  new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = { N: 2 ** cost.logN, r: cost.r, p: cost.p, maxmem: MAX_MEM };
    scrypt(normalizePassword(password), salt, KEY_BYTES, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

/**
 * Who a hash is for: the address it came from (counted against `HASH_PER_ADDRESS`), and whether the account has signed in from
 * that address lately (`known`), which may take the place that is kept for such people. Without it, a hash is from nowhere in
 * particular and is not known.
 */
export type HashFor = { address: string; known?: boolean };

export interface Hasher {
  /**
   * The stored form of a new password. Waits for a place when `concurrency` hashes are at work already, and throws `HashBusy`
   * when it has waited `HASH_WAIT_MS`, when `HASH_WAITING` wait already, or when its address has `HASH_PER_ADDRESS` going.
   */
  hash(password: string, who?: HashFor): Promise<string>;
  /**
   * Whether the password is the one of the stored hash. A stored value that is no hash (or null: there is no such person) is
   * checked against a hash of nothing, at the same cost, and is never right: the time an answer takes says nothing about
   * whether there is an account. Waits and throws `HashBusy` like `hash`.
   */
  verify(password: string, stored: string | null, who?: HashFor): Promise<boolean>;
  /** How many hashes are at work now. */
  busy(): number;
  /** How many wait for a place now. */
  waiting(): number;
}

export type HashLimits = { waiting?: number; waitMs?: number; perAddress?: number };

/**
 * A hasher that runs at most `concurrency` hashes at once. More wait, and how the places are given out is what keeps a flood of
 * sign-ins from many addresses from turning the people it is not from away:
 *
 * - one address may have only `perAddress` going, at work or waiting, so that it cannot take the queue for itself;
 * - with two places or more, one is kept for a person signing in from an address their account used lately (`known`), which a
 *   flood from new addresses cannot reach;
 * - a known person waiting goes first; the others wait in the order they came, each for `waitMs` at most.
 */
export function createHasher(cost: Cost = DEFAULT_COST, concurrency = HASH_CONCURRENCY, limits: HashLimits = {}): Hasher {
  if (!within(cost)) throw new Error("that password cost is outside what this server will check");
  const maxWaiting = limits.waiting ?? HASH_WAITING;
  const waitMs = limits.waitMs ?? HASH_WAIT_MS;
  const perAddress = limits.perAddress ?? HASH_PER_ADDRESS;
  // the places a person who is not known may take: all but the one kept for the known, when there are two or more
  const open = concurrency >= 2 ? concurrency - 1 : concurrency;
  let active = 0;
  const going = new Map<string, number>();
  type Waiting = { known: boolean; go: () => void };
  const queue: Waiting[] = [];
  const mayStart = (known: boolean) => active < (known ? concurrency : open);
  const next = () => {
    while (queue.length) {
      const i = queue.findIndex((w) => w.known && mayStart(true));
      const j = i >= 0 ? i : queue.findIndex((w) => mayStart(w.known));
      if (j < 0) return;
      queue.splice(j, 1)[0].go();
    }
  };
  const run = async <T>(work: () => Promise<T>, who?: HashFor): Promise<T> => {
    const address = who?.address;
    const known = who?.known === true;
    if (address !== undefined && (going.get(address) ?? 0) >= perAddress) throw new HashBusy();
    if (!mayStart(known)) {
      if (queue.length >= maxWaiting) throw new HashBusy();
      if (address !== undefined) going.set(address, (going.get(address) ?? 0) + 1);
      try {
        await new Promise<void>((resolve, reject) => {
          const entry: Waiting = {
            known,
            // the place is taken here, before the waiting hash runs on, so that `next` gives out no more places than are free
            go: () => {
              clearTimeout(timer);
              active++;
              resolve();
            },
          };
          const timer = setTimeout(() => {
            const at = queue.indexOf(entry);
            if (at >= 0) queue.splice(at, 1);
            reject(new HashBusy());
          }, waitMs);
          timer.unref?.();
          queue.push(entry);
        });
      } catch (error) {
        if (address !== undefined) leave(address);
        throw error;
      }
    } else {
      if (address !== undefined) going.set(address, (going.get(address) ?? 0) + 1);
      active++;
    }
    try {
      return await work();
    } finally {
      active--;
      if (address !== undefined) leave(address);
      next();
    }
  };
  const leave = (address: string) => {
    const left = (going.get(address) ?? 1) - 1;
    if (left > 0) going.set(address, left);
    else going.delete(address);
  };
  const make = async (password: string) => {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, cost);
    return `scrypt$${cost.logN}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  };
  return {
    hash: (password, who) => run(() => make(password), who),
    verify: (password, stored, who) =>
      run(async () => {
        const parsed = stored === null ? null : parseStored(stored);
        if (!parsed) {
          // the same work as a real check at the server's cost, against a salt that no stored hash has
          await derive(password, randomBytes(SALT_BYTES), cost);
          return false;
        }
        const key = await derive(password, parsed.salt, parsed.cost);
        return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
      }, who),
    busy: () => active,
    waiting: () => queue.length,
  };
}

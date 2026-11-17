/**
 * Passwords: what one may be, and how it is kept. A password is kept as an scrypt hash with the parameters in front of it
 * (`scrypt$15$8$1$<salt>$<hash>`, the cost as a power of two), so that the cost can be raised later and an old hash still read.
 * Hashing is slow on purpose and takes 32 MiB of memory at the default cost, so only a few may run at once: one more is refused
 * (`HashBusy`) rather than queued, because a queue of hashes is what a flood of sign-ins would build. Nothing here touches a
 * socket, a file or a clock.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** The cost of a new hash: N = 2^15, r = 8, p = 1 (docs/ACCOUNTS.md, "Passwords"). */
export const DEFAULT_COST = { logN: 15, r: 8, p: 1 } as const;
export type Cost = { logN: number; r: number; p: number };
/** How many hashes may run at the same time; one more is refused with `HashBusy` (the server answers 503). */
export const HASH_CONCURRENCY = 4;
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

export interface Hasher {
  /** The stored form of a new password. Throws `HashBusy` when `concurrency` hashes are at work already. */
  hash(password: string): Promise<string>;
  /**
   * Whether the password is the one of the stored hash. A stored value that is no hash (or null: there is no such person) is
   * checked against a hash of nothing, at the same cost, and is never right: the time an answer takes says nothing about
   * whether there is an account. Throws `HashBusy` like `hash`.
   */
  verify(password: string, stored: string | null): Promise<boolean>;
  /** How many hashes are at work now. */
  busy(): number;
}

export function createHasher(cost: Cost = DEFAULT_COST, concurrency = HASH_CONCURRENCY): Hasher {
  if (!within(cost)) throw new Error("that password cost is outside what this server will check");
  let active = 0;
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) throw new HashBusy();
    active++;
    try {
      return await work();
    } finally {
      active--;
    }
  };
  const make = async (password: string) => {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, cost);
    return `scrypt$${cost.logN}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  };
  return {
    hash: (password) => run(() => make(password)),
    verify: (password, stored) =>
      run(async () => {
        const parsed = stored === null ? null : parseStored(stored);
        if (!parsed) {
          // the same work as a real check at the server's cost, against a salt that no stored hash has
          await derive(password, randomBytes(SALT_BYTES), cost);
          return false;
        }
        const key = await derive(password, parsed.salt, parsed.cost);
        return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
      }),
    busy: () => active,
  };
}

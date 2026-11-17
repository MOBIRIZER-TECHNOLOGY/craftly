/**
 * Passwords: the stored form, what a password may be, a hash that cannot be read, the cap on hashes at once, and the dummy hash
 * for a person who does not exist. One test uses the real cost (N = 2^15) once, to show that it runs within Node's limits with
 * the `maxmem` given; the rest use the lowest cost the reader accepts, so that they are quick.
 */
import { describe, expect, it } from "vitest";
import { createHasher, DEFAULT_COST, HashBusy, normalizePassword, parseStored, passwordProblem } from "./passwords";

const cheap = { logN: 10, r: 8, p: 1 };

describe("passwords", () => {
  it("are kept as scrypt with their parameters, a 16-byte salt and a 64-byte key, at the real cost", async () => {
    const hasher = createHasher(DEFAULT_COST);
    const stored = await hasher.hash("correct horse battery");
    expect(stored).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    const parsed = parseStored(stored)!;
    expect(parsed.salt).toHaveLength(16);
    expect(parsed.hash).toHaveLength(64);
    expect(await hasher.verify("correct horse battery", stored)).toBe(true);
  });

  it("are checked: the right one passes, a wrong one, another case or one letter more does not", async () => {
    const hasher = createHasher(cheap);
    const stored = await hasher.hash("a long passphrase");
    expect(await hasher.verify("a long passphrase", stored)).toBe(true);
    for (const wrong of ["a long passphrasE", "a long passphrase ", "", "x".repeat(300)]) expect(await hasher.verify(wrong, stored)).toBe(false);
  });

  it("are salted: the same password twice is two different hashes", async () => {
    const hasher = createHasher(cheap);
    expect(await hasher.hash("same password")).not.toBe(await hasher.hash("same password"));
  });

  it("are compared in NFC, so the same letters typed two ways are one password", async () => {
    const hasher = createHasher(cheap);
    const composed = "café au lait!";
    const decomposed = "café au lait!";
    expect(normalizePassword(decomposed)).toBe(composed);
    expect(await hasher.verify(decomposed, await hasher.hash(composed))).toBe(true);
  });

  it("are 10 to 256 characters, counted as characters and not as UTF-16 units", () => {
    expect(passwordProblem("123456789")).toMatch(/at least 10/);
    expect(passwordProblem("1234567890")).toBeNull();
    expect(passwordProblem("x".repeat(256))).toBeNull();
    expect(passwordProblem("x".repeat(257))).toMatch(/at most 256/);
    // five emoji are ten UTF-16 units and five characters
    expect(passwordProblem("\u{1F600}".repeat(5))).toMatch(/at least 10/);
    expect(passwordProblem("\u{1F600}".repeat(256))).toBeNull();
    expect(passwordProblem(12345678901)).toMatch(/text/);
    expect(passwordProblem(null)).toMatch(/text/);
  });

  it("are never right against a stored value that is no hash, nor against nobody, and take a hash's time for it", async () => {
    const hasher = createHasher(cheap);
    for (const stored of [
      null,
      "",
      "plain text",
      "scrypt$15$8$1$short$short",
      `scrypt$40$8$1$${"A".repeat(22)}$${"A".repeat(86)}`,
      `scrypt$15$99$1$${"A".repeat(22)}$${"A".repeat(86)}`,
    ]) {
      expect(await hasher.verify("whatever password", stored)).toBe(false);
    }
  });

  it("refuse a stored cost the server will not spend (a damaged or planted file): too high, too low, r or p out of range", () => {
    const salt = "A".repeat(22);
    const key = "B".repeat(86);
    expect(parseStored(`scrypt$15$8$1$${salt}$${key}`)).not.toBeNull();
    expect(parseStored(`scrypt$21$8$1$${salt}$${key}`)).toBeNull();
    expect(parseStored(`scrypt$9$8$1$${salt}$${key}`)).toBeNull();
    expect(parseStored(`scrypt$15$33$1$${salt}$${key}`)).toBeNull();
    expect(parseStored(`scrypt$15$8$17$${salt}$${key}`)).toBeNull();
    expect(parseStored(`bcrypt$15$8$1$${salt}$${key}`)).toBeNull();
    expect(() => createHasher({ logN: 30, r: 8, p: 1 })).toThrow();
  });

  it("read a hash made at another cost: the cost is in the stored string", async () => {
    const old = await createHasher(cheap).hash("an older password");
    const newer = createHasher({ logN: 11, r: 8, p: 1 });
    expect(await newer.verify("an older password", old)).toBe(true);
  });

  it("run at most so many at once; one more is refused at once, not queued, and the count goes back down", async () => {
    const hasher = createHasher(cheap, 2);
    const first = hasher.hash("password one");
    const second = hasher.verify("password two", null);
    expect(hasher.busy()).toBe(2);
    await expect(hasher.hash("password three")).rejects.toBeInstanceOf(HashBusy);
    await expect(hasher.verify("password three", null)).rejects.toBeInstanceOf(HashBusy);
    await Promise.all([first, second]);
    expect(hasher.busy()).toBe(0);
    expect(await hasher.hash("password four")).toMatch(/^scrypt\$10\$/);
  });
});

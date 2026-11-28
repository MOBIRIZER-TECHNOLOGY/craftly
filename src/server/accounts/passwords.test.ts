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
});

describe("hashes waiting for a place", () => {
  /** A hash that is going, and whether it has ended yet and how. */
  const track = <T>(p: Promise<T>) => {
    const t = { done: false, busy: false, value: undefined as T | undefined };
    p.then(
      (v) => Object.assign(t, { done: true, value: v }),
      (e: unknown) => Object.assign(t, { done: true, busy: e instanceof HashBusy }),
    );
    return Object.assign(
      p.catch(() => undefined),
      { t },
    );
  };

  it("run at most so many at once, keep one place for a person known at the address, and count back down", async () => {
    const hasher = createHasher(cheap, 2, { waitMs: 10_000 });
    const first = track(hasher.verify("one", null, { address: "a" }));
    // a second from somewhere new waits: the other place is kept
    const second = track(hasher.verify("two", null, { address: "b" }));
    expect(hasher.busy()).toBe(1);
    expect(hasher.waiting()).toBe(1);
    // a known person takes the kept place at once
    const known = track(hasher.verify("three", null, { address: "c", known: true }));
    expect(hasher.busy()).toBe(2);
    await Promise.all([first, second, known]);
    expect([first.t.busy, second.t.busy, known.t.busy]).toEqual([false, false, false]);
    expect(hasher.busy()).toBe(0);
    expect(hasher.waiting()).toBe(0);
  });

  it("let a known person waiting go before those who came earlier", async () => {
    const hasher = createHasher(cheap, 2, { waitMs: 10_000 });
    const order: string[] = [];
    const go = (name: string, known = false) => hasher.verify(name, null, { address: name, known }).then(() => order.push(name));
    // the known one takes the kept place, the new one the other; then three more wait
    const all = [go("k1", true), go("n1"), go("n2"), go("n3"), go("k2", true)];
    expect(hasher.waiting()).toBe(3);
    await Promise.all(all);
    expect(order.indexOf("k2")).toBeLessThan(order.indexOf("n3"));
  });

  it("refuse one more from an address that has as many going as it may, and one more when the queue is full", async () => {
    const hasher = createHasher(cheap, 2, { waiting: 2, perAddress: 2, waitMs: 10_000 });
    const mine = [track(hasher.hash("a1", { address: "a" })), track(hasher.hash("a2", { address: "a" }))];
    await expect(hasher.hash("a3", { address: "a" })).rejects.toBeInstanceOf(HashBusy);
    // the queue holds a2 and one more
    const other = track(hasher.hash("b1", { address: "b" }));
    await expect(hasher.hash("c1", { address: "c" })).rejects.toBeInstanceOf(HashBusy);
    await Promise.all([...mine, other]);
    expect([...mine, other].map((m) => m.t.busy)).toEqual([false, false, false]);
    // and the address may go again once its hashes have ended
    expect(await hasher.hash("a4", { address: "a" })).toMatch(/^scrypt\$10\$/);
  });

  it("refuse a hash that has waited too long, and forget it", async () => {
    const hasher = createHasher(DEFAULT_COST, 1, { waitMs: 1 });
    const slow = track(hasher.verify("slow one", null, { address: "a" }));
    await expect(hasher.verify("in a hurry", null, { address: "b" })).rejects.toBeInstanceOf(HashBusy);
    expect(hasher.waiting()).toBe(0);
    await slow;
    expect(slow.t.busy).toBe(false);
  });

  it("let a person known at their address in during a flood from many new addresses", async () => {
    const hasher = createHasher(cheap, 4, { waiting: 8, waitMs: 10_000 });
    const flood = Array.from({ length: 200 }, (_, i) => track(hasher.verify("guess", null, { address: `bot-${i}` })));
    const person = track(hasher.verify("mine", null, { address: "home", known: true }));
    await Promise.all([...flood, person]);
    expect(person.t.busy).toBe(false);
    // the flood was mostly turned away, by the full queue, not let pile up
    expect(flood.filter((f) => f.t.busy).length).toBeGreaterThan(150);
  });

  it("with one place, keep none: everybody shares it", async () => {
    const hasher = createHasher(cheap, 1, { waitMs: 10_000 });
    const a = track(hasher.verify("a", null, { address: "a" }));
    expect(hasher.busy()).toBe(1);
    const b = track(hasher.verify("b", null, { address: "b" }));
    expect(hasher.waiting()).toBe(1);
    await Promise.all([a, b]);
    expect([a.t.busy, b.t.busy]).toEqual([false, false]);
  });
});

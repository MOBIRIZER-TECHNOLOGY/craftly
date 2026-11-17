/**
 * Account storage, in memory and in files (a temporary folder each): every kind of record goes in and comes back, the race for
 * one email has exactly one winner, a damaged file is refused with an error and not taken for a record that is not there, names
 * that are not ids are refused before anything touches the disk, and the ids a browser chooses are hashed into file names.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyManifest, FileAccounts, MemoryAccounts, type AccountStorage, type Manifest, type TeamRecord, type UserRecord } from "./storage";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "craftly-accounts-"));
  dirs.push(dir);
  return dir;
};

const USER = "u".repeat(22);
const OTHER = "v".repeat(22);
const TEAM = "t".repeat(22);
const HASH = "a".repeat(64);
const user = (id = USER, extra: Partial<UserRecord> = {}): UserRecord => ({
  id,
  email: `${id}@example.org`,
  name: "Ann",
  pw: "scrypt$15$8$1$x$y",
  recoveryHash: HASH,
  disabled: false,
  createdAt: 1,
  sessions: {},
  teams: [],
  ...extra,
});
const team = (): TeamRecord => ({
  id: TEAM,
  name: "Studio",
  createdAt: 2,
  members: { [USER]: "owner", [OTHER]: "viewer" },
  invites: [{ id: "inv1", hash: HASH, role: "editor", usesLeft: 3, expiresAt: 99, createdAt: 2 }],
});
const manifest = (): Manifest => ({
  seq: 3,
  designs: {
    "d:1": { rev: 2, metaSeq: 1, seq: 3, title: "Poster", folderId: "f1", starred: true, trashedAt: null, bytes: 10, updatedAt: 5, versions: [{ rev: 1, bytes: 9, at: 4 }] },
  },
  folders: { f1: { name: "Work", parentId: null, createdAt: 1, seq: 1 } },
  assets: { a1: { mime: "image/png", bytes: 8, seq: 2, createdAt: 3 } },
});

const kinds: [string, () => Promise<AccountStorage>][] = [
  ["memory", async () => new MemoryAccounts()],
  ["files", async () => new FileAccounts(await tempDir())],
];

for (const [kind, make] of kinds) {
  describe(`account storage (${kind})`, () => {
    it("keeps people, finds nobody who is not there, lists and removes them", async () => {
      const s = await make();
      expect(await s.loadUser(USER)).toBeNull();
      await s.saveUser(user(USER, { sessions: { s1: HASH }, teams: [TEAM] }));
      await s.saveUser(user(OTHER));
      expect(await s.loadUser(USER)).toEqual(user(USER, { sessions: { s1: HASH }, teams: [TEAM] }));
      expect((await s.listUsers()).sort()).toEqual([USER, OTHER].sort());
      await s.removeUser(OTHER);
      expect(await s.listUsers()).toEqual([USER]);
      await s.removeUser(OTHER); // twice is no error
    });

    it("gives an email to one person: the second claim is refused by the storage, and a released one can be claimed again", async () => {
      const s = await make();
      expect(await s.emailOwner("ann@example.org")).toBeNull();
      expect(await s.claimEmail("ann@example.org", USER)).toBe(true);
      expect(await s.claimEmail("ann@example.org", OTHER)).toBe(false);
      expect(await s.emailOwner("ann@example.org")).toBe(USER);
      await s.releaseEmail("ann@example.org");
      expect(await s.claimEmail("ann@example.org", OTHER)).toBe(true);
      expect(await s.emailOwner("ann@example.org")).toBe(OTHER);
    });

    it("has exactly one winner when twenty claim one email at the same moment", async () => {
      const s = await make();
      const ids = Array.from({ length: 20 }, (_, i) => `${"p".repeat(20)}${String(i).padStart(2, "0")}`);
      const results = await Promise.all(ids.map((id) => s.claimEmail("race@example.org", id)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await s.emailOwner("race@example.org")).toBe(ids[results.indexOf(true)]);
    });

    it("keeps sessions, teams and codes of each kind", async () => {
      const s = await make();
      const session = { id: "s1", userId: USER, device: "Laptop", createdAt: 1, lastUsedAt: 2, expiresAt: 3 };
      await s.saveSession(HASH, session);
      expect(await s.loadSession(HASH)).toEqual(session);
      await s.removeSession(HASH);
      expect(await s.loadSession(HASH)).toBeNull();
      await s.saveTeam(team());
      expect(await s.loadTeam(TEAM)).toEqual(team());
      await s.removeTeam(TEAM);
      expect(await s.loadTeam(TEAM)).toBeNull();
      const codes = [
        { kind: "signup" as const, usesLeft: 2, expiresAt: 9, createdAt: 1 },
        { kind: "invite" as const, teamId: TEAM, inviteId: "inv1" },
        { kind: "reset" as const, userId: USER, expiresAt: 9, createdAt: 1 },
      ];
      for (const code of codes) {
        await s.saveCode(HASH, code);
        expect(await s.loadCode(HASH)).toEqual(code);
      }
      await s.removeCode(HASH);
      expect(await s.loadCode(HASH)).toBeNull();
    });

    it("keeps a space: an empty manifest before anything, then designs with revisions, uploads, and removes it whole", async () => {
      const s = await make();
      expect(await s.loadManifest(USER)).toEqual(emptyManifest());
      await s.saveManifest(USER, manifest());
      expect(await s.loadManifest(USER)).toEqual(manifest());
      const stored = (rev: number) => JSON.stringify({ rev, design: { id: "d:1", title: `r${rev}` }, thumbnail: null });
      await s.saveVersion(USER, "d:1", 2, stored(2));
      await s.saveVersion(USER, "d:1", 1, stored(1));
      expect((await s.loadVersion(USER, "d:1", 2))!.design.title).toBe("r2");
      expect((await s.loadVersion(USER, "d:1", 1))!.rev).toBe(1);
      expect(await s.loadVersion(USER, "D:1", 2)).toBeNull(); // ids that differ only in capitals are two designs
      await s.removeVersion(USER, "d:1", 1);
      expect(await s.loadVersion(USER, "d:1", 1)).toBeNull();
      await s.saveVersion(USER, "d:1", 1, stored(1));
      await s.saveAsset(USER, "a1", { mime: "image/png", base64: "AAAA" });
      expect(await s.loadAsset(USER, "a1")).toEqual({ mime: "image/png", base64: "AAAA" });
      await s.removeDesign(USER, "d:1");
      expect(await s.loadVersion(USER, "d:1", 2)).toBeNull();
      expect(await s.loadVersion(USER, "d:1", 1)).toBeNull();
      await s.removeAsset(USER, "a1");
      expect(await s.loadAsset(USER, "a1")).toBeNull();
      await s.saveAsset(USER, "a2", { mime: "image/png", base64: "AAAA" });
      await s.removeSpace(USER);
      expect(await s.loadManifest(USER)).toEqual(emptyManifest());
      expect(await s.loadAsset(USER, "a2")).toBeNull();
    });

    it("refuses names that are not ids before it touches anything", async () => {
      const s = await make();
      for (const bad of ["", "short", "../../etc/passwd", "a/b".repeat(8), "x".repeat(65), "ü".repeat(20)]) {
        await expect(s.loadUser(bad)).rejects.toThrow(/not the id/);
        await expect(s.loadTeam(bad)).rejects.toThrow(/not the id/);
        await expect(s.loadManifest(bad)).rejects.toThrow(/not the id/);
      }
      await expect(s.loadSession("../x")).rejects.toThrow(/not a hash/);
      await expect(s.loadCode("A".repeat(64))).rejects.toThrow(/not a hash/);
      await expect(s.loadVersion(USER, "d", -1)).rejects.toThrow(/not a revision/);
      await expect(s.loadVersion(USER, "d", 1.5)).rejects.toThrow(/not a revision/);
      await expect(s.claimEmail("a@b", "../x")).rejects.toThrow(/not the id/);
    });
  });
}

describe("account storage in files", () => {
  it("is plain JSON files under the folder, with the ids of a browser hashed into names", async () => {
    const dir = await tempDir();
    const s = new FileAccounts(dir);
    await s.saveUser(user());
    await s.saveManifest(USER, manifest());
    await s.saveVersion(USER, "d:1", 1, JSON.stringify({ rev: 1, design: { id: "d:1" }, thumbnail: null }));
    expect(JSON.parse(await readFile(join(dir, "users", `${USER}.json`), "utf8"))).toEqual(user());
    const names = await readdir(join(dir, "spaces", USER, "designs"));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(await readdir(join(dir, "spaces", USER, "designs", names[0]))).toEqual(["1.json"]);
    // nothing is left of the temporary names a write uses
    expect((await readdir(join(dir, "users"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a damaged file with an error that says so, and does not take it for a record that is not there", async () => {
    const dir = await tempDir();
    const s = new FileAccounts(dir);
    await s.saveUser(user());
    await s.saveTeam(team());
    await s.saveManifest(USER, manifest());
    await s.saveSession(HASH, { id: "s", userId: USER, device: "", createdAt: 1, lastUsedAt: 1, expiresAt: 1 });
    await writeFile(join(dir, "users", `${USER}.json`), "{ not json");
    await expect(s.loadUser(USER)).rejects.toThrow(/person is damaged: it is not JSON/);
    await writeFile(join(dir, "users", `${USER}.json`), JSON.stringify({ ...user(), sessions: { s: "not a hash" } }));
    await expect(s.loadUser(USER)).rejects.toThrow(/does not hold a person/);
    await writeFile(join(dir, "teams", `${TEAM}.json`), JSON.stringify({ ...team(), members: { [USER]: "admin" } }));
    await expect(s.loadTeam(TEAM)).rejects.toThrow(/does not hold a team/);
    await writeFile(join(dir, "spaces", USER, "manifest.json"), JSON.stringify({ ...manifest(), seq: -1 }));
    await expect(s.loadManifest(USER)).rejects.toThrow(/does not hold a space/);
    await writeFile(join(dir, "sessions", `${HASH}.json`), "[]");
    await expect(s.loadSession(HASH)).rejects.toThrow(/does not hold a session/);
    await writeFile(join(dir, "users", `${USER}.json`), "");
    await expect(s.loadUser(USER)).rejects.toThrow(/damaged/);
  });

  it("keeps everything across a new instance on the same folder, as after a restart", async () => {
    const dir = await tempDir();
    const first = new FileAccounts(dir);
    await first.saveUser(user());
    expect(await first.claimEmail("ann@example.org", USER)).toBe(true);
    await first.saveManifest(USER, manifest());
    const second = new FileAccounts(dir);
    expect(await second.loadUser(USER)).toEqual(user());
    expect(await second.emailOwner("ann@example.org")).toBe(USER);
    expect(await second.claimEmail("ann@example.org", OTHER)).toBe(false);
    expect(await second.loadManifest(USER)).toEqual(manifest());
    await second.checkWritable();
  });
});

describe("account storage in memory", () => {
  it("refuses a damaged record the same way", async () => {
    const s = new MemoryAccounts();
    await s.saveUser(user());
    s.setRawText(`users/${USER}.json`, "{");
    await expect(s.loadUser(USER)).rejects.toThrow(/damaged/);
  });
});

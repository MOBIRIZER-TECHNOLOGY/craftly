/**
 * The files a server that stopped half-way leaves behind (leftovers.ts): removed at the next start, from every folder the data is
 * kept in, and nothing else with them.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeLeftovers } from "./leftovers";
import { FileStorage } from "./storage";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "craftly-leftovers-"));
  dirs.push(dir);
  return dir;
}

describe("what an earlier run left half-written", () => {
  it("is removed from the rooms, their clips, and the accounts' spaces, and counted", async () => {
    const dir = await folder();
    const media = join(dir, "abc.media");
    const space = join(dir, "accounts", "spaces", "u1", "media");
    await mkdir(media, { recursive: true });
    await mkdir(space, { recursive: true });
    await writeFile(join(media, "0123456789abcdef.tmp"), "x".repeat(3000));
    await writeFile(join(space, "fedcba9876543210.tmp"), "y".repeat(100));
    await writeFile(join(dir, "abc.json.0a1b2c3d4e5f.tmp"), "{");
    expect(await removeLeftovers(dir)).toEqual({ files: 3, bytes: 3101 });
    expect(await readdir(media)).toEqual([]);
    expect(await readdir(space)).toEqual([]);
    expect(await readdir(dir)).toEqual(expect.not.arrayContaining([expect.stringMatching(/\.tmp$/)]));
  });

  it("leaves everything else, a .tmp file of another name among it", async () => {
    const dir = await folder();
    const keep = ["abc.json", "notes.tmp", "abc.json.tmp", "0123456789abcdef.bin", "0123456789ABCDEF.tmp"];
    for (const name of keep) await writeFile(join(dir, name), "k");
    expect(await removeLeftovers(dir)).toEqual({ files: 0, bytes: 0 });
    expect((await readdir(dir)).sort()).toEqual([...keep].sort());
  });

  it("does not follow a link out of the folder", async () => {
    const dir = await folder();
    const outside = await folder();
    await writeFile(join(outside, "0123456789abcdef.tmp"), "theirs");
    try {
      await symlink(outside, join(dir, "link"), "junction");
    } catch {
      return; // this machine does not let a test make links
    }
    expect(await removeLeftovers(dir)).toEqual({ files: 0, bytes: 0 });
    expect(existsSync(join(outside, "0123456789abcdef.tmp"))).toBe(true);
  });

  it("is nothing at all for a data folder that is not there yet", async () => {
    expect(await removeLeftovers(join(await folder(), "not-yet"))).toEqual({ files: 0, bytes: 0 });
  });

  it("includes the file of a clip the room was receiving when it stopped, and the room's clips stay", async () => {
    const dir = await folder();
    const storage = new FileStorage(dir);
    async function* body() {
      yield Buffer.from("a clip");
    }
    const kept = await storage.stageMedia("room_0123456789abcdef", body(), 1000);
    await storage.commitMedia("room_0123456789abcdef", "a_clip", kept!, "video/mp4");
    const stuck = await storage.stageMedia("room_0123456789abcdef", body(), 1000); // never put in place nor thrown away: the server stopped
    expect(existsSync(stuck!.handle)).toBe(true);
    expect((await removeLeftovers(dir)).files).toBe(1);
    expect(existsSync(stuck!.handle)).toBe(false);
    expect(await storage.mediaInfo("room_0123456789abcdef", "a_clip")).toMatchObject({ mime: "video/mp4" });
  });
});

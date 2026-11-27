/**
 * The clips and sounds of a shared design on the live server (docs/COLLABORATION.md, "Clips and sounds"): streamed in and out as
 * themselves, of the types the app keeps, under the limits of a file and of a room, with the keys of the room, in memory and on disk.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { createLiveServer, type LiveServerOptions } from "./live";
import { FileStorage, MemoryStorage, type LiveStorage } from "./storage";

const servers: Array<{ close(): Promise<void> }> = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function boot(options: Partial<LiveServerOptions> = {}, storage: LiveStorage = new MemoryStorage()) {
  const server = createLiveServer({ storage, ...options });
  servers.push(server);
  const { port } = await server.listen(0);
  return { storage, http: `http://127.0.0.1:${port}` };
}
type Booted = Awaited<ReturnType<typeof boot>>;
type Made = { room: string; editKey: string; viewKey: string; ownerKey: string };

async function makeRoom(b: Booted): Promise<Made> {
  const design = createDesign({ title: "Clips", width: 400, height: 300, pages: [createPage({})] });
  const res = await fetch(`${b.http}/api/rooms`, { method: "POST", body: JSON.stringify({ design }) });
  expect(res.status).toBe(201);
  return (await res.json()) as Made;
}

const at = (b: Booted, made: Made, id: string) => `${b.http}/api/rooms/${made.room}/media/${id}`;
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const put = (b: Booted, made: Made, id: string, body: Uint8Array, mime = "video/mp4", key = made.editKey) =>
  fetch(at(b, made, id), { method: "PUT", headers: { "x-craftly-key": key, "content-type": mime }, body: new Blob([body as BlobPart]) });
const get = (b: Booted, made: Made, id: string, method = "GET", key = made.viewKey) => fetch(at(b, made, id), { method, headers: { "x-craftly-key": key } });

describe("the clips and sounds of a room", () => {
  it("takes a clip as it is and gives it back as a download of its type, to whoever has a key of the room", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    const clip = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    expect((await put(b, made, "a_clip", clip)).status).toBe(201);
    const res = await get(b, made, "a_clip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe("5000");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(clip);
    // HEAD says it is there without sending it
    const head = await get(b, made, "a_clip", "HEAD");
    expect([head.status, head.headers.get("content-length")]).toEqual([200, "5000"]);
    expect((await get(b, made, "a_song")).status).toBe(404);
    expect((await get(b, made, "a_song", "HEAD")).status).toBe(404);
  });

  it("takes sounds too, under the types the app keeps, and nothing else", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect((await put(b, made, "a_song", bytes(10), "audio/mpeg")).status).toBe(201);
    expect((await put(b, made, "a_voice", bytes(10), "audio/wav; codecs=1")).status).toBe(201);
    for (const mime of ["text/html", "image/png", "application/octet-stream", "video/x-msvideo", ""]) expect((await put(b, made, "a_x", bytes(10), mime)).status).toBe(415);
    expect(await b.storage.mediaInfo(made.room, "a_x")).toBeNull();
  });

  it("lets only a key that edits put one in, and refuses an id that is no id", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect((await put(b, made, "a_clip", bytes(10), "video/mp4", made.viewKey)).status).toBe(403);
    expect((await put(b, made, "a_clip", bytes(10), "video/mp4", "nope")).status).toBe(403);
    expect((await get(b, made, "a_clip", "GET", "nope")).status).toBe(403);
    expect((await put(b, made, "a%20clip", bytes(10))).status).toBe(400);
    expect((await fetch(`${b.http}/api/rooms/${"x".repeat(22)}/media/a_clip`, { headers: { "x-craftly-key": made.viewKey } })).status).toBe(404);
  });

  it("takes the same clip again without a word, and refuses another under an id that is taken", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect((await put(b, made, "a_clip", bytes(10, 1))).status).toBe(201);
    expect((await put(b, made, "a_clip", bytes(10, 1))).status).toBe(200);
    expect((await put(b, made, "a_clip", bytes(10, 2))).status).toBe(409);
    expect((await put(b, made, "a_clip", bytes(10, 1), "video/webm")).status).toBe(409);
    expect(await b.storage.mediaBytes(made.room)).toBe(10);
  });

  it("refuses a clip larger than a file may be, and more than a room may hold, before reading it", async () => {
    const b = await boot({ maxMediaBytes: 1000, maxRoomMediaBytes: 2500 });
    const made = await makeRoom(b);
    const big = await put(b, made, "a_big", bytes(1001));
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: string; limit: number }).limit).toBe(1000);
    expect((await put(b, made, "a_1", bytes(1000))).status).toBe(201);
    expect((await put(b, made, "a_2", bytes(1000))).status).toBe(201);
    const full = await put(b, made, "a_3", bytes(600));
    expect(full.status).toBe(413);
    expect(((await full.json()) as { error: string }).error).toMatch(/storage limit for clips/);
    expect((await put(b, made, "a_3", bytes(500))).status).toBe(201);
    // another room has an allowance of its own; and a server that keeps none takes none
    expect((await put(b, await makeRoom(b), "a_1", bytes(1000))).status).toBe(201);
    const none = await boot({ maxMediaBytes: 0 });
    expect((await put(none, await makeRoom(none), "a_1", bytes(1))).status).toBe(413);
  });

  it("keeps 100 MiB a clip and 500 MiB a room unless it is told otherwise", async () => {
    class Full extends MemoryStorage {
      override async mediaBytes() {
        return 500 * 1024 * 1024 - 10;
      }
    }
    const b = await boot({}, new Full());
    const made = await makeRoom(b);
    expect((await put(b, made, "a_1", bytes(10))).status).toBe(201);
    expect((await put(b, made, "a_2", bytes(11))).status).toBe(413);
  });

  it("forgets the clips with the room", async () => {
    const b = await boot();
    const made = await makeRoom(b);
    expect((await put(b, made, "a_clip", bytes(10))).status).toBe(201);
    expect((await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } })).status).toBe(200);
    expect(await b.storage.mediaInfo(made.room, "a_clip")).toBeNull();
    expect(await b.storage.mediaBytes(made.room)).toBe(0);
  });
});

describe("the clips of a room on disk", () => {
  const disk = () => {
    const dir = mkdtempSync(join(tmpdir(), "craftly-media-"));
    dirs.push(dir);
    return { dir, storage: new FileStorage(dir) };
  };

  it("are files beside the room, streamed in and out, and go with it", async () => {
    const { dir, storage } = disk();
    const b = await boot({}, storage);
    const made = await makeRoom(b);
    const clip = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256);
    expect((await put(b, made, "a_clip", clip, "audio/ogg")).status).toBe(201);
    const folder = join(dir, `${made.room}.media`);
    const names = readdirSync(folder).sort();
    expect(names.map((n) => n.replace(/^[0-9a-f]{64}/, "<hash>"))).toEqual(["<hash>.bin", "<hash>.json"]);
    expect(await storage.mediaInfo(made.room, "a_clip")).toMatchObject({ mime: "audio/ogg", size: 300_000 });
    expect(await storage.mediaBytes(made.room)).toBe(300_000);
    expect(new Uint8Array(await (await get(b, made, "a_clip")).arrayBuffer())).toEqual(clip);
    expect((await fetch(`${b.http}/api/rooms/${made.room}`, { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } })).status).toBe(200);
    expect(existsSync(folder)).toBe(false);
  });

  it("leave nothing behind of one that was longer than it said, or refused", async () => {
    const { dir, storage } = disk();
    const b = await boot({}, storage);
    const made = await makeRoom(b);
    // the store is asked for a clip of at most 10 bytes and is sent 20
    async function* twenty() {
      yield Buffer.alloc(20);
    }
    expect(await storage.stageMedia(made.room, twenty(), 10)).toBeNull();
    expect((await put(b, made, "a_clip", bytes(10, 1))).status).toBe(201);
    expect((await put(b, made, "a_clip", bytes(10, 2))).status).toBe(409);
    expect(readdirSync(join(dir, `${made.room}.media`)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(await storage.mediaInfo(made.room, "other")).toBeNull();
  });
});

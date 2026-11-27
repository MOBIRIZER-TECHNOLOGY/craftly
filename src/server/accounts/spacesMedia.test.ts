/**
 * The clips and sounds of a space (docs/ACCOUNTS.md, "Clips and sounds"), through the real server: streamed in and out as
 * themselves, of the types the app keeps, under the limit of a file and the space's quota, listed apart from the pictures, kept
 * on disk across a restart and gone with the space.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAccounts } from "./storage";
import { boot, call, closeAll, ORIGIN, signUp, type Booted } from "./testServer";

const dirs: string[] = [];
afterEach(async () => {
  await closeAll();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

async function person(b: Booted) {
  const { token, user } = await signUp(b);
  const at = (id: string) => `${b.base}/api/spaces/${user.id}/media/${id}`;
  return {
    token,
    user,
    put: (id: string, body: Uint8Array, mime = "video/mp4") =>
      fetch(at(id), { method: "PUT", headers: { origin: ORIGIN, authorization: `Bearer ${token}`, "content-type": mime }, body: new Blob([body as BlobPart]) }),
    get: (id: string, method = "GET", as = token) => fetch(at(id), { method, headers: { origin: ORIGIN, authorization: `Bearer ${as}` } }),
  };
}

describe("the clips and sounds of a space", () => {
  it("are kept as they came and given back as a download of their type; HEAD says whether one is there", async () => {
    const b = await boot();
    const p = await person(b);
    const clip = Uint8Array.from({ length: 4000 }, (_, i) => i % 251);
    expect((await p.put("a_clip", clip)).status).toBe(201);
    const res = await p.get("a_clip");
    expect(res.status).toBe(200);
    expect([res.headers.get("content-type"), res.headers.get("content-length"), res.headers.get("content-disposition"), res.headers.get("x-content-type-options")]).toEqual([
      "video/mp4",
      "4000",
      "attachment",
      "nosniff",
    ]);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(clip);
    expect((await p.get("a_clip", "HEAD")).status).toBe(200);
    expect((await p.get("a_other", "HEAD")).status).toBe(404);
    expect((await p.get("a_other")).status).toBe(404);
  });

  it("take sounds of the types the app keeps, and nothing else", async () => {
    const b = await boot();
    const p = await person(b);
    expect((await p.put("a_song", bytes(10), "audio/flac")).status).toBe(201);
    for (const mime of ["text/html", "image/png", "application/octet-stream"]) expect((await p.put("a_x", bytes(10), mime)).status).toBe(415);
  });

  it("are listed apart from the pictures, and the same clip again changes nothing while another under its id is refused", async () => {
    const b = await boot();
    const p = await person(b);
    expect((await p.put("a_clip", bytes(10, 1))).status).toBe(201);
    expect((await p.put("a_clip", bytes(10, 1))).status).toBe(200);
    const other = await p.put("a_clip", bytes(10, 2));
    expect(other.status).toBe(409);
    expect(((await other.json()) as { code: string }).code).toBe("exists");
    const m = await b.storage.loadManifest(p.user.id);
    expect(m.assets).toEqual({});
    expect(m.media?.a_clip).toMatchObject({ mime: "video/mp4", bytes: 10 });
    expect(m.media?.a_clip.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("are refused larger than a file may be, or past the space's quota, which they count towards", async () => {
    const b = await boot({ maxMediaBytes: 1000, spaceQuotaBytes: 2500 });
    const p = await person(b);
    const big = await p.put("a_big", bytes(1001));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ code: "too-big", limit: 1000 });
    expect((await p.put("a_1", bytes(1000))).status).toBe(201);
    expect((await p.put("a_2", bytes(1000))).status).toBe(201);
    const full = await p.put("a_3", bytes(600));
    expect(full.status).toBe(413);
    expect(((await full.json()) as { code: string }).code).toBe("quota");
    expect((await p.put("a_3", bytes(400))).status).toBe(201);
  });

  it("are for those who may reach the space: nobody else gets or puts one", async () => {
    const b = await boot();
    const p = await person(b);
    const stranger = await signUp(b);
    expect((await p.put("a_clip", bytes(10))).status).toBe(201);
    expect((await p.get("a_clip", "GET", stranger.token)).status).toBe(404);
    const theirs = await call(b, "PUT", `/api/spaces/${p.user.id}/media/a_x`, { token: stranger.token, raw: "x", headers: { "content-type": "video/mp4" } });
    expect(theirs.status).toBe(404);
    expect((await p.put("not an id!", bytes(10))).status).toBe(400);
  });

  it("are files beside the space's other files, kept across a restart, and leave nothing behind when refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "craftly-space-media-"));
    dirs.push(dir);
    const storage = new FileAccounts(dir);
    const b = await boot({}, {}, { storage });
    const p = await person(b);
    const clip = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 3) % 256);
    expect((await p.put("a_clip", clip, "audio/ogg")).status).toBe(201);
    expect((await p.put("a_clip", bytes(10))).status).toBe(409);
    const folder = join(dir, "spaces", p.user.id, "media");
    const names = await readdir(folder);
    expect(names.map((n) => n.replace(/^[0-9a-f]{64}/, "<hash>"))).toEqual(["<hash>.bin"]);
    await closeAll();
    const again = await boot({}, {}, { storage: new FileAccounts(dir) });
    const res = await fetch(`${again.base}/api/spaces/${p.user.id}/media/a_clip`, { headers: { origin: ORIGIN, authorization: `Bearer ${p.token}` } });
    expect(res.headers.get("content-type")).toBe("audio/ogg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(clip);
    await storage.removeSpace(p.user.id);
    expect(existsSync(folder)).toBe(false);
  });
});

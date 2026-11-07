import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import config from "../../vite.config";

/**
 * On Windows (seen with Node 24 and 26 on Windows 11), a folder that has a file watch on it and is then deleted makes the
 * watch send "rename" events for as long as it lives, about 100,000 a second, which keeps a dev server at two or three CPU
 * cores until it is stopped. A coverage run deletes and rewrites coverage/, a build deletes dist/assets/: the dev server must
 * not hold a watch on any folder like that. This starts a real Vite server, with this project's watch settings, in a
 * temporary folder and does to the generated folders what those tools do.
 */
const GENERATED = ["coverage", "dist", "dist-e2e"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fill(root: string, folder: string) {
  mkdirSync(join(root, folder, "assets"), { recursive: true });
  writeFileSync(join(root, folder, "index.html"), "<!doctype html>\n");
  writeFileSync(join(root, folder, "assets", "a.js"), "export {};\n");
}

describe("the dev server's file watcher", () => {
  let root = "";
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it("holds no watch on the folders that tools delete and write again, so deleting them starts no flood of events", async () => {
    root = mkdtempSync(join(tmpdir(), "craftly-watch-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "export {};\n");
    for (const folder of GENERATED) fill(root, folder);

    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      appType: "custom",
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: config.server?.watch },
    });
    let raw = 0;
    server.watcher.on("raw", () => {
      raw++;
    });
    // the first scan of the folders has to be finished before they are touched
    for (let waited = 0; waited < 5000 && !Object.keys(server.watcher.getWatched()).some((dir) => dir.endsWith("src")); waited += 25) await sleep(25);

    for (const folder of GENERATED) {
      rmSync(join(root, folder), { recursive: true, force: true });
      fill(root, folder);
    }
    await sleep(1500);

    const watched = Object.keys(server.watcher.getWatched()).map((dir) => dir.replace(/\\/g, "/"));
    expect.soft(watched.filter((dir) => GENERATED.some((folder) => dir.includes(`/${folder}`)))).toEqual([]);
    expect.soft(raw).toBeLessThan(500); // a few for the root folder itself; a watch on a deleted folder sends 100,000 a second
  });
});

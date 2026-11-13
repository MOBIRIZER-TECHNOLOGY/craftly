/*
 * Starts the bundle of the live server as an operator would and checks that it works: `node dist-server/live.mjs` on a free
 * port with an empty temporary data folder, GET /api/health until it answers 200, POST /api/rooms with a small design (201
 * with a room and three keys, and the data folder is no longer empty), then SIGTERM and exit code 0. Anything else fails
 * with exit code 1 and prints what the server wrote.
 *
 *   npm run server:smoke      (builds the bundle first: npm run server:build)
 *
 * It tests the built file, not the sources: the unit tests of src/server run the TypeScript, and nothing else runs what
 * esbuild writes. On Windows a process cannot be asked to stop (kill ends it at once), so the clean exit is checked on
 * Linux and macOS only, which is where CI runs.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "dist-server", "live.mjs");
const START_MS = 20_000;
const STOP_MS = 10_000;
const windows = process.platform === "win32";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A port that was free a moment ago: the system chooses one, and it is given back before the server takes it. */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

/** The smallest design the server accepts: a title, a size and one empty page. */
const design = {
  id: "d-smoke",
  title: "Smoke test",
  typeId: "custom",
  width: 800,
  height: 600,
  unit: "px",
  pages: [{ id: "p-smoke", background: { type: "solid", color: "#ffffff" }, elements: [] }],
  createdAt: 0,
  updatedAt: 0,
  folderId: null,
  starred: false,
  trashedAt: null,
  version: 1,
};

async function main() {
  if (!existsSync(bundle)) throw new Error(`${bundle} is not there: run "npm run server:build" first (npm run server:smoke does).`);

  const port = await freePort();
  const workDir = mkdtempSync(join(tmpdir(), "craftly-smoke-"));
  const dataDir = join(workDir, "data"); // not made here: the server makes its data folder, as on a first start
  // Only what Node needs to start, and the three settings: a setting of the server in the caller's environment (a key for
  // making rooms, say) must not change what is tested.
  const env = { PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir };
  for (const name of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME"]) if (process.env[name]) env[name] = process.env[name];

  let output = "";
  const child = spawn(process.execPath, [bundle], { cwd: workDir, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
  let exit = null;
  void exited.then((result) => (exit = result));

  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + START_MS;
    for (;;) {
      if (exit) throw new Error(`the server stopped while starting (exit code ${exit.code}, signal ${exit.signal})`);
      const status = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) }).then(
        (res) => res.status,
        () => 0,
      );
      if (status === 200) break;
      if (Date.now() > deadline) throw new Error(`GET /api/health did not answer 200 within ${START_MS / 1000} s (last status: ${status || "no answer"})`);
      await sleep(100);
    }

    const res = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ design }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (res.status !== 201) throw new Error(`POST /api/rooms answered ${res.status}, not 201: ${text}`);
    const made = JSON.parse(text);
    for (const field of ["room", "editKey", "viewKey", "ownerKey"]) {
      if (typeof made[field] !== "string" || !made[field]) throw new Error(`POST /api/rooms: the answer has no ${field}`);
    }
    if (!existsSync(dataDir) || readdirSync(dataDir).length === 0) throw new Error(`the room was made, but nothing was written to the data folder ${dataDir}`);

    child.kill("SIGTERM");
    const stopped = await Promise.race([exited, sleep(STOP_MS).then(() => null)]);
    if (!stopped) throw new Error(`the server was still running ${STOP_MS / 1000} s after SIGTERM`);
    if (!windows && stopped.code !== 0) throw new Error(`the server did not stop cleanly after SIGTERM (exit code ${stopped.code}, signal ${stopped.signal})`);

    console.log(
      `Server bundle: started on port ${port}, health 200, room made, ${windows ? "ended (a clean exit cannot be checked on Windows)" : "stopped cleanly (exit code 0)"}.`,
    );
  } catch (error) {
    if (output.trim()) console.error(`--- what the server wrote ---\n${output.trimEnd()}\n-----------------------------`);
    throw error;
  } finally {
    if (!exit) {
      child.kill("SIGKILL");
      await Promise.race([exited, sleep(2000)]);
    }
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`Server smoke test failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  },
);

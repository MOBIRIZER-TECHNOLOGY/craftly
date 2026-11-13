/*
 * The operator's view of a live server: which rooms it holds, and removing one. It asks the server (GET and DELETE under
 * /api/admin/rooms, src/server/live.ts), so the server has to run and to have an ADMIN_KEY; without one it has no such
 * interface, and this prints what it answers.
 *
 *   npm run server:rooms -- list             every room: id, title, made, last used, size of design and images, people in it
 *   npm run server:rooms -- delete <id>      removes that room; whoever is in it is sent away, as when its owner stops sharing
 *
 * From the environment, and from nowhere else (an argument would be in the shell's history and in the list of processes):
 *   CRAFTLY_SERVER   where the server is; http://127.0.0.1:8787 when not set. Ask the server itself, on its own machine or
 *                    through a tunnel, and not through the proxy: the key travels in a header and deserves TLS or no network.
 *   ADMIN_KEY        the key the server was started with
 *
 * Nothing here can list or show a key of a room: the server has only their hashes and does not hand those out either.
 */
const server = (process.env.CRAFTLY_SERVER || "http://127.0.0.1:8787").replace(/\/+$/, "");
const key = process.env.ADMIN_KEY || "";
const [command, ...rest] = process.argv.slice(2);

const usage = `Usage:
  node scripts/rooms.mjs list
  node scripts/rooms.mjs delete <room id>
Environment: ADMIN_KEY (the key the server was started with), CRAFTLY_SERVER (default http://127.0.0.1:8787)`;

/** What went wrong, in a sentence, for an answer that is not a success. */
async function problem(res) {
  let said = "";
  try {
    said = (await res.json()).error ?? "";
  } catch {
    /* not JSON: the status has to do */
  }
  if (res.status === 404 && !said.includes("shared design")) return `${server} has no operator interface: start it with ADMIN_KEY set (it answered 404).`;
  if (res.status === 401) return "The server does not take this ADMIN_KEY (it answered 401). Ten wrong keys in an hour and it stops listening to this address.";
  if (res.status === 429) return `Too many wrong keys from this address: the server listens again in ${res.headers.get("retry-after") ?? "some"} seconds.`;
  return `The server answered ${res.status}${said ? `: ${said}` : ""}.`;
}

async function ask(path, init = {}) {
  let res;
  try {
    res = await fetch(`${server}${path}`, { ...init, headers: { "x-craftly-admin-key": key }, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new Error(`Could not reach ${server}: ${error instanceof Error ? (error.cause?.message ?? error.message) : error}`, { cause: error });
  }
  if (!res.ok) throw new Error(await problem(res));
  return res.json();
}

const bytes = (n) => (typeof n !== "number" ? "?" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`);
const when = (ms) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "?");
// a title comes from whoever made the room: one line of it, and nothing that moves the cursor of a terminal
const plain = (text) => {
  const clean = String(text)
    .replace(/\p{Cc}/gu, " ")
    .trim();
  return clean.length > 40 ? `${clean.slice(0, 37)}...` : clean;
};

async function list() {
  const rooms = [];
  let after = "";
  let total;
  for (;;) {
    const page = await ask(`/api/admin/rooms?limit=200${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    rooms.push(...page.rooms);
    total = page.total;
    if (!page.next) break;
    after = page.next;
  }
  const head = ["ROOM", "TITLE", "MADE (UTC)", "LAST USED (UTC)", "DESIGN", "IMAGES", "PEOPLE"];
  const rows = rooms.map((room) =>
    room.error
      ? [room.id, `(${room.error})`, "?", when(room.usedAt), "?", "?", String(room.people)]
      : [room.id, plain(room.title), when(room.createdAt), when(room.usedAt), bytes(room.designBytes), bytes(room.imageBytes), String(room.people)],
  );
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  for (const row of [head, ...rows])
    console.log(
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join("  ")
        .trimEnd(),
    );
  const held = rooms.reduce((sum, room) => sum + (room.designBytes ?? 0) + (room.imageBytes ?? 0), 0);
  const people = rooms.reduce((sum, room) => sum + room.people, 0);
  console.log(`\n${total} room${total === 1 ? "" : "s"} on ${server}, ${bytes(held)} in all, ${people} ${people === 1 ? "person" : "people"} connected now.`);
}

async function remove(id) {
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new Error(`"${id ?? ""}" is not the id of a room. Take one from the first column of "list".`);
  await ask(`/api/admin/rooms/${id}`, { method: "DELETE" });
  console.log(`Removed ${id}. Whoever was in it was sent away, and its links no longer work.`);
}

async function main() {
  if (command !== "list" && command !== "delete") {
    console.log(usage);
    return command === undefined || command === "help" || command === "--help" ? 0 : 1;
  }
  if (!key) throw new Error("ADMIN_KEY is not set: give this script the key the server was started with, in the environment.");
  if (command === "list") await list();
  else await remove(rest[0]);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

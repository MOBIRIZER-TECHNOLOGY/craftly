/*
 * The operator's tool for accounts on a live server started with ACCOUNTS=1 (docs/ACCOUNTS.md, docs/DEPLOY.md). It asks the
 * running server (POST and GET under /api/admin/accounts, src/server/accounts/admin.ts), which needs an ADMIN_KEY; it does not
 * touch DATA_DIR itself, so that what it changes takes its turn with the requests of the people using the server.
 *
 *   node scripts/accounts.mjs list                                  every account: email, name, made, sessions, teams, disabled
 *   node scripts/accounts.mjs create-signup-code [uses] [hours]     a code to sign up with (1 use, 168 hours unless given)
 *   node scripts/accounts.mjs reset <email>                         a one-time link to set a new password, good for 24 hours
 *   node scripts/accounts.mjs disable <email>                       no more signing in; every session ends
 *   node scripts/accounts.mjs enable <email>                        undoes disable
 *   node scripts/accounts.mjs delete <email> --yes                  removes the account and its own designs, for good
 *
 * From the environment, and from nowhere else (an argument would be in the shell's history and in the list of processes):
 *   CRAFTLY_SERVER   where the server is; http://127.0.0.1:8787 when not set. Ask the server itself, on its own machine or
 *                    through a tunnel: the key travels in a header and deserves TLS or no network.
 *   ADMIN_KEY        the key the server was started with
 *   CRAFTLY_APP      the address of the editor (https://editor.example.org/), to print the reset link whole; without it the
 *                    code is printed with what to add in front of it
 *
 * A code is printed once and kept by the server only as a hash: give it to the person by a way you trust.
 */
const server = (process.env.CRAFTLY_SERVER || "http://127.0.0.1:8787").replace(/\/+$/, "");
const key = process.env.ADMIN_KEY || "";
const app = process.env.CRAFTLY_APP || "";
const [command, ...rest] = process.argv.slice(2);

const usage = `Usage:
  node scripts/accounts.mjs list
  node scripts/accounts.mjs create-signup-code [uses] [hours]
  node scripts/accounts.mjs reset <email>
  node scripts/accounts.mjs disable <email>
  node scripts/accounts.mjs enable <email>
  node scripts/accounts.mjs delete <email> --yes
Environment: ADMIN_KEY (the key the server was started with), CRAFTLY_SERVER (default http://127.0.0.1:8787), CRAFTLY_APP (the editor's address, for reset links)`;

/** What went wrong, in a sentence, for an answer that is not a success. */
async function problem(res) {
  let said = {};
  try {
    said = await res.json();
  } catch {
    /* not JSON: the status has to do */
  }
  if (res.status === 404 && !said.code) return `${server} has no operator interface for accounts: start it with ADMIN_KEY and ACCOUNTS=1 set (it answered 404).`;
  if (res.status === 401) return "The server does not take this ADMIN_KEY (it answered 401). Ten wrong keys in an hour and it stops listening to this address.";
  if (res.status === 429) return `Too many wrong keys from this address: the server listens again in ${res.headers.get("retry-after") ?? "some"} seconds.`;
  if (said.code === "last-owner" && Array.isArray(said.teams)) {
    return `This account is the last owner of ${said.teams.map((t) => `"${plain(t.name)}" (${t.id})`).join(", ")}. Make someone else an owner there, or delete the team, first.`;
  }
  return `The server answered ${res.status}${said.error ? `: ${said.error}` : ""}.`;
}

async function ask(path, body) {
  let res;
  try {
    res = await fetch(`${server}/api/admin/accounts${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-craftly-admin-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(`Could not reach ${server}: ${error instanceof Error ? (error.cause?.message ?? error.message) : error}`, { cause: error });
  }
  if (!res.ok) throw new Error(await problem(res));
  return res.json();
}

const when = (ms) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "?");
// what a person typed (a name, an email) is printed on one line, without anything that moves the cursor of a terminal
const plain = (text) => {
  const clean = String(text)
    .replace(/\p{Cc}/gu, " ")
    .trim();
  return clean.length > 40 ? `${clean.slice(0, 37)}...` : clean;
};
const email = (value) => {
  if (!value || !value.includes("@")) throw new Error(`"${value ?? ""}" is not an email. Take one from "list".`);
  return value;
};
const whole = (value, what, fallback) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${what} is a whole number, 1 or more.`);
  return n;
};

async function list() {
  const { accounts } = await ask("");
  const head = ["EMAIL", "NAME", "MADE (UTC)", "SESSIONS", "TEAMS", "STATE"];
  const rows = accounts.map((a) =>
    a.error
      ? [`(${a.id})`, `(${a.error})`, "?", "?", "?", "?"]
      : [plain(a.email), plain(a.name), when(a.createdAt), String(a.sessions), String(a.teams), a.disabled ? "disabled" : "active"],
  );
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  for (const row of [head, ...rows])
    console.log(
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join("  ")
        .trimEnd(),
    );
  console.log(`\n${accounts.length} account${accounts.length === 1 ? "" : "s"} on ${server}.`);
}

async function main() {
  const known = ["list", "create-signup-code", "reset", "disable", "enable", "delete"];
  if (!known.includes(command)) {
    console.log(usage);
    return command === undefined || command === "help" || command === "--help" ? 0 : 1;
  }
  if (!key) throw new Error("ADMIN_KEY is not set: give this script the key the server was started with, in the environment.");
  if (command === "list") await list();
  else if (command === "create-signup-code") {
    const made = await ask("/signup-codes", { uses: whole(rest[0], "uses", 1), hours: whole(rest[1], "hours", 168) });
    console.log(`Sign-up code: ${made.code}\nGood for ${made.uses} account${made.uses === 1 ? "" : "s"} until ${when(made.expiresAt)} UTC. It is shown only now.`);
  } else if (command === "reset") {
    const made = await ask("/reset", { email: email(rest[0]) });
    const link = app ? `${app.replace(/#.*$/, "")}#/reset/${made.code}` : `<the editor's address>#/reset/${made.code}`;
    console.log(`Reset link: ${link}\nGood once, until ${when(made.expiresAt)} UTC. Using it ends every session of the person. It is shown only now.`);
  } else if (command === "disable" || command === "enable") {
    await ask("/disable", { email: email(rest[0]), disabled: command === "disable" });
    console.log(command === "disable" ? `Disabled ${rest[0]}: every session ended, and signing in is refused.` : `Enabled ${rest[0]} again.`);
  } else {
    const who = email(rest[0]);
    if (!rest.includes("--yes")) throw new Error(`This removes ${who} and every design in their own space, for good. Add --yes to do it.`);
    await ask("/delete", { email: who });
    console.log(`Deleted ${who}, with their own designs and uploads.`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

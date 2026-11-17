/**
 * For the tests of the accounts (accounts.test.ts, spaces.test.ts, teams.test.ts): a real live server with accounts on a port of
 * its own, a clock the test moves, a low password cost so that a sign-up takes milliseconds, and `call` for real HTTP. Not a test
 * file itself, and not loaded by the server.
 */
import { request } from "node:http";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design } from "@/core/types";
import { createLiveServer, type LiveServer, type LiveServerOptions } from "../live";
import { MemoryStorage } from "../storage";
import type { AccountsOptions } from "./context";
import { MemoryAccounts, type AccountStorage } from "./storage";

export const ORIGIN = "http://app.example.org";
export const START = Date.UTC(2026, 10, 17, 9, 0, 0);
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const PASSWORD = "a long enough password";

export interface Clock {
  now(): number;
  advance(ms: number): void;
}
export const makeClock = (start = START): Clock => {
  let at = start;
  return { now: () => at, advance: (ms) => void (at += ms) };
};

export interface Booted {
  base: string;
  server: LiveServer;
  storage: AccountStorage;
  clock: Clock;
}

const running: LiveServer[] = [];
/** Closes every server a test booted: call it in `afterEach`. */
export async function closeAll() {
  for (const server of running.splice(0)) await server.close();
}

export async function boot(
  accounts: Partial<AccountsOptions> = {},
  server: Partial<LiveServerOptions> = {},
  given: { storage?: AccountStorage; clock?: Clock } = {},
): Promise<Booted> {
  const clock = given.clock ?? makeClock();
  const storage = given.storage ?? new MemoryAccounts();
  const live = createLiveServer({
    storage: new MemoryStorage(clock.now),
    allowOrigin: [ORIGIN],
    now: clock.now,
    ...server,
    accounts: { storage, signup: "open", passwordCost: { logN: 10, r: 8, p: 1 }, ...accounts },
  });
  running.push(live);
  const { port } = await live.listen(0);
  return { base: `http://127.0.0.1:${port}`, server: live, storage, clock };
}

export interface Answer {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read answers of many shapes
  body: any;
  headers: Headers;
}

/** One request: JSON in and out, the token as a bearer token, and the app's origin unless the test says otherwise. */
export async function call(
  b: Booted,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; raw?: string; origin?: string | null; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${b.base}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON: kept as text */
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

let people = 0;
/** Signs up a new person and gives what the server answered with the email and password used. */
export async function signUp(b: Booted, extra: { email?: string; name?: string; code?: string } = {}) {
  const email = extra.email ?? `person${++people}@example.org`;
  const answer = await call(b, "POST", "/api/auth/signup", { body: { email, password: PASSWORD, name: extra.name ?? "Ann", ...(extra.code ? { code: extra.code } : {}) } });
  if (answer.status !== 201) throw new Error(`sign-up answered ${answer.status}: ${JSON.stringify(answer.body)}`);
  return { email, token: answer.body.token as string, user: answer.body.user as { id: string; email: string; name: string }, recoveryCode: answer.body.recoveryCode as string };
}

/** A small design as the editor makes it, the same each time it is made with the same arguments. */
export function design(id = "d1", title = "Poster", extra: Partial<Design> = {}): Design {
  const made = createDesign({ title, width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });
  return { ...made, id, createdAt: 1, updatedAt: 1, ...extra };
}

/**
 * Sends `bytes` bytes of a body that says it is longer, and gives the status of the answer. The server answers 413 once it has
 * read more than its limit and drops the connection. Were more of the body still on its way, the system would answer the
 * dropped connection with a reset that can overtake the answer (on Windows it does), so this sends just past the limit and waits.
 */
export function sendTooMuch(b: Booted, method: string, path: string, token: string, bytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers = { origin: ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": String(bytes + 1000) };
    const req = request(`${b.base}${path}`, { method, headers }, (res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
      res.on("end", () => req.destroy());
    });
    req.on("error", (error) => reject(error));
    req.write("x".repeat(bytes));
  });
}

/** The bytes of a 1x1 PNG, as base64. */
export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
export const THUMB = `data:image/png;base64,${PNG}`;

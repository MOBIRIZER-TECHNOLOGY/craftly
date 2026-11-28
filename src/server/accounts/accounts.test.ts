/**
 * Accounts through the real server, over real HTTP: signing up (each mode, codes, every refusal), signing in and out, sessions
 * (expiry with a clock the test moves, sliding, the cap, ending one), changing and resetting a password, the operator's calls,
 * the limits with Retry-After, the busy hasher, CORS and the Origin check, and a server without accounts answering as before.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveServer } from "../live";
import { MemoryStorage } from "../storage";
import { MAX_SESSIONS } from "./context";
import { MemoryAccounts } from "./storage";
import { boot, call, closeAll, DAY, HOUR, ORIGIN, PASSWORD, signUp, type Booted } from "./testServer";

afterEach(closeAll);

const ADMIN_KEY = "an-operator-key-for-tests";
const admin = (b: Booted, method: string, path: string, body?: unknown) =>
  call(b, method, `/api/admin/accounts${path}`, { body, origin: null, headers: { "x-craftly-admin-key": ADMIN_KEY } });
const signIn = (b: Booted, email: string, password = PASSWORD, extra: { headers?: Record<string, string> } = {}) =>
  call(b, "POST", "/api/auth/signin", { body: { email, password, device: "Laptop" }, ...extra });

describe("a server without accounts", () => {
  it("is the server it was: the addresses are not there, and the preflight names no authorization header", async () => {
    const server = createLiveServer({ storage: new MemoryStorage(), allowOrigin: [ORIGIN] });
    const { port } = await server.listen(0);
    try {
      const base = `http://127.0.0.1:${port}`;
      for (const path of ["/api/me", "/api/auth/signup", "/api/spaces/x/changes", "/api/teams"]) {
        const res = await fetch(`${base}${path}`, { method: path === "/api/me" ? "GET" : "POST", headers: { origin: ORIGIN } });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not found" });
      }
      const pre = await fetch(`${base}/api/me`, { method: "OPTIONS", headers: { origin: ORIGIN } });
      expect(pre.headers.get("access-control-allow-headers")).toBe("content-type, x-craftly-key, x-craftly-create-key");
      expect(pre.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
    } finally {
      await server.close();
    }
  });
});

describe("CORS and origins", () => {
  it("lets the app's page send the token: the preflight names authorization and PATCH for the app's origin", async () => {
    const b = await boot();
    const pre = await call(b, "OPTIONS", "/api/me");
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(pre.headers.get("access-control-allow-methods")).toContain("PATCH");
    const other = await call(b, "OPTIONS", "/api/me", { origin: "http://evil.example" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a page of another origin for every method, GET too, with the code origin; a request without an origin is not a page", async () => {
    const b = await boot();
    const { token } = await signUp(b);
    for (const [method, path] of [
      ["GET", "/api/me"],
      ["POST", "/api/auth/signin"],
      ["POST", "/api/auth/signup"],
      ["DELETE", "/api/me/sessions/x"],
      ["PATCH", "/api/teams/x"],
    ]) {
      const answer = await call(b, method, path, { token, origin: "http://evil.example", body: method === "GET" ? undefined : {} });
      expect(answer.status, `${method} ${path}`).toBe(403);
      expect(answer.body.code).toBe("origin");
    }
    expect((await call(b, "GET", "/api/me", { token, origin: null })).status).toBe(200);
  });
});

describe("signing up", () => {
  it("makes an account: a token, the person, and a recovery code shown once; the server keeps only hashes", async () => {
    const b = await boot();
    const answer = await call(b, "POST", "/api/auth/signup", { body: { email: "  Ann@Example.ORG ", password: PASSWORD, name: "  Ann   Lee\n" } });
    expect(answer.status).toBe(201);
    expect(answer.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(answer.body.recoveryCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(answer.body.user).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), email: "ann@example.org", name: "Ann Lee", createdAt: b.clock.now() });
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const kept = (b.storage as MemoryAccounts)
      .rawKeys()
      .map((key) => `${key}\n${(b.storage as MemoryAccounts).rawText(key)}`)
      .join("\n");
    expect(kept).not.toContain(answer.body.token);
    expect(kept).not.toContain(answer.body.recoveryCode);
    expect(kept).not.toContain(PASSWORD);
    expect(kept).toContain("scrypt$10$8$1$");
    const me = await call(b, "GET", "/api/me", { token: answer.body.token });
    expect(me.body.user.email).toBe("ann@example.org");
  });

  it("refuses an email that is taken, also written in other capitals or with spaces around it (409 email-taken)", async () => {
    const b = await boot();
    await signUp(b, { email: "bob@example.org" });
    for (const email of ["bob@example.org", " BOB@example.org "]) {
      const answer = await call(b, "POST", "/api/auth/signup", { body: { email, password: PASSWORD, name: "Bob" } });
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ code: "email-taken" });
    }
  });

  it("gives an email to one account when many sign up with it at the same moment", async () => {
    const b = await boot({ limits: { signupPerAddress: 0 }, hashConcurrency: 10, hashLimits: { perAddress: 10 } });
    const answers = await Promise.all(Array.from({ length: 6 }, () => call(b, "POST", "/api/auth/signup", { body: { email: "race@example.org", password: PASSWORD, name: "R" } })));
    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(5);
    expect((await admin(b, "GET", "")).status).toBe(404); // no ADMIN_KEY on this server: there is no operator interface
  });

  it("refuses bodies that are not what it takes, each with 400 bad-request", async () => {
    const b = await boot({ limits: { signupPerAddress: 0 } });
    const good = { email: "c@example.org", password: PASSWORD, name: "C" };
    for (const body of [
      { ...good, email: "not an email" },
      { ...good, email: 42 },
      { ...good, email: `${"x".repeat(250)}@example.org` },
      { ...good, password: "short" },
      { ...good, password: "x".repeat(257) },
      { ...good, name: "   " },
      { ...good, name: 7 },
      { ...good, extra: true },
      { email: good.email, password: good.password },
      { ...good, code: "not a code" },
    ]) {
      const answer = await call(b, "POST", "/api/auth/signup", { body });
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body.code).toBe("bad-request");
    }
    for (const raw of ["{", "[]", "null", '"text"', "12"]) expect((await call(b, "POST", "/api/auth/signup", { raw })).status).toBe(400);
  });

  it("refuses a body that is too big (413 too-big) and a wrong method (405 with Allow)", async () => {
    const b = await boot();
    const big = await call(b, "POST", "/api/auth/signup", { raw: JSON.stringify({ email: "a@b.c", password: "x".repeat(20_000), name: "A" }) });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("too-big");
    const wrong = await call(b, "GET", "/api/auth/signup");
    expect(wrong.status).toBe(405);
    expect(wrong.body.code).toBe("method");
    expect(wrong.headers.get("allow")).toBe("POST");
    expect((await call(b, "GET", "/api/auth/nothing")).status).toBe(404);
  });

  it("is closed with SIGNUP=closed (403 signup-closed), before the body is read", async () => {
    const b = await boot({ signup: "closed" });
    const answer = await call(b, "POST", "/api/auth/signup", { body: { email: "a@example.org", password: PASSWORD, name: "A" } });
    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe("signup-closed");
  });

  it("with SIGNUP=invite needs a code: none is signup-closed, a wrong one code-wrong, an operator's sign-up code works for its uses", async () => {
    const b = await boot({ signup: "invite", limits: { signupPerAddress: 0 } }, { adminKey: ADMIN_KEY });
    const body = (email: string, code?: string) => ({ email, password: PASSWORD, name: "I", ...(code ? { code } : {}) });
    expect((await call(b, "POST", "/api/auth/signup", { body: body("a@example.org") })).body.code).toBe("signup-closed");
    const wrong = await call(b, "POST", "/api/auth/signup", { body: body("a@example.org", "A".repeat(22)) });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("code-wrong");
    const made = await admin(b, "POST", "/signup-codes", { uses: 2, hours: 1 });
    expect(made.status).toBe(201);
    expect(made.body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await call(b, "POST", "/api/auth/signup", { body: body("b@example.org", made.body.code) })).status).toBe(201);
    // without a good code nobody learns that an email has an account
    expect((await call(b, "POST", "/api/auth/signup", { body: body("b@example.org", "A".repeat(22)) })).body.code).toBe("code-wrong");
    expect((await call(b, "POST", "/api/auth/signup", { body: body("b@example.org") })).body.code).toBe("signup-closed");
    expect((await call(b, "POST", "/api/auth/signup", { body: body("c@example.org", made.body.code) })).status).toBe(201);
    expect((await call(b, "POST", "/api/auth/signup", { body: body("d@example.org", made.body.code) })).body.code).toBe("code-wrong");
    // a code past its time is not good
    const later = await admin(b, "POST", "/signup-codes", { hours: 1 });
    b.clock.advance(HOUR + 1);
    expect((await call(b, "POST", "/api/auth/signup", { body: body("e@example.org", later.body.code) })).body.code).toBe("code-wrong");
  });

  it("keeps no more accounts than MAX_ACCOUNTS (403 full)", async () => {
    const b = await boot({ maxAccounts: 2 });
    await signUp(b);
    await signUp(b);
    const third = await call(b, "POST", "/api/auth/signup", { body: { email: "third@example.org", password: PASSWORD, name: "T" } });
    expect(third.status).toBe(403);
    expect(third.body.code).toBe("full");
  });

  it("allows 5 attempts an hour from one address, then 429 with Retry-After, and again an hour later", async () => {
    const b = await boot();
    for (let i = 0; i < 5; i++) await call(b, "POST", "/api/auth/signup", { body: { email: `x${i}@example.org`, password: "short", name: "X" } });
    const sixth = await call(b, "POST", "/api/auth/signup", { body: { email: "y@example.org", password: PASSWORD, name: "Y" } });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe("rate");
    expect(Number(sixth.headers.get("retry-after"))).toBe(3600);
    b.clock.advance(HOUR);
    expect((await call(b, "POST", "/api/auth/signup", { body: { email: "y@example.org", password: PASSWORD, name: "Y" } })).status).toBe(201);
  });
});

describe("signing in and out", () => {
  it("gives a token for the right password, and 401 wrong for a wrong one, an unknown email and a disabled account alike", async () => {
    const b = await boot({}, { adminKey: ADMIN_KEY });
    const { email } = await signUp(b);
    const ok = await signIn(b, email.toUpperCase());
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ok.body.user.email).toBe(email);
    const wrong = await signIn(b, email, "not the password at all");
    const nobody = await signIn(b, "nobody@example.org");
    expect(wrong.body).toEqual(nobody.body);
    expect([wrong.status, nobody.status]).toEqual([401, 401]);
    expect(wrong.body.code).toBe("wrong");
    await admin(b, "POST", "/disable", { email });
    const disabled = await signIn(b, email);
    expect(disabled.status).toBe(401);
    expect(disabled.body).toEqual(wrong.body);
    await admin(b, "POST", "/disable", { email, disabled: false });
    expect((await signIn(b, email)).status).toBe(200);
  });

  it("refuses sign-in bodies of the wrong shape", async () => {
    const b = await boot();
    for (const body of [{ email: "a@b.c" }, { email: "a@b.c", password: 5 }, { email: "a@b.c", password: "x", device: 3 }, { email: "a@b.c", password: "x", more: 1 }]) {
      expect((await call(b, "POST", "/api/auth/signin", { body })).status).toBe(400);
    }
  });

  it("limits failed sign-ins: 10 for an account from one address (429, Retry-After), while another address still gets in", async () => {
    const b = await boot({}, { trustProxy: true });
    const { email } = await signUp(b);
    const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 10; i++) expect((await signIn(b, email, "wrong password!", from("10.0.0.1"))).status).toBe(401);
    const locked = await signIn(b, email, PASSWORD, from("10.0.0.1"));
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("rate");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    // one address cannot lock the person out
    expect((await signIn(b, email, PASSWORD, from("10.0.0.2"))).status).toBe(200);
    b.clock.advance(HOUR);
    expect((await signIn(b, email, PASSWORD, from("10.0.0.1"))).status).toBe(200);
  });

  it("lets the person in from an address they used lately when guesses from many addresses reach the account's limit", async () => {
    const b = await boot({ limits: { signinPerAccount: 30 } }, { trustProxy: true });
    const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
    // the person made the account and uses it from home
    const { email, token } = await signUp(b);
    expect((await call(b, "GET", "/api/me", { token, ...from("10.0.0.1") })).status).toBe(200);
    // somebody guesses from three other networks (10 each, the limit of one address for one account): the account's limit is reached
    for (const ip of ["10.0.1.1", "10.0.2.1", "10.0.3.1"]) {
      for (let i = 0; i < 10; i++) expect((await signIn(b, email, "wrong password!", from(ip))).status).toBe(401);
    }
    // a new address is held back, the right password or not
    expect((await signIn(b, email, PASSWORD, from("10.0.4.1"))).status).toBe(429);
    // the person, from home, still gets in
    expect((await signIn(b, email, PASSWORD, from("10.0.0.1"))).status).toBe(200);
  });

  it("does not stop a signed-in person changing their password when the account's sign-in limit is reached, and limits wrong old passwords for one session", async () => {
    const b = await boot({ limits: { signinPerAccount: 10 } }, { trustProxy: true });
    const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
    const { email, token } = await signUp(b);
    for (let i = 0; i < 10; i++) expect((await signIn(b, email, "wrong password!", from("10.0.9.1"))).status).toBe(401);
    // ten wrong old passwords for this session, spread over addresses, then the session is held back wherever it is
    for (let i = 0; i < 10; i++) {
      const wrong = await call(b, "POST", "/api/me/password", { token, body: { old: "wrong password!", new: "another long password" }, ...from(`10.1.${i}.1`) });
      expect(wrong.status).toBe(401);
    }
    expect((await call(b, "POST", "/api/me/password", { token, body: { old: PASSWORD, new: "another long password" }, ...from("10.2.0.1") })).status).toBe(429);
  });

  it("limits failed sign-ins from one address to 20 an hour over all accounts", async () => {
    const b = await boot({}, { trustProxy: true });
    const from = { headers: { "x-forwarded-for": "10.0.0.9" } };
    for (let i = 0; i < 20; i++) expect((await signIn(b, `nobody${i}@example.org`, PASSWORD, from)).status).toBe(401);
    expect((await signIn(b, "someone@example.org", PASSWORD, from)).status).toBe(429);
  });

  it("answers 503 busy with Retry-After when more passwords are being checked than it may at once", async () => {
    const b = await boot({ hashConcurrency: 1, passwordCost: { logN: 15, r: 8, p: 1 } });
    const answers = await Promise.all(Array.from({ length: 4 }, () => signIn(b, "nobody@example.org")));
    const busy = answers.filter((a) => a.status === 503);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy[0].body.code).toBe("busy");
    expect(busy[0].headers.get("retry-after")).toBe("1");
    expect(answers.some((a) => a.status === 401)).toBe(true);
  });

  it("lets a person in from an address they used lately while a flood of sign-ins from many new addresses fills the server", async () => {
    // the real cost, so that the flood's hashes are still at work when the person comes; two places, one kept for the known
    const b = await boot({ hashConcurrency: 2, passwordCost: { logN: 15, r: 8, p: 1 }, hashLimits: { waiting: 4 } }, { trustProxy: true });
    const { email } = await signUp(b);
    const flood = Array.from({ length: 40 }, (_, i) => signIn(b, `nobody${i}@example.org`, PASSWORD, { headers: { "x-forwarded-for": `10.9.${i}.1` } }));
    // from the address the account was made at (this machine), so known there
    const person = signIn(b, email);
    const [mine, ...theirs] = await Promise.all([person, ...flood]);
    expect(mine.status).toBe(200);
    // the flood was answered, not left to pile up: a few checked (401), the rest told the server is busy
    expect(theirs.filter((a) => a.status === 503).length).toBeGreaterThan(30);
    expect(theirs.every((a) => a.status === 401 || a.status === 503)).toBe(true);
  });

  it("ends the session with sign-out: its token is refused from then on (401 session)", async () => {
    const b = await boot();
    const { token } = await signUp(b);
    expect((await call(b, "POST", "/api/auth/signout", { token })).status).toBe(200);
    const after = await call(b, "GET", "/api/me", { token });
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("session");
    expect((await call(b, "POST", "/api/auth/signout", { token })).status).toBe(401);
  });
});

describe("sessions", () => {
  it("are refused without a token, with a token of the wrong form, an unknown one, or one in the wrong header", async () => {
    const b = await boot();
    const { token } = await signUp(b);
    const variants: Record<string, string>[] = [
      {},
      { authorization: "Bearer short" },
      { authorization: `Basic ${token}` },
      { authorization: `Bearer ${"A".repeat(43)}` },
      { "x-craftly-key": token },
    ];
    for (const headers of variants) {
      const answer = await call(b, "GET", "/api/me", { headers });
      expect(answer.status).toBe(401);
      expect(answer.body.code).toBe("session");
    }
  });

  it("last 30 days from their last use, slide on with use, and end after 180 days whatever", async () => {
    const b = await boot();
    const { email } = await signUp(b);
    const started = b.clock.now();
    const idle = (await signIn(b, email)).body.token;
    const used = (await signIn(b, email)).body.token;
    b.clock.advance(29 * DAY);
    expect((await call(b, "GET", "/api/me", { token: used })).status).toBe(200);
    b.clock.advance(2 * DAY);
    expect((await call(b, "GET", "/api/me", { token: idle })).status).toBe(401);
    expect((await call(b, "GET", "/api/me", { token: used })).status).toBe(200);
    while (b.clock.now() + 20 * DAY < started + 180 * DAY) {
      b.clock.advance(20 * DAY);
      expect((await call(b, "GET", "/api/me", { token: used })).status).toBe(200);
    }
    b.clock.advance(started + 180 * DAY - b.clock.now());
    expect((await call(b, "GET", "/api/me", { token: used })).status).toBe(401);
  });

  it("are listed, and one can be ended from another; ending an unknown one is 404", async () => {
    const b = await boot();
    const { email, token } = await signUp(b);
    const other = (await signIn(b, email)).body.token;
    const list = await call(b, "GET", "/api/me/sessions", { token });
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.body.sessions.find((s: { current: boolean }) => !s.current).device).toBe("Laptop");
    const otherId = list.body.sessions.find((s: { current: boolean }) => !s.current).id;
    expect((await call(b, "DELETE", `/api/me/sessions/${otherId}`, { token })).status).toBe(200);
    expect((await call(b, "GET", "/api/me", { token: other })).status).toBe(401);
    expect((await call(b, "DELETE", `/api/me/sessions/${otherId}`, { token })).status).toBe(404);
    expect((await call(b, "GET", "/api/me/sessions", { token })).body.sessions).toHaveLength(1);
  });

  it(`are at most ${MAX_SESSIONS} a person: the oldest goes`, async () => {
    const b = await boot({ limits: { signinPerAddress: 0 } });
    const { email, token: first } = await signUp(b);
    let last = "";
    for (let i = 0; i < MAX_SESSIONS; i++) {
      b.clock.advance(1000);
      last = (await signIn(b, email)).body.token;
    }
    expect((await call(b, "GET", "/api/me", { token: first })).status).toBe(401);
    expect((await call(b, "GET", "/api/me/sessions", { token: last })).body.sessions).toHaveLength(MAX_SESSIONS);
  });
});

describe("/api/me", () => {
  it("is the person, their teams with roles and their spaces; wrong methods are 405", async () => {
    const b = await boot();
    const { token, user } = await signUp(b, { name: "Mia" });
    const team = await call(b, "POST", "/api/teams", { token, body: { name: "Studio" } });
    const me = await call(b, "GET", "/api/me", { token });
    expect(me.body).toEqual({
      user,
      teams: [{ id: team.body.team.id, name: "Studio", role: "owner" }],
      spaces: [
        { id: user.id, kind: "own", name: "Mia", role: "owner" },
        { id: team.body.team.id, kind: "team", name: "Studio", role: "owner" },
      ],
    });
    expect((await call(b, "POST", "/api/me", { token, body: {} })).status).toBe(405);
  });
});

describe("passwords", () => {
  it("are changed with the old one; every other session ends, this one stays", async () => {
    const b = await boot();
    const { email, token } = await signUp(b);
    const other = (await signIn(b, email)).body.token;
    const wrong = await call(b, "POST", "/api/me/password", { token, body: { old: "not the old one", new: "a brand new password" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("wrong");
    expect((await call(b, "POST", "/api/me/password", { token, body: { old: PASSWORD, new: "short" } })).status).toBe(400);
    expect((await call(b, "POST", "/api/me/password", { token, body: { old: PASSWORD, new: "a brand new password" } })).status).toBe(200);
    expect((await call(b, "GET", "/api/me", { token })).status).toBe(200);
    expect((await call(b, "GET", "/api/me", { token: other })).status).toBe(401);
    expect((await signIn(b, email)).status).toBe(401);
    expect((await signIn(b, email, "a brand new password")).status).toBe(200);
  });

  it("are reset with the recovery code, which is then used up and replaced; every session ends", async () => {
    const b = await boot();
    const { email, token, recoveryCode } = await signUp(b);
    const wrong = await call(b, "POST", "/api/auth/reset", { body: { email, recoveryCode: "A".repeat(22), newPassword: "another fine password" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("wrong");
    const unknown = await call(b, "POST", "/api/auth/reset", { body: { email: "nobody@example.org", recoveryCode, newPassword: "another fine password" } });
    expect(unknown.body).toEqual(wrong.body);
    const done = await call(b, "POST", "/api/auth/reset", { body: { email, recoveryCode, newPassword: "another fine password" } });
    expect(done.status).toBe(200);
    expect(done.body.recoveryCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(done.body.recoveryCode).not.toBe(recoveryCode);
    expect((await call(b, "GET", "/api/me", { token })).status).toBe(401);
    expect((await signIn(b, email, "another fine password")).status).toBe(200);
    expect((await call(b, "POST", "/api/auth/reset", { body: { email, recoveryCode, newPassword: "yet another password" } })).status).toBe(401);
    expect((await call(b, "POST", "/api/auth/reset", { body: { email, recoveryCode: done.body.recoveryCode, newPassword: "yet another password" } })).status).toBe(200);
  });

  it("are reset with an operator's code: once, within 24 hours, and every session ends", async () => {
    const b = await boot({}, { adminKey: ADMIN_KEY });
    const { email, token } = await signUp(b);
    const made = await admin(b, "POST", "/reset", { email });
    expect(made.status).toBe(201);
    expect(made.body.expiresAt).toBe(b.clock.now() + DAY);
    const reset = (code: string, newPassword = "reset by the operator") => call(b, "POST", "/api/auth/reset", { body: { code, newPassword } });
    expect((await reset(made.body.code)).status).toBe(200);
    expect((await call(b, "GET", "/api/me", { token })).status).toBe(401);
    expect((await signIn(b, email, "reset by the operator")).status).toBe(200);
    const again = await reset(made.body.code);
    expect(again.status).toBe(401);
    const late = await admin(b, "POST", "/reset", { email });
    b.clock.advance(DAY);
    expect((await reset(late.body.code)).status).toBe(401);
    expect((await admin(b, "POST", "/reset", { email: "nobody@example.org" })).status).toBe(404);
  });

  it("limits wrong codes to 20 an hour from one address", async () => {
    const b = await boot();
    const { email } = await signUp(b);
    for (let i = 0; i < 20; i++) await call(b, "POST", "/api/auth/reset", { body: { email, recoveryCode: "B".repeat(22), newPassword: "another fine password" } });
    const limited = await call(b, "POST", "/api/auth/reset", { body: { code: "C".repeat(22), newPassword: "another fine password" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});

describe("scripts/accounts.mjs", () => {
  /** Runs the script as an operator would, with the key and the server in the environment only. */
  const script = (b: Booted, args: string[], extra: Record<string, string> = {}) =>
    new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const env: Record<string, string> = { ADMIN_KEY, CRAFTLY_SERVER: b.base, ...extra };
      for (const name of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME"]) if (process.env[name]) env[name] = process.env[name] as string;
      execFile(process.execPath, [join(process.cwd(), "scripts", "accounts.mjs"), ...args], { env }, (error, out, err) =>
        resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out, err }),
      );
    });

  it("lists, makes sign-up codes and reset links, disables, enables and deletes through the server", async () => {
    const b = await boot({ signup: "invite" }, { adminKey: ADMIN_KEY });
    const code = await script(b, ["create-signup-code", "1", "2"]);
    expect(code.code).toBe(0);
    const signupCode = /Sign-up code: (\S+)/.exec(code.out)![1];
    const ann = await signUp(b, { code: signupCode, name: "Ann" });
    const list = await script(b, ["list"]);
    expect(list.out).toContain(ann.email);
    expect(list.out).toContain("1 account on");
    const reset = await script(b, ["reset", ann.email], { CRAFTLY_APP: "https://editor.example.org/" });
    const link = /Reset link: (\S+)/.exec(reset.out)![1];
    expect(link).toMatch(/^https:\/\/editor\.example\.org\/#\/reset\/[A-Za-z0-9_-]{22}$/);
    expect((await call(b, "POST", "/api/auth/reset", { body: { code: link.split("/").pop(), newPassword: "set from the link" } })).status).toBe(200);
    expect((await script(b, ["disable", ann.email])).code).toBe(0);
    expect((await signIn(b, ann.email, "set from the link")).status).toBe(401);
    expect((await script(b, ["enable", ann.email])).code).toBe(0);
    expect((await signIn(b, ann.email, "set from the link")).status).toBe(200);
    const unsure = await script(b, ["delete", ann.email]);
    expect(unsure.code).toBe(1);
    expect(unsure.err).toContain("--yes");
    expect((await script(b, ["delete", ann.email, "--yes"])).code).toBe(0);
    expect((await signIn(b, ann.email, "set from the link")).status).toBe(401);
    const nobody = await script(b, ["reset", "nobody@example.org"]);
    expect(nobody.code).toBe(1);
    expect(nobody.err).toContain("no account with this email");
    const wrongKey = await script(b, ["list"], { ADMIN_KEY: "not-the-operator-key-at-all" });
    expect(wrongKey.err).toContain("401");
  });
});

describe("the operator's calls", () => {
  it("need the key, are not for a page, and are not there without ADMIN_KEY", async () => {
    const b = await boot({}, { adminKey: ADMIN_KEY });
    expect((await call(b, "GET", "/api/admin/accounts", { origin: null })).status).toBe(401);
    expect((await call(b, "GET", "/api/admin/accounts", { headers: { "x-craftly-admin-key": ADMIN_KEY } })).status).toBe(403);
    expect((await admin(b, "PUT", "")).status).toBe(405);
    expect((await admin(b, "GET", "/reset")).status).toBe(405);
    expect((await admin(b, "POST", "/reset", { email: "a@b.c", more: 1 })).status).toBe(400);
  });

  it("list accounts, disable one (ending its sessions), and delete one with its space", async () => {
    const b = await boot({}, { adminKey: ADMIN_KEY });
    const ann = await signUp(b, { name: "Ann" });
    const bob = await signUp(b, { name: "Bob" });
    const list = await admin(b, "GET", "");
    expect(list.status).toBe(200);
    expect(list.body.accounts.map((a: { email: string }) => a.email).sort()).toEqual([ann.email, bob.email].sort());
    expect(list.body.accounts[0]).toMatchObject({ disabled: false, sessions: 1, teams: 0 });
    expect((await admin(b, "POST", "/disable", { email: ann.email })).body).toEqual({ ok: true, disabled: true });
    expect((await call(b, "GET", "/api/me", { token: ann.token })).status).toBe(401);
    expect((await call(b, "PUT", `/api/spaces/${bob.user.id}/folders/f1`, { token: bob.token, body: { name: "F", parentId: null } })).status).toBe(201);
    expect((await admin(b, "POST", "/delete", { email: bob.email })).status).toBe(200);
    expect((await call(b, "GET", "/api/me", { token: bob.token })).status).toBe(401);
    expect((await b.storage.loadManifest(bob.user.id)).folders).toEqual({});
    expect((await admin(b, "GET", "")).body.accounts).toHaveLength(1);
    // the email is free again
    expect((await call(b, "POST", "/api/auth/signup", { body: { email: bob.email, password: PASSWORD, name: "Bob" } })).status).toBe(201);
  });

  it("refuse to delete the last owner of a team with other members, and name the team", async () => {
    const b = await boot({}, { adminKey: ADMIN_KEY });
    const owner = await signUp(b);
    const team = (await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Shop" } })).body.team;
    const invite = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "editor", uses: 1, hours: 1 } });
    const member = await signUp(b);
    await call(b, "POST", "/api/invites/redeem", { token: member.token, body: { code: invite.body.code } });
    const refused = await admin(b, "POST", "/delete", { email: owner.email });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "last-owner", teams: [{ id: team.id, name: "Shop" }] });
  });
});

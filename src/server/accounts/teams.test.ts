/**
 * Teams through the real server, over real HTTP: the role matrix (every action of the table in roles.ts, for an owner, an
 * editor, a viewer and somebody outside), invites (shown once, uses, expiry, revoking, the cap), redeeming, roles and the last
 * owner, removing and leaving, deleting a team with its space, and the limits on teams and members.
 */
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryAccounts } from "./storage";
import { boot, call, closeAll, design, HOUR, ORIGIN, PASSWORD, PNG, signUp, type Booted } from "./testServer";

afterEach(closeAll);

type Person = Awaited<ReturnType<typeof signUp>>;

async function teamWith(b: Booted, roles: ("editor" | "viewer" | "owner")[] = ["editor", "viewer"]) {
  const owner = await signUp(b, { name: "Olga" });
  const team = (await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Studio" } })).body.team as { id: string };
  const members: Person[] = [];
  for (const role of roles) {
    const invite = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role, uses: 1, hours: 24 } });
    const member = await signUp(b);
    const joined = await call(b, "POST", "/api/invites/redeem", { token: member.token, body: { code: invite.body.code } });
    expect(joined.body.team.role).toBe(role);
    members.push(member);
  }
  return { owner, team, members, space: `/api/spaces/${team.id}` };
}

describe("the role matrix over HTTP", () => {
  it("lets each role do what the table says, refuses the rest with 403, and tells somebody outside there is no such team (404)", async () => {
    const b = await boot();
    const { owner, team, members, space } = await teamWith(b);
    const [editor, viewer] = members;
    const outsider = await signUp(b);
    // something to act on, made by the owner
    await call(b, "PUT", `${space}/designs/base`, { token: owner.token, body: { baseRev: null, design: design("base") } });
    await call(b, "PUT", `${space}/folders/basef`, { token: owner.token, body: { name: "F", parentId: null } });
    const victim = await signUp(b);
    const inv = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "viewer", uses: 5, hours: 24 } });
    await call(b, "POST", "/api/invites/redeem", { token: victim.token, body: { code: inv.body.code } });

    let n = 0;
    const actions: [string, (token: string) => Promise<number>, Record<string, number>][] = [
      ["read the changes", async (t) => (await call(b, "GET", `${space}/changes`, { token: t })).status, { owner: 200, editor: 200, viewer: 200, outsider: 404 }],
      ["open a design", async (t) => (await call(b, "GET", `${space}/designs/base`, { token: t })).status, { owner: 200, editor: 200, viewer: 200, outsider: 404 }],
      ["list revisions", async (t) => (await call(b, "GET", `${space}/designs/base/versions`, { token: t })).status, { owner: 200, editor: 200, viewer: 200, outsider: 404 }],
      [
        "ask for missing uploads",
        async (t) => (await call(b, "POST", `${space}/assets/missing`, { token: t, body: { ids: ["x"] } })).status,
        { owner: 200, editor: 200, viewer: 200, outsider: 404 },
      ],
      [
        "make a design",
        async (t) => {
          const id = `d${++n}`;
          return (await call(b, "PUT", `${space}/designs/${id}`, { token: t, body: { baseRev: null, design: design(id) } })).status;
        },
        { owner: 201, editor: 201, viewer: 403, outsider: 404 },
      ],
      [
        "change details",
        async (t) => (await call(b, "PATCH", `${space}/designs/base/meta`, { token: t, body: { starred: true } })).status,
        { owner: 200, editor: 200, viewer: 403, outsider: 404 },
      ],
      [
        "restore a revision",
        async (t) => (await call(b, "POST", `${space}/designs/base/restore`, { token: t, body: { rev: 1 } })).status,
        { owner: 200, editor: 200, viewer: 403, outsider: 404 },
      ],
      [
        "upload",
        async (t) => (await call(b, "PUT", `${space}/assets/a${++n}`, { token: t, body: { mime: "image/png", base64: PNG } })).status,
        { owner: 201, editor: 201, viewer: 403, outsider: 404 },
      ],
      [
        "make a folder",
        async (t) => (await call(b, "PUT", `${space}/folders/f${++n}`, { token: t, body: { name: "F", parentId: null } })).status,
        { owner: 201, editor: 201, viewer: 403, outsider: 404 },
      ],
      ["remove a folder", async (t) => (await call(b, "DELETE", `${space}/folders/basef`, { token: t })).status, { owner: 200, editor: 200, viewer: 403, outsider: 404 }],
      [
        "delete a design for good",
        async (t) => {
          const id = `x${++n}`;
          await call(b, "PUT", `${space}/designs/${id}`, { token: owner.token, body: { baseRev: null, design: design(id) } });
          return (await call(b, "DELETE", `${space}/designs/${id}`, { token: t })).status;
        },
        { owner: 200, editor: 403, viewer: 403, outsider: 404 },
      ],
      ["see the team", async (t) => (await call(b, "GET", `/api/teams/${team.id}`, { token: t })).status, { owner: 200, editor: 200, viewer: 200, outsider: 404 }],
      [
        "rename the team",
        async (t) => (await call(b, "PATCH", `/api/teams/${team.id}`, { token: t, body: { name: "Renamed" } })).status,
        { owner: 200, editor: 403, viewer: 403, outsider: 404 },
      ],
      ["list invites", async (t) => (await call(b, "GET", `/api/teams/${team.id}/invites`, { token: t })).status, { owner: 200, editor: 403, viewer: 403, outsider: 404 }],
      [
        "invite",
        async (t) => (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: t, body: { role: "viewer", uses: 1, hours: 1 } })).status,
        { owner: 201, editor: 403, viewer: 403, outsider: 404 },
      ],
      [
        "revoke an invite",
        async (t) => {
          const made = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "viewer", uses: 1, hours: 1 } });
          return (await call(b, "DELETE", `/api/teams/${team.id}/invites/${made.body.id}`, { token: t })).status;
        },
        { owner: 200, editor: 403, viewer: 403, outsider: 404 },
      ],
      [
        "change a role",
        async (t) => (await call(b, "PUT", `/api/teams/${team.id}/members/${victim.user.id}`, { token: t, body: { role: "viewer" } })).status,
        { owner: 200, editor: 403, viewer: 403, outsider: 404 },
      ],
      [
        "remove someone",
        async (t) => (await call(b, "DELETE", `/api/teams/${team.id}/members/${outsider.user.id}`, { token: t })).status,
        { owner: 404, editor: 403, viewer: 403, outsider: 404 },
      ],
      ["delete the team", async (t) => (await call(b, "DELETE", `/api/teams/${team.id}`, { token: t })).status, { owner: 200, editor: 403, viewer: 403, outsider: 404 }],
    ];
    const tokens: [string, string][] = [
      ["outsider", outsider.token],
      ["viewer", viewer.token],
      ["editor", editor.token],
      ["owner", owner.token], // last: the owner deletes the team at the end
    ];
    for (const [what, act, expected] of actions) {
      for (const [role, token] of tokens) {
        // the owner deletes the team only after everybody else was asked
        expect(await act(token), `${role}: ${what}`).toBe(expected[role]);
      }
    }
    expect((await call(b, "GET", `${space}/changes`, { token: owner.token })).status).toBe(404);
  });

  it("checks the role at every request: a member whose role is lowered can no longer write, one removed can no longer read", async () => {
    const b = await boot();
    const { owner, team, members, space } = await teamWith(b, ["editor"]);
    const [editor] = members;
    const put = (id: string) => call(b, "PUT", `${space}/designs/${id}`, { token: editor.token, body: { baseRev: null, design: design(id) } });
    expect((await put("d1")).status).toBe(201);
    await call(b, "PUT", `/api/teams/${team.id}/members/${editor.user.id}`, { token: owner.token, body: { role: "viewer" } });
    expect((await put("d2")).status).toBe(403);
    expect((await call(b, "GET", `${space}/designs/d1`, { token: editor.token })).status).toBe(200);
    await call(b, "DELETE", `/api/teams/${team.id}/members/${editor.user.id}`, { token: owner.token });
    expect((await call(b, "GET", `${space}/designs/d1`, { token: editor.token })).status).toBe(404);
    expect((await call(b, "GET", "/api/me", { token: editor.token })).body.teams).toEqual([]);
  });

  it("checks the role again when a write takes its turn: a member removed or lowered while the body was on its way writes nothing", async () => {
    const b = await boot();
    const { owner, team, members, space } = await teamWith(b, ["editor", "editor"]);
    const [removed, lowered] = members;
    const gone = await slowPut(b, `${space}/designs/d1`, removed.token, { baseRev: null, design: design("d1") }, async () => {
      expect((await call(b, "DELETE", `/api/teams/${team.id}/members/${removed.user.id}`, { token: owner.token })).status).toBe(200);
    });
    expect(gone.status).toBe(404);
    const down = await slowPut(b, `${space}/designs/d2`, lowered.token, { baseRev: null, design: design("d2") }, async () => {
      expect((await call(b, "PUT", `/api/teams/${team.id}/members/${lowered.user.id}`, { token: owner.token, body: { role: "viewer" } })).status).toBe(200);
    });
    expect(down.status).toBe(403);
    expect((await call(b, "GET", `${space}/changes`, { token: owner.token })).body.designs).toEqual([]);
  });

  it("leaves no file of a team deleted while a write of its was on its way", async () => {
    const b = await boot();
    const { owner, team, space } = await teamWith(b, []);
    const late = await slowPut(b, `${space}/designs/d1`, owner.token, { baseRev: null, design: design("d1") }, async () => {
      expect((await call(b, "DELETE", `/api/teams/${team.id}`, { token: owner.token })).status).toBe(200);
    });
    expect(late.status).toBe(404);
    expect((b.storage as MemoryAccounts).rawKeys().filter((key) => key.includes(team.id))).toEqual([]);
  });
});

/**
 * A PUT whose body comes in two halves: `between` runs once the server has the first half (and has checked who asks, which it
 * does before reading a body), then the rest is sent. The answer, as `call` gives it.
 */
function slowPut(b: Booted, path: string, token: string, body: unknown, between: () => Promise<void>): Promise<{ status: number; body: { code?: string } }> {
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const headers = { origin: ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) };
    const req = request(`${b.base}${path}`, { method: "PUT", headers }, (res) => {
      let got = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (got += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(got) as { code?: string } }));
    });
    req.on("error", reject);
    const half = Math.floor(text.length / 2);
    req.write(text.slice(0, half));
    setTimeout(() => between().then(() => req.end(text.slice(half)), reject), 150);
  });
}

describe("teams", () => {
  it("are made by anybody signed in, as their owner, with a name; at most maxTeamsPerPerson", async () => {
    const b = await boot({ maxTeamsPerPerson: 2 });
    const ann = await signUp(b);
    const made = await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "  One  " } });
    expect(made.status).toBe(201);
    expect(made.body.team).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), name: "One", role: "owner" });
    for (const body of [{}, { name: "" }, { name: 5 }, { name: "x", more: 1 }]) expect((await call(b, "POST", "/api/teams", { token: ann.token, body })).status).toBe(400);
    expect((await call(b, "POST", "/api/teams", { body: { name: "No one" } })).status).toBe(401);
    await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Two" } });
    const third = await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Three" } });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe("too-many-teams");
    const team = await call(b, "GET", `/api/teams/${made.body.team.id}`, { token: ann.token });
    expect(team.body).toEqual({ team: made.body.team, members: [{ id: ann.user.id, role: "owner", name: "Ann", email: ann.email }] });
    expect((await call(b, "PUT", `/api/teams/${made.body.team.id}`, { token: ann.token, body: {} })).status).toBe(405);
  });

  it("are deleted with their space and their invites; their members are no longer in them", async () => {
    const b = await boot();
    const { owner, team, members, space } = await teamWith(b, ["editor"]);
    await call(b, "PUT", `${space}/designs/d1`, { token: owner.token, body: { baseRev: null, design: design("d1") } });
    const invite = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "viewer", uses: 3, hours: 1 } });
    expect((await call(b, "DELETE", `/api/teams/${team.id}`, { token: owner.token })).status).toBe(200);
    expect((await b.storage.loadManifest(team.id)).designs).toEqual({});
    expect(await b.storage.loadTeam(team.id)).toBeNull();
    expect((await call(b, "GET", "/api/me", { token: members[0].token })).body.teams).toEqual([]);
    const late = await signUp(b);
    expect((await call(b, "POST", "/api/invites/redeem", { token: late.token, body: { code: invite.body.code } })).body.code).toBe("code-wrong");
    expect((await call(b, "DELETE", `/api/teams/${team.id}`, { token: owner.token })).status).toBe(404);
  });
});

describe("roles and the last owner", () => {
  it("are changed by owners only; nobody raises their own; a team always keeps an owner (409 last-owner)", async () => {
    const b = await boot();
    const { owner, team, members } = await teamWith(b, ["editor", "owner"]);
    const [editor, second] = members;
    const role = (token: string, userId: string, r: unknown) => call(b, "PUT", `/api/teams/${team.id}/members/${userId}`, { token, body: { role: r } });
    expect((await role(editor.token, editor.user.id, "owner")).status).toBe(403);
    expect((await role(owner.token, editor.user.id, "admin")).status).toBe(400);
    expect((await role(owner.token, "nobody-who-is-in-it", "viewer")).status).toBe(404);
    // two owners: one may step down, and then the other is the last
    expect((await role(second.token, second.user.id, "editor")).status).toBe(200);
    const last = await role(owner.token, owner.user.id, "editor");
    expect(last.status).toBe(409);
    expect(last.body.code).toBe("last-owner");
    const leave = await call(b, "DELETE", `/api/teams/${team.id}/members/${owner.user.id}`, { token: owner.token });
    expect(leave.status).toBe(409);
    expect(leave.body.code).toBe("last-owner");
    expect((await role(owner.token, editor.user.id, "owner")).status).toBe(200);
    expect((await role(owner.token, owner.user.id, "viewer")).status).toBe(200);
    // the one who stepped down can no longer manage anybody
    expect((await role(owner.token, second.user.id, "viewer")).status).toBe(403);
  });

  it("let anybody leave, and an owner remove anybody else; removing somebody who is not in it is 404", async () => {
    const b = await boot();
    const { owner, team, members, space } = await teamWith(b, ["viewer", "editor"]);
    const [viewer, editor] = members;
    expect((await call(b, "DELETE", `/api/teams/${team.id}/members/${editor.user.id}`, { token: viewer.token })).status).toBe(403);
    expect((await call(b, "DELETE", `/api/teams/${team.id}/members/${viewer.user.id}`, { token: viewer.token })).status).toBe(200);
    expect((await call(b, "GET", `${space}/changes`, { token: viewer.token })).status).toBe(404);
    expect((await call(b, "DELETE", `/api/teams/${team.id}/members/${editor.user.id}`, { token: owner.token })).status).toBe(200);
    expect((await call(b, "DELETE", `/api/teams/${team.id}/members/${editor.user.id}`, { token: owner.token })).status).toBe(404);
    expect((await call(b, "GET", `/api/teams/${team.id}`, { token: owner.token })).body.members).toHaveLength(1);
  });
});

describe("invites", () => {
  it("show their code once; the list has no code and no hash", async () => {
    const b = await boot();
    const { owner, team } = await teamWith(b, []);
    const made = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "editor", uses: 3, hours: 2 } });
    expect(made.status).toBe(201);
    expect(made.body).toEqual({
      id: expect.any(String),
      code: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      role: "editor",
      usesLeft: 3,
      expiresAt: b.clock.now() + 2 * HOUR,
      createdAt: b.clock.now(),
    });
    const list = await call(b, "GET", `/api/teams/${team.id}/invites`, { token: owner.token });
    expect(list.body.invites).toEqual([{ id: made.body.id, role: "editor", usesLeft: 3, expiresAt: made.body.expiresAt, createdAt: made.body.createdAt }]);
    expect(JSON.stringify(await b.storage.loadTeam(team.id))).not.toContain(made.body.code);
  });

  it("are used up, expire and can be revoked; each of those is 403 code-wrong afterwards", async () => {
    const b = await boot();
    const { owner, team } = await teamWith(b, []);
    const invite = (uses: number, hours: number) => call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "viewer", uses, hours } });
    const redeem = async (code: string) => call(b, "POST", "/api/invites/redeem", { token: (await signUp(b)).token, body: { code } });
    const once = await invite(1, 1);
    expect((await redeem(once.body.code)).status).toBe(200);
    expect((await redeem(once.body.code)).body.code).toBe("code-wrong");
    const short = await invite(5, 1);
    b.clock.advance(HOUR);
    expect((await redeem(short.body.code)).body.code).toBe("code-wrong");
    const revoked = await invite(5, 5);
    expect((await call(b, "DELETE", `/api/teams/${team.id}/invites/${revoked.body.id}`, { token: owner.token })).status).toBe(200);
    expect((await call(b, "DELETE", `/api/teams/${team.id}/invites/${revoked.body.id}`, { token: owner.token })).status).toBe(404);
    expect((await call(b, "DELETE", `/api/teams/${team.id}/invites/not-an-id`, { token: owner.token })).status).toBe(404);
    expect((await redeem(revoked.body.code)).body.code).toBe("code-wrong");
    expect((await call(b, "GET", `/api/teams/${team.id}/invites`, { token: owner.token })).body.invites).toEqual([]);
  });

  it("are refused when they would not be invites, and when a team has as many open ones as it may (409 too-many-invites)", async () => {
    const b = await boot({ maxOpenInvites: 2 });
    const { owner, team } = await teamWith(b, []);
    const make = (body: unknown) => call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body });
    for (const body of [
      { role: "admin", uses: 1, hours: 1 },
      { role: "viewer", uses: 0, hours: 1 },
      { role: "viewer", uses: 101, hours: 1 },
      { role: "viewer", uses: 1, hours: 721 },
      { role: "viewer", uses: 1 },
      { role: "viewer", uses: 1, hours: 1, note: "x" },
    ]) {
      expect((await make(body)).status, JSON.stringify(body)).toBe(400);
    }
    await make({ role: "viewer", uses: 1, hours: 1 });
    await make({ role: "viewer", uses: 1, hours: 2 });
    const third = await make({ role: "viewer", uses: 1, hours: 1 });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe("too-many-invites");
    // one that expired no longer counts
    b.clock.advance(HOUR);
    expect((await make({ role: "viewer", uses: 1, hours: 1 })).status).toBe(201);
  });

  it("keep a member's role when they redeem again, using nothing; a team is at most maxMembersPerTeam (409 team-full)", async () => {
    const b = await boot({ maxMembersPerTeam: 2 });
    const { owner, team } = await teamWith(b, []);
    const invite = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "viewer", uses: 3, hours: 1 } });
    const ownerAgain = await call(b, "POST", "/api/invites/redeem", { token: owner.token, body: { code: invite.body.code } });
    expect(ownerAgain.body.team.role).toBe("owner");
    const one = await signUp(b);
    expect((await call(b, "POST", "/api/invites/redeem", { token: one.token, body: { code: invite.body.code } })).status).toBe(200);
    const two = await signUp(b);
    const full = await call(b, "POST", "/api/invites/redeem", { token: two.token, body: { code: invite.body.code } });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("team-full");
    expect((await call(b, "GET", `/api/teams/${team.id}/invites`, { token: owner.token })).body.invites[0].usesLeft).toBe(2);
  });

  it("make no account from an invite of a full team where sign-up needs a code (409 team-full), and keep its use", async () => {
    const open = await boot({ maxMembersPerTeam: 1, limits: { signupPerAddress: 0 } });
    const { owner, team } = await teamWith(open, []);
    const code = (await call(open, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "viewer", uses: 1, hours: 1 } })).body.code;
    await closeAll();
    // the same accounts, on a server that takes new accounts with a code only
    const b = await boot({ signup: "invite", maxMembersPerTeam: 1, limits: { signupPerAddress: 0 } }, {}, { storage: open.storage, clock: open.clock });
    for (let i = 0; i < 3; i++) {
      const tried = await call(b, "POST", "/api/auth/signup", { body: { email: `p${i}@example.org`, password: PASSWORD, name: "P", code } });
      expect(tried.status).toBe(409);
      expect(tried.body.code).toBe("team-full");
      expect((await call(b, "POST", "/api/auth/signin", { body: { email: `p${i}@example.org`, password: PASSWORD } })).status).toBe(401);
    }
    expect((await call(b, "GET", `/api/teams/${team.id}/invites`, { token: owner.token })).body.invites[0].usesLeft).toBe(1);
  });

  it("let two sign-ups with two invites into the last place of a team make one account between them", async () => {
    const open = await boot({ maxMembersPerTeam: 2, limits: { signupPerAddress: 0 } });
    const { owner, team } = await teamWith(open, []);
    const invite = async () => (await call(open, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "editor", uses: 1, hours: 1 } })).body.code;
    const codes = [await invite(), await invite()];
    await closeAll();
    const b = await boot({ signup: "invite", maxMembersPerTeam: 2, limits: { signupPerAddress: 0 } }, {}, { storage: open.storage, clock: open.clock });
    const answers = await Promise.all(codes.map((code, i) => call(b, "POST", "/api/auth/signup", { body: { email: `r${i}@example.org`, password: PASSWORD, name: "R", code } })));
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)!.body.code).toBe("team-full");
    expect((await call(b, "GET", `/api/teams/${team.id}`, { token: owner.token })).body.members).toHaveLength(2);
  });

  it("refuse codes that are not codes (400), need a session (401), and limit wrong codes to 20 an hour (429)", async () => {
    const b = await boot();
    const ann = await signUp(b);
    expect((await call(b, "POST", "/api/invites/redeem", { token: ann.token, body: { code: "short" } })).status).toBe(400);
    expect((await call(b, "POST", "/api/invites/redeem", { body: { code: "A".repeat(22) } })).status).toBe(401);
    for (let i = 0; i < 20; i++)
      expect((await call(b, "POST", "/api/invites/redeem", { token: ann.token, body: { code: `${"A".repeat(20)}${String(i).padStart(2, "0")}` } })).status).toBe(403);
    const limited = await call(b, "POST", "/api/invites/redeem", { token: ann.token, body: { code: "B".repeat(22) } });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("let a person sign up with a team's invite where sign-up needs a code, and they are in the team", async () => {
    const b = await boot({ signup: "invite" });
    // the first person of a server needs a code from the operator: made here straight in the storage
    const { createHash } = await import("node:crypto");
    await b.storage.saveCode(createHash("sha256").update("S".repeat(22)).digest("hex"), { kind: "signup", usesLeft: 1, expiresAt: b.clock.now() + HOUR, createdAt: b.clock.now() });
    const owner = await signUp(b, { code: "S".repeat(22) });
    const team = (await call(b, "POST", "/api/teams", { token: owner.token, body: { name: "Crew" } })).body.team;
    const invite = await call(b, "POST", `/api/teams/${team.id}/invites`, { token: owner.token, body: { role: "editor", uses: 1, hours: 1 } });
    const joined = await call(b, "POST", "/api/auth/signup", { body: { email: "new@example.org", password: PASSWORD, name: "New", code: invite.body.code } });
    expect(joined.status).toBe(201);
    expect(joined.body.team).toEqual({ id: team.id, name: "Crew", role: "editor" });
    expect((await call(b, "GET", "/api/me", { token: joined.body.token })).body.teams).toEqual([{ id: team.id, name: "Crew", role: "editor" }]);
    // the invite had one use, and it is used
    expect((await call(b, "POST", "/api/auth/signup", { body: { email: "more@example.org", password: PASSWORD, name: "M", code: invite.body.code } })).body.code).toBe(
      "code-wrong",
    );
  });
});

describe("a team's space", () => {
  it("is shared: what an editor writes a viewer reads, conflicts are per design, and the owner's delete is a tombstone for all", async () => {
    const b = await boot();
    const { owner, members, space } = await teamWith(b);
    const [editor, viewer] = members;
    await call(b, "PUT", `${space}/designs/d1`, { token: editor.token, body: { baseRev: null, design: design("d1", "Shared") } });
    expect((await call(b, "GET", `${space}/designs/d1`, { token: viewer.token })).body.design.title).toBe("Shared");
    await call(b, "PUT", `${space}/designs/d1`, { token: owner.token, body: { baseRev: 1, design: design("d1", "Owner's") } });
    const late = await call(b, "PUT", `${space}/designs/d1`, { token: editor.token, body: { baseRev: 1, design: design("d1", "Editor's") } });
    expect(late.body).toMatchObject({ code: "conflict", rev: 2 });
    await call(b, "DELETE", `${space}/designs/d1`, { token: owner.token });
    const feed = await call(b, "GET", `${space}/changes`, { token: viewer.token });
    expect(feed.body.designs[0]).toMatchObject({ id: "d1", deletedAt: b.clock.now() });
    expect((await call(b, "POST", `${space}/designs/d1/restore`, { token: editor.token, body: { rev: 2 } })).status).toBe(200);
  });
});

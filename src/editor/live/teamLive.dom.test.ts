/**
 * "Edit live with your team" (teamLive.ts) against a real account server (src/server/accounts/testServer.ts), with the library in a
 * fake IndexedDB: the room is never joined over edits made here that did not reach the server, and leaving it marks the copy here
 * as in step only when it is what the room had.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designLock, holdLock } from "@/cloud/locks";
import { saveSession } from "@/cloud/state";
import { countWaiting, stopSync, syncOnce } from "@/cloud/sync";
import { createDesign, createPage } from "@/core/factory";
import { getDesignForEditing, saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import { boot, call, closeAll, PASSWORD, signUp, type Booted } from "@/server/accounts/testServer";
import { wipeDatabase } from "@/test/logicDb";
import { applyTeamRole, connectTeamLive, startTeamLive, stopTeamLive, useTeamLive } from "./teamLive";

let b: Booted;
let other: string;
let team: string;
let shared: Design;
let release: (() => void) | null = null;

const run = async () => {
  if (!(await syncOnce())) throw new Error("sync did not run");
};

/** An edit made here, as the editor saves it. */
async function edit(id: string) {
  const open = await getDesignForEditing(id);
  if (!open) throw new Error("no such design");
  await saveDesign({ ...open.design, pages: [...open.design.pages, createPage()] }, undefined, open.revision);
}

beforeEach(async () => {
  await wipeDatabase();
  b = await boot();
  const person = await signUp(b, { name: "Ann" });
  other = (await call(b, "POST", "/api/auth/signin", { body: { email: person.email, password: PASSWORD, device: "Phone" } })).body.token;
  team = (await call(b, "POST", "/api/teams", { token: other, body: { name: "Studio" } })).body.team.id;
  shared = createDesign({ title: "Team flyer", width: 100, height: 100 });
  expect((await call(b, "PUT", `/api/spaces/${team}/designs/${shared.id}`, { token: other, body: { baseRev: null, design: shared } })).status).toBe(201);
  await saveSession({ server: b.base, token: person.token, user: person.user, device: "Test laptop", teams: [], activeSpace: person.user.id });
  await run();
  // the editor has the design open, as when "Edit live with your team" is pressed
  release = holdLock(designLock(shared.id));
});

afterEach(async () => {
  release?.();
  release = null;
  stopTeamLive();
  stopSync();
  await saveSession(null);
  await closeAll();
});

it("sends what was edited here first, and then asks for the room", async () => {
  await edit(shared.id);
  await startTeamLive(shared.id);
  expect(useTeamLive.getState().link?.room).toBeTruthy();
  expect((await call(b, "GET", `/api/spaces/${team}/designs/${shared.id}`, { token: other })).body.design.pages).toHaveLength(shared.pages.length + 1);
  expect(await countWaiting()).toBe(0);
});

it("is refused, with words, when an edit made here could not be sent because the design changed on another device too", async () => {
  await edit(shared.id);
  await call(b, "PUT", `/api/spaces/${team}/designs/${shared.id}`, {
    token: other,
    body: { baseRev: 1, design: { ...shared, pages: [createPage(), createPage(), createPage()] } },
  });
  await expect(startTeamLive(shared.id)).rejects.toThrow(m.cloud.live.unsent);
  expect(useTeamLive.getState()).toMatchObject({ link: null, error: m.cloud.live.unsent });
  // the edit still waits, to become a copy when the editor closes and sync runs
  expect(await countWaiting()).toBe(1);
});

it("leaves an edit made here waiting when the room was never reached", async () => {
  await edit(shared.id);
  const open = await getDesignForEditing(shared.id);
  useEditor.getState().actions.openDesign(open!.design);
  try {
    const leave = connectTeamLive(shared.id, { server: "http://127.0.0.1:9", room: "r_nowhere", key: "", role: "edit" }, "a session");
    leave();
    // (what is done on leaving is done after it returns)
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    useEditor.getState().actions.closeDesign();
  }
  expect(await countWaiting()).toBe(1);
});

describe("a viewer", () => {
  beforeEach(async () => {
    const bob = await signUp(b, { name: "Bob" });
    const invite = (await call(b, "POST", `/api/teams/${team}/invites`, { token: other, body: { role: "viewer", uses: 1, hours: 1 } })).body;
    expect((await call(b, "POST", "/api/invites/redeem", { token: bob.token, body: { code: invite.code } })).status).toBe(200);
    release?.();
    stopSync();
    await saveSession({ server: b.base, token: bob.token, user: bob.user, device: "Bob's laptop", teams: [], activeSpace: bob.user.id });
    await run();
    release = holdLock(designLock(shared.id));
  });

  it("sees the space's copy, read-only, with why, when nobody edits it live", async () => {
    await startTeamLive(shared.id);
    expect(useTeamLive.getState()).toMatchObject({ designId: shared.id, link: null, joining: false, error: null, notice: m.cloud.errors["not-live"] });
    // asked again after the room closed under them (the last editor left: 4004 not-found), the same, without an error
    await startTeamLive(shared.id, true);
    expect(useTeamLive.getState()).toMatchObject({ link: null, error: null, notice: m.cloud.errors["not-live"] });
  });

  it("stays read-only when the room is left", async () => {
    const open = await getDesignForEditing(shared.id);
    useEditor.getState().actions.openDesign(open!.design);
    try {
      await applyTeamRole(shared.id);
      expect(useEditor.getState().mode).toBe("view");
      const leave = connectTeamLive(shared.id, { server: "http://127.0.0.1:9", room: "r_nowhere", key: "", role: "view" }, "a session");
      leave();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(useEditor.getState().mode).toBe("view");
    } finally {
      useEditor.getState().actions.closeDesign();
    }
  });
});

/**
 * The session of this device as it is kept and read back (state.ts): a record that is not a session is no session (the person
 * signs in again), the teams and the space the dashboard shows are only what the record can stand for, and what is made goes into
 * a space the person may make designs in.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign } from "@/core/factory";
import { getSummary, saveDesign } from "@/core/library";
import { metaGet, metaSet } from "@/core/persistence";
import { boot, closeAll, signUp } from "@/server/accounts/testServer";
import { wipeDatabase } from "@/test/logicDb";
import {
  applySession,
  inActiveSpace,
  readSession,
  roleIn,
  saveSession,
  SESSION_KEY,
  setActiveSpace,
  spaceTeam,
  startCloud,
  updateSession,
  useAccount,
  useCloud,
  type CloudSession,
} from "./state";
import { stopSync } from "./sync";
import { useSyncStatus } from "./syncStatus";

const USER = "user_of_ann_0000001";
const TEAM = "team_of_studio_0001";
const VIEWED = "team_viewed_only_01";

const session = (extra: Partial<CloudSession> = {}): CloudSession => ({
  server: "https://accounts.example.org",
  token: "T".repeat(43),
  user: { id: USER, email: "ann@example.org", name: "Ann" },
  device: "Test laptop",
  teams: [
    { id: TEAM, name: "Studio", role: "editor" },
    { id: VIEWED, name: "Viewed", role: "viewer" },
  ],
  activeSpace: USER,
  ...extra,
});

beforeEach(async () => {
  await wipeDatabase();
});

afterEach(async () => {
  stopSync();
  await saveSession(null);
  await closeAll();
});

describe("reading the session back", () => {
  it("is no session for anything that is not a record, or whose server, token or person is not one", () => {
    const good = session();
    expect(readSession(good)).toEqual(good);
    for (const value of [null, undefined, "a session", 42]) expect(readSession(value)).toBeNull();
    expect(readSession({ ...good, server: "ftp://accounts.example.org" })).toBeNull();
    expect(readSession({ ...good, server: 7 })).toBeNull();
    expect(readSession({ ...good, token: "too short" })).toBeNull();
    expect(readSession({ ...good, user: undefined })).toBeNull();
    expect(readSession({ ...good, user: { ...good.user, id: "short" } })).toBeNull();
    expect(readSession({ ...good, user: { ...good.user, email: null } })).toBeNull();
    expect(readSession({ ...good, user: { ...good.user, name: 1 } })).toBeNull();
  });

  it("keeps only the teams it can stand for, and nothing else of them", () => {
    const read = readSession({
      ...session(),
      teams: [
        { id: TEAM, name: "Studio", role: "owner", secret: "dropped" },
        { id: "bad id!", name: "Bad", role: "owner" },
        { id: "team_unknown_role_1", name: "Odd", role: "admin" },
        { id: "team_without_name_1", role: "viewer" },
        null,
      ],
    });
    expect(read?.teams).toEqual([{ id: TEAM, name: "Studio", role: "owner" }]);
    expect(readSession({ ...session(), teams: "none" })?.teams).toEqual([]);
  });

  it("shows the person's own space when the one kept is not a space of theirs, and names no device when none was kept", () => {
    expect(readSession({ ...session(), activeSpace: TEAM })?.activeSpace).toBe(TEAM);
    expect(readSession({ ...session(), activeSpace: "team_left_long_ago" })?.activeSpace).toBe(USER);
    expect(readSession({ ...session(), activeSpace: 3 })?.activeSpace).toBe(USER);
    expect(readSession({ ...session(), device: undefined })?.device).toBe("");
  });
});

describe("the spaces of the signed-in person", () => {
  it("names the role in a space, and the team a space is, and nothing while nobody is signed in", () => {
    const s = session();
    expect(roleIn(USER, s)).toBe("owner");
    expect(roleIn(TEAM, s)).toBe("editor");
    expect(roleIn("team_not_joined_01", s)).toBeNull();
    expect(roleIn(undefined, s)).toBeNull();
    expect(roleIn(TEAM, null)).toBeNull();
    expect(spaceTeam(TEAM, s)).toEqual({ id: TEAM, name: "Studio", role: "editor" });
    expect(spaceTeam(USER, s)).toBeNull();
    expect(spaceTeam(null, s)).toBeNull();
    expect(spaceTeam("team_not_joined_01", s)).toBeNull();
    expect(spaceTeam(TEAM, null)).toBeNull();
  });

  it("lists in the person's own space what is in it and what is on this device only, and in a team's what is in that team's", () => {
    const own = session();
    expect(inActiveSpace({}, own)).toBe(true);
    expect(inActiveSpace({ space: USER }, own)).toBe(true);
    expect(inActiveSpace({ space: TEAM }, own)).toBe(false);
    const team = session({ activeSpace: TEAM });
    expect(inActiveSpace({ space: TEAM }, team)).toBe(true);
    expect(inActiveSpace({}, team)).toBe(false);
    expect(inActiveSpace({ space: USER }, team)).toBe(false);
    // while nobody is signed in, everything is listed
    expect(inActiveSpace({ space: TEAM }, null)).toBe(true);
  });

  it("makes designs in the team the dashboard shows when the person may, and in their own space when they only view it", async () => {
    applySession(session({ activeSpace: TEAM }));
    const inTeam = createDesign({ title: "In the team", width: 10, height: 10 });
    await saveDesign(inTeam);
    expect((await getSummary(inTeam.id))?.space).toBe(TEAM);
    applySession(session({ activeSpace: VIEWED }));
    const own = createDesign({ title: "Made while viewing", width: 10, height: 10 });
    await saveDesign(own);
    expect((await getSummary(own.id))?.space).toBe(USER);
    applySession(null);
    const mine = createDesign({ title: "Signed out", width: 10, height: 10 });
    await saveDesign(mine);
    expect((await getSummary(mine.id))?.space).toBeUndefined();
  });

  it("shows a team's space only when the person is in the team, and changes nothing while nobody is signed in", async () => {
    await saveSession(session());
    await setActiveSpace(TEAM);
    expect(useCloud.getState().session?.activeSpace).toBe(TEAM);
    await setActiveSpace("team_not_joined_01");
    expect(useCloud.getState().session?.activeSpace).toBe(USER);
    expect((await metaGet<CloudSession | null>(SESSION_KEY, null))?.activeSpace).toBe(USER);
    await saveSession(null);
    await updateSession((s) => ({ ...s, device: "Changed" }));
    expect(useCloud.getState().session).toBeNull();
    expect(await metaGet(SESSION_KEY, "missing")).toBeNull();
  });

  it("changes the session as another tab kept it, not as this tab last had it", async () => {
    await saveSession(session());
    await metaSet(SESSION_KEY, session({ device: "Renamed in another tab" }));
    await updateSession((s) => ({ ...s, activeSpace: TEAM }));
    expect(useCloud.getState().session).toMatchObject({ device: "Renamed in another tab", activeSpace: TEAM });
  });
});

describe("the account the screens show", () => {
  it("is nulls and no teams while nobody is signed in, and the server, the person, the teams and the space once signed in", async () => {
    applySession(null);
    const { result, rerender } = renderHook(() => useAccount());
    expect(result.current).toEqual({ server: null, user: null, teams: [], activeSpace: null, session: null });
    const s = session({ activeSpace: TEAM });
    applySession(s);
    rerender();
    expect(result.current).toEqual({ server: s.server, user: s.user, teams: s.teams, activeSpace: TEAM, session: s });
  });
});

describe("starting", () => {
  it("reads the session kept on this device and starts syncing with it", async () => {
    const b = await boot();
    const person = await signUp(b, { name: "Ann" });
    await metaSet(SESSION_KEY, { server: b.base, token: person.token, user: person.user, device: "Test laptop", teams: [], activeSpace: person.user.id });
    await startCloud();
    expect(useCloud.getState()).toMatchObject({ loaded: true, session: { server: b.base, user: { id: person.user.id, name: "Ann" } } });
    await expect.poll(() => useSyncStatus.getState().state).toBe("synced");
    // (safe to call twice: it is the same start)
    expect(startCloud()).toBe(startCloud());
  });
});

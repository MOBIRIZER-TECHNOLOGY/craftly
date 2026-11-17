/** What a hostile account server can send, and that none of it gets in (docs/ACCOUNTS.md, "Security"). */
import { describe, expect, it } from "vitest";
import { createDesign, createImage, createPage, createShape } from "@/core/factory";
import { CURRENT_DESIGN_VERSION } from "@/core/schema/design";
import { BadAnswer, NewerDesign, readChanges, readLive, readMe, readMissing, readRemoteAsset, readRemoteDesign, readSignedIn, readTeamPage } from "./validate";

const ID = "user_aaaaaaaaaaaaaaaa";
const TOKEN = "A".repeat(43);
const design = (extra: Record<string, unknown> = {}) => ({
  ...createDesign({ title: "Poster", width: 100, height: 100, pages: [createPage({ elements: [createShape("rect")] })] }),
  id: "d_1",
  ...extra,
});

describe("people and sessions", () => {
  it("reads a sign-in, and refuses a token or a person that is not one", () => {
    const user = { id: ID, email: "ann@example.org", name: "Ann", createdAt: 1 };
    expect(readSignedIn({ token: TOKEN, user })).toEqual({ token: TOKEN, user: { id: ID, email: "ann@example.org", name: "Ann" } });
    expect(() => readSignedIn({ token: "short", user })).toThrow(BadAnswer);
    expect(() => readSignedIn({ token: TOKEN, user: { ...user, id: "../../etc" } })).toThrow(BadAnswer);
    expect(() => readSignedIn({ token: TOKEN, user: { ...user, name: "a\u0000b" } })).toThrow(BadAnswer);
    expect(() => readSignedIn(null)).toThrow(BadAnswer);
  });

  it("reads teams with roles it knows, and nothing else", () => {
    const user = { id: ID, email: "ann@example.org", name: "Ann" };
    expect(readMe({ user, teams: [{ id: ID, name: "Studio", role: "editor" }] }).teams).toEqual([{ id: ID, name: "Studio", role: "editor" }]);
    expect(() => readMe({ user, teams: [{ id: ID, name: "Studio", role: "admin" }] })).toThrow(BadAnswer);
    expect(() => readTeamPage({ team: { id: ID, name: "S", role: "owner" }, members: [{ id: ID, name: "A", email: "a@b", role: "god" }] })).toThrow(BadAnswer);
  });
});

describe("the changes feed", () => {
  const entry = { id: "d_1", rev: 2, metaSeq: 3, seq: 3, title: "Poster", folderId: null, starred: false, trashedAt: null, updatedAt: 5, deletedAt: null };

  it("reads designs, folders and uploads", () => {
    const read = readChanges({ cursor: 3, more: false, designs: [entry], folders: [], assets: [{ id: "a_1", mime: "image/png", bytes: 3, seq: 1, createdAt: 1 }] }, 0);
    expect(read.designs[0]).toMatchObject({ id: "d_1", rev: 2, deletedAt: null });
    expect(read.assets).toEqual([{ id: "a_1", mime: "image/png" }]);
  });

  it("refuses ids that are not this app's, a cursor that goes back, and uploads that are no picture", () => {
    expect(() => readChanges({ cursor: 3, more: false, designs: [{ ...entry, id: "../x" }], folders: [], assets: [] }, 0)).toThrow(BadAnswer);
    expect(() => readChanges({ cursor: 1, more: false, designs: [], folders: [], assets: [] }, 2)).toThrow(BadAnswer);
    expect(() => readChanges({ cursor: 3, more: false, designs: [], folders: [], assets: [{ id: "a", mime: "text/html" }] }, 0)).toThrow(BadAnswer);
    expect(() => readChanges({ cursor: 3, more: false, designs: [{ ...entry, rev: -1 }], folders: [], assets: [] }, 0)).toThrow(BadAnswer);
    expect(() => readChanges({ cursor: 3, more: "yes", designs: [], folders: [], assets: [] }, 0)).toThrow(BadAnswer);
  });
});

describe("a design from the server", () => {
  it("is checked as a hostile room's and brought to this format", () => {
    const read = readRemoteDesign({ design: design(), rev: 1, thumbnail: "data:image/png;base64,AAAA" }, "d_1");
    expect(read.design.version).toBe(CURRENT_DESIGN_VERSION);
    expect(read.thumbnail).toBe("data:image/png;base64,AAAA");
  });

  it("refuses a picture from the web, a script address, another id and a live link", () => {
    const web = design({ pages: [createPage({ elements: [createImage({ src: "https://evil.example/x.png" })] })] });
    expect(() => readRemoteDesign({ design: web, rev: 1 }, "d_1")).toThrow(BadAnswer);
    const script = design({ pages: [createPage({ elements: [createShape("rect", { link: "javascript:alert(1)" } as never)] })] });
    expect(() => readRemoteDesign({ design: script, rev: 1 }, "d_1")).toThrow(BadAnswer);
    expect(() => readRemoteDesign({ design: design(), rev: 1 }, "d_2")).toThrow(BadAnswer);
    expect(() => readRemoteDesign({ design: design({ live: { server: "x", room: "y", key: "z", role: "edit" } }), rev: 1 }, "d_1")).toThrow(BadAnswer);
    expect(() => readRemoteDesign({ design: { ...design(), __proto__: { polluted: true } }, rev: 1 }, "d_1")).not.toThrow(TypeError);
  });

  it("drops a thumbnail that is not a JPEG or PNG data address", () => {
    expect(readRemoteDesign({ design: design(), rev: 1, thumbnail: "data:text/html;base64,AAAA" }, "d_1").thumbnail).toBeUndefined();
    expect(readRemoteDesign({ design: design(), rev: 1, thumbnail: "javascript:1" }, "d_1").thumbnail).toBeUndefined();
  });

  it("says so for a design from a newer Craftly, which is not stored", () => {
    expect(() => readRemoteDesign({ design: design({ version: CURRENT_DESIGN_VERSION + 1 }), rev: 1 }, "d_1")).toThrow(NewerDesign);
  });
});

describe("uploads, missing ids and rooms", () => {
  it("takes pictures only", () => {
    expect(readRemoteAsset({ mime: "image/png", base64: "iVBO" })).toEqual({ mime: "image/png", base64: "iVBO" });
    expect(() => readRemoteAsset({ mime: "text/html", base64: "PGh0bWw+" })).toThrow(BadAnswer);
    expect(() => readRemoteAsset({ mime: "image/png", base64: "<script>" })).toThrow(BadAnswer);
  });

  it("keeps only the ids that were asked about", () => {
    expect(readMissing({ missing: ["a", "b", "z", 4] }, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("takes a room's socket only on the server that answered, at the room it named", () => {
    const room = "r".repeat(43);
    expect(readLive({ room, ws: `/ws?room=${room}`, role: "edit" })).toEqual({ room, ws: `/ws?room=${room}`, role: "edit" });
    expect(() => readLive({ room, ws: "wss://evil.example/ws", role: "edit" })).toThrow(BadAnswer);
    expect(() => readLive({ room, ws: `/ws?room=${room}`, role: "owner" })).toThrow(BadAnswer);
  });
});

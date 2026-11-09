/**
 * The links of a shared design: the address of the server turned into the ones the browser needs, and the one link that is given to
 * other people, which carries the server, the room and the key in the part after the # (so that the server never sees the key in a
 * log) and is read back strictly, since it comes from outside.
 */
import { describe, expect, it } from "vitest";
import { apiUrl, joinToken, joinUrl, normalizeServer, parseJoinToken, websocketUrl } from "./links";

const link = { server: "https://live.example.test", room: "TW-FaxWt8edjpnT-bGQyjA", key: "WjGO30NJy5udhntaj-8j9w", role: "edit" as const };

describe("the address of the server", () => {
  it.each([
    ["http://127.0.0.1:8787", "http://127.0.0.1:8787"],
    ["https://live.example.test/", "https://live.example.test"],
    ["  https://live.example.test///  ", "https://live.example.test"],
    ["live.example.test", "https://live.example.test"],
    ["localhost:8787", "http://localhost:8787"],
    ["127.0.0.1:8787", "http://127.0.0.1:8787"],
    ["ws://127.0.0.1:8787", "http://127.0.0.1:8787"],
    ["wss://live.example.test/", "https://live.example.test"],
    ["https://live.example.test/some/path", "https://live.example.test/some/path"],
  ])("makes %s into %s", (typed, normalized) => {
    expect(normalizeServer(typed)).toBe(normalized);
  });

  it.each(["", "   ", "javascript:alert(1)", "ftp://x.test", "http://", "https://exa mple.test", "file:///etc/passwd", "data:text/html,x"])("refuses %j", (typed) => {
    expect(normalizeServer(typed)).toBeNull();
  });

  it("gives the addresses of the interface and of the socket", () => {
    expect(apiUrl("https://live.example.test", "/api/rooms")).toBe("https://live.example.test/api/rooms");
    expect(apiUrl("http://127.0.0.1:8787/base", "/api/rooms")).toBe("http://127.0.0.1:8787/base/api/rooms");
    expect(websocketUrl(link)).toBe("wss://live.example.test/ws?room=TW-FaxWt8edjpnT-bGQyjA&key=WjGO30NJy5udhntaj-8j9w");
    expect(websocketUrl({ ...link, key: "a&b c" })).toContain("&key=a%26b%20c");
    expect(websocketUrl({ ...link, server: "http://127.0.0.1:8787" })).toBe("ws://127.0.0.1:8787/ws?room=TW-FaxWt8edjpnT-bGQyjA&key=WjGO30NJy5udhntaj-8j9w");
  });
});

describe("the link that is given to other people", () => {
  it("carries the server, the room, the key and what it allows, in one piece that is safe in an address", () => {
    const token = joinToken(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(link.key); // not in the clear
    expect(parseJoinToken(token)).toEqual(link);
    expect(parseJoinToken(joinToken({ ...link, role: "view" }))).toEqual({ ...link, role: "view" });
  });

  it("is put after the # of the address of the editor, so a server never sees it", () => {
    expect(joinUrl("https://app.example.test/craftly/", link)).toBe(`https://app.example.test/craftly/#/join/${joinToken(link)}`);
    expect(joinUrl("https://app.example.test/craftly/index.html?x=1#/design/abc", link)).toBe(`https://app.example.test/craftly/index.html?x=1#/join/${joinToken(link)}`);
  });

  it("is read back by an address of the editor's own kind, and refused when it is not what this app makes", () => {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parseJoinToken("")).toBeNull();
    expect(parseJoinToken("not base64 !!")).toBeNull();
    expect(parseJoinToken(btoa("plain text"))).toBeNull();
    expect(parseJoinToken(encode(["a"]))).toBeNull();
    expect(parseJoinToken(encode({ s: "https://x.test", r: "short", k: link.key, v: "e" }))).toBeNull(); // not a room id
    expect(parseJoinToken(encode({ s: "https://x.test", r: link.room, k: "k", v: "e" }))).toBeNull(); // not a key
    expect(parseJoinToken(encode({ s: "https://x.test", r: link.room + "!", k: link.key, v: "e" }))).toBeNull();
    expect(parseJoinToken(encode({ s: "javascript:alert(1)", r: link.room, k: link.key, v: "e" }))).toBeNull();
    expect(parseJoinToken(encode({ s: "https://x.test", r: link.room, k: "has space", v: "e" }))).toBeNull();
    expect(parseJoinToken(encode({ s: "https://x.test", r: link.room, k: link.key, v: "admin" }))).toBeNull();
    expect(parseJoinToken(encode({ s: "https://x.test", r: link.room, k: "x".repeat(200), v: "e" }))).toBeNull();
    expect(parseJoinToken(encode({ s: "https://x.test", r: link.room, k: link.key, v: "e" }))).toEqual({ server: "https://x.test", room: link.room, key: link.key, role: "edit" });
  });
});

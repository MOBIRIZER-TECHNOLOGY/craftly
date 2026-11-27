import { describe, expect, it } from "vitest";
import { listenWarning, openRoomsWarning } from "./listenWarning";

describe("the warning of a live server that other machines can reach", () => {
  it.each(["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "[::1]", "localhost", "LOCALHOST", " 127.0.0.1 ", "::ffff:127.0.0.1"])(
    "says nothing for %s, which only this machine can reach",
    (host) => {
      expect(listenWarning(host)).toBeNull();
    },
  );

  it.each(["0.0.0.0", "::", "", "192.168.1.20", "10.0.0.5", "live.example.org", "1127.0.0.1", "127.0.0.1.example.org", "127.0.0", "127.0.0.256"])(
    'warns for "%s": plain HTTP and WebSocket need a proxy with TLS in front',
    (host) => {
      const warning = listenWarning(host);
      expect(warning).toContain("plain HTTP and WebSocket");
      expect(warning).toContain("reverse proxy");
      expect(warning).toContain("TLS");
      expect(warning).toContain("HOST=127.0.0.1");
      expect(warning).toContain("docs/DEPLOY.md");
    },
  );

  it("names the address it is about, and all addresses in words", () => {
    expect(listenWarning("192.168.1.20")).toContain("192.168.1.20");
    expect(listenWarning("0.0.0.0")).toContain("every address of this machine (0.0.0.0)");
    expect(listenWarning("::")).toContain("every address of this machine (::)");
    expect(listenWarning("")).toContain("every address of this machine");
  });
});

describe("the note on who may make rooms, and for how long", () => {
  it("is said when either setting is missing, and names what to set", () => {
    expect(openRoomsWarning({ roomCreateKey: "a-long-key", roomTtlDays: 30 })).toBeNull();
    const both = openRoomsWarning({});
    expect(both).toContain("anybody who can reach this server may make rooms");
    expect(both).toContain("rooms are kept until their owners stop sharing");
    expect(both).toContain("set ROOM_CREATE_KEY and ROOM_TTL_DAYS (30, say)");
    expect(openRoomsWarning({ roomCreateKey: "a-long-key" })).toMatch(/set ROOM_TTL_DAYS \(30, say\), so that/);
    expect(openRoomsWarning({ roomTtlDays: 30 })).toMatch(/set ROOM_CREATE_KEY, so that/);
    expect(openRoomsWarning({ roomTtlDays: 0 })).toContain("ROOM_TTL_DAYS is not set");
  });
});

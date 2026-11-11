import { beforeEach, describe, expect, it } from "vitest";
import { isKnownServer, rememberServer, serverName, serverOrigin } from "./knownServers";

beforeEach(() => localStorage.clear());

describe("the live servers known on this device", () => {
  it("does not know a server nobody dealt with", () => {
    expect(isKnownServer("https://live.example.org")).toBe(false);
  });

  it("knows a server once it is remembered, whatever the path, the case or the end slash of the address", () => {
    rememberServer("https://Live.Example.org/craftly/");
    expect(isKnownServer("https://live.example.org")).toBe(true);
    expect(isKnownServer("https://LIVE.example.org/other")).toBe(true);
  });

  it("tells servers apart by scheme, name and port", () => {
    rememberServer("https://live.example.org");
    expect(isKnownServer("http://live.example.org")).toBe(false);
    expect(isKnownServer("https://live.example.org:8443")).toBe(false);
    expect(isKnownServer("https://evil.example.org")).toBe(false);
    expect(isKnownServer("https://live.example.org.evil.test")).toBe(false);
  });

  it("knows the server the site was built for, and a server at the address of the site itself", () => {
    expect(isKnownServer("https://live.example.org/x", "https://live.example.org")).toBe(true);
    expect(isKnownServer("https://other.example.org", "https://live.example.org")).toBe(false);
    expect(isKnownServer(location.origin)).toBe(true);
  });

  it("keeps the fifty it heard of last, and each one once", () => {
    for (let i = 0; i < 60; i++) rememberServer(`https://s${i}.example.org`);
    rememberServer("https://s59.example.org");
    const kept = JSON.parse(localStorage.getItem("craftly:live-servers")!) as string[];
    expect(kept).toHaveLength(50);
    expect(kept.at(-1)).toBe("https://s59.example.org");
    expect(isKnownServer("https://s9.example.org")).toBe(false);
    expect(isKnownServer("https://s10.example.org")).toBe(true);
  });

  it("copes with a list that is damaged or is no list", () => {
    localStorage.setItem("craftly:live-servers", "{not json");
    expect(isKnownServer("https://live.example.org")).toBe(false);
    localStorage.setItem("craftly:live-servers", JSON.stringify({ a: 1 }));
    expect(isKnownServer("https://live.example.org")).toBe(false);
    localStorage.setItem("craftly:live-servers", JSON.stringify(["https://live.example.org", 5, null]));
    expect(isKnownServer("https://live.example.org")).toBe(true);
    rememberServer("https://two.example.org");
    expect(JSON.parse(localStorage.getItem("craftly:live-servers")!)).toEqual(["https://live.example.org", "https://two.example.org"]);
  });

  it("names a server for a person, and takes an address that is none as it is", () => {
    expect(serverName("https://live.example.org/craftly")).toBe("live.example.org");
    expect(serverName("http://127.0.0.1:8787")).toBe("127.0.0.1:8787");
    expect(serverName("not an address")).toBe("not an address");
    expect(serverOrigin("not an address")).toBe("not an address");
  });
});

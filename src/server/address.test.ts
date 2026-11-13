/**
 * Whose request it is, as far as the server can tell, and how many rooms one address may make in an hour. No sockets here: the
 * addresses and the time are given.
 */
import { describe, expect, it } from "vitest";
import { addressKey, clientAddress, hourlyLimit } from "./address";

describe("the address a request came from", () => {
  it("is the address of the connection, whatever the request says about itself, unless a proxy is trusted", () => {
    expect(clientAddress("203.0.113.7", undefined, false)).toBe("203.0.113.7");
    expect(clientAddress("203.0.113.7", "198.51.100.1", false)).toBe("203.0.113.7");
    expect(clientAddress("203.0.113.7", ["198.51.100.1", "198.51.100.2"], false)).toBe("203.0.113.7");
  });

  it("is the last address of X-Forwarded-For when one proxy is trusted: the one that proxy wrote, not what the browser sent before it", () => {
    expect(clientAddress("10.0.0.2", "198.51.100.1", true)).toBe("198.51.100.1");
    // a browser may send the header itself; the proxy adds what it saw at the end, and only that is believed
    expect(clientAddress("10.0.0.2", "1.1.1.1, 198.51.100.1", true)).toBe("198.51.100.1");
    expect(clientAddress("10.0.0.2", "1.1.1.1,2.2.2.2 ,  198.51.100.1 ", true)).toBe("198.51.100.1");
    // the header twice is one list, in the order it came
    expect(clientAddress("10.0.0.2", ["1.1.1.1", "198.51.100.1"], true)).toBe("198.51.100.1");
    expect(clientAddress("10.0.0.2", "2001:db8:1:2:3:4:5:6", true)).toBe("2001:db8:1:2::/64");
  });

  it.each<[string, string | undefined]>([
    ["is not there", undefined],
    ["is empty", ""],
    ["ends with nothing", "198.51.100.1, "],
    ["ends with something that is no address", "198.51.100.1, unknown"],
    ["ends with an address and a port", "198.51.100.1:4000"],
    ["ends with a name", "example.org"],
  ])("falls back to the address of the connection when a proxy is trusted and the header %s", (_what, header) => {
    expect(clientAddress("10.0.0.2", header, true)).toBe("10.0.0.2");
  });

  it("says something for a connection that has no address any more", () => {
    expect(clientAddress(undefined, undefined, false)).toBe("unknown");
    expect(clientAddress(undefined, "nonsense", true)).toBe("unknown");
  });
});

describe("one name for the addresses of one visitor", () => {
  it.each<[string, string]>([
    ["203.0.113.7", "203.0.113.7"],
    // IPv4 that arrived on a socket that also speaks IPv6
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
    // a home or a server is given 2^64 addresses of IPv6 at a time, so the first half of the address is the visitor
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3:8d3::/64"],
    ["2001:0DB8:0000:0001:0000:0000:0000:0001", "2001:db8:0:1::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8:1::", "2001:db8:1:0::/64"],
    ["2001:db8:1:2:3::", "2001:db8:1:2::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["64:ff9b::192.0.2.33", "64:ff9b:0:0::/64"],
    // what is no address is kept as it is: it is still one name for one thing
    ["not an address", "not an address"],
  ])("%s is %s", (address, key) => {
    expect(addressKey(address)).toBe(key);
  });
});

describe("so many in an hour", () => {
  const MINUTE = 60_000;
  const clock = () => {
    let at = 1_000_000;
    return { now: () => at, pass: (ms: number) => void (at += ms) };
  };

  it("lets an address through as often as it may, then says how many seconds to wait, and lets it through again when the oldest is an hour old", () => {
    const time = clock();
    const limit = hourlyLimit(2, time.now);
    expect(limit.take("a")).toBe(0);
    time.pass(10 * MINUTE);
    expect(limit.take("a")).toBe(0);
    expect(limit.take("a")).toBe(50 * 60);
    time.pass(49 * MINUTE + 59_500);
    expect(limit.take("a")).toBe(1); // half a second is left: never "wait 0 seconds"
    time.pass(500);
    expect(limit.take("a")).toBe(0); // the first is an hour old now, the second is not
    expect(limit.take("a")).toBe(10 * 60);
  });

  it("counts every address by itself", () => {
    const time = clock();
    const limit = hourlyLimit(1, time.now);
    expect(limit.take("a")).toBe(0);
    expect(limit.take("b")).toBe(0);
    expect(limit.take("a")).toBe(3600);
    expect(limit.take("b")).toBe(3600);
  });

  it("does not count what it refused: asking again and again does not make the wait longer", () => {
    const time = clock();
    const limit = hourlyLimit(1, time.now);
    expect(limit.take("a")).toBe(0);
    for (let i = 0; i < 5; i++) {
      time.pass(10 * MINUTE);
      expect(limit.take("a")).toBe(3600 - (i + 1) * 600);
    }
    time.pass(10 * MINUTE);
    expect(limit.take("a")).toBe(0);
  });

  it("forgets an address an hour after it last came, so that what it remembers does not grow for ever", () => {
    const time = clock();
    const limit = hourlyLimit(3, time.now);
    for (let i = 0; i < 500; i++) limit.take(`visitor-${i}`);
    expect(limit.size()).toBe(500);
    time.pass(30 * MINUTE);
    limit.take("late");
    expect(limit.size()).toBe(501);
    time.pass(31 * MINUTE);
    limit.take("later"); // the 500 are over an hour old; "late" is not
    expect(limit.size()).toBe(2);
    time.pass(61 * MINUTE);
    limit.take("later");
    expect(limit.size()).toBe(1);
  });

  it("says how long a name has to wait without counting anything, so that a refusal can come before the question", () => {
    const time = clock();
    const limit = hourlyLimit(2, time.now);
    expect(limit.wait("a")).toBe(0);
    expect(limit.size()).toBe(0); // asking is not doing
    limit.take("a");
    expect(limit.wait("a")).toBe(0);
    limit.take("a");
    expect(limit.wait("a")).toBe(3600);
    expect(limit.wait("b")).toBe(0);
    time.pass(20 * MINUTE);
    expect(limit.wait("a")).toBe(2400);
    time.pass(41 * MINUTE);
    expect(limit.wait("a")).toBe(0);
    expect(hourlyLimit(0, time.now).wait("a")).toBe(0);
  });

  it("limits nothing when the limit is 0", () => {
    const time = clock();
    const limit = hourlyLimit(0, time.now);
    for (let i = 0; i < 100; i++) expect(limit.take("a")).toBe(0);
    expect(limit.size()).toBe(0);
  });
});

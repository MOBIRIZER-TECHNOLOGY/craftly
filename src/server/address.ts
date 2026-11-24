/**
 * Whose request it is, as far as the server can tell, and a count of what each address did in the last hour. The server uses both
 * to limit how many rooms one address may make (live.ts). Nothing here touches a socket or a clock of its own.
 */
import { isIP } from "node:net";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * One name for the addresses of one visitor. An IPv4 address is itself, also when it arrived written as IPv6 (`::ffff:1.2.3.4`,
 * as a socket that speaks both writes it). An IPv6 address is its first half: a home or a rented server is given 2^64 addresses
 * at a time, and counting each of them by itself would count nothing. What is no address is kept as it is.
 */
export function addressKey(address: string): string {
  const zone = address.indexOf("%");
  const plain = zone < 0 ? address : address.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(plain);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  if (isIP(plain) === 4) return plain;
  if (isIP(plain) !== 6) return address;
  // the groups before a "::" are the front of the address, and what the "::" stands for is zeros
  const front = plain.split("::")[0].split(":").filter(Boolean);
  while (front.length < 4) front.push("0");
  return `${front
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

/**
 * The address a request came from. That is the address of the connection, and nothing the request says about itself, unless the
 * server was told that it stands behind a reverse proxy (`trustProxy`). Then it is the last entry of `X-Forwarded-For`: the one
 * that the proxy added for the connection it accepted. Everything before it was sent by the visitor, or by proxies nobody vouched
 * for, and is not believed; so exactly one proxy is trusted, the one that connects to this server. With the option on, the server
 * must be reachable through that proxy only, because anybody who reaches it directly can write the header themselves. A header
 * that is missing, or whose last entry is no address, counts as the proxy's own address.
 */
export function clientAddress(remote: string | undefined, forwardedFor: string | string[] | undefined, trustProxy: boolean): string {
  if (trustProxy && forwardedFor !== undefined) {
    const last = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor).split(",").pop()!.trim();
    if (isIP(last)) return addressKey(last);
  }
  return remote ? addressKey(remote) : "unknown";
}

export interface HourlyLimit {
  /** Counts one more for this name, if it may: 0 when it may, and otherwise the seconds until it may again (nothing is counted then). */
  take(name: string): number;
  /** The seconds until this name may again, or 0 when it may now. Nothing is counted: it is a question, and `take` is the deed. */
  wait(name: string): number;
  /** How many names are remembered now. */
  size(): number;
}

/**
 * At most `perHour` for each name in any hour (0: no limit, and nothing is remembered). A name is forgotten when what it did is
 * over an hour old, so the memory this takes is bounded by what arrived in the last hour and a minute.
 */
export function hourlyLimit(perHour: number, now: () => number): HourlyLimit {
  const taken = new Map<string, number[]>();
  let tidied = now();
  const recent = (times: number[], at: number) => times.filter((time) => time > at - HOUR);
  const waitOf = (times: number[], at: number) => (times.length >= perHour ? Math.max(1, Math.ceil((times[0] + HOUR - at) / 1000)) : 0);
  return {
    wait(name) {
      if (perHour <= 0) return 0;
      const at = now();
      return waitOf(recent(taken.get(name) ?? [], at), at);
    },
    take(name) {
      if (perHour <= 0) return 0;
      const at = now();
      if (at - tidied >= MINUTE) {
        tidied = at;
        for (const [other, times] of taken) {
          const left = recent(times, at);
          if (left.length) taken.set(other, left);
          else taken.delete(other);
        }
      }
      const times = recent(taken.get(name) ?? [], at);
      if (times.length >= perHour) {
        taken.set(name, times);
        return waitOf(times, at);
      }
      times.push(at);
      taken.set(name, times);
      return 0;
    },
    size: () => taken.size,
  };
}

export interface KnownAddresses {
  /** Notes that this name (a person) was just seen at this address. */
  note(name: string, address: string): void;
  /** Whether this name was seen at this address within the time it is kept. */
  has(name: string, address: string): boolean;
  /** How many names are remembered now. */
  size(): number;
}

/**
 * The addresses each name was seen at lately: at most `perName` for each (the oldest goes first), kept for `keepMs` since it was
 * last seen there, for at most `names` names (the one seen longest ago goes first). In memory only: a restart forgets them all.
 */
export function knownAddresses(now: () => number, options: { perName?: number; names?: number; keepMs?: number } = {}): KnownAddresses {
  const perName = options.perName ?? 8;
  const names = options.names ?? 10_000;
  const keepMs = options.keepMs ?? 30 * 24 * HOUR;
  // a Map keeps the order things were put in: deleting before setting again moves a name, or an address, to the end
  const seen = new Map<string, Map<string, number>>();
  return {
    note(name, address) {
      const at = now();
      const addresses = seen.get(name) ?? new Map<string, number>();
      seen.delete(name);
      addresses.delete(address);
      addresses.set(address, at);
      while (addresses.size > perName) addresses.delete(addresses.keys().next().value as string);
      seen.set(name, addresses);
      while (seen.size > names) seen.delete(seen.keys().next().value as string);
    },
    has(name, address) {
      const at = seen.get(name)?.get(address);
      return at !== undefined && now() - at < keepMs;
    },
    size: () => seen.size,
  };
}

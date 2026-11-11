/**
 * The live servers this person has dealt with on this device. A link to a shared design names its server, and anybody can make a
 * link: opening one connects to that server, which then knows this device's address on the network, and the design it sends is
 * kept in the library. So a link to a server that is new here asks first (JoinPage); the ones known here do not ask again.
 *
 * Known are: the server the site was built for (`VITE_CRAFTLY_LIVE_URL`), a server at the site's own address, a server this person
 * started sharing on, and a server they said yes to before. The list is kept in this browser and holds addresses only, no keys.
 */
const KEY = "craftly:live-servers";
const MOST = 50;

/** The server that whoever put this site up chose for it, if they chose one. */
export const CONFIGURED_SERVER = (import.meta.env.VITE_CRAFTLY_LIVE_URL as string | undefined) || null;

/** "https://live.example.org" of a server's address, in small letters; the address itself when it is none. */
export function serverOrigin(server: string): string {
  try {
    return new URL(server).origin.toLowerCase();
  } catch {
    return server.trim().toLowerCase();
  }
}

/** What a person is shown of a server: its name on the network, with the port when it has one ("live.example.org", "127.0.0.1:8787"). */
export function serverName(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

function remembered(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Has this person dealt with this server on this device, or is it the site's own? */
export function isKnownServer(server: string, configured: string | null = CONFIGURED_SERVER): boolean {
  const origin = serverOrigin(server);
  if (configured && serverOrigin(configured) === origin) return true;
  if (typeof location !== "undefined" && location.origin.toLowerCase() === origin) return true;
  return remembered().includes(origin);
}

/** Remembers a server the person chose to deal with. A browser that keeps nothing (a private window) asks again next time. */
export function rememberServer(server: string): void {
  const origin = serverOrigin(server);
  try {
    const list = remembered().filter((entry) => entry !== origin);
    list.push(origin);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MOST)));
  } catch {
    /* no storage: nothing is remembered */
  }
}

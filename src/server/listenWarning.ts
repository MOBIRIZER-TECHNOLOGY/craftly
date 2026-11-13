/**
 * What the live server says at its start when other machines can reach it. The server speaks plain HTTP and WebSocket: it has no
 * TLS of its own, so links (which carry the keys of a room), designs and pictures would cross the network as they are, and a page
 * loaded over https:// may not connect to it at all. That is right behind a reverse proxy that ends TLS and wrong on its own, and
 * the server cannot tell which of the two it is, so it says it every time it listens on anything but this machine itself.
 * `main.ts` prints the answer; the decision is here so that it can be tested (docs/DEPLOY.md, section 2.4).
 */

/** Whether only programs on this machine can reach a server that listens on `host`. */
function isLoopback(host: string): boolean {
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/^::ffff:/, "");
  if (name === "localhost" || name === "::1") return true;
  const parts = name.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** The warning for a server that listens on `host` (the value of HOST), or null when only this machine can reach it. */
export function listenWarning(host: string): string | null {
  if (isLoopback(host)) return null;
  const name = host.trim();
  const where = name === "" || name === "0.0.0.0" || name === "::" ? `every address of this machine${name ? ` (${name})` : ""}` : name;
  return (
    `Warning: the Craftly live server listens on ${where}, so other machines can reach it, and it speaks plain HTTP and WebSocket. ` +
    "Links, designs and pictures are not encrypted on the way, and a page loaded over https:// cannot connect to it. " +
    "Put a reverse proxy that terminates TLS in front of it and let only the proxy reach this port (docs/DEPLOY.md, section 2.4), " +
    "or set HOST=127.0.0.1 when the proxy runs on this machine."
  );
}

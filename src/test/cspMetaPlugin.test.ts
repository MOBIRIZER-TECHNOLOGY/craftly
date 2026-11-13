import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addConnectHosts, connectHosts, cspMeta, metaPolicy } from "../../vite.config";

/** The hooks of the plugin that the build calls. */
interface Hooks {
  name: string;
  apply: string;
  configResolved(config: { root: string; publicDir: string; build: { outDir: string }; env: Record<string, string> }): void;
  transformIndexHtml(html: string): string;
  closeBundle(): void;
}

const HEADERS = [
  "# Response headers",
  "/*",
  "  X-Content-Type-Options: nosniff",
  "",
  "# The policy",
  "/*",
  "  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://models.example.org blob:; sandbox allow-scripts; frame-ancestors 'self'; report-uri /csp",
  "",
].join("\n");
const META = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://models.example.org blob:";

let folder = "";
afterEach(() => rmSync(folder, { recursive: true, force: true }));

/** A project folder with the headers file in public/ and, as after a build, a copy of it in dist/. */
function setup(headers: string | null, env: Record<string, string> = {}) {
  folder = mkdtempSync(join(tmpdir(), "craftly-csp-"));
  for (const sub of ["public", "dist"]) {
    mkdirSync(join(folder, sub), { recursive: true });
    if (headers !== null) writeFileSync(join(folder, sub, "_headers"), headers);
  }
  const plugin = cspMeta() as unknown as Hooks;
  const resolve = () => plugin.configResolved({ root: folder, publicDir: join(folder, "public"), build: { outDir: "dist" }, env });
  return { plugin, resolve };
}
const built = () => readFileSync(join(folder, "dist", "_headers"), "utf8");

describe("the policy a meta tag can carry", () => {
  it("is the policy of the headers file without the three directives a browser ignores in a meta tag", () => {
    expect(metaPolicy(HEADERS)).toBe(META);
  });

  it("is what the real headers file sends, less frame-ancestors, so the two cannot drift apart", () => {
    const real = readFileSync("public/_headers", "utf8");
    const sent = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(real)![1];
    expect(sent).toContain("; frame-ancestors 'self'");
    expect(metaPolicy(real)).toBe(sent.replace("; frame-ancestors 'self'", ""));
    expect(metaPolicy(real)).toContain("script-src 'self' 'wasm-unsafe-eval'");
  });

  it("is the policy that the README shows", () => {
    const sent = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(readFileSync("public/_headers", "utf8"))![1];
    expect(readFileSync("README.md", "utf8")).toContain(`\n  ${sent}\n`);
  });

  it("fails in plain words when the headers file has no policy", () => {
    expect(() => metaPolicy("/*\n  X-Content-Type-Options: nosniff\n")).toThrow("public/_headers has no Content-Security-Policy line");
  });
});

describe("the hosts a build adds to connect-src (VITE_CRAFTLY_CSP_CONNECT)", () => {
  it("reads a list with spaces or commas between the addresses, and none when nothing is set", () => {
    expect(connectHosts("https://live.example.org wss://live.example.org")).toEqual(["https://live.example.org", "wss://live.example.org"]);
    expect(connectHosts(" https://a.example.org:8443,\n wss://*.example.org , http://[::1]:8787 ")).toEqual([
      "https://a.example.org:8443",
      "wss://*.example.org",
      "http://[::1]:8787",
    ]);
    expect(connectHosts(undefined)).toEqual([]);
    expect(connectHosts("  ")).toEqual([]);
  });

  it.each(["https://live.example.org;script-src", "'unsafe-inline'", 'x"><script>', "https://a.example.org/path?x=1"])(
    "refuses %s, which is not the address of a host",
    (value) => {
      expect(() => connectHosts(value)).toThrow(/VITE_CRAFTLY_CSP_CONNECT/);
    },
  );

  it("adds them to connect-src of the policy line and leaves every other line as it is", () => {
    const changed = addConnectHosts(HEADERS, ["https://live.example.org", "wss://live.example.org"]);
    expect(changed).toBe(HEADERS.replace("blob:;", "blob: https://live.example.org wss://live.example.org;"));
    expect(addConnectHosts(HEADERS, [])).toBe(HEADERS);
  });

  it("does not add a host that the policy names already", () => {
    expect(addConnectHosts(HEADERS, ["https://models.example.org", "wss://live.example.org"])).toBe(HEADERS.replace("blob:;", "blob: wss://live.example.org;"));
  });

  it("fails when the policy has no connect-src to add them to, or the file has no policy", () => {
    expect(() => addConnectHosts("/*\n  Content-Security-Policy: default-src 'self'\n", ["wss://live.example.org"])).toThrow("has no connect-src");
    expect(() => addConnectHosts("/*\n", ["wss://live.example.org"])).toThrow("public/_headers has no Content-Security-Policy line");
  });
});

describe("the plugin that writes the policy into the page", () => {
  it("only runs in a build: the development server puts scripts of its own into the page", () => {
    const { plugin } = setup(HEADERS);
    expect(plugin.apply).toBe("build");
    expect(plugin.name).toBe("craftly-csp-meta");
  });

  const TAG = `<meta http-equiv="Content-Security-Policy" content="${META}" />`;

  it("puts the policy right after the line that says how the page is encoded, before anything it has to apply to", () => {
    const { plugin, resolve } = setup(HEADERS);
    resolve();
    const page = '<html>\n  <head>\n    <meta charset="UTF-8" />\n    <script type="module" src="/a.js"></script>\n  </head>\n</html>';
    expect(plugin.transformIndexHtml(page)).toBe(page.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${TAG}`));
    plugin.closeBundle();
    expect(built()).toBe(HEADERS);
  });

  it("puts it first in the head of a page that does not say how it is encoded", () => {
    const { plugin, resolve } = setup(HEADERS);
    resolve();
    expect(plugin.transformIndexHtml('<html><head lang="en"><title>T</title></head></html>')).toBe(`<html><head lang="en">${TAG}<title>T</title></head></html>`);
  });

  it("stops the build for a page without a head: a policy that is not in the page protects nothing", () => {
    const { plugin, resolve } = setup(HEADERS);
    resolve();
    expect(() => plugin.transformIndexHtml("<p>no head</p>")).toThrow(/no <head>/);
  });

  it("writes the policy so that it cannot end its own attribute", () => {
    const { plugin, resolve } = setup(HEADERS.replace("https://models.example.org", 'https://a.example.org/?a=1&b="2"'));
    resolve();
    expect(plugin.transformIndexHtml("<head></head>")).toContain("connect-src 'self' https://a.example.org/?a=1&amp;b=&quot;2&quot; blob:\" />");
  });

  it("adds the hosts of the build variable to the meta tag and to the headers file of the build, so the two agree", () => {
    const { plugin, resolve } = setup(HEADERS, { VITE_CRAFTLY_CSP_CONNECT: "https://live.example.org wss://live.example.org" });
    resolve();
    expect(plugin.transformIndexHtml("<head></head>")).toBe(`<head>${TAG.replace("blob:", "blob: https://live.example.org wss://live.example.org")}</head>`);
    plugin.closeBundle();
    expect(built()).toBe(HEADERS.replace("blob:;", "blob: https://live.example.org wss://live.example.org;"));
    // the file in public/ is the source and is not written to
    expect(readFileSync(join(folder, "public", "_headers"), "utf8")).toBe(HEADERS);
  });

  it("copes with a build folder that has no headers file", () => {
    const { plugin, resolve } = setup(HEADERS, { VITE_CRAFTLY_CSP_CONNECT: "wss://live.example.org" });
    resolve();
    rmSync(join(folder, "dist", "_headers"));
    expect(() => plugin.closeBundle()).not.toThrow();
  });

  it("stops the build when there is no headers file to read the policy from, or the variable is not a list of hosts", () => {
    expect(() => setup(null).resolve()).toThrow(/_headers/);
    rmSync(folder, { recursive: true, force: true });
    expect(() => setup(HEADERS, { VITE_CRAFTLY_CSP_CONNECT: "'unsafe-eval'" }).resolve()).toThrow(/VITE_CRAFTLY_CSP_CONNECT/);
  });
});

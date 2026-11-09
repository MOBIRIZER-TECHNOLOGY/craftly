import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../vite.config";

/**
 * A library that the app loads the first time somebody needs it (`import("paper/dist/paper-core")`) is not seen by the dev
 * server when it starts. The server finds it when the page asks for it, prepares it, and reloads the page to use the prepared
 * copy: the person who chose Union loses the page they were on, and a journey that drives the browser loses its state. A library
 * named in `optimizeDeps` is prepared at the start. This found the one that was missing for paper.js.
 */
const SOURCE = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The packages that are imported with a dynamic `import("name")`, not through the `@/` alias, a path or a `?url` asset. */
function lazyPackages(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SOURCE)) {
    for (const match of readFileSync(file, "utf8").matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = match[1];
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/") || spec.includes("?")) continue;
      found.add(spec);
    }
  }
  return [...found].sort();
}

describe("the dev server's prepared libraries", () => {
  it("finds the libraries that load on first use", () => {
    expect(lazyPackages()).toEqual(expect.arrayContaining(["lucide", "paper/dist/paper-core"]));
  });

  it("include every library that loads on first use, so that the dev server does not find one later and reload the page", () => {
    const named = [...(config.optimizeDeps?.include ?? []), ...(config.optimizeDeps?.exclude ?? [])];
    const missing = lazyPackages().filter((spec) => !named.some((name) => spec === name || spec.startsWith(name + "/")));
    expect(missing).toEqual([]);
  });
});

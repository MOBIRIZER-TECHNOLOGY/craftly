import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CSS class names are global. A stylesheet that a screen has loaded stays in the page while the person moves on to another screen, so
 * two packages that both style one class name change each other's screens, and which one wins depends on what was opened first. This
 * happened: the dashboard's row of quick-create tiles broke into two columns after a visit to the editor, because the editor's keyboard
 * shortcuts dialog was also called `.cf-shortcuts`; and the brand kit page and the editor's Brand tab shared five `.cf-brand__*` names
 * with different sizes. A class belongs to one package, a top-level folder of `src` (dashboard, editor, ui ...), and a package prefixes
 * its names (`cf-dshortcut` for the dashboard, `cf-brandtab` for the editor's Brand tab).
 */
const SRC = resolve(__dirname, "..");

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Every selector of every rule (media and container blocks included) by package and file. */
function selectors(): Map<string, Map<string, Set<string>>> {
  const found = new Map<string, Map<string, Set<string>>>();
  for (const file of stylesheets(SRC)) {
    const relative = file
      .slice(SRC.length + 1)
      .split(sep)
      .join("/");
    const pkg = relative.split("/")[0];
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/(?:^|[}\n;{])\s*([^{}@;]+?)\s*\{/g)) {
      for (const raw of rule[1].split(",")) {
        const selector = raw.trim().replace(/\s+/g, " ");
        if (!selector || /^(from|to|\d+(\.\d+)?%)$/.test(selector)) continue; // keyframe steps
        const byPackage = found.get(selector) ?? new Map<string, Set<string>>();
        byPackage.set(pkg, (byPackage.get(pkg) ?? new Set<string>()).add(relative));
        found.set(selector, byPackage);
      }
    }
  }
  return found;
}

const describeOwners = (byPackage: Map<string, Set<string>>) => [...byPackage].map(([pkg, files]) => `${pkg} (${[...files].join(", ")})`).join(" and ");

describe("CSS class names across packages", () => {
  it("finds the rules the stylesheets hold (a guard that the scan itself still works)", () => {
    const found = selectors();
    expect(found.size).toBeGreaterThan(1500);
    expect([...(found.get(".cf-btn") ?? [])].map(([pkg]) => pkg)).toEqual(["ui"]);
  });

  it("has no class that the stylesheets of two packages both give a rule of its own", () => {
    const own = /^\.[\w-]+(?::[\w-]+(?:\([^)]*\))?)*$/; // one class, with pseudo-classes at most
    const shared = [...selectors()]
      .filter(([selector, byPackage]) => own.test(selector) && byPackage.size > 1)
      .map(([selector, byPackage]) => `${selector}: ${describeOwners(byPackage)}`);
    expect(shared).toEqual([]);
  });

  it("has no selector, of any shape, that the stylesheets of two packages both write", () => {
    const shared = [...selectors()].filter(([, byPackage]) => byPackage.size > 1).map(([selector, byPackage]) => `${selector}: ${describeOwners(byPackage)}`);
    expect(shared).toEqual([]);
  });

  it("styles no bare element (button, h1 ...) outside the global styles: it would reach every screen", () => {
    const bare = [...selectors()]
      .filter(([selector, byPackage]) => !/[.#[:*]/.test(selector) && [...byPackage.keys()].some((pkg) => pkg !== "styles"))
      .map(([selector, byPackage]) => `${selector}: ${describeOwners(byPackage)}`);
    expect(bare).toEqual([]);
  });
});

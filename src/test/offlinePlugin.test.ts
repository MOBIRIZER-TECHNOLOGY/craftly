import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { offlineSupport } from "../../vite.config";

/** The three hooks of the plugin that the build calls, with the `this` that `generateBundle` needs. */
interface Hooks {
  configResolved(config: { build: { outDir: string }; root: string }): void;
  generateBundle(this: { emitFile(file: { type: string; fileName: string; source: string }): void }, options: unknown, bundle: Record<string, unknown>): void;
  closeBundle(): void;
}

let folder = "";
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function setup(files: Record<string, string>) {
  folder = mkdtempSync(join(tmpdir(), "craftly-plugin-"));
  mkdirSync(join(folder, "dist"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(folder, "dist", name), content);
  const plugin = offlineSupport() as unknown as Hooks;
  plugin.configResolved({ build: { outDir: "dist" }, root: folder });
  return plugin;
}

const emitted = (plugin: Hooks, names: string[]) => {
  const files: Record<string, string> = {};
  plugin.generateBundle.call({ emitFile: (file) => (files[file.fileName] = file.source) }, {}, Object.fromEntries(names.map((name) => [name, {}])));
  return JSON.parse(files["precache.json"]) as { buildId: string; files: string[]; runtime: string[] };
};
const read = (name: string) => readFileSync(join(folder, "dist", name), "utf8");

const BUNDLE = ["index.html", "assets/index-a1.js", "assets/index-a1.js.map", "assets/chunk-b2.js", "assets/app-c3.css", "assets/font-d4.woff2", "assets/ort-e5.wasm"];

describe("the offline support of the build", () => {
  it("leaves out the third-party notices, which are read online from About Craftly", () => {
    const list = emitted(setup({}), [...BUNDLE, "third-party-notices.txt"]);
    expect(list.files).not.toContain("third-party-notices.txt");
  });

  it("lists what the service worker has to store: every file but the page, the source maps and the web assembly files, which are listed apart", () => {
    const list = emitted(setup({}), BUNDLE);
    expect(list.files).toEqual(["assets/app-c3.css", "assets/chunk-b2.js", "assets/font-d4.woff2", "assets/index-a1.js"]);
    expect(list.runtime).toEqual(["assets/ort-e5.wasm"]);
  });

  it("gives a build an id of ten characters that follows from the names of its files, so a change in any file makes a new build", () => {
    const a = emitted(setup({}), BUNDLE).buildId;
    const again = emitted(setup({}), [...BUNDLE].reverse()).buildId;
    const changed = emitted(
      setup({}),
      BUNDLE.map((name) => name.replace("index-a1", "index-zz")),
    ).buildId;
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(again).toBe(a);
    expect(changed).not.toBe(a);
  });

  it("puts the same id into the worker and into the page, where the page can read which build it is", () => {
    const plugin = setup({
      "sw.js": 'const BUILD_ID = "__BUILD_ID__";\nconst VERSION = "craftly-" + BUILD_ID; // __BUILD_ID__\n',
      "index.html": '<html><head><meta name="craftly-build" content="__BUILD_ID__" /></head></html>',
    });
    const { buildId } = emitted(plugin, BUNDLE);
    plugin.closeBundle();
    expect(read("sw.js")).toBe(`const BUILD_ID = "${buildId}";\nconst VERSION = "craftly-" + BUILD_ID; // ${buildId}\n`);
    expect(read("index.html")).toBe(`<html><head><meta name="craftly-build" content="${buildId}" /></head></html>`);
  });

  it("copes with a build that has no worker or no page", () => {
    const plugin = setup({});
    emitted(plugin, BUNDLE);
    expect(() => plugin.closeBundle()).not.toThrow();
  });
});

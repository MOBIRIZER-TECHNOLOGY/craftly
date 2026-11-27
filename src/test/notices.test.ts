/**
 * THIRD-PARTY-NOTICES.md, which `npm run notices` writes and the built site publishes (the notices plugin in vite.config.ts):
 * it has to name everything the app ships and every model it downloads, so a dependency or a model added without running
 * `npm run notices` again fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS } from "@/ml/registry";
import { NOTICES_FILE, notices } from "../../vite.config";

const root = join(__dirname, "..", "..");
const text = readFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "utf8");
const dependencies = Object.keys((JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies);

describe("the third-party notices", () => {
  it.each(dependencies)("list %s, a dependency of the app", (name) => {
    expect(text).toContain(`| ${name} |`);
  });

  it.each(MODELS.map((model) => [model.name, model] as const))("list the model %s with its licence and notice", (_, model) => {
    expect(text).toContain(model.name);
    expect(text).toContain(model.licence.url);
    expect(text).toContain(model.licence.notice);
  });

  it("give every package a licence text, the standard one where a package ships none", () => {
    expect(text).not.toMatch(/ships no licence file; it declares the licence/);
  });

  it("are published beside the built app, as the text of THIRD-PARTY-NOTICES.md", () => {
    const plugin = notices() as unknown as {
      configResolved(config: { root: string }): void;
      generateBundle(this: { emitFile(file: { fileName: string; source: string }): void }): void;
    };
    plugin.configResolved({ root });
    const files: Record<string, string> = {};
    plugin.generateBundle.call({ emitFile: (file) => (files[file.fileName] = file.source) });
    expect(Object.keys(files)).toEqual([NOTICES_FILE]);
    expect(files[NOTICES_FILE]).toBe(text);
  });
});

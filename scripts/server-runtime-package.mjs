/*
 * Writes the package.json and package-lock.json that a deployed live server installs from: only the packages that
 * dist-server/live.mjs imports (today that is `ws` and nothing else), each at the version, address and checksum that the
 * project's own package-lock.json has. `npm ci --omit=dev` in the folder it writes then installs exactly those files.
 *
 *   node scripts/server-runtime-package.mjs <folder>      (after npm run server:build; Dockerfile.server calls it)
 *
 * The project's own package.json is no use for this: its "dependencies" are the fonts and libraries of the editor, which
 * the server never loads. The list is read from the bundle and not written here by hand, so a new import of
 * the server cannot be forgotten: the script stops with a message when it meets a package it cannot describe.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/server-runtime-package.mjs <folder>");
  process.exit(1);
}

const bundle = readFileSync(join(root, "dist-server", "live.mjs"), "utf8");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

/** What the bundle imports that is not part of Node: esbuild writes every import at the start of a line, with double quotes. */
const names = new Set();
for (const match of bundle.matchAll(/^import\s(?:[^"\n]*\sfrom\s)?"([^"\n]+)";?$/gm)) {
  const spec = match[1];
  if (spec.startsWith("node:") || builtinModules.includes(spec)) continue;
  if (spec.startsWith(".") || spec.startsWith("/")) throw new Error(`The bundle imports the file ${spec}: it should be one file.`);
  names.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
}
if (names.size === 0) throw new Error("The bundle imports no package at all, not even ws: this is not the live server.");

const dependencies = {};
const packages = {};
for (const name of [...names].sort()) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry?.version || !entry.resolved || !entry.integrity) throw new Error(`${name} is imported by the bundle but package-lock.json does not describe it.`);
  if (entry.dev) throw new Error(`${name} is imported by the bundle but is a development dependency: move it to "dependencies".`);
  if (entry.dependencies || entry.optionalDependencies) {
    throw new Error(`${name} needs packages of its own, which this script does not collect yet. Extend it before deploying.`);
  }
  dependencies[name] = entry.version;
  packages[`node_modules/${name}`] = entry;
}

const manifest = { name: "craftly-live-runtime", version: "0.0.0", private: true, dependencies };
const runtimeLock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: { "": manifest, ...packages } };

const folder = resolve(out);
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(folder, "package-lock.json"), `${JSON.stringify(runtimeLock, null, 2)}\n`);
console.log(
  `Runtime packages of the live server: ${Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version}`)
    .join(", ")} (written to ${folder})`,
);

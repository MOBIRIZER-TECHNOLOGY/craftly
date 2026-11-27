/*
 * Writes THIRD-PARTY-NOTICES.md: every package the shipped app depends on (the "dependencies" of package.json and
 * what they depend on in turn, never the development tools), with its licence and the licence text found in the
 * package. Packages with the same licence text share one copy of it. A package that ships no licence file but declares MIT or
 * ISC gets that licence's standard text with its author as the holder; a package under MPL-2.0 is pointed to its source, as
 * that licence asks of whoever ships it built. The models the app downloads when asked (src/ml/registry.ts) are listed with
 * their own licences and notices.
 *
 * The built site carries the same text at /third-party-notices.txt (the `notices` plugin in vite.config.ts), linked from
 * About Craftly.
 *
 *   npm run notices
 *
 * Run it after `npm install` and whenever a dependency changes; it only reads node_modules and package.json.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * The package `name` as the package in `from` finds it, the way Node looks: in `from`'s own node_modules first, then in
 * those of the folders above it, up to the project's. A dependency that npm put under another package (two versions of one
 * package, or a version an override pins) is found where it is.
 */
function readPackage(name, from = root) {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(file)) return { dir: dirname(file), json: JSON.parse(readFileSync(file, "utf8")) };
    if (dir === root || dirname(dir) === dir) return null;
  }
}

/** Everything the app ships: the runtime dependencies and, transitively, what they depend on (one row a name and version). */
function collect() {
  const found = new Map();
  const seen = new Set();
  const queue = Object.keys(rootPackage.dependencies ?? {}).map((name) => ({ name, from: root }));
  const missing = [];
  while (queue.length) {
    const { name, from } = queue.shift();
    const pkg = readPackage(name, from);
    if (!pkg) {
      missing.push(name);
      continue;
    }
    if (seen.has(pkg.dir)) continue;
    seen.add(pkg.dir);
    const key = found.has(name) && found.get(name).json.version !== pkg.json.version ? `${name}@${pkg.json.version}` : name;
    if (!found.has(key)) found.set(key, pkg);
    queue.push(...Object.keys(pkg.json.dependencies ?? {}).map((dep) => ({ name: dep, from: pkg.dir })));
  }
  return { found, missing };
}

function declaredLicense(json) {
  const value = json.license ?? json.licenses;
  if (!value) return "UNKNOWN";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === "string" ? entry : entry.type)).join(" OR ");
  return value.type ?? "UNKNOWN";
}

/** The standard texts of the two licences that small packages most often declare without shipping a file. */
const STANDARD = {
  MIT: (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
};

/** Where the holder in the project's own licence is not the package's author field (the field names who published it). */
const HOLDERS = { "onnxruntime-common": "Microsoft Corporation", "onnxruntime-web": "Microsoft Corporation" };

/** Who holds the copyright, as the package names its author (without the address), or its own name's contributors. */
function holder(json) {
  if (HOLDERS[json.name]) return HOLDERS[json.name];
  const author = typeof json.author === "string" ? json.author : json.author?.name;
  return (
    (author ?? "")
      .replace(/\s*<[^>]*>/, "")
      .replace(/\s*\([^)]*\)/, "")
      .trim() || `the ${json.name} contributors`
  );
}

/** Where a package's source is published, as its package.json says. */
function sourceOf(json) {
  const url = typeof json.repository === "string" ? json.repository : (json.repository?.url ?? "");
  return url.replace(/^git\+/, "").replace(/\.git$/, "") || json.homepage || `https://www.npmjs.com/package/${json.name}`;
}

/** The models the app downloads when somebody asks for an AI tool, as src/ml/registry.ts names them. */
function models() {
  const text = readFileSync(join(root, "src", "ml", "registry.ts"), "utf8").replace(/\r\n/g, "\n");
  return text
    .split(/\nconst [A-Z_]+: ModelSpec = \{/)
    .slice(1)
    .map((block) => {
      const field = (re) => re.exec(block)?.[1];
      return {
        name: field(/\n {2}name: "([^"]+)"/),
        repo: field(/\n {2}repo: "([^"]+)"/),
        revision: field(/\n {2}revision: "([^"]+)"/),
        licence: field(/licence: \{\s*name: "([^"]+)"/),
        licenceUrl: field(/licence: \{\s*name: "[^"]+",\s*url: "([^"]+)"/),
        notice: field(/notice: "([^"]+)"/),
        credit: field(/credit: \{ text: "([^"]+)"/),
      };
    });
}

function licenseText(dir) {
  const names = readdirSync(dir).filter((file) => /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i.test(file));
  names.sort((a, b) => Number(/notice/i.test(a)) - Number(/notice/i.test(b)));
  const file = names.find((n) => !/notice/i.test(n));
  return file ? readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim() : null;
}

const { found, missing } = collect();
const rows = [...found.entries()]
  .map(([name, { dir, json }]) => {
    const license = declaredLicense(json);
    const shipped = licenseText(dir);
    return {
      name: json.name ?? name,
      version: json.version,
      license,
      text: shipped ?? STANDARD[license]?.(holder(json)) ?? null,
      standard: !shipped && !!STANDARD[license],
      source: sourceOf(json),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// one section per distinct licence text
const groups = new Map();
for (const row of rows) {
  const key = row.text ? createHash("sha1").update(row.text).digest("hex") : `none:${row.license}`;
  if (!groups.has(key)) groups.set(key, { text: row.text, license: row.license, standard: row.standard, packages: [] });
  groups.get(key).packages.push(`${row.name}@${row.version}`);
}

const cell = (s) => String(s).replace(/\|/g, "\\|");
const lines = [];
lines.push("# Third-party notices");
lines.push("");
lines.push("Craftly ships with the open-source packages listed here. This file is generated by `npm run notices`; do not edit it by hand.");
lines.push("");
lines.push(`${rows.length} packages. Development tools (the build, the test runner and so on) are not part of the app and are not listed.`);
lines.push("");
lines.push("## Packages");
lines.push("");
lines.push("| Package | Version | Licence |");
lines.push("| --- | --- | --- |");
for (const row of rows) lines.push(`| ${cell(row.name)} | ${cell(row.version)} | ${cell(row.license)} |`);
lines.push("");
lines.push("## Licence texts");
lines.push("");
for (const group of [...groups.values()].sort((a, b) => a.packages[0].localeCompare(b.packages[0]))) {
  lines.push(`### ${group.packages.join(", ")}`);
  lines.push("");
  if (group.standard) {
    lines.push(`This package ships no licence file; it declares ${group.license} in its package.json, whose standard text follows with its author as the holder.`);
    lines.push("");
  }
  if (group.text) {
    lines.push("```text");
    lines.push(group.text);
    lines.push("```");
  } else {
    lines.push(`This package ships no licence file; it declares the licence ${group.license} in its package.json.`);
  }
  lines.push("");
}
const mpl = rows.filter((row) => /\bMPL-/.test(row.license));
if (mpl.length) {
  lines.push("## Source of the packages under the Mozilla Public License");
  lines.push("");
  lines.push("Craftly ships these packages built into its own files, unmodified. Their source is where their authors publish it:");
  lines.push("");
  for (const row of mpl) lines.push(`- ${row.name} ${row.version} (${row.license}): ${row.source}`);
  lines.push("");
}
const list = models();
lines.push("## Models downloaded when asked");
lines.push("");
lines.push(
  "The AI photo tools download a model the first time somebody uses them, with their permission; the app does not ship them. Each is used unmodified, under its own licence:",
);
lines.push("");
for (const model of list) {
  lines.push(
    `- **${model.name}** (${model.licence}, ${model.licenceUrl}): ${model.notice}. ${model.credit}; the file is https://huggingface.co/${model.repo} at revision ${model.revision}.`,
  );
}
lines.push("");
if (missing.length) {
  console.warn(`Not installed, skipped: ${missing.join(", ")} (run npm install first for a complete file)`);
}
if (!list.length || list.some((model) => Object.values(model).some((value) => !value))) {
  throw new Error("A model in src/ml/registry.ts was not read whole: update models() in this script.");
}
writeFileSync(join(root, "THIRD-PARTY-NOTICES.md"), lines.join("\n"));
const noText = rows.filter((row) => !row.text).map((row) => row.name);
const standard = rows.filter((row) => row.standard).map((row) => row.name);
console.log(
  `Wrote THIRD-PARTY-NOTICES.md: ${rows.length} packages, ${groups.size} licence texts, ${list.length} models` +
    (standard.length ? `; the standard text for ${standard.join(", ")}` : "") +
    (noText.length ? `; NO licence text for ${noText.join(", ")}` : "") +
    ".",
);

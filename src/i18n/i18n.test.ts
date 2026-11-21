import { describe, expect, it } from "vitest";
import { en } from "./en";
import { hi } from "./hi";
import { LANGUAGES, lang, m, pickLanguage } from "./index";

describe("choosing the language of the interface", () => {
  it("takes the choice saved on this device first", () => {
    expect(pickLanguage("hi", ["en-US"])).toBe("hi");
    expect(pickLanguage("en", ["hi-IN"])).toBe("en");
  });

  it("else the first language of the browser that Craftly has, by its base", () => {
    expect(pickLanguage(null, ["fr-FR", "hi-IN", "en-US"])).toBe("hi");
    expect(pickLanguage(null, ["HI"])).toBe("hi");
    expect(pickLanguage(null, ["de-DE", "en-GB"])).toBe("en");
  });

  it("else English, also for a saved choice it does not know", () => {
    expect(pickLanguage(null, [])).toBe("en");
    expect(pickLanguage("xx", ["de"])).toBe("en");
  });

  it("is English in the tests, so that the tests read the words they always read", () => {
    expect(lang).toBe("en");
    expect(m).toBe(en);
  });

  it("names every language in its own language", () => {
    expect(LANGUAGES.map((l) => l.name)).toEqual(["English", "हिन्दी"]);
  });
});

describe("plural forms and numbers", () => {
  it("picks the English forms by the English rules", async () => {
    const { plural, num } = await import("./format");
    expect(plural(1, { one: "1 shape", other: "n shapes" })).toBe("1 shape");
    expect(plural(0, { one: "1 shape", other: "n shapes" })).toBe("n shapes");
    expect(num(1234567)).toBe("1,234,567");
  });

  it("knows the Hindi rules: 0 and 1 take the singular", () => {
    const hindi = new Intl.PluralRules("hi-IN");
    expect([0, 1, 2, 5].map((n) => hindi.select(n))).toEqual(["one", "one", "other", "other"]);
    expect(new Intl.NumberFormat("hi-IN").format(1234567)).toBe("12,34,567");
  });
});

type Tree = { [key: string]: unknown };

/** Every difference of shape between two catalogs: a key one has and the other has not, another kind of value, an empty word, or a function with other parameters. */
function differences(a: Tree, b: Tree, path = ""): string[] {
  const out: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const where = path ? `${path}.${key}` : key;
    const x = a[key];
    const y = b[key];
    if (!(key in a)) out.push(`${where}: only in Hindi`);
    else if (!(key in b)) out.push(`${where}: missing in Hindi`);
    else if (typeof x !== typeof y) out.push(`${where}: ${typeof x} in English, ${typeof y} in Hindi`);
    else if (typeof x === "string" && (x.trim() === "" || (y as string).trim() === "")) out.push(`${where}: empty`);
    else if (typeof x === "function" && x.length !== (y as (...args: never[]) => unknown).length) out.push(`${where}: other parameters`);
    else if (typeof x === "object" && x !== null) out.push(...differences(x as Tree, y as Tree, where));
  }
  return out;
}

describe("the catalogs", () => {
  it("Hindi has every word of English, of the same kind, none empty", () => {
    expect(differences(en, hi)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

type Message = (...args: unknown[]) => unknown;

/** Every function of a catalog, by its path ("dashboard.trash.deleted"), in the order the catalog lists them. */
function messages(tree: Tree, path = ""): Array<[string, Message]> {
  const out: Array<[string, Message]> = [];
  for (const [key, value] of Object.entries(tree)) {
    const where = path ? `${path}.${key}` : key;
    if (typeof value === "function") out.push([where, value as Message]);
    else if (typeof value === "object" && value !== null) out.push(...messages(value as Tree, where));
  }
  return out;
}

/** Splits at the commas that are not inside <...>, (...), [...] or {...}. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("<([{".includes(c)) depth++;
    else if (">)]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * The values a parameter of this type takes in the tests: every count that picks another plural form or another "one or
 * many" choice (0, 1, 2), a large number (so that a number written into the words can be found in them), a name, one name
 * and two, both answers of a yes or no, and every word of a choice such as `"close" | "end"`. `null` for an unknown type.
 */
function samplesOf(type: string): unknown[] | null {
  const kinds = splitTop(type.replace(/\|/g, ",")).map((t) => t.trim());
  if (kinds.length > 1) {
    const all = kinds.map(samplesOf);
    return all.every(Boolean) ? (all as unknown[][]).flat() : null;
  }
  const t = kinds[0].replace(/^readonly\s+/, "");
  if (t === "number") return [0, 1, 2, 1234567];
  if (t === "string") return ["Poster"];
  if (t === "boolean") return [true, false];
  if (t === "null") return [null];
  if (t === "undefined") return [undefined];
  if (t === "string[]") return [["Inter"], ["Inter", "Lora"]];
  if (t === "number[]") return [[2], [2, 3]];
  if (/^"[^"]*"$/.test(t)) return [t.slice(1, -1)];
  return null;
}

/** The parameter types of every message of the English catalog, by the message's key and the names of its parameters ("deleted(n)"). */
const englishSources = import.meta.glob<string>("./en/*.ts", { query: "?raw", import: "default", eager: true });
const declared = new Map<string, string[]>();
for (const source of Object.values(englishSources))
  for (const [, key, params] of source.matchAll(/(\w+)\??: \(([^()]*)\)\s*=>/g)) {
    const list = splitTop(params).map((p) => {
      const [name, ...type] = p.split(":");
      return { name: name.replace("?", "").trim(), type: type.join(":").trim() + (name.includes("?") ? " | undefined" : "") };
    });
    declared.set(
      `${key}(${list.map((p) => p.name).join(",")})`,
      list.map((p) => p.type),
    );
  }

/** The names of a function's parameters, as the transformed code of the catalog has them (the types are gone by then). */
const parameterNames = (fn: Message) => {
  const head = /^(?:function\s*\w*\s*)?\(([^)]*)\)/.exec(fn.toString()) ?? /^(\w+)\s*=>/.exec(fn.toString());
  return head ? splitTop(head[1]).map((p) => p.replace(/=.*$/, "").trim()) : [];
};

/** Words that show a message was handed something it did not expect, or dropped a value on the floor. */
const BROKEN = /undefined|NaN|\[object /;

describe("every message, called as the screens call it", () => {
  const english = new Map(messages(en as unknown as Tree));
  const hindi = messages(hi as unknown as Tree);

  it("has a Hindi message for every English one that takes words, and the other way round", () => {
    expect(hindi.map(([path]) => path).sort()).toEqual([...english.keys()].sort());
    // (and the walk finds them: the catalogs have hundreds)
    expect(hindi.length).toBeGreaterThan(400);
  });

  it("gives readable Hindi words for every value of the types the English message declares, and keeps the names and numbers it is given", () => {
    const problems: string[] = [];
    for (const [path, hindiMessage] of hindi) {
      const englishMessage = english.get(path) as Message;
      const key = path.slice(path.lastIndexOf(".") + 1);
      const types = declared.get(`${key}(${parameterNames(englishMessage).join(",")})`);
      const samples = types?.map(samplesOf);
      if (!types || !samples || samples.some((s) => s === null)) {
        problems.push(`${path}: the test does not know the types of its parameters (${types?.join(", ") ?? "not found"})`);
        continue;
      }
      // as many calls as the parameter with the most values has; each call takes the next value of every parameter
      const rounds = Math.max(1, ...samples.map((s) => (s as unknown[]).length));
      for (let round = 0; round < rounds; round++) {
        const args = (samples as unknown[][]).map((values) => values[round % values.length]);
        const shown = JSON.stringify(args);
        const inEnglish = englishMessage(...args);
        let words: unknown;
        try {
          words = hindiMessage(...args);
        } catch (error) {
          problems.push(`${path}${shown}: throws in Hindi (${String(error)})`);
          continue;
        }
        if (typeof inEnglish !== "string") continue; // (a message that builds something other than words is checked by its screen)
        if (typeof words !== "string" || words.trim() === "") problems.push(`${path}${shown}: no words in Hindi`);
        else if (BROKEN.test(words) && !BROKEN.test(inEnglish)) problems.push(`${path}${shown}: "${words}"`);
        // a name or a large number the English words show, the Hindi words show too (the tests write numbers the English way)
        else
          for (const kept of ["Poster", "1,234,567", "Inter"])
            if (inEnglish.includes(kept) && !words.includes(kept)) problems.push(`${path}${shown}: leaves out ${kept}: "${words}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});

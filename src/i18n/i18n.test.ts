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

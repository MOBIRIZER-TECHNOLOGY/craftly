/**
 * Which language this page is in, chosen once when this module is first imported: the choice the person saved on this device,
 * else the first language of the browser that Craftly has, else English. It imports no catalog, so the catalogs and the
 * formatting helpers (`./format`) can depend on it without a cycle.
 */

/** The languages of the interface, each named in its own language (as a person looking for theirs would read it). */
export const LANGUAGES = [
  { code: "en", name: "English", locale: "en-US" },
  { code: "hi", name: "हिन्दी", locale: "hi-IN" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

/** Where the person's choice is kept on this device. */
export const LANGUAGE_KEY = "craftly.language";

const isLanguage = (code: unknown): code is Language => LANGUAGES.some((l) => l.code === code);

/** The language to start in: the saved choice, else the browser's first language Craftly has, else English. */
export function pickLanguage(saved: string | null, browser: readonly string[]): Language {
  if (isLanguage(saved)) return saved;
  for (const tag of browser) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

function savedChoice(): string | null {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_KEY) ?? null;
  } catch {
    return null; // storage switched off: the browser's language decides
  }
}

function browserLanguages(): readonly string[] {
  const nav = globalThis.navigator;
  if (!nav) return [];
  return nav.languages?.length ? nav.languages : nav.language ? [nav.language] : [];
}

/** The language of this page, for as long as it lives. */
export const lang: Language = pickLanguage(savedChoice(), browserLanguages());

/** The BCP 47 tag numbers, dates and plurals are written with (en-US for English, so that numbers read as they always did). */
export const locale: string = LANGUAGES.find((l) => l.code === lang)!.locale;

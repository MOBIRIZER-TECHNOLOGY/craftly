/**
 * The language of the interface (B17). Every word Craftly shows a person comes from a catalog: `m.dashboard.account.backup`,
 * or `m.editor.toast.converted(5)` for words with a number or a name in them. English (`./en`) is the source; every other
 * language (`./hi`) has a catalog of exactly the same shape, so a word that is missing or has other parameters fails the
 * typecheck rather than showing up blank.
 *
 * The language is chosen ONCE, synchronously, when this module is first imported, before any screen's code runs
 * (`./language`). So `m` can be read anywhere, also at the top of a module or in code outside React (menus built from data,
 * toasts, errors). Changing the language saves the open design, stores the choice and reloads the page (`switchLanguage`),
 * as a new version of Craftly does.
 *
 * What is not translated: the content of designs and templates (a person's own words), font names, the names of file formats
 * and keys, and what the live server writes in its log. Numbers and dates are written the way the language writes them
 * (`./format`).
 */
import { en } from "./en";
import { hi } from "./hi";
import { LANGUAGE_KEY, lang, type Language } from "./language";
import type { Catalog } from "./types";

export type { Catalog } from "./types";
export { LANGUAGES, LANGUAGE_KEY, lang, locale, pickLanguage, type Language } from "./language";
export { date, list, num, plural } from "./format";

const CATALOGS: Record<Language, Catalog> = { en, hi };

/** Every word of the interface, in the language of this page. */
export const m: Catalog = CATALOGS[lang];

if (typeof document !== "undefined") document.documentElement.lang = lang;

/**
 * Makes `code` the language of this device: the open design is saved first (as for a new version, src/settleSaves.ts), the
 * choice is stored, and the page is loaded again in that language. Nothing happens for the language already in use.
 */
export async function switchLanguage(code: Language, reload: () => void = () => window.location.reload()): Promise<void> {
  if (code === lang) return;
  const { settleSaves } = await import("@/settleSaves");
  await settleSaves(5000);
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    return; // nowhere to keep the choice: reloading would only come back in this language
  }
  reload();
}

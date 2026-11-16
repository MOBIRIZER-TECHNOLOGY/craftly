# Translating the interface

Craftly's interface is in English and Hindi (B17). Every word a person sees comes from a catalog in `src/i18n`; this page
says how to add one and how to write it.

## How it works

- `src/i18n/en/<area>.ts` holds the English words of one area of the app; `src/i18n/hi/<area>.ts` holds the same words in
  Hindi and is declared with the type of the English file (`export const dashboard: typeof en = { ... }`), so a word that is
  missing, extra, or takes other parameters fails the typecheck. `src/i18n/i18n.test.ts` checks the same at runtime, and that
  no word is empty.
- Code reads `m` from `@/i18n`: `m.dashboard.account.backup`. A word with a number or a name in it is a function in the
  catalog: `m.dashboard.importFailed.toast(detail)`.
- The language is chosen once, before any screen's code runs (`src/i18n/language.ts`): the choice saved on this device
  (`craftly.language`), else the browser's first language Craftly has, else English. So `m` may be read anywhere, also at the
  top of a module. Changing the language (Account menu or File menu > Language) saves the open design and reloads the page.
- The tests run in English (jsdom says `en-US`), so tests find things by their English words as before.

| Area | Catalog | Code |
| --- | --- | --- |
| words used everywhere (OK, Cancel, Close, ...) | `common` | everywhere |
| the app around the screens | `app` | `src/components`, `src/App.tsx`, `src/router.ts`, the notices, `src/problemCatcher.ts`, `src/serviceWorker.ts` |
| the UI kit | `ui` | `src/ui` |
| the dashboard | `dashboard` | `src/dashboard` |
| the editor's context panels | `panelsContext` | `src/editor/panels/context` |
| the editor's side tabs | `panelsTabs` | `src/editor/panels/tabs`, `src/editor/panels/shared`, `src/editor/panels/*.tsx` |
| menus, dialogs and bars around the canvas | `editorChrome` | `src/editor/dialogs`, `topbar`, `bottombar`, `pages`, `present` |
| the canvas and what acts on it | `editor` | `src/editor/toolbar`, `canvas`, `comments`, `live`, and the files in `src/editor` |
| downloads and files | `exporting` | `src/export` |
| on-device photo tools | `ml` | `src/ml` |
| documents and built-in data | `core`, `data` | `src/core`, `src/data`, `src/collab`, `src/render` |

## Rules for a word

1. **The English stays exactly as it was.** Moving a word into the catalog must not change one character of it: tests and
   browser journeys find elements by their English words.
2. **Whole phrases, never pieces.** Hindi puts the verb last and the parts of a sentence in another order, so a sentence
   built from pieces (`"Moved " + n + " items to " + folder`) cannot be translated. Make it one function with parameters:
   `moved: (n: number, folder: string) => ...`, and let each language place them.
3. **Numbers through `num()`, counts through `plural()`.** `plural(n, { one: "1 page", other: \`${num(n)} pages\` })`. In
   Hindi 0 and 1 take `one`. Dates through `date()`, lists through `list()` (all in `src/i18n/format.ts`). Never
   `toLocaleString("en-US")` for something a person reads.
4. **Everything a person can perceive**: text, `aria-label`, `title`, `placeholder`, `alt`, toasts, error messages that are
   shown, and the names of things in menus and lists.
5. **Not translated**: the content of designs and templates (a person's own words), font names, the names of file formats
   (PNG, PDF, SVG, WebM), keys and shortcuts (`Ctrl+C`, `Esc`), "Craftly", ids, CSS classes, storage keys, messages that are
   only written to the console or a log, the protocol between browser and server, and what the live server says.
6. **A word that code compares is not a word.** Before moving a string, check that no code tests it (`label === "Delete"`),
   sorts by it or uses it as a key; give such code an id instead.

## Writing Hindi

- Plain, everyday Hindi as Indian software uses it: the polite imperative for actions ("सहेजें", "हटाएँ", "फिर से कोशिश
  करें"), short labels, the words people know from their phones.
- Technical words that Indians use in English stay in English, written in Devanagari where that is usual (फ़ाइल, फ़ोल्डर,
  टेम्पलेट, लेयर, पेज, ब्राउज़र, डिवाइस, डाउनलोड, बैकअप) or in Latin script when they are names (PNG, PDF, Wi-Fi).
- Use the nukta where Hindi software writes it (फ़ाइल, फ़ॉन्ट, ज़ूम) and the full stop "।" at the end of a sentence.
- Keep it as short as the English where a label is tight; toolbars and buttons have little room.
- The Hindi was written for this release, not by a professional translator: a native speaker should read it before it is
  relied on.

/**
 * The Language entry of the account menu (dashboard) and the File menu (editor): a submenu of the languages of the interface,
 * each named in its own language, with the one in use checked. Choosing another saves the open design and loads the page
 * again in that language (src/i18n/index.ts).
 */
import { LANGUAGES, lang, m, switchLanguage } from "@/i18n";
import { IconLanguages, toast, type MenuItemEntry } from "@/ui";

/** `beforeSwitch` runs once another language is chosen, before the page is saved and loaded again (the editor keeps its view). */
export function languageMenuEntry({ beforeSwitch }: { beforeSwitch?: () => void } = {}): MenuItemEntry {
  const current = LANGUAGES.find((l) => l.code === lang)!;
  return {
    id: "language",
    label: m.common.language,
    hint: current.name,
    icon: <IconLanguages aria-hidden="true" />,
    submenu: LANGUAGES.map((l) => ({
      id: `language-${l.code}`,
      label: l.name,
      checked: l.code === lang,
      onSelect: () => {
        if (l.code === lang) return;
        toast.info(m.common.languageSwitching);
        beforeSwitch?.();
        void switchLanguage(l.code);
      },
    })),
  };
}

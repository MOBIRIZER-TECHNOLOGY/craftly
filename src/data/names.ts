import { data as en } from "@/i18n/en/data";

/** The name of a built-in entry as the interface shows it: looked up by id in a table of the catalog (`m.data.*`, src/i18n). */
export const nameIn = (table: Readonly<Record<string, string>>, id: string): string => table[id] ?? id;

type NameTable = { [K in keyof typeof en]: (typeof en)[K] extends Readonly<Record<string, string>> ? K : never }[keyof typeof en];

/**
 * The English name of a built-in entry, whatever the language of the page. Searches add it to what they match, so that a
 * person on a Hindi page who types "poster" or "gradient" still finds what they mean (most names people know of design
 * things are English), and code that writes file names uses it so that a file is named the same in every language.
 */
export const englishName = (table: NameTable, id: string): string => (en[table] as Readonly<Record<string, string>>)[id] ?? "";

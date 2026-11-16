/** Numbers, plurals, dates and lists written the way the language of the page writes them. Catalogs use these. */
import { locale } from "./language";

const numbers = new Map<string, Intl.NumberFormat>();

/** A number written as the language of the page writes it ("1,234" in English; "12,34,567" in Hindi, with the Indian grouping). */
export function num(n: number, options?: Intl.NumberFormatOptions): string {
  const key = options ? JSON.stringify(options) : "";
  let format = numbers.get(key);
  if (!format) numbers.set(key, (format = new Intl.NumberFormat(locale, options)));
  return format.format(n);
}

let rules: Intl.PluralRules | null = null;

/**
 * The form of a phrase that goes with `n`, by the plural rules of the page's language. `other` is required; English uses `one`
 * and `other`, Hindi too (where 0 and 1 take `one`). The forms are whole phrases, so each puts the number where it belongs.
 */
export function plural(n: number, forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }): string {
  rules ??= new Intl.PluralRules(locale);
  return forms[rules.select(n)] ?? forms.other;
}

/** A date (and, with the right options, the time of day) written as the language of the page writes it. */
export function date(value: Date | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

/** Things joined as the language joins them ("a, b, and c"; "a, b और c"). */
export function list(items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(locale, { style: "long", type }).format(items);
}

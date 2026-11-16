import type { en } from "./en";

/**
 * The shape every language's catalog has: that of the English one, with every word a `string` and every function taking the
 * same parameters. A catalog of another language is declared with the type of its English area (`typeof en.dashboard`), so
 * that a word left out, added, or given other parameters fails the typecheck.
 */
export type Catalog = typeof en;

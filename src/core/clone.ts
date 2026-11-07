import { current, isDraft } from "immer";

/**
 * Deep clone that also works on immer drafts (structuredClone throws on the
 * Proxy objects the store hands to document operations).
 */
export function cloneDeep<T>(value: T): T {
  return structuredClone(isDraft(value) ? (current(value as never) as T) : value);
}

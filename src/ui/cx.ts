/** Joins class names, skipping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = "";
  for (const part of parts) {
    if (part) out += out ? ` ${part}` : part;
  }
  return out;
}

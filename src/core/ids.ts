const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short random id, URL and DOM safe. `prefix` is only for readability while debugging. */
export function uid(prefix = ""): string {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

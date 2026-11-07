/** Placeholder text generator for the Lorem ipsum app (pure, seeded). */

export type Unit = "paragraphs" | "sentences" | "words";

const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua " +
  "enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in " +
  "reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa " +
  "qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus vivamus vestibulum sagittis sapien cum " +
  "sociis natoque penatibus et magnis dis parturient montes nascetur ridiculus mus donec quam felis ultricies nec pellentesque " +
  "eu pretium quis sem nulla consequat massa quis enim donec pede justo fringilla vel aliquet nec vulputate eget arcu"
).split(" ");

const CLASSIC = "Lorem ipsum dolor sit amet, consectetur adipiscing elit";

/** Small seeded generator: the same seed always gives the same text, "Shuffle" picks a new seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Placeholder text by the paragraph, the sentence or the word. Paragraphs are separated by a blank line. */
export function generateLorem(unit: Unit, count: number, seed: number, classicStart: boolean): string {
  const rnd = mulberry32(seed);
  const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];
  const sentence = (first: boolean): string => {
    if (first && classicStart) return `${CLASSIC}.`;
    const n = 7 + Math.floor(rnd() * 9);
    const words: string[] = [];
    for (let i = 0; i < n; i++) words.push(pick());
    // a comma after a word somewhere in the middle of longer sentences
    if (n > 9) words[3 + Math.floor(rnd() * (n - 6))] += ",";
    return `${capital(words.join(" "))}.`;
  };

  if (unit === "words") {
    const base = classicStart ? CLASSIC.toLowerCase().replace(",", "").split(" ") : [];
    const out = base.slice(0, count);
    while (out.length < count) out.push(pick());
    return `${capital(out.join(" "))}.`;
  }
  if (unit === "sentences") {
    return Array.from({ length: count }, (_, i) => sentence(i === 0)).join(" ");
  }
  return Array.from({ length: count }, (_, p) => {
    const n = 4 + Math.floor(rnd() * 3);
    return Array.from({ length: n }, (_s, i) => sentence(p === 0 && i === 0)).join(" ");
  }).join("\n\n");
}

export const LOREM_LIMITS: Record<Unit, { max: number; default: number }> = {
  paragraphs: { max: 10, default: 2 },
  sentences: { max: 40, default: 3 },
  words: { max: 400, default: 30 },
};

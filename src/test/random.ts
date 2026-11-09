/** A small seeded random number generator (mulberry32) for tests that must be repeatable: a failure names its seed. */
export function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** an integer from 0 up to, not including, n */
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    /** between one and `max` different members of a list, in a random order */
    some: <T>(list: readonly T[], max: number): T[] => {
      const copy = [...list];
      const out: T[] = [];
      for (let n = 1 + Math.floor(next() * max); n > 0 && copy.length; n--) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
  };
}

export type Random = ReturnType<typeof random>;

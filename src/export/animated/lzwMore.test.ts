import { describe, expect, it } from "vitest";
import { lzwEncode } from "./lzw";

/** The sub-blocks of an LZW image: the lengths of the blocks, and whether the stream ends with the zero length block. */
function subBlocks(encoded: Uint8Array): { lengths: number[]; terminated: boolean; end: number } {
  const lengths: number[] = [];
  let p = 1; // after the minimum code size
  while (p < encoded.length && encoded[p] !== 0) {
    lengths.push(encoded[p]);
    p += encoded[p] + 1;
  }
  return { lengths, terminated: encoded[p] === 0, end: p + 1 };
}

describe("the blocks of an LZW image", () => {
  it("are at most 255 bytes long, and end with a block of no length, and nothing after it", () => {
    for (const n of [1, 10, 300, 5000]) {
      const encoded = lzwEncode(
        Uint8Array.from({ length: n }, (_v, i) => (i * 7) % 4),
        2,
      );
      const { lengths, terminated, end } = subBlocks(encoded);
      expect(terminated).toBe(true);
      expect(end).toBe(encoded.length);
      expect(lengths.every((len) => len >= 1 && len <= 255)).toBe(true);
      // every block but the last is full
      expect(lengths.slice(0, -1).every((len) => len === 255)).toBe(true);
    }
  });

  it("are closed correctly when the data fills the last block to the byte", () => {
    // some sizes of picture compress to a multiple of 255 bytes: the length byte reserved for the next block is the terminator
    let found = 0;
    const noise = (n: number) => Uint8Array.from({ length: n }, (_v, i) => (Math.imul(i + 1, 2654435761) >>> 24) & 3);
    for (let n = 100; n < 4000 && found < 1; n++) {
      const encoded = lzwEncode(noise(n), 2);
      const { lengths, terminated, end } = subBlocks(encoded);
      if (lengths.length === 0 || lengths.at(-1) !== 255) continue;
      found++;
      expect(terminated, `${n} pixels`).toBe(true);
      expect(end, `${n} pixels`).toBe(encoded.length);
      expect(encoded.length, `${n} pixels`).toBe(1 + lengths.reduce((sum, len) => sum + len + 1, 0) + 1);
    }
    expect(found).toBeGreaterThan(0);
  });
});

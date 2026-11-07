import { describe, expect, it } from "vitest";
import { GifEncoder, concatChunks } from "./gif";

/* The rectangles and transparency flags of every frame in a GIF, read from its block structure (no pixel decoding). */
interface FrameBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  transparent: boolean;
  delay: number;
}

function frameBlocks(bytes: Uint8Array): FrameBlock[] {
  let p = 13; // signature, screen descriptor
  p += 3 * (1 << ((bytes[10] & 7) + 1)); // global colour table
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const skipSubBlocks = () => {
    while (bytes[p] !== 0) p += bytes[p] + 1;
    p++;
  };
  const frames: FrameBlock[] = [];
  let control = { transparent: false, delay: 0 };
  for (;;) {
    const marker = bytes[p++];
    if (marker === 0x3b) return frames;
    if (marker === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        control = { transparent: (bytes[p + 1] & 1) === 1, delay: u16(p + 2) };
        p += 6; // size, packed, delay, transparent index, terminator
      } else {
        p += bytes[p] + 1; // the application name, then its data
        skipSubBlocks();
      }
      continue;
    }
    expect(marker, `block at ${p - 1}`).toBe(0x2c);
    frames.push({ x: u16(p), y: u16(p + 2), w: u16(p + 4), h: u16(p + 6), ...control });
    p += 9; // descriptor
    p++; // minimum code size
    skipSubBlocks();
  }
}

const BLACK = [0, 0, 0] as const;
const WHITE = [255, 255, 255] as const;
const palette = Uint8Array.from([...BLACK, ...WHITE]);

function picture(size: number, changes: Array<{ x: number; y: number; rgb: readonly [number, number, number] }> = []): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) out[i * 4 + 3] = 255;
  for (const { x, y, rgb } of changes) out.set(rgb, (y * size + x) * 4);
  return out;
}

function encode(frames: Uint8ClampedArray[], size: number): FrameBlock[] {
  const encoder = new GifEncoder({ width: size, height: size, palette, dither: false });
  const chunks: Uint8Array[] = [];
  for (const frame of frames) {
    encoder.addFrame(frame, 10);
    chunks.push(...encoder.takeChunks());
  }
  chunks.push(...encoder.finish());
  return frameBlocks(concatChunks(chunks));
}

describe("a frame that changes only a little", () => {
  it("is cut down to the pixels whose palette colour changed, not to every pixel that is a little different", () => {
    // one pixel drifts from black to a dark grey (still black in this palette), another turns white
    const blocks = encode(
      [
        picture(8),
        picture(8, [
          { x: 1, y: 1, rgb: [16, 16, 16] },
          { x: 5, y: 6, rgb: WHITE },
        ]),
      ],
      8,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ x: 0, y: 0, w: 8, h: 8, transparent: false });
    expect(blocks[1]).toMatchObject({ x: 5, y: 6, w: 1, h: 1 });
  });

  it("keeps a larger rectangle, with the pixels in it that did not change left transparent", () => {
    const blocks = encode(
      [
        picture(8),
        picture(8, [
          { x: 2, y: 3, rgb: WHITE },
          { x: 6, y: 5, rgb: WHITE },
        ]),
      ],
      8,
    );
    expect(blocks[1]).toMatchObject({ x: 2, y: 3, w: 5, h: 3, transparent: true });
  });

  it("does not crop a frame in which every pixel of the changed rectangle changed", () => {
    const blocks = encode(
      [
        picture(8),
        picture(8, [
          { x: 2, y: 2, rgb: WHITE },
          { x: 3, y: 2, rgb: WHITE },
          { x: 2, y: 3, rgb: WHITE },
          { x: 3, y: 3, rgb: WHITE },
        ]),
      ],
      8,
    );
    expect(blocks[1]).toMatchObject({ x: 2, y: 2, w: 2, h: 2, transparent: false });
  });

  it("adds the time to the picture on screen when every change rounded to the same colours", () => {
    const blocks = encode([picture(8), picture(8, [{ x: 4, y: 4, rgb: [20, 20, 20] }])], 8);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].delay).toBe(20);
  });
});

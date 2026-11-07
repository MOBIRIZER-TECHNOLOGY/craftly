/**
 * Dominant colours of an image with a small median-cut quantiser: the picture is shrunk onto a tiny canvas, its
 * pixels are bucketed into a 5-bit-per-channel histogram, and the histogram is split along its widest colour
 * channel until there are as many boxes as wanted. The weighted average of each box is one palette colour.
 */

interface Bucket {
  r: number;
  g: number;
  b: number;
  n: number;
}

const toHex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** Median cut over weighted buckets; returns the averaged colours ordered by how many pixels they cover. */
export function medianCut(buckets: Bucket[], count: number): Array<{ r: number; g: number; b: number; n: number }> {
  let boxes: Bucket[][] = [buckets];

  const range = (box: Bucket[]) => {
    let rMin = 255,
      rMax = 0,
      gMin = 255,
      gMax = 0,
      bMin = 255,
      bMax = 0;
    for (const p of box) {
      if (p.r < rMin) rMin = p.r;
      if (p.r > rMax) rMax = p.r;
      if (p.g < gMin) gMin = p.g;
      if (p.g > gMax) gMax = p.g;
      if (p.b < bMin) bMin = p.b;
      if (p.b > bMax) bMax = p.b;
    }
    const dr = rMax - rMin;
    const dg = gMax - gMin;
    const db = bMax - bMin;
    const axis: "r" | "g" | "b" = dr >= dg && dr >= db ? "r" : dg >= db ? "g" : "b";
    return { axis, span: Math.max(dr, dg, db) };
  };

  while (boxes.length < count) {
    // split the box that is both populous and colourful
    let best = -1;
    let bestScore = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const total = box.reduce((s, p) => s + p.n, 0);
      const score = range(box).span * Math.sqrt(total);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    const { axis } = range(box);
    const sorted = [...box].sort((a, b) => a[axis] - b[axis]);
    const total = sorted.reduce((s, p) => s + p.n, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length; i++) {
      acc += sorted[i].n;
      if (acc >= total / 2) {
        cut = Math.min(sorted.length - 1, Math.max(1, i + 1));
        break;
      }
    }
    boxes = [...boxes.slice(0, best), sorted.slice(0, cut), sorted.slice(cut), ...boxes.slice(best + 1)];
  }

  return boxes
    .map((box) => {
      const n = box.reduce((s, p) => s + p.n, 0);
      return {
        r: box.reduce((s, p) => s + p.r * p.n, 0) / n,
        g: box.reduce((s, p) => s + p.g * p.n, 0) / n,
        b: box.reduce((s, p) => s + p.b * p.n, 0) / n,
        n,
      };
    })
    .sort((a, b) => b.n - a.n);
}

const distance = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

/** Palette of up to `count` hex colours from RGBA pixel data (pixels that are mostly transparent are ignored). */
export function paletteFromPixels(data: Uint8ClampedArray, count = 6): string[] {
  const hist = new Map<number, Bucket>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const hit = hist.get(key);
    if (hit) {
      hit.r += data[i];
      hit.g += data[i + 1];
      hit.b += data[i + 2];
      hit.n++;
    } else hist.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], n: 1 });
  }
  // turn the sums into averages per bucket
  const buckets = [...hist.values()].map((p) => ({ r: p.r / p.n, g: p.g / p.n, b: p.b / p.n, n: p.n }));
  if (!buckets.length) return [];

  // ask for a few extra boxes, then drop colours that are almost the same as a more common one
  const boxes = medianCut(buckets, count + 4);
  const total = boxes.reduce((s, c) => s + c.n, 0);
  const picked: typeof boxes = [];
  for (const c of boxes) {
    // blends along anti-aliased edges cover only a sliver of the picture: they are not a "colour of the image"
    if (picked.length >= 2 && c.n < total * 0.012) continue;
    if (picked.every((p) => distance(p, c) > 34)) picked.push(c);
    if (picked.length === count) break;
  }
  return picked.map((c) => toHex(c.r, c.g, c.b));
}

/** Loads an image URL, shrinks it and returns its dominant colours. */
export async function extractPalette(url: string, count = 6): Promise<string[]> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const side = 96;
  const scale = Math.min(1, side / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || side) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || side) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  return paletteFromPixels(ctx.getImageData(0, 0, w, h).data, count);
}

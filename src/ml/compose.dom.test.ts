import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResultCanvas, cutOut, fitWithin, modelInput, readPixels } from "./compose";
import { MlError } from "./errors";

describe("fitWithin", () => {
  it("leaves a picture inside the budget alone", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 4000, height: 3000, scaled: false });
  });

  it("shrinks a picture over 25 megapixels to fit, keeping its shape", () => {
    // 6000 x 5000 = 30 MP; sqrt(25 / 30) = 0.91287 -> 5477 x 4564 = 24,997,028 pixels
    expect(fitWithin(6000, 5000)).toEqual({ width: 5477, height: 4564, scaled: true });
  });

  it("also keeps either side below what browsers can draw", () => {
    // 40,000 x 100 is only 4 MP, but 40,000 is too wide: 16,384 / 40,000 = 0.4096 -> 16,384 x 40
    expect(fitWithin(40_000, 100)).toEqual({ width: 16_384, height: 40, scaled: true });
  });

  it("never returns an empty canvas", () => {
    expect(fitWithin(40_000, 1)).toEqual({ width: 16_384, height: 1, scaled: true });
  });
});

/* ---- a canvas that writes down what happens to it, in order ---- */

const SOURCE = Object.assign(new Image(), {});
let log: string[] = [];
let failContext = false;
let blobFails = false;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

function recorderFor(canvas: HTMLCanvasElement) {
  const tag = () => `${canvas.width}x${canvas.height}`;
  return new Proxy(
    {},
    {
      get(_target, name: string) {
        switch (name) {
          case "canvas":
            return canvas;
          case "createImageData":
            return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
          case "getImageData":
            return (_x: number, _y: number, w: number, h: number) => {
              log.push(`${tag()} getImageData`);
              return { data: new Uint8ClampedArray(w * h * 4).fill(7), width: w, height: h };
            };
          case "putImageData":
            return (image: { data: Uint8ClampedArray }) =>
              log.push(
                `${tag()} putImageData alpha=${Array.from(image.data)
                  .filter((_, i) => i % 4 === 3)
                  .join(",")}`,
              );
          case "drawImage":
            return (image: unknown, x: number, y: number, w: number, h: number) => log.push(`${tag()} drawImage ${image === SOURCE ? "source" : "canvas"} ${x},${y},${w},${h}`);
          case "fillRect":
            return (x: number, y: number, w: number, h: number) => log.push(`${tag()} fillRect ${x},${y},${w},${h}`);
          default:
            return () => undefined;
        }
      },
      set(_target, name: string, value) {
        log.push(`${tag()} set ${name}=${value}`);
        return true;
      },
    },
  );
}

beforeEach(() => {
  log = [];
  failContext = false;
  blobFails = false;
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function (this: HTMLCanvasElement) {
    return failContext ? null : recorderFor(this);
  };
  HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: unknown) {
    log.push(`${this.width}x${this.height} toBlob ${type} ${quality ?? "-"}`);
    queueMicrotask(() => callback(blobFails ? null : new Blob(["png"], { type })));
  };
  Object.defineProperty(SOURCE, "naturalWidth", { value: 200, configurable: true });
  Object.defineProperty(SOURCE, "naturalHeight", { value: 100, configurable: true });
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  HTMLCanvasElement.prototype.toBlob = realToBlob;
});

/** The entries of `wanted` appear in `log` in this order (other entries may sit between them). */
function expectInOrder(wanted: string[]) {
  let from = 0;
  for (const entry of wanted) {
    const at = log.indexOf(entry, from);
    expect(at, `"${entry}" after position ${from} in\n${log.join("\n")}`).toBeGreaterThanOrEqual(from);
    from = at + 1;
  }
}

describe("modelInput", () => {
  it("paints the picture squeezed into the model's square on white, so transparent areas are not black", () => {
    const rgba = modelInput(SOURCE, 4);
    expectInOrder(["4x4 set fillStyle=#ffffff", "4x4 fillRect 0,0,4,4", "4x4 drawImage source 0,0,4,4", "4x4 getImageData"]);
    expect(rgba).toHaveLength(4 * 4 * 4);
    expect(rgba[0]).toBe(7); // the bytes come straight from the canvas
  });

  it("asks for the best resampling when shrinking a large photo", () => {
    modelInput(SOURCE, 4);
    expectInOrder(["4x4 set imageSmoothingQuality=high", "4x4 drawImage source 0,0,4,4"]);
  });

  it("fails clearly when the browser gives no canvas", () => {
    failContext = true;
    expect(() => modelInput(SOURCE, 4)).toThrow(MlError);
  });
});

describe("cutOut", () => {
  it("draws the photo, then keeps only what the mask covers, at the photo's own size", async () => {
    const result = await cutOut(SOURCE, new Uint8ClampedArray([0, 85, 170, 255]), 2);
    expectInOrder(["200x100 drawImage source 0,0,200,100", "200x100 set globalCompositeOperation=destination-in", "200x100 drawImage canvas 0,0,200,100"]);
    expect(log).toContain("2x2 putImageData alpha=0,85,170,255");
    expect(result).toMatchObject({ width: 200, height: 100, scaled: false });
    expect(result.blob.type).toBe("image/png");
  });

  it("scales a photo over the pixel budget down and says so", async () => {
    Object.defineProperty(SOURCE, "naturalWidth", { value: 6000, configurable: true });
    Object.defineProperty(SOURCE, "naturalHeight", { value: 5000, configurable: true });
    const result = await cutOut(SOURCE, new Uint8ClampedArray(4), 2);
    expect(log).toContain("5477x4564 drawImage source 0,0,5477,4564");
    expect(result).toMatchObject({ width: 5477, height: 4564, scaled: true });
  });

  it("rejects a photo that has no size", async () => {
    Object.defineProperty(SOURCE, "naturalWidth", { value: 0, configurable: true });
    await expect(cutOut(SOURCE, new Uint8ClampedArray(4), 2)).rejects.toMatchObject({ code: "image" });
  });

  it("rejects when the browser cannot encode the PNG", async () => {
    blobFails = true;
    await expect(cutOut(SOURCE, new Uint8ClampedArray(4), 2)).rejects.toMatchObject({ code: "image" });
  });

  it("fails clearly when the browser gives no canvas", async () => {
    failContext = true;
    await expect(cutOut(SOURCE, new Uint8ClampedArray(4), 2)).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("readPixels", () => {
  it("draws the picture at its own size and reads every pixel back", () => {
    const picture = readPixels(SOURCE);
    expectInOrder(["200x100 drawImage source 0,0,200,100", "200x100 getImageData"]);
    expect([picture.width, picture.height]).toEqual([200, 100]);
    expect(picture.rgba).toHaveLength(200 * 100 * 4);
    expect(picture.rgba[0]).toBe(7); // the bytes come straight from the canvas
    expect(picture.scaled).toBe(false);
  });

  it("leaves a picture inside the pixel budget at its own size", () => {
    const picture = readPixels(SOURCE, 20_000);
    expectInOrder(["200x100 drawImage source 0,0,200,100", "200x100 getImageData"]);
    expect(picture).toMatchObject({ width: 200, height: 100, scaled: false });
  });

  it("draws a picture over the pixel budget smaller, keeping its shape, and says so", () => {
    const picture = readPixels(SOURCE, 5_000); // 200 x 100 is 20,000 pixels: half the width and half the height
    expectInOrder(["100x50 set imageSmoothingQuality=high", "100x50 drawImage source 0,0,100,50", "100x50 getImageData"]);
    expect(picture).toMatchObject({ width: 100, height: 50, scaled: true });
    expect(picture.rgba).toHaveLength(100 * 50 * 4);
  });

  it("rejects a picture that has no size", () => {
    Object.defineProperty(SOURCE, "naturalWidth", { value: 0, configurable: true });
    expect(() => readPixels(SOURCE)).toThrow(expect.objectContaining({ code: "image" }));
    expect(() => readPixels(SOURCE, 5_000)).toThrow(expect.objectContaining({ code: "image" }));
  });

  it("fails clearly when the browser gives no canvas", () => {
    failContext = true;
    expect(() => readPixels(SOURCE)).toThrow(expect.objectContaining({ code: "unsupported" }));
  });
});

describe("createResultCanvas", () => {
  const matte = (alpha: number[]) => ({ rgba: Uint8ClampedArray.from(alpha.flatMap((a) => [0, 0, 0, a])), width: 2, height: 1 });
  const tile = (pixels: number) => new Uint8ClampedArray(pixels * 4).fill(255);

  it("puts each finished tile at its place in the result", () => {
    const canvas = createResultCanvas(400, 200);
    canvas.put(0, 0, tile(2), 2, 1);
    canvas.put(2, 0, tile(1), 1, 1);
    expect(log.filter((line) => line.startsWith("400x200 putImageData"))).toEqual(["400x200 putImageData alpha=255,255", "400x200 putImageData alpha=255"]);
    canvas.dispose();
  });

  it("gives a solid result as a PNG", async () => {
    const canvas = createResultCanvas(400, 200);
    const blob = await canvas.finish({});
    expect(blob.type).toBe("image/png");
    expect(log).toContain("400x200 toBlob image/png -");
    expect(log.some((line) => line.includes("destination-in"))).toBe(false);
    canvas.dispose();
  });

  it("gives a solid result as a JPEG of high quality when that is asked for", async () => {
    const canvas = createResultCanvas(400, 200);
    const blob = await canvas.finish({ jpeg: true });
    expect(blob.type).toBe("image/jpeg");
    expect(log).toContain("400x200 toBlob image/jpeg 0.95");
    canvas.dispose();
  });

  it("keeps the transparency of the original: the result is drawn through its opacity, at the result's own size", async () => {
    const canvas = createResultCanvas(400, 200);
    canvas.put(0, 0, tile(1), 1, 1);
    await canvas.finish({ matte: matte([0, 255]) });
    expect(log).toContain("2x1 putImageData alpha=0,255");
    expectInOrder([
      "400x200 set imageSmoothingQuality=high",
      "400x200 set globalCompositeOperation=destination-in",
      "400x200 drawImage canvas 0,0,400,200",
      "400x200 toBlob image/png -",
    ]);
  });

  it("never makes a JPEG of a picture with transparency: a JPEG has none", async () => {
    const canvas = createResultCanvas(400, 200);
    const blob = await canvas.finish({ matte: matte([0, 255]), jpeg: true });
    expect(blob.type).toBe("image/png");
  });

  it("rejects when the browser cannot encode the file", async () => {
    blobFails = true;
    const canvas = createResultCanvas(400, 200);
    await expect(canvas.finish({})).rejects.toMatchObject({ code: "image" });
  });

  it("fails clearly when the browser gives no canvas", () => {
    failContext = true;
    expect(() => createResultCanvas(400, 200)).toThrow(expect.objectContaining({ code: "unsupported" }));
  });
});

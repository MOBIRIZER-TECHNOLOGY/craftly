import { describe, expect, it } from "vitest";
import { floatToHalf, fromHalfArray, halfToFloat, maskFromOutput, maskToRgba, subjectShare, toHalfArray, toInputTensor } from "./pixels";

const close = (actual: ArrayLike<number>, expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 5));
};

describe("toInputTensor", () => {
  // 2 x 2 picture: red, green / blue, white. The alphas differ on purpose, the model never sees them.
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 10, 0, 0, 255, 0, 255, 255, 255, 255]);

  it("writes one plane per channel (red, then green, then blue) and normalises each with its own mean and deviation", () => {
    const out = toInputTensor(rgba, 2, [0.1, 0.2, 0.3], [0.5, 0.25, 0.1]);
    // red plane: values 1, 0, 0, 1 -> (v - 0.1) / 0.5
    close(out.subarray(0, 4), [1.8, -0.2, -0.2, 1.8]);
    // green plane: values 0, 1, 0, 1 -> (v - 0.2) / 0.25
    close(out.subarray(4, 8), [-0.8, 3.2, -0.8, 3.2]);
    // blue plane: values 0, 0, 1, 1 -> (v - 0.3) / 0.1
    close(out.subarray(8, 12), [-3, -3, 7, 7]);
  });

  it("gives the same tensor whatever the alpha is", () => {
    const opaque = new Uint8ClampedArray(rgba);
    for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
    expect(toInputTensor(rgba, 2, [0, 0, 0], [1, 1, 1])).toEqual(toInputTensor(opaque, 2, [0, 0, 0], [1, 1, 1]));
  });

  it("refuses pixels that do not fill a size x size square", () => {
    expect(() => toInputTensor(rgba, 3, [0, 0, 0], [1, 1, 1])).toThrow(RangeError);
  });
});

describe("maskFromOutput", () => {
  it("applies a sigmoid and scales to 0-255 coverage", () => {
    const logits = new Float32Array([-20, -Math.log(3), 0, Math.log(3), 20]);
    expect(Array.from(maskFromOutput(logits, "sigmoid"))).toEqual([0, 64, 128, 191, 255]);
  });

  it("only scales when the model already outputs probabilities, and clamps stray values", () => {
    expect(Array.from(maskFromOutput(new Float32Array([0, 0.5, 1, 1.5, -1]), "none"))).toEqual([0, 128, 255, 255, 0]);
  });

  it("can stretch the output to the full range first, which is what ISNet's authors recommend", () => {
    expect(Array.from(maskFromOutput(new Float32Array([0.25, 0.5, 0.75]), "none", true))).toEqual([0, 128, 255]);
  });

  it("leaves a flat output as it is instead of dividing by zero", () => {
    expect(Array.from(maskFromOutput(new Float32Array([0.5, 0.5]), "none", true))).toEqual([128, 128]);
  });

  it("finds the range without being thrown by a NaN", () => {
    expect(Array.from(maskFromOutput(new Float32Array([NaN, 0.25, 0.75]), "none", true))).toEqual([0, 0, 255]);
  });

  it("turns a NaN from a glitching GPU into 'not subject'", () => {
    expect(Array.from(maskFromOutput(new Float32Array([NaN]), "sigmoid"))).toEqual([0]);
  });
});

describe("half precision", () => {
  it("encodes known values to their IEEE 754 binary16 bit patterns", () => {
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(-2)).toBe(0xc000);
    expect(floatToHalf(0.5)).toBe(0x3800);
    expect(floatToHalf(65504)).toBe(0x7bff);
    expect(floatToHalf(0)).toBe(0x0000);
    expect(floatToHalf(-0)).toBe(0x8000);
  });

  it("overflows to infinity, underflows to zero and keeps the smallest subnormal", () => {
    expect(floatToHalf(1e6)).toBe(0x7c00);
    expect(floatToHalf(-Infinity)).toBe(0xfc00);
    expect(floatToHalf(2 ** -24)).toBe(0x0001);
    expect(floatToHalf(1e-9)).toBe(0x0000);
  });

  it("keeps NaN a NaN", () => {
    const bits = floatToHalf(NaN);
    expect(bits & 0x7c00).toBe(0x7c00);
    expect(bits & 0x03ff).not.toBe(0);
  });

  it("decodes known bit patterns", () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
  });

  it("round-trips every half precision number", () => {
    for (let bits = 0; bits <= 0xffff; bits++) {
      const isNaNBits = (bits & 0x7c00) === 0x7c00 && (bits & 0x03ff) !== 0;
      if (isNaNBits) continue;
      expect(floatToHalf(halfToFloat(bits))).toBe(bits);
    }
  });

  it("converts whole arrays both ways", () => {
    expect(Array.from(toHalfArray(new Float32Array([0.5, -2])))).toEqual([0x3800, 0xc000]);
    expect(Array.from(fromHalfArray(new Uint16Array([0x3800, 0xc000])))).toEqual([0.5, -2]);
  });
});

describe("subjectShare", () => {
  it("is the share of pixels that are at least half covered", () => {
    expect(subjectShare(new Uint8ClampedArray([0, 255, 255, 0]))).toBe(0.5);
    expect(subjectShare(new Uint8ClampedArray([127, 128]))).toBe(0.5);
  });

  it("is zero for an empty mask rather than NaN", () => {
    expect(subjectShare(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe("maskToRgba", () => {
  it("puts the coverage into the alpha channel, which is all a destination-in draw reads", () => {
    expect(Array.from(maskToRgba(new Uint8ClampedArray([0, 128, 255])))).toEqual([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255]);
  });
});

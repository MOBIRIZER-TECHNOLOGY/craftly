import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, formatBytes, getModelSpec, MODELS, modelHost, modelUrl } from "./registry";

describe("the model registry", () => {
  it("lists every model with the facts the download check and the licence screen need", () => {
    for (const spec of MODELS) {
      expect(spec.sha256, spec.id).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.revision, spec.id).toMatch(/^[0-9a-f]{40}$/);
      expect(Array.isArray(spec.gpuFeatures), spec.id).toBe(true);
      expect(spec.bytes, spec.id).toBeGreaterThan(0);
      expect(Number.isInteger(spec.bytes), spec.id).toBe(true);
      expect(spec.licence.name, spec.id).not.toBe("");
      expect(spec.licence.url, spec.id).toMatch(/^https:\/\//);
      expect(spec.credit.text, spec.id).not.toBe("");
      expect(spec.credit.url, spec.id).toMatch(/^https:\/\//);
    }
  });

  it("gives every model its own id", () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
  });

  it("names a default model for every task, and it exists", () => {
    for (const [task, id] of Object.entries(DEFAULT_MODEL)) {
      expect(getModelSpec(id)?.task, task).toBe(task);
    }
  });

  it("finds a model by id and says nothing for an unknown one", () => {
    expect(getModelSpec("isnet-general")?.name).toBe("ISNet general-use");
    expect(getModelSpec("nope")).toBeUndefined();
  });

  it("gives a picture-to-picture model a tile that leaves room for the context around the part it keeps", () => {
    for (const spec of MODELS) {
      if (spec.io.kind !== "image-to-image") continue;
      expect(Number.isInteger(spec.io.scale) && spec.io.scale >= 2, spec.id).toBe(true);
      expect(Number.isInteger(spec.io.tile) && Number.isInteger(spec.io.halo), spec.id).toBe(true);
      expect(spec.io.tile, spec.id).toBeGreaterThan(2 * spec.io.halo);
    }
  });
});

describe("the upscaler", () => {
  const spec = getModelSpec("realesrgan-general")!;

  it("is the model of the upscaling task", () => {
    expect(spec.task).toBe("upscaling");
    expect(DEFAULT_MODEL.upscaling).toBe("realesrgan-general");
  });

  it("is one pinned file of the SkillSafe export of the official Real-ESRGAN general x4 v3 weights", () => {
    expect(modelUrl(spec)).toBe("https://huggingface.co/skillsafe-ai/realesr-general-x4v3/resolve/042a40bc4c918349ad3e2e607a68ae509a4c27b5/model.onnx");
    expect(spec.bytes).toBe(4_866_428);
    expect(spec.sha256).toBe("a946f7a9397021b9b6b7e71df3d2821b04cc09ff244423b7ca79cb191ce4a00e");
  });

  it("is full precision, so it needs nothing of the graphics card beyond WebGPU itself", () => {
    expect(spec.requires).toBe("webgpu");
    expect(spec.gpuFeatures).toEqual([]);
  });

  it("makes every side four times larger, 256 pixels at a time, with 16 pixels of context", () => {
    expect(spec.io).toEqual({ kind: "image-to-image", input: "input", output: "output", scale: 4, tile: 256, halo: 16 });
  });

  it("carries the copyright line of the BSD licence, which asks to keep it", () => {
    expect(spec.licence.name).toBe("BSD-3-Clause");
    expect(spec.licence.notice).toContain("Copyright (c) 2021, Xintao Wang");
    expect(spec.licence.url).toContain("xinntao/Real-ESRGAN");
  });
});

describe("modelUrl", () => {
  const spec = getModelSpec("isnet-general")!;

  it("points at the pinned Hugging Face revision by default", () => {
    expect(modelUrl(spec)).toBe("https://huggingface.co/Ko033/isnet-general-use-onnx/resolve/5349b617911fd60c619b52f32e2b593517b78df3/onnx/model_fp16.onnx");
  });

  it("uses '<base>/<id>.onnx' on a mirror, with or without a trailing slash", () => {
    expect(modelUrl(spec, "https://cdn.example.com/craftly")).toBe("https://cdn.example.com/craftly/isnet-general.onnx");
    expect(modelUrl(spec, "https://cdn.example.com/craftly/")).toBe("https://cdn.example.com/craftly/isnet-general.onnx");
  });

  it("ignores an empty mirror setting", () => {
    expect(modelUrl(spec, "")).toContain("huggingface.co");
  });
});

describe("modelHost", () => {
  const spec = getModelSpec("isnet-general")!;

  it("is Hugging Face by default, and the mirror when one is set at build time", () => {
    expect(modelHost(spec, "")).toBe("huggingface.co");
    expect(modelHost(spec, "https://models.example.org/craftly/")).toBe("models.example.org");
  });

  it("is this site itself for a mirror given as a path", () => {
    expect(modelHost(spec, "/models")).toBe(globalThis.location?.host || "localhost");
  });
});

describe("formatBytes", () => {
  it.each([
    [900, "900 B"],
    [1500, "1.5 kB"],
    [4_650_000, "4.7 MB"],
    [114_538_221, "114.5 MB"],
    [2_000_000_000, "2.0 GB"],
    [999_999, "1.0 MB"],
    [0, "0 B"],
  ])("writes %d bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

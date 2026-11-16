/**
 * The models the app knows about. An entry names exactly one set of bytes (repository, commit, file, size, SHA-256) and
 * carries what the licence screen has to show. Add a model only with all of it; see docs/ON-DEVICE-AI.md.
 */
import { m, num } from "@/i18n";
import type { MlTask, ModelId, ModelSpec } from "./types";

/**
 * Why ISNet and not BiRefNet lite (the first choice): BiRefNet's export contains operations that join up to 1,024 tensors
 * at once, and a GPU shader can bind only 16 buffers on most integrated graphics cards, so it failed there ("Too many
 * storage buffers in shader. Current: 17, Max is 16"). ISNet is made of plain convolutions and fits every GPU that has half
 * precision maths. See docs/ON-DEVICE-AI.md.
 */
const ISNET_GENERAL: ModelSpec = {
  id: "isnet-general",
  task: "background-removal",
  tool: m.ml.models.backgroundRemover.tool,
  name: "ISNet general-use",
  summary: m.ml.models.backgroundRemover.summary,
  repo: "Ko033/isnet-general-use-onnx",
  revision: "5349b617911fd60c619b52f32e2b593517b78df3",
  file: "onnx/model_fp16.onnx",
  bytes: 88_141_111,
  sha256: "0857167263ad816d67c26852b99c2861e46a86c9a889527061a5eb2a6f90d32c",
  requires: "webgpu",
  gpuFeatures: ["shader-f16"],
  io: {
    kind: "image-to-mask",
    input: "input_image",
    output: "output_image",
    size: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    activation: "none", // the output already is a probability (a sigmoid is part of the graph)
    stretch: true,
  },
  licence: {
    name: "Apache-2.0",
    url: "https://github.com/xuebinqin/DIS/blob/main/LICENSE.md",
    notice: "Copyright the DIS authors (Xuebin Qin et al.); ONNX export from rembg (MIT, Daniel Gatis)",
  },
  credit: { text: "ISNet by Xuebin Qin et al. (DIS project), ONNX export by rembg, half-precision build by Ko033", url: "https://huggingface.co/Ko033/isnet-general-use-onnx" },
};

/**
 * Real-ESRGAN general x4 v3 (SRVGGNetCompact, 1.2 million weights): the small upscaler of the Real-ESRGAN project, trained to
 * undo blur, noise and compression at the same time. The file is SkillSafe's export of the official `realesr-general-x4v3.pth`
 * (release v0.2.5.0, SHA-256 8dc7edb9...), checked by its authors against PyTorch to 4e-6, and again here against its own
 * reference output on a real graphics card (see docs/ON-DEVICE-AI.md). Full precision on purpose: it needs no half-precision
 * shaders, and at 4.9 MB it is not worth a second file.
 */
const REALESRGAN_GENERAL: ModelSpec = {
  id: "realesrgan-general",
  task: "upscaling",
  tool: m.ml.models.upscaler.tool,
  name: "Real-ESRGAN general x4 v3",
  summary: m.ml.models.upscaler.summary,
  repo: "skillsafe-ai/realesr-general-x4v3",
  revision: "042a40bc4c918349ad3e2e607a68ae509a4c27b5",
  file: "model.onnx",
  bytes: 4_866_428,
  sha256: "a946f7a9397021b9b6b7e71df3d2821b04cc09ff244423b7ca79cb191ce4a00e",
  requires: "webgpu",
  gpuFeatures: [],
  io: { kind: "image-to-image", input: "input", output: "output", scale: 4, tile: 256, halo: 16 },
  licence: {
    name: "BSD-3-Clause",
    url: "https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/LICENSE",
    notice: "Copyright (c) 2021, Xintao Wang",
  },
  credit: { text: "Real-ESRGAN by Xintao Wang et al., ONNX export by SkillSafe", url: "https://huggingface.co/skillsafe-ai/realesr-general-x4v3" },
};

export const MODELS: readonly ModelSpec[] = [ISNET_GENERAL, REALESRGAN_GENERAL];

/** The model each task uses unless the person picks another. */
export const DEFAULT_MODEL: Record<MlTask, ModelId> = { "background-removal": ISNET_GENERAL.id, upscaling: REALESRGAN_GENERAL.id };

export const getModelSpec = (id: ModelId): ModelSpec | undefined => MODELS.find((model) => model.id === id);

const HOST = "https://huggingface.co";

/**
 * Where the bytes come from: the pinned Hugging Face file, or `<mirror>/<id>.onnx` when a mirror is set at build time
 * (`VITE_CRAFTLY_MODEL_BASE`). A mirror serves the same bytes; the SHA-256 check still applies.
 */
export function modelUrl(spec: ModelSpec, mirror: string | undefined = import.meta.env.VITE_CRAFTLY_MODEL_BASE): string {
  if (mirror) return `${mirror.replace(/\/+$/, "")}/${spec.id}.onnx`;
  return `${HOST}/${spec.repo}/resolve/${spec.revision}/${spec.file}`;
}

/** The host the model file is fetched from, as the person should be told: Hugging Face, or the mirror a build points at. */
export function modelHost(spec: ModelSpec, mirror: string | undefined = import.meta.env.VITE_CRAFTLY_MODEL_BASE): string {
  return new URL(modelUrl(spec, mirror), globalThis.location?.href ?? "https://localhost/").host;
}

/** "114.5 MB": decimal units, like the Hugging Face file listing the sizes were read from. */
export function formatBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (unit < units.length - 1 && Math.abs(value) >= 1000) {
    value /= 1000;
    unit++;
  }
  // 999.96 kB must not print as "1000.0 kB"
  if (unit > 0 && unit < units.length - 1 && Number(value.toFixed(1)) >= 1000) {
    value /= 1000;
    unit++;
  }
  return unit === 0 ? `${num(Math.round(value))} B` : `${num(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${units[unit]}`;
}

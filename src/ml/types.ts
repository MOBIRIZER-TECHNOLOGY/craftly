/** Shared types of the on-device model tools (see docs/ON-DEVICE-AI.md). */
import type { Rgb } from "./pixels";

export type ModelId = string;

/** What a model is for. Each task has its own section in the Tools tab. */
export type MlTask = "background-removal" | "upscaling";

/** Input and output of a model that turns a picture into a mask. */
export interface ImageToMaskIo {
  kind: "image-to-mask";
  /** tensor names inside the ONNX file */
  input: string;
  output: string;
  /** the model sees the picture squeezed into a square of this many pixels */
  size: number;
  mean: Rgb;
  std: Rgb;
  /** `sigmoid` when the model outputs logits */
  activation: "sigmoid" | "none";
  /** spread each picture's output over the full range before turning it into coverage (ISNet's recommended post-step) */
  stretch?: boolean;
}

/**
 * Input and output of a model that turns a picture into a larger one. The picture goes in piece by piece (tiles), because a
 * whole photo would not fit in graphics memory and a tile is a good unit for progress and for Cancel.
 */
export interface ImageToImageIo {
  kind: "image-to-image";
  /** tensor names inside the ONNX file */
  input: string;
  output: string;
  /** every side of the output is this many times as long as the input's */
  scale: number;
  /** the largest square, in pixels, that one run gets to see: the part it keeps plus its context */
  tile: number;
  /** pixels of context on every side of the part a tile keeps, so tiles meet without a seam */
  halo: number;
}

export type ModelIo = ImageToMaskIo | ImageToImageIo;

export interface ModelLicence {
  /** SPDX identifier, e.g. "MIT" */
  name: string;
  url: string;
  /** the copyright line the licence asks us to keep */
  notice: string;
}

export interface ModelSpec {
  id: ModelId;
  task: MlTask;
  /** the kind of tool the model is, as a noun the screens can put after "the": "Background remover" */
  tool: string;
  name: string;
  /** one plain sentence for the models dialog */
  summary: string;
  /** Hugging Face repository, commit and path of the file: together they name exactly one set of bytes */
  repo: string;
  revision: string;
  file: string;
  bytes: number;
  sha256: string;
  /** the graphics API the model needs. Only WebGPU for now: the half precision file cannot run on the CPU provider. */
  requires: "webgpu";
  /** WebGPU features the graphics card must have, e.g. "shader-f16" for a half precision model */
  gpuFeatures: readonly string[];
  io: ModelIo;
  licence: ModelLicence;
  credit: { text: string; url: string };
}

/** What the store keeps about an installed model (the bytes live next to it). */
export interface InstalledModel {
  id: ModelId;
  sha256: string;
  bytes: number;
  revision: string;
  installedAt: number;
}

/** The steps a job reports while it runs. */
export type MlStage = "preparing" | "runtime" | "model" | "inference" | "finishing";

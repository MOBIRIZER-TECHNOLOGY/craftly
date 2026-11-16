/**
 * What runs inside the worker: it owns the ONNX runtime and the one loaded model, and either turns a picture into a mask or
 * makes one tile of a picture larger. The runtime is injected, so everything here is tested with a stand-in;
 * `workerHost.ts` wires in the real one.
 */
import type * as Ort from "onnxruntime-web/webgpu";
// a type only: errors.ts reads the catalog of words, which a worker has no use for (and no localStorage to choose it by)
import type { MlErrorCode } from "./errors";
import { fromHalfArray, maskFromOutput, toHalfArray, toInputTensor } from "./pixels";
import type { ImageToImageIo, ImageToMaskIo, MlStage, ModelIo } from "./types";

/**
 * The part of onnxruntime-web the engine uses, typed by the real package so the compiler checks every call against the
 * real API (a type-only import: nothing of the package is loaded here). Tests pass a stand-in.
 */
export type OrtLike = Pick<typeof Ort, "InferenceSession" | "Tensor">;
export type OrtSession = Ort.InferenceSession;

/* ---- messages between the page and the worker ---- */

export interface WorkerModel {
  id: string;
  sha256: string;
  blob: Blob;
  io: ModelIo;
}

export type WorkerRequest =
  | { id: number; type: "run"; model: WorkerModel; /** io.size x io.size RGBA pixels */ rgba: Uint8ClampedArray }
  | { id: number; type: "tile"; model: WorkerModel; /** planar RGB from 0 to 1: 3 x width x height numbers */ pixels: Float32Array; width: number; height: number }
  | { id: number; type: "warm"; model: WorkerModel };

export type WorkerResponse =
  | { id: number; type: "stage"; stage: MlStage }
  | { id: number; type: "done"; mask: Uint8ClampedArray }
  | { id: number; type: "tile-done"; /** planar RGB, io.scale times larger on each side: 3 x (width x scale) x (height x scale) numbers */ pixels: Float32Array }
  | { id: number; type: "ready" }
  /** a failure: the code says what went wrong, and the page puts it in words; `detail` is the technical text, for a bug report, never shown */
  | { id: number; type: "error"; code: MlErrorCode; detail?: string };

export type Post = (message: WorkerResponse, transfer?: Transferable[]) => void;

/* ---- the engine ---- */

const GPU_MEMORY = /out of memory|allocate|\boom\b|device (was )?lost|memory access/i;

/** A failure inside the worker: a code for the page to put in words, and the technical cause. */
class EngineFailure extends Error {
  readonly code: MlErrorCode;

  constructor(code: MlErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "EngineFailure";
    this.code = code;
  }
}

/** What a developer needs to see: the runtime's own words, or the cause an EngineFailure carries. */
function technicalText(error: unknown): string {
  const raw = error instanceof EngineFailure && error.cause !== undefined ? error.cause : error;
  const text = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw);
  return text.slice(0, 600);
}

function failure(error: unknown): EngineFailure {
  if (error instanceof EngineFailure) return error;
  const text = error instanceof Error ? error.message : String(error);
  return new EngineFailure(GPU_MEMORY.test(text) ? "out-of-memory" : "runtime", { cause: error });
}

export interface EngineDeps {
  loadRuntime(): Promise<OrtLike>;
}

export function createEngine(deps: EngineDeps) {
  let runtime: Promise<OrtLike> | null = null;
  let current: { key: string; session: Promise<OrtSession> } | null = null;
  let queue: Promise<void> = Promise.resolve();

  const getRuntime = (): Promise<OrtLike> => {
    runtime ??= deps.loadRuntime().catch((error) => {
      runtime = null; // a failed load (offline, blocked) must not stick: the next request tries again
      throw error;
    });
    return runtime;
  };

  async function drop(): Promise<void> {
    const old = current;
    current = null;
    if (old) await old.session.then((session) => session.release()).catch(() => undefined);
  }

  async function sessionFor(model: WorkerModel, ort: OrtLike): Promise<OrtSession> {
    const key = `${model.id}:${model.sha256}`;
    if (current?.key === key) return current.session;
    await drop();
    const session = (async () => {
      const bytes = new Uint8Array(await model.blob.arrayBuffer());
      return ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    })();
    current = { key, session };
    session.catch(() => {
      if (current?.session === session) current = null;
    });
    return session;
  }

  /** Runs the model on `floats` (planar RGB) in the precision its file wants. The caller owns the answer and has to dispose it. */
  async function runModel(ort: OrtLike, session: OrtSession, io: ModelIo, floats: Float32Array, dims: number[]): Promise<Ort.Tensor> {
    const meta = session.inputMetadata.find((input) => input.name === io.input);
    const wantsHalf = !!meta && meta.isTensor && meta.type === "float16";
    const input = wantsHalf ? new ort.Tensor("float16", toHalfArray(floats), dims) : new ort.Tensor("float32", floats, dims);
    const outputs = await session.run({ [io.input]: input });
    const output = outputs[io.output];
    if (!output) {
      const names = Object.keys(outputs).join(", ") || "nothing";
      throw new EngineFailure("runtime", { cause: `the model returned no output named "${io.output}" (it returned: ${names})` });
    }
    return output;
  }

  /** The numbers of an answer: a picture or a mask is never a string tensor, and half precision arrives as raw 16-bit patterns. */
  const numbersOf = (output: Ort.Tensor): ArrayLike<number> => {
    const raw = output.data as ArrayLike<number>;
    return output.type === "float16" && raw instanceof Uint16Array ? fromHalfArray(raw) : raw;
  };

  /** A request for the wrong kind of model is a bug of the caller: say so before a session is made for it. */
  function ioOf<K extends ModelIo["kind"]>(model: WorkerModel, kind: K): Extract<ModelIo, { kind: K }> {
    if (model.io.kind !== kind) throw new EngineFailure("runtime", { cause: `${model.id} is a ${model.io.kind} model, not a ${kind} model` });
    return model.io as Extract<ModelIo, { kind: K }>;
  }

  /** One tile through a model that makes pictures larger. The answer is a copy: the runtime's own memory is released here. */
  async function inferTile(ort: OrtLike, session: OrtSession, io: ImageToImageIo, pixels: Float32Array, width: number, height: number): Promise<Float32Array> {
    if (pixels.length !== 3 * width * height) {
      throw new EngineFailure("runtime", { cause: `the tile has ${pixels.length} numbers, expected ${3 * width * height} for ${width} x ${height} pixels` });
    }
    const output = await runModel(ort, session, io, pixels, [1, 3, height, width]);
    try {
      const values = numbersOf(output);
      const expected = 3 * width * io.scale * height * io.scale;
      if (values.length !== expected) {
        throw new EngineFailure("runtime", { cause: `the output has ${values.length} numbers, expected ${expected} (dims ${output.dims.join(" x ")})` });
      }
      // one bad number is a black dot in somebody's photograph: the graphics card is not to be trusted with this picture
      let invalid = 0;
      for (let i = 0; i < values.length; i++) if (Number.isNaN(values[i])) invalid++;
      if (invalid > 0) throw new EngineFailure("runtime", { cause: `the output is not a number (NaN) in ${invalid} of ${values.length} places` });
      return values instanceof Float32Array ? values.slice() : Float32Array.from(values);
    } finally {
      output.dispose();
    }
  }

  async function infer(ort: OrtLike, session: OrtSession, io: ImageToMaskIo, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray> {
    const output = await runModel(ort, session, io, toInputTensor(rgba, io.size, io.mean, io.std), [1, 3, io.size, io.size]);
    try {
      const values = numbersOf(output);
      if (values.length !== io.size * io.size) {
        throw new EngineFailure("runtime", { cause: `the output has ${values.length} values, expected ${io.size * io.size} (dims ${output.dims.join(" x ")})` });
      }
      // a graphics card whose half precision overflows returns NaN: that is a failure, not "nothing found"
      let invalid = 0;
      for (let i = 0; i < values.length; i++) if (Number.isNaN(values[i])) invalid++;
      if (invalid > values.length / 100) {
        throw new EngineFailure("runtime", {
          cause: `the output is not a number (NaN) in ${invalid} of ${values.length} places; half precision may overflow on this graphics card`,
        });
      }
      return maskFromOutput(values, io.activation, io.stretch);
    } finally {
      output.dispose();
    }
  }

  async function process(request: WorkerRequest, post: Post): Promise<void> {
    const stage = (name: MlStage) => post({ id: request.id, type: "stage", stage: name });
    let loadingRuntime = true;
    try {
      stage("runtime");
      const ort = await getRuntime();
      loadingRuntime = false;
      if (request.type === "run") ioOf(request.model, "image-to-mask");
      if (request.type === "tile") ioOf(request.model, "image-to-image");
      stage("model");
      const session = await sessionFor(request.model, ort);
      if (request.type === "warm") {
        post({ id: request.id, type: "ready" });
        return;
      }
      stage("inference");
      if (request.type === "run") {
        const mask = await infer(ort, session, ioOf(request.model, "image-to-mask"), request.rgba);
        post({ id: request.id, type: "done", mask }, [mask.buffer as ArrayBuffer]);
      } else {
        const pixels = await inferTile(ort, session, ioOf(request.model, "image-to-image"), request.pixels, request.width, request.height);
        post({ id: request.id, type: "tile-done", pixels }, [pixels.buffer as ArrayBuffer]);
      }
    } catch (error) {
      // a runtime that would not load is not the model's fault: say "engine", not "this device cannot run it"
      const known = loadingRuntime ? new EngineFailure("engine", { cause: error }) : failure(error);
      // the answer goes first: if the graphics card hangs while the session is released, the person still hears why
      post({ id: request.id, type: "error", code: known.code, detail: technicalText(error) });
      await drop(); // after a failure the GPU state is not trusted: the next request builds a fresh session
    }
  }

  return {
    /** Runs requests strictly one after another: the GPU is never shared between two inferences. */
    handle(request: WorkerRequest, post: Post): Promise<void> {
      const job = queue.then(() => process(request, post));
      queue = job.catch(() => undefined);
      return job;
    },
    async dispose(): Promise<void> {
      await queue;
      await drop();
      runtime = null;
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;

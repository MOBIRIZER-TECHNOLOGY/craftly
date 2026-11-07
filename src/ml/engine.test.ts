import { describe, expect, it } from "vitest";
import { createEngine, type OrtLike, type WorkerModel, type WorkerRequest, type WorkerResponse } from "./engine";
import type { ImageToImageIo, ImageToMaskIo } from "./types";

const io: ImageToMaskIo = { kind: "image-to-mask", input: "pic", output: "matte", size: 2, mean: [0, 0, 0], std: [1, 1, 1], activation: "none" };
const model = (sha256 = "a".repeat(64)): WorkerModel => ({ id: "m", sha256, blob: new Blob([new Uint8Array([1, 2, 3])]), io });
// 2 x 2 picture whose red channel is 0, 255, 255, 0: the fake model below hands the red plane back as its matte
const rgba = () => new Uint8ClampedArray([0, 9, 9, 255, 255, 9, 9, 255, 255, 9, 9, 255, 0, 9, 9, 255]);

interface Fake {
  ort: OrtLike;
  created: Array<{ bytes: Uint8Array; options: { executionProviders?: unknown } }>;
  fed: Array<{ name: string; type: string; dims: readonly number[]; data: ArrayLike<number> }>;
  released: number;
  log: string[];
}

/** The parts of an ORT tensor the stand-in needs; the real class has many more. */
class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: ArrayLike<number>,
    readonly dims: readonly number[],
  ) {}
  dispose() {}
}

/** A stand-in for onnxruntime-web whose "model" returns the red plane of its input. */
function fakeOrt(options: { half?: boolean; outputLength?: number; failRun?: Error; gate?: Promise<void>; output?: number[]; hangRelease?: boolean } = {}): Fake {
  const fake: Fake = { ort: undefined as never, created: [], fed: [], released: 0, log: [] };
  const session = {
    inputMetadata: [{ name: "pic", isTensor: true, type: options.half ? "float16" : "float32", shape: [1, 3, 2, 2] }],
    async run(feeds: Record<string, FakeTensor>) {
      fake.log.push("run:start");
      await options.gate;
      if (options.failRun) throw options.failRun;
      const [name, tensor] = Object.entries(feeds)[0]!;
      fake.fed.push({ name, type: tensor.type, dims: tensor.dims, data: tensor.data });
      const plane = Array.from(tensor.data).slice(0, 4);
      const values = options.output ? Float32Array.from(options.output) : options.half ? Uint16Array.from(plane) : Float32Array.from(plane);
      fake.log.push("run:end");
      return { matte: new FakeTensor(options.half ? "float16" : "float32", options.outputLength ? new Float32Array(options.outputLength) : values, [1, 1, 2, 2]) };
    },
    async release() {
      fake.released++;
      if (options.hangRelease) await new Promise(() => undefined);
    },
  };
  fake.ort = {
    InferenceSession: {
      async create(bytes: Uint8Array, sessionOptions: { executionProviders?: unknown }) {
        fake.created.push({ bytes, options: sessionOptions });
        return session;
      },
    },
    Tensor: FakeTensor,
  } as unknown as OrtLike;
  return fake;
}

/** Sends one request through the engine and returns everything it posted. */
async function send(engine: ReturnType<typeof createEngine>, request: WorkerRequest): Promise<WorkerResponse[]> {
  const out: WorkerResponse[] = [];
  await engine.handle(request, (message) => out.push(message));
  return out;
}
const run = (id = 1, m = model()): WorkerRequest => ({ id, type: "run", model: m, rgba: rgba() });
const last = (messages: WorkerResponse[]) => messages[messages.length - 1]!;

describe("the engine", () => {
  it("runs the model on the picture and answers with the mask, reporting each step", async () => {
    const fake = fakeOrt();
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    const messages = await send(engine, run());
    expect(messages.map((m) => (m.type === "stage" ? m.stage : m.type))).toEqual(["runtime", "model", "inference", "done"]);
    const done = last(messages);
    expect(done).toMatchObject({ id: 1, type: "done" });
    expect(Array.from((done as Extract<WorkerResponse, { type: "done" }>).mask)).toEqual([0, 255, 255, 0]);
    expect(fake.fed).toHaveLength(1);
    expect(fake.fed[0]).toMatchObject({ name: "pic", type: "float32", dims: [1, 3, 2, 2] });
  });

  it("applies the model's own post-step: its output stretched to the full range", async () => {
    const fake = fakeOrt({ output: [0.25, 0.25, 0.75, 0.75] });
    const stretching: WorkerRequest = { id: 1, type: "run", model: { ...model(), io: { ...io, stretch: true } }, rgba: rgba() };
    const done = last(await send(createEngine({ loadRuntime: async () => fake.ort }), stretching)) as Extract<WorkerResponse, { type: "done" }>;
    expect(Array.from(done.mask)).toEqual([0, 0, 255, 255]);
  });

  it("hands the model's own bytes to the runtime and asks for the WebGPU provider", async () => {
    const fake = fakeOrt();
    await send(createEngine({ loadRuntime: async () => fake.ort }), run());
    expect(Array.from(fake.created[0]!.bytes)).toEqual([1, 2, 3]);
    expect(fake.created[0]!.options.executionProviders).toEqual(["webgpu"]);
  });

  it("keeps the session for the next picture", async () => {
    const fake = fakeOrt();
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    await send(engine, run(1));
    await send(engine, run(2));
    expect(fake.created).toHaveLength(1);
    expect(fake.fed).toHaveLength(2);
  });

  it("swaps the session, releasing the old one first, when another model is asked for", async () => {
    const fake = fakeOrt();
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    await send(engine, run(1, model("a".repeat(64))));
    await send(engine, run(2, model("b".repeat(64))));
    expect(fake.created).toHaveLength(2);
    expect(fake.released).toBe(1);
  });

  it("feeds half precision numbers to a model that wants them and reads half precision back", async () => {
    const fake = fakeOrt({ half: true });
    const messages = await send(createEngine({ loadRuntime: async () => fake.ort }), run());
    expect(fake.fed[0]).toMatchObject({ type: "float16" });
    expect(fake.fed[0]!.data).toBeInstanceOf(Uint16Array);
    // the fake hands the red plane back as it received it (half precision bits); decoded it is 0, 1, 1, 0 again
    const done = last(messages) as Extract<WorkerResponse, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(Array.from(done.mask)).toEqual([0, 255, 255, 0]);
  });

  it("rejects an output of the wrong size as a runtime error and does not trust that session again", async () => {
    const fake = fakeOrt({ outputLength: 9 });
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    const first = await send(engine, run(1));
    expect(last(first)).toMatchObject({ type: "error", code: "runtime" });
    expect(fake.released).toBe(1); // the failed session is let go at once
    await send(engine, run(2));
    expect(fake.created).toHaveLength(2); // and the next request builds a new one
  });

  it("calls a GPU memory failure 'out-of-memory'", async () => {
    const fake = fakeOrt({ failRun: new Error("Failed to allocate GPU buffer: out of memory") });
    expect(last(await send(createEngine({ loadRuntime: async () => fake.ort }), run()))).toMatchObject({ type: "error", code: "out-of-memory" });
  });

  it("calls any other failure 'runtime' without leaking the technical text", async () => {
    const fake = fakeOrt({ failRun: new Error("Non-zero status code returned while running Conv node") });
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), run()));
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect((error as Extract<WorkerResponse, { type: "error" }>).message).not.toContain("Conv");
  });

  it("treats an answer without the expected output as a runtime error", async () => {
    const fake = fakeOrt();
    const answerless = {
      ...fake.ort,
      InferenceSession: {
        async create() {
          return {
            inputMetadata: [],
            async run() {
              return {};
            },
            async release() {},
          };
        },
      },
    } as unknown as OrtLike;
    expect(last(await send(createEngine({ loadRuntime: async () => answerless }), run()))).toMatchObject({ type: "error", code: "runtime" });
  });

  it("classifies a thrown value that is not an Error by its text", async () => {
    const fake = fakeOrt();
    const throwing = {
      ...fake.ort,
      InferenceSession: {
        async create() {
          return {
            inputMetadata: [],
            async run() {
              throw "GPU out of memory"; // some runtimes throw plain strings
            },
            async release() {},
          };
        },
      },
    } as unknown as OrtLike;
    expect(last(await send(createEngine({ loadRuntime: async () => throwing }), run()))).toMatchObject({ type: "error", code: "out-of-memory" });
  });

  it("passes the technical text along for bug reports, apart from the plain message", async () => {
    const fake = fakeOrt({ failRun: new Error("Non-zero status code returned while running Conv node. Name:'/conv'") });
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), run())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error.detail).toContain("Non-zero status code returned while running Conv node");
    expect(error.message).not.toContain("Non-zero");
  });

  it("keeps the technical text of a failure that was not an Error object", async () => {
    const failing = {
      InferenceSession: {
        async create() {
          throw "session creation failed: unsupported operator DeformConv";
        },
      },
      Tensor: FakeTensor,
    } as unknown as OrtLike;
    const error = last(await send(createEngine({ loadRuntime: async () => failing }), run())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error.detail).toBe("session creation failed: unsupported operator DeformConv");
  });

  it("calls a failure to load the runtime 'engine': that is not a failure of the model", async () => {
    const engine = createEngine({
      loadRuntime: async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
    });
    const error = last(await send(engine, run())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error.code).toBe("engine");
    expect(error.detail).toContain("Failed to fetch");
  });

  it("reports a failure before it cleans up, so a session that never lets go cannot hide the error", async () => {
    const fake = fakeOrt({ failRun: new Error("boom"), hangRelease: true });
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    const out: WorkerResponse[] = [];
    void engine.handle(run(), (message) => out.push(message));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(out.some((m) => m.type === "error")).toBe(true);
  });

  it("does not take an output made of NaN for 'no subject': the GPU computed nonsense", async () => {
    const fake = fakeOrt({ output: [NaN, NaN, NaN, NaN] });
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), run())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect(error.detail).toMatch(/NaN/);
  });

  it("puts up with a stray NaN but not with more than one value in a hundred", async () => {
    const wide: WorkerRequest = { id: 1, type: "run", model: { ...model(), io: { ...io, size: 10 } }, rgba: new Uint8ClampedArray(10 * 10 * 4) };
    const oneInAHundred = Array.from({ length: 100 }, (_, i) => (i === 7 ? NaN : 1));
    const twoInAHundred = Array.from({ length: 100 }, (_, i) => (i === 7 || i === 8 ? NaN : 1));
    const tolerated = fakeOrt({ output: oneInAHundred });
    expect(last(await send(createEngine({ loadRuntime: async () => tolerated.ort }), wide))).toMatchObject({ type: "done" });
    const refused = fakeOrt({ output: twoInAHundred });
    expect(last(await send(createEngine({ loadRuntime: async () => refused.ort }), wide))).toMatchObject({ type: "error", code: "runtime" });
  });

  it("tries to load the runtime again after it failed once", async () => {
    const fake = fakeOrt();
    let attempts = 0;
    const engine = createEngine({
      loadRuntime: async () => {
        if (++attempts === 1) throw new Error("network");
        return fake.ort;
      },
    });
    expect(last(await send(engine, run(1)))).toMatchObject({ type: "error", code: "engine" });
    expect(last(await send(engine, run(2)))).toMatchObject({ type: "done" });
  });

  it("works on one request at a time", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const fake = fakeOrt({ gate });
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    const first = send(engine, run(1));
    const second = send(engine, run(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.log).toEqual(["run:start"]); // the second request waits for the first
    open();
    await Promise.all([first, second]);
    expect(fake.log).toEqual(["run:start", "run:end", "run:start", "run:end"]);
  });

  it("warms up: loads the runtime and the session, runs nothing", async () => {
    const fake = fakeOrt();
    const messages = await send(createEngine({ loadRuntime: async () => fake.ort }), { id: 5, type: "warm", model: model() });
    expect(last(messages)).toEqual({ id: 5, type: "ready" });
    expect(fake.created).toHaveLength(1);
    expect(fake.fed).toHaveLength(0);
  });

  it("releases the session when disposed", async () => {
    const fake = fakeOrt();
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    await send(engine, run());
    await engine.dispose();
    expect(fake.released).toBe(1);
  });
});

/* ---------------- a model that makes pictures larger ---------------- */

const tileIo: ImageToImageIo = { kind: "image-to-image", input: "input", output: "output", scale: 2, tile: 16, halo: 2 };
const upscalerModel = (sha256 = "c".repeat(64)): WorkerModel => ({ id: "up", sha256, blob: new Blob([new Uint8Array([4, 5, 6])]), io: tileIo });
// a 2 x 2 tile: reds 0.0 0.25 / 0.5 0.75, greens 0.1 0.2 / 0.3 0.4, blues all 0.9
const tilePixels = () => Float32Array.from([0, 0.25, 0.5, 0.75, 0.1, 0.2, 0.3, 0.4, 0.9, 0.9, 0.9, 0.9]);
const tile = (id = 1, m = upscalerModel(), pixels = tilePixels()): WorkerRequest => ({ id, type: "tile", model: m, pixels, width: 2, height: 2 });

/** A stand-in whose "model" makes every pixel four (2 x 2) pixels: the nearest-neighbour picture twice as large. */
function fakeUpscaler(options: { half?: boolean; outputLength?: number; nan?: boolean; failRun?: Error; noOutput?: boolean } = {}) {
  const fed: Array<{ name: string; type: string; dims: readonly number[]; data: ArrayLike<number> }> = [];
  const created: number[] = [];
  const count = { released: 0, disposed: 0 };
  class Answer extends FakeTensor {
    override dispose() {
      count.disposed++;
    }
  }
  const session = {
    inputMetadata: [{ name: "input", isTensor: true, type: options.half ? "float16" : "float32", shape: ["batch", 3, "height", "width"] }],
    async run(feeds: Record<string, FakeTensor>) {
      const [name, tensor] = Object.entries(feeds)[0]!;
      fed.push({ name, type: tensor.type, dims: tensor.dims, data: tensor.data });
      if (options.failRun) throw options.failRun;
      if (options.noOutput) return {};
      const [, channels, h, w] = tensor.dims as number[] as [number, number, number, number];
      const out = options.half ? new Uint16Array(channels * h * 2 * w * 2) : new Float32Array(channels * h * 2 * w * 2);
      for (let c = 0; c < channels; c++) {
        for (let y = 0; y < h * 2; y++) for (let x = 0; x < w * 2; x++) out[(c * h * 2 + y) * w * 2 + x] = tensor.data[c * h * w + (y >> 1) * w + (x >> 1)]!;
      }
      if (options.nan) out[3] = NaN;
      return { output: new Answer(options.half ? "float16" : "float32", options.outputLength ? new Float32Array(options.outputLength) : out, [1, channels, h * 2, w * 2]) };
    },
    async release() {
      count.released++;
    },
  };
  const ort = {
    InferenceSession: {
      async create(bytes: Uint8Array) {
        created.push(bytes.length);
        return session;
      },
    },
    Tensor: FakeTensor,
  } as unknown as OrtLike;
  return { ort, fed, created, count };
}

describe("the engine with a model that makes pictures larger", () => {
  it("runs a tile and answers with the larger picture, reporting each step", async () => {
    const fake = fakeUpscaler();
    const messages = await send(createEngine({ loadRuntime: async () => fake.ort }), tile());
    expect(messages.map((m) => (m.type === "stage" ? m.stage : m.type))).toEqual(["runtime", "model", "inference", "tile-done"]);
    const done = last(messages) as Extract<WorkerResponse, { type: "tile-done" }>;
    expect(done.id).toBe(1);
    expect(done.pixels).toHaveLength(3 * 4 * 4);
    // the red plane of the answer, row by row: every pixel of the tile became a 2 x 2 block
    expect(Array.from(done.pixels.subarray(0, 16))).toEqual([0, 0, 0.25, 0.25, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 0.5, 0.5, 0.75, 0.75]);
    expect(fake.fed).toHaveLength(1);
    expect(fake.fed[0]).toMatchObject({ name: "input", type: "float32", dims: [1, 3, 2, 2] });
    expect(Array.from(fake.created)).toEqual([3]);
  });

  it("keeps the session for the next tile, and lets go of every answer", async () => {
    const fake = fakeUpscaler();
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    await send(engine, tile(1));
    await send(engine, tile(2));
    expect(fake.created).toHaveLength(1);
    expect(fake.fed).toHaveLength(2);
    expect(fake.count.disposed).toBe(2);
  });

  it("feeds half precision numbers to a model that wants them and reads half precision back", async () => {
    const fake = fakeUpscaler({ half: true });
    const done = last(await send(createEngine({ loadRuntime: async () => fake.ort }), tile())) as Extract<WorkerResponse, { type: "tile-done" }>;
    expect(fake.fed[0]).toMatchObject({ type: "float16" });
    expect(fake.fed[0]!.data).toBeInstanceOf(Uint16Array);
    expect(done.type).toBe("tile-done");
    expect(done.pixels[2]).toBeCloseTo(0.25, 3); // the fake hands the bits back; decoded they are the numbers that went in
    expect(done.pixels[8]).toBeCloseTo(0.5, 3);
  });

  it("rejects an answer of the wrong size as a runtime error, and lets go of it and of the session", async () => {
    const fake = fakeUpscaler({ outputLength: 5 });
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), tile())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect(error.detail).toContain("48");
    expect(fake.count.disposed).toBe(1);
    expect(fake.count.released).toBe(1);
  });

  it("does not take a single number that is not one for a picture: the graphics card computed nonsense", async () => {
    const fake = fakeUpscaler({ nan: true });
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), tile())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect(error.detail).toMatch(/NaN.*1 of 48/);
  });

  it("does not put up with one bad number among thousands either: it would be a black dot in the photograph", async () => {
    const fake = fakeUpscaler({ nan: true });
    const big: WorkerRequest = { id: 1, type: "tile", model: upscalerModel(), pixels: new Float32Array(3 * 10 * 10), width: 10, height: 10 };
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), big)) as Extract<WorkerResponse, { type: "error" }>;
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect(error.detail).toMatch(/NaN.*1 of 1200/); // a tenth of a percent: the mask path would let this through
  });

  it("treats an answer without the expected output as a runtime error", async () => {
    const fake = fakeUpscaler({ noOutput: true });
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), tile())) as Extract<WorkerResponse, { type: "error" }>;
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect(error.detail).toContain('"output"');
  });

  it("calls a GPU memory failure 'out-of-memory'", async () => {
    const fake = fakeUpscaler({ failRun: new Error("Failed to allocate GPU buffer: out of memory") });
    expect(last(await send(createEngine({ loadRuntime: async () => fake.ort }), tile()))).toMatchObject({ type: "error", code: "out-of-memory" });
  });

  it("refuses pixels that do not fit the width and height they come with", async () => {
    const fake = fakeUpscaler();
    const error = last(await send(createEngine({ loadRuntime: async () => fake.ort }), tile(1, upscalerModel(), new Float32Array(5)))) as Extract<
      WorkerResponse,
      { type: "error" }
    >;
    expect(error).toMatchObject({ type: "error", code: "runtime" });
    expect(error.detail).toContain("12");
    expect(fake.fed).toHaveLength(0);
  });

  it("refuses a tile for a model that makes masks, and a picture for a model that makes pictures", async () => {
    const fake = fakeUpscaler();
    const engine = createEngine({ loadRuntime: async () => fake.ort });
    expect(last(await send(engine, tile(1, model())))).toMatchObject({ type: "error", code: "runtime" });
    expect(last(await send(engine, run(2, upscalerModel())))).toMatchObject({ type: "error", code: "runtime" });
    expect(fake.fed).toHaveLength(0);
  });

  it("warms up like any other model: loads the session, runs nothing", async () => {
    const fake = fakeUpscaler();
    const messages = await send(createEngine({ loadRuntime: async () => fake.ort }), { id: 9, type: "warm", model: upscalerModel() });
    expect(last(messages)).toEqual({ id: 9, type: "ready" });
    expect(fake.created).toHaveLength(1);
    expect(fake.fed).toHaveLength(0);
  });
});

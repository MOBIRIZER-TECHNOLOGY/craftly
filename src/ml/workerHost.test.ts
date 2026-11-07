import { describe, expect, it } from "vitest";
import type { OrtLike, WorkerRequest, WorkerResponse } from "./engine";
import { bootWorker, type WorkerScope } from "./workerHost";

/** The worker's global scope as the host sees it. */
function fakeScope() {
  const posted: Array<{ message: WorkerResponse; transfer?: Transferable[] }> = [];
  const scope: WorkerScope = {
    onmessage: null,
    postMessage(message, transfer) {
      posted.push({ message, transfer });
    },
  };
  return { scope, posted };
}

// a runtime whose model returns the red plane of its input, like the engine tests' stand-in
class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: ArrayLike<number>,
    readonly dims: readonly number[],
  ) {}
  dispose() {}
}
const runtime = {
  InferenceSession: {
    async create() {
      return {
        inputMetadata: [],
        async run(feeds: Record<string, FakeTensor>) {
          const input = Object.values(feeds)[0]!;
          return { out: new FakeTensor("float32", Array.from(input.data).slice(0, 4), [1, 1, 2, 2]) };
        },
        async release() {},
      };
    },
  },
  Tensor: FakeTensor,
} as unknown as OrtLike;

const request: WorkerRequest = {
  id: 7,
  type: "run",
  model: {
    id: "m",
    sha256: "a".repeat(64),
    blob: new Blob(["x"]),
    io: { kind: "image-to-mask", input: "i", output: "out", size: 2, mean: [0, 0, 0], std: [1, 1, 1], activation: "none" },
  },
  rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]),
};

describe("bootWorker", () => {
  it("answers each request through the scope, handing the mask back instead of copying it", async () => {
    const { scope, posted } = fakeScope();
    bootWorker(scope, async () => runtime);
    scope.onmessage!({ data: request });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const done = posted.find((p) => p.message.type === "done")!;
    expect(done.message).toMatchObject({ id: 7, type: "done" });
    const mask = (done.message as Extract<WorkerResponse, { type: "done" }>).mask;
    expect(Array.from(mask)).toEqual([255, 0, 255, 0]);
    expect(done.transfer).toEqual([mask.buffer]);
  });

  it("answers an engine failure with an error message instead of staying silent", async () => {
    const { scope, posted } = fakeScope();
    bootWorker(scope, async () => {
      throw new Error("could not load");
    });
    scope.onmessage!({ data: request });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted[posted.length - 1]!.message).toMatchObject({ id: 7, type: "error", code: "engine" });
  });
});

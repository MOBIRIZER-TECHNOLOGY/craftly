import { afterEach, describe, expect, it, vi } from "vitest";
import { createMlClient, type WorkerLike } from "./client";
import type { WorkerModel, WorkerRequest, WorkerResponse } from "./engine";
import { MlError } from "./errors";
import type { MlStage } from "./types";

class FakeWorker implements WorkerLike {
  sent: Array<{ message: WorkerRequest; transfer?: Transferable[] }> = [];
  terminated = false;
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  onmessageerror: WorkerLike["onmessageerror"] = null;
  postMessage(message: unknown, transfer?: Transferable[]) {
    this.sent.push({ message: message as WorkerRequest, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: WorkerResponse) {
    this.onmessage?.({ data });
  }
}

function setup(idleMs?: number) {
  const workers: FakeWorker[] = [];
  const client = createMlClient({
    idleMs,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { client, workers };
}

const model: WorkerModel = {
  id: "m",
  sha256: "a".repeat(64),
  blob: new Blob(["x"]),
  io: { kind: "image-to-mask", input: "i", output: "o", size: 2, mean: [0, 0, 0], std: [1, 1, 1], activation: "none" },
};
const args = () => ({ model, rgba: new Uint8ClampedArray(16) });
const idOf = (worker: FakeWorker, index = 0) => worker.sent[index]!.message.id;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MlError);
    return (error as MlError).code;
  }
  throw new Error("expected the promise to reject");
}

afterEach(() => vi.useRealTimers());

describe("the ML client", () => {
  it("does not start a worker until it is needed, then keeps using the same one", async () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    const first = client.run(args());
    expect(workers).toHaveLength(1);
    workers[0]!.reply({ id: idOf(workers[0]!), type: "done", mask: new Uint8ClampedArray(4) });
    await first;
    const second = client.run(args());
    workers[0]!.reply({ id: idOf(workers[0]!, 1), type: "done", mask: new Uint8ClampedArray(4) });
    await second;
    expect(workers).toHaveLength(1);
  });

  it("sends the model and the pixels, handing the pixel buffer over instead of copying it", () => {
    const { client, workers } = setup();
    const input = args();
    void client.run(input).catch(() => undefined);
    const { message, transfer } = workers[0]!.sent[0]!;
    expect(message).toMatchObject({ type: "run", model });
    expect(transfer).toEqual([input.rgba.buffer]);
  });

  it("passes each step to the caller and resolves with the mask", async () => {
    const { client, workers } = setup();
    const stages: MlStage[] = [];
    const promise = client.run(args(), { onStage: (stage) => stages.push(stage) });
    const id = idOf(workers[0]!);
    workers[0]!.reply({ id, type: "stage", stage: "runtime" });
    workers[0]!.reply({ id, type: "stage", stage: "inference" });
    workers[0]!.reply({ id, type: "done", mask: new Uint8ClampedArray([1, 2, 3, 4]) });
    expect(Array.from(await promise)).toEqual([1, 2, 3, 4]);
    expect(stages).toEqual(["runtime", "inference"]);
  });

  it("fails with the worker's code, put in words by the page (the worker sends no words)", async () => {
    const { client, workers } = setup();
    const promise = client.run(args());
    workers[0]!.reply({ id: idOf(workers[0]!), type: "error", code: "out-of-memory" });
    await expect(promise).rejects.toMatchObject({ code: "out-of-memory", message: "This device ran out of graphics memory. Close other tabs and try again." });
  });

  it("keeps the technical text as the cause, so a bug report can say why", async () => {
    const { client, workers } = setup();
    const promise = client.run(args());
    workers[0]!.reply({ id: idOf(workers[0]!), type: "error", code: "runtime", detail: "Error: shader-f16 is not supported" });
    await expect(promise).rejects.toMatchObject({ code: "runtime", message: "The model could not run on this device.", cause: "Error: shader-f16 is not supported" });
  });

  it.each(["runtime", "out-of-memory", "engine"] as const)("ends the worker after a '%s' failure: the runtime keeps its own failure and would repeat it", async (code) => {
    const { client, workers } = setup();
    const failed = client.run(args());
    workers[0]!.reply({ id: idOf(workers[0]!), type: "error", code });
    expect(await codeOf(failed)).toBe(code);
    expect(workers[0]!.terminated).toBe(true);
    void client.run(args()).catch(() => undefined);
    expect(workers).toHaveLength(2); // the next job starts a clean worker
  });

  it("ignores an answer that belongs to an earlier request", async () => {
    const { client, workers } = setup();
    const promise = client.run(args());
    const id = idOf(workers[0]!);
    workers[0]!.reply({ id: id + 100, type: "done", mask: new Uint8ClampedArray([9]) });
    let settled = false;
    void promise.then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    workers[0]!.reply({ id, type: "done", mask: new Uint8ClampedArray([1]) });
    expect(Array.from(await promise)).toEqual([1]);
  });

  it("stops a running job by ending the worker, and starts a fresh worker next time", async () => {
    const { client, workers } = setup();
    const abort = new AbortController();
    const promise = client.run(args(), { signal: abort.signal });
    abort.abort();
    expect(await codeOf(promise)).toBe("aborted");
    expect(workers[0]!.terminated).toBe(true);
    void client.run(args()).catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it("does nothing at all when the signal is already aborted", async () => {
    const { client, workers } = setup();
    expect(await codeOf(client.run(args(), { signal: AbortSignal.abort() }))).toBe("aborted");
    expect(workers).toHaveLength(0);
  });

  it("turns a crashing worker into an error and replaces it", async () => {
    const { client, workers } = setup();
    const promise = client.run(args());
    workers[0]!.onerror?.({ message: "boom" });
    expect(await codeOf(promise)).toBe("worker-crashed");
    expect(workers[0]!.terminated).toBe(true);
    void client.run(args()).catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it("says 'unsupported' when a worker cannot be made at all", async () => {
    const client = createMlClient({
      createWorker: () => {
        throw new Error("no module workers");
      },
    });
    expect(await codeOf(client.run(args()))).toBe("unsupported");
  });

  it("refuses a second job while one is running and leaves the first alone", async () => {
    const { client, workers } = setup();
    const first = client.run(args());
    expect(await codeOf(client.run(args()))).toBe("busy");
    workers[0]!.reply({ id: idOf(workers[0]!), type: "done", mask: new Uint8ClampedArray([7]) });
    expect(Array.from(await first)).toEqual([7]);
  });

  it("ends an idle worker after the idle time, and never in the middle of a job", async () => {
    vi.useFakeTimers();
    const { client, workers } = setup(1000);
    const promise = client.run(args());
    vi.advanceTimersByTime(5000); // a long inference must not be cut short
    expect(workers[0]!.terminated).toBe(false);
    workers[0]!.reply({ id: idOf(workers[0]!), type: "done", mask: new Uint8ClampedArray(1) });
    await promise;
    vi.advanceTimersByTime(999);
    expect(workers[0]!.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(workers[0]!.terminated).toBe(true);
    void client.run(args()).catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it("warms the model up without a picture", async () => {
    const { client, workers } = setup();
    const promise = client.warm(model);
    expect(workers[0]!.sent[0]!.message).toMatchObject({ type: "warm", model });
    workers[0]!.reply({ id: idOf(workers[0]!), type: "ready" });
    await expect(promise).resolves.toBeUndefined();
  });

  it("lets go of everything on release", async () => {
    const { client, workers } = setup();
    const promise = client.run(args());
    client.release();
    expect(await codeOf(promise)).toBe("aborted");
    expect(workers[0]!.terminated).toBe(true);
  });
});

describe("a request the browser refuses to send", () => {
  it("fails that job with a plain error and leaves the client free for the next one", async () => {
    const { client, workers } = setup();
    const refusing = { once: true };
    const create = () => {
      const worker = workers[0]!;
      const send = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => {
        if (refusing.once) {
          refusing.once = false;
          throw new DOMException("could not be cloned", "DataCloneError");
        }
        send(message, transfer);
      };
      return worker;
    };
    // the first call creates the worker; make its first send fail
    const firstCall = client.run(args());
    const worker = create();
    // (the call above already tried to send before the patch, so ask again to exercise the refusal)
    worker.reply({ id: idOf(worker, 0), type: "done", mask: new Uint8ClampedArray(1) });
    await firstCall;

    const refused = client.run(args());
    expect(await codeOf(refused)).toBe("runtime");
    const next = client.run(args()); // not "busy": the refused job let go
    worker.reply({ id: idOf(worker, 1), type: "done", mask: new Uint8ClampedArray([5]) });
    expect(Array.from(await next)).toEqual([5]);
  });
});

describe("tiles for a model that makes pictures larger", () => {
  const upscaler: WorkerModel = {
    id: "up",
    sha256: "b".repeat(64),
    blob: new Blob(["y"]),
    io: { kind: "image-to-image", input: "input", output: "output", scale: 2, tile: 16, halo: 2 },
  };
  const tileArgs = () => ({ model: upscaler, pixels: new Float32Array(12), width: 2, height: 2 });

  it("sends the tile, handing the numbers over instead of copying them, and resolves with the larger picture", async () => {
    const { client, workers } = setup();
    const input = tileArgs();
    const promise = client.tile(input);
    const { message, transfer } = workers[0]!.sent[0]!;
    expect(message).toMatchObject({ type: "tile", model: upscaler, width: 2, height: 2 });
    expect(transfer).toEqual([input.pixels.buffer]);
    workers[0]!.reply({ id: idOf(workers[0]!), type: "tile-done", pixels: Float32Array.from([0.5, 1]) });
    expect(Array.from(await promise)).toEqual([0.5, 1]);
  });

  it("passes the steps of a tile to the caller", async () => {
    const { client, workers } = setup();
    const stages: MlStage[] = [];
    const promise = client.tile(tileArgs(), { onStage: (stage) => stages.push(stage) });
    const id = idOf(workers[0]!);
    workers[0]!.reply({ id, type: "stage", stage: "model" });
    workers[0]!.reply({ id, type: "stage", stage: "inference" });
    workers[0]!.reply({ id, type: "tile-done", pixels: new Float32Array(1) });
    await promise;
    expect(stages).toEqual(["model", "inference"]);
  });

  it("runs one tile after another on the same worker, one at a time", async () => {
    const { client, workers } = setup();
    const first = client.tile(tileArgs());
    expect(await codeOf(client.tile(tileArgs()))).toBe("busy");
    workers[0]!.reply({ id: idOf(workers[0]!, 0), type: "tile-done", pixels: new Float32Array(1) });
    await first;
    const second = client.tile(tileArgs());
    workers[0]!.reply({ id: idOf(workers[0]!, 1), type: "tile-done", pixels: new Float32Array(1) });
    await second;
    expect(workers).toHaveLength(1);
  });

  it("fails a tile with the worker's code, put in words by the page", async () => {
    const { client, workers } = setup();
    const promise = client.tile(tileArgs());
    workers[0]!.reply({ id: idOf(workers[0]!), type: "error", code: "out-of-memory", detail: "buffer too large" });
    await expect(promise).rejects.toMatchObject({
      code: "out-of-memory",
      message: "This device ran out of graphics memory. Close other tabs and try again.",
      cause: "buffer too large",
    });
    expect(workers[0]!.terminated).toBe(true);
  });

  it("ends the worker when the caller gives up in the middle of a tile", async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    const promise = client.tile(tileArgs(), { signal: controller.signal });
    controller.abort();
    expect(await codeOf(promise)).toBe("aborted");
    expect(workers[0]!.terminated).toBe(true);
  });
});

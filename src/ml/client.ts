/**
 * The page's end of the worker: starts it on first use, hands it one job at a time, and ends it when the person cancels
 * (the only way to stop a running inference), when it crashes, or after it has been idle for a while (to free GPU memory).
 */
import type { WorkerModel, WorkerRequest, WorkerResponse } from "./engine";
import { MlError, type MlErrorCode } from "./errors";
import type { MlStage } from "./types";

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

export interface CallOptions {
  signal?: AbortSignal;
  onStage?: (stage: MlStage) => void;
}

export interface MlClient {
  /** Runs the model on io.size x io.size RGBA pixels. The pixel buffer is handed to the worker: do not use it afterwards. */
  run(args: { model: WorkerModel; rgba: Uint8ClampedArray }, options?: CallOptions): Promise<Uint8ClampedArray>;
  /**
   * Makes one tile larger: `pixels` is planar RGB from 0 to 1 (3 x width x height numbers), the answer the same, io.scale
   * times larger on each side. The buffer is handed to the worker: do not use it afterwards.
   */
  tile(args: { model: WorkerModel; pixels: Float32Array; width: number; height: number }, options?: CallOptions): Promise<Float32Array>;
  /** Loads the runtime and the model so the first real run is quick, and so the runtime file is cached for offline use. */
  warm(model: WorkerModel, options?: CallOptions): Promise<void>;
  /** Ends the worker now, failing a running job with `aborted`. */
  release(): void;
}

export interface MlClientOptions {
  createWorker?: () => WorkerLike;
  /** how long an unused worker (and the model on the GPU) is kept */
  idleMs?: number;
}

const IDLE_MS = 5 * 60_000;

/** Failures after which the worker is ended instead of reused. */
const RESTART_AFTER: ReadonlySet<MlErrorCode> = new Set(["runtime", "out-of-memory", "engine"]);

const defaultWorker = (): WorkerLike => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

interface Pending {
  id: number;
  onStage?: (stage: MlStage) => void;
  resolve(value: unknown): void;
  reject(error: MlError): void;
}

export function createMlClient(options: MlClientOptions = {}): MlClient {
  const { createWorker = defaultWorker, idleMs = IDLE_MS } = options;
  let worker: WorkerLike | null = null;
  let pending: Pending | null = null;
  let sequence = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;

  function stop(error?: MlError): void {
    clearTimeout(idle);
    const old = worker;
    worker = null;
    old?.terminate();
    const waiting = pending;
    pending = null;
    waiting?.reject(error ?? new MlError("aborted"));
  }

  const scheduleIdle = () => {
    clearTimeout(idle);
    if (worker && !pending) idle = setTimeout(() => stop(), idleMs);
  };

  function onMessage(message: WorkerResponse): void {
    const waiting = pending;
    if (!waiting || waiting.id !== message.id) return; // an answer to a job that was already given up
    if (message.type === "stage") {
      waiting.onStage?.(message.stage);
      return;
    }
    pending = null;
    if (message.type === "done") waiting.resolve(message.mask);
    else if (message.type === "tile-done") waiting.resolve(message.pixels);
    else if (message.type === "ready") waiting.resolve(undefined);
    else {
      waiting.reject(new MlError(message.code, message.message, { cause: message.detail }));
      // The runtime remembers a failed start (a file that did not arrive, a lost graphics device) and repeats it for
      // every later request. A fresh worker is the only way to try again.
      if (RESTART_AFTER.has(message.code)) {
        stop();
        return;
      }
    }
    scheduleIdle();
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    let created: WorkerLike;
    try {
      created = createWorker();
    } catch (error) {
      throw new MlError("unsupported", undefined, { cause: error });
    }
    const crashed = (event: unknown) => {
      if (worker === created) stop(new MlError("worker-crashed", undefined, { cause: event }));
    };
    created.onmessage = (event) => onMessage(event.data);
    created.onerror = crashed;
    created.onmessageerror = crashed;
    worker = created;
    return created;
  }

  function call<T>(make: (id: number) => WorkerRequest, transfer: Transferable[], callOptions: CallOptions = {}): Promise<T> {
    const { signal, onStage } = callOptions;
    if (signal?.aborted) return Promise.reject(new MlError("aborted"));
    if (pending) return Promise.reject(new MlError("busy"));
    let target: WorkerLike;
    try {
      target = ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    clearTimeout(idle);
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => stop(new MlError("aborted"));
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      pending = {
        id,
        onStage,
        resolve: (value) => {
          cleanup();
          resolve(value as T);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        target.postMessage(make(id), transfer);
      } catch (error) {
        const waiting = pending;
        pending = null;
        waiting?.reject(new MlError("runtime", undefined, { cause: error }));
        scheduleIdle();
      }
    });
  }

  return {
    run: (args, callOptions) => call<Uint8ClampedArray>((id) => ({ id, type: "run", model: args.model, rgba: args.rgba }), [args.rgba.buffer as ArrayBuffer], callOptions),
    tile: (args, callOptions) =>
      call<Float32Array>(
        (id) => ({ id, type: "tile", model: args.model, pixels: args.pixels, width: args.width, height: args.height }),
        [args.pixels.buffer as ArrayBuffer],
        callOptions,
      ),
    warm: (model, callOptions) => call<void>((id) => ({ id, type: "warm", model }), [], callOptions),
    release: () => stop(),
  };
}

let shared: MlClient | undefined;
/** The client the app uses. Nothing starts until the first job. */
export const sharedClient = (): MlClient => (shared ??= createMlClient());

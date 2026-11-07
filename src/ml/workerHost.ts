/** Connects the engine to the worker's global scope. Kept apart from `worker.ts` so the wiring can be tested without a worker. */
import { createEngine, type Engine, type OrtLike, type WorkerRequest, type WorkerResponse } from "./engine";

export interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

export function bootWorker(scope: WorkerScope, loadRuntime: () => Promise<OrtLike>): Engine {
  const engine = createEngine({ loadRuntime });
  scope.onmessage = (event) => {
    void engine.handle(event.data, (message, transfer) => scope.postMessage(message, transfer));
  };
  return engine;
}

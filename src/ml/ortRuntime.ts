/**
 * Loads onnxruntime-web (WebGPU build) inside the worker. The 28.7 MB WebAssembly file is a separate build output that
 * the page fetches on first use and the service worker keeps (it is not part of the first-visit download). Checked in a
 * real browser by e2e/ml.cjs, not by unit tests: it needs the real runtime.
 */
import wasmFile from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import type { OrtLike } from "./engine";

export async function loadOrt(): Promise<OrtLike> {
  const ort = await import("onnxruntime-web/webgpu");
  // an absolute address: the runtime resolves a relative one against its own script, which lives in another folder
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmFile, self.location.href).href };
  // more than one thread needs cross-origin isolation, which a static host does not provide; the GPU does the work anyway
  ort.env.wasm.numThreads = 1;
  return ort;
}

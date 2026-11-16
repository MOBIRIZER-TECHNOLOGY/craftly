/** Can this browser run the on-device models? Cheap checks first, so the graphics card is only woken when it matters. */
import { m } from "@/i18n";

export interface DeviceEnv {
  gpu?: { requestAdapter(): Promise<{ features?: ReadonlySet<string> } | null | undefined> };
  hasWorker: boolean;
  hasIndexedDb: boolean;
}

export type Support = { ok: true } | { ok: false; reason: "no-workers" | "no-storage" | "no-webgpu" | "no-adapter" | "missing-feature"; message: string };

export function browserEnv(): DeviceEnv {
  return {
    gpu: typeof navigator === "undefined" ? undefined : (navigator as Navigator & { gpu?: DeviceEnv["gpu"] }).gpu,
    hasWorker: typeof Worker !== "undefined",
    hasIndexedDb: typeof indexedDB !== "undefined",
  };
}

const no = (reason: Extract<Support, { ok: false }>["reason"], message: string): Support => ({ ok: false, reason, message });

const FEATURE_WORDS: Record<string, string> = { "shader-f16": m.ml.support.halfPrecision };

/** `needs` lists WebGPU features the model's file requires of the graphics card. */
export async function checkSupport(env: DeviceEnv = browserEnv(), needs: readonly string[] = []): Promise<Support> {
  const words = m.ml.support;
  if (!env.hasWorker) return no("no-workers", words.noWorkers);
  if (!env.hasIndexedDb) return no("no-storage", words.noStorage);
  if (!env.gpu) return no("no-webgpu", words.noWebgpu);
  try {
    const adapter = await env.gpu.requestAdapter();
    if (adapter) {
      const missing = needs.filter((feature) => !adapter.features?.has(feature));
      if (!missing.length) return { ok: true };
      return no("missing-feature", words.missingFeature(missing.map((feature) => FEATURE_WORDS[feature] ?? feature)));
    }
  } catch {
    /* handled below: a blocked request is the same as no adapter */
  }
  return no("no-adapter", words.noAdapter);
}

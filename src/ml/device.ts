/** Can this browser run the on-device models? Cheap checks first, so the graphics card is only woken when it matters. */

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

const FEATURE_WORDS: Record<string, string> = { "shader-f16": "half-precision maths" };

/** `needs` lists WebGPU features the model's file requires of the graphics card. */
export async function checkSupport(env: DeviceEnv = browserEnv(), needs: readonly string[] = []): Promise<Support> {
  if (!env.hasWorker) return no("no-workers", "This browser can't run background tasks, which the model needs.");
  if (!env.hasIndexedDb) return no("no-storage", "This browser has no storage for the model. Private windows often block it.");
  if (!env.gpu) {
    return no("no-webgpu", "This browser doesn't support WebGPU, which the model needs. Try Chrome or Edge 113 or newer, Safari 26 or newer, or Firefox 141 or newer on Windows.");
  }
  try {
    const adapter = await env.gpu.requestAdapter();
    if (adapter) {
      const missing = needs.filter((feature) => !adapter.features?.has(feature));
      if (!missing.length) return { ok: true };
      const words = missing.map((feature) => FEATURE_WORDS[feature] ?? feature).join(" and ");
      return no("missing-feature", `This graphics card can't do ${words}, which the model needs. A newer graphics card or another browser may help.`);
    }
  } catch {
    /* handled below: a blocked request is the same as no adapter */
  }
  return no("no-adapter", "WebGPU is available, but the browser found no graphics card to use. Check that hardware acceleration is switched on.");
}

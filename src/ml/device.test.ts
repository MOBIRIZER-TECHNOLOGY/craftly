import { describe, expect, it, vi } from "vitest";
import { checkSupport, type DeviceEnv } from "./device";

const withFeatures = (...features: string[]): DeviceEnv => ({
  ...({ gpu: { requestAdapter: async () => ({ features: new Set(features) }) }, hasWorker: true, hasIndexedDb: true } as DeviceEnv),
});

const adapter = async () => ({});
const working: DeviceEnv = { gpu: { requestAdapter: adapter }, hasWorker: true, hasIndexedDb: true };

describe("checkSupport", () => {
  it("accepts a browser with workers, storage and a graphics adapter", async () => {
    expect(await checkSupport(working)).toEqual({ ok: true });
  });

  it("explains a browser without WebGPU, and names browsers that have it", async () => {
    const result = await checkSupport({ ...working, gpu: undefined });
    expect(result).toMatchObject({ ok: false, reason: "no-webgpu" });
    expect(result.ok === false && result.message).toMatch(/WebGPU.*Chrome/s);
  });

  it("tells a missing adapter (blocked GPU, remote desktop) from a missing API", async () => {
    expect(await checkSupport({ ...working, gpu: { requestAdapter: async () => null } })).toMatchObject({ ok: false, reason: "no-adapter" });
  });

  it("treats a failing adapter request as no adapter instead of throwing", async () => {
    const gpu = {
      requestAdapter: async () => {
        throw new Error("blocked");
      },
    };
    expect(await checkSupport({ ...working, gpu })).toMatchObject({ ok: false, reason: "no-adapter" });
  });

  it("needs a worker and somewhere to keep the model", async () => {
    expect(await checkSupport({ ...working, hasWorker: false })).toMatchObject({ ok: false, reason: "no-workers" });
    expect(await checkSupport({ ...working, hasIndexedDb: false })).toMatchObject({ ok: false, reason: "no-storage" });
  });

  it("accepts a graphics card that has the feature the model needs", async () => {
    expect(await checkSupport(withFeatures("shader-f16", "subgroups"), ["shader-f16"])).toEqual({ ok: true });
  });

  it("explains a graphics card that lacks it, naming the feature", async () => {
    const result = await checkSupport(withFeatures("subgroups"), ["shader-f16"]);
    expect(result).toMatchObject({ ok: false, reason: "missing-feature" });
    expect(result.ok === false && result.message).toMatch(/half-precision/);
  });

  it("asks for nothing extra when the model needs nothing", async () => {
    expect(await checkSupport(withFeatures(), [])).toEqual({ ok: true });
  });

  it("does not wake the graphics card when something cheaper already rules the browser out", async () => {
    const requestAdapter = vi.fn(adapter);
    await checkSupport({ gpu: { requestAdapter }, hasWorker: false, hasIndexedDb: true });
    expect(requestAdapter).not.toHaveBeenCalled();
  });
});

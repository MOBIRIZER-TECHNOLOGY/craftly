import { describe, expect, it } from "vitest";
import { modelStatus, type MlState } from "./state";
import { getModelSpec } from "./registry";

const spec = getModelSpec("isnet-general")!;
const base: MlState = { loaded: true, installed: {}, installing: {}, job: null, storage: {} };
const record = (sha256: string) => ({ id: spec.id, sha256, bytes: spec.bytes, revision: spec.revision, installedAt: 1 });

describe("modelStatus", () => {
  it("does not claim anything before the store has answered", () => {
    expect(modelStatus(spec, { ...base, loaded: false })).toBe("unknown");
  });

  it("is 'missing' when nothing is stored", () => {
    expect(modelStatus(spec, base)).toBe("missing");
  });

  it("is 'ready' when the stored copy is the pinned file", () => {
    expect(modelStatus(spec, { ...base, installed: { [spec.id]: record(spec.sha256) } })).toBe("ready");
  });

  it("is 'outdated' when the registry pins a different file than the stored one", () => {
    expect(modelStatus(spec, { ...base, installed: { [spec.id]: record("0".repeat(64)) } })).toBe("outdated");
  });

  it("is 'installing' while a download runs, whatever is stored", () => {
    const installing = { [spec.id]: { phase: "downloading" as const, received: 1, total: 2, cancel: () => undefined } };
    expect(modelStatus(spec, { ...base, installing, installed: { [spec.id]: record(spec.sha256) } })).toBe("installing");
    expect(modelStatus(spec, { ...base, installing, loaded: false })).toBe("installing");
  });
});

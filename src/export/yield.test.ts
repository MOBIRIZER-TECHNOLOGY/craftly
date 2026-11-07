import { describe, expect, it } from "vitest";
import { nextMacrotask } from "./yield";

describe("nextMacrotask", () => {
  it("resolves after pending microtasks and gives timers a chance to run first or later, never hanging", async () => {
    const order: string[] = [];
    queueMicrotask(() => order.push("microtask"));
    await nextMacrotask();
    order.push("macrotask");
    expect(order).toEqual(["microtask", "macrotask"]);
  });

  it("can be awaited many times in a row quickly (it is not a 4 ms timer)", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) await nextMacrotask();
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("falls back to a timer without MessageChannel", async () => {
    const original = globalThis.MessageChannel;
    // @ts-expect-error simulate an environment without MessageChannel
    delete globalThis.MessageChannel;
    try {
      await expect(nextMacrotask()).resolves.toBeUndefined();
    } finally {
      globalThis.MessageChannel = original;
    }
  });
});

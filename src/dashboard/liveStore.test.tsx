import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createLiveStore, useLive } from "./liveStore";

/** A load function the test settles by hand. */
function controlledLoad<T>() {
  const pending: Array<{ resolve: (value: T) => void; reject: (reason: unknown) => void }> = [];
  const load = vi.fn(
    () =>
      new Promise<T>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { load, pending };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLiveStore", () => {
  it("starts with the initial value, not ready, and does not load until someone listens", () => {
    const load = vi.fn(async () => ["loaded"]);
    const store = createLiveStore<string[]>([], load, []);
    expect(store.getSnapshot()).toEqual({ value: [], ready: false, error: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads when the first listener arrives and tells the listeners", async () => {
    const load = vi.fn(async () => ["loaded"]);
    const store = createLiveStore<string[]>([], load, []);
    const listener = vi.fn();
    store.subscribe(listener);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({ value: ["loaded"], ready: true, error: null });
  });

  it("loads once for several listeners and keeps the data when they leave and come back", async () => {
    const load = vi.fn(async () => ["loaded"]);
    const store = createLiveStore<string[]>([], load, []);
    const first = store.subscribe(() => undefined);
    const second = store.subscribe(() => undefined);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    first();
    second();
    expect(store.getSnapshot().value).toEqual(["loaded"]);
    store.subscribe(() => undefined);
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().ready).toBe(true);
  });

  it("attaches to its sources with the first listener and detaches with the last", async () => {
    const detach = vi.fn();
    const source = vi.fn(() => detach);
    const store = createLiveStore<number>(0, async () => 1, [source]);
    const first = store.subscribe(() => undefined);
    const second = store.subscribe(() => undefined);
    expect(source).toHaveBeenCalledTimes(1);
    first();
    expect(detach).not.toHaveBeenCalled();
    second();
    expect(detach).toHaveBeenCalledTimes(1);
    await tick();
  });

  it("reloads whenever a source announces a change", async () => {
    let announce: () => void = () => undefined;
    let counter = 0;
    const store = createLiveStore<number>(0, async () => ++counter, [
      (callback) => {
        announce = callback;
        return () => undefined;
      },
    ]);
    store.subscribe(() => undefined);
    await tick();
    expect(store.getSnapshot().value).toBe(1);
    announce();
    await tick();
    expect(store.getSnapshot().value).toBe(2);
  });

  it("reloads on demand", async () => {
    let counter = 0;
    const store = createLiveStore<number>(0, async () => ++counter, []);
    store.subscribe(() => undefined);
    await tick();
    store.reload();
    await tick();
    expect(store.getSnapshot().value).toBe(2);
  });

  it("keeps the last value and reports the message when a load fails, and recovers on the next success", async () => {
    let fail = true;
    const store = createLiveStore<string>(
      "start",
      async () => {
        if (fail) throw new Error("disk is gone");
        return "back";
      },
      [],
    );
    store.subscribe(() => undefined);
    await tick();
    expect(store.getSnapshot()).toEqual({ value: "start", ready: true, error: "disk is gone" });
    fail = false;
    store.reload();
    await tick();
    expect(store.getSnapshot()).toEqual({ value: "back", ready: true, error: null });
  });

  it("reports a failure that is not an Error as text", async () => {
    const store = createLiveStore<string>("x", () => Promise.reject("plain text"), []);
    store.subscribe(() => undefined);
    await tick();
    expect(store.getSnapshot().error).toBe("plain text");
  });

  it("never runs two loads at once: changes during a load cause exactly one more load afterwards", async () => {
    const { load, pending } = controlledLoad<string>();
    let announce: () => void = () => undefined;
    const store = createLiveStore<string>("", load, [
      (callback) => {
        announce = callback;
        return () => undefined;
      },
    ]);
    store.subscribe(() => undefined);
    expect(load).toHaveBeenCalledTimes(1);
    announce();
    announce();
    announce();
    expect(load).toHaveBeenCalledTimes(1);
    pending[0].resolve("first");
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().value).toBe("first");
    pending[1].resolve("second");
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().value).toBe("second");
  });

  it("can load again after a failed load", async () => {
    const { load, pending } = controlledLoad<number>();
    const store = createLiveStore<number>(0, load, []);
    store.subscribe(() => undefined);
    pending[0].reject(new Error("nope"));
    await tick();
    store.reload();
    expect(load).toHaveBeenCalledTimes(2);
    pending[1].resolve(7);
    await tick();
    expect(store.getSnapshot()).toEqual({ value: 7, ready: true, error: null });
  });
});

describe("useLive", () => {
  it("gives a component the snapshot and re-renders when it changes", async () => {
    let counter = 0;
    const store = createLiveStore<number>(0, async () => ++counter, []);
    const { result, unmount } = renderHook(() => useLive(store));
    expect(result.current).toEqual({ value: 0, ready: false, error: null });
    await act(async () => {
      await tick();
    });
    expect(result.current).toEqual({ value: 1, ready: true, error: null });
    await act(async () => {
      store.reload();
      await tick();
    });
    expect(result.current.value).toBe(2);
    unmount();
  });
});

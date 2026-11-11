import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadModel, forgetPartialDownloads, MAX_RESUMES, sha256Hex, verifyModelBlob } from "./download";
import { MlError } from "./errors";
import { getModelSpec } from "./registry";
import type { ModelSpec } from "./types";

const DATA = Uint8Array.from({ length: 40 }, (_, i) => (i * 7 + 3) % 256);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const spec: ModelSpec = { ...getModelSpec("isnet-general")!, bytes: DATA.length, sha256: sha(DATA) };

/** A response body that arrives `step` bytes at a time. `state.cancelled` flips when the reader gives up on it. */
function body(bytes: Uint8Array, options: { step?: number; failAfter?: number; signal?: AbortSignal } = {}) {
  const { step = 8, failAfter, signal } = options;
  const state = { cancelled: false };
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")));
    },
    pull(controller) {
      if (failAfter !== undefined && at >= failAfter) {
        controller.error(new TypeError("network error"));
        return;
      }
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + step));
      at += step;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

const ok = (stream: ReadableStream<Uint8Array>) => new Response(stream, { status: 200 });

async function failureOf(promise: Promise<unknown>): Promise<MlError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MlError);
    return error as MlError;
  }
  throw new Error("expected the promise to reject");
}

// what a download kept of a file that did not arrive whole is forgotten between the tests
beforeEach(() => forgetPartialDownloads());

describe("downloadModel", () => {
  it("returns exactly the bytes and reports progress against the pinned size", async () => {
    const fetchImpl = vi.fn(async () => ok(body(DATA).stream));
    const progress: Array<[number, number]> = [];
    const blob = await downloadModel(spec, { fetchImpl, onProgress: (received, total) => progress.push([received, total]) });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(DATA);
    expect(progress).toEqual([
      [8, 40],
      [16, 40],
      [24, 40],
      [32, 40],
      [40, 40],
    ]);
  });

  it("asks for the pinned file and sends neither cookies nor a referrer", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => ok(body(DATA).stream));
    await downloadModel(spec, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://huggingface.co/Ko033/isnet-general-use-onnx/resolve/5349b617911fd60c619b52f32e2b593517b78df3/onnx/model_fp16.onnx");
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("calls an HTTP error 'http'", async () => {
    const fetchImpl = async () => new Response("missing", { status: 404 });
    expect((await failureOf(downloadModel(spec, { fetchImpl }))).code).toBe("http");
  });

  it("calls a connection that breaks part-way 'network'", async () => {
    const { stream } = body(DATA, { failAfter: 16 });
    expect((await failureOf(downloadModel(spec, { fetchImpl: async () => ok(stream), retryDelayMs: 0 }))).code).toBe("network");
  });

  it("tells being offline from a failing network", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await failureOf(downloadModel(spec, { fetchImpl, isOnline: () => false }))).code).toBe("offline");
    expect((await failureOf(downloadModel(spec, { fetchImpl, isOnline: () => true, retryDelayMs: 0 }))).code).toBe("network");
  });

  it("rejects a file that ends early", async () => {
    // a server that does not do ranges and whose file is short every time it is asked
    const fetchImpl = vi.fn(async () => ok(body(DATA.slice(0, 24)).stream));
    expect((await failureOf(downloadModel(spec, { fetchImpl, retryDelayMs: 0 }))).code).toBe("size");
    expect(fetchImpl).toHaveBeenCalledTimes(1 + MAX_RESUMES);
  });

  it("stops reading a file that is larger than the pinned size and closes the connection", async () => {
    const big = body(new Uint8Array(1000));
    const error = await failureOf(downloadModel(spec, { fetchImpl: async () => ok(big.stream) }));
    expect(error.code).toBe("size");
    expect(big.state.cancelled).toBe(true);
  });

  it("rejects a file of the right size but other content", async () => {
    const other = body(DATA.map((b) => b ^ 1));
    expect((await failureOf(downloadModel(spec, { fetchImpl: async () => ok(other.stream) }))).code).toBe("hash");
  });

  it("stops when the person cancels part-way", async () => {
    const abort = new AbortController();
    const fetchImpl = async (_url: unknown, init?: RequestInit) => ok(body(DATA, { signal: init?.signal ?? undefined }).stream);
    const error = await failureOf(
      downloadModel(spec, {
        fetchImpl: fetchImpl as typeof fetch,
        signal: abort.signal,
        onProgress: (received) => {
          if (received >= 16) abort.abort();
        },
      }),
    );
    expect(error.code).toBe("aborted");
  });
});

describe("a download that is interrupted", () => {
  /** A server that answers a request for a range with that part of the file, like the model host does. */
  const rangeOf = (init?: RequestInit) => {
    const header = new Headers(init?.headers).get("range");
    return header ? Number(/^bytes=(\d+)-$/.exec(header)?.[1]) : null;
  };
  const part = (from: number, options: Parameters<typeof body>[1] = {}) =>
    new Response(body(DATA.slice(from), options).stream, { status: 206, headers: { "content-range": `bytes ${from}-${DATA.length - 1}/${DATA.length}` } });
  const whole = async (blob: Blob) => expect(new Uint8Array(await blob.arrayBuffer())).toEqual(DATA);

  it("carries on from where the connection broke, asking only for the rest", async () => {
    const asked: Array<number | null> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const from = rangeOf(init);
      asked.push(from);
      return from === null ? ok(body(DATA, { failAfter: 16 }).stream) : part(from);
    });
    const progress: number[] = [];
    await whole(await downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: 0, onProgress: (received) => progress.push(received) }));
    expect(asked).toEqual([null, 16]);
    // the count goes on from what was there: it does not start again
    expect(progress).toEqual([8, 16, 24, 32, 40]);
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("carries on more than once, and after a connection that closed early without an error", async () => {
    const asked: Array<number | null> = [];
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      const from = rangeOf(init);
      asked.push(from);
      if (from === null) return ok(body(DATA.slice(0, 8)).stream); // ends early, cleanly
      if (from === 8) return part(8, { failAfter: 16 }); // breaks again after 16 more
      return part(from);
    };
    await whole(await downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: 0 }));
    expect(asked).toEqual([null, 8, 24]);
  });

  it("starts again from the beginning when the server sends the whole file instead of the rest", async () => {
    let calls = 0;
    const fetchImpl = async () => (calls++ === 0 ? ok(body(DATA, { failAfter: 16 }).stream) : ok(body(DATA).stream));
    const progress: number[] = [];
    await whole(await downloadModel(spec, { fetchImpl, retryDelayMs: 0, onProgress: (received) => progress.push(received) }));
    expect(progress).toEqual([8, 16, 8, 16, 24, 32, 40]);
  });

  it("starts again from the beginning when the server answers with another part than was asked for", async () => {
    let calls = 0;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1) return ok(body(DATA, { failAfter: 16 }).stream);
      if (calls === 2) return new Response(body(DATA.slice(8)).stream, { status: 206, headers: { "content-range": "bytes 8-39/40" } });
      expect(rangeOf(init)).toBeNull();
      return ok(body(DATA).stream);
    };
    await whole(await downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: 0 }));
    expect(calls).toBe(3);
  });

  it("gives up after a few tries, and says the network failed", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const from = rangeOf(init);
      return from === null ? ok(body(DATA, { failAfter: 8 }).stream) : part(from, { failAfter: 0 });
    });
    expect((await failureOf(downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: 0 }))).code).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1 + MAX_RESUMES);
  });

  it("waits a little longer before each new try", async () => {
    const waits: number[] = [];
    const fetchImpl = async (_url: unknown, init?: RequestInit) => (rangeOf(init) === null ? ok(body(DATA, { failAfter: 8 }).stream) : part(rangeOf(init)!, { failAfter: 0 }));
    await failureOf(downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: 100, wait: async (ms) => void waits.push(ms) }));
    expect(waits).toEqual([100, 200, 300, 400]);
  });

  it("keeps what arrived, so that the next try of the person asks only for the rest", async () => {
    const broken = async (_url: unknown, init?: RequestInit) => (rangeOf(init) === null ? ok(body(DATA, { failAfter: 24 }).stream) : part(rangeOf(init)!, { failAfter: 0 }));
    await failureOf(downloadModel(spec, { fetchImpl: broken as typeof fetch, retryDelayMs: 0 }));
    const asked: Array<number | null> = [];
    const mended = async (_url: unknown, init?: RequestInit) => {
      asked.push(rangeOf(init));
      return part(rangeOf(init) ?? 0);
    };
    const progress: number[] = [];
    await whole(await downloadModel(spec, { fetchImpl: mended as typeof fetch, retryDelayMs: 0, onProgress: (received) => progress.push(received) }));
    expect(asked).toEqual([24]);
    expect(progress).toEqual([32, 40]);
    // and once the file is whole nothing is kept: the next download starts at the beginning
    const again: Array<number | null> = [];
    await downloadModel(spec, { fetchImpl: (async (_url: unknown, init?: RequestInit) => (again.push(rangeOf(init)), ok(body(DATA).stream))) as typeof fetch });
    expect(again).toEqual([null]);
  });

  it("keeps what arrived when the person turns out to be offline, without trying again", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      if (calls++ === 0) return ok(body(DATA, { failAfter: 16 }).stream);
      throw new TypeError("Failed to fetch");
    };
    expect((await failureOf(downloadModel(spec, { fetchImpl, isOnline: () => false, retryDelayMs: 0 }))).code).toBe("offline");
    expect(calls).toBe(2);
    const asked: Array<number | null> = [];
    await whole(await downloadModel(spec, { fetchImpl: (async (_url: unknown, init?: RequestInit) => (asked.push(rangeOf(init)), part(rangeOf(init) ?? 0))) as typeof fetch }));
    expect(asked).toEqual([16]);
  });

  it("keeps nothing of a download that the person cancelled", async () => {
    const abort = new AbortController();
    const fetchImpl = async (_url: unknown, init?: RequestInit) => ok(body(DATA, { signal: init?.signal ?? undefined }).stream);
    const error = await failureOf(downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, signal: abort.signal, onProgress: (received) => received >= 16 && abort.abort() }));
    expect(error.code).toBe("aborted");
    const asked: Array<number | null> = [];
    await downloadModel(spec, { fetchImpl: (async (_url: unknown, init?: RequestInit) => (asked.push(rangeOf(init)), ok(body(DATA).stream))) as typeof fetch });
    expect(asked).toEqual([null]);
  });

  it("does not wait for a new try once the person has cancelled", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn(async () => ok(body(DATA, { failAfter: 8 }).stream));
    const error = await failureOf(downloadModel(spec, { fetchImpl, signal: abort.signal, retryDelayMs: 50, wait: async () => abort.abort() }));
    expect(error.code).toBe("aborted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing of a file that turned out to be the wrong one", async () => {
    // the first part comes from another file: the whole has the right size and the wrong content
    const wrong = DATA.map((b) => b ^ 1);
    const fetchImpl = async (_url: unknown, init?: RequestInit) => (rangeOf(init) === null ? ok(body(wrong, { failAfter: 16 }).stream) : part(rangeOf(init)!));
    expect((await failureOf(downloadModel(spec, { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: 0 }))).code).toBe("hash");
    const asked: Array<number | null> = [];
    await downloadModel(spec, { fetchImpl: (async (_url: unknown, init?: RequestInit) => (asked.push(rangeOf(init)), ok(body(DATA).stream))) as typeof fetch });
    expect(asked).toEqual([null]);
  });

  it("calls a file that is shorter than the pinned one 'size' when the server has nothing after what arrived", async () => {
    let calls = 0;
    const fetchImpl = async () => (calls++ === 0 ? ok(body(DATA.slice(0, 24)).stream) : new Response(null, { status: 416 }));
    expect((await failureOf(downloadModel(spec, { fetchImpl, retryDelayMs: 0 }))).code).toBe("size");
    expect(calls).toBe(2);
  });

  it("calls an HTTP error on a later try 'http', and keeps what arrived", async () => {
    let calls = 0;
    const fetchImpl = async () => (calls++ === 0 ? ok(body(DATA, { failAfter: 16 }).stream) : new Response("busy", { status: 503 }));
    expect((await failureOf(downloadModel(spec, { fetchImpl, retryDelayMs: 0 }))).code).toBe("http");
    const asked: Array<number | null> = [];
    await whole(await downloadModel(spec, { fetchImpl: (async (_url: unknown, init?: RequestInit) => (asked.push(rangeOf(init)), part(rangeOf(init) ?? 0))) as typeof fetch }));
    expect(asked).toEqual([16]);
  });
});

describe("downloadModel without a stand-in for the online check", () => {
  it("asks the browser whether it is online when the fetch fails", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    vi.stubGlobal("navigator", { onLine: false });
    try {
      expect((await failureOf(downloadModel(spec, { fetchImpl }))).code).toBe("offline");
      vi.stubGlobal("navigator", { onLine: true });
      expect((await failureOf(downloadModel(spec, { fetchImpl }))).code).toBe("network");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("verifyModelBlob", () => {
  it("accepts the pinned file", async () => {
    await expect(verifyModelBlob(spec, new Blob([DATA]))).resolves.toBeUndefined();
  });

  it("names the problem: size first, then content", async () => {
    expect((await failureOf(verifyModelBlob(spec, new Blob([DATA.slice(1)])))).code).toBe("size");
    expect((await failureOf(verifyModelBlob(spec, new Blob([DATA.map((b) => b ^ 1)])))).code).toBe("hash");
  });
});

describe("sha256Hex", () => {
  it("matches the NIST test vector for 'abc'", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

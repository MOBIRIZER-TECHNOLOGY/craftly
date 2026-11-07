import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { downloadModel, sha256Hex, verifyModelBlob } from "./download";
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
    expect((await failureOf(downloadModel(spec, { fetchImpl: async () => ok(stream) }))).code).toBe("network");
  });

  it("tells being offline from a failing network", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await failureOf(downloadModel(spec, { fetchImpl, isOnline: () => false }))).code).toBe("offline");
    expect((await failureOf(downloadModel(spec, { fetchImpl, isOnline: () => true }))).code).toBe("network");
  });

  it("rejects a file that ends early", async () => {
    const short = body(DATA.slice(0, 24));
    expect((await failureOf(downloadModel(spec, { fetchImpl: async () => ok(short.stream) }))).code).toBe("size");
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

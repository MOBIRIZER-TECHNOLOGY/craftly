import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createImage, createPage, createShape } from "@/core/factory";
import { addAssetFromBlob, getAsset, listAssets } from "@/core/assets";
import { findElement } from "@/core/ops";
import { getActivePage, pageOf, useEditor } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { wipeDatabase } from "@/test/logicDb";
import { blurBehindSubject, blurSigma, type BlurStrength } from "./blur";
import { popAmount, popColourBehindSubject, type PopStyle } from "./colourPop";
import type { Matte, SourcePixels, ResultCanvas } from "./compose";
import { downloadModel } from "./download";
import { MlError } from "./errors";
import type { MlClient } from "./client";
import { deleteStoredModel, getStoredModel, listInstalled, putStoredModel } from "./modelStore";
import { getModelSpec } from "./registry";
import {
  blurBackground,
  colourPop,
  defaultDeps,
  forgetMasks,
  importModelFile,
  installModel,
  refreshModels,
  removeBackground,
  removeModel,
  restoreOriginal,
  upscale,
  type MlDeps,
} from "./service";
import { useMlStore } from "./state";
import type { ImageToMaskIo, ModelSpec } from "./types";

/* ---- a tiny model: 24 bytes, a 2 x 2 "square" ---- */
const BYTES = Uint8Array.from({ length: 24 }, (_, i) => i * 5 + 1);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const spec: ModelSpec = { ...getModelSpec("isnet-general")!, bytes: BYTES.length, sha256: sha(BYTES), io: { ...(getModelSpec("isnet-general")!.io as ImageToMaskIo), size: 2 } };

/* ---- a tiny upscaler: 16 bytes, tiles of 8 pixels with 1 pixel of context, four times larger ---- */
const UP_BYTES = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
const upSpec: ModelSpec = {
  ...getModelSpec("realesrgan-general")!,
  bytes: UP_BYTES.length,
  sha256: sha(UP_BYTES),
  io: { kind: "image-to-image", input: "input", output: "output", scale: 4, tile: 8, halo: 1 },
};

const PHOTO = new Image();
Object.defineProperty(PHOTO, "naturalWidth", { value: 200, configurable: true });
Object.defineProperty(PHOTO, "naturalHeight", { value: 100, configurable: true });

const SUBJECT = new Uint8ClampedArray([255, 255, 0, 0]); // half of the picture is subject

interface FakeClient extends MlClient {
  calls: { run: number; tile: number; warm: number; released: number };
  /** a copy of the numbers each tile was given, in order */
  tiles: Float32Array[];
}

interface FakeClientOptions {
  mask?: Uint8ClampedArray;
  error?: MlError;
  during?: () => void | Promise<void>;
  afterRun?: () => void;
  warmError?: MlError;
  /** runs while tile number n (1, 2, ...) is being made */
  onTile?: (n: number) => void | Promise<void>;
  /** runs just after tile number n came back, before the caller sees it */
  afterTile?: (n: number) => void;
  tileError?: MlError;
}

function fakeClient(options: FakeClientOptions = {}): FakeClient {
  const calls = { run: 0, tile: 0, warm: 0, released: 0 };
  const tiles: Float32Array[] = [];
  return {
    calls,
    tiles,
    async run(_args, callOptions) {
      calls.run++;
      callOptions?.onStage?.("runtime");
      callOptions?.onStage?.("inference");
      await options.during?.();
      if (callOptions?.signal?.aborted) throw new MlError("aborted");
      if (options.error) throw options.error;
      if (options.afterRun) queueMicrotask(options.afterRun); // runs before the caller sees the mask
      return options.mask ?? SUBJECT;
    },
    /** The "model" makes every pixel a block of identical pixels: the nearest-neighbour picture, which can be checked exactly. */
    async tile(args, callOptions) {
      const n = ++calls.tile;
      tiles.push(args.pixels.slice());
      callOptions?.onStage?.("runtime");
      callOptions?.onStage?.("model");
      callOptions?.onStage?.("inference");
      await options.onTile?.(n);
      if (callOptions?.signal?.aborted) throw new MlError("aborted");
      if (options.tileError) throw options.tileError;
      const scale = (args.model.io as { scale: number }).scale;
      const { width, height, pixels } = args;
      const out = new Float32Array(3 * width * scale * height * scale);
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < height * scale; y++) {
          for (let x = 0; x < width * scale; x++) out[(c * height * scale + y) * width * scale + x] = pixels[(c * height + Math.floor(y / scale)) * width + Math.floor(x / scale)]!;
        }
      }
      if (options.afterTile) queueMicrotask(() => options.afterTile!(n));
      return out;
    },
    async warm() {
      calls.warm++;
      if (options.warmError) throw options.warmError;
    },
    release() {
      calls.released++;
    },
  };
}

/** RGBA of a width x height picture: red grows to the right, green downward, blue is 5. `alpha` is the opacity of every pixel. */
function gradient(width: number, height: number, alpha: number | ((x: number, y: number) => number) = 255): SourcePixels {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = x * 10;
      rgba[i + 1] = y * 20;
      rgba[i + 2] = 5;
      rgba[i + 3] = typeof alpha === "number" ? alpha : alpha(x, y);
    }
  }
  return { rgba, width, height };
}

/** The picture a perfect nearest-neighbour upscaler makes of `source`. */
function nearest(source: SourcePixels, factor: number): Uint8ClampedArray {
  const width = source.width * factor;
  const height = source.height * factor;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / factor) * source.width + Math.floor(x / factor)) * 4;
      out.set(source.rgba.subarray(from, from + 4), (y * width + x) * 4);
      out[(y * width + x) * 4 + 3] = 255;
    }
  }
  return out;
}

interface FakeCanvas extends ResultCanvas {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  puts: Array<{ x: number; y: number; width: number; height: number }>;
  finished?: { matte?: Matte; jpeg?: boolean };
  disposed: number;
}

/** A canvas that keeps every tile put on it, so a test can read the assembled picture. */
function fakeCanvas(width: number, height: number): FakeCanvas {
  const canvas: FakeCanvas = {
    rgba: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    puts: [],
    disposed: 0,
    put(x, y, rgba, w, h) {
      canvas.puts.push({ x, y, width: w, height: h });
      for (let j = 0; j < h; j++) canvas.rgba.set(rgba.subarray(j * w * 4, (j + 1) * w * 4), ((y + j) * width + x) * 4);
    },
    async finish(options) {
      canvas.finished = options;
      return new Blob([canvas.rgba.slice(0, 8)], { type: options.jpeg && !options.matte ? "image/jpeg" : "image/png" });
    },
    dispose() {
      canvas.disposed++;
    },
  };
  return canvas;
}

const bytesResponse = (url: unknown) => new Response((String(url).includes(upSpec.repo) ? UP_BYTES : BYTES).slice(), { status: 200 });

function makeDeps(overrides: Partial<MlDeps> & { client?: FakeClient; fetchImpl?: typeof fetch; picture?: SourcePixels } = {}) {
  const fetchImpl = overrides.fetchImpl ?? (vi.fn(async (url: unknown) => bytesResponse(url)) as unknown as typeof fetch);
  const client = overrides.client ?? fakeClient();
  const canvases: FakeCanvas[] = [];
  const { picture, client: _client, fetchImpl: _fetchImpl, ...rest } = overrides;
  const deps: MlDeps = {
    client,
    support: async () => ({ ok: true }),
    loadSource: async () => PHOTO,
    // a fresh copy every time, as the real thing gives: a job that blurs in place must not change the test's own picture
    readPixels: () => (picture ? { ...picture, rgba: picture.rgba.slice() } : gradient(13, 11)),
    createResultCanvas: (width, height) => {
      const canvas = fakeCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    },
    now: () => 0,
    yieldToBrowser: vi.fn(async () => undefined),
    download: (s, o) => downloadModel(s, { ...o, fetchImpl }),
    persist: vi.fn(async () => true),
    storage: async () => ({ usage: 0, quota: 1e12 }),
    spec: (id) => [spec, upSpec].find((s) => s.id === id),
    defaultModel: (task) => (task === "upscaling" ? upSpec.id : spec.id),
    ...rest,
  };
  return { deps, client, canvases, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

/* ---- an open design with one photo ---- */
const actions = () => useEditor.getState().actions;
const photo = () => {
  const page = getActivePage(useEditor.getState());
  return findElement(page!, "photo") as ImageElement | null;
};
function openPhoto(extra: Partial<ImageElement> = {}) {
  const design = createDesign({
    width: 1000,
    height: 600,
    pages: [createPage({ elements: [createImage({ id: "photo", src: "asset:orig", width: 200, height: 100, naturalWidth: 200, naturalHeight: 100, ...extra })] })],
  });
  actions().openDesign(design);
}

async function install(deps: MlDeps) {
  await installModel(spec.id, { warm: false }, deps);
}

async function installUp(deps: MlDeps) {
  await installModel(upSpec.id, { warm: false }, deps);
}

beforeEach(async () => {
  await wipeDatabase();
  for (const m of await listInstalled()) await deleteStoredModel(m.id);
  useMlStore.setState({ loaded: false, installed: {}, installing: {}, job: null, storage: {} });
  forgetMasks(); // what the model found in an earlier test's picture must not stand in for a run
  openPhoto();
});
afterEach(() => vi.restoreAllMocks());

async function failureOf(promise: Promise<unknown>): Promise<MlError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MlError);
    return error as MlError;
  }
  throw new Error("expected the promise to reject");
}

describe("installModel", () => {
  it("downloads, checks and stores the model, and reports each phase while it works", async () => {
    const { deps } = makeDeps();
    const phases: string[] = [];
    const stop = useMlStore.subscribe((state) => {
      const phase = state.installing[spec.id]?.phase;
      if (phase && phases[phases.length - 1] !== phase) phases.push(phase);
    });
    await installModel(spec.id, {}, deps);
    stop();
    expect(phases).toEqual(["downloading", "saving", "preparing"]);
    expect(useMlStore.getState().installing[spec.id]).toBeUndefined();
    expect(useMlStore.getState().installed[spec.id]).toMatchObject({ sha256: spec.sha256 });
    // (the bytes themselves are checked in modelStore.test.ts; jsdom's Blob does not survive fake-indexeddb's copy)
    expect(await getStoredModel(spec.id)).toMatchObject({ id: spec.id, sha256: spec.sha256, bytes: spec.bytes });
  });

  it("asks the browser to keep the model once it is stored", async () => {
    const { deps } = makeDeps();
    await install(deps);
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it("warms the runtime up so it is cached for offline use, unless told not to", async () => {
    const warmed = makeDeps();
    await installModel(spec.id, {}, warmed.deps);
    expect(warmed.client.calls.warm).toBe(1);
    const cold = makeDeps();
    await installModel(spec.id, { warm: false }, cold.deps);
    expect(cold.client.calls.warm).toBe(0);
  });

  it("keeps the downloaded model when the person cancels while it is being prepared", async () => {
    const { deps } = makeDeps({ client: fakeClient({ warmError: new MlError("aborted") }) });
    const result = await installModel(spec.id, {}, deps);
    expect(result.warmError).toBeUndefined();
    expect(await getStoredModel(spec.id)).toBeDefined();
  });

  it("keeps the model when the warm-up fails, and says why", async () => {
    const { deps } = makeDeps({ client: fakeClient({ warmError: new MlError("out-of-memory") }) });
    const result = await installModel(spec.id, {}, deps);
    expect(result.warmError?.code).toBe("out-of-memory");
    expect(await getStoredModel(spec.id)).toBeDefined();
  });

  it("stores nothing when the download is cancelled", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          controller.enqueue(BYTES.slice(0, 8));
        },
      });
      queueMicrotask(() => abort.abort());
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;
    const { deps } = makeDeps({ fetchImpl });
    expect((await failureOf(installModel(spec.id, { signal: abort.signal }, deps))).code).toBe("aborted");
    expect(await getStoredModel(spec.id)).toBeUndefined();
    expect(useMlStore.getState().installing[spec.id]).toBeUndefined();
  });

  it("stores nothing when the file is not the pinned one", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          BYTES.map((b) => b ^ 1),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const { deps } = makeDeps({ fetchImpl });
    expect((await failureOf(installModel(spec.id, {}, deps))).code).toBe("hash");
    expect(await getStoredModel(spec.id)).toBeUndefined();
    expect(useMlStore.getState().installing[spec.id]).toBeUndefined();
  });

  it("refuses before downloading when there is no room", async () => {
    const { deps, fetchImpl } = makeDeps({ storage: async () => ({ usage: 990, quota: 1000 }) });
    expect((await failureOf(installModel(spec.id, {}, deps))).code).toBe("quota");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses before downloading when this browser cannot run the model", async () => {
    const { deps, fetchImpl } = makeDeps({ support: async () => ({ ok: false, reason: "no-webgpu", message: "No WebGPU here." }) });
    const error = await failureOf(installModel(spec.id, {}, deps));
    expect(error).toMatchObject({ code: "unsupported", message: "No WebGPU here." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shares one download between two callers", async () => {
    const { deps, fetchImpl } = makeDeps();
    await Promise.all([installModel(spec.id, { warm: false }, deps), installModel(spec.id, { warm: false }, deps)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("lets the person cancel through the store while it downloads", async () => {
    let seen = false;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          controller.enqueue(BYTES.slice(0, 8));
        },
      });
      queueMicrotask(() => {
        seen = true;
        useMlStore.getState().installing[spec.id]?.cancel();
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;
    const { deps } = makeDeps({ fetchImpl });
    expect((await failureOf(installModel(spec.id, {}, deps))).code).toBe("aborted");
    expect(seen).toBe(true);
  });

  it("knows only the models in the registry", async () => {
    const { deps } = makeDeps();
    expect((await failureOf(installModel("nope", {}, deps))).code).toBe("runtime");
  });
});

describe("the defaults the app really runs with", () => {
  it("use the registry: the background remover is ISNet general-use, the upscaler Real-ESRGAN", () => {
    const deps = defaultDeps();
    expect(deps.defaultModel("background-removal")).toBe("isnet-general");
    expect(deps.spec("isnet-general")?.name).toBe("ISNet general-use");
    expect(deps.defaultModel("upscaling")).toBe("realesrgan-general");
    expect(deps.spec("realesrgan-general")?.name).toBe("Real-ESRGAN general x4 v3");
    expect(deps.spec("nope")).toBeUndefined();
  });

  describe("giving the browser a turn", () => {
    it("takes a turn of the event loop, and is not a timer: a tab in the background holds timers back, and a job would crawl", async () => {
      const { MessageChannel: NodeChannel } = await import("node:worker_threads");
      vi.stubGlobal("MessageChannel", NodeChannel);
      const timer = vi.spyOn(globalThis, "setTimeout");
      try {
        const order: string[] = [];
        const turn = defaultDeps()
          .yieldToBrowser()
          .then(() => order.push("turn"));
        order.push("asked");
        await turn;
        expect(order).toEqual(["asked", "turn"]); // not at once: anything already waiting gets its go first
        expect(timer).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("falls back to a timer in a browser that has no message channels", async () => {
      vi.stubGlobal("MessageChannel", undefined);
      const timer = vi.spyOn(globalThis, "setTimeout");
      try {
        await defaultDeps().yieldToBrowser();
        expect(timer).toHaveBeenCalledWith(expect.any(Function), 0);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

describe("when the browser cannot say how much room is left", () => {
  it("still installs: no estimate is not a reason to refuse", async () => {
    const { deps } = makeDeps({
      storage: async () => {
        throw new Error("no estimate");
      },
    });
    await install(deps);
    expect(await getStoredModel(spec.id)).toBeDefined();
  });

  it("still lists the models, with no storage figures", async () => {
    const { deps } = makeDeps({
      storage: async () => {
        throw new Error("no estimate");
      },
    });
    await refreshModels(deps);
    expect(useMlStore.getState()).toMatchObject({ loaded: true, storage: {} });
  });
});

describe("the list of installed models", () => {
  it("is read from the store and marked as loaded", async () => {
    await putStoredModel(spec, new Blob([BYTES]));
    await refreshModels(makeDeps().deps);
    expect(useMlStore.getState().loaded).toBe(true);
    expect(useMlStore.getState().installed[spec.id]).toMatchObject({ sha256: spec.sha256 });
  });

  it("lets go of a stored model the registry no longer knows, so it does not take up room for ever", async () => {
    await putStoredModel({ ...spec, id: "retired-model" }, new Blob([BYTES]));
    await putStoredModel(spec, new Blob([BYTES]));
    await refreshModels(makeDeps().deps);
    expect((await listInstalled()).map((m) => m.id)).toEqual([spec.id]);
    expect(Object.keys(useMlStore.getState().installed)).toEqual([spec.id]);
  });

  it("takes in a model file from disk when it is the pinned one", async () => {
    const { deps } = makeDeps();
    await importModelFile(spec.id, new File([BYTES], "model.onnx"), deps);
    expect(await getStoredModel(spec.id)).toBeDefined();
    expect(useMlStore.getState().installed[spec.id]).toBeDefined();
  });

  it("prepares the engine after a file was added, so the first use works without a connection", async () => {
    const { deps, client } = makeDeps();
    const result = await importModelFile(spec.id, new File([BYTES], "model.onnx"), deps);
    expect(client.calls.warm).toBe(1);
    expect(result.warmError).toBeUndefined();
  });

  it("keeps a file that was added even if the engine could not be prepared, and says why", async () => {
    const { deps } = makeDeps({ client: fakeClient({ warmError: new MlError("engine") }) });
    const result = await importModelFile(spec.id, new File([BYTES], "model.onnx"), deps);
    expect(result.warmError?.code).toBe("engine");
    expect(await getStoredModel(spec.id)).toBeDefined();
  });

  it("rejects a model file that is not the pinned one", async () => {
    const { deps } = makeDeps();
    expect((await failureOf(importModelFile(spec.id, new File([BYTES.map((b) => b ^ 1)], "model.onnx"), deps))).code).toBe("hash");
    expect(await getStoredModel(spec.id)).toBeUndefined();
  });

  it("does not take a model file for a model the app does not know", async () => {
    const { deps } = makeDeps();
    expect((await failureOf(importModelFile("nope", new File([BYTES], "model.onnx"), deps))).code).toBe("runtime");
  });

  it("removes a model and lets the worker go, which frees the graphics memory", async () => {
    const { deps, client } = makeDeps();
    await install(deps);
    await removeModel(spec.id, deps);
    expect(await getStoredModel(spec.id)).toBeUndefined();
    expect(useMlStore.getState().installed[spec.id]).toBeUndefined();
    expect(client.calls.released).toBe(1);
  });
});

describe("removeBackground", () => {
  it("replaces the picture with a cut-out, keeps the original, and is one undo step", async () => {
    const { deps } = makeDeps();
    await install(deps);
    const result = await removeBackground("photo", {}, deps);
    const now = photo()!;
    expect(result).toMatchObject({ applied: true, scaled: false });
    expect(now.src).toMatch(/^asset:/);
    expect(now.src).not.toBe("asset:orig");
    expect(now.originalSrc).toBe("asset:orig");
    expect(now).toMatchObject({ naturalWidth: 200, naturalHeight: 100, width: 200, height: 100 });
    const saved = await getAsset(now.src!.slice(6));
    expect(saved).toMatchObject({ kind: "image", mime: "image/png", width: 64, height: 48 }); // the test setup decodes every image at 64 x 48

    actions().undo();
    expect(photo()).toMatchObject({ src: "asset:orig" });
    expect(photo()!.originalSrc).toBeUndefined();
  });

  it("names the new file after the old one", async () => {
    const original = await addAssetFromBlob(new Blob(["x"], { type: "image/png" }), "Beach");
    openPhoto({ src: `asset:${original.id}` });
    const { deps } = makeDeps();
    await install(deps);
    await removeBackground("photo", {}, deps);
    const names = (await listAssets()).map((a) => a.name);
    expect(names).toContain("Beach (no background)");
  });

  it("reports each step of the work while the job runs, and is idle again afterwards", async () => {
    const { deps } = makeDeps();
    await install(deps);
    const stages: string[] = [];
    const stop = useMlStore.subscribe((state) => {
      const stage = state.job?.stage;
      if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
    });
    await removeBackground("photo", {}, deps);
    stop();
    expect(stages).toEqual(["preparing", "runtime", "inference", "finishing"]);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("keeps the very first picture as the original when a cut-out is cut out again", async () => {
    openPhoto({ src: "asset:second", originalSrc: "asset:first" });
    const { deps } = makeDeps();
    await install(deps);
    await removeBackground("photo", {}, deps);
    expect(photo()!.originalSrc).toBe("asset:first");
  });

  it("does not download anything on its own", async () => {
    const { deps, fetchImpl } = makeDeps();
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("not-installed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(photo()!.src).toBe("asset:orig");
  });

  it("downloads first when the person agrees, then goes on to cut the photo out", async () => {
    const { deps, fetchImpl } = makeDeps();
    const askToDownload = vi.fn(async () => true);
    await removeBackground("photo", { askToDownload }, deps);
    expect(askToDownload).toHaveBeenCalledWith(spec);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(photo()!.originalSrc).toBe("asset:orig");
  });

  it("stops quietly when the person declines the download", async () => {
    const { deps, fetchImpl } = makeDeps();
    expect((await failureOf(removeBackground("photo", { askToDownload: async () => false }, deps))).code).toBe("aborted");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(useMlStore.getState().job).toBeNull();
  });

  it("downloads again when the stored file is not the one the registry pins any more", async () => {
    await putStoredModel({ ...spec, sha256: "0".repeat(64) }, new Blob([BYTES]));
    const { deps, fetchImpl } = makeDeps();
    await removeBackground("photo", { askToDownload: async () => true }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await getStoredModel(spec.id))!.sha256).toBe(spec.sha256);
  });

  it("drops the result when the photo was replaced while the model was working", async () => {
    const before = (await listAssets()).length;
    const client = fakeClient({ during: () => void actions().replaceImage("photo", "asset:other", 200, 100) });
    const { deps } = makeDeps({ client });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("stale");
    expect(photo()!.src).toBe("asset:other");
    expect(photo()!.originalSrc).toBeUndefined();
    expect((await listAssets()).length).toBe(before); // no orphaned file is left behind
  });

  it("drops the result when the photo was deleted while the model was working", async () => {
    const client = fakeClient({ during: () => void actions().deleteElements(["photo"]) });
    const { deps } = makeDeps({ client });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("stale");
  });

  it("puts the cut-out on the page the photo is on, even when the person has turned to another page meanwhile", async () => {
    const photoOnA = createImage({ id: "photo", src: "asset:orig", width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 });
    actions().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "pa", elements: [photoOnA] }), createPage({ id: "pb", elements: [] })] }));
    const { deps } = makeDeps({ client: fakeClient({ during: () => actions().setActivePage("pb") }) });
    await install(deps);
    await removeBackground("photo", {}, deps);
    expect(useEditor.getState().activePageId).toBe("pb"); // the view stays where the person went
    const onA = findElement(pageOf(useEditor.getState().design, "pa")!, "photo") as ImageElement;
    expect(onA.originalSrc).toBe("asset:orig");
    expect(onA.src).not.toBe("asset:orig");
  });

  it("refuses a locked photo before it downloads or runs anything", async () => {
    openPhoto({ locked: true });
    const { deps, fetchImpl, client } = makeDeps();
    expect((await failureOf(removeBackground("photo", { askToDownload: async () => true }, deps))).code).toBe("locked");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.calls.run).toBe(0);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("refuses to work on a design that can only be viewed", async () => {
    useEditor.setState({ mode: "view" });
    const { deps, fetchImpl } = makeDeps();
    expect((await failureOf(removeBackground("photo", { askToDownload: async () => true }, deps))).code).toBe("locked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not report success when the photo was locked while the model worked, and leaves no stray picture", async () => {
    const before = (await listAssets()).length;
    const client = fakeClient({ during: () => void actions().updateElements(["photo"], { locked: true }) });
    const { deps } = makeDeps({ client });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("locked");
    expect(photo()!.src).toBe("asset:orig");
    expect((await listAssets()).length).toBe(before);
  });

  it("stops when cancelled just after the mask came back, and leaves no new picture", async () => {
    const before = (await listAssets()).length;
    const abort = new AbortController();
    const { deps } = makeDeps({ client: fakeClient({ afterRun: () => abort.abort() }) });
    await install(deps);
    expect((await failureOf(removeBackground("photo", { signal: abort.signal }, deps))).code).toBe("aborted");
    expect(photo()!.src).toBe("asset:orig");
    expect((await listAssets()).length).toBe(before);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("says the disk is full when the new picture cannot be saved, not that the model failed", async () => {
    const assets = await import("@/core/assets");
    vi.spyOn(assets, "addAssetFromBlob").mockRejectedValue(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
    const { deps } = makeDeps();
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("quota");
    expect(photo()!.src).toBe("asset:orig");
  });

  it("works on one photo at a time", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { deps } = makeDeps({ client: fakeClient({ during: () => gate }) });
    await install(deps);
    const first = removeBackground("photo", {}, deps);
    await vi.waitFor(() => expect(useMlStore.getState().job).not.toBeNull());
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("busy");
    finish();
    await expect(first).resolves.toMatchObject({ applied: true });
  });

  it("only handles photos", async () => {
    const { deps } = makeDeps();
    expect((await failureOf(removeBackground("missing", {}, deps))).code).toBe("image");
    openPhoto({ src: null });
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("image");
  });

  it("does not treat another kind of element as a photo", async () => {
    actions().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ elements: [createShape("rect", { id: "box", x: 0, y: 0, width: 50, height: 50 })] })] }));
    const { deps } = makeDeps();
    expect((await failureOf(removeBackground("box", {}, deps))).code).toBe("image");
  });

  it("fails clearly when the registry has no model for the tool", async () => {
    const { deps } = makeDeps({ spec: () => undefined });
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("runtime");
    expect(useMlStore.getState().job).toBeNull();
  });

  it("says so when no subject was found, and changes nothing", async () => {
    const { deps } = makeDeps({ client: fakeClient({ mask: new Uint8ClampedArray(4) }) });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("no-subject");
    expect(photo()!.src).toBe("asset:orig");
  });

  it("leaves a photo alone when all of it is subject", async () => {
    const { deps } = makeDeps({ client: fakeClient({ mask: new Uint8ClampedArray([255, 255, 255, 255]) }) });
    await install(deps);
    expect(await removeBackground("photo", {}, deps)).toMatchObject({ applied: false, reason: "whole-photo" });
    expect(photo()!.src).toBe("asset:orig");
  });

  it("stops when cancelled while the model works, and the job ends", async () => {
    const abort = new AbortController();
    const { deps } = makeDeps({ client: fakeClient({ during: () => abort.abort() }) });
    await install(deps);
    expect((await failureOf(removeBackground("photo", { signal: abort.signal }, deps))).code).toBe("aborted");
    expect(photo()!.src).toBe("asset:orig");
    expect(useMlStore.getState().job).toBeNull();
  });

  it("lets the person cancel through the store as well", async () => {
    const { deps } = makeDeps({ client: fakeClient({ during: () => void useMlStore.getState().job?.cancel() }) });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("aborted");
  });

  it("writes the technical cause to the console when a job fails, so it can be reported", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps } = makeDeps({ client: fakeClient({ error: new MlError("runtime", undefined, { cause: "Error: unsupported operator DeformConv" }) }) });
    await install(deps);
    await failureOf(removeBackground("photo", {}, deps));
    expect(warn).toHaveBeenCalledTimes(1);
    const text = warn.mock.calls[0]!.map(String).join(" ");
    expect(text).toContain("runtime");
    expect(text).toContain("unsupported operator DeformConv");
  });

  it("says nothing in the console when the person cancels", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const abort = new AbortController();
    const { deps } = makeDeps({ client: fakeClient({ during: () => abort.abort() }) });
    await install(deps);
    await failureOf(removeBackground("photo", { signal: abort.signal }, deps));
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes on what went wrong inside the worker", async () => {
    const { deps } = makeDeps({ client: fakeClient({ error: new MlError("out-of-memory") }) });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("out-of-memory");
    expect(useMlStore.getState().job).toBeNull();
    expect(photo()!.src).toBe("asset:orig");
  });

  it("fails when the picture cannot be read", async () => {
    const { deps } = makeDeps({ loadSource: async () => null });
    await install(deps);
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("image");
  });

  it("checks the browser before it asks the person for anything", async () => {
    const { deps } = makeDeps({ support: async () => ({ ok: false, reason: "no-webgpu", message: "No WebGPU." }) });
    const askToDownload = vi.fn(async () => true);
    expect((await failureOf(removeBackground("photo", { askToDownload }, deps))).code).toBe("unsupported");
    expect(askToDownload).not.toHaveBeenCalled();
  });

  it("says when the photo was too large and had to be reduced", async () => {
    const huge = Object.assign(new Image(), {});
    Object.defineProperty(huge, "naturalWidth", { value: 6000 });
    Object.defineProperty(huge, "naturalHeight", { value: 5000 });
    const { deps } = makeDeps({ loadSource: async () => huge });
    await install(deps);
    expect(await removeBackground("photo", {}, deps)).toMatchObject({ applied: true, scaled: true });
    expect(photo()).toMatchObject({ naturalWidth: 5477, naturalHeight: 4564 });
  });
});

/** A picture with detail to blur: squares of two pixels, light and dark, like a tiled wall. `alpha` is the opacity of each pixel. */
function checker(width: number, height: number, alpha: (x: number, y: number) => number = () => 255): SourcePixels {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = (x >> 1) % 2 === (y >> 1) % 2 ? 20 : 200;
      rgba.set([value, value, value, alpha(x, y)], (y * width + x) * 4);
    }
  }
  return { rgba, width, height };
}

/** What the blurring maths makes of `source` with the 2 x 2 mask the stand-in model gives (top half subject). */
function blurredBy(source: SourcePixels, strength: BlurStrength, mask: Uint8ClampedArray = SUBJECT): Uint8ClampedArray {
  const copy = { ...source, rgba: source.rgba.slice() };
  blurBehindSubject(copy, { data: mask, size: 2 }, blurSigma(source.width, source.height, strength));
  return copy.rgba;
}

describe("blurBackground", () => {
  it("blurs everything but the subject, at the strength asked for", async () => {
    const source = checker(200, 100);
    const { deps, canvases } = makeDeps({ picture: source });
    await install(deps);
    const result = await blurBackground("photo", { strength: "strong" }, deps);
    expect(result).toEqual({ applied: true, scaled: false, width: 200, height: 100 });
    const canvas = canvases[0]!;
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    // the picture is what the maths makes of it with the mask the model gave
    expect(Array.from(canvas.rgba)).toEqual(Array.from(blurredBy(source, "strong")));
    // the top rows are all subject: untouched. The bottom rows are all background: not the same any more.
    expect(Array.from(canvas.rgba.subarray(0, 200 * 4 * 24))).toEqual(Array.from(source.rgba.subarray(0, 200 * 4 * 24)));
    expect(Array.from(canvas.rgba.subarray(200 * 4 * 80))).not.toEqual(Array.from(source.rgba.subarray(200 * 4 * 80)));
  });

  it("takes a medium blur unless told otherwise, and each strength blurs differently", async () => {
    const source = checker(600, 300);
    const results: Record<string, Uint8ClampedArray> = {};
    await install(makeDeps().deps);
    for (const strength of [undefined, "light", "medium", "strong"] as const) {
      openPhoto(); // a fresh photo for every try
      const { deps, canvases } = makeDeps({ picture: source });
      await blurBackground("photo", strength ? { strength } : {}, deps);
      results[strength ?? "default"] = canvases[0]!.rgba;
    }
    expect(Array.from(results.default!)).toEqual(Array.from(blurredBy(source, "medium")));
    expect(Array.from(results.medium!)).toEqual(Array.from(results.default!));
    expect(Array.from(results.light!)).not.toEqual(Array.from(results.medium!));
    expect(Array.from(results.strong!)).not.toEqual(Array.from(results.medium!));
  });

  it("replaces the picture, keeps the original, sets the size of the new picture, and is one undo step", async () => {
    const { deps } = makeDeps();
    await install(deps);
    await blurBackground("photo", {}, deps);
    const now = photo()!;
    expect(now.src).toMatch(/^asset:/);
    expect(now.src).not.toBe("asset:orig");
    expect(now.originalSrc).toBe("asset:orig");
    // the picture on the page keeps its size and its place; the file behind it is the size that was read (13 x 11 here)
    expect(now).toMatchObject({ width: 200, height: 100, naturalWidth: 13, naturalHeight: 11 });
    expect(await getAsset(now.src!.slice(6))).toMatchObject({ kind: "image", mime: "image/png" });

    actions().undo();
    expect(photo()).toMatchObject({ src: "asset:orig", naturalWidth: 200, naturalHeight: 100 });
    expect(photo()!.originalSrc).toBeUndefined();
  });

  it("names the new file after the old one, once, however many tools the photo went through", async () => {
    await install(makeDeps().deps);
    for (const [from, expected] of [
      ["Beach", "Beach (blurred)"],
      ["Beach (blurred)", "Beach (blurred)"],
      ["Beach (2x)", "Beach (blurred)"],
      ["Beach (no background)", "Beach (blurred)"],
    ] as const) {
      const original = await addAssetFromBlob(new Blob(["x"], { type: "image/png" }), from);
      openPhoto({ src: `asset:${original.id}` });
      const names = (await listAssets()).map((a) => a.name);
      await blurBackground("photo", {}, makeDeps().deps);
      const created = (await listAssets()).map((a) => a.name).filter((name) => !names.includes(name) || name === expected);
      expect(created).toContain(expected);
      expect(created.some((name) => /\(blurred\) \(blurred\)/.test(name))).toBe(false);
    }
  });

  it("names the steps of the work, and is idle again afterwards", async () => {
    const { deps } = makeDeps();
    await install(deps);
    const stages: string[] = [];
    const stop = useMlStore.subscribe((state) => {
      const stage = state.job?.stage;
      if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
    });
    await blurBackground("photo", {}, deps);
    stop();
    expect(stages).toEqual(["preparing", "runtime", "inference", "finishing"]);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("keeps the first picture as the original through every tool", async () => {
    openPhoto({ src: "asset:second", originalSrc: "asset:first" });
    const { deps } = makeDeps();
    await install(deps);
    await blurBackground("photo", {}, deps);
    expect(photo()!.originalSrc).toBe("asset:first");
  });

  it("saves a JPEG photograph as a JPEG, and anything else as a PNG", async () => {
    const jpeg = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }), "Beach");
    openPhoto({ src: `asset:${jpeg.id}` });
    const first = makeDeps();
    await install(first.deps);
    await blurBackground("photo", {}, first.deps);
    expect(first.canvases[0]!.finished!.jpeg).toBe(true);
    expect((await getAsset(photo()!.src!.slice(6)))!.mime).toBe("image/jpeg");

    openPhoto();
    const second = makeDeps();
    await blurBackground("photo", {}, second.deps);
    expect(second.canvases[0]!.finished!.jpeg).toBe(false);
  });

  it("keeps the opacity of every pixel, and a picture with transparency is never saved as a JPEG", async () => {
    const jpeg = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }), "Cutout");
    openPhoto({ src: `asset:${jpeg.id}` });
    const source = checker(200, 100, (x, y) => (x < 10 ? 0 : y > 90 ? 128 : 255));
    const { deps, canvases } = makeDeps({ picture: source });
    await install(deps);
    await blurBackground("photo", {}, deps);
    expect(canvases[0]!.finished!.jpeg).toBe(false);
    for (let i = 3; i < source.rgba.length; i += 4) expect(canvases[0]!.rgba[i]).toBe(source.rgba[i]);
  });

  it("works on a photo that was reduced to the pixel budget, and says so", async () => {
    const source = { ...checker(150, 75), scaled: true };
    const readPixels = vi.fn(() => source);
    const { deps } = makeDeps({ readPixels });
    await install(deps);
    expect(await blurBackground("photo", {}, deps)).toEqual({ applied: true, scaled: true, width: 150, height: 75 });
    expect(readPixels).toHaveBeenCalledWith(PHOTO, 25_000_000);
    expect(photo()).toMatchObject({ naturalWidth: 150, naturalHeight: 75 });
  });

  it("puts a tall picture together in pieces, with the same result as in one go", async () => {
    // 1 x 300,000 pixels: more than the 262,144 pixels a piece takes, so the work happens in two pieces
    const source = checker(1, 300_000);
    const { deps, canvases } = makeDeps({ picture: source });
    await install(deps);
    await blurBackground("photo", {}, deps);
    const canvas = canvases[0]!;
    expect(canvas.puts.length).toBeGreaterThan(1);
    // every row is put once, in order
    let next = 0;
    for (const put of canvas.puts) {
      expect(put.y).toBe(next);
      next += put.height;
    }
    expect(next).toBe(300_000);
    const expected = blurredBy(source, "medium");
    // (a comparison that does not print a million numbers when it fails)
    expect(canvas.rgba.length).toBe(expected.length);
    expect(canvas.rgba.every((value, i) => value === expected[i])).toBe(true);
  });

  it("gives the browser a turn now and then while it works on the pixels, and not otherwise", async () => {
    const quick = makeDeps();
    await install(quick.deps);
    await blurBackground("photo", {}, quick.deps);
    expect(quick.deps.yieldToBrowser).not.toHaveBeenCalled(); // the clock never moved: no time to give back

    openPhoto();
    let clock = 0;
    const slow = makeDeps({ now: () => (clock += 100) });
    await blurBackground("photo", {}, slow.deps);
    expect(slow.deps.yieldToBrowser).toHaveBeenCalled();
    expect(photo()!.originalSrc).toBe("asset:orig"); // and it still got there
  });

  describe("the mask the model found", () => {
    it("is kept, so another try on the same picture (after Undo) does not run the model again", async () => {
      const { deps, client } = makeDeps();
      await install(deps);
      await blurBackground("photo", { strength: "light" }, deps);
      expect(client.calls.run).toBe(1);
      actions().undo();
      await blurBackground("photo", { strength: "strong" }, deps);
      expect(client.calls.run).toBe(1);
      expect(photo()!.originalSrc).toBe("asset:orig");
    });

    it("skips straight to the pixel work when it is kept", async () => {
      const { deps } = makeDeps();
      await install(deps);
      await blurBackground("photo", {}, deps);
      actions().undo();
      const stages: string[] = [];
      const stop = useMlStore.subscribe((state) => {
        const stage = state.job?.stage;
        if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
      });
      await blurBackground("photo", {}, deps);
      stop();
      expect(stages).toEqual(["preparing", "finishing"]);
    });

    it("is not used for another picture", async () => {
      const { deps, client } = makeDeps();
      await install(deps);
      await blurBackground("photo", {}, deps);
      actions().replaceImage("photo", "asset:other", 200, 100);
      await blurBackground("photo", {}, deps);
      expect(client.calls.run).toBe(2);
    });

    it("is shared with Remove background, in both directions", async () => {
      const { deps, client } = makeDeps();
      await install(deps);
      await blurBackground("photo", {}, deps);
      actions().undo();
      await removeBackground("photo", {}, deps);
      expect(client.calls.run).toBe(1);

      actions().undo();
      forgetMasks();
      await removeBackground("photo", {}, deps);
      actions().undo();
      await blurBackground("photo", {}, deps);
      expect(client.calls.run).toBe(2);
    });

    it("is forgotten when the model is removed from the device", async () => {
      const { deps, client } = makeDeps();
      await install(deps);
      await blurBackground("photo", {}, deps);
      actions().undo();
      await removeModel(spec.id, deps);
      await install(deps);
      await blurBackground("photo", {}, deps);
      expect(client.calls.run).toBe(2);
    });

    it("is not kept when the model failed", async () => {
      const failing = makeDeps({ client: fakeClient({ error: new MlError("out-of-memory") }) });
      await install(failing.deps);
      await failureOf(blurBackground("photo", {}, failing.deps));
      const working = makeDeps();
      await blurBackground("photo", {}, working.deps);
      expect(working.client.calls.run).toBe(1);
    });
  });

  describe("when there is nothing to blur", () => {
    it("says so and changes nothing when the whole photo is subject", async () => {
      const before = (await listAssets()).length;
      const readPixels = vi.fn(() => gradient(13, 11));
      const { deps, canvases } = makeDeps({ client: fakeClient({ mask: new Uint8ClampedArray([255, 255, 255, 255]) }), readPixels });
      await install(deps);
      expect(await blurBackground("photo", {}, deps)).toEqual({ applied: false, reason: "whole-photo" });
      expect(photo()!.src).toBe("asset:orig");
      expect((await listAssets()).length).toBe(before);
      expect(canvases).toHaveLength(0);
      expect(readPixels).not.toHaveBeenCalled(); // decided before the picture is read
    });

    it("says that no subject was found, and changes nothing", async () => {
      const { deps } = makeDeps({ client: fakeClient({ mask: new Uint8ClampedArray(4) }) });
      await install(deps);
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("no-subject");
      expect(photo()!.src).toBe("asset:orig");
    });

    it("says so when everything around the subject is already transparent, and leaves no new picture", async () => {
      const before = (await listAssets()).length;
      const source = checker(200, 100, (_x, y) => (y < 50 ? 255 : 0)); // only the subject (the top half) is there
      const { deps, canvases } = makeDeps({ picture: source });
      await install(deps);
      expect(await blurBackground("photo", {}, deps)).toEqual({ applied: false, reason: "transparent" });
      expect(photo()!.src).toBe("asset:orig");
      expect((await listAssets()).length).toBe(before);
      expect(canvases.every((c) => c.finished === undefined)).toBe(true);
    });
  });

  describe("when only the edge of a cut-out is left around the subject", () => {
    it("says the same when all that is there is a faint rim of anti-aliased pixels", async () => {
      const before = (await listAssets()).length;
      const source = checker(200, 100, (_x, y) => (y < 50 ? 255 : y < 53 ? 40 : 0)); // the subject, and three faint rows under it
      const { deps } = makeDeps({ picture: source });
      await install(deps);
      expect(await blurBackground("photo", {}, deps)).toEqual({ applied: false, reason: "transparent" });
      expect((await listAssets()).length).toBe(before);
      expect(photo()!.src).toBe("asset:orig");
    });
  });

  describe("the model", () => {
    it("is the one Remove background uses: asked for once, and not again for the other tool", async () => {
      const { deps, fetchImpl } = makeDeps();
      const askToDownload = vi.fn(async () => true);
      await blurBackground("photo", { askToDownload }, deps);
      expect(askToDownload).toHaveBeenCalledWith(spec);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      actions().undo();
      await removeBackground("photo", { askToDownload }, deps);
      expect(askToDownload).toHaveBeenCalledTimes(1);
    });

    it("is never downloaded without being asked about", async () => {
      const { deps, fetchImpl } = makeDeps();
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("not-installed");
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("when something goes wrong", () => {
    it("refuses a locked photo before it downloads or runs anything", async () => {
      openPhoto({ locked: true });
      const { deps, fetchImpl, client } = makeDeps();
      expect((await failureOf(blurBackground("photo", { askToDownload: async () => true }, deps))).code).toBe("locked");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(client.calls.run).toBe(0);
    });

    it("refuses a strength it does not know, before anything is downloaded or run", async () => {
      const { deps, fetchImpl, client } = makeDeps();
      const error = await failureOf(blurBackground("photo", { strength: "extreme" as never, askToDownload: async () => true }, deps));
      expect(error.code).toBe("runtime");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(client.calls.run).toBe(0);
      expect(useMlStore.getState().job).toBeNull();
    });

    it("works on one photo at a time", async () => {
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => (finish = resolve));
      const { deps } = makeDeps({ client: fakeClient({ during: () => gate }) });
      await install(deps);
      const first = blurBackground("photo", {}, deps);
      await vi.waitFor(() => expect(useMlStore.getState().job).not.toBeNull());
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("busy");
      finish();
      await expect(first).resolves.toMatchObject({ applied: true });
    });

    it("drops the result when the photo was replaced while the model was working, and leaves no stray picture", async () => {
      const before = (await listAssets()).length;
      const { deps } = makeDeps({ client: fakeClient({ during: () => void actions().replaceImage("photo", "asset:other", 200, 100) }) });
      await install(deps);
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("stale");
      expect(photo()!.src).toBe("asset:other");
      expect((await listAssets()).length).toBe(before);
    });

    it("stops when cancelled while the model works", async () => {
      const abort = new AbortController();
      const { deps } = makeDeps({ client: fakeClient({ during: () => abort.abort() }) });
      await install(deps);
      expect((await failureOf(blurBackground("photo", { signal: abort.signal }, deps))).code).toBe("aborted");
      expect(photo()!.src).toBe("asset:orig");
      expect(useMlStore.getState().job).toBeNull();
    });

    it("stops when cancelled while the pixels are being worked on, frees its canvas, and leaves no new picture", async () => {
      const before = (await listAssets()).length;
      const abort = new AbortController();
      const canvases: FakeCanvas[] = [];
      const { deps } = makeDeps({
        createResultCanvas: (width, height) => {
          const canvas = fakeCanvas(width, height);
          const put = canvas.put;
          canvas.put = (...args) => {
            put(...args);
            abort.abort(); // the person presses Cancel as the first piece is put on the canvas
          };
          canvases.push(canvas);
          return canvas;
        },
      });
      await install(deps);
      expect((await failureOf(blurBackground("photo", { signal: abort.signal }, deps))).code).toBe("aborted");
      expect(canvases[0]!.disposed).toBe(1);
      expect(canvases[0]!.finished).toBeUndefined();
      expect(photo()!.src).toBe("asset:orig");
      expect((await listAssets()).length).toBe(before);
      expect(useMlStore.getState().job).toBeNull();
    });

    it("can be cancelled through the store", async () => {
      const { deps } = makeDeps({ client: fakeClient({ during: () => void useMlStore.getState().job?.cancel() }) });
      await install(deps);
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("aborted");
    });

    it("frees its canvas when it finishes, and when the picture cannot be saved", async () => {
      const done = makeDeps();
      await install(done.deps);
      await blurBackground("photo", {}, done.deps);
      expect(done.canvases[0]!.disposed).toBe(1);

      actions().undo();
      const assets = await import("@/core/assets");
      vi.spyOn(assets, "addAssetFromBlob").mockRejectedValue(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
      const full = makeDeps();
      expect((await failureOf(blurBackground("photo", {}, full.deps))).code).toBe("quota");
      expect(full.canvases[0]!.disposed).toBe(1);
      expect(photo()!.src).toBe("asset:orig");
    });

    it("says what went wrong inside the worker, and the picture stays as it was", async () => {
      const { deps } = makeDeps({ client: fakeClient({ error: new MlError("out-of-memory") }) });
      await install(deps);
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("out-of-memory");
      expect(photo()!.src).toBe("asset:orig");
      expect(useMlStore.getState().job).toBeNull();
    });

    it("fails when the picture cannot be read", async () => {
      const { deps } = makeDeps({ loadSource: async () => null });
      await install(deps);
      expect((await failureOf(blurBackground("photo", {}, deps))).code).toBe("image");
    });

    it("only handles photos", async () => {
      const { deps } = makeDeps();
      expect((await failureOf(blurBackground("missing", {}, deps))).code).toBe("image");
    });
  });
});

/** A picture with colour in it, so there is something to take out: red grows to the right, green and blue wander. */
function colourful(width: number, height: number, alpha: (x: number, y: number) => number = () => 255): SourcePixels {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set([(x * 7) % 256, (y * 11 + 40) % 256, ((x + y) * 5) % 256, alpha(x, y)], (y * width + x) * 4);
  }
  return { rgba, width, height };
}

/** What the colour pop maths makes of `source` with the 2 x 2 mask the stand-in model gives (top half subject). */
function poppedBy(source: SourcePixels, style: PopStyle, mask: Uint8ClampedArray = SUBJECT): Uint8ClampedArray {
  const copy = { ...source, rgba: source.rgba.slice() };
  popColourBehindSubject(copy, { data: mask, size: 2 }, popAmount(style));
  return copy.rgba;
}

describe("colourPop", () => {
  it("takes the colour out of everything but the subject", async () => {
    const source = colourful(200, 100);
    const { deps, canvases } = makeDeps({ picture: source });
    await install(deps);
    const result = await colourPop("photo", {}, deps);
    expect(result).toEqual({ applied: true, scaled: false, width: 200, height: 100 });
    const canvas = canvases[0]!;
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(Array.from(canvas.rgba)).toEqual(Array.from(poppedBy(source, "black-and-white")));
    // the top rows are all subject: untouched. The bottom rows are all background: grey (red = green = blue).
    expect(Array.from(canvas.rgba.subarray(0, 200 * 4 * 24))).toEqual(Array.from(source.rgba.subarray(0, 200 * 4 * 24)));
    for (let i = 200 * 4 * 80; i < canvas.rgba.length; i += 4) expect(canvas.rgba[i]).toBe(canvas.rgba[i + 1]);
  });

  it("goes all black and white unless told otherwise, and faded keeps some of the colour", async () => {
    const source = colourful(200, 100);
    await install(makeDeps().deps);
    const results: Record<string, Uint8ClampedArray> = {};
    for (const style of [undefined, "black-and-white", "faded"] as const) {
      openPhoto(); // a fresh photo for every try
      const { deps, canvases } = makeDeps({ picture: source });
      await colourPop("photo", style ? { style } : {}, deps);
      results[style ?? "default"] = canvases[0]!.rgba;
    }
    expect(Array.from(results.default!)).toEqual(Array.from(poppedBy(source, "black-and-white")));
    expect(Array.from(results["black-and-white"]!)).toEqual(Array.from(results.default!));
    expect(Array.from(results.faded!)).toEqual(Array.from(poppedBy(source, "faded")));
    const bottom = 200 * 4 * 90; // a row that is all background
    expect(results.faded![bottom]).not.toBe(results.faded![bottom + 1]); // some colour is left
  });

  it("replaces the picture, keeps the original, sets the size of the new picture, and is one undo step", async () => {
    const { deps } = makeDeps();
    await install(deps);
    await colourPop("photo", {}, deps);
    const now = photo()!;
    expect(now.src).toMatch(/^asset:/);
    expect(now.src).not.toBe("asset:orig");
    expect(now.originalSrc).toBe("asset:orig");
    expect(now).toMatchObject({ width: 200, height: 100, naturalWidth: 13, naturalHeight: 11 });
    expect(await getAsset(now.src!.slice(6))).toMatchObject({ kind: "image", mime: "image/png" });

    actions().undo();
    expect(photo()).toMatchObject({ src: "asset:orig", naturalWidth: 200, naturalHeight: 100 });
    expect(photo()!.originalSrc).toBeUndefined();
  });

  it("names the new file after the old one, once, however many tools the photo went through", async () => {
    await install(makeDeps().deps);
    for (const [from, expected] of [
      ["Beach", "Beach (colour pop)"],
      ["Beach (colour pop)", "Beach (colour pop)"],
      ["Beach (blurred)", "Beach (colour pop)"],
      ["Beach (2x)", "Beach (colour pop)"],
      ["Beach (no background)", "Beach (colour pop)"],
    ] as const) {
      const original = await addAssetFromBlob(new Blob(["x"], { type: "image/png" }), from);
      openPhoto({ src: `asset:${original.id}` });
      await colourPop("photo", {}, makeDeps({ picture: colourful(40, 30) }).deps);
      const names = (await listAssets()).map((a) => a.name);
      expect(names).toContain(expected);
      expect(names.some((name) => /\(colour pop\) \(colour pop\)/.test(name))).toBe(false);
    }
  });

  it("names the steps of the work, and is idle again afterwards", async () => {
    const { deps } = makeDeps({ picture: colourful(40, 30) });
    await install(deps);
    const stages: string[] = [];
    const stop = useMlStore.subscribe((state) => {
      const stage = state.job?.stage;
      if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
    });
    await colourPop("photo", {}, deps);
    stop();
    expect(stages).toEqual(["preparing", "runtime", "inference", "finishing"]);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("keeps the first picture as the original through every tool", async () => {
    openPhoto({ src: "asset:second", originalSrc: "asset:first" });
    const { deps } = makeDeps({ picture: colourful(40, 30) });
    await install(deps);
    await colourPop("photo", {}, deps);
    expect(photo()!.originalSrc).toBe("asset:first");
  });

  it("saves a JPEG photograph as a JPEG, and anything else as a PNG", async () => {
    const jpeg = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }), "Beach");
    openPhoto({ src: `asset:${jpeg.id}` });
    const first = makeDeps({ picture: colourful(40, 30) });
    await install(first.deps);
    await colourPop("photo", {}, first.deps);
    expect(first.canvases[0]!.finished!.jpeg).toBe(true);
    expect((await getAsset(photo()!.src!.slice(6)))!.mime).toBe("image/jpeg");

    openPhoto();
    const second = makeDeps({ picture: colourful(40, 30) });
    await colourPop("photo", {}, second.deps);
    expect(second.canvases[0]!.finished!.jpeg).toBe(false);
  });

  it("keeps the opacity of every pixel, and a picture with transparency is never saved as a JPEG", async () => {
    const jpeg = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }), "Cutout");
    openPhoto({ src: `asset:${jpeg.id}` });
    const source = colourful(200, 100, (x, y) => (x < 10 ? 0 : y > 90 ? 128 : 255));
    const { deps, canvases } = makeDeps({ picture: source });
    await install(deps);
    await colourPop("photo", {}, deps);
    expect(canvases[0]!.finished!.jpeg).toBe(false);
    for (let i = 3; i < source.rgba.length; i += 4) expect(canvases[0]!.rgba[i]).toBe(source.rgba[i]);
  });

  it("works on a photo that was reduced to the pixel budget, and says so", async () => {
    const source = { ...colourful(150, 75), scaled: true };
    const readPixels = vi.fn(() => source);
    const { deps } = makeDeps({ readPixels });
    await install(deps);
    expect(await colourPop("photo", {}, deps)).toEqual({ applied: true, scaled: true, width: 150, height: 75 });
    expect(readPixels).toHaveBeenCalledWith(PHOTO, 25_000_000);
    expect(photo()).toMatchObject({ naturalWidth: 150, naturalHeight: 75 });
  });

  it("puts a tall picture together in pieces, with the same result as in one go", async () => {
    const source = colourful(1, 300_000);
    const { deps, canvases } = makeDeps({ picture: source });
    await install(deps);
    await colourPop("photo", {}, deps);
    const canvas = canvases[0]!;
    expect(canvas.puts.length).toBeGreaterThan(1);
    let next = 0;
    for (const put of canvas.puts) {
      expect(put.y).toBe(next);
      next += put.height;
    }
    expect(next).toBe(300_000);
    const expected = poppedBy(source, "black-and-white");
    expect(canvas.rgba.every((value, i) => value === expected[i])).toBe(true);
  });

  it("gives the browser a turn now and then while it works on the pixels, and not otherwise", async () => {
    const quick = makeDeps({ picture: colourful(40, 30) });
    await install(quick.deps);
    await colourPop("photo", {}, quick.deps);
    expect(quick.deps.yieldToBrowser).not.toHaveBeenCalled();

    openPhoto();
    let clock = 0;
    const slow = makeDeps({ picture: colourful(40, 30), now: () => (clock += 100) });
    await colourPop("photo", {}, slow.deps);
    expect(slow.deps.yieldToBrowser).toHaveBeenCalled();
    expect(photo()!.originalSrc).toBe("asset:orig");
  });

  describe("the mask the model found", () => {
    it("is shared with Blur background and Remove background: one wait for the model for all three", async () => {
      const { deps, client } = makeDeps({ picture: colourful(40, 30) });
      await install(deps);
      await colourPop("photo", {}, deps);
      expect(client.calls.run).toBe(1);
      actions().undo();
      await blurBackground("photo", {}, deps);
      actions().undo();
      await removeBackground("photo", {}, deps);
      expect(client.calls.run).toBe(1);
    });

    it("is not used for another picture", async () => {
      const { deps, client } = makeDeps({ picture: colourful(40, 30) });
      await install(deps);
      await colourPop("photo", {}, deps);
      actions().replaceImage("photo", "asset:other", 200, 100);
      await colourPop("photo", {}, deps);
      expect(client.calls.run).toBe(2);
    });
  });

  describe("when there is nothing to change", () => {
    it("says so and changes nothing when the whole photo is subject, without even reading the picture", async () => {
      const before = (await listAssets()).length;
      const readPixels = vi.fn(() => colourful(13, 11));
      const { deps, canvases } = makeDeps({ client: fakeClient({ mask: new Uint8ClampedArray([255, 255, 255, 255]) }), readPixels });
      await install(deps);
      expect(await colourPop("photo", {}, deps)).toEqual({ applied: false, reason: "whole-photo" });
      expect(photo()!.src).toBe("asset:orig");
      expect((await listAssets()).length).toBe(before);
      expect(canvases).toHaveLength(0);
      expect(readPixels).not.toHaveBeenCalled();
    });

    it("says that no subject was found, and changes nothing", async () => {
      const { deps } = makeDeps({ client: fakeClient({ mask: new Uint8ClampedArray(4) }) });
      await install(deps);
      expect((await failureOf(colourPop("photo", {}, deps))).code).toBe("no-subject");
      expect(photo()!.src).toBe("asset:orig");
    });

    it.each([
      ["a background that is grey already", () => checker(200, 100)],
      [
        "a background that is grey, with colour only in the subject's own soft outline",
        () => {
          const p = colourful(200, 100); // rows 25 to 49 are the subject side of the outline: the model's coverage fades there, and the colour of those rows fades with it
          for (let y = 50; y < 100; y++) for (let x = 0; x < 200; x++) p.rgba.set([120, 120, 120, 255], (y * 200 + x) * 4);
          return p;
        },
      ],
      // the 2 x 2 mask of the stand-in model fades over the middle half of the picture: the rows above 25 are all subject, so the surround starts there
      ["a surround that is transparent", () => colourful(200, 100, (_x, y) => (y < 25 ? 255 : 0))],
      ["only the faint rim of a cut-out around the subject", () => colourful(200, 100, (_x, y) => (y < 25 ? 255 : y < 28 ? 40 : 0))],
    ])("says there is no colour to take out of %s, and leaves no new picture", async (_what, make) => {
      const before = (await listAssets()).length;
      const { deps, canvases } = makeDeps({ picture: make() });
      await install(deps);
      expect(await colourPop("photo", {}, deps)).toEqual({ applied: false, reason: "no-colour" });
      expect(photo()!.src).toBe("asset:orig");
      expect((await listAssets()).length).toBe(before);
      expect(canvases.every((c) => c.finished === undefined && c.disposed === 1)).toBe(true); // painted for nothing, and let go
      expect(useMlStore.getState().job).toBeNull();
    });
  });

  describe("the model", () => {
    it("is the one Remove background and Blur background use: asked for once, and not again for the others", async () => {
      const { deps, fetchImpl } = makeDeps({ picture: colourful(40, 30) });
      const askToDownload = vi.fn(async () => true);
      await colourPop("photo", { askToDownload }, deps);
      expect(askToDownload).toHaveBeenCalledWith(spec);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      actions().undo();
      await blurBackground("photo", { askToDownload }, deps);
      expect(askToDownload).toHaveBeenCalledTimes(1);
    });

    it("is never downloaded without being asked about", async () => {
      const { deps, fetchImpl } = makeDeps();
      expect((await failureOf(colourPop("photo", {}, deps))).code).toBe("not-installed");
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("when something goes wrong", () => {
    it("refuses a locked photo before it downloads or runs anything", async () => {
      openPhoto({ locked: true });
      const { deps, fetchImpl, client } = makeDeps();
      expect((await failureOf(colourPop("photo", { askToDownload: async () => true }, deps))).code).toBe("locked");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(client.calls.run).toBe(0);
    });

    it("refuses a style it does not know, before anything is downloaded or run", async () => {
      const { deps, fetchImpl, client } = makeDeps();
      const error = await failureOf(colourPop("photo", { style: "sepia" as never, askToDownload: async () => true }, deps));
      expect(error.code).toBe("runtime");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(client.calls.run).toBe(0);
      expect(useMlStore.getState().job).toBeNull();
    });

    it("works on one photo at a time", async () => {
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => (finish = resolve));
      const { deps } = makeDeps({ client: fakeClient({ during: () => gate }), picture: colourful(40, 30) });
      await install(deps);
      const first = colourPop("photo", {}, deps);
      await vi.waitFor(() => expect(useMlStore.getState().job).not.toBeNull());
      expect((await failureOf(colourPop("photo", {}, deps))).code).toBe("busy");
      finish();
      await expect(first).resolves.toMatchObject({ applied: true });
    });

    it("drops the result when the photo was replaced while the model was working, and leaves no stray picture", async () => {
      const before = (await listAssets()).length;
      const { deps } = makeDeps({ client: fakeClient({ during: () => void actions().replaceImage("photo", "asset:other", 200, 100) }), picture: colourful(40, 30) });
      await install(deps);
      expect((await failureOf(colourPop("photo", {}, deps))).code).toBe("stale");
      expect(photo()!.src).toBe("asset:other");
      expect((await listAssets()).length).toBe(before);
    });

    it("stops when cancelled while the model works", async () => {
      const abort = new AbortController();
      const { deps } = makeDeps({ client: fakeClient({ during: () => abort.abort() }) });
      await install(deps);
      expect((await failureOf(colourPop("photo", { signal: abort.signal }, deps))).code).toBe("aborted");
      expect(photo()!.src).toBe("asset:orig");
      expect(useMlStore.getState().job).toBeNull();
    });

    it("stops when cancelled while the pixels are being worked on, frees its canvas, and leaves no new picture", async () => {
      const before = (await listAssets()).length;
      const abort = new AbortController();
      const canvases: FakeCanvas[] = [];
      const { deps } = makeDeps({
        picture: colourful(40, 30),
        createResultCanvas: (width, height) => {
          const canvas = fakeCanvas(width, height);
          const put = canvas.put;
          canvas.put = (...args) => {
            put(...args);
            abort.abort(); // the person presses Cancel as the first piece is put on the canvas
          };
          canvases.push(canvas);
          return canvas;
        },
      });
      await install(deps);
      expect((await failureOf(colourPop("photo", { signal: abort.signal }, deps))).code).toBe("aborted");
      expect(canvases[0]!.disposed).toBe(1);
      expect(canvases[0]!.finished).toBeUndefined();
      expect(photo()!.src).toBe("asset:orig");
      expect((await listAssets()).length).toBe(before);
      expect(useMlStore.getState().job).toBeNull();
    });

    it("frees its canvas when it finishes, and when the picture cannot be saved", async () => {
      const done = makeDeps({ picture: colourful(40, 30) });
      await install(done.deps);
      await colourPop("photo", {}, done.deps);
      expect(done.canvases[0]!.disposed).toBe(1);

      actions().undo();
      const assets = await import("@/core/assets");
      vi.spyOn(assets, "addAssetFromBlob").mockRejectedValue(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
      const full = makeDeps({ picture: colourful(40, 30) });
      expect((await failureOf(colourPop("photo", {}, full.deps))).code).toBe("quota");
      expect(full.canvases[0]!.disposed).toBe(1);
      expect(photo()!.src).toBe("asset:orig");
    });

    it("says what went wrong inside the worker, and the picture stays as it was", async () => {
      const { deps } = makeDeps({ client: fakeClient({ error: new MlError("out-of-memory") }) });
      await install(deps);
      expect((await failureOf(colourPop("photo", {}, deps))).code).toBe("out-of-memory");
      expect(photo()!.src).toBe("asset:orig");
      expect(useMlStore.getState().job).toBeNull();
    });

    it("fails when the picture cannot be read, and only handles photos", async () => {
      const { deps } = makeDeps({ loadSource: async () => null });
      await install(deps);
      expect((await failureOf(colourPop("photo", {}, deps))).code).toBe("image");
      expect((await failureOf(colourPop("missing", {}, deps))).code).toBe("image");
    });
  });
});

describe("the tool that asked for a download", () => {
  /** Starts `job`, holds its download in the middle, reads who asked for it, and lets it go on. */
  async function whoAsked(start: (deps: MlDeps) => Promise<unknown>, modelRepo: string): Promise<string | undefined> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchImpl = vi.fn(async (url: unknown) => {
      await gate;
      return bytesResponse(url);
    }) as unknown as typeof fetch;
    const { deps } = makeDeps({ fetchImpl });
    const job = start(deps);
    const id = modelRepo === upSpec.repo ? upSpec.id : spec.id;
    await vi.waitFor(() => expect(useMlStore.getState().installing[id]).toBeDefined());
    const asked = useMlStore.getState().installing[id]!.requestedBy;
    release();
    await job;
    return asked;
  }

  it("is written in the install, so the screen can show the download under that tool: a cut-out", async () => {
    expect(await whoAsked((deps) => removeBackground("photo", { askToDownload: async () => true }, deps), spec.repo)).toBe("remove-background");
  });

  it("is written in the install: a blur", async () => {
    expect(await whoAsked((deps) => blurBackground("photo", { askToDownload: async () => true }, deps), spec.repo)).toBe("blur-background");
  });

  it("is written in the install: an upscale", async () => {
    expect(await whoAsked((deps) => upscale("photo", { factor: 2, askToDownload: async () => true }, deps), upSpec.repo)).toBe("upscale");
  });

  it("is written in the install: a colour pop", async () => {
    expect(await whoAsked((deps) => colourPop("photo", { askToDownload: async () => true }, deps), spec.repo)).toBe("colour-pop");
  });

  it("is not made up when nobody asked: a download from the models dialog has no tool", async () => {
    expect(await whoAsked((deps) => installModel(spec.id, { warm: false }, deps), spec.repo)).toBeUndefined();
  });
});

describe("restoreOriginal", () => {
  it("puts the original back as one undo step", async () => {
    openPhoto({ src: "asset:cutout", originalSrc: "asset:orig" });
    const original = new Image();
    Object.defineProperty(original, "naturalWidth", { value: 300 });
    Object.defineProperty(original, "naturalHeight", { value: 150 });
    const { deps } = makeDeps({ loadSource: async (src) => (src === "asset:orig" ? original : null) });
    await restoreOriginal("photo", deps);
    expect(photo()!.src).toBe("asset:orig");
    expect(photo()!.originalSrc).toBeUndefined();
    expect(photo()).toMatchObject({ naturalWidth: 300, naturalHeight: 150 }); // measured from the picture that came back
    actions().undo();
    expect(photo()).toMatchObject({ src: "asset:cutout", originalSrc: "asset:orig" });
  });

  it("does not restore onto a locked photo", async () => {
    openPhoto({ src: "asset:cutout", originalSrc: "asset:orig", locked: true });
    const { deps } = makeDeps();
    expect((await failureOf(restoreOriginal("photo", deps))).code).toBe("locked");
    expect(photo()).toMatchObject({ src: "asset:cutout", originalSrc: "asset:orig" });
  });

  it("keeps the cut-out when the original is no longer there to restore", async () => {
    openPhoto({ src: "asset:cutout", originalSrc: "asset:orig" });
    const { deps } = makeDeps({ loadSource: async () => null });
    expect((await failureOf(restoreOriginal("photo", deps))).code).toBe("image");
    expect(photo()).toMatchObject({ src: "asset:cutout", originalSrc: "asset:orig" });
  });

  it("does nothing for a photo that was never cut out", async () => {
    const { deps } = makeDeps();
    await restoreOriginal("photo", deps);
    expect(photo()!.src).toBe("asset:orig");
  });
});

describe("upscale", () => {
  // 13 x 11 pixels in tiles of 8 with 1 pixel of context: 3 columns and 2 rows of tiles
  const SIX = 6;

  it.each([2, 4])("makes the picture %dx larger tile by tile, and the tiles meet exactly", async (factor) => {
    const source = gradient(13, 11);
    const { deps, canvases } = makeDeps({ picture: source });
    await installUp(deps);
    const result = await upscale("photo", { factor }, deps);
    expect(result).toEqual({ factor, width: 13 * factor, height: 11 * factor });
    const canvas = canvases[0]!;
    expect([canvas.width, canvas.height]).toEqual([13 * factor, 11 * factor]);
    expect(canvas.puts).toHaveLength(SIX);
    // every pixel of the result is where the nearest-neighbour picture has it: nothing is missing, doubled or shifted
    expect(Array.from(canvas.rgba)).toEqual(Array.from(nearest(source, factor)));
  });

  it("gives each tile the surroundings of its part of the picture, mirrored at the picture's edge", async () => {
    const source = gradient(13, 11);
    const client = fakeClient();
    const { deps } = makeDeps({ picture: source, client });
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    // 13 = 5 + 4 + 4 in tiles of 5 + 2 context = 7 wide; the first tile starts one pixel left of the picture
    const first = client.tiles[0]!;
    expect(first).toHaveLength(3 * 7 * 8);
    const reds = Array.from(first.subarray(0, 7)).map((v) => Math.round(v * 255));
    expect(reds).toEqual([0, 0, 10, 20, 30, 40, 50]); // the mirrored pixel -1 is pixel 0 again
  });

  it("replaces the picture, keeps the original, sets the new size of the picture, and is one undo step", async () => {
    const { deps } = makeDeps();
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    const now = photo()!;
    expect(now.src).toMatch(/^asset:/);
    expect(now.src).not.toBe("asset:orig");
    expect(now.originalSrc).toBe("asset:orig");
    // the picture on the page stays as large as it was: only the picture behind it has more pixels
    expect(now).toMatchObject({ width: 200, height: 100, naturalWidth: 26, naturalHeight: 22 });
    const saved = await getAsset(now.src!.slice(6));
    expect(saved).toMatchObject({ kind: "image", mime: "image/png" });

    actions().undo();
    expect(photo()).toMatchObject({ src: "asset:orig", naturalWidth: 200, naturalHeight: 100 });
    expect(photo()!.originalSrc).toBeUndefined();
  });

  it("names the new file after the old one, with how many times larger it is", async () => {
    const original = await addAssetFromBlob(new Blob(["x"], { type: "image/png" }), "Beach");
    openPhoto({ src: `asset:${original.id}` });
    const { deps } = makeDeps();
    await installUp(deps);
    await upscale("photo", { factor: 4 }, deps);
    expect((await listAssets()).map((a) => a.name)).toContain("Beach (4x)");
  });

  it("does not stack the suffixes of earlier tools onto the name", async () => {
    const original = await addAssetFromBlob(new Blob(["x"], { type: "image/png" }), "Beach (no background) (2x)");
    openPhoto({ src: `asset:${original.id}` });
    const { deps } = makeDeps();
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    expect((await listAssets()).map((a) => a.name)).toContain("Beach (2x)");
  });

  it("keeps the very first picture as the original when an earlier tool had changed the photo", async () => {
    openPhoto({ src: "asset:second", originalSrc: "asset:first" });
    const { deps } = makeDeps();
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    expect(photo()!.originalSrc).toBe("asset:first");
  });

  it("can put the original back afterwards, as the cut-out tool's Restore does", async () => {
    const { deps } = makeDeps({ loadSource: async () => PHOTO });
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    await restoreOriginal("photo", deps);
    expect(photo()).toMatchObject({ src: "asset:orig", naturalWidth: 200, naturalHeight: 100 });
  });

  it("reports each step of the work while the job runs, and is idle again afterwards", async () => {
    const { deps } = makeDeps();
    await installUp(deps);
    const stages: string[] = [];
    const stop = useMlStore.subscribe((state) => {
      const stage = state.job?.stage;
      if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
    });
    await upscale("photo", { factor: 2 }, deps);
    stop();
    // the engine's own steps (runtime, model) are reported for the first tile only: after that they are no news
    expect(stages).toEqual(["preparing", "runtime", "model", "inference", "finishing"]);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("says which job is running, and how far it has come and how long is left, once it can tell", async () => {
    let clock = 0;
    // the first tile also starts the engine and builds the session, which the others do not: it must not set the pace
    const { deps } = makeDeps({ client: fakeClient({ onTile: (n) => void (clock += n === 1 ? 3000 : 500) }), now: () => clock });
    await installUp(deps);
    const seen: Array<[string | undefined, number | undefined, number | undefined]> = [];
    const stop = useMlStore.subscribe((state) => {
      const job = state.job;
      if (job?.progress === undefined) return;
      const last = seen[seen.length - 1];
      if (!last || last[1] !== job.progress) seen.push([job.kind, job.progress, job.remainingMs]); // a change of stage is not a step
    });
    await upscale("photo", { factor: 2 }, deps);
    stop();
    expect(seen).toEqual([
      ["upscale", 1 / 6, undefined], // the first tile is no basis for a guess
      ["upscale", 2 / 6, undefined], // nor is one tile after it
      ["upscale", 3 / 6, 1500],
      ["upscale", 4 / 6, 1000],
      ["upscale", 5 / 6, 500],
      ["upscale", 1, 0],
    ]);
  });

  it("lets the model see the colours of a transparent picture, not the black it is stored with, and hands the opacity to the end", async () => {
    // left half solid red, right half fully transparent and stored as black
    const picture = gradient(13, 11, 0);
    for (let i = 0; i < picture.width * picture.height; i++) {
      const x = i % picture.width;
      picture.rgba.set(x < 6 ? [200, 0, 0, 255] : [0, 0, 0, 0], i * 4);
    }
    const client = fakeClient();
    const { deps, canvases } = makeDeps({ picture, client });
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    for (const tile of client.tiles) {
      const reds = Array.from(tile.subarray(0, tile.length / 3));
      expect(Math.min(...reds)).toBeCloseTo(200 / 255, 5); // no black anywhere: the red went on into the transparent half
    }
    const finished = canvases[0]!.finished!;
    expect(finished.matte).toMatchObject({ width: 13, height: 11 });
    const opacity = Array.from(finished.matte!.rgba).filter((_, i) => i % 4 === 3);
    expect(opacity).toEqual(Array.from({ length: 13 * 11 }, (_, i) => (i % 13 < 6 ? 255 : 0)));
    expect(finished.jpeg).toBeFalsy();
    const saved = await getAsset(photo()!.src!.slice(6));
    expect(saved!.mime).toBe("image/png");
  });

  it("gives a solid picture no opacity to restore", async () => {
    const { deps, canvases } = makeDeps();
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    expect(canvases[0]!.finished!.matte).toBeUndefined();
  });

  it("saves a JPEG photograph as a JPEG, and anything else as a PNG", async () => {
    const jpeg = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }), "Beach");
    openPhoto({ src: `asset:${jpeg.id}` });
    const first = makeDeps();
    await installUp(first.deps);
    await upscale("photo", { factor: 2 }, first.deps);
    expect(first.canvases[0]!.finished!.jpeg).toBe(true);
    expect((await getAsset(photo()!.src!.slice(6)))!.mime).toBe("image/jpeg");

    const png = await addAssetFromBlob(new Blob(["x"], { type: "image/png" }), "Logo");
    openPhoto({ src: `asset:${png.id}` });
    const second = makeDeps();
    await upscale("photo", { factor: 2 }, second.deps);
    expect(second.canvases[0]!.finished!.jpeg).toBe(false);
  });

  it("never saves a picture with transparency as a JPEG", async () => {
    const jpeg = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }), "Cutout");
    openPhoto({ src: `asset:${jpeg.id}` });
    const { deps, canvases } = makeDeps({ picture: gradient(13, 11, 100) });
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    expect(canvases[0]!.finished!.jpeg).toBe(false);
  });

  it("does not download anything on its own", async () => {
    const { deps, fetchImpl } = makeDeps();
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("not-installed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(photo()!.src).toBe("asset:orig");
  });

  it("downloads first when the person agrees, then goes on to make the picture larger", async () => {
    const { deps, fetchImpl } = makeDeps();
    const askToDownload = vi.fn(async () => true);
    await upscale("photo", { factor: 2, askToDownload }, deps);
    expect(askToDownload).toHaveBeenCalledWith(upSpec);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("skillsafe-ai/realesr-general-x4v3");
    expect(photo()!.originalSrc).toBe("asset:orig");
  });

  it("stops quietly when the person declines the download", async () => {
    const { deps, fetchImpl } = makeDeps();
    expect((await failureOf(upscale("photo", { factor: 2, askToDownload: async () => false }, deps))).code).toBe("aborted");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(useMlStore.getState().job).toBeNull();
  });

  it("checks the browser before it asks the person for anything", async () => {
    const { deps } = makeDeps({ support: async () => ({ ok: false, reason: "no-webgpu", message: "No WebGPU." }) });
    const askToDownload = vi.fn(async () => true);
    expect((await failureOf(upscale("photo", { factor: 2, askToDownload }, deps))).code).toBe("unsupported");
    expect(askToDownload).not.toHaveBeenCalled();
  });

  it("refuses a locked photo before it downloads or runs anything", async () => {
    openPhoto({ locked: true });
    const { deps, fetchImpl, client } = makeDeps();
    expect((await failureOf(upscale("photo", { factor: 2, askToDownload: async () => true }, deps))).code).toBe("locked");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.calls.tile).toBe(0);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("refuses to work on a design that can only be viewed", async () => {
    useEditor.setState({ mode: "view" });
    const { deps, fetchImpl } = makeDeps();
    expect((await failureOf(upscale("photo", { factor: 2, askToDownload: async () => true }, deps))).code).toBe("locked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a result that would be larger than 25 megapixels before it asks for a download, going by the photo's size", async () => {
    openPhoto({ naturalWidth: 3000, naturalHeight: 2000 }); // 12000 x 8000 at 4x: 96 megapixels
    const { deps, fetchImpl, client } = makeDeps();
    const askToDownload = vi.fn(async () => true);
    expect((await failureOf(upscale("photo", { factor: 4, askToDownload }, deps))).code).toBe("too-large");
    expect(askToDownload).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.calls.tile).toBe(0);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("checks the size of the picture it actually read as well, in case the photo's recorded size was wrong", async () => {
    const { deps, client, canvases } = makeDeps({ picture: { rgba: new Uint8ClampedArray(4), width: 3000, height: 2000 } });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 4 }, deps))).code).toBe("too-large");
    expect(client.calls.tile).toBe(0);
    expect(canvases).toHaveLength(0); // no canvas of 96 megapixels is ever made
  });

  it("only makes pictures two or four times larger, which the model can give", async () => {
    const { deps, client } = makeDeps();
    await installUp(deps);
    for (const factor of [1, 3, 8, 0.5]) expect((await failureOf(upscale("photo", { factor }, deps))).code, `factor ${factor}`).toBe("runtime");
    expect(client.calls.tile).toBe(0);
    expect(useMlStore.getState().job).toBeNull();
  });

  it("explains that a vector picture needs no upscaling", async () => {
    const logo = await addAssetFromBlob(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>'], { type: "image/svg+xml" }), "Logo");
    openPhoto({ src: `asset:${logo.id}` });
    const { deps, fetchImpl } = makeDeps();
    const error = await failureOf(upscale("photo", { factor: 2, askToDownload: async () => true }, deps));
    expect(error.code).toBe("image");
    expect(error.message).toMatch(/vector/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops the result when the photo was replaced while the model was working, and leaves no stray picture", async () => {
    const before = (await listAssets()).length;
    const client = fakeClient({ onTile: (n) => void (n === 3 && actions().replaceImage("photo", "asset:other", 200, 100)) });
    const { deps } = makeDeps({ client });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("stale");
    expect(photo()!.src).toBe("asset:other");
    expect(photo()!.originalSrc).toBeUndefined();
    expect((await listAssets()).length).toBe(before);
  });

  it("does not report success when the photo was locked while the model worked, and leaves no stray picture", async () => {
    const before = (await listAssets()).length;
    const client = fakeClient({ onTile: (n) => void (n === 2 && actions().updateElements(["photo"], { locked: true })) });
    const { deps } = makeDeps({ client });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("locked");
    expect(photo()!.src).toBe("asset:orig");
    expect((await listAssets()).length).toBe(before);
  });

  it("puts the result on the page the photo is on, even when the person has turned to another page meanwhile", async () => {
    const photoOnA = createImage({ id: "photo", src: "asset:orig", width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 });
    actions().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "pa", elements: [photoOnA] }), createPage({ id: "pb", elements: [] })] }));
    const { deps } = makeDeps({ client: fakeClient({ onTile: (n) => void (n === 1 && actions().setActivePage("pb")) }) });
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    expect(useEditor.getState().activePageId).toBe("pb");
    const onA = findElement(pageOf(useEditor.getState().design, "pa")!, "photo") as ImageElement;
    expect(onA.originalSrc).toBe("asset:orig");
    expect(onA.src).not.toBe("asset:orig");
  });

  it("stops when cancelled in the middle of the tiles, and leaves nothing behind", async () => {
    const before = (await listAssets()).length;
    const abort = new AbortController();
    const client = fakeClient({ onTile: (n) => void (n === 3 && abort.abort()) });
    const { deps, canvases } = makeDeps({ client });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2, signal: abort.signal }, deps))).code).toBe("aborted");
    expect(client.calls.tile).toBe(3); // the tiles after the one that was cut short are never started
    expect(photo()!.src).toBe("asset:orig");
    expect((await listAssets()).length).toBe(before);
    expect(useMlStore.getState().job).toBeNull();
    expect(canvases[0]!.disposed).toBe(1);
  });

  it("stops when cancelled just after the last tile came back, before the file is made", async () => {
    const before = (await listAssets()).length;
    const abort = new AbortController();
    const client = fakeClient({ afterTile: (n) => void (n === SIX && abort.abort()) });
    const { deps, canvases } = makeDeps({ client });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2, signal: abort.signal }, deps))).code).toBe("aborted");
    expect(canvases[0]!.finished).toBeUndefined();
    expect((await listAssets()).length).toBe(before);
  });

  it("lets the person cancel through the store as well", async () => {
    const { deps } = makeDeps({ client: fakeClient({ onTile: (n) => void (n === 2 && useMlStore.getState().job?.cancel()) }) });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("aborted");
  });

  it("says the disk is full when the new picture cannot be saved, not that the model failed", async () => {
    const assets = await import("@/core/assets");
    vi.spyOn(assets, "addAssetFromBlob").mockRejectedValue(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
    const { deps } = makeDeps();
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("quota");
    expect(photo()!.src).toBe("asset:orig");
  });

  it("passes on what went wrong inside the worker, and lets go of the canvas", async () => {
    const { deps, canvases } = makeDeps({ client: fakeClient({ tileError: new MlError("out-of-memory") }) });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("out-of-memory");
    expect(useMlStore.getState().job).toBeNull();
    expect(photo()!.src).toBe("asset:orig");
    expect(canvases[0]!.disposed).toBe(1);
  });

  it("writes the technical cause to the console when a job fails, so it can be reported", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps } = makeDeps({ client: fakeClient({ tileError: new MlError("runtime", undefined, { cause: "Error: the output is not a number (NaN)" }) }) });
    await installUp(deps);
    await failureOf(upscale("photo", { factor: 2 }, deps));
    expect(warn).toHaveBeenCalledTimes(1);
    const text = warn.mock.calls[0]!.map(String).join(" ");
    expect(text).toContain("Upscale");
    expect(text).toContain("NaN");
  });

  it("lets go of the canvas after a success too", async () => {
    const { deps, canvases } = makeDeps();
    await installUp(deps);
    await upscale("photo", { factor: 2 }, deps);
    expect(canvases[0]!.disposed).toBe(1);
  });

  it("works on one photo at a time", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { deps } = makeDeps({ client: fakeClient({ onTile: (n) => (n === 1 ? gate : undefined) }) });
    await installUp(deps);
    const first = upscale("photo", { factor: 2 }, deps);
    await vi.waitFor(() => expect(useMlStore.getState().job).not.toBeNull());
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("busy");
    expect((await failureOf(removeBackground("photo", {}, deps))).code).toBe("busy"); // the two tools share one job at a time
    finish();
    await expect(first).resolves.toMatchObject({ factor: 2 });
  });

  it("only handles photos", async () => {
    const { deps } = makeDeps();
    expect((await failureOf(upscale("missing", { factor: 2 }, deps))).code).toBe("image");
    openPhoto({ src: null });
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("image");
  });

  it("fails when the picture cannot be read", async () => {
    const { deps } = makeDeps({ loadSource: async () => null });
    await installUp(deps);
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("image");
    const { deps: broken } = makeDeps({
      readPixels: () => {
        throw new MlError("image");
      },
    });
    expect((await failureOf(upscale("photo", { factor: 2 }, broken))).code).toBe("image");
  });

  it("fails clearly when the registry has no model for the tool", async () => {
    const { deps } = makeDeps({ spec: () => undefined });
    expect((await failureOf(upscale("photo", { factor: 2 }, deps))).code).toBe("runtime");
    expect(useMlStore.getState().job).toBeNull();
  });
});

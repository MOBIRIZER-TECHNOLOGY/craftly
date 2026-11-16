/**
 * The jobs behind the Tools tab: installing a model, cutting a background out, making a picture larger, putting the
 * original picture back. This is the one place that knows the order of things (check the browser, find the model, read the
 * photo, run, apply). The screens only start a job and show `useMlStore`. Every slow or external piece arrives through
 * `MlDeps`, so the tests run all of it with stand-ins.
 */
import { addAssetFromBlob, assetSrc, deleteAsset, getAsset } from "@/core/assets";
import { findElement } from "@/core/ops";
import { useEditor } from "@/core/store";
import type { Asset, ID, ImageElement } from "@/core/types";
import { m } from "@/i18n";
import { loadImage, type Drawable } from "@/render/images";
import { BLUR_STRENGTHS, blurSigma, createBackgroundBlur, type BlurStrength } from "./blur";
import { sharedClient, type MlClient } from "./client";
import { createColourPop, MIN_CHANGED_SHARE, popAmount, POP_STYLES, type PopStyle } from "./colourPop";
import { createResultCanvas, cutOut, modelInput, readPixels, sizeOf, type SourcePixels, type ResultCanvas } from "./compose";
import { checkSupport, type Support } from "./device";
import { downloadModel, verifyModelBlob, type DownloadOptions } from "./download";
import type { WorkerModel } from "./engine";
import { asMlError, MlError } from "./errors";
import { MAX_OUTPUT_PIXELS } from "./limits";
import { deleteStoredModel, getStoredModel, isIntact, listInstalled, putStoredModel, requestPersistence, storageError, storageStatus, type StorageStatus } from "./modelStore";
import { maskToRgba, subjectShare } from "./pixels";
import { DEFAULT_MODEL, getModelSpec } from "./registry";
import { useMlStore, type InstallState, type JobKind } from "./state";
import { alphaOf, bleedColours, extractTile, hasTransparency, keepTile, planTiles, UPSCALE_FACTORS, upscaleChoices } from "./tiles";
import type { ImageToMaskIo, MlStage, MlTask, ModelId, ModelSpec } from "./types";

export interface MlDeps {
  client: MlClient;
  /** can this browser run `spec` (or, with none, the models in general)? */
  support(spec?: ModelSpec): Promise<Support>;
  loadSource(src: string): Promise<Drawable | null>;
  /** every pixel of a picture at its own size, or at the size that fits a budget of pixels when one is given */
  readPixels(source: Drawable, maxPixels?: number): SourcePixels;
  /** the canvas a result is put together on: the tiles of a larger picture, the rows of a blurred one */
  createResultCanvas(width: number, height: number): ResultCanvas;
  /** milliseconds on any clock that only goes forward: for the guess of how long a job still takes, and for when to give the screen a turn */
  now(): number;
  /** lets the browser draw and answer the person before a long piece of work goes on */
  yieldToBrowser(): Promise<void>;
  download(spec: ModelSpec, options: DownloadOptions): Promise<Blob>;
  /** asks the browser not to clear the stored models when space runs low */
  persist(): Promise<boolean>;
  storage(): Promise<StorageStatus>;
  spec(id: ModelId): ModelSpec | undefined;
  defaultModel(task: MlTask): ModelId;
}

/**
 * A turn of the browser's event loop. A message, not a timer: timers of a tab that is in the background are held back to one
 * a second or less, which would turn a job of a second into one of a minute if the person looked at another tab meanwhile.
 */
function nextTurn(): Promise<void> {
  if (typeof MessageChannel !== "function") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

export const defaultDeps = (): MlDeps => ({
  client: sharedClient(),
  support: (spec) => checkSupport(undefined, spec?.gpuFeatures),
  loadSource: loadImage,
  readPixels,
  createResultCanvas,
  now: () => performance.now(),
  yieldToBrowser: nextTurn,
  download: downloadModel,
  persist: () => requestPersistence(),
  storage: () => storageStatus(),
  spec: getModelSpec,
  defaultModel: (task) => DEFAULT_MODEL[task],
});

/** The person gets a plain sentence; the technical cause goes to the console, where a bug report can quote it. */
function report(what: string, error: unknown): void {
  const known = asMlError(error, "runtime");
  if (known.code !== "aborted") console.warn(`[craftly] ${what} failed (${known.code}):`, known.cause ?? known.message);
}

/** A download needs this much free space per byte of model: the browser keeps a copy while it checks the file. */
const ROOM_FACTOR = 1.2;
/** A mask covering less than this found no subject; more than the other bound, the whole photo is the subject. */
const NOTHING = 0.001;
const EVERYTHING = 0.999;

const workerModel = (spec: ModelSpec, blob: Blob): WorkerModel => ({ id: spec.id, sha256: spec.sha256, blob, io: spec.io });

/** An abort controller that also follows an outside signal. */
function linked(outside?: AbortSignal) {
  const controller = new AbortController();
  const follow = () => controller.abort();
  if (outside?.aborted) controller.abort();
  else outside?.addEventListener("abort", follow, { once: true });
  return { signal: controller.signal, abort: follow, dispose: () => outside?.removeEventListener("abort", follow) };
}

/** The stored copy of a model, if it is the file the registry pins right now. */
async function usableCopy(spec: ModelSpec) {
  const stored = await getStoredModel(spec.id);
  return stored && isIntact(stored, spec) ? stored : undefined;
}

/** Locked photos and view-only designs refuse every change: say so before any work is done. */
function canEdit(element: ImageElement): boolean {
  return !element.locked && useEditor.getState().mode !== "view";
}

/** A photo anywhere in the open design, with the page it is on. */
function locate(elementId: ID): { pageId: ID; element: ImageElement } | null {
  for (const page of useEditor.getState().design?.pages ?? []) {
    const found = findElement(page, elementId);
    if (found) return found.type === "image" ? { pageId: page.id, element: found } : null;
  }
  return null;
}

/* ---------------- what is installed ---------------- */

export async function refreshModels(deps: MlDeps = defaultDeps()): Promise<void> {
  // a browser that blocks storage shows an empty list; installing then fails with a message of its own
  const [stored, storage] = await Promise.all([listInstalled().catch(() => []), deps.storage().catch((): StorageStatus => ({}))]);
  // a model the registry no longer lists (an older version of the app stored it) would take up room for ever
  const known = stored.filter((model) => deps.spec(model.id));
  for (const stale of stored.filter((model) => !deps.spec(model.id))) await deleteStoredModel(stale.id).catch(() => undefined);
  useMlStore.setState({ installed: Object.fromEntries(known.map((model) => [model.id, model])), loaded: true, storage });
}

/**
 * Takes in a model file the person already has (an offline install). It must be exactly the pinned file. The engine is
 * prepared afterwards, so its runtime file is stored while there still is a connection.
 */
export async function importModelFile(id: ModelId, file: Blob, deps: MlDeps = defaultDeps()): Promise<InstallResult> {
  const spec = deps.spec(id);
  if (!spec) throw new MlError("runtime");
  await verifyModelBlob(spec, file);
  await putStoredModel(spec, file);
  void deps.persist().catch(() => undefined);
  await refreshModels(deps);
  return prepareEngine(spec, file, deps);
}

export async function removeModel(id: ModelId, deps: MlDeps = defaultDeps()): Promise<void> {
  await deleteStoredModel(id);
  forgetMasks(); // what the model found is only worth keeping while the model is there
  deps.client.release(); // the worker may be holding the model on the graphics card
  await refreshModels(deps);
}

/* ---------------- installing ---------------- */

export interface InstallOptions {
  signal?: AbortSignal;
  /** run the model once afterwards, which also caches the runtime file for offline use (default true) */
  warm?: boolean;
  /** the tool that needs the model, for the screen to show the download under it (none when the person chose to install it) */
  requestedBy?: JobKind;
}

export interface InstallResult {
  /** the model is installed, but running it once on this device failed */
  warmError?: MlError;
}

const setInstall = (id: ModelId, state: InstallState | undefined) => useMlStore.setState((s) => ({ installing: { ...s.installing, [id]: state } }));
const patchInstall = (id: ModelId, patch: Partial<InstallState>) =>
  useMlStore.setState((s) => {
    const current = s.installing[id];
    return current ? { installing: { ...s.installing, [id]: { ...current, ...patch } } } : s;
  });

/** Loads the runtime and the model once. Giving up on it (Cancel) leaves the installed model alone. */
async function prepareEngine(spec: ModelSpec, blob: Blob, deps: MlDeps, signal?: AbortSignal): Promise<InstallResult> {
  try {
    await deps.client.warm(workerModel(spec, blob), { signal });
    return {};
  } catch (error) {
    const known = asMlError(error, "runtime");
    if (known.code === "aborted") return {};
    report("Preparing the model", error);
    return { warmError: known };
  }
}

const installs = new Map<ModelId, Promise<InstallResult>>();

/** Downloads, checks and stores a model. Two callers asking for the same model share one download. */
export function installModel(id: ModelId, options: InstallOptions = {}, deps: MlDeps = defaultDeps()): Promise<InstallResult> {
  const shared = installs.get(id);
  if (shared) return shared;
  const job = runInstall(id, options, deps).finally(() => installs.delete(id));
  installs.set(id, job);
  return job;
}

async function runInstall(id: ModelId, options: InstallOptions, deps: MlDeps): Promise<InstallResult> {
  const spec = deps.spec(id);
  if (!spec) throw new MlError("runtime");
  const support = await deps.support(spec);
  if (!support.ok) throw new MlError("unsupported", support.message);
  const { usage, quota } = await deps.storage().catch((): StorageStatus => ({}));
  if (usage !== undefined && quota !== undefined && quota - usage < spec.bytes * ROOM_FACTOR) throw new MlError("quota");

  const control = linked(options.signal);
  setInstall(id, { phase: "downloading", received: 0, total: spec.bytes, requestedBy: options.requestedBy, cancel: control.abort });
  try {
    let lastStep = -1;
    const blob = await deps.download(spec, {
      signal: control.signal,
      onProgress: (received, total) => {
        const step = Math.floor((received / total) * 200); // half a percent: enough for a smooth bar, few renders
        if (step === lastStep && received < total) return;
        lastStep = step;
        patchInstall(id, { received, total });
      },
    });
    patchInstall(id, { phase: "saving" });
    await putStoredModel(spec, blob);
    void deps.persist().catch(() => undefined);
    await refreshModels(deps);
    if (options.warm === false) return {};
    patchInstall(id, { phase: "preparing" });
    return await prepareEngine(spec, blob, deps, control.signal);
  } catch (error) {
    report("Downloading the model", error);
    throw error;
  } finally {
    control.dispose();
    setInstall(id, undefined);
  }
}

/* ---------------- the jobs that change a photo ---------------- */

export interface PhotoJobOptions {
  signal?: AbortSignal;
  /**
   * Asked when the model is not on the device. Return true to download it. Without this the job never downloads
   * anything: it fails with `not-installed` instead.
   */
  askToDownload?(spec: ModelSpec): Promise<boolean>;
}

type StoredCopy = NonNullable<Awaited<ReturnType<typeof usableCopy>>>;

/** What a job's own work gets once the photo and the model are known to be fit for it. */
interface JobContext {
  elementId: ID;
  /** the picture the photo showed when the job began */
  startSrc: string;
  spec: ModelSpec;
  stored: StoredCopy;
  signal: AbortSignal;
  stopIfCancelled(): void;
}

const setStage = (stage: MlStage) => useMlStore.setState((s) => (s.job ? { job: { ...s.job, stage } } : s));

/** How far a job has come, and a guess of how long the rest takes (none while it has no basis for one). */
const setProgress = (done: number, total: number, remainingMs?: number) => useMlStore.setState((s) => (s.job ? { job: { ...s.job, progress: done / total, remainingMs } } : s));

/**
 * What every job on a photo begins and ends with: one at a time, a photo that can be changed, a browser that can run the
 * model, the model on the device (asking first, if it is not), and the job's state in the store for the screens, until it
 * is over. `check` looks at the photo before anything is downloaded or run. A failure is written to the console for a bug
 * report and handed on; Cancel arrives as `aborted`.
 */
async function runPhotoJob<T>(
  job: { kind: JobKind; label: string; task: MlTask },
  elementId: ID,
  options: PhotoJobOptions,
  deps: MlDeps,
  check: (element: ImageElement) => void | Promise<void>,
  work: (context: JobContext) => Promise<T>,
): Promise<T> {
  if (useMlStore.getState().job) throw new MlError("busy");
  const found = locate(elementId);
  const startSrc = found?.element.src;
  if (!found || !startSrc) throw new MlError("image");
  if (!canEdit(found.element)) throw new MlError("locked");

  const control = linked(options.signal);
  const stopIfCancelled = () => {
    if (control.signal.aborted) throw new MlError("aborted");
  };
  useMlStore.setState({ job: { kind: job.kind, elementId, stage: "preparing", cancel: control.abort } });
  try {
    await check(found.element);
    const spec = deps.spec(deps.defaultModel(job.task));
    if (!spec) throw new MlError("runtime");
    const support = await deps.support(spec);
    if (!support.ok) throw new MlError("unsupported", support.message);

    let stored = await usableCopy(spec);
    if (!stored) {
      if (!options.askToDownload) throw new MlError("not-installed");
      if (!(await options.askToDownload(spec))) throw new MlError("aborted");
      await installModel(spec.id, { signal: control.signal, warm: false, requestedBy: job.kind }, deps);
      stored = await usableCopy(spec);
      if (!stored) throw new MlError("storage");
    }
    return await work({ elementId, startSrc, spec, stored, signal: control.signal, stopIfCancelled });
  } catch (error) {
    report(job.label, error);
    throw error;
  } finally {
    control.dispose();
    useMlStore.setState({ job: null });
  }
}

/** The words of a picture the jobs name their results after, and what its file is. */
async function describeSource(src: string): Promise<{ name: string; vector: boolean; jpeg: boolean }> {
  const asset = src.startsWith("asset:") ? await getAsset(src.slice(6)) : null;
  const literal = src.startsWith("data:") ? src.slice(5, 30).toLowerCase() : "";
  return {
    // a photo that went through several tools keeps one name, not a chain of suffixes
    name: (asset?.name ?? "Photo").replace(/( \((no background|blurred|colour pop|[24]x)\))+$/, ""),
    vector: asset?.kind === "svg" || literal.startsWith("image/svg"),
    jpeg: asset?.mime === "image/jpeg" || /^image\/jpe?g/.test(literal),
  };
}

/**
 * Saves the result as a new picture in the library and puts it on the photo, as one undo step, with the old picture
 * remembered in `originalSrc`. Never on a photo that changed meanwhile: the new picture is thrown away then.
 */
async function applyResult({ elementId, startSrc, signal }: JobContext, blob: Blob, name: string, width: number, height: number): Promise<void> {
  let asset: Asset;
  try {
    asset = await addAssetFromBlob(blob, name);
  } catch (error) {
    throw storageError(error); // a full disk says so, instead of "the model could not run"
  }
  const discard = async (error: MlError): Promise<never> => {
    await deleteAsset(asset.id).catch(() => undefined);
    throw error;
  };
  if (signal.aborted) return discard(new MlError("aborted"));

  // the person may have swapped or deleted the photo while the model worked: never put a result on the wrong picture
  const now = locate(elementId);
  if (!now || now.element.src !== startSrc) return discard(new MlError("stale"));
  useEditor.getState().actions.updateElementsOnPage(now.pageId, [elementId], (draft) => {
    if (draft.type !== "image") return;
    draft.originalSrc ??= startSrc;
    draft.src = assetSrc(asset.id);
    draft.naturalWidth = width;
    draft.naturalHeight = height;
  });
  // a photo locked (or a design switched to view-only) while the model worked refuses the change: do not say it worked
  if (locate(elementId)?.element.src !== assetSrc(asset.id)) return discard(new MlError("locked"));
}

/* ---------------- finding the subject of a photo ---------------- */

/** What the model found in one picture, kept so another job on the same picture does not make the person wait for it again. */
let lastMask: { src: string; model: ModelId; mask: Uint8ClampedArray } | undefined;

/** Lets go of the mask that was kept. */
export function forgetMasks(): void {
  lastMask = undefined;
}

/**
 * The subject of the picture a job began with, as coverage from 0 to 255 in the model's square. Asks the model, unless it
 * was asked about this very picture a moment ago: Undo, then another try with a different blur costs no second wait. The
 * picture is the same when its source is (a source names its pixels); the kept mask goes when the model is removed.
 */
async function findSubject(context: JobContext, source: Drawable, io: ImageToMaskIo, deps: MlDeps): Promise<Uint8ClampedArray> {
  const { spec, stored, signal, startSrc } = context;
  if (lastMask && lastMask.src === startSrc && lastMask.model === spec.id) return lastMask.mask;
  const mask = await deps.client.run({ model: workerModel(spec, stored.blob), rgba: modelInput(source, io.size) }, { signal, onStage: setStage });
  lastMask = { src: startSrc, model: spec.id, mask };
  return mask;
}

/* ---------------- what the jobs on the subject of a photo have in common ---------------- */

/**
 * What every job on the subject of a photo starts with: the picture, and where the subject is in it. A photo with no subject
 * at all is an error; `whole` says the subject is all there is, which a job reports as nothing to do.
 */
async function locateSubject(context: JobContext, deps: MlDeps): Promise<{ source: Drawable; mask: Uint8ClampedArray; io: ImageToMaskIo; whole: boolean }> {
  const { spec, startSrc, stopIfCancelled } = context;
  const io = spec.io;
  if (io.kind !== "image-to-mask") throw new MlError("runtime", undefined, { cause: `${spec.id} does not turn a picture into a mask` });
  const source = await deps.loadSource(startSrc);
  if (!source) throw new MlError("image");
  const mask = await findSubject(context, source, io, deps);

  stopIfCancelled();
  const share = subjectShare(mask);
  if (share < NOTHING) throw new MlError("no-subject");
  return { source, mask, io, whole: share > EVERYTHING };
}

/** The pixels of a picture a job takes in one piece, and how long it may work before it gives the screen a turn (ms). */
const PIECE_PIXELS = 262_144;
const TURN_MS = 30;

/** Runs `work` on the rows of a picture, one piece of them after the other. */
type EachPiece = (work: (from: number, to: number) => void) => Promise<void>;

/**
 * Between the pieces of a job's work on a picture: stop when the person pressed Cancel and, now and then, let the screen draw
 * and answer them. A large photo then never freezes the page for longer than one piece takes.
 */
function pieceRunner(picture: SourcePixels, context: JobContext, deps: MlDeps): EachPiece {
  const rowsAtOnce = Math.max(1, Math.floor(PIECE_PIXELS / picture.width));
  let lastTurn = deps.now();
  const breathe = async () => {
    context.stopIfCancelled();
    if (deps.now() - lastTurn < TURN_MS) return;
    await deps.yieldToBrowser();
    lastTurn = deps.now();
    context.stopIfCancelled();
  };
  return async (work) => {
    for (let from = 0; from < picture.height; from += rowsAtOnce) {
      work(from, Math.min(picture.height, from + rowsAtOnce));
      await breathe();
    }
  };
}

/**
 * Paints the photo a piece of rows at a time (`paint` changes the pixels of the rows it is given) onto a new canvas, saves
 * the canvas as a new picture named after the old one with `suffix`, and puts it on the photo. Asked once all the pieces are
 * painted, `keep` can say that the result is not worth saving: nothing is applied then. Returns whether it was.
 */
async function paintAndApply(
  context: JobContext,
  deps: MlDeps,
  picture: SourcePixels,
  transparent: boolean,
  suffix: string,
  eachPiece: EachPiece,
  paint: (from: number, to: number) => void,
  keep: () => boolean = () => true,
): Promise<boolean> {
  const canvas = deps.createResultCanvas(picture.width, picture.height);
  try {
    await eachPiece((from, to) => {
      paint(from, to);
      canvas.put(0, from, picture.rgba.subarray(from * picture.width * 4, to * picture.width * 4), picture.width, to - from);
    });
    if (!keep()) return false;
    const { name, jpeg } = await describeSource(context.startSrc);
    const blob = await canvas.finish({ jpeg: !transparent && jpeg });
    context.stopIfCancelled();
    await applyResult(context, blob, `${name} (${suffix})`, picture.width, picture.height);
    return true;
  } finally {
    canvas.dispose();
  }
}

/* ---------------- removing a background ---------------- */

export type RemoveBackgroundOptions = PhotoJobOptions;

export type RemoveBackgroundResult = { applied: true; scaled: boolean } | { applied: false; reason: "whole-photo" };

/**
 * Cuts the subject out of a photo. The cut-out becomes a new picture in the library, the element points at it, and the
 * old picture is remembered in `originalSrc`. Applying it is a single undo step.
 */
export function removeBackground(elementId: ID, options: RemoveBackgroundOptions = {}, deps: MlDeps = defaultDeps()): Promise<RemoveBackgroundResult> {
  return runPhotoJob<RemoveBackgroundResult>(
    { kind: "remove-background", label: "Remove background", task: "background-removal" },
    elementId,
    options,
    deps,
    () => undefined,
    async (context) => {
      const { source, mask, io, whole } = await locateSubject(context, deps);
      if (whole) return { applied: false, reason: "whole-photo" };

      setStage("finishing");
      const result = await cutOut(source, mask, io.size);
      context.stopIfCancelled();
      await applyResult(context, result.blob, `${(await describeSource(context.startSrc)).name} (no background)`, result.width, result.height);
      return { applied: true, scaled: result.scaled };
    },
  );
}

/* ---------------- blurring a background ---------------- */

export interface BlurBackgroundOptions extends PhotoJobOptions {
  /** how much to blur (default: medium) */
  strength?: BlurStrength;
}

export type BlurBackgroundResult =
  | { applied: true; scaled: boolean; width: number; height: number }
  /** `whole-photo`: the subject is all there is. `transparent`: everything around the subject is already transparent. */
  | { applied: false; reason: "whole-photo" | "transparent" };

/**
 * Keeps the subject of a photo sharp and blurs what is behind it. The model that cuts a background out finds the subject;
 * the blur is worked out here, in pieces, so the screen stays alive and Cancel works. The result becomes a new picture, as
 * large as the photo (or as large as the 25-megapixel budget allows), and applying it is a single undo step.
 */
export function blurBackground(elementId: ID, options: BlurBackgroundOptions = {}, deps: MlDeps = defaultDeps()): Promise<BlurBackgroundResult> {
  const strength = options.strength ?? "medium";
  const check = () => {
    if (!BLUR_STRENGTHS.includes(strength)) throw new MlError("runtime", undefined, { cause: `there is no blur strength called ${String(strength)}` });
  };
  return runPhotoJob<BlurBackgroundResult>({ kind: "blur-background", label: "Blur background", task: "background-removal" }, elementId, options, deps, check, async (context) => {
    const { mask, io, whole, source } = await locateSubject(context, deps);
    if (whole) return { applied: false, reason: "whole-photo" };

    setStage("finishing");
    const picture = deps.readPixels(source, MAX_OUTPUT_PIXELS);
    const transparent = hasTransparency(picture.rgba);
    const blur = createBackgroundBlur(picture, { data: mask, size: io.size }, blurSigma(picture.width, picture.height, strength));
    const eachPiece = pieceRunner(picture, context, deps);
    await eachPiece((from, to) => blur.addRows(from, to));
    if (!blur.solve()) return { applied: false, reason: "transparent" };
    await paintAndApply(context, deps, picture, transparent, "blurred", eachPiece, (from, to) => blur.paintRows(from, to));
    return { applied: true, scaled: picture.scaled === true, width: picture.width, height: picture.height };
  });
}

/* ---------------- colour pop ---------------- */

export interface ColourPopOptions extends PhotoJobOptions {
  /** how much colour goes out of the background (default: all of it) */
  style?: PopStyle;
}

export type ColourPopResult =
  | { applied: true; scaled: boolean; width: number; height: number }
  /** `whole-photo`: the subject is all there is. `no-colour`: the background has no colour to take out (grey already, transparent, or only a faint rim). */
  | { applied: false; reason: "whole-photo" | "no-colour" };

/**
 * Keeps the subject of a photo in colour and takes the colour out of what is behind it. The model that cuts a background
 * out finds the subject; the rest is arithmetic, done here in pieces. The result becomes a new picture, as large as the photo
 * (or as large as the 25-megapixel budget allows), and applying it is a single undo step.
 */
export function colourPop(elementId: ID, options: ColourPopOptions = {}, deps: MlDeps = defaultDeps()): Promise<ColourPopResult> {
  const style = options.style ?? "black-and-white";
  const check = () => {
    if (!POP_STYLES.includes(style)) throw new MlError("runtime", undefined, { cause: `there is no colour pop style called ${String(style)}` });
  };
  return runPhotoJob<ColourPopResult>({ kind: "colour-pop", label: "Colour pop", task: "background-removal" }, elementId, options, deps, check, async (context) => {
    const { mask, io, whole, source } = await locateSubject(context, deps);
    if (whole) return { applied: false, reason: "whole-photo" };

    setStage("finishing");
    const picture = deps.readPixels(source, MAX_OUTPUT_PIXELS);
    const pop = createColourPop(picture, { data: mask, size: io.size }, popAmount(style));
    let changed = 0;
    const saved = await paintAndApply(
      context,
      deps,
      picture,
      hasTransparency(picture.rgba),
      "colour pop",
      pieceRunner(picture, context, deps),
      (from, to) => {
        changed += pop.paintRows(from, to);
      },
      () => changed >= picture.width * picture.height * MIN_CHANGED_SHARE,
    );
    if (!saved) return { applied: false, reason: "no-colour" };
    return { applied: true, scaled: picture.scaled === true, width: picture.width, height: picture.height };
  });
}

/* ---------------- making a picture larger ---------------- */

export interface UpscaleOptions extends PhotoJobOptions {
  /** how many times larger each side becomes: 2 or 4 */
  factor: number;
}

export interface UpscaleResult {
  factor: number;
  /** the size of the new picture in pixels */
  width: number;
  height: number;
}

/**
 * Makes a photo two or four times larger and draws back the sharpness it lacks. The photo goes through the model tile by
 * tile (so the work has a progress bar and a Cancel), the tiles are put together, and the result becomes a new picture in
 * the library. The photo keeps the size it has on the page: only the picture behind it has more pixels.
 */
export function upscale(elementId: ID, options: UpscaleOptions, deps: MlDeps = defaultDeps()): Promise<UpscaleResult> {
  const { factor } = options;
  const check = async (element: ImageElement) => {
    if (!UPSCALE_FACTORS.includes(factor)) throw new MlError("runtime", undefined, { cause: `a picture cannot be made ${factor} times larger` });
    // going by the size the photo is recorded with, before anything is downloaded: the picture itself is checked again below
    if (!upscaleChoices(element.naturalWidth, element.naturalHeight, [factor])[0]!.fits) throw new MlError("too-large");
    if ((await describeSource(element.src!)).vector) throw new MlError("image", m.ml.errors.vector);
  };
  return runPhotoJob({ kind: "upscale", label: "Upscale", task: "upscaling" }, elementId, options, deps, check, async (context) => {
    const { spec, stored, signal, stopIfCancelled, startSrc } = context;
    const io = spec.io;
    if (io.kind !== "image-to-image" || io.scale % factor !== 0) throw new MlError("runtime", undefined, { cause: `${spec.id} cannot make a picture ${factor} times larger` });
    const source = await deps.loadSource(startSrc);
    if (!source) throw new MlError("image");
    stopIfCancelled();
    const picture = deps.readPixels(source);
    const size = upscaleChoices(picture.width, picture.height, [factor])[0]!;
    if (!size.fits) throw new MlError("too-large");

    // what a transparent pixel is stored as (black, usually) must not reach the model: it would draw a dark fringe
    const transparent = hasTransparency(picture.rgba);
    const pixels = transparent ? bleedColours(picture.rgba, picture.width, picture.height) : picture.rgba;
    const plan = planTiles(picture.width, picture.height, io.tile, io.halo);
    const model = workerModel(spec, stored.blob);
    const canvas = deps.createResultCanvas(size.width, size.height);
    try {
      // the first tile also starts the engine and builds the session: the pace is that of the tiles after it
      let firstDoneAt = 0;
      for (const [n, tile] of plan.tiles.entries()) {
        stopIfCancelled();
        const answer = await deps.client.tile(
          { model, pixels: extractTile(pixels, picture.width, picture.height, plan, tile), width: plan.windowWidth, height: plan.windowHeight },
          // the engine's own first steps are news once; after that the stage stays "inference"
          { signal, onStage: n === 0 ? setStage : undefined },
        );
        const kept = keepTile(answer, plan, tile, io.scale, factor);
        canvas.put(tile.x * factor, tile.y * factor, kept.rgba, kept.width, kept.height);
        const finishedAt = deps.now();
        if (n === 0) firstDoneAt = finishedAt;
        const left = plan.tiles.length - (n + 1);
        setProgress(n + 1, plan.tiles.length, n >= 2 ? ((finishedAt - firstDoneAt) / n) * left : undefined);
      }
      stopIfCancelled();
      setStage("finishing");
      const { name, jpeg } = await describeSource(startSrc);
      const matte = transparent ? { rgba: maskToRgba(alphaOf(picture.rgba)), width: picture.width, height: picture.height } : undefined;
      const blob = await canvas.finish({ matte, jpeg: !transparent && jpeg });
      stopIfCancelled();
      await applyResult(context, blob, `${name} (${factor}x)`, size.width, size.height);
    } finally {
      canvas.dispose();
    }
    return { factor, width: size.width, height: size.height };
  });
}

/** Puts the picture back that "Remove background" replaced, as one undo step. */
export async function restoreOriginal(elementId: ID, deps: MlDeps = defaultDeps()): Promise<void> {
  const found = locate(elementId);
  const original = found?.element.originalSrc;
  if (!found || !original) return;
  if (!canEdit(found.element)) throw new MlError("locked");
  const picture = await deps.loadSource(original);
  if (!picture) throw new MlError("image", m.ml.errors.originalGone);
  const { width, height } = sizeOf(picture);
  useEditor.getState().actions.updateElementsOnPage(found.pageId, [elementId], (draft) => {
    if (draft.type !== "image" || draft.originalSrc !== original) return;
    draft.src = original;
    delete draft.originalSrc;
    if (width > 0 && height > 0) {
      draft.naturalWidth = width;
      draft.naturalHeight = height;
    }
  });
  if (locate(elementId)?.element.src !== original) throw new MlError("locked");
}

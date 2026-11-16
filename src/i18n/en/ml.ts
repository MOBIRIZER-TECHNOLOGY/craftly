/**
 * The words of the on-device photo tools (src/ml): asking to download a model, why a browser cannot run one, what a job is
 * doing and why it failed. The worker (src/ml/worker.ts) never reads these: it sends a code, and the page says it in words.
 * The names of models, their licences and credits are names and stay as they are.
 */
import { num, plural } from "../format";

export const ml = {
  /** the question before a model is downloaded (askToDownload.ts) */
  ask: {
    title: (tool: string) => `Download the ${tool.toLowerCase()}?`,
    message: (model: string, size: string, host: string, licence: string) =>
      `This tool runs an AI model on your device, so your photos are never uploaded. The model, ${model}, is ${size}. It downloads once from ${host} and stays on this device, so the tool then works offline. Licence: ${licence}.`,
    confirm: (size: string) => `Download ${size}`,
    notNow: "Not now",
  },

  /** why this browser cannot run a model (device.ts) */
  support: {
    noWorkers: "This browser can't run background tasks, which the model needs.",
    noStorage: "This browser has no storage for the model. Private windows often block it.",
    noWebgpu: "This browser doesn't support WebGPU, which the model needs. Try Chrome or Edge 113 or newer, Safari 26 or newer, or Firefox 141 or newer on Windows.",
    /** `features` are the words for what the graphics card lacks, such as `halfPrecision` */
    missingFeature: (features: readonly string[]) =>
      `This graphics card can't do ${features.join(" and ")}, which the model needs. A newer graphics card or another browser may help.`,
    halfPrecision: "half-precision maths",
    noAdapter: "WebGPU is available, but the browser found no graphics card to use. Check that hardware acceleration is switched on.",
  },

  /** why a job or a download failed, by the code of the error (errors.ts) */
  errors: {
    aborted: "Cancelled.",
    unsupported: "This browser can't run the model. Try the latest Chrome, Edge or Safari.",
    "not-installed": "The model isn't on this device yet.",
    engine: "The tool's engine could not be loaded. If you are offline, connect once so it can be stored.",
    locked: "This photo is locked, or the design is view-only. Unlock it or switch to editing, then try again.",
    offline: "You're offline and the model isn't on this device yet. Connect once to download it.",
    network: "The download was interrupted. Check your connection and try again.",
    http: "The model host didn't send the file. Try again in a moment.",
    size: "The file is not the expected size, so it was not used.",
    hash: "The file does not match the expected checksum, so it was not used.",
    quota: "There isn't enough free space on this device to store the model.",
    storage: "The browser would not store the model. Private windows often block this.",
    runtime: "The model could not run on this device.",
    "out-of-memory": "This device ran out of graphics memory. Close other tabs and try again.",
    "worker-crashed": "The background process stopped unexpectedly. Try again.",
    image: "That picture could not be read.",
    stale: "The photo changed while it was being processed, so nothing was applied.",
    "no-subject": "No subject was found in this photo.",
    "too-large": "This picture is too large to enlarge: the result would be over 25 megapixels. Choose a smaller factor, or crop the picture first.",
    busy: "Another photo is being processed. Wait for it to finish.",
    /** the upscaler, given a vector picture */
    vector: "A vector picture stays sharp at any size, so there is nothing to make larger.",
    /** undoing Remove background when the original is gone */
    originalGone: "The original picture is no longer available.",
  },

  /** the steps of a job (labels.ts) */
  stages: {
    preparing: "Getting ready…",
    runtime: "Starting the engine…",
    model: "Loading the model…",
    findingSubject: "Finding the subject…",
    cuttingOut: "Cutting it out…",
    blurring: "Blurring the background…",
    takingColourOut: "Taking the colour out of the background…",
    enlarging: "Making it larger…",
    savingPicture: "Saving the picture…",
  },

  /** the steps of a model's install (labels.ts) */
  install: {
    downloading: "Downloading the model",
    saving: "Saving the model…",
    preparing: "Getting the engine ready…",
  },

  /** how long a job still takes (labels.ts) */
  remaining: {
    seconds: (seconds: number) => `about ${num(seconds)} seconds left`,
    minutes: (minutes: number) => plural(minutes, { one: "about 1 minute left", other: `about ${num(minutes)} minutes left` }),
  },

  /** the models, as the screens describe them (registry.ts); `tool` is a noun that reads after "the" */
  models: {
    backgroundRemover: {
      tool: "Background remover",
      summary:
        "Finds the main subject of a photo, so it can be cut out, or the background behind it blurred or turned black and white. Made of plain convolutions, so it runs on ordinary graphics cards.",
    },
    upscaler: {
      tool: "Upscaler",
      summary: "Makes a picture two or four times larger and draws back the sharpness that was lost. Small enough to run on ordinary graphics cards.",
    },
  },
};

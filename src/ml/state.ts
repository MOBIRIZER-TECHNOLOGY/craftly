/** What the screens need to know about the models and the running job. Written by `service.ts`, read by the panels. */
import { create } from "zustand";
import type { StorageStatus } from "./modelStore";
import type { InstalledModel, MlStage, ModelId, ModelSpec } from "./types";

/** What the running job does to the photo. Only one runs at a time. */
export type JobKind = "remove-background" | "blur-background" | "colour-pop" | "upscale";

export interface InstallState {
  phase: "downloading" | "saving" | "preparing";
  received: number;
  total: number;
  /** the tool whose button started the download: two tools can share a model, and the download is shown under the one that asked */
  requestedBy?: JobKind;
  cancel(): void;
}

export interface JobState {
  kind: JobKind;
  elementId: string;
  stage: MlStage;
  /** how much of the work is done, from 0 to 1, for a job that knows (the upscaler counts its tiles) */
  progress?: number;
  /** a guess of how long the rest takes, from the time the first tiles took: left out until there is enough to go by */
  remainingMs?: number;
  cancel(): void;
}

export interface MlState {
  /** the installed models have been read at least once */
  loaded: boolean;
  installed: Record<ModelId, InstalledModel | undefined>;
  installing: Record<ModelId, InstallState | undefined>;
  job: JobState | null;
  storage: StorageStatus;
}

export const useMlStore = create<MlState>(() => ({ loaded: false, installed: {}, installing: {}, job: null, storage: {} }));

export type ModelStatus = "unknown" | "missing" | "installing" | "ready" | "outdated";

/** `outdated`: a copy is stored but the registry now pins a different file, so it has to be downloaded again. */
export function modelStatus(spec: ModelSpec, state: MlState): ModelStatus {
  if (state.installing[spec.id]) return "installing";
  if (!state.loaded) return "unknown";
  const have = state.installed[spec.id];
  if (!have) return "missing";
  return have.sha256 === spec.sha256 ? "ready" : "outdated";
}

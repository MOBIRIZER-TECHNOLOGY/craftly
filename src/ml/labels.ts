/** The words the screens use for the steps of a job and of an install. */
import type { InstallState, JobKind } from "./state";
import type { MlStage } from "./types";

const COMMON = { preparing: "Getting ready…", runtime: "Starting the engine…", model: "Loading the model…" } as const;

export const STAGE_TEXT: Record<JobKind, Record<MlStage, string>> = {
  "remove-background": { ...COMMON, inference: "Finding the subject…", finishing: "Cutting it out…" },
  "blur-background": { ...COMMON, inference: "Finding the subject…", finishing: "Blurring the background…" },
  "colour-pop": { ...COMMON, inference: "Finding the subject…", finishing: "Taking the colour out of the background…" },
  upscale: { ...COMMON, inference: "Making it larger…", finishing: "Saving the picture…" },
};

export const INSTALL_TEXT: Record<InstallState["phase"], string> = {
  downloading: "Downloading the model",
  saving: "Saving the model…",
  preparing: "Getting the engine ready…",
};

/**
 * How long a job still takes, in words: seconds in steps of five up to a minute and a quarter, then minutes. Nothing when
 * the guess is not there yet or what is left is under ten seconds, which is no news worth a changing number.
 */
export function remainingText(ms: number | undefined): string | null {
  if (ms === undefined || !(ms >= 10_000)) return null;
  const seconds = ms / 1000;
  if (seconds < 75) return `about ${Math.round(seconds / 5) * 5} seconds left`;
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}

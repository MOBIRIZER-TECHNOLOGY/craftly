/** The words the screens use for the steps of a job and of an install (from the catalog, `m.ml`). */
import { m } from "@/i18n";
import type { InstallState, JobKind } from "./state";
import type { MlStage } from "./types";

const { stages } = m.ml;
const COMMON = { preparing: stages.preparing, runtime: stages.runtime, model: stages.model } as const;

export const STAGE_TEXT: Record<JobKind, Record<MlStage, string>> = {
  "remove-background": { ...COMMON, inference: stages.findingSubject, finishing: stages.cuttingOut },
  "blur-background": { ...COMMON, inference: stages.findingSubject, finishing: stages.blurring },
  "colour-pop": { ...COMMON, inference: stages.findingSubject, finishing: stages.takingColourOut },
  upscale: { ...COMMON, inference: stages.enlarging, finishing: stages.savingPicture },
};

export const INSTALL_TEXT: Record<InstallState["phase"], string> = { ...m.ml.install };

/**
 * How long a job still takes, in words: seconds in steps of five up to a minute and a quarter, then minutes. Nothing when
 * the guess is not there yet or what is left is under ten seconds, which is no news worth a changing number.
 */
export function remainingText(ms: number | undefined): string | null {
  if (ms === undefined || !(ms >= 10_000)) return null;
  const seconds = ms / 1000;
  if (seconds < 75) return m.ml.remaining.seconds(Math.round(seconds / 5) * 5);
  return m.ml.remaining.minutes(Math.round(seconds / 60));
}

/**
 * Getting back to work after Craftly stopped (docs/CRASH-RECOVERY.md). These work from the library alone, without the editor,
 * because the editor is what may not open.
 *
 * What the editor writes when it goes away is the state it had, and a crash can be caused by that very state. So before a
 * design that has stopped Craftly is written over, what was stored (the last autosave, which was on the screen for at least
 * a moment without a crash) is kept as a version, and the screen that says what happened can offer to go back to it.
 */
import { m } from "@/i18n";
import { getStoredDesign, getSummary, getVersion, listVersions, saveDesign, saveVersion } from "./library";

const STORAGE_KEY = "craftly.crashes.v1";
/** a crash that comes this soon after another one on the same design is the same trouble coming back */
const CRASH_WINDOW = 2 * 60 * 1000;

type Counts = Record<string, { count: number; at: number }>;

function readCounts(): Counts {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Counts) : {};
  } catch {
    return {};
  }
}

/** How many times the screen of this design stopped in the last two minutes, in this tab. */
export function crashCount(designId: string, now = Date.now()): number {
  const entry = readCounts()[designId];
  return entry && now - entry.at < CRASH_WINDOW ? entry.count : 0;
}

/** Counts one more stop of the screen of this design and gives the count. A tab's own memory, so that a reload does not forget it. */
export function noteCrash(designId: string, now = Date.now()): number {
  const counts = readCounts();
  const count = crashCount(designId, now) + 1;
  counts[designId] = { count, at: now };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    /* the count is only a help */
  }
  return count;
}

let crashing = false;

/** The editor is going away because its screen stopped, not because the person left it. */
export const markCrashing = (on: boolean): void => {
  crashing = on;
};
export const isCrashing = (): boolean => crashing;

/** Keeps the stored state of a design as a version, unless that state is the newest version already. */
export async function keepBeforeProblem(designId: string): Promise<"kept" | "nothing"> {
  const stored = await getStoredDesign(designId);
  if (!stored) return "nothing";
  const [newest] = await listVersions(designId);
  const latest = newest ? await getVersion(newest.id) : null;
  if (latest && latest.design.updatedAt === stored.updatedAt) return "kept";
  await saveVersion(stored, "Before the problem");
  return "kept";
}

export interface EarlierVersion {
  id: string;
  at: number;
  /** where it came from, in words */
  label: string;
}

/**
 * The labels that the app gives versions, as they are stored (they are keys, the same in every language), and the words a
 * person reads for each; a version with none is one that the autosave made.
 */
const LABELS: Readonly<Record<string, keyof typeof m.core.versions>> = {
  "Before the problem": "beforeProblem",
  "Before going back": "beforeGoingBack",
  "Before restoring": "beforeRestoring",
  "Before the update": "beforeUpdate",
  "Before sync": "beforeSync",
  "Saved by you": "savedByYou",
};

/** The newest versions of a design, to choose from after a crash. */
export async function earlierVersions(designId: string, limit = 5): Promise<EarlierVersion[]> {
  return (await listVersions(designId)).slice(0, limit).map((v) => {
    const known = v.label && Object.hasOwn(LABELS, v.label) ? LABELS[v.label] : "savedAutomatically";
    return { id: v.id, at: v.createdAt, label: m.core.versions[known] };
  });
}

/**
 * Puts the pages of a version in the stored design (its title, folder and the rest stay), and keeps what was there as a version
 * called "Before going back". False when there is no such version for this design.
 */
export async function goBackToVersion(designId: string, versionId: string): Promise<boolean> {
  const version = await getVersion(versionId);
  if (!version || version.designId !== designId) return false;
  const current = await getStoredDesign(designId);
  if (current) await saveVersion(current, "Before going back");
  const base = current ?? version.design;
  await saveDesign({ ...base, id: designId, pages: version.design.pages, width: version.design.width, height: version.design.height, updatedAt: Date.now() });
  return true;
}

/** When the stored design was last saved, or null when it is not there. */
export async function savedAt(designId: string): Promise<number | null> {
  return (await getSummary(designId))?.updatedAt ?? null;
}

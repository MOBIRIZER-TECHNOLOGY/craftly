/**
 * What the dashboard and the editor's top bar say about sync (docs/ACCOUNTS.md): synced, syncing, offline with N waiting, or a
 * problem in words. Nothing at all while nobody is signed in. Small on purpose: the screens load it with the session, and the
 * engine (sync.ts) writes it.
 */
import { create } from "zustand";

export type SyncState = "off" | "synced" | "syncing" | "offline" | "problem";

export interface SyncStatus {
  state: SyncState;
  /** designs (and deletions) whose changes the server has not had yet */
  waiting: number;
  /** the words of a problem, when `state` is "problem" */
  problem: string | null;
  /** when the last run ended without a problem */
  lastSyncedAt: number | null;
}

export const useSyncStatus = create<SyncStatus>(() => ({ state: "off", waiting: 0, problem: null, lastSyncedAt: null }));

export const setSyncStatus = (next: Partial<SyncStatus>) => useSyncStatus.setState(next);

/** What a person is shown, in the words of the catalog given (so that the screens and the tests read the same words). */
export function statusWords(
  status: Pick<SyncStatus, "state" | "waiting" | "problem">,
  words: { synced: string; syncing: string; offline: (n: number) => string; problem: string },
): string {
  switch (status.state) {
    case "synced":
      return words.synced;
    case "syncing":
      return words.syncing;
    case "offline":
      return words.offline(status.waiting);
    case "problem":
      return status.problem ?? words.problem;
    default:
      return "";
  }
}

/**
 * A tiny "load + subscribe" store. The dashboard reads the same library data from several pages, so the data
 * is fetched once, kept between page changes (instant paint, then a silent refresh) and reloaded whenever the
 * library announces a change. Overlapping reloads are coalesced: at most one runs, plus one queued behind it.
 */
import { useSyncExternalStore } from "react";

export interface LiveSnapshot<T> {
  value: T;
  /** false until the first load finished (successfully or not) */
  ready: boolean;
  error: string | null;
}

export interface LiveStore<T> {
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => LiveSnapshot<T>;
  reload: () => void;
}

type Source = (callback: () => void) => () => void;

export function createLiveStore<T>(initial: T, load: () => Promise<T>, sources: Source[]): LiveStore<T> {
  let snapshot: LiveSnapshot<T> = { value: initial, ready: false, error: null };
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;
  let running = false;
  let again = false;

  const publish = (next: LiveSnapshot<T>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          publish({ value: await load(), ready: true, error: null });
        } catch (error) {
          publish({ value: snapshot.value, ready: true, error: error instanceof Error ? error.message : String(error) });
        }
      } while (again);
    } finally {
      running = false;
    }
  };

  const subscribe = (callback: () => void) => {
    listeners.add(callback);
    if (listeners.size === 1) {
      const unsubscribers = sources.map((source) => source(() => void run()));
      detach = () => unsubscribers.forEach((fn) => fn());
      void run();
    }
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        detach?.();
        detach = null;
      }
    };
  };

  return { subscribe, getSnapshot: () => snapshot, reload: () => void run() };
}

export function useLive<T>(store: LiveStore<T>): LiveSnapshot<T> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

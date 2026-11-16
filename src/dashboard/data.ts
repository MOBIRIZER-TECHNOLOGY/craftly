/**
 * Live library data for the dashboard: designs, folders, uploads, brand kit, favourite templates and a
 * once-a-minute clock for relative times. Every hook shares one fetch (see liveStore.ts).
 */
import { useMemo, useSyncExternalStore } from "react";
import { listAssets, subscribeAssets } from "@/core/assets";
import { getBrandKit, listDesigns, listFolders, setBrandKit, subscribeLibrary } from "@/core/library";
import { metaGet, metaSet } from "@/core/persistence";
import type { Asset, BrandKit, DesignSummary, Folder } from "@/core/types";
import { m } from "@/i18n";
import { toast } from "@/ui";
import { createLiveStore, useLive } from "./liveStore";

const EMPTY_BRAND: BrandKit = { colors: [], fonts: [], logos: [] };

export const designsStore = createLiveStore<DesignSummary[]>([], listDesigns, [subscribeLibrary]);
export const foldersStore = createLiveStore<Folder[]>([], listFolders, [subscribeLibrary]);
export const brandStore = createLiveStore<BrandKit>(EMPTY_BRAND, getBrandKit, [subscribeLibrary]);
export const assetsStore = createLiveStore<Asset[]>([], listAssets, [subscribeAssets]);

/** Saved designs split into live and trashed (trash is newest-deleted first). `active` is newest-edited first. */
export function useDesigns() {
  const snapshot = useLive(designsStore);
  return useMemo(() => {
    const active: DesignSummary[] = [];
    const trashed: DesignSummary[] = [];
    for (const design of snapshot.value) (design.trashedAt ? trashed : active).push(design);
    trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    return { all: snapshot.value, active, trashed, ready: snapshot.ready, error: snapshot.error };
  }, [snapshot]);
}

export function useFolders() {
  const snapshot = useLive(foldersStore);
  return { folders: snapshot.value, ready: snapshot.ready, error: snapshot.error };
}

export function useAssets() {
  const snapshot = useLive(assetsStore);
  return { assets: snapshot.value, ready: snapshot.ready, error: snapshot.error };
}

export function useBrand() {
  const snapshot = useLive(brandStore);
  return { kit: snapshot.value, ready: snapshot.ready, error: snapshot.error };
}

/* ------------------------------------------------------------------ */
/* Brand kit writes                                                   */
/* ------------------------------------------------------------------ */

let brandQueue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write of the brand kit. Writes are queued and always start from the stored kit (not from what the
 * screen shows), so two quick edits can never overwrite each other.
 */
export function updateBrandKit(mutate: (kit: BrandKit) => BrandKit): Promise<void> {
  const task = brandQueue.then(async () => {
    const stored = await getBrandKit();
    await setBrandKit(mutate({ colors: [...stored.colors], fonts: [...stored.fonts], logos: [...stored.logos] }));
  });
  brandQueue = task.catch(() => undefined);
  return task;
}

/* ------------------------------------------------------------------ */
/* Favourite templates (meta "favTemplates")                          */
/* ------------------------------------------------------------------ */

const FAV_KEY = "favTemplates";
let favourites: string[] = [];
let favLoaded = false;
const favListeners = new Set<() => void>();

function emitFavourites() {
  favListeners.forEach((listener) => listener());
}

function subscribeFavourites(callback: () => void): () => void {
  favListeners.add(callback);
  if (!favLoaded) {
    favLoaded = true;
    void metaGet<string[]>(FAV_KEY, [])
      .then((stored) => {
        // keep anything starred while the read was in flight
        favourites = Array.from(new Set([...(Array.isArray(stored) ? stored : []), ...favourites]));
        emitFavourites();
      })
      .catch(() => {
        favLoaded = false;
      });
  }
  return () => favListeners.delete(callback);
}

const getFavourites = () => favourites;

export function useFavouriteTemplates(): ReadonlySet<string> {
  const list = useSyncExternalStore(subscribeFavourites, getFavourites, getFavourites);
  return useMemo(() => new Set(list), [list]);
}

export async function toggleFavouriteTemplate(id: string, name?: string): Promise<void> {
  const wasFavourite = favourites.includes(id);
  favourites = wasFavourite ? favourites.filter((item) => item !== id) : [...favourites, id];
  emitFavourites();
  try {
    await metaSet(FAV_KEY, favourites);
  } catch {
    toast.error(m.dashboard.favourites.saveFailed);
    return;
  }
  if (!wasFavourite && name) toast.success(m.dashboard.favourites.added(name), { duration: 2200 });
}

/* ------------------------------------------------------------------ */
/* Clock                                                              */
/* ------------------------------------------------------------------ */

let clock = Date.now();
let clockTimer = 0;
const clockListeners = new Set<() => void>();

function subscribeClock(callback: () => void): () => void {
  clockListeners.add(callback);
  if (clockListeners.size === 1) {
    clock = Date.now();
    clockTimer = window.setInterval(() => {
      clock = Date.now();
      clockListeners.forEach((listener) => listener());
    }, 60_000);
  }
  return () => {
    clockListeners.delete(callback);
    if (clockListeners.size === 0) window.clearInterval(clockTimer);
  };
}

const getClock = () => clock;

/** "Now", refreshed every minute, so "just now" turns into "1 min ago" while the page stays open. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, getClock, getClock);
}

import { useCallback, useEffect, useState } from "react";
import { getBrandKit, getRecentColors, pushRecentColor, subscribeLibrary } from "@/core/library";
import type { BrandKit } from "@/core/types";

/** The brand kit from IndexedDB, kept fresh when the Brand page changes it. null until it has loaded. */
export function useBrandKit(): BrandKit | null {
  const [kit, setKit] = useState<BrandKit | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      getBrandKit()
        .then((k) => live && setKit(k))
        .catch(() => undefined);
    };
    load();
    const off = subscribeLibrary(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return kit;
}

/** Recently used colours, plus `remember(color)` to add one (call it after a colour was committed). */
export function useRecentColors(): [string[], (color: string) => void] {
  const [recents, setRecents] = useState<string[]>([]);
  const reload = useCallback(() => {
    getRecentColors()
      .then(setRecents)
      .catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);
  const remember = useCallback(
    (color: string) => {
      pushRecentColor(color)
        .then(reload)
        .catch(() => undefined);
    },
    [reload],
  );
  return [recents, remember];
}

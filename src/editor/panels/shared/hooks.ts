/**
 * Small hooks shared by the panel tabs: viewport-aware lazy rendering, measuring, debouncing and live
 * subscriptions to the IndexedDB-backed library (uploads, designs, folders, brand kit).
 */
import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import { getAssetUrl, listAssets, subscribeAssets } from "@/core/assets";
import { getBrandKit, listDesigns, listFolders, setBrandKit, subscribeLibrary } from "@/core/library";
import type { Asset, BrandKit, DesignSummary, Folder } from "@/core/types";
import { usePanelScroller } from "./PanelLayout";

/* ------------------------------------------------------------------ */
/* visibility                                                          */
/* ------------------------------------------------------------------ */

interface ObserverEntry {
  io: IntersectionObserver;
  callbacks: Map<Element, (visible: boolean) => void>;
}

const NO_ROOT = {};
const pools = new WeakMap<object, Map<string, ObserverEntry>>();

/** One IntersectionObserver per (root, margin) pair, shared by every lazy item in a panel. */
function observe(root: Element | null, margin: string, el: Element, cb: (visible: boolean) => void): () => void {
  const key = root ?? NO_ROOT;
  let byMargin = pools.get(key);
  if (!byMargin) {
    byMargin = new Map();
    pools.set(key, byMargin);
  }
  let entry = byMargin.get(margin);
  if (!entry) {
    const callbacks = new Map<Element, (visible: boolean) => void>();
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) callbacks.get(r.target)?.(r.isIntersecting);
      },
      { root, rootMargin: margin },
    );
    entry = { io, callbacks };
    byMargin.set(margin, entry);
  }
  const { io, callbacks } = entry;
  callbacks.set(el, cb);
  io.observe(el);
  return () => {
    callbacks.delete(el);
    io.unobserve(el);
  };
}

export interface UseVisibleOptions {
  /** how far outside the panel an element counts as visible (default "320px 0px") */
  rootMargin?: string;
  /** stay "visible" once seen (default true) */
  once?: boolean;
}

/** `[ref, visible]`: becomes true when the element is near the viewport of the panel's scroll area. */
export function useVisible<T extends Element = HTMLDivElement>({ rootMargin = "320px 0px", once = true }: UseVisibleOptions = {}): [RefCallback<T>, boolean] {
  const root = usePanelScroller();
  const [node, setNode] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    return observe(root, rootMargin, node, (v) => {
      if (v) setVisible(true);
      else if (!once) setVisible(false);
    });
  }, [node, root, rootMargin, once]);
  const ref = useCallback((el: T | null) => setNode(el), []);
  return [ref, visible];
}

/* ------------------------------------------------------------------ */
/* measuring / timing                                                  */
/* ------------------------------------------------------------------ */

/** Width of an element in CSS px, kept up to date with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [RefCallback<T>, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    setWidth(Math.round(node.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  const ref = useCallback((el: T | null) => setNode(el), []);
  return [ref, width];
}

export function useDebounced<T>(value: T, ms = 160): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ------------------------------------------------------------------ */
/* live library data                                                   */
/* ------------------------------------------------------------------ */

/** The user's uploads, newest first; `null` while loading. Refreshes whenever an asset is added, renamed or removed. */
export function useAssets(): Asset[] | null {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      listAssets()
        .then((list) => alive && setAssets(list))
        .catch(() => alive && setAssets([]));
    };
    load();
    const off = subscribeAssets(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return assets;
}

/** Object URL of an uploaded asset (`null` until resolved or when the asset is gone). */
export function useAssetUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!id) return;
    getAssetUrl(id)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

export interface LibraryData {
  designs: DesignSummary[] | null;
  folders: Folder[] | null;
}

/** Saved designs (newest first) and folders; `null` while loading. */
export function useLibraryData(): LibraryData {
  const [data, setData] = useState<LibraryData>({ designs: null, folders: null });
  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([listDesigns(), listFolders()])
        .then(([designs, folders]) => alive && setData({ designs, folders }))
        .catch(() => alive && setData({ designs: [], folders: [] }));
    };
    load();
    const off = subscribeLibrary(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return data;
}

/** The brand kit with an optimistic `save`. `null` while loading. */
export function useBrandKit(): [BrandKit | null, (next: BrandKit) => Promise<void>] {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const latest = useRef(kit);
  latest.current = kit;
  useEffect(() => {
    let alive = true;
    const load = () => {
      getBrandKit()
        .then((k) => alive && setKit(k))
        .catch(() => alive && setKit({ colors: [], fonts: [], logos: [] }));
    };
    load();
    const off = subscribeLibrary(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  const save = useCallback(async (next: BrandKit) => {
    setKit(next);
    await setBrandKit(next);
  }, []);
  return [kit, save];
}

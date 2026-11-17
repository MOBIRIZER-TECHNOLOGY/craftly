import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, deleteAsset } from "@/core/assets";
import { createFolder, getBrandKit, moveToTrash, saveDesign, setBrandKit } from "@/core/library";
import { metaGet, metaSet } from "@/core/persistence";
import { emptyLibrary, imageFile, seedDesign } from "@/test/dashuiUtils";
import type { toast } from "@/ui";
import { designsStore, foldersStore, updateBrandKit, useAssets, useBrand, useDesigns, useFolders, useNow } from "./data";

beforeEach(async () => {
  await emptyLibrary();
  designsStore.reload();
  foldersStore.reload();
});

afterEach(async () => {
  // IndexedDB needs real timers: a test that faked them must hand them back before the library is touched
  vi.useRealTimers();
  await emptyLibrary();
});

describe("useDesigns", () => {
  it("is not ready until the library has been read, then lists the designs newest edit first", async () => {
    await seedDesign({ title: "Older", updatedAt: 1_000 });
    await seedDesign({ title: "Newer", updatedAt: 2_000 });
    const { result } = renderHook(() => useDesigns());
    await waitFor(() => expect(result.current.ready).toBe(true));
    // `ready` can already be true from the read that beforeEach started (before the designs were saved): wait for the list itself
    await waitFor(() => expect(result.current.active.map((design) => design.title)).toEqual(["Newer", "Older"]));
    expect(result.current.error).toBeNull();
    expect(result.current.all).toHaveLength(2);
  });

  it("keeps trashed designs apart, the most recently deleted first", async () => {
    const a = await seedDesign({ title: "Trashed early" });
    const b = await seedDesign({ title: "Trashed late" });
    await seedDesign({ title: "Alive" });
    await saveDesign({ ...a, trashedAt: 5_000 });
    await saveDesign({ ...b, trashedAt: 9_000 });
    const { result } = renderHook(() => useDesigns());
    await waitFor(() => expect(result.current.trashed).toHaveLength(2));
    expect(result.current.trashed.map((design) => design.title)).toEqual(["Trashed late", "Trashed early"]);
    expect(result.current.active.map((design) => design.title)).toEqual(["Alive"]);
  });

  it("follows the library as designs are saved, trashed and restored", async () => {
    const { result } = renderHook(() => useDesigns());
    await waitFor(() => expect(result.current.ready).toBe(true));
    // as above: `ready` can come from a read that started before beforeEach emptied the library, so wait for the empty list
    await waitFor(() => expect(result.current.active).toEqual([]));
    const design = await seedDesign({ title: "Fresh" });
    await waitFor(() => expect(result.current.active.map((item) => item.title)).toEqual(["Fresh"]));
    await moveToTrash(design.id);
    await waitFor(() => expect(result.current.trashed.map((item) => item.title)).toEqual(["Fresh"]));
    expect(result.current.active).toEqual([]);
  });
});

describe("useFolders", () => {
  it("lists the folders and follows new ones", async () => {
    const { result } = renderHook(() => useFolders());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.folders).toEqual([]);
    await createFolder("Logos");
    await waitFor(() => expect(result.current.folders.map((folder) => folder.name)).toEqual(["Logos"]));
    expect(result.current.error).toBeNull();
  });
});

describe("useAssets", () => {
  it("lists the uploaded images, newest first, and follows uploads and deletions", async () => {
    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const first = await addAssetFromFile(imageFile("first.png"));
    await waitFor(() => expect(result.current.assets.map((asset) => asset.name)).toEqual(["first"]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addAssetFromFile(imageFile("second.png"));
    await waitFor(() => expect(result.current.assets.map((asset) => asset.name)).toEqual(["second", "first"]));
    await deleteAsset(first.id);
    await waitFor(() => expect(result.current.assets.map((asset) => asset.name)).toEqual(["second"]));
  });
});

describe("useBrand", () => {
  it("starts from the library's default kit and shows what is saved", async () => {
    const { result } = renderHook(() => useBrand());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.kit.colors.length).toBeGreaterThan(0);
    await setBrandKit({ colors: ["#123456"], fonts: ["Inter"], logos: [] });
    await waitFor(() => expect(result.current.kit).toEqual({ colors: ["#123456"], fonts: ["Inter"], logos: [] }));
  });
});

describe("updateBrandKit", () => {
  it("changes the stored kit with the function it is given", async () => {
    await setBrandKit({ colors: ["#111111"], fonts: [], logos: [] });
    await updateBrandKit((kit) => ({ ...kit, colors: [...kit.colors, "#222222"] }));
    expect((await getBrandKit()).colors).toEqual(["#111111", "#222222"]);
  });

  it("gives the function a copy, so the stored kit is only changed by what it returns", async () => {
    await setBrandKit({ colors: ["#111111"], fonts: ["Inter"], logos: ["a"] });
    await updateBrandKit((kit) => {
      kit.colors.push("#999999");
      kit.fonts.push("Lora");
      kit.logos.push("b");
      return { colors: ["#111111"], fonts: ["Inter"], logos: ["a"] };
    });
    expect(await getBrandKit()).toEqual({ colors: ["#111111"], fonts: ["Inter"], logos: ["a"] });
  });

  it("applies quick edits one after the other, none overwriting another", async () => {
    await setBrandKit({ colors: [], fonts: [], logos: [] });
    await Promise.all([
      updateBrandKit((kit) => ({ ...kit, colors: [...kit.colors, "#aaaaaa"] })),
      updateBrandKit((kit) => ({ ...kit, colors: [...kit.colors, "#bbbbbb"] })),
      updateBrandKit((kit) => ({ ...kit, colors: [...kit.colors, "#cccccc"] })),
    ]);
    expect((await getBrandKit()).colors).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc"]);
  });

  it("reports a failing edit to its caller and keeps the queue going", async () => {
    await setBrandKit({ colors: ["#111111"], fonts: [], logos: [] });
    const failing = updateBrandKit(() => {
      throw new Error("bad edit");
    });
    const following = updateBrandKit((kit) => ({ ...kit, colors: [...kit.colors, "#333333"] }));
    await expect(failing).rejects.toThrow("bad edit");
    await following;
    expect((await getBrandKit()).colors).toEqual(["#111111", "#333333"]);
  });
});

describe("useNow", () => {
  it("gives the current time and refreshes it every minute, then stops the timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0));
    const { result, unmount } = renderHook(() => useNow());
    const start = result.current;
    expect(start).toBe(new Date(2026, 10, 5, 12, 0, 0).getTime());
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(59_999));
    expect(result.current).toBe(start);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(start + 60_000);
    act(() => void vi.advanceTimersByTime(120_000));
    expect(result.current).toBe(start + 180_000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one timer between components and stops it with the last one", () => {
    vi.useFakeTimers();
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("favourite templates", () => {
  type DataModule = typeof import("./data");
  let data: DataModule;
  let persistence: typeof import("@/core/persistence");
  let freshToast: typeof toast;

  // the list of favourites is loaded once per page: load the module afresh for every test
  beforeEach(async () => {
    vi.resetModules();
    persistence = await import("@/core/persistence");
    freshToast = (await import("@/ui")).toast;
    data = await import("./data");
  });

  it("is empty when nothing was ever starred", async () => {
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(result.current.size).toBe(0);
  });

  it("shows the favourites saved on this device", async () => {
    await metaSet("favTemplates", ["tpl-a", "tpl-b"]);
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await waitFor(() => expect(result.current.has("tpl-a")).toBe(true));
    expect(result.current.has("tpl-b")).toBe(true);
    expect(result.current.has("tpl-c")).toBe(false);
  });

  it("ignores a saved value that is not a list", async () => {
    await metaSet("favTemplates", "garbage");
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(result.current.size).toBe(0);
  });

  it("stars and unstars a template, keeping the choice on this device", async () => {
    const success = vi.spyOn(freshToast, "success");
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    await act(async () => data.toggleFavouriteTemplate("tpl-a", "Sunny day"));
    expect(result.current.has("tpl-a")).toBe(true);
    expect(await metaGet("favTemplates", [] as string[])).toEqual(["tpl-a"]);
    expect(success).toHaveBeenCalledWith("Added “Sunny day” to your favourites", { duration: 2200 });
    await act(async () => data.toggleFavouriteTemplate("tpl-a", "Sunny day"));
    expect(result.current.has("tpl-a")).toBe(false);
    expect(await metaGet("favTemplates", ["x"])).toEqual([]);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("does not announce a star when it has no name to announce", async () => {
    const success = vi.spyOn(freshToast, "success");
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await act(async () => data.toggleFavouriteTemplate("tpl-a"));
    expect(result.current.has("tpl-a")).toBe(true);
    expect(success).not.toHaveBeenCalled();
  });

  it("keeps a template starred while the saved list is still loading", async () => {
    await metaSet("favTemplates", ["tpl-saved"]);
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await act(async () => data.toggleFavouriteTemplate("tpl-new"));
    await waitFor(() => expect(result.current.has("tpl-saved")).toBe(true));
    expect(result.current.has("tpl-new")).toBe(true);
  });

  it("says so when the choice cannot be saved, but still shows the star for now", async () => {
    const error = vi.spyOn(freshToast, "error");
    const { result } = renderHook(() => data.useFavouriteTemplates());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    vi.spyOn(persistence, "metaSet").mockRejectedValueOnce(new Error("disk full"));
    await act(async () => data.toggleFavouriteTemplate("tpl-a", "Sunny day"));
    expect(error).toHaveBeenCalledWith("Couldn't save your favourites on this device.");
    expect(result.current.has("tpl-a")).toBe(true);
  });

  it("tries to read the saved list again later when the first read fails", async () => {
    const read = vi.spyOn(persistence, "metaGet").mockRejectedValueOnce(new Error("locked"));
    const first = renderHook(() => data.useFavouriteTemplates());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    first.unmount();
    await metaSet("favTemplates", ["tpl-late"]);
    const second = renderHook(() => data.useFavouriteTemplates());
    await waitFor(() => expect(second.result.current.has("tpl-late")).toBe(true));
    expect(read).toHaveBeenCalledTimes(2);
  });
});
